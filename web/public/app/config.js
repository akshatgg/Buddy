// Buddy on iPhone's Firebase web app, "Buddy iPhone" in project buddy-7f8c2 (made with `firebase apps:create`; its
// values come from `firebase apps:sdkconfig`). They are public by design: they only name the project. Buddy's server
// checks every ID token itself. authDomain is Buddy's own domain, not firebaseapp.com, so that sign-in by redirect
// works in a Home Screen app on iOS: web/vercel.json passes /__/auth/ on to Firebase. It must be the very domain the app
// was opened on (firebaseFor), or iOS keeps the sign-in from the app and it fails.

export const FIREBASE = {
  apiKey: 'AIzaSyAP3PJ3hzG-r4rMOvmG0xr_3fyKyUTbr3A',
  authDomain: 'buddywrites.vercel.app',
  projectId: 'buddy-7f8c2',
  appId: '1:128703624181:web:93b7f60d93003e655766bc',
  messagingSenderId: '128703624181',
};

// Buddy's domains, each serving /__/auth (web/vercel.json). Each must be in Firebase's Authorized domains, and its
// /__/auth/handler in the Google web client's redirect URIs (docs/manual-checklist-iphone.md).
export const SIGN_IN_DOMAINS = ['buddy.akshatgg.in', 'buddywrites.vercel.app'];

/** The config for the app opened on `host`: sign-in comes back to that domain when it is one of Buddy's. */
export function firebaseFor(host) {
  return SIGN_IN_DOMAINS.includes(host) ? { ...FIREBASE, authDomain: host } : FIREBASE;
}

// The Firebase JS SDK from Google's CDN, at a pinned version (change it on purpose, and try sign-in again after).
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/13.0.0';
