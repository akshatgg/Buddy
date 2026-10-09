// Buddy on iPhone: which way a chat message is answered (web/public/app/route.js), the Mac's src/main/ai.js choice.

import test from 'node:test';
import assert from 'node:assert';
import { routeFor, afterRefusal, createAsk, needKeyText, ADD_KEY, PAUSED } from '../web/public/app/route.js';
import { ApiError, NO_INTERNET } from '../web/public/app/api.js';

/** GET /api/config's answer: free mode on, 30 a day, 0 used, `fields` over it. */
const cfg = (fields = {}) => ({ freeOn: true, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, ...fields });
const errorOf = (r) => r.error && { code: r.error.code, message: r.error.message };

test('before asking: every row of the table', () => {
  assert.deepStrictEqual(routeFor(null, true), { use: 'own' }, 'config never fetched, key: own key');
  assert.deepStrictEqual(errorOf(routeFor(null, false)), { code: 'network', message: NO_INTERNET });
  assert.deepStrictEqual(routeFor(cfg({ freeOn: false }), true), { use: 'own' });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ freeOn: false }), false)), { code: 'free_off', message: ADD_KEY });
  assert.deepStrictEqual(routeFor(cfg({ blocked: true, allowOwnKey: true }), true), { use: 'own' });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ blocked: true, allowOwnKey: true }), false)), { code: 'blocked', message: PAUSED });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ blocked: true }), true)), { code: 'blocked', message: PAUSED }, 'no own key allowed');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30, allowOwnKey: true }), true), { use: 'own' }, 'used up: own key at once');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30, allowOwnKey: true }), false), { use: 'server' }, 'the server says how many');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30 }), true), { use: 'server' }, 'own key not allowed');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 3, allowOwnKey: true }), true), { use: 'server' }, 'free first');
  assert.deepStrictEqual(routeFor(cfg({ limitMode: 'unlimited', limit: null }), true), { use: 'server' });
});

test('after a refusal: free_off goes to the own key only when free mode is now off', () => {
  const offErr = new ApiError('free_off', ADD_KEY);
  assert.deepStrictEqual(afterRefusal(offErr, { before: cfg(), fresh: cfg({ freeOn: false }), hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(errorOf(afterRefusal(offErr, { before: cfg(), fresh: cfg({ freeOn: false }), hasKey: false })), { code: 'free_off', message: ADD_KEY });
  assert.strictEqual(afterRefusal(offErr, { before: cfg(), fresh: cfg(), hasKey: true }).error, offErr, 'on again: the server\'s words');
  // The config could not be fetched again: the one from before decides.
  assert.deepStrictEqual(afterRefusal(offErr, { before: cfg({ freeOn: false }), fresh: null, hasKey: true }), { use: 'own' });
});

test('after a refusal: used up or blocked, the own key where the admin allows it, else the words that say so', () => {
  const limitErr = new ApiError('free_limit', "You've used today's 30 free requests. They come back at midnight.");
  const blockedErr = new ApiError('blocked', PAUSED);
  const allowed = cfg({ allowOwnKey: true, usedToday: 30 });
  assert.deepStrictEqual(afterRefusal(limitErr, { before: cfg(), fresh: allowed, hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(afterRefusal(blockedErr, { before: cfg(), fresh: cfg({ allowOwnKey: true, blocked: true }), hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(errorOf(afterRefusal(limitErr, { before: cfg(), fresh: allowed, hasKey: false })), {
    code: 'need_key',
    message: "You've used today's 30 free requests. Add your own key in Settings to keep going, or wait until midnight.",
  });
  assert.strictEqual(afterRefusal(limitErr, { before: cfg(), fresh: cfg(), hasKey: true }).error, limitErr, 'not allowed: the server\'s words');
  assert.strictEqual(afterRefusal(blockedErr, { before: cfg(), fresh: cfg({ allowOwnKey: true }), hasKey: false }).error, blockedErr);
  assert.strictEqual(needKeyText(null), "You've used today's free requests. Add your own key in Settings to keep going, or wait until midnight.");
});

/** createAsk with fakes: `server` answers or throws, `fresh` is the config fetched again. */
function setup({ config = cfg(), fresh = null, hasKey = true, server = { chat: { say: 'server' } } } = {}) {
  const calls = [];
  const ask = createAsk({
    config: async () => config,
    freshConfig: async () => {
      calls.push('fresh');
      if (fresh instanceof Error) throw fresh;
      return fresh;
    },
    hasKey: () => hasKey,
    askOwn: async (body) => {
      calls.push(['own', body.message]);
      return { chat: { say: 'own' } };
    },
    askServer: async (body) => {
      calls.push(['server', body.message]);
      if (server instanceof Error) throw server;
      return server;
    },
  });
  return { ask, calls };
}

test('a message goes the way the table says, and a refusal is followed by a fresh config', async () => {
  let s = setup();
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'server' } });
  assert.deepStrictEqual(s.calls, [['server', 'hi']]);

  s = setup({ config: cfg({ freeOn: false }) });
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'own' } });
  assert.deepStrictEqual(s.calls, [['own', 'hi']]);

  s = setup({ server: new ApiError('free_off', ADD_KEY), fresh: cfg({ freeOn: false }) });
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'own' } });
  assert.deepStrictEqual(s.calls, [['server', 'hi'], 'fresh', ['own', 'hi']]);

  s = setup({ server: new ApiError('free_limit', 'used up'), fresh: new Error('offline'), config: cfg({ allowOwnKey: true }), hasKey: false });
  await assert.rejects(s.ask({ message: 'hi' }), (err) => err instanceof ApiError && err.code === 'need_key');
});

