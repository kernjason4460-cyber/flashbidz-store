window.fbzAuctionApi = async function(action, payload) {
  const routes = {
    auction_items: ["/api/auction/items", "GET"],
    place_bid: ["/api/auction/bids", "POST"],
    create_bidder_verification_checkout: ["/api/auction/verification/create", "POST"],
    finalize_bidder_verification: ["/api/auction/verification/finalize", "POST"],
    auction_winnings_get: ["/api/auction/winnings", "POST"],
    auction_order_create: ["/api/auction/orders", "POST"],
    auction_payment_create: ["/api/auction/payments/create", "POST"],
    auction_payment_finalize: ["/api/auction/payments/finalize", "POST"]
  };
  const route = routes[action];
  if (!route) return { success: true };
  const options = { method: route[1], headers: { accept: "application/json" } };
  if (route[1] === "POST") {
    options.headers["content-type"] = "application/json";
    options.body = JSON.stringify(payload || {});
  }
  const response = await fetch(route[0], options);
  return response.json();
};
