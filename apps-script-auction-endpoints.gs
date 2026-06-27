// FlashBidz auction page endpoints
// Paste this into the Flashbidz.store Apps Script project.
// Then add the two action blocks inside doGet as shown below.

// Add these inside doGet(e), near the existing action checks:
//
// if (action === 'auction_items') {
//   return respond_(fbzGetAuctionItemsForSite_(), e);
// }
//
// if (action === 'place_bid') {
//   return respond_(fbzPlaceAuctionBidFromQuery_(e), e);
// }

function fbzGetAuctionItemsForSite_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const items = ss.getSheetByName('Items');
  if (!items) throw new Error('Missing Items sheet.');

  const bidSheet = fbzAuctionEnsureSheet_(ss, 'Auction_Bids', fbzAuctionBidHeaders_());
  const bidderSheet = fbzAuctionEnsureSheet_(ss, 'Bidders', fbzBidderHeaders_());
  const itemInfo = headerMap_(items);
  const map = itemInfo.map;
  const last = items.getLastRow();
  const rows = last > 1 ? items.getRange(2, 1, last - 1, items.getLastColumn()).getValues() : [];
  const highBids = fbzAuctionHighBidMap_(bidSheet);
  const blocked = fbzBlockedBidderMap_(bidderSheet);
  const output = [];

  rows.forEach(function(row) {
    const itemId = String(fbzAuctionValue_(row, map, 'item_id', 'item id') || '').trim();
    const sku = String(fbzAuctionValue_(row, map, 'sku') || '').trim();
    const key = itemId || sku;
    if (!key) return;

    const title = fbzAuctionSafeText_(fbzAuctionValue_(row, map, 'title'));
    if (!title) return;

    const status = String(fbzAuctionValue_(row, map, 'status') || '').trim().toLowerCase();
    const saleChannel = String(fbzAuctionValue_(row, map, 'sale_channel', 'sale channel') || '').trim().toLowerCase();
    if (saleChannel !== 'auction' && saleChannel !== 'both') return;
    if (status && ['sold', 'paid', 'pickedup', 'picked up', 'shipped', 'returned'].indexOf(status) !== -1) return;

    const startingBid = fbzAuctionNumber_(
      fbzAuctionValue_(row, map, 'starting_bid', 'starting bid', 'price', 'store_price')
    );
    const endMs = fbzAuctionEndMs_(
      fbzAuctionValue_(row, map, 'auction_end', 'auction end', 'auction_date', 'auction date')
    );
    if (endMs && endMs <= Date.now()) return;

    const high = highBids[key] || { amount: 0, bidder_key: '' };
    const currentBid = Math.max(startingBid || 0, high.amount || 0);
    const images = normalizeImages_(String(fbzAuctionValue_(row, map, 'images', 'image') || ''));

    output.push({
      item_id: itemId,
      sku: sku,
      title: title,
      description: fbzAuctionSafeText_(fbzAuctionValue_(row, map, 'description')),
      image: images[0] || 'img/placeholder.png',
      images: images.length ? images : ['img/placeholder.png'],
      starting_bid: startingBid,
      current_bid: currentBid,
      next_bid: Math.max(currentBid + 1, startingBid || 1),
      end_time: endMs || '',
      status: blocked[high.bidder_key] ? 'review' : 'live'
    });
  });

  output.sort(function(a, b) {
    return Number(a.end_time || 9999999999999) - Number(b.end_time || 9999999999999);
  });

  return { success: true, items: output };
}

