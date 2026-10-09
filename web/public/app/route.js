// Which way a chat message is answered: by Buddy's server (free mode, the admin's key) or by the person's own key,
// straight from the phone (own-ai.js). The Mac's choice (src/main/ai.js ask and afterRefusal), for the chat only: it
// goes by GET /api/config (`free`) and whether a key is saved for the AI picked in Settings → AI.

import { ApiError, NO_INTERNET } from './api.js';

export const ADD_KEY = 'Free AI is off. Add your own key in Settings.';
export const PAUSED = 'Your free access is paused.';
// What the server says when it will not answer for free; the config is fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

const OWN = Object.freeze({ use: 'own' });
const SERVER = Object.freeze({ use: 'server' });
const refuse = (code, message) => ({ error: new ApiError(code, message) });

/** Today's free requests are used up: the words that send the person to their own key. */
export function needKeyText(limit) {
  const used = limit ? `today's ${limit} free requests` : "today's free requests";
  return `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`;
}

/**
 * Before asking: { use: 'own' }, { use: 'server' } or { error }. `free` is GET /api/config's answer, or null when it
 * could never be had; `hasKey` whether a key is saved for the AI picked.
 */
export function routeFor(free, hasKey) {
  if (!free) return hasKey ? OWN : refuse('network', NO_INTERNET);
  if (!free.freeOn) return hasKey ? OWN : refuse('free_off', ADD_KEY);
  if (free.blocked) return free.allowOwnKey && hasKey ? OWN : refuse('blocked', PAUSED);
  // Used up, and the admin lets this person go on with their own key: the server would only refuse.
  const usedUp = free.limitMode === 'daily' && free.limit !== null && free.usedToday >= free.limit;
  if (usedUp && free.allowOwnKey && hasKey) return OWN;
  return SERVER;
}

/**
 * The server refused with `err` (free_off, free_limit or blocked): { use: 'own' } or { error }. `fresh` is the config
 * fetched again (null when it could not be), `before` the one the message went with.
 */
export function afterRefusal(err, { before, fresh, hasKey }) {
  const now = fresh || before;
  if (err.code === 'free_off') {
    if (now.freeOn) return { error: err };
    return hasKey ? OWN : refuse('free_off', ADD_KEY);
  }
  if (now.allowOwnKey && hasKey) return OWN;
  if (err.code === 'free_limit' && now.allowOwnKey) return refuse('need_key', needKeyText(now.limit ?? before.limit));
  return { error: err };
}

/**
 * The chat's ask(body): config() answers the config (waiting for one on its way), freshConfig() fetches it again
 * (null when it cannot), hasKey() says whether a key is saved, askOwn(body) asks with it and askServer(body) is
 * POST /api/ask. Each answers { chat, … } as the server does.
 */
export function createAsk({ config, freshConfig, hasKey, askOwn, askServer }) {
  return async function ask(body) {
    const before = await config();
    const own = hasKey();
    const first = routeFor(before, own);
    if (first.error) throw first.error;
    if (first.use === 'own') return askOwn(body);
    try {
      return await askServer(body);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err?.code)) throw err;
      const fresh = await freshConfig().catch(() => null);
      const next = afterRefusal(err, { before, fresh, hasKey: own });
      if (next.error) throw next.error;
      return askOwn(body);
    }
  };
}
