'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { PROVIDERS } = require('../shared/providers');
const { config, ask, adminSettings, adminModels, adminUsers, handle } = require('../web/lib/handlers');
const { fakeDb } = require('./helpers/fake-db');

const NOW = new Date('2026-10-07T06:30:00Z'); // noon in India on 2026-10-07
const TODAY = '2026-10-07';
const ADMIN = 'akshatg9636@gmail.com';
const RAHUL = { email: 'rahul@gmail.com', name: 'Rahul' };

/** Free mode on with a daily limit of `n`, on Claude, with any other choices in `extra`. */
const freeDaily = (n, extra = {}) => ({
  enabled: true, limitMode: 'daily', dailyRequests: n, allowOwnKey: false, provider: 'anthropic', model: 'claude-x', ...extra,
});
const userDoc = (extra = {}) => ({ ...RAHUL, joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0, ...extra });
const refusal = (status, code, message) => ({ status, body: { error: { code, message } } });

const TOKENS = {
  user: { uid: 'u1', ...RAHUL, emailVerified: true },
  admin: { uid: 'a1', email: ADMIN, name: 'Akshat', emailVerified: true },
  unverified: { uid: 'u2', email: 'x@gmail.com', name: 'X', emailVerified: false },
};

/**
 * The handlers with fakes: an in-memory database, one fake provider whatever the id, the server's keys in `keys`,
 * and three ID tokens: 'user', 'admin' and 'unverified'. `run(handler, method, { token, body, query })`.
 */
function setup({
  stored = null, users = {}, keys = { anthropic: 'admin-key' }, vision = true, reply = 'An answer', fail = null,
  live = ['m-1', 'm-2'], listFails = false,
} = {}) {
  const db = fakeDb({ config: stored, users });
  const completes = [];
  const lists = [];
  const provider = {
    isVisionModel: () => vision,
    async complete(opts) {
      completes.push(opts);
      if (fail) throw fail;
      return { text: reply, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels(opts) {
      lists.push(opts);
      if (listFails) throw new BuddyError('bad_key', 'Your Claude key was rejected. Check it in Settings.');
      return live;
    },
  };
  const deps = {
    async verifyToken(token) {
      if (!Object.hasOwn(TOKENS, token)) throw new Error('not a token');
      return TOKENS[token];
    },
    db,
    providers: { getProvider: () => provider },
    adminKeys: keys,
    adminEmail: ADMIN,
    now: () => NOW,
  };
  const run = (handler, method, { token = 'user', body, query } = {}) => handle(handler, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    query,
  }, deps);
  return { db, completes, lists, run };
}

// ---- signing in ----

test('every route wants a valid ID token for a verified email', async () => {
  const s = setup();
  for (const handler of [config, ask, adminSettings, adminModels, adminUsers]) {
    const method = handler === ask ? 'POST' : 'GET';
    assert.deepStrictEqual(await s.run(handler, method, { token: null }), refusal(401, 'unauthenticated', 'Sign in to use Buddy.'));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'forged' }),
      refusal(401, 'unauthenticated', 'Your sign-in has expired. Sign in again.'));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'unverified' }),
      refusal(401, 'unauthenticated', 'Sign in with a Google account whose email is verified.'));
  }
  assert.deepStrictEqual(s.db.state.calls, [], 'nothing was read or written');
});

test('a method a route does not take is refused', async () => {
  const s = setup();
  for (const [handler, method] of [[config, 'POST'], [ask, 'GET'], [adminSettings, 'DELETE'], [adminModels, 'POST'], [adminUsers, 'PUT']]) {
    assert.deepStrictEqual(await s.run(handler, method), refusal(405, 'method_not_allowed', 'Not allowed.'));
  }
});

test('the admin routes are for the admin only', async () => {
  const s = setup();
  for (const [handler, method] of [[adminSettings, 'GET'], [adminSettings, 'PUT'], [adminModels, 'GET'], [adminUsers, 'GET'], [adminUsers, 'POST']]) {
    assert.deepStrictEqual(await s.run(handler, method, { body: { enabled: true } }), refusal(403, 'not_admin', 'Only the admin can do this.'));
  }
  assert.deepStrictEqual(s.db.state.calls, []);
});

// ---- GET /api/config ----

test('config: the first call adds the user, and with nothing saved free mode is off', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(config, 'GET'), {
    status: 200,
    body: { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false },
  });
  assert.deepStrictEqual(s.db.state.users.u1, userDoc());
});

test("config: free mode on, today's count, and own keys allowed", async () => {
  const s = setup({ stored: freeDaily(5, { allowOwnKey: true }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 3, lastActive: NOW }) } });
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 5, usedToday: 3, allowOwnKey: true, blocked: false, isAdmin: false,
  });
});

test("config: yesterday's count is not today's; unlimited has no limit and no own keys", async () => {
  const s = setup({
    stored: freeDaily(5, { limitMode: 'unlimited', allowOwnKey: true }),
    users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 9 }) },
  });
  const { body } = await s.run(config, 'GET');
  assert.deepStrictEqual([body.limitMode, body.limit, body.usedToday, body.allowOwnKey], ['unlimited', null, 0, false]);
});

