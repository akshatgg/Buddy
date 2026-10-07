'use strict';

/**
 * Who is signed in to Buddy. The Firebase refresh token is kept in account.json, encrypted with safeStorage (the
 * Mac keychain), with the person's uid, email, name and photo address. ID tokens stay in memory and are renewed a few minutes
 * before they run out. A refresh token Firebase no longer takes signs the person out.
 */

const fs = require('node:fs');
const { BuddyError } = require('../../shared/errors');
const { writeAtomic } = require('./store');
const google = require('./google-signin');
const { notSetUp } = require('./cloud-config');

const RENEW_EARLY_MS = 5 * 60_000;

const { cancelled, signedOut } = google;
const noKeychain = () => new BuddyError('no_keychain', 'Your Mac keychain is not available, so Buddy cannot keep you signed in.');

function createAccount({
  file, safeStorage, config, openBrowser,
  fetchImpl = fetch,
  now = Date.now,
  signInWithGoogle = google.signInWithGoogle,
  refreshIdToken = google.refreshIdToken,
}) {
  let saved = read(); // { uid, email, name, photo (not in a file kept before photos), refreshToken: encrypted, base64 }, or null when signed out
  let token = null; // { idToken, expiresAt } for `saved`
  let renewing = null; // the renewal in progress, shared by everyone who asks meanwhile
  let signingIn = null; // the AbortController of the sign-in that is waiting for the browser
  const listeners = [];

  function read() {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const complete = d && ['uid', 'email', 'name', 'refreshToken'].every((k) => typeof d[k] === 'string') && d.uid && d.refreshToken;
      return complete ? d : null;
    } catch {
      return null;
    }
  }

  function changed() {
    for (const fn of listeners) {
      try {
        fn();
      } catch (err) {
        // A broken listener must not undo a sign-in, hide why someone was signed out, or keep the others from hearing.
        console.error(`[buddy] an account listener failed: ${err?.code || err?.name || 'error'}`);
      }
    }
  }

  function keep(user, refreshToken) {
    if (!safeStorage.isEncryptionAvailable()) throw noKeychain();
    const next = {
      uid: user.uid,
      email: user.email,
      name: user.name,
      photo: typeof user.photo === 'string' ? user.photo : '',
      refreshToken: safeStorage.encryptString(refreshToken).toString('base64'),
    };
    writeAtomic(file, JSON.stringify(next), 0o600);
    saved = next;
  }

  function forget() {
    saved = null;
    token = null;
    fs.rmSync(file, { force: true });
  }

  function user() {
    return saved ? { uid: saved.uid, email: saved.email, name: saved.name, photo: typeof saved.photo === 'string' ? saved.photo : '' } : null;
  }

  /** Sign in with Google in the browser. Starting again cancels a sign-in that is still waiting. */
  async function signIn() {
    if (!config) throw notSetUp();
    if (!safeStorage.isEncryptionAvailable()) throw noKeychain(); // before a Google page opens, not after the person has picked an account
    signingIn?.abort();
    const mine = new AbortController();
    signingIn = mine;
    try {
      const r = await signInWithGoogle({ config, openBrowser, fetchImpl, signal: mine.signal });
      if (mine.signal.aborted) throw cancelled();
      keep(r, r.refreshToken);
      token = { idToken: r.idToken, expiresAt: now() + r.expiresIn * 1000 };
      changed();
      return user();
    } finally {
      if (signingIn === mine) signingIn = null;
    }
  }

  function signOut() {
    signingIn?.abort();
    const was = saved !== null;
    forget();
    if (was) changed();
  }

  async function renew() {
    const who = saved;
    let refreshToken = null;
    try {
      refreshToken = safeStorage.decryptString(Buffer.from(who.refreshToken, 'base64'));
    } catch {
      // The keychain no longer has what it was encrypted with (a new Mac, a reset keychain): sign in again.
    }
    if (!refreshToken) {
      forget();
      changed();
      throw signedOut();
    }
    let r;
    try {
      r = await refreshIdToken({ refreshToken, config, fetchImpl });
    } catch (err) {
      if (err.code === 'signed_out' && saved === who) {
        forget();
        changed();
      }
      throw err;
    }
    if (saved !== who) throw signedOut(); // signed out (or in as someone else) meanwhile: this token is not theirs
    if (r.refreshToken !== refreshToken) keep(who, r.refreshToken);
    token = { idToken: r.idToken, expiresAt: now() + r.expiresIn * 1000 };
    return r.idToken;
  }

  /** An ID token for Buddy's server; renewed when it runs out within five minutes, or always with `force`. */
  async function idToken({ force = false } = {}) {
    if (!saved) throw signedOut();
    if (!config) throw notSetUp();
    if (!force && token && token.expiresAt - RENEW_EARLY_MS > now()) return token.idToken;
    if (!renewing) {
      renewing = renew().finally(() => {
        renewing = null;
      });
    }
    return renewing;
  }

  return {
    isSignedIn: () => saved !== null,
    user,
    signIn,
    signOut,
    idToken,
    /** `fn()` is called whenever someone signs in or out. */
    onChange: (fn) => {
      listeners.push(fn);
    },
  };
}

module.exports = { createAccount, RENEW_EARLY_MS };
