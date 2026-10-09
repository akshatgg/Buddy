// Buddy on iPhone: starts everything. Signed out, the head and the sign-in button; signed in, three tabs under the
// head: Chat (answered by Buddy's server or the person's own key: route.js), Claude (Claude Code on the person's
// computers) and Settings. Each part is its own file; this one hands them what they need from each other, and tells
// the buddy what happens (its feelings, as src/main/feelings.js does on the Mac).

import { createStore, localStorageOf } from './store.js';
import { createApi, TIMEOUTS } from './api.js';
import { startAuth, signInMessage, SIGN_IN_OFFLINE } from './auth.js';
import { createMemory } from './memory.js';
import { createChat } from './chat-core.js';
import { createAsk } from './route.js';
import { createOwnAi } from './own-ai.js';
import { startAiSettings } from './ai-settings.js';
import { startAdmin } from './admin.js';
import { startChatView } from './chat.js';
import { startSettings } from './settings.js';
import { createHead } from './head.js';
import { createMotionShake, askForMotion } from './motion.js';
import { createVoice } from './voice.js';
import { startClaudeView } from './claude.js';
import { createPush, supportHere } from './push.js';
import { createSleep } from './shared/sleep.js';
import { $ } from './dom.js';

const app = $('app');
const store = createStore(localStorageOf(window));
const memory = createMemory({ store });
const own = createOwnAi({ store }); // the person's own AI key, on this phone only
const TABS = ['chat', 'claude', 'settings'];
const BUBBLE_MS = 2500;
const LINK = /^#claude\/([\w-]{1,100})$/; // a notification's session: /app#claude/<session id>

let person = null; // who is signed in: { uid, email, name, firstName }, or null
let config = null; // GET /api/config for them: voiceOn, pushKey, …
let tab = 'chat';
let buddies = []; // buddies.json
let bubbleTimer = null;

/** A short line under the head for a moment ("Copied"). */
function say(text) {
  $('bubble').textContent = text;
  $('bubble').hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    $('bubble').hidden = true;
  }, BUBBLE_MS);
}

// ---- sign-in and Buddy's server ----

let auth = null;
let authReady;
let authSettled = false;
const authStarted = new Promise((resolve) => {
  authReady = resolve;
});
const api = createApi({
  getToken: async (force) => {
    await authStarted;
    return auth ? auth.token(force) : null;
  },
  onSignedOut: () => {
    if (person) signOut(); // turned down twice: signed out as from Settings, notifications and all
  },
});

function showSignInError(message) {
  $('signin-error').textContent = message;
  $('signin-error').hidden = !message;
}

// ---- the head and its feelings ----

let head = null;
try {
  head = createHead({ canvas: $('head'), symbolsRoot: $('symbols'), onTouch: touched });
} catch (err) {
  console.error('[buddy] the head could not start', err); // no WebGL: the app works on without it
  $('head').hidden = true;
}
// Drowsy after a minute left alone and asleep after two, as on the Mac (src/main/sleep.js).
const sleep = createSleep({ onMood: (name) => head?.mood(name) });

/** A mood from the app: a use, which wakes a sleeping buddy first; thinking holds the sleep countdown while it lasts. */
function feel(name) {
  sleep.poke();
  sleep.hold('busy', name === 'thinking');
  head?.mood(name);
}

const shake = createMotionShake();
let motionAnswered = false; // granted or denied: stop asking
let motionListening = false;

/** The head was touched: a use. */
function touched() {
  sleep.poke();
}

/** A tap on the head asks iOS for the phone's motion, for shaking. iOS takes a click for that, not a pointerdown; if it
 * refuses ('later') the next tap asks again. */
document.getElementById('head').addEventListener('click', async () => {
  if (motionAnswered) return;
  const answer = await askForMotion(window.DeviceMotionEvent);
  if (answer === 'later') return;
  motionAnswered = true;
  if (answer === 'granted') listenForShakes();
});