test('an error that is not a free-mode refusal is the server\'s, and no config is fetched for it', async () => {
  const upstream = new ApiError('upstream', "Buddy couldn't answer. Try again.");
  const s = setup({ server: upstream });
  await assert.rejects(s.ask({ message: 'hi' }), (err) => err === upstream);
  assert.deepStrictEqual(s.calls, [['server', 'hi']]);
  const none = setup({ config: null, hasKey: false });
  await assert.rejects(none.ask({ message: 'hi' }), (err) => err.code === 'network' && err.message === NO_INTERNET);
  assert.deepStrictEqual(none.calls, []);
});

test('a stale config is asked for again: free mode switched back on is noticed', async () => {
  const { configStale, CONFIG_FRESH_MS } = await import('../web/public/app/config-age.js');
  assert.strictEqual(configStale(null, 0, 5), true, 'no config');
  assert.strictEqual(configStale(cfg(), 1000, 1000 + CONFIG_FRESH_MS - 1), false, 'fresh');
  assert.strictEqual(configStale(cfg(), 1000, 1000 + CONFIG_FRESH_MS), true, 'a minute old');
  // The app's currentConfig: re-fetch when stale, keep the old one if the fetch fails.
  let config = cfg({ freeOn: false });
  let at = 0;
  let now = 10 * CONFIG_FRESH_MS;
  let serverSays = cfg({ freeOn: true });
  let fetches = 0;
  const current = async () => {
    if (configStale(config, at, now)) {
      fetches++;
      if (serverSays) { config = serverSays; at = now; }
    }
    return config;
  };
  const asked = [];
  const ask = createAsk({ config: current, freshConfig: async () => null, hasKey: () => false, askOwn: async () => ({}), askServer: async (b) => { asked.push(b); return { chat: 'hi' }; } });
  await ask({ text: 'hello' });
  assert.strictEqual(fetches, 1);
  assert.strictEqual(asked.length, 1, 'the server route is used once free mode is on');
  now += 10_000;
  await ask({ text: 'again' });
  assert.strictEqual(fetches, 1, 'fresh: not fetched again');
  now += CONFIG_FRESH_MS;
  serverSays = null; // offline
  await current();
  assert.strictEqual(fetches, 2);
  assert.strictEqual(config.freeOn, true, 'the old config stays when the fetch fails');
});
