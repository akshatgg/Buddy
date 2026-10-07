'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const net = require('node:net');
const { signInWithGoogle, refreshIdToken, listenForCode, makePkce, authUrl, cancelled, signedOut } = require('../src/main/google-signin');

const CONFIG = { serverUrl: 'https://s.example', firebaseApiKey: 'fb-key', googleClientId: 'client-id', googleClientSecret: 'client-secret' };
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const FIREBASE_IDP = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const FIREBASE_REFRESH = 'https://securetoken.googleapis.com/v1/token';
const FIREBASE_ANSWER = { idToken: 'fb-id', refreshToken: 'fb-refresh', expiresIn: '3600', localId: 'uid-1', email: 'rahul@gmail.com', displayName: 'Rahul' };

/** A fetch for Google's endpoints: `routes` maps origin + path to { status, body }, or to a function of (url, init). */
function googleFetch(routes) {
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const route = routes[`${u.origin}${u.pathname}`];
    if (!route) throw new TypeError('fetch failed');
    const { status = 200, body } = typeof route === 'function' ? route(u, init) : route;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }
  return fetchImpl;
}

/** What the port answers to `GET target`, written byte for byte: fetch tidies up targets like `//` before it sends them. */
function rawGet(redirectUri, target) {
  return new Promise((resolve, reject) => {
    const socket = net.connect(Number(new URL(redirectUri).port), '127.0.0.1');
    let answer = '';
    socket.setEncoding('utf8');
    socket.setTimeout(2000, () => socket.destroy(new Error(`no answer to GET ${target}`)));
    socket.on('data', (chunk) => { answer += chunk; });
    socket.on('error', reject);
    socket.on('close', () => resolve(answer));
    socket.write(`GET ${target} HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n`);
  });
}

/** What the person's browser does once they have picked their account: Google sends it back to Buddy's port. */
function browserThatSignsIn(seen = {}) {
  return async (url) => {
    const u = new URL(url);
    seen.challenge = u.searchParams.get('code_challenge');
    seen.redirect = u.searchParams.get('redirect_uri');
    const back = new URL(seen.redirect);
    back.search = new URLSearchParams({ state: u.searchParams.get('state'), code: 'the-code' }).toString();
    setImmediate(() => fetch(back).then((r) => r.text()));
  };
}

/** What the browser does when the person presses Cancel on Google's page: Google sends it back with an error. */
async function browserThatCancels(url) {
  const u = new URL(url);
  const back = new URL(u.searchParams.get('redirect_uri'));
  back.search = new URLSearchParams({ state: u.searchParams.get('state'), error: 'access_denied' }).toString();
  setImmediate(() => fetch(back).then((r) => r.text()));
}

// For a test that waits for the listener or a sign-in to settle: one that never does fails instead of hanging.
const NO_HANG = { timeout: 10_000 };

test('PKCE: a fresh verifier each time, and the challenge is its SHA-256', () => {
  const a = makePkce();
  const b = makePkce();
  assert.notStrictEqual(a.verifier, b.verifier);
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(a.challenge, crypto.createHash('sha256').update(a.verifier).digest('base64url'));
});