test('config: switched on with no server key for its provider counts as off', async () => {
  const s = setup({ stored: freeDaily(5), keys: { openai: 'k' } });
  assert.strictEqual((await s.run(config, 'GET')).body.freeOn, false);
});

test('config: says who is blocked and who is the admin', async () => {
  const s = setup({ users: { u1: userDoc({ blocked: true }) } });
  assert.strictEqual((await s.run(config, 'GET')).body.blocked, true);
  assert.strictEqual((await s.run(config, 'GET', { token: 'admin' })).body.isAdmin, true);
});

// ---- POST /api/ask ----

test("ask: counts the request, then answers with the admin's key, the chosen model and the token cap", async () => {
  const s = setup({ stored: freeDaily(5) });
  const r = await s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.deepStrictEqual(r, { status: 200, body: { text: 'An answer', model: 'claude-x' } });
  const [call] = s.completes;
  assert.deepStrictEqual([call.apiKey, call.model, call.user, call.maxTokens], ['admin-key', 'claude-x', 'me go home', 1024]);
  assert.ok(call.signal instanceof AbortSignal, 'the AI gets a deadline');
  assert.deepStrictEqual(s.db.state.users.u1, userDoc({ usedDay: TODAY, usedCount: 1, lastActive: NOW }));
});

test('ask: the daily limit is kept, and nothing is asked of the AI past it', async () => {
  const s = setup({ stored: freeDaily(2) });
  const fix = () => s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.strictEqual((await fix()).status, 200);
  assert.strictEqual((await fix()).status, 200);
  assert.deepStrictEqual(await fix(), refusal(429, 'free_limit', "You've used today's 2 free requests. They come back at midnight."));
  assert.strictEqual(s.completes.length, 2);
  assert.strictEqual(s.db.state.users.u1.usedCount, 2);
});

test('ask: a new day starts again from zero', async () => {
  const s = setup({ stored: freeDaily(2), users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 2 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.deepStrictEqual([s.db.state.users.u1.usedDay, s.db.state.users.u1.usedCount], [TODAY, 1]);
});

test('ask: unlimited still counts, and never refuses', async () => {
  const s = setup({ stored: freeDaily(2, { limitMode: 'unlimited' }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 500 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.strictEqual(s.db.state.users.u1.usedCount, 501);
});

test('ask: a blocked user is refused, and nothing is counted or asked', async () => {
  const s = setup({ stored: freeDaily(5), users: { u1: userDoc({ blocked: true }) } });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), refusal(403, 'blocked', 'Your free access is paused.'));
  assert.strictEqual(s.completes.length, 0);
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
});

test('ask: free mode off, or no server key for its provider, is free_off', async () => {
  const off = refusal(403, 'free_off', 'Free AI is off. Add your own key in Settings.');
  const s1 = setup();
  assert.deepStrictEqual(await s1.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  const s2 = setup({ stored: freeDaily(5), keys: { groq: 'k' } });
  assert.deepStrictEqual(await s2.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  assert.deepStrictEqual([s1.db.state.users, s2.db.state.users], [{}, {}], 'nobody was counted');
});

test('ask: input that is not valid is refused with the same words as in the app, before anything is read', async () => {
  const s = setup({ stored: freeDaily(5) });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'write', instruction: '  ' } }),
    refusal(400, 'bad_request', 'Tell me what to write first.'));
  assert.strictEqual((await s.run(ask, 'POST', { body: 'not an object' })).status, 400);
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x'.repeat(8001) } })).status, 400);
  assert.deepStrictEqual(s.db.state.calls, [], 'not even the settings were read');
});

test('ask: a screenshot for a model that cannot see is refused, and not counted', async () => {
  const s = setup({ stored: freeDaily(5), vision: false });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG' } }),
    refusal(400, 'free_no_vision', "The free AI can't read screenshots right now."));
  assert.deepStrictEqual(s.db.state.users, {});
});

test('ask: when the AI fails the request is given back, and the user hears it in plain words', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ stored: freeDaily(5), fail: new BuddyError('rate_limited', 'Claude is busy right now. Try again in a minute.') });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'my secret text' } }),
    refusal(502, 'upstream', "Buddy couldn't answer. Try again."));
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
  assert.deepStrictEqual(s.db.state.calls.filter((c) => c !== 'getConfig'), ['countRequest', 'refundRequest']);
  const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /\[ask\] anthropic failed: rate_limited/);
  assert.doesNotMatch(logged, /secret/, 'what the user sent is never logged');
});

test('ask: a Check answer comes back read as well', async () => {
  const s = setup({ stored: freeDaily(5), reply: '{"verdict":"good","problems":[],"corrected":null}' });
  const r = await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG', instruction: 'ok?' } });
  assert.deepStrictEqual(r.body.check, { verdict: 'good', problems: [], corrected: null });
});

// ---- the admin's switches ----

