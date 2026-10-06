'use strict';

/**
 * Buddy's server (web/): this person's free-mode settings (GET /api/config), free answers (POST /api/ask) and the
 * admin's calls (/api/admin/*). Every call carries the signed-in person's ID token; one the server turns down is
 * renewed and the call made once more. The last settings are kept in the store (`cloud`), so Buddy still knows
 * them after a restart without internet.
 */

const { BuddyError } = require('../../shared/errors');
const { notSetUp } = require('./cloud-config');

const FRESH_MS = 60_000; // settings fetched less than this long ago are not fetched again
const CALL_TIMEOUT_MS = 30_000; // for calls that bring no deadline of their own
const UNREACHABLE = ['network', 'timeout', 'server']; // the server cannot be used now: fall back to what is kept

const serverProblem = () => new BuddyError('server', "Buddy's server had a problem. Try again.");
const tookTooLong = () => new BuddyError('timeout', "Buddy's server took too long to answer. Try again.");

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
  let fetchedAt = 0; // when the settings were last fetched in this run of the app
  const listeners = [];
  const changed = () => {
    for (const fn of listeners) fn();
  };

  async function call(path, { method = 'GET', body, signal } = {}, retried = false) {
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
        signal: signal || AbortSignal.timeout(CALL_TIMEOUT_MS),
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
    if (res.status === 401) {
      if (!retried) return call(path, { method, body, signal }, true); // a token the server no longer takes: renew it once
      account.signOut();
      throw new BuddyError('signed_out', typeof j?.error?.message === 'string' ? j.error.message : 'Sign in to use Buddy.');
    }
    if (!res.ok) {
      const e = j?.error;
      if (e && typeof e.code === 'string' && typeof e.message === 'string') throw new BuddyError(e.code, e.message);
      throw serverProblem();
    }
    if (!j || typeof j !== 'object') throw serverProblem();
    return j;
  }

  const last = () => store.get('cloud') || null;

  /** Fetch the settings now, keep them, and say they changed. */
  async function refresh() {
    const settings = readSettings(await call('/api/config'));
    store.set({ cloud: settings });
    fetchedAt = now();
    changed();
    return settings;
  }

  /**
   * This person's free-mode settings: fetched again when the ones fetched in this run are a minute old (or with
   * `force`); the last known ones while the server cannot be reached (null if it never was).
   */
  async function settings({ force = false } = {}) {
    if (!force && fetchedAt && now() - fetchedAt < FRESH_MS) return last();
    try {
      return await refresh();
    } catch (err) {
      if (UNREACHABLE.includes(err.code)) return last();
      throw err;
    }
  }

  /** Forget the settings: on sign-out, so the next person does not inherit them (or the admin's menu). */
  function forget() {
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
    return { text: j.text, model: typeof j.model === 'string' ? j.model : '', ...(j.check ? { check: j.check } : {}) };
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

module.exports = { createCloud, readSettings, FRESH_MS };