test("Google's page is asked for the person's email and name, with the challenge and the state", () => {
  const u = new URL(authUrl({ clientId: 'client-id', redirectUri: 'http://127.0.0.1:5000', challenge: 'ch', state: 'st' }));
  assert.strictEqual(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepStrictEqual(Object.fromEntries(u.searchParams), {
    client_id: 'client-id',
    redirect_uri: 'http://127.0.0.1:5000',
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: 'ch',
    code_challenge_method: 'S256',
    state: 'st',
    prompt: 'select_account',
  });
});

test('the listener takes the code for its own state only, then closes', NO_HANG, async (t) => {
  const listening = await listenForCode({ state: 'st' });
  t.after(() => listening.stop()); // a failing test must not leave the port open for five minutes
  assert.match(listening.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.strictEqual((await fetch(`${listening.redirectUri}/?state=other&code=nope`)).status, 404);
  assert.strictEqual((await fetch(`${listening.redirectUri}/favicon.ico`)).status, 404);
  const page = await fetch(`${listening.redirectUri}/?state=st&code=the-code`);
  assert.strictEqual(page.status, 200);
  // The tab is answered before Buddy has signed in with the code, so it promises nothing that can still fail.
  const text = await page.text();
  assert.match(text, /<title>Almost done<\/title>/);
  assert.match(text, /You can close this tab\. Buddy is finishing signing you in\./);
  assert.strictEqual(await listening.code, 'the-code');
  await assert.rejects(fetch(`${listening.redirectUri}/?state=st&code=again`), 'nothing listens any more');
});

test("Cancel on Google's page, waiting too long, aborting or stopping ends the wait, each in its own words", NO_HANG, async (t) => {
  const refused = await listenForCode({ state: 'st' });
  t.after(() => refused.stop());
  const page = await fetch(`${refused.redirectUri}/?state=st&error=access_denied`);
  assert.match(await page.text(), /Sign-in did not finish/);
  await assert.rejects(refused.code, { code: 'sign_in_denied', message: "You didn't finish signing in with Google. Try again." });

  const slow = await listenForCode({ state: 'st', waitMs: 20 });
  t.after(() => slow.stop());
  await assert.rejects(slow.code, { code: 'sign_in_timeout', message: 'Sign-in took too long. Try again.' });

  // Cancelled is for Buddy itself letting go of the wait (a newer sign-in, or a sign-out): the pages say nothing then.
  const controller = new AbortController();
  const aborted = await listenForCode({ state: 'st', signal: controller.signal });
  t.after(() => aborted.stop());
  controller.abort();
  await assert.rejects(aborted.code, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });

  const stopped = await listenForCode({ state: 'st' });
  stopped.stop();
  await assert.rejects(stopped.code, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });
});

test('a request that is no path at all gets a 404 too, and the wait goes on', NO_HANG, async (t) => {
  const listening = await listenForCode({ state: 'st' });
  t.after(() => listening.stop()); // a failing test must not leave the port open for five minutes
  for (const target of ['//', '///', '//?state=st&code=nope']) {
    assert.match(await rawGet(listening.redirectUri, target), /^HTTP\/1\.1 404 /, `GET ${target}`);
  }
  assert.strictEqual((await fetch(`${listening.redirectUri}/?state=st&code=the-code`)).status, 200);
  assert.strictEqual(await listening.code, 'the-code');
});

test('a request that names another host gets a 404 even with the right state, and the wait goes on', NO_HANG, async (t) => {
  const listening = await listenForCode({ state: 'st' });
  t.after(() => listening.stop());
  for (const target of ['//other.example/?state=st&code=nope', 'http://other.example/?state=st&code=nope']) {
    assert.match(await rawGet(listening.redirectUri, target), /^HTTP\/1\.1 404 /, `GET ${target}`);
  }
  assert.strictEqual((await fetch(`${listening.redirectUri}/?state=st&code=the-code`)).status, 200);
  assert.strictEqual(await listening.code, 'the-code');
});

test('a signal that has already been aborted ends the wait at once, and the port is let go', NO_HANG, async (t) => {
  const controller = new AbortController();
  controller.abort();
  const listening = await listenForCode({ state: 'st', signal: controller.signal });
  t.after(() => listening.stop());
  assert.match(listening.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  await assert.rejects(listening.code, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });
  await assert.rejects(fetch(`${listening.redirectUri}/?state=st&code=x`), 'nothing listens any more');
});

