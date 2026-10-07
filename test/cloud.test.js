'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createCloud, readSettings, FRESH_MS, CONFIG_TIMEOUT_MS, SERVER_CODES } = require('../src/main/cloud');
const { STATUS } = require('../web/lib/handlers');

const CONFIG = { serverUrl: 'https://buddy.example', firebaseApiKey: 'k', googleClientId: 'c', googleClientSecret: 's' };
const SETTINGS = { freeOn: true, limitMode: 'daily', limit: 30, usedToday: 2, allowOwnKey: false, blocked: false, isAdmin: false };
const ok = (body) => ({ status: 200, body });
const SERVER_PROBLEM = { code: 'server', message: "Buddy's server had a problem. Try again." };
// What the hosting platform answers for a path it does not know, in JSON of its own.
const PLATFORM_404 = { status: 404, body: { error: { code: 'NOT_FOUND', message: 'The page could not be found.' } } };

/**
 * createCloud with fakes. `answers` are what the server gives, in turn: { status, body } (no body: not JSON, like an
 * HTML page), a promise of one (an answer that is held back), or an Error the fetch throws; with none left the fetch
 * fails like no internet. The account hands out 'token', or 'fresh-token' when asked to renew. `kept` is what the
 * store holds from an earlier run.
 */
function setup({ answers = [], kept = null, config = CONFIG } = {}) {
  const requests = [];
  const tokens = [];
  const clock = { t: 5_000_000 };
  const data = { cloud: kept };
  let signedOut = 0;
  let changes = 0;
  const store = { get: (key) => data[key], set: (patch) => Object.assign(data, patch) };
  const account = {
    async idToken({ force }) {
      tokens.push(force);
      return force ? 'fresh-token' : 'token';
    },
    signOut: () => { signedOut += 1; },
  };
  async function fetchImpl(url, init) {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal });
    const next = await answers.shift();
    if (!next) throw new TypeError('fetch failed');
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return next.body;
      },
    };
  }
  const cloud = createCloud({ config, account, store, fetchImpl, now: () => clock.t });
  cloud.onChange(() => { changes += 1; });
  return { cloud, requests, tokens, clock, data, signedOut: () => signedOut, changes: () => changes };
}

test('settings: fetched with the ID token, kept in the store in a tidy shape, and announced', async () => {
  const s = setup({ answers: [ok({ ...SETTINGS, extra: 'x', limit: 30.5, usedToday: 'two' })] });
  const got = await s.cloud.settings();
  assert.deepStrictEqual(got, { ...SETTINGS, limit: null, usedToday: 0 });
  assert.deepStrictEqual(s.data.cloud, got);
  assert.deepStrictEqual([s.requests[0].url, s.requests[0].method], ['https://buddy.example/api/config', 'GET']);
  assert.deepStrictEqual(s.requests[0].headers, { authorization: 'Bearer token' });
  assert.strictEqual(s.changes(), 1);
});

test('readSettings: anything missing or odd reads as off', () => {
  const off = { freeOn: false, limitMode: 'daily', limit: null, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };
  assert.deepStrictEqual(readSettings(null), off);
  assert.deepStrictEqual(readSettings({ freeOn: 'yes', limitMode: 'unlimited', isAdmin: 1 }), { ...off, limitMode: 'unlimited' });
});

test('settings: fetched at most once a minute, unless forced', async () => {
  const s = setup({ answers: [ok(SETTINGS), ok({ ...SETTINGS, usedToday: 3 }), ok({ ...SETTINGS, usedToday: 4 })] });
  await s.cloud.settings();
  s.clock.t += FRESH_MS - 1;
  assert.strictEqual((await s.cloud.settings()).usedToday, 2, 'the kept ones');
  assert.strictEqual((await s.cloud.settings({ force: true })).usedToday, 3);
  s.clock.t += FRESH_MS;
  assert.strictEqual((await s.cloud.settings()).usedToday, 4);
  assert.strictEqual(FRESH_MS, 60_000);
});

test('settings: when the server cannot be reached, the last known ones (from an earlier run too), or null', async () => {
  assert.deepStrictEqual(await setup({ kept: SETTINGS }).cloud.settings(), SETTINGS);
  assert.strictEqual(await setup().cloud.settings(), null);
  assert.deepStrictEqual(await setup({ answers: [{ status: 500 }], kept: SETTINGS }).cloud.settings(), SETTINGS,
    'a server that falls over is like no server');
  assert.deepStrictEqual(await setup({ answers: [{ status: 503, body: { error: SERVER_PROBLEM } }], kept: SETTINGS }).cloud.settings(), SETTINGS,
    'nor is a server that could not check the sign-in');
  assert.deepStrictEqual(await setup({ answers: [PLATFORM_404], kept: SETTINGS }).cloud.settings(), SETTINGS,
    "nor is the hosting platform's own error answer");
});