test('admin settings: with nothing saved, the defaults, and which providers have a key on the server', async () => {
  const s = setup({ keys: { anthropic: 'k', groq: 'g' } });
  const r = await s.run(adminSettings, 'GET', { token: 'admin' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.config, {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  });
  assert.deepStrictEqual(r.body.providers.map((p) => [p.id, p.label, p.hasKey]), [
    ['anthropic', 'Claude (Anthropic)', true], ['openai', 'OpenAI', false], ['gemini', 'Google Gemini', false], ['groq', 'Groq', true],
  ]);
  assert.deepStrictEqual(r.body.providers[3].fallbackModels, PROVIDERS.groq.fallbackModels);
});

test('admin settings: a change is saved and every user sees it; a refused one changes nothing', async () => {
  const s = setup();
  const saved = await s.run(adminSettings, 'PUT', { token: 'admin', body: { enabled: true, dailyRequests: 10, allowOwnKey: true } });
  assert.strictEqual(saved.status, 200);
  const expected = {
    enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  };
  assert.deepStrictEqual(saved.body.config, expected);
  assert.deepStrictEqual(s.db.state.config, expected);
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 10, usedToday: 0, allowOwnKey: true, blocked: false, isAdmin: false,
  });

  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { dailyRequests: 0 } }),
    refusal(400, 'bad_request', 'The daily limit must be a whole number from 1 to 10000.'));
  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { provider: 'openai' } }),
    refusal(400, 'bad_request', "There is no OpenAI key on the server, so free mode can't use it."));
  assert.deepStrictEqual(s.db.state.config, expected);
});

test("admin models: the live list for the server's key", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query: { provider: 'anthropic' } }),
    { status: 200, body: { models: ['m-1', 'm-2'], live: true } });
  assert.strictEqual(s.lists[0].apiKey, 'admin-key');
});

test('admin models: the usual list when the server has no key, the key lists nothing, or the listing fails', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const usual = PROVIDERS.openai.fallbackModels;
  const list = (options) => setup(options).run(adminModels, 'GET', { token: 'admin', query: { provider: 'openai' } });
  assert.deepStrictEqual((await list({})).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, live: [] })).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, listFails: true })).body, {
    models: usual, live: false, warning: "Couldn't load the model list for the server's OpenAI key. Showing the usual models.",
  });
});

test('admin models: only real providers', async () => {
  const s = setup();
  for (const query of [{ provider: 'constructor' }, {}, undefined]) {
    assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query }), refusal(400, 'bad_request', 'Unknown AI provider.'));
  }
});

// ---- the users list ----

test('admin users: busiest today first, then the most recently active, with dates as ISO text', async () => {
  const at = (iso) => new Date(iso);
  const s = setup({ users: {
    a: userDoc({ email: 'a@x.com', name: 'A', lastActive: at('2026-10-07T05:00:00Z'), usedDay: TODAY, usedCount: 2 }),
    b: userDoc({ email: 'b@x.com', name: 'B', lastActive: at('2026-10-07T01:00:00Z'), usedDay: TODAY, usedCount: 7 }),
    c: userDoc({ email: 'c@x.com', name: 'C', lastActive: at('2026-10-06T12:00:00Z'), usedDay: '2026-10-06', usedCount: 50 }),
    d: userDoc({ email: 'd@x.com', name: 'D' }),
  } });
  const r = await s.run(adminUsers, 'GET', { token: 'admin' });
  assert.deepStrictEqual(r.body.users.map((u) => [u.uid, u.usedToday]), [['b', 7], ['a', 2], ['c', 0], ['d', 0]]);
  assert.deepStrictEqual(r.body.users[0], {
    uid: 'b', email: 'b@x.com', name: 'B', joined: NOW.toISOString(), lastActive: '2026-10-07T01:00:00.000Z', blocked: false, usedToday: 7,
  });
  assert.strictEqual(r.body.users[3].lastActive, null);
});

test('admin users: block and unblock', async () => {
  const s = setup({ users: { u1: userDoc() } });
  const blocked = await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual([blocked.status, blocked.body.user.uid, blocked.body.user.blocked], [200, 'u1', true]);
  assert.strictEqual(s.db.state.users.u1.blocked, true);
  await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: false } });
  assert.strictEqual(s.db.state.users.u1.blocked, false);
});

test('admin users: someone who is not there, or a request that is not valid', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'nobody', blocked: true } }),
    refusal(404, 'not_found', 'That user was not found.'));
  for (const body of [undefined, { uid: 'u1' }, { uid: '', blocked: true }, { uid: 7, blocked: true },
    { uid: 'x'.repeat(129), blocked: true }, { uid: 'u1', blocked: 'yes' }]) {
    assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body }),
      refusal(400, 'bad_request', 'Pick a user to block or unblock.'), JSON.stringify(body));
  }
});

// ---- anything else ----

test('a failure nobody planned for is a 500 in plain words, and it is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const r = await handle(async () => { throw new TypeError('boom'); }, { method: 'GET', headers: {} }, {});
  assert.deepStrictEqual(r, refusal(500, 'server', "Buddy's server had a problem. Try again."));
  assert.strictEqual(error.mock.callCount(), 1);
});