function listenForShakes() {
  if (motionListening) return;
  motionListening = true;
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    if (a && shake.feed(a.x, a.y, a.z, e.timeStamp)) feel('dizzy');
  });
}

async function loadBuddy() {
  if (!buddies.length) {
    try {
      buddies = await (await fetch('/app/buddies/buddies.json')).json();
    } catch {
      buddies = [];
    }
  }
  const picked = buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0];
  if (picked && head) await head.load({ url: `/app/buddies/${picked.file}`, accent: picked.accent });
}

const buddyName = () => (buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0])?.defaultName || 'Buddy';

// ---- the chat ----

const chat = createChat({
  ask: createAsk({
    config: currentConfig,
    freshConfig: () => (person ? loadConfig(person) : Promise.resolve(null)),
    hasKey: () => own.hasKey(),
    askOwn: (body) => own.ask(body),
    askServer: (body) => api.post('/api/ask', body, { timeoutMs: TIMEOUTS.ask }),
  }),
  memory,
  userName: () => person?.firstName || '',
  onMood: feel,
  onChange: () => chatView.draw(),
});
const chatView = startChatView({ chat, buddyName, say, onCelebrate: () => feel('celebrate'), onMic: toggleVoice });

// ---- voice ----

const voice = createVoice({
  transcribe: async (audio, mime) => (await api.post('/api/transcribe', { audio, mime }, { timeoutMs: TIMEOUTS.transcribe })).text,
  onState: (state) => {
    sleep.hold('voice', state === 'listening');
    head?.micOn(state === 'listening');
    chatView.voiceState(state);
    claudeView.voiceState(state);
  },
  onLevel: (level) => head?.level(level),
  onWords: (text) => (tab === 'claude' ? claudeView : chatView).addWords(text),
  onError: (message) => (tab === 'claude' ? claudeView : chatView).showError(message),
});

function toggleVoice() {
  if (voice.state === 'idle') voice.start();
  else voice.stop();
}

// ---- Claude mode ----

const claudeView = startClaudeView({ api, onMic: toggleVoice, onFull: (on) => app.classList.toggle('full', on) });

// ---- notifications and settings ----

const push = createPush({ api, pushKey: () => config?.pushKey || null });

const PUSH_OFF_MS = 5000;
let signingOut = false;

/** Sign out: from Settings, or when the server turned the person's sign-in down twice (api.js). */
async function signOut() {
  if (signingOut) return;
  signingOut = true;
  let timer;
  try {
    // Voice and Claude mode stop first, while there is still a token for telling the computer to stop.
    voice.cancel();
    claudeView.leave();
    // This phone stops getting the person's notifications. The server forgets it (if that hangs, signing out goes on
    // without it), and the browser forgets it whatever the server did.
    await Promise.race([push.off().catch(() => null), new Promise((resolve) => (timer = setTimeout(resolve, PUSH_OFF_MS)))]);
    await push.forget();
    await auth?.signOut();
  } catch (err) {
    console.error('[buddy] sign out failed', err);
  } finally {
    clearTimeout(timer);
    signingOut = false;
  }
}

const settings = startSettings({
  store,
  memory,
  buddies: () => buddies,
  onBuddy: (id) => {
    store.write('buddy', id);
    loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
  },
  account: () => person,
  onSignOut: signOut,
  push,
  support: () => supportHere(window),
});
const aiSettings = startAiSettings({ own, config: () => config });
const admin = startAdmin({
  api,
  isAdmin: () => config?.isAdmin === true,
  onSaved: () => {
    if (person) loadConfig(person); // the admin's own phone follows the new switches at once
  },
});

// ---- the tabs ----

function showTab(next, { open = null } = {}) {
  if (!TABS.includes(next)) return;
  if (tab === 'claude' && next !== 'claude') claudeView.away();
  if (next !== tab) voice.cancel();
  tab = next;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === next));
  $('chat-pane').hidden = next !== 'chat';
  $('claude-pane').hidden = next !== 'claude';
  $('settings-pane').hidden = next !== 'settings';
  sleep.poke();
  if (next === 'claude') claudeView.show(open);
  if (next === 'settings') {
    settings.draw();
    aiSettings.draw();
    admin.draw();
  }
}

