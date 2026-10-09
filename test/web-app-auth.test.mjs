// Buddy on iPhone: signing in (web/public/app/auth.js and config.js), and what the server's vercel.json does for it.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { startAuth, firstNameOf, signInMessage, personOf, SIGN_IN_FAILED, SIGN_IN_OFFLINE } from '../web/public/app/auth.js';
import { FIREBASE, FIREBASE_SDK } from '../web/public/app/config.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../web/vercel.json', import.meta.url), 'utf8'));

test("the config is the real \"Buddy iPhone\" web app's, with Buddy's own domain for sign-in", () => {
  assert.strictEqual(FIREBASE.projectId, 'buddy-7f8c2');
  assert.strictEqual(FIREBASE.authDomain, 'buddywrites.vercel.app');
  assert.match(FIREBASE.apiKey, /^AIza[\w-]{35}$/);
  assert.match(FIREBASE.appId, /^1:128703624181:web:[0-9a-f]+$/);
  assert.notStrictEqual(FIREBASE.appId, '1:128703624181:web:9adb3ae202fab7ec5766bc', 'its own app, not "Buddy Mac"');
  assert.match(FIREBASE_SDK, /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+$/, 'a pinned version');
});

test("sign-in's pages on Buddy's domain are Firebase's: /__/auth and /__/firebase go on to the project", () => {
  assert.deepStrictEqual(vercel.rewrites.filter((r) => r.source.startsWith('/__/')), [
    { source: '/__/auth/:path*', destination: 'https://buddy-7f8c2.firebaseapp.com/__/auth/:path*' },
    { source: '/__/firebase/:path*', destination: 'https://buddy-7f8c2.firebaseapp.com/__/firebase/:path*' },
  ]);
});

/** A fake Firebase SDK: what startAuth asked of it, and a way to sign someone in. */
function fakeSdk({ redirectError = null } = {}) {
  const seen = { loaded: [], init: null, redirects: [], signedOut: 0, tokens: [] };
  let listener = null;
  const auth = { currentUser: null };
  const user = { uid: 'u1', email: 'a@gmail.com', displayName: 'Akshat Gupta', getIdToken: async (force) => { seen.tokens.push(force); return force ? 'new' : 'tok'; } };
  class GoogleAuthProvider {
    setCustomParameters(params) {
      this.params = params;
    }
  }
  const modules = {
    [`${FIREBASE_SDK}/firebase-app.js`]: { initializeApp: (config) => ({ config }) },
    [`${FIREBASE_SDK}/firebase-auth.js`]: {
      indexedDBLocalPersistence: 'idb',
      browserLocalPersistence: 'local',
      browserPopupRedirectResolver: 'resolver',
      initializeAuth: (app, options) => {
        seen.init = { app, options };
        return auth;
      },
      getRedirectResult: async () => {
        if (redirectError) throw redirectError;
        return null;
      },
      onAuthStateChanged: (a, fn) => {
        assert.strictEqual(a, auth);
        listener = fn;
      },
      GoogleAuthProvider,
      signInWithRedirect: async (a, provider) => seen.redirects.push(provider.params),
      signOut: async () => {
        seen.signedOut += 1;
      },
    },
  };
  const load = async (url) => {
    seen.loaded.push(url);
    return modules[url];
  };
  const signIn = () => {
    auth.currentUser = user;
    listener(user);
  };
  return { seen, load, signIn };
}

test('auth starts the SDK with the config, keeps the person signed in, and says who they are', async () => {
  const sdk = fakeSdk();
  const people = [];
  const auth = await startAuth({ onUser: (p) => people.push(p), load: sdk.load });
  assert.deepStrictEqual(sdk.seen.loaded, [`${FIREBASE_SDK}/firebase-app.js`, `${FIREBASE_SDK}/firebase-auth.js`]);
  assert.deepStrictEqual(sdk.seen.init, { app: { config: FIREBASE }, options: { persistence: ['idb', 'local'], popupRedirectResolver: 'resolver' } });
  assert.strictEqual(await auth.token(), null, 'nobody yet');
  sdk.signIn();
  assert.deepStrictEqual(people, [{ uid: 'u1', email: 'a@gmail.com', name: 'Akshat Gupta', firstName: 'Akshat' }]);
  assert.strictEqual(await auth.token(), 'tok');
  assert.strictEqual(await auth.token(true), 'new');
  assert.deepStrictEqual(sdk.seen.tokens, [false, true]);
});

test('sign-in goes to Google by redirect, asking which account; sign-out signs out', async () => {
  const sdk = fakeSdk();
  const auth = await startAuth({ onUser: () => {}, load: sdk.load });
  await auth.signIn();
  assert.deepStrictEqual(sdk.seen.redirects, [{ prompt: 'select_account' }]);
  await auth.signOut();
  assert.strictEqual(sdk.seen.signedOut, 1);
});

test('coming back from Google with a failure says so, in plain words; going back says nothing', async () => {
  const errors = [];
  await startAuth({ onUser: () => {}, onError: (m) => errors.push(m), load: fakeSdk({ redirectError: { code: 'auth/internal-error' } }).load });
  await startAuth({ onUser: () => {}, onError: (m) => errors.push(m), load: fakeSdk({ redirectError: { code: 'auth/redirect-cancelled-by-user' } }).load });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(errors, [SIGN_IN_FAILED]);
  assert.strictEqual(signInMessage({ code: 'auth/network-request-failed' }), SIGN_IN_OFFLINE);
  assert.strictEqual(signInMessage(null), SIGN_IN_FAILED);
});

test('first names and people', () => {
  assert.strictEqual(firstNameOf('  Akshat   Gupta '), 'Akshat');
  assert.strictEqual(firstNameOf(null), '');
  assert.strictEqual(personOf(null), null);
  assert.deepStrictEqual(personOf({ uid: 'u', email: null, displayName: null }), { uid: 'u', email: '', name: '', firstName: '' });
});
