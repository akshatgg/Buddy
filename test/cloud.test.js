'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createCloud, readSettings, FRESH_MS } = require('../src/main/cloud');

const CONFIG = { serverUrl: 'https://buddy.example', firebaseApiKey: 'k', googleClientId: 'c', googleClientSecret: 's' };
const SETTINGS = { freeOn: true, limitMode: 'daily', limit: 30, usedToday: 2, allowOwnKey: false, blocked: false, isAdmin: false };
const ok = (body) => ({ status: 200, body });

/**
 * createCloud with fakes. `answers` are what the server gives, in turn: { status, body } (no body: not JSON), or an
 * Error the fetch throws; with none left the fetch fails like no internet. The account hands out 'token', or
 * 'fresh-token' when asked to renew. `kept` is what the store holds from an earlier run.
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
    const next = answers.shift();
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
  const s = setup({ answers: [ok({ text: 'Fixed', model: 'claude-x', check })] });
  const signal = AbortSignal.timeout(60_000);
  assert.deepStrictEqual(await s.cloud.ask('check', { image: 'IMG', instruction: 'ok?', text: undefined }, { signal }),
    { text: 'Fixed', model: 'claude-x', check });
  const [req] = s.requests;
  assert.deepStrictEqual([req.url, req.method, req.body], ['https://buddy.example/api/ask', 'POST', { action: 'check', image: 'IMG', instruction: 'ok?' }]);
  assert.strictEqual(req.headers['content-type'], 'application/json');
  assert.strictEqual(req.signal, signal);
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
