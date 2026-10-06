'use strict';

/** A fetch stand-in: records each call and answers with one status and body. */
function fakeFetch(status, body) {
  const calls = [];
  async function fetchImpl(url, init = {}) {
    calls.push({ url, init, body: init.body ? JSON.parse(init.body) : undefined });
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
      json: async () => JSON.parse(text),
    };
  }
  fetchImpl.calls = calls;
  return fetchImpl;
}

/** A fetch that fails the way Node's does when there is no network. */
function offlineFetch() {
  return async () => {
    throw new TypeError('fetch failed');
  };
}

module.exports = { fakeFetch, offlineFetch };
