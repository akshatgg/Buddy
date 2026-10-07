'use strict';

/**
 * Buddy's server (web/): this person's free-mode settings (GET /api/config), free answers (POST /api/ask) and the
 * admin's calls (/api/admin/*). Every call carries the signed-in person's ID token; one the server turns down is
 * renewed and the call made once more, and only the server's own "unauthenticated" after that signs the person out.
 * The last settings are kept in the store (`cloud`), so Buddy still knows them after a restart without internet.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const { notSetUp } = require('./cloud-config');

const FRESH_MS = 60_000; // settings fetched (or found out of reach) less than this long ago are not fetched again
const CALL_TIMEOUT_MS = 30_000; // for calls that bring no deadline of their own
const CONFIG_TIMEOUT_MS = 8_000; // for the settings, which a request waits for before it goes anywhere
const UNREACHABLE = ['network', 'timeout', 'server']; // the server cannot be used now: fall back to what is kept
// The codes Buddy's server answers errors with: the keys of STATUS in web/lib/handlers.js, and `server` (which its
// handle() also answers for a failure of its own). test/cloud.test.js checks that the two lists agree. An error
// answer with any other code comes from something in front of the server, such as the hosting platform.
const SERVER_CODES = [
  'bad_request', 'free_no_vision', 'unauthenticated', 'blocked', 'free_off', 'not_admin', 'not_found',
  'method_not_allowed', 'free_limit', 'upstream', 'server',
];

const serverProblem = () => new BuddyError('server', "Buddy's server had a problem. Try again.");
const tookTooLong = () => new BuddyError('timeout', "Buddy's server took too long to answer. Try again.");

/** Buddy's server's own error in an answer, { code, message } with a code it sends; null for anything else. */
function serverError(j) {
  const e = j?.error;
  return e && SERVER_CODES.includes(e.code) && typeof e.message === 'string' ? e : null;
}

/** The settings as the app keeps them, from the server's answer: anything missing or odd reads as off. */
function readSettings(j) {
  return {
    freeOn: j?.freeOn === true,
    limitMode: j?.limitMode === 'unlimited' ? 'unlimited' : 'daily',
    limit: Number.isInteger(j?.limit) ? j.limit : null,
    usedToday: Number.isInteger(j?.usedToday) ? j.usedToday : 0,
    allowOwnKey: j?.allowOwnKey === true,
    blocked: j?.blocked === true,
    isAdmin: j?.isAdmin === true,
  };
}

function createCloud({ config, account, store, fetchImpl = fetch, now = Date.now }) {
  let fetchedAt = 0; // when the settings were last fetched in this run of the app, or found out of reach
  let generation = 0; // one more with each forget(): settings fetched for an earlier one are not kept
  const listeners = [];
  const changed = () => {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        // A broken listener must not undo keeping the settings, or keep the others from hearing (as in account.js).
        console.error(`[buddy] a settings listener failed: ${err?.code || err?.name || 'error'}`);
      }
    }
  };

  async function call(path, { method = 'GET', body, signal, timeoutMs = CALL_TIMEOUT_MS } = {}, retried = false) {
    if (!config) throw notSetUp();
    const idToken = await account.idToken({ force: retried });
    const headers = { authorization: `Bearer ${idToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${config.serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal || AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.name === 'TimeoutError') throw tookTooLong();
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    let j = null;
    try {
      j = await res.json();
    } catch (err) {
      if (err?.name === 'TimeoutError') throw tookTooLong(); // the deadline covers reading the answer too
      // not JSON: judged by the status below
    }
    const own = serverError(j);
    if (res.status === 401) {
      // A token the server no longer takes: renew it once.
      if (!retried) return call(path, { method, body, signal, timeoutMs }, true);
      // Turned down again, with a token just renewed. Only the server's own answer means the sign-in is over: any other
      // 401 comes from something in front of it (a hosting page that wants a login of its own), and signing the
      // person out would not help them.
      if (own?.code !== 'unauthenticated') throw serverProblem();
      account.signOut();
      throw new BuddyError('signed_out', own.message);
    }
    if (!res.ok) {
      if (own) throw new BuddyError(own.code, own.message);
      throw serverProblem();
    }
    if (!j || typeof j !== 'object') throw serverProblem();
    return j;
  }

  const last = () => store.get('cloud') || null;

  /**
   * Fetch the settings now, keep them, and say they changed. Settings that arrive after forget() are not kept: they
   * belong to the person who was signed out (or who someone else signed in over).
   */
  async function refresh() {
    const mine = generation;
    const j = await call('/api/config', { timeoutMs: CONFIG_TIMEOUT_MS });
    if (mine !== generation) return last();
    const settings = readSettings(j);
    store.set({ cloud: settings });
    fetchedAt = now();
    changed();
    return settings;
  }

  /**
   * This person's free-mode settings: fetched again when the ones fetched in this run are a minute old (or with
   * `force`); the last known ones while the server cannot be reached (null if it never was). A server out of reach is
   * not asked again for a minute either, so that a server that hangs does not hold up every request until its deadline.
   */
  async function settings({ force = false } = {}) {
    if (!force && fetchedAt && now() - fetchedAt < FRESH_MS) return last();
    const mine = generation;
    try {
      return await refresh();
    } catch (err) {
      if (!UNREACHABLE.includes(err.code)) throw err;
      if (mine === generation) fetchedAt = now();
      return last();
    }
  }

  /**
   * Forget the settings: when the person signs out, or someone else signs in, so that the next person does not
   * inherit them (or the admin's menu).
   */
  function forget() {
    generation += 1;
    store.set({ cloud: null });
    fetchedAt = 0;
    changed();
  }

  /** One free answer from the server: { text, model, check? }. */
  async function ask(action, input = {}, { signal } = {}) {
    const body = { action };
    for (const name of ['instruction', 'tone', 'text', 'image']) if (input[name] !== undefined) body[name] = input[name];
    const j = await call('/api/ask', { method: 'POST', body, signal });
    if (typeof j.text !== 'string') throw serverProblem();
    const out = { text: j.text, model: typeof j.model === 'string' ? j.model : '' };
    // A Check is read here from the text, with the function the own-key route uses: what the server sends as its own
    // reading never reaches the panel.
    return action === 'check' ? { ...out, check: prompts.parseCheck(j.text) } : out;
  }

  const admin = {
    settings: () => call('/api/admin/settings'),
    save: (patch) => call('/api/admin/settings', { method: 'PUT', body: patch }),
    models: (provider) => call(`/api/admin/models?provider=${encodeURIComponent(provider)}`),
    users: () => call('/api/admin/users'),
    block: (uid, blocked) => call('/api/admin/users', { method: 'POST', body: { uid, blocked } }),
  };

  return {
    settings,
    last,
    forget,
    ask,
    admin,
    /** `fn()` is called whenever the kept settings change. */
    onChange: (fn) => {
      listeners.push(fn);
    },
  };
}

module.exports = { createCloud, readSettings, FRESH_MS, CONFIG_TIMEOUT_MS, SERVER_CODES };
