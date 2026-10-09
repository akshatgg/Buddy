// Buddy on iPhone's Firebase web app, "Buddy iPhone" in project buddy-7f8c2 (made with `firebase apps:create`; its
// values come from `firebase apps:sdkconfig`). They are public by design: they only name the project. Buddy's server
// checks every ID token itself. authDomain is Buddy's own domain, not firebaseapp.com, so that sign-in by redirect
// works in a Home Screen app on iOS: web/vercel.json passes /__/auth/ on to Firebase.

export const FIREBASE = {
  apiKey: 'AIzaSyAP3PJ3hzG-r4rMOvmG0xr_3fyKyUTbr3A',
  authDomain: 'buddywrites.vercel.app',
  projectId: 'buddy-7f8c2',
  appId: '1:128703624181:web:93b7f60d93003e655766bc',
  messagingSenderId: '128703624181',
};

// The Firebase JS SDK from Google's CDN, at a pinned version (change it on purpose, and try sign-in again after).
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/13.0.0';
