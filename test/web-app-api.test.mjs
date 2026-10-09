// Buddy on iPhone: calls to Buddy's server (web/public/app/api.js).

import test from 'node:test';
import assert from 'node:assert';
import { createApi, ApiError, NO_INTERNET, TOO_SLOW, SERVER_PROBLEM, SIGN_IN_AGAIN } from '../web/public/app/api.js';

/** A response as fetch gives it: `body` is JSON, or text that is not. */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

/**
 * The api with a fake fetch that answers `replies` in turn (an Error is thrown instead), and tokens 't1', 't2', … (a
 * new one each time one is forced). `calls` are the fetches, `tokens` the getToken calls, `signedOut` how often the
 * person was signed out.
 */
function setup(replies, { token = true } = {}) {
  const calls = [];
  const tokens = [];
  let n = 1;
  let signedOut = 0;
  const api = createApi({
    getToken: async (force) => {
      tokens.push(force);
      if (!token) return null;
      if (force) n += 1;
      return `t${n}`;
    },
    onSignedOut: () => {
      signedOut += 1;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { api, calls, tokens, signedOut: () => signedOut };
}

test('a call carries the ID token and a deadline; a POST sends JSON; the answer is the JSON', async () => {
  const s = setup([reply(200, { freeOn: true }), reply(200, { text: 'hi' })]);
  assert.deepStrictEqual(await s.api.get('/api/config', { timeoutMs: 8000 }), { freeOn: true });
  assert.deepStrictEqual(await s.api.post('/api/ask', { action: 'chat', message: 'hi' }), { text: 'hi' });
  const [get, post] = s.calls;
  assert.strictEqual(get.url, '/api/config');
  assert.strictEqual(get.method, 'GET');
  assert.deepStrictEqual(get.headers, { authorization: 'Bearer t1' });
  assert.strictEqual(get.body, undefined);
  assert.ok(get.signal instanceof AbortSignal);
  assert.strictEqual(post.method, 'POST');
  assert.deepStrictEqual(post.headers, { authorization: 'Bearer t1', 'content-type': 'application/json' });
  assert.strictEqual(post.body, '{"action":"chat","message":"hi"}');
  assert.deepStrictEqual(s.tokens, [false, false], 'the token as it is: the sign-in SDK renews it before it expires');
});

test('a token turned down is renewed and the call made once more', async () => {
  const s = setup([reply(401, { error: { code: 'unauthenticated', message: 'x' } }), reply(200, { ok: 1 })]);
  assert.deepStrictEqual(await s.api.get('/api/config'), { ok: 1 });
  assert.deepStrictEqual(s.tokens, [false, true]);
  assert.strictEqual(s.calls[1].headers.authorization, 'Bearer t2');
  assert.strictEqual(s.signedOut(), 0);
});

test('turned down twice, or nobody signed in: "Sign in again." and the person is signed out', async () => {
  const s = setup([reply(401, {}), reply(401, {})]);
  await assert.rejects(s.api.get('/api/config'), { name: 'ApiError', code: 'unauthenticated', message: SIGN_IN_AGAIN });
  assert.strictEqual(s.signedOut(), 1);
  const none = setup([], { token: false });
  await assert.rejects(none.api.post('/api/ask', {}), { code: 'unauthenticated', message: SIGN_IN_AGAIN });
  assert.strictEqual(none.calls.length, 0, 'nothing is sent without a token');
  assert.strictEqual(none.signedOut(), 1);
});

test("the server's refusals keep its code and its words", async () => {
  const s = setup([reply(429, { error: { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." } })]);
  await assert.rejects(s.api.post('/api/ask', {}), (err) => err instanceof ApiError && err.code === 'free_limit' && err.message.startsWith("You've used"));
});

test('anything else is said in plain words: no internet, too slow, or a server problem', async () => {
  const offline = setup([new TypeError('Load failed')]);
  await assert.rejects(offline.api.get('/api/config'), { code: 'network', message: NO_INTERNET });
  const slow = setup([Object.assign(new Error('timed out'), { name: 'TimeoutError' })]);
  await assert.rejects(slow.api.get('/api/config'), { code: 'timeout', message: TOO_SLOW });
  const html = setup([reply(502, '<html>Bad gateway</html>')]);
  await assert.rejects(html.api.get('/api/config'), { code: 'server', message: SERVER_PROBLEM });
  const odd = setup([reply(200, 'null')]);
  await assert.rejects(odd.api.get('/api/config'), { code: 'server', message: SERVER_PROBLEM });
});
