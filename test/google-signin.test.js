'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { signInWithGoogle, refreshIdToken, listenForCode, makePkce, authUrl } = require('../src/main/google-signin');

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

test('the listener takes the code for its own state only, then closes', async () => {
  const listening = await listenForCode({ state: 'st' });
  assert.match(listening.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.strictEqual((await fetch(`${listening.redirectUri}/?state=other&code=nope`)).status, 404);
  assert.strictEqual((await fetch(`${listening.redirectUri}/favicon.ico`)).status, 404);
  const page = await fetch(`${listening.redirectUri}/?state=st&code=the-code`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /You're signed in to Buddy/);
  assert.strictEqual(await listening.code, 'the-code');
  await assert.rejects(fetch(`${listening.redirectUri}/?state=st&code=again`), 'nothing listens any more');
});

test("cancelling on Google's page, waiting too long, aborting or stopping ends the wait", async () => {
  const cancelled = await listenForCode({ state: 'st' });
  const page = await fetch(`${cancelled.redirectUri}/?state=st&error=access_denied`);
  assert.match(await page.text(), /Sign-in did not finish/);
  await assert.rejects(cancelled.code, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });

  const slow = await listenForCode({ state: 'st', waitMs: 20 });
  await assert.rejects(slow.code, { code: 'sign_in_timeout', message: 'Sign-in took too long. Try again.' });

  const controller = new AbortController();
  const aborted = await listenForCode({ state: 'st', signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted.code, { code: 'sign_in_cancelled' });

  const stopped = await listenForCode({ state: 'st' });
  stopped.stop();
  await assert.rejects(stopped.code, { code: 'sign_in_cancelled' });
});

test('the whole sign-in: the browser, the code, Google, then Firebase', async () => {
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

test('Google or Firebase turning the sign-in down, or no internet, ends it in plain words', async (t) => {
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

test('a browser that cannot be opened ends the sign-in, and the port is let go', async () => {
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