for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

/** A notification's link (/app#claude/<session>): the Claude tab, on that session. Used once. */
function followLink() {
  const match = LINK.exec(window.location.hash);
  if (!match || !person) return;
  window.history.replaceState(null, '', '/app');
  showTab('claude', { open: match[1] });
}
window.addEventListener('hashchange', followLink);

// ---- signed in and out ----

function showSignedOut() {
  person = null;
  config = null;
  tab = 'chat'; // the next sign-in opens on Chat
  app.dataset.signed = 'out';
  $('signin').hidden = false;
  $('tabs').hidden = true;
  for (const id of ['chat-pane', 'claude-pane', 'settings-pane']) $(id).hidden = true;
  voice.cancel();
  claudeView.leave();
  chat.clear();
  admin.update(); // hidden, and forgotten
}

async function showSignedIn(who) {
  person = who;
  app.dataset.signed = 'in';
  showSignInError('');
  $('signin').hidden = true;
  $('tabs').hidden = false;
  showTab(tab);
  followLink();
  await loadConfig(who);
}

let configAsk = null; // the GET /api/config under way: loadConfig's answer

/**
 * GET /api/config for `who`, and what hangs on it (voice, Settings → AI). Answers what came, or null. Offline the
 * config stays what it was (null at first: it is asked for again, configAgain).
 */
function loadConfig(who) {
  const ask = (async () => {
    const got = await api.get('/api/config', { timeoutMs: TIMEOUTS.config }).catch(() => null);
    if (configAsk === ask) configAsk = null;
    if (person !== who) return null; // signed out meanwhile
    if (got) config = got;
    chatView.setVoice(config?.voiceOn === true);
    claudeView.setVoice(config?.voiceOn === true);
    if (tab === 'settings') {
      aiSettings.draw();
      admin.update();
    }
    return got;
  })();
  configAsk = ask;
  return ask;
}

/** The config a message goes by: the one there is, else the one on its way, else one more try. */
async function currentConfig() {
  if (!config && person) await (configAsk ?? loadConfig(person));
  return config;
}

/** Back online, or back in view: the config that could not be had at sign-in is asked for again. */
function configAgain() {
  if (person && !config && !configAsk) loadConfig(person);
}
window.addEventListener('online', configAgain);

let authStarting = null;

/** Starts sign-in, once at a time: a second call while one is loading gets the same answer. After a failure a later
 * call tries again. True when it is running. Opening the sign-in page is a navigation, so it may come after an await. */
function beginAuth() {
  authStarting ??= (async () => {
    try {
      auth = await startAuth({ onUser: (who) => (who ? showSignedIn(who) : showSignedOut()), onError: showSignInError });
      return true;
    } catch (err) {
      console.error('[buddy] sign-in could not start', err);
      authStarting = null;
      if (!authSettled) showSignedOut();
      showSignInError(SIGN_IN_OFFLINE);
      return false;
    } finally {
      if (!authSettled) {
        authSettled = true;
        authReady();
      }
    }
  })();
  return authStarting;
}

$('signin-button').addEventListener('click', async () => {
  if (!auth && !(await beginAuth())) return;
  if (person) return; // a signed-in person was restored while it loaded
  showSignInError('');
  auth.signIn().catch((err) => showSignInError(signInMessage(err)));
});

beginAuth();

// ---- the page ----

document.addEventListener('visibilitychange', () => {
  head?.pause(document.hidden);
  if (document.hidden) {
    voice.cancel();
    claudeView.hidden();
  } else {
    configAgain();
    if (tab === 'claude' && person) claudeView.show();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
  // A tapped notification, while the app was open: sw.js says which session to show.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string') window.location.hash = new URL(e.data.url, window.location.href).hash;
  });
}

loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