function fbzPlaceAuctionBidFromQuery_(e) {
  const raw = String(e && e.parameter && e.parameter.payload || '');
  if (!raw) return { success: false, error: 'Missing bid payload.' };

  let payload;
  try {
    payload = JSON.parse(decodeURIComponent(raw));
  } catch (err) {
    return { success: false, error: 'Bad bid payload.' };
  }

  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const bidSheet = fbzAuctionEnsureSheet_(ss, 'Auction_Bids', fbzAuctionBidHeaders_());
  const bidderSheet = fbzAuctionEnsureSheet_(ss, 'Bidders', fbzBidderHeaders_());
  const items = ss.getSheetByName('Items');
  if (!items) throw new Error('Missing Items sheet.');

  const amount = Math.floor(Number(payload.amount || 0));
  const itemId = String(payload.item_id || '').trim();
  const sku = String(payload.sku || '').trim();
  const title = fbzAuctionSafeText_(payload.title || '');
  const bidder = payload.bidder || {};
  const bidderName = fbzAuctionSafeText_(bidder.name || '');
  const bidderContact = fbzAuctionSafeText_(bidder.contact || '');
  const bidderFacebook = fbzAuctionSafeText_(bidder.facebook || '');
  const bidderKey = fbzBidderKey_(bidderContact || bidderFacebook || bidderName);

  if (!itemId && !sku) return { success: false, error: 'Missing item.' };
  if (!bidderName || !bidderContact) return { success: false, error: 'Name and phone/email are required.' };
  if (!(amount > 0)) return { success: false, error: 'Bid amount is required.' };
  if (fbzIsBidderBlocked_(bidderSheet, bidderKey)) return { success: false, error: 'This bidder is blocked. Please contact FlashBidz.' };

  const item = fbzFindAuctionItem_(items, itemId, sku);
  if (!item) return { success: false, error: 'Auction item was not found.' };

  const status = String(item.status || '').trim().toLowerCase();
  if (status && ['sold', 'paid', 'pickedup', 'picked up', 'shipped', 'returned'].indexOf(status) !== -1) {
    return { success: false, error: 'This auction item is no longer open.' };
  }

  const saleChannel = String(item.sale_channel || '').trim().toLowerCase();
  if (saleChannel !== 'auction' && saleChannel !== 'both') {
    return { success: false, error: 'This item is not open for auction bidding.' };
  }

  const endMs = fbzAuctionEndMs_(item.auction_end || item.auction_date || '');
  if (endMs && endMs <= Date.now()) return { success: false, error: 'This auction has ended.' };

  const highBids = fbzAuctionHighBidMap_(bidSheet);
  const key = item.item_id || item.sku;
  const current = Math.max(Number(item.starting_bid || 0), highBids[key] ? highBids[key].amount : 0);
  const minimum = Math.max(current + 1, Number(item.starting_bid || 1));
  if (amount < minimum) return { success: false, error: 'Minimum bid is $' + minimum + '.' };

  fbzUpsertBidder_(bidderSheet, bidderKey, bidderName, bidderContact, bidderFacebook);

  bidSheet.appendRow([
    new Date(),
    item.item_id,
    item.sku,
    title || item.title,
    amount,
    bidderName,
    bidderContact,
    bidderFacebook,
    bidderKey,
    'accepted',
    '',
    endMs ? new Date(endMs) : '',
    Session.getScriptTimeZone()
  ]);

  return { success: true, current_bid: amount, next_bid: amount + 1 };
}

function fbzAuctionBidHeaders_() {
  return ['timestamp', 'item_id', 'sku', 'title', 'bid_amount', 'bidder_name', 'bidder_contact', 'facebook_name', 'bidder_key', 'status', 'notes', 'auction_end', 'timezone'];
}

function fbzBidderHeaders_() {
  return ['bidder_key', 'name', 'contact', 'facebook_name', 'status', 'unpaid_count', 'notes', 'first_seen', 'last_seen'];
}

function fbzAuctionEnsureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) sh.appendRow(headers);
  const first = sh.getRange(1, 1, 1, headers.length).getValues()[0].join('');
  if (!first) sh.getRange(1, 1, 1, headers.length).setValues([headers]);
  return sh;
}

function fbzAuctionHighBidMap_(bidSheet) {
  const last = bidSheet.getLastRow();
  if (last < 2) return {};
  const data = bidSheet.getRange(2, 1, last - 1, bidSheet.getLastColumn()).getValues();
  const header = bidSheet.getRange(1, 1, 1, bidSheet.getLastColumn()).getValues()[0];
  const map = {};
  header.forEach(function(h, i) { map[String(h || '').trim()] = i; });
  const out = {};

  data.forEach(function(row) {
    const status = String(row[map.status] || 'accepted').toLowerCase();
    if (status === 'rejected') return;
    const key = String(row[map.item_id] || row[map.sku] || '').trim();
    const amount = fbzAuctionNumber_(row[map.bid_amount]);
    if (!key || !(amount > 0)) return;
    if (!out[key] || amount > out[key].amount) {
      out[key] = { amount: amount, bidder_key: String(row[map.bidder_key] || '').trim() };
    }
  });

  return out;
}