test('the whole sign-in: the browser, the code, Google, then Firebase', NO_HANG, async () => {
  const seen = {};
  const fetchImpl = googleFetch({
    [GOOGLE_TOKEN]: (u, init) => {
      seen.tokenType = init.headers['content-type'];
      seen.form = Object.fromEntries(new URLSearchParams(init.body));
      return { body: { id_token: 'google-id', access_token: 'a' } };
    },
    [FIREBASE_IDP]: (u, init) => {
      seen.idp = { key: u.searchParams.get('key'), body: JSON.parse(init.body) };
      return { body: FIREBASE_ANSWER };
    },
  });
  const result = await signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(seen), fetchImpl });
  assert.deepStrictEqual(result, {
    idToken: 'fb-id', refreshToken: 'fb-refresh', expiresIn: 3600, uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul',
  });
  assert.strictEqual(seen.tokenType, 'application/x-www-form-urlencoded');
  const { code_verifier: verifier, redirect_uri: redirect, ...rest } = seen.form;
  assert.deepStrictEqual(rest, { code: 'the-code', client_id: 'client-id', client_secret: 'client-secret', grant_type: 'authorization_code' });
  assert.strictEqual(redirect, seen.redirect);
  assert.strictEqual(crypto.createHash('sha256').update(verifier).digest('base64url'), seen.challenge, 'the verifier matches the challenge');
  assert.deepStrictEqual(seen.idp, {
    key: 'fb-key',
    body: { postBody: 'id_token=google-id&providerId=google.com', requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true },
  });
});

test('Google or Firebase turning the sign-in down, or no internet, ends it in plain words', NO_HANG, async (t) => {
  t.mock.method(console, 'warn', () => {});
  const refused = googleFetch({ [GOOGLE_TOKEN]: { status: 400, body: { error: 'invalid_grant' } } });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: refused }),
    { code: 'sign_in_failed', message: "Google didn't sign you in. Try again." });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: googleFetch({}) }),
    { code: 'network', message: "Couldn't reach Google. Check your internet." });
  const noFirebase = googleFetch({
    [GOOGLE_TOKEN]: { body: { id_token: 'g' } },
    [FIREBASE_IDP]: { status: 400, body: { error: { message: 'INVALID_IDP_RESPONSE' } } },
  });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: noFirebase }), { code: 'sign_in_failed' });
});

test("pressing Cancel on Google's page ends the sign-in in words that say so", NO_HANG, async () => {
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatCancels, fetchImpl: googleFetch({}) }),
    { code: 'sign_in_denied', message: "You didn't finish signing in with Google. Try again." });
});

test('a refusal is logged with where, the status and its reason as one word, never a token', NO_HANG, async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const token = `eyJhbGciOiJSUzI1NiJ9.${'eyJzdWIiOiIxMjMifQ'.repeat(8)}.${'c2lnbmF0dXJl'.repeat(8)}`;
  const signIn = (routes) => signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: googleFetch(routes) });
  const refresh = (answer) => refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: googleFetch({ [FIREBASE_REFRESH]: answer }) });

  // Google's token endpoint names its error in `error`; Firebase in `error.message`, often followed by words of its own.
  await assert.rejects(signIn({ [GOOGLE_TOKEN]: { status: 400, body: { error: 'invalid_grant', error_description: `Bad code ${token}` } } }),
    { code: 'sign_in_failed' });
  await assert.rejects(signIn({
    [GOOGLE_TOKEN]: { body: { id_token: 'g' } },
    [FIREBASE_IDP]: { status: 400, body: { error: { code: 400, message: `INVALID_IDP_RESPONSE : Invalid Idp Response: id_token ${token}` } } },
  }), { code: 'sign_in_failed' });
  await assert.rejects(refresh({ status: 400, body: { error: { code: 400, message: 'TOKEN_EXPIRED' } } }), { code: 'signed_out' });
  // A reason that is not one word (here, a token itself), and an answer that is not JSON: where and the status only.
  await assert.rejects(refresh({ status: 400, body: { error: { code: 400, message: token } } }), { code: 'auth_failed' });
  await assert.rejects(refresh({ status: 503 }), { code: 'auth_failed' });

  const logged = warn.mock.calls.map((c) => c.arguments.join(' '));
  assert.deepStrictEqual(logged, [
    '[buddy] sign-in: oauth2.googleapis.com answered 400 (invalid_grant)',
    '[buddy] sign-in: identitytoolkit.googleapis.com answered 400 (INVALID_IDP_RESPONSE)',
    '[buddy] sign-in: securetoken.googleapis.com answered 400 (TOKEN_EXPIRED)',
    '[buddy] sign-in: securetoken.googleapis.com answered 400',
    '[buddy] sign-in: securetoken.googleapis.com answered 503',
  ]);
  assert.doesNotMatch(logged.join('\n'), /eyJ/, 'no token reaches the log');
});

