// Signing in on the phone: Google, through Firebase Auth's web SDK, with the same account as on the Mac and Android, so
// free mode's limits and Claude mode are the same everywhere. The SDK comes from Google's CDN (config.js) and is loaded
// when the app starts, not with the page, so the head still shows without the network. Sign-in goes by redirect, the
// way that works in a Home Screen app on iOS, and comes back through /__/auth on Buddy's own domain (config.js). The
// SDK keeps the person signed in and renews their ID token itself before it expires (it lasts an hour): token() answers
// a fresh one, and token(true) a new one, for a token Buddy's server turned down (api.js).

import { FIREBASE, FIREBASE_SDK } from './config.js';

export const SIGN_IN_FAILED = "Sign-in didn't work. Try again.";
export const SIGN_IN_OFFLINE = 'No internet. Connect, then sign in.';
// Closing Google's page is not a failure: nothing is said.
const CANCELLED = ['auth/redirect-cancelled-by-user', 'auth/popup-closed-by-user', 'auth/user-cancelled'];

/** The person's first name, for the chat: the first word of their Google name. */
export function firstNameOf(displayName) {
  return String(displayName || '').trim().split(/\s+/)[0] || '';
}

/** What to say when sign-in failed, from the SDK's error code; '' when the person only went back. */
export function signInMessage(err) {
  const code = err?.code || '';
  if (CANCELLED.includes(code)) return '';
  return code === 'auth/network-request-failed' ? SIGN_IN_OFFLINE : SIGN_IN_FAILED;
}

/** Who is signed in, as the app uses it, or null. */
export function personOf(user) {
  if (!user) return null;
  return { uid: user.uid, email: user.email || '', name: user.displayName || '', firstName: firstNameOf(user.displayName) };
}

/**
 * Start Firebase Auth. onUser(person | null) is called once the SDK knows who is signed in, and at each sign-in and
 * sign-out; onError(message) when coming back from Google failed. `load` imports a module by its URL (a fake in the
 * tests). Answers { signIn, signOut, token }.
 */
export async function startAuth({ onUser, onError = () => {}, load = (url) => import(url) }) {
  const [app, sdk] = await Promise.all([load(`${FIREBASE_SDK}/firebase-app.js`), load(`${FIREBASE_SDK}/firebase-auth.js`)]);
  const auth = sdk.initializeAuth(app.initializeApp(FIREBASE), {
    persistence: [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence],
    popupRedirectResolver: sdk.browserPopupRedirectResolver,
  });
  sdk.getRedirectResult(auth).catch((err) => {
    const message = signInMessage(err);
    if (message) onError(message);
  });
  sdk.onAuthStateChanged(auth, (user) => onUser(personOf(user)));
  return {
    /** Off to Google's page; the app comes back signed in (onUser). */
    signIn() {
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return sdk.signInWithRedirect(auth, provider);
    },
    signOut: () => sdk.signOut(auth),
    token: (force = false) => (auth.currentUser ? auth.currentUser.getIdToken(force) : Promise.resolve(null)),
  };
}
