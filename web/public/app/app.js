// Buddy on iPhone: starts everything. So far, the head (the buddy picked, asleep when left alone, petting, a shake of
// the phone) and the service worker, which keeps the app's files for opening it without the network.

import { createStore, localStorageOf } from './store.js';
import { createHead } from './head.js';
import { createMotionShake, motionNeedsAsking } from './motion.js';
import { createSleep } from './shared/sleep.js';

const store = createStore(localStorageOf(window));

let head = null;
try {
  head = createHead({ canvas: document.getElementById('head'), symbolsRoot: document.getElementById('symbols'), onTouch: touched });
} catch (err) {
  console.error('[buddy] the head could not start', err); // no WebGL: the app works on without it
  document.getElementById('head').hidden = true;
}
// Drowsy after a minute left alone and asleep after two, as on the Mac (src/main/sleep.js).
const sleep = createSleep({ onMood: (name) => head?.mood(name) });

const shake = createMotionShake();
let motionAsked = false;

/** The head was touched: a use. The first touch asks iOS for the phone's motion, for shaking, once. */
function touched() {
  sleep.poke();
  if (motionAsked) return;
  motionAsked = true;
  if (!motionNeedsAsking(window.DeviceMotionEvent)) {
    listenForShakes();
    return;
  }
  window.DeviceMotionEvent.requestPermission()
    .then((answer) => {
      if (answer === 'granted') listenForShakes();
    })
    .catch(() => {});
}

function listenForShakes() {
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    if (a && shake.feed(a.x, a.y, a.z, e.timeStamp)) {
      sleep.poke();
      head?.mood('dizzy');
    }
  });
}

async function loadBuddy() {
  const buddies = await (await fetch('/app/buddies/buddies.json')).json();
  const picked = buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0];
  if (picked && head) await head.load({ url: `/app/buddies/${picked.file}`, accent: picked.accent });
}

document.addEventListener('visibilitychange', () => head?.pause(document.hidden));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
}

loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
