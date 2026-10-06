'use strict';

const test = require('node:test');
const assert = require('node:assert');
// The server's own copy: web/lib/handlers.js turns only ITS BuddyError (web/shared/errors.js) into a status.
const { BuddyError } = require('../web/shared/errors');
const { toVercel } = require('../web/lib/vercel');
const { adminKeysFrom } = require('../web/lib/deps');

/** Just enough of Vercel's response object. */
function fakeRes() {
  const res = { statusCode: null, headers: {}, body: undefined };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('a handler answers through Vercel with its status, its JSON and no caching', async () => {
  const seen = [];
  const fn = toVercel(async (req, deps) => { seen.push([req, deps]); return { status: 201, body: { hi: 1 } }; }, () => 'DEPS');
  const res = fakeRes();
  await fn({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { a: 1 }, query: { q: '1' } }, res);
  assert.deepStrictEqual([res.statusCode, res.body, res.headers['cache-control']], [201, { hi: 1 }, 'no-store']);
  assert.deepStrictEqual(seen, [[{ method: 'POST', headers: { authorization: 'Bearer t' }, body: { a: 1 }, query: { q: '1' } }, 'DEPS']]);
});

test('a body that is not valid JSON reaches the handler as no body', async () => {
  let got = 'unset';
  const fn = toVercel(async (req) => { got = req.body; return { status: 200, body: {} }; }, () => ({}));
  const req = { method: 'POST', headers: {}, query: {} };
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Invalid JSON'); } });
  await fn(req, fakeRes());
  assert.strictEqual(got, undefined);
});

test("a handler's refusal keeps its status; a server that cannot start answers 500 in plain words", async (t) => {
  t.mock.method(console, 'error', () => {});
  const refused = toVercel(async () => { throw new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.'); }, () => ({}));
  const res = fakeRes();
  await refused({ method: 'GET', headers: {} }, res);
  assert.deepStrictEqual([res.statusCode, res.body], [403, { error: { code: 'free_off', message: 'Free AI is off. Add your own key in Settings.' } }]);

  const broken = toVercel(async () => ({ status: 200, body: {} }), () => { throw new Error('FIREBASE_SERVICE_ACCOUNT is not set'); });
  const res2 = fakeRes();
  await broken({ method: 'GET', headers: {} }, res2);
  assert.deepStrictEqual([res2.statusCode, res2.body], [500, { error: { code: 'server', message: "Buddy's server had a problem. Try again." } }]);
});

test('the server keys come from the environment, trimmed, and only the ones that are set', () => {
  assert.deepStrictEqual(adminKeysFrom({ ANTHROPIC_API_KEY: ' sk-a \n', OPENAI_API_KEY: '', GROQ_API_KEY: 'gsk' }), { anthropic: 'sk-a', groq: 'gsk' });
  assert.deepStrictEqual(adminKeysFrom({}), {});
});

test('every API route is a function', () => {
  for (const file of ['config', 'ask', 'admin/settings', 'admin/models', 'admin/users']) {
    assert.strictEqual(typeof require(`../web/api/${file}`), 'function', file);
  }
});