test('settings: a server that cannot be reached, or hangs, is not asked again for a minute, unless forced', async () => {
  const slow = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  const s = setup({ answers: [slow], kept: SETTINGS }); // then no answers at all: like no internet
  assert.deepStrictEqual(await s.cloud.settings(), SETTINGS);
  s.clock.t += FRESH_MS - 1;
  assert.deepStrictEqual(await s.cloud.settings(), SETTINGS, 'the last known ones, at once');
  assert.strictEqual(s.requests.length, 1, 'not asked again');
  assert.deepStrictEqual(await s.cloud.settings({ force: true }), SETTINGS);
  assert.strictEqual(s.requests.length, 2, 'force still asks');
  s.clock.t += FRESH_MS;
  await s.cloud.settings();
  assert.strictEqual(s.requests.length, 3, 'a minute later, it is asked again');
});

test('settings: only kept settings hold off the next try; a server never reached is asked again at once', async () => {
  const slow = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  for (const failure of [slow, new TypeError('fetch failed'), { status: 500 }]) {
    const never = setup({ answers: [failure, ok(SETTINGS)] });
    assert.strictEqual(await never.cloud.settings(), null, 'nothing was ever kept, so there is nothing to go on with');
    never.clock.t += FRESH_MS - 1;
    assert.deepStrictEqual(await never.cloud.settings(), SETTINGS, 'asked again within the minute, and this time answered');
    assert.strictEqual(never.requests.length, 2);
  }

  const kept = setup({ answers: [slow, ok({ ...SETTINGS, usedToday: 9 })], kept: SETTINGS });
  assert.deepStrictEqual(await kept.cloud.settings(), SETTINGS);
  kept.clock.t += FRESH_MS - 1;
  assert.deepStrictEqual(await kept.cloud.settings(), SETTINGS, 'the kept ones, at once');
  assert.strictEqual(kept.requests.length, 1, 'not asked again within the minute');
});

test('settings: their call has a deadline of its own, shorter than the other calls have', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout');
  const s = setup({ answers: [ok(SETTINGS), ok({ users: [] })] });
  await s.cloud.settings();
  await s.cloud.admin.users();
  assert.deepStrictEqual(timeout.mock.calls.map((c) => c.arguments[0]), [CONFIG_TIMEOUT_MS, 30_000]);
  assert.strictEqual(timeout.mock.calls[0].result, s.requests[0].signal, 'the settings fetch got that deadline');
  assert.strictEqual(CONFIG_TIMEOUT_MS, 8_000);
});

test('a token the server turns down is renewed once; turned down again, the person is signed out', async () => {
  const s = setup({ answers: [{ status: 401, body: {} }, ok(SETTINGS)] });
  assert.deepStrictEqual(await s.cloud.settings(), SETTINGS);
  assert.deepStrictEqual(s.tokens, [false, true]);
  assert.strictEqual(s.requests[1].headers.authorization, 'Bearer fresh-token');

  const twice = setup({ answers: [
    { status: 401, body: {} },
    { status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in with a Google account whose email is verified.' } } },
  ] });
  await assert.rejects(twice.cloud.settings(), { code: 'signed_out', message: 'Sign in with a Google account whose email is verified.' });
  assert.strictEqual(twice.signedOut(), 1);
});

test("a second 401 that is not Buddy's own answer (a hosting page, an unknown answer) signs nobody out", async () => {
  for (const body of [
    undefined, // an HTML page, such as Vercel's Deployment Protection
    { error: { code: 'NOT_AUTHORIZED', message: 'You are not authorized.' } },
    { error: 'unauthenticated' },
    { error: { code: 'unauthenticated' } }, // no message: not Buddy's
  ]) {
    const what = JSON.stringify(body) ?? 'not JSON';
    const s = setup({ answers: [{ status: 401, body }, { status: 401, body }] });
    await assert.rejects(s.cloud.ask('fix', { text: 'x' }), SERVER_PROBLEM, what);
    assert.strictEqual(s.signedOut(), 0, what);
    assert.deepStrictEqual(s.tokens, [false, true], `${what}: the token was renewed once`);
  }
  const kept = setup({ answers: [{ status: 401 }, { status: 401 }], kept: SETTINGS });
  assert.deepStrictEqual(await kept.cloud.settings(), SETTINGS, 'the settings fall back to the last known ones');
  assert.strictEqual(kept.signedOut(), 0);
});

test("only the codes Buddy's server sends are taken as its own; any other error answer is a server problem", async () => {
  const s = setup({ answers: [
    PLATFORM_404,
    { status: 400, body: { error: { code: 'BAD_REQUEST', message: 'Invalid request.' } } },
    { status: 503, body: { error: SERVER_PROBLEM } },
  ] });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), SERVER_PROBLEM, 'the platform cannot find the path');
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), SERVER_PROBLEM, 'a code the server never sends');
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), SERVER_PROBLEM, "the server's own words for its own problem");
});

