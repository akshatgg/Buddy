'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
// The server's own copy: web/lib/handlers.js turns only ITS BuddyError (web/shared/errors.js) into a status.
const { BuddyError } = require('../web/shared/errors');
const { toVercel } = require('../web/lib/vercel');
const { adminKeysFrom, realDeps, credentialFrom, whoFrom } = require('../web/lib/deps');

/** Just enough of Vercel's response object. */
function fakeRes() {
  const res = { statusCode: null, headers: {}, body: undefined };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

const SERVER_PROBLEM = { error: { code: 'server', message: "Buddy's server had a problem. Try again." } };

/** What a mocked console method was called with, one string per call. */
const logged = (mock) => mock.mock.calls.map((c) => c.arguments.join(' '));

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

test("a handler's refusal keeps its status; a server that cannot start answers 500 in plain words and logs only the kind of failure", async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const refused = toVercel(async () => { throw new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.'); }, () => ({}));
  const res = fakeRes();
  await refused({ method: 'GET', headers: {} }, res);
  assert.deepStrictEqual([res.statusCode, res.body], [403, { error: { code: 'free_off', message: 'Free AI is off. Add your own key in Settings.' } }]);

  // Their messages quote the service account key, as those of JSON.parse and firebase-admin do for a bad one.
  const quoted = '{"private_key":"SECRET-MARKER"}';
  const failures = [Object.assign(new Error(quoted), { code: 'bad_service_account' }), new SyntaxError(`Unexpected token in "${quoted}"`)];
  for (const failure of failures) {
    const broken = toVercel(async () => ({ status: 200, body: {} }), () => { throw failure; });
    const res2 = fakeRes();
    await broken({ method: 'GET', headers: {} }, res2);
    assert.deepStrictEqual([res2.statusCode, res2.body], [500, SERVER_PROBLEM]);
  }
  assert.deepStrictEqual(logged(error), ['[api] could not start: bad_service_account', '[api] could not start: SyntaxError']);
  assert.doesNotMatch(logged(error).join('\n'), /SECRET-MARKER/, 'the key is never logged');
});

// ---- the service account key ----

const GOOD_KEY = {
  type: 'service_account',
  project_id: 'p',
  client_email: 'x@p.iam.gserviceaccount.com',
  private_key: '-----BEGIN PRIVATE KEY-----\nSECRET-MARKER\n-----END PRIVATE KEY-----\n',
};
const NOT_SET = 'FIREBASE_SERVICE_ACCOUNT is not set';
const NOT_A_KEY = 'FIREBASE_SERVICE_ACCOUNT is not a service account key';

test('a service account key that is missing or is not a key is refused with a code and a fixed message, never the value', () => {
  const cases = [
    ['not set', undefined, 'no_service_account', NOT_SET],
    ['empty', '', 'no_service_account', NOT_SET],
    ['not JSON', 'akshat-key', 'bad_service_account', NOT_A_KEY],
    ['JSON encoded twice, so it parses to a string', JSON.stringify(JSON.stringify(GOOD_KEY)), 'bad_service_account', NOT_A_KEY],
    ['an object without the key fields', '{"type":"service_account"}', 'bad_service_account', NOT_A_KEY],
    ['an object without a private_key', JSON.stringify({ client_email: GOOD_KEY.client_email }), 'bad_service_account', NOT_A_KEY],
    ['an object whose private_key is not text', JSON.stringify({ client_email: GOOD_KEY.client_email, private_key: 5 }), 'bad_service_account', NOT_A_KEY],
    ['null', 'null', 'bad_service_account', NOT_A_KEY],
    ['a list', JSON.stringify([GOOD_KEY]), 'bad_service_account', NOT_A_KEY],
  ];
  for (const [what, value, code, message] of cases) {
    assert.throws(() => realDeps({ FIREBASE_SERVICE_ACCOUNT: value }), (err) => {
      assert.strictEqual(err.code, code, what);
      assert.strictEqual(err.message, message, `${what}: the message is fixed, whatever the value was`);
      return true;
    }, what);
  }
  // Root tests run without firebase-admin installed: a bad key must be refused before it is asked for.
  const loaded = Object.keys(require.cache).filter((file) => file.includes(`${path.sep}firebase-admin${path.sep}`));
  assert.deepStrictEqual(loaded, [], 'none of them loaded firebase-admin');
});

test("whatever firebase-admin's cert() throws about a key is replaced by the same plain error: its message can quote the key", () => {
  const quotes = () => {
    throw Object.assign(new Error(`Failed to parse service account json file: ENOENT: open '${JSON.stringify(GOOD_KEY)}'`), { code: 'app/invalid-credential' });
  };
  assert.throws(() => credentialFrom(quotes, GOOD_KEY), (err) => {
    assert.strictEqual(err.code, 'bad_service_account');
    assert.strictEqual(err.message, NOT_A_KEY);
    assert.strictEqual(err.cause, undefined, 'the original is not kept either');
    return true;
  });
  assert.strictEqual(credentialFrom((key) => `credential for ${key.client_email}`, GOOD_KEY), 'credential for x@p.iam.gserviceaccount.com', 'a key it accepts passes through');
});

test('a key set the wrong way answers 500 and the log says only what kind of problem it is', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  // Pasted with its quotes it is JSON inside JSON: firebase-admin would take it for a file name, and quote it.
  const twice = JSON.stringify(JSON.stringify(GOOD_KEY));
  const fn = toVercel(async () => ({ status: 200, body: {} }), () => realDeps({ FIREBASE_SERVICE_ACCOUNT: twice }));
  const res = fakeRes();
  await fn({ method: 'GET', headers: {} }, res);
  assert.deepStrictEqual([res.statusCode, res.body], [500, SERVER_PROBLEM]);
  assert.deepStrictEqual(logged(error), ['[api] could not start: bad_service_account']);
});

test('who a checked token belongs to; its email counts as verified only when the token says exactly that (the admin check relies on it)', () => {
  const decoded = { uid: 'u1', email: 'rahul@gmail.com', email_verified: true, name: 'Rahul', iss: 'https://securetoken.google.com/p', aud: 'p' };
  assert.deepStrictEqual(whoFrom(decoded), { uid: 'u1', email: 'rahul@gmail.com', emailVerified: true, name: 'Rahul' });
  for (const notTrue of [false, 'true', 1, null, undefined]) {
    assert.strictEqual(whoFrom({ ...decoded, email_verified: notTrue }).emailVerified, false, JSON.stringify(notTrue));
  }
  assert.deepStrictEqual(whoFrom({ uid: 'u2' }), { uid: 'u2', email: '', emailVerified: false, name: '' }, 'no email and no name');
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

test("the functions run in Mumbai (bom1), next to the database (Firestore's asia-south1) and the users", () => {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'web', 'vercel.json'), 'utf8'));
  assert.deepStrictEqual(config.regions, ['bom1']);
});
