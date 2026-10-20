/** Browser adapter for the existing POS. Contains no permanent credential. */
(function(global) {
  var csrfToken = '';

  async function session() {
    var response = await fetch('/api/pos/session', { credentials: 'same-origin', cache: 'no-store' });
    if (response.status === 401) {
      global.location.replace('/pos');
      throw new Error('Staff sign-in is required.');
    }
    var result = await response.json();
    if (!response.ok || !result || !result.ok || !result.csrf) throw new Error('Staff session could not be verified.');
    csrfToken = result.csrf;
    return result;
  }

  async function request(path, payload, mutates) {
    if (!csrfToken) await session();
    var response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type':'application/json',
        ...(mutates ? {'X-FBZ-CSRF':csrfToken} : {})
      },
      body: JSON.stringify(payload)
    });
    if (response.status === 401) {
      csrfToken = '';
      global.location.replace('/pos');
      throw new Error('Staff session expired. Your cart has been kept.');
    }
    var result;
    try { result = await response.json(); } catch (_) { result = null; }
    if (!response.ok || !result || result.ok === false) {
      var error = result && result.error ? result.error : {code:'POS_FAILED',message:'The POS request could not be completed.'};
      var exception = new Error(error.message || 'The POS request could not be completed.');
      exception.code = error.code || 'POS_FAILED';
      throw exception;
    }
    return result.result || result;
  }
  global.FlashBidzPosApi = {
    session: session,
    lookup: function(query) { return request('/api/pos/lookup', {query:query}, false); },
    recordCashSale: function(cart) { return request('/api/pos/cash-sale', cart, true); },
    logout: async function() {
      var response = await fetch('/api/pos/logout', { method:'POST', credentials:'same-origin', headers:{'X-FBZ-CSRF':csrfToken} });
      csrfToken = '';
      global.location.replace('/pos');
      return response.ok;
    }
  };
})(window);