test("the codes the app takes as the server's own are exactly the ones web/lib/handlers.js sends", () => {
  const sent = new Set([...Object.keys(STATUS), 'server']); // `server` is also what handle() answers for a failure of its own
  assert.deepStrictEqual([...SERVER_CODES].sort(), [...sent].sort());
});

test("the server's refusals come through in its own words; anything else in Buddy's", async () => {
  const s = setup({ answers: [
    { status: 429, body: { error: { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." } } },
    { status: 502, body: 'not an error object' },
    { status: 200 },
  ] });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'server', message: "Buddy's server had a problem. Try again." });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'server' }, 'an answer that is not JSON');
});

test('ask: posts the action with only the inputs it has, under the deadline it is given', async () => {
  const check = { verdict: 'good', problems: [], corrected: null };
  const text = JSON.stringify(check);
  const s = setup({ answers: [ok({ text, model: 'claude-x', check })] });
  const signal = AbortSignal.timeout(60_000);
  assert.deepStrictEqual(await s.cloud.ask('check', { image: 'IMG', instruction: 'ok?', text: undefined }, { signal }),
    { text, model: 'claude-x', check });
  const [req] = s.requests;
  assert.deepStrictEqual([req.url, req.method, req.body], ['https://buddy.example/api/ask', 'POST', { action: 'check', image: 'IMG', instruction: 'ok?' }]);
  assert.strictEqual(req.headers['content-type'], 'application/json');
  assert.strictEqual(req.signal, signal);
});

test("ask: a Check answer is read here, from its text, as on the own-key route: the server's reading never reaches the panel", async () => {
  const text = '```json\n{"verdict":"problems","problems":["A typo", 7],"corrected":"Fixed"}\n```';
  const s = setup({ answers: [
    ok({ text, model: 'm', check: { verdict: 'good', problems: 'not a list' } }),
    ok({ text: 'Not JSON at all', model: 'm' }),
    ok({ text: 'Fixed', model: 'm', check: { verdict: 'good', problems: [] } }),
  ] });
  assert.deepStrictEqual(await s.cloud.ask('check', { image: 'IMG' }),
    { text, model: 'm', check: { verdict: 'problems', problems: ['A typo'], corrected: 'Fixed' } });
  assert.deepStrictEqual(await s.cloud.ask('check', { image: 'IMG' }), { text: 'Not JSON at all', model: 'm', check: { raw: 'Not JSON at all' } });
  assert.deepStrictEqual(await s.cloud.ask('fix', { text: 'x' }), { text: 'Fixed', model: 'm' }, 'only a Check has one');
});

test('ask: a chat posts every chat input it has, and nothing else', async () => {
  const input = {
    message: 'fix my English',
    selection: 'me go home',
    box: 'Dear sir, i will not come.',
    image: 'IMG',
    history: [{ from: 'you', text: 'hi' }, { from: 'buddy', text: 'Hi Rahul! What should we do?' }],
    facts: ['Your boss is Mr. Sharma.'],
    appName: 'Gmail',
    userName: 'Rahul',
    step: 2,
  };
  const s = setup({ answers: [ok({ text: '{"kind":"answer","say":"Hi!"}', model: 'm' }), ok({ text: 'x', model: 'm' })] });
  await s.cloud.ask('chat', { ...input, secret: 'not for the server', tone: undefined });
  assert.deepStrictEqual(s.requests[0].body, { action: 'chat', ...input });
  await s.cloud.ask('chat', { message: 'hi', selection: undefined });
  assert.deepStrictEqual(s.requests[1].body, { action: 'chat', message: 'hi' }, 'only the inputs it has');
});