test('a sign-in that was cancelled before it began opens no Google page', NO_HANG, async () => {
  const controller = new AbortController();
  controller.abort();
  let opened = 0;
  const openBrowser = async () => { opened += 1; };
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser, fetchImpl: googleFetch({}), signal: controller.signal }),
    { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });
  assert.strictEqual(opened, 0, 'no page was opened for a sign-in nobody is waiting for');
});

test('a browser that cannot be opened ends the sign-in, and the port is let go', NO_HANG, async () => {
  let redirect = null;
  const openBrowser = async (url) => {
    redirect = new URL(url).searchParams.get('redirect_uri');
    throw new Error('no browser');
  };
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser, fetchImpl: googleFetch({}) }),
    { code: 'sign_in_failed', message: "Couldn't open your browser to sign in." });
  await assert.rejects(fetch(`${redirect}/?state=x&code=y`), 'nothing listens any more');
});

test('refresh: a new ID token, and the refresh token Firebase may have rotated', async () => {
  let seen = null;
  const fetchImpl = googleFetch({
    [FIREBASE_REFRESH]: (u, init) => {
      seen = { key: u.searchParams.get('key'), ...Object.fromEntries(new URLSearchParams(init.body)) };
      return { body: { id_token: 'new-id', refresh_token: 'new-refresh', expires_in: '3600', user_id: 'uid-1' } };
    },
  });
  assert.deepStrictEqual(await refreshIdToken({ refreshToken: 'old-refresh', config: CONFIG, fetchImpl }),
    { idToken: 'new-id', refreshToken: 'new-refresh', expiresIn: 3600 });
  assert.deepStrictEqual(seen, { key: 'fb-key', grant_type: 'refresh_token', refresh_token: 'old-refresh' });
});

test('refresh: a refresh token Firebase no longer takes means signed out; other failures do not', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const answer = (status, message) => googleFetch({ [FIREBASE_REFRESH]: { status, body: { error: { code: status, message } } } });
  for (const reason of ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND']) {
    await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: answer(400, reason) }),
      { code: 'signed_out', message: 'Sign in to use Buddy.' }, reason);
  }
  await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: answer(503, 'UNAVAILABLE') }),
    { code: 'auth_failed', message: "Couldn't check your sign-in. Try again." });
  await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: googleFetch({}) }), { code: 'network' });
});

test('a call that Google or Firebase leaves unanswered for too long ends in plain words', async () => {
  let given = null;
  const unanswered = async (url, init) => {
    given = init;
    throw new DOMException('The operation was aborted due to timeout', 'TimeoutError'); // what AbortSignal.timeout makes fetch throw
  };
  await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: unanswered }),
    { code: 'timeout', message: 'Google took too long to answer. Try again.' });
  assert.ok(given.signal instanceof AbortSignal, 'every call is given a deadline');
});

test('the errors that sign-in shares with the account are in plain words', () => {
  assert.deepStrictEqual([cancelled().code, cancelled().message], ['sign_in_cancelled', 'Sign-in was cancelled.']);
  assert.deepStrictEqual([signedOut().code, signedOut().message], ['signed_out', 'Sign in to use Buddy.']);
});
