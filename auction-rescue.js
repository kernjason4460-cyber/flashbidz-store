(() => {
  const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbxKOemGRRpUN4PYzgiIKCdoVPvKZrA20tGn0uFEa43pQ6UYd4UidTSyCRlv0yU9lcm6/exec";
  const BIDDER_STORAGE_KEY = "flashbidz_bidder_v2";
  let allAuctions = [];
  let toastTimer = null;

  function ready(fn) {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", fn);
    else fn();
  }

  ready(() => {
    setCurrentYear();
    bindBasicEvents();
    loadAuctions();
  });

  function byId(id) { return document.getElementById(id); }

  function bindBasicEvents() {
    byId("search-input")?.addEventListener("input", applyFilters);
    byId("status-filter")?.addEventListener("change", applyFilters);
    byId("sort-select")?.addEventListener("change", applyFilters);
    byId("theme-toggle")?.addEventListener("click", () => {
      const current = document.documentElement.getAttribute("data-theme") || "light";
      const next = current === "light" ? "dark" : "light";
      document.documentElement.setAttribute("data-theme", next);
      try { localStorage.setItem("flashbidz_theme", next); } catch (_) {}
      const icon = byId("theme-icon");
      if (icon) icon.textContent = next === "dark" ? "Dark" : "Light";
    });
    byId("verify-button")?.addEventListener("click", () => startVerification(readBidderInfo()));
  }

  function fetchJsonp(url, timeoutMs = 30000) {
    return new Promise((resolve, reject) => {
      const cbName = "__fbz_auction_cb_" + Date.now() + "_" + Math.floor(Math.random() * 100000);
      const sep = url.includes("?") ? "&" : "?";
      const script = document.createElement("script");
      let timer;
      function cleanup() {
        if (timer) clearTimeout(timer);
        try { delete window[cbName]; } catch (_) { window[cbName] = undefined; }
        if (script.parentNode) script.parentNode.removeChild(script);
      }
      window[cbName] = data => { cleanup(); resolve(data); };
      timer = setTimeout(() => { cleanup(); reject(new Error("Auction feed timed out.")); }, timeoutMs);
      script.onerror = () => { cleanup(); reject(new Error("Auction feed could not load.")); };
      script.src = url + sep + "callback=" + encodeURIComponent(cbName) + "&t=" + Date.now();
      document.head.appendChild(script);
    });
  }

  async function loadAuctions() {
    setMessage("Loading auction items...");
    setStatus("Loading auctions...", "Checking current bids");
    try {
      const data = await fetchJsonp(APPS_SCRIPT_URL + "?action=auction_items", 30000);
      if (!data || !data.success || !Array.isArray(data.items)) throw new Error(data?.error || "Auction feed unavailable");
      allAuctions = data.items.map((item, index) => ({
        ...item,
        __index: index,
        item_id: String(item.item_id || item.sku || ""),
        sku: String(item.sku || item.item_id || ""),
        title: String(item.title || ""),
        description: String(item.description || ""),
        image: normalizeImageUrl(item.image || (Array.isArray(item.images) ? item.images[0] : "")),
        images: Array.isArray(item.images) ? item.images.map(normalizeImageUrl) : [],
        current_bid: Number(item.current_bid || item.starting_bid || 0),
        next_bid: Number(item.next_bid || item.current_bid || item.starting_bid || 0),
        starting_bid: Number(item.starting_bid || 0),
        end_time: item.end_time || item.auction_end || "",
        status: String(item.status || "live").toLowerCase()
      }));
      const updated = byId("last-updated");
      if (updated) updated.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
      applyFilters();
    } catch (err) {
      allAuctions = [];
      setStatus("Auction feed unavailable", "Please refresh in a moment");
      setMessage(err.message || "Auction items are temporarily unavailable. Please refresh in a moment.");
    }
  }

  function applyFilters() {
    const search = String(byId("search-input")?.value || "").toLowerCase().trim();
    const status = byId("status-filter")?.value || "live";
    const sort = byId("sort-select")?.value || "ending";
    const now = Date.now();
    let list = allAuctions.filter(item => {
      const text = [item.title, item.description, item.sku].join(" ").toLowerCase();
      const endMs = parseEndTime(item.end_time);
      const ended = endMs && endMs <= now;
      const live = item.status !== "ended" && !ended;
      const endingSoon = live && endMs && endMs - now <= 24 * 60 * 60 * 1000;
      return (!search || text.includes(search)) && (status === "all" || (status === "live" && live) || (status === "ending" && endingSoon));
    });
    list.sort((a, b) => {
      if (sort === "bid-desc") return Number(b.current_bid || 0) - Number(a.current_bid || 0);
      if (sort === "title") return String(a.title || "").localeCompare(String(b.title || ""));
      return (parseEndTime(a.end_time) || Number.MAX_SAFE_INTEGER) - (parseEndTime(b.end_time) || Number.MAX_SAFE_INTEGER);
    });
    renderAuctions(list);
  }

  function renderAuctions(list) {
    const grid = byId("auction-grid");
    const count = byId("auction-count");
    if (!grid) return;
    grid.innerHTML = "";
    if (count) count.textContent = list.length + " auction item" + (list.length === 1 ? "" : "s");
    if (!list.length) {
      setMessage(allAuctions.length ? "No auction items match right now." : "No live auction items right now. The latest auction may have ended, or the next one has not opened yet. Please check back soon.");
      return;
    }
    setMessage("");
    list.forEach(item => grid.appendChild(buildAuctionCard(item)));
  }

  function buildAuctionCard(item) {
    const card = document.createElement("article");
    card.className = "auction-card";
    const endMs = parseEndTime(item.end_time);
    const ended = endMs && endMs <= Date.now();
    const badgeClass = ended ? "ended" : endMs && endMs - Date.now() <= 24 * 60 * 60 * 1000 ? "soon" : "live";
    const badgeText = ended ? "Ended" : badgeClass === "soon" ? "Ending Soon" : "Live";
    const minBid = Math.max(Number(item.next_bid || 0), Number(item.current_bid || 0) + 1, Number(item.starting_bid || 1));
    const bidder = readBidderInfo();
    const galleryImages = uniqueImages([item.image, ...(Array.isArray(item.images) ? item.images : [])]);
    card.innerHTML = `
      <button class="auction-image" type="button" aria-label="View photos for ${escapeHtml(item.title || "auction item")}">
        <div class="badge-row"><span class="badge ${badgeClass}">${badgeText}</span>${item.sku ? `<span class="badge">${escapeHtml(item.sku)}</span>` : ""}</div>
        <img src="${escapeHtml(item.image || "img/placeholder.png")}" alt="${escapeHtml(item.title)}" />
      </button>
      <div class="auction-body">
        <h3 class="auction-title">${escapeHtml(item.title || "Auction item")}</h3>
        <p class="auction-desc">${escapeHtml(item.description || "")}</p>
        <div class="auction-numbers">
          <div class="number-box"><span>Current Bid</span><strong>$${Number(item.current_bid || 0).toFixed(0)}</strong></div>
          <div class="number-box"><span>Ends</span><strong>${escapeHtml(formatEndTime(item.end_time))}</strong></div>
        </div>
        <form class="bid-form" data-item-id="${escapeHtml(item.item_id)}" data-sku="${escapeHtml(item.sku)}">
          <div class="bid-form-grid">
            <div class="field"><label>Bid Amount</label><input name="amount" type="number" min="${minBid}" step="1" value="${minBid}" ${ended ? "disabled" : ""} /></div>
            <div class="field"><label>Name</label><input name="name" type="text" value="${escapeHtml(bidder.name)}" autocomplete="name" required ${ended ? "disabled" : ""} /></div>
          </div>
          <div class="bid-form-grid">
            <div class="field"><label>Email</label><input name="email" type="email" value="${escapeHtml(bidder.email || bidder.contact || "")}" autocomplete="email" required ${ended ? "disabled" : ""} /></div>
            <div class="field"><label>Phone</label><input name="phone" type="tel" value="${escapeHtml(bidder.phone || "")}" autocomplete="tel" ${ended ? "disabled" : ""} /></div>
          </div>
          <div class="field"><label>Facebook Name</label><input name="facebook" type="text" value="${escapeHtml(bidder.facebook)}" ${ended ? "disabled" : ""} /></div>
          <p class="bid-note">Minimum next bid: $${minBid}. Bids in the final 2 minutes extend the clock. By bidding, you agree to the pickup policy. Bidders with 2 unpaid wins must verify before bidding.</p>
          <button class="btn btn-green" type="submit" ${ended ? "disabled" : ""}>Place Bid</button>
        </form>
      </div>`;
    card.querySelector("form")?.addEventListener("submit", event => submitBid(event, item, minBid));
    card.querySelector(".auction-image")?.addEventListener("click", () => openPhotoViewer(item.title || "Auction item", galleryImages));
    return card;
  }

  async function submitBid(event, item, minBid) {
    event.preventDefault();
    const form = event.currentTarget;
    const button = form.querySelector("button[type='submit']");
    const formData = new FormData(form);
    const amount = Number(formData.get("amount") || 0);
    const name = String(formData.get("name") || "").trim();
    const email = String(formData.get("email") || "").trim();
    const phone = String(formData.get("phone") || "").trim();
    const facebook = String(formData.get("facebook") || "").trim();
    if (!name || !email) return alert("Please enter your name and email.");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return alert("Please enter a valid email address.");
    if (!(amount >= minBid)) return alert("Bid must be at least $" + minBid + ".");
    const bidder = { ...readBidderInfo(), name, email, contact: email, phone, facebook };
    saveBidderInfo(bidder);
    button.disabled = true;
    button.textContent = "Submitting...";
    try {
      const payload = { item_id: item.item_id, sku: item.sku, title: item.title, amount, bidder: { name, email, contact: email, phone, facebook } };
      const data = await fetchJsonp(APPS_SCRIPT_URL + "?action=place_bid&payload=" + encodeURIComponent(JSON.stringify(payload)), 30000);
      if (!data || !data.success) {
        if (data && data.requires_verification && confirm(data.error + " Start verification now?")) startVerification(bidder);
        else throw new Error(data?.error || "Bid failed");
        return;
      }
      showToast(data.extended_end_time ? "Bid received. Auction extended." : "Bid received: $" + amount);
      await loadAuctions();
    } catch (err) {
      alert(err.message || "Bid could not be submitted. Please try again.");
    } finally {
      button.disabled = false;
      button.textContent = "Place Bid";
    }
  }

  async function startVerification(bidder) {
    const name = String(bidder.name || "").trim();
    const email = String(bidder.email || bidder.contact || "").trim();
    const phone = String(bidder.phone || "").trim();
    const facebook = String(bidder.facebook || "").trim();
    if (!name || !email) return alert("Enter your name and email on any bid form first, then click Verify Bidder.");
    saveBidderInfo({ ...bidder, name, email, contact: email, phone, facebook });
    try {
      const payload = { bidder: { name, email, contact: email, phone, facebook } };
      const data = await fetchJsonp(APPS_SCRIPT_URL + "?action=create_bidder_verification_checkout&payload=" + encodeURIComponent(JSON.stringify(payload)), 30000);
      if (!data || !data.success) throw new Error(data?.error || "Verification could not be started.");
      if (data.already_verified) return showToast("Bidder already verified");
      window.location.href = data.checkout_url;
    } catch (err) {
      alert(err.message || "Verification could not be started.");
    }
  }

  function readBidderInfo() {
    try {
      const saved = JSON.parse(localStorage.getItem(BIDDER_STORAGE_KEY) || "{}");
      return { name: saved.name || "", email: saved.email || saved.contact || "", contact: saved.email || saved.contact || "", phone: saved.phone || "", facebook: saved.facebook || "", verified: !!saved.verified };
    } catch (_) {
      return { name: "", email: "", contact: "", phone: "", facebook: "", verified: false };
    }
  }

  function saveBidderInfo(info) {
    try { localStorage.setItem(BIDDER_STORAGE_KEY, JSON.stringify(info)); } catch (_) {}
  }

  function openPhotoViewer(title, images) {
    const viewer = byId("photo-viewer");
    const image = byId("photo-viewer-image");
    const titleEl = byId("photo-viewer-title");
    const count = byId("photo-viewer-count");
    const clean = uniqueImages(images);
    if (!viewer || !image) return;
    let index = 0;
    function show() {
      image.src = clean[index] || "img/placeholder.png";
      image.alt = title;
      if (titleEl) titleEl.textContent = title;
      if (count) count.textContent = clean.length > 1 ? (index + 1) + " of " + clean.length : "1 photo";
    }
    byId("photo-viewer-close")?.addEventListener("click", closePhotoViewer, { once: true });
    byId("photo-viewer-prev")?.addEventListener("click", () => { index = (index - 1 + clean.length) % clean.length; show(); }, { once: true });
    byId("photo-viewer-next")?.addEventListener("click", () => { index = (index + 1) % clean.length; show(); }, { once: true });
    show();
    viewer.classList.add("show");
    viewer.setAttribute("aria-hidden", "false");
  }

  function closePhotoViewer() {
    const viewer = byId("photo-viewer");
    viewer?.classList.remove("show");
    viewer?.setAttribute("aria-hidden", "true");
  }

  function uniqueImages(images) {
    const seen = new Set();
    return images.map(normalizeImageUrl).filter(src => src && src !== "img/placeholder.png" && !seen.has(src) && seen.add(src));
  }

  function normalizeImageUrl(src) {
    src = String(src || "").trim();
    if (!src) return "img/placeholder.png";
    if (src.startsWith("http") || src.startsWith("img/")) return src;
    return "img/" + src.replace(/^\/+/, "");
  }

  function parseEndTime(value) {
    if (!value) return 0;
    const n = Number(value);
    if (n > 0) return n;
    const parsed = new Date(value).getTime();
    return Number.isNaN(parsed) ? 0 : parsed;
  }

  function formatEndTime(value) {
    const ms = parseEndTime(value);
    return ms ? new Date(ms).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "TBA";
  }

  function setMessage(text) {
    const msg = byId("auction-message");
    if (!msg) return;
    msg.textContent = text || "";
    msg.style.display = text ? "block" : "none";
  }

  function setStatus(count, updated) {
    const c = byId("auction-count");
    const u = byId("last-updated");
    if (c) c.textContent = count;
    if (u) u.textContent = updated;
  }

  function setCurrentYear() {
    const year = byId("year");
    if (year) year.textContent = new Date().getFullYear();
  }

  function escapeHtml(str) {
    return String(str || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
  }

  function showToast(message) {
    const t = byId("toast");
    if (!t) return;
    t.textContent = message || "Saved";
    t.classList.add("show");
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove("show"), 1700);
  }
})();