test("ask: a chat answer is read here, from its text, as on the own-key route: the server's reading never reaches the panel", async () => {
  const chat = { kind: 'fix', say: 'Ho gaya!', text: 'I am going home.', notes: ['"go" → "going"'], doIt: true, send: false, remember: [] };
  const text = `\`\`\`json\n${JSON.stringify(chat)}\n\`\`\``;
  const s = setup({ answers: [
    ok({ text, model: 'm', chat: { kind: 'send', say: 'not this' } }),
    ok({ text: 'Dear Sir,', model: 'm' }),
  ] });
  assert.deepStrictEqual(await s.cloud.ask('chat', { message: 'fix this' }), { text, model: 'm', chat });
  assert.deepStrictEqual(await s.cloud.ask('chat', { message: 'leave mail' }), {
    text: 'Dear Sir,', model: 'm', chat: { kind: 'write', say: '', text: 'Dear Sir,', notes: [], doIt: false, send: false, remember: [] },
  });
});

test('no internet, a server that takes too long, and a cancelled request', async () => {
  await assert.rejects(setup().cloud.ask('fix', { text: 'x' }), { code: 'network', message: "Couldn't reach Buddy's server. Check your internet." });
  const slow = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  await assert.rejects(setup({ answers: [slow] }).cloud.ask('fix', { text: 'x' }),
    { code: 'timeout', message: "Buddy's server took too long to answer. Try again." });
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(setup({ answers: [abort] }).cloud.ask('fix', { text: 'x' }), { name: 'AbortError' });
});

test('forget empties the kept settings and says so', () => {
  const s = setup({ kept: SETTINGS });
  s.cloud.forget();
  assert.strictEqual(s.cloud.last(), null);
  assert.strictEqual(s.data.cloud, null);
  assert.strictEqual(s.changes(), 1);
});

test('settings that arrive after forget() are not kept: they belong to the person who was forgotten', async () => {
  let answer = null;
  const held = new Promise((resolve) => {
    answer = () => resolve(ok({ ...SETTINGS, isAdmin: true }));
  });
  const s = setup({ answers: [held], kept: SETTINGS });
  const pending = s.cloud.settings({ force: true });
  await new Promise((resolve) => setImmediate(resolve)); // the fetch is under way
  s.cloud.forget();
  answer();
  assert.strictEqual(await pending, null, 'the last known settings, which are none now');
  assert.strictEqual(s.data.cloud, null, 'nothing was kept');
  assert.strictEqual(s.changes(), 1, 'only forget() said that the settings changed');
  await s.cloud.settings();
  assert.strictEqual(s.requests.length, 2, 'the next call asks the server again');
});

test('a settings listener that throws does not stop the others, or the settings from being kept; only its kind is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const s = setup({ answers: [ok(SETTINGS)] });
  let heard = 0;
  s.cloud.onChange(() => { throw Object.assign(new Error('a detail that must stay out of the log'), { code: 'EBROKEN' }); });
  s.cloud.onChange(() => { throw new TypeError('another detail'); });
  s.cloud.onChange(() => { heard += 1; });
  assert.deepStrictEqual(await s.cloud.settings(), SETTINGS);
  assert.deepStrictEqual(s.data.cloud, SETTINGS);
  s.cloud.forget();
  assert.strictEqual(heard, 2, 'the listener after the broken ones heard both changes');
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments.join(' ')), [
    '[buddy] a settings listener failed: EBROKEN',
    '[buddy] a settings listener failed: TypeError',
    '[buddy] a settings listener failed: EBROKEN',
    '[buddy] a settings listener failed: TypeError',
  ]);
});

test("the admin's calls", async () => {
  const s = setup({ answers: [ok({ config: {}, providers: [] }), ok({ config: {} }), ok({ models: [] }), ok({ users: [] }), ok({ user: {} })] });
  await s.cloud.admin.settings();
  await s.cloud.admin.save({ enabled: true });
  await s.cloud.admin.models('a b');
  await s.cloud.admin.users();
  await s.cloud.admin.block('u1', true);
  assert.deepStrictEqual(s.requests.map((r) => [r.method, r.url.replace('https://buddy.example', ''), r.body]), [
    ['GET', '/api/admin/settings', undefined],
    ['PUT', '/api/admin/settings', { enabled: true }],
    ['GET', '/api/admin/models?provider=a%20b', undefined],
    ['GET', '/api/admin/users', undefined],
    ['POST', '/api/admin/users', { uid: 'u1', blocked: true }],
  ]);
});

test('a copy of Buddy with no cloud.json calls nothing', async () => {
  const s = setup({ config: null, kept: SETTINGS });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'not_set_up' });
  await assert.rejects(s.cloud.settings(), { code: 'not_set_up' }, 'not a reason to fall back to the kept settings');
  assert.deepStrictEqual([s.requests, s.tokens], [[], []]);
});