function fbzBlockedBidderMap_(bidderSheet) {
  const last = bidderSheet.getLastRow();
  if (last < 2) return {};
  const data = bidderSheet.getRange(2, 1, last - 1, bidderSheet.getLastColumn()).getValues();
  const out = {};
  data.forEach(function(row) {
    const key = String(row[0] || '').trim();
    const status = String(row[4] || '').trim().toLowerCase();
    if (key && status === 'blocked') out[key] = true;
  });
  return out;
}

function fbzIsBidderBlocked_(bidderSheet, bidderKey) {
  return !!fbzBlockedBidderMap_(bidderSheet)[bidderKey];
}

function fbzUpsertBidder_(sheet, key, name, contact, facebook) {
  const last = sheet.getLastRow();
  if (last >= 2) {
    const keys = sheet.getRange(2, 1, last - 1, 1).getValues().flat().map(String);
    const idx = keys.indexOf(key);
    if (idx !== -1) {
      const row = idx + 2;
      sheet.getRange(row, 2, 1, 3).setValues([[name, contact, facebook]]);
      sheet.getRange(row, 9).setValue(new Date());
      return;
    }
  }
  sheet.appendRow([key, name, contact, facebook, 'approved', 0, '', new Date(), new Date()]);
}

function fbzFindAuctionItem_(items, itemId, sku) {
  const info = headerMap_(items);
  const map = info.map;
  const last = items.getLastRow();
  if (last < 2) return null;
  const rows = items.getRange(2, 1, last - 1, items.getLastColumn()).getValues();

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const rowItemId = String(fbzAuctionValue_(row, map, 'item_id', 'item id') || '').trim();
    const rowSku = String(fbzAuctionValue_(row, map, 'sku') || '').trim();
    if ((itemId && rowItemId === itemId) || (sku && rowSku === sku)) {
      return {
        item_id: rowItemId,
        sku: rowSku,
        title: fbzAuctionSafeText_(fbzAuctionValue_(row, map, 'title')),
        status: fbzAuctionValue_(row, map, 'status'),
        sale_channel: fbzAuctionValue_(row, map, 'sale_channel', 'sale channel'),
        starting_bid: fbzAuctionNumber_(fbzAuctionValue_(row, map, 'starting_bid', 'starting bid', 'price', 'store_price')),
        auction_end: fbzAuctionValue_(row, map, 'auction_end', 'auction end'),
        auction_date: fbzAuctionValue_(row, map, 'auction_date', 'auction date')
      };
    }
  }
  return null;
}

function fbzAuctionValue_(row, map) {
  for (let i = 2; i < arguments.length; i++) {
    const col = fbzAuctionCol_(map, arguments[i]);
    if (col) return row[col - 1];
  }
  return '';
}

function fbzAuctionCol_(map, name) {
  const wanted = fbzAuctionNorm_(name);
  for (const key in map) {
    if (fbzAuctionNorm_(key) === wanted) return map[key];
  }
  return 0;
}

function fbzAuctionNorm_(value) {
  return String(value || '').trim().toLowerCase().replace(/[\s-]+/g, '_');
}

function fbzBidderKey_(value) {
  return String(value || '').trim().toLowerCase().replace(/[^a-z0-9@.]+/g, '');
}

function fbzAuctionNumber_(value) {
  const n = Number(String(value || '').replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : 0;
}

function fbzAuctionSafeText_(value) {
  return String(value || '')
    .replace(/[“”„‟]/g, '"')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[–—−]/g, '-')
    .replace(/[•·]/g, '-')
    .replace(/…/g, '...')
    .replace(/\uFFFD/g, '')
    .trim();
}

function fbzAuctionEndMs_(value) {
  if (!value) return 0;
  let d;
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    d = new Date(value.getTime());
  } else {
    d = new Date(value);
  }
  if (isNaN(d.getTime())) return 0;
  d.setHours(20, 0, 0, 0);
  return d.getTime();
}
