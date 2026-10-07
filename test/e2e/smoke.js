'use strict';

// End-to-end smoke test: starts the real app (src/main/main.js) with a fresh
// settings folder and fakes for the parts that touch the system (the native
// helper, the clipboard, the global shortcut, the login item, the Google
// account, Buddy's server, macOS's microphone permission and the microphone
// itself), then runs every check in test/e2e/checks in order. It runs on the
// Mac and on Windows.
//
//   npm run test:e2e

const { app } = require('electron');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BuddyError } = require('../../shared/errors');
const { PROVIDERS, PROVIDER_IDS } = require('../../shared/providers');
const { parseChat } = require('../../shared/prompts');

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-'));
app.setPath('userData', userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, buddyOn: true }));

/**
 * A recording for Chromium's fake microphone, as 16-bit WAV: a little silence, then 1.5 s of something like a voice (a
 * buzz at a speaking pitch with its overtones, its pitch and loudness moving as a voice's do), then silence.
 */
function voiceRecording() {
  const rate = 48000;
  const samples = Math.round(rate * 2.2);
  const data = Buffer.alloc(samples * 2);
  let phase = 0;
  for (let i = 0; i < samples; i += 1) {
    const t = i / rate;
    let sample = 0;
    if (t >= 0.2 && t < 1.7) {
      phase += (2 * Math.PI * (140 + 30 * Math.sin(2 * Math.PI * 2.5 * t))) / rate;
      for (let k = 1; k <= 8; k += 1) sample += Math.sin(k * phase) / k;
      sample *= 0.5 * (0.75 + 0.25 * Math.sin(2 * Math.PI * 3 * t));
    }
    data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, sample)) * 32767), i * 2);
  }
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVE', 8);
  head.write('fmt ', 12);
  head.writeUInt32LE(16, 16); // the size of this part
  head.writeUInt16LE(1, 20); // plain PCM
  head.writeUInt16LE(1, 22); // one channel
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28); // bytes a second
  head.writeUInt16LE(2, 32); // bytes a sample
  head.writeUInt16LE(16, 34); // bits a sample
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

// Nor may it use the person's microphone: Chromium's fake one stands in for it (this must be said before the app is
// ready). Each recording plays the voice above once from its start, then silence (%noloop). Chromium's audio service
// reads that file, which its sandbox would not let it do: only that sandbox is lifted, for this test. Chromium's own
// permission question is not faked away: the panel's page asks Buddy's permission rules (src/main/panel-window.js),
// as it does in the real app.
const voiceFile = path.join(userData, 'voice.wav');
fs.writeFileSync(voiceFile, voiceRecording());
app.commandLine.appendSwitch('use-fake-device-for-media-stream');
app.commandLine.appendSwitch('use-file-for-fake-audio-capture', `${voiceFile}%noloop`);
app.commandLine.appendSwitch('disable-features', 'AudioServiceSandbox');

const loginCalls = [];
// The person's app is none at first (lastApp); a check gives it one, and has its commands (captureSelection, paste,
// press, windowTitle, screenshot) answer with what it puts in `replies`: a result, or a BuddyError to fail with. Any
// other command fails, as it does with no app to work in.
const helper = Object.assign(new EventEmitter(), {
  lastApp: null,
  replies: {},
  calls: [],
  accessibility: true, // what the helper says about the Accessibility permission (a check turns it off and on)
  watching: false, // whether the app has the helper listen to the modifier keys (a single-key shortcut)
  start() {},
  stop() {},
  async call(cmd, args) {
    this.calls.push({ cmd, args });
    if (cmd === 'permissions') return { accessibility: this.accessibility, screenRecording: true };
    if (cmd === 'watchKeys') {
      this.watching = args.on;
      return { watching: args.on };
    }
    if (Object.hasOwn(this.replies, cmd)) {
      const reply = this.replies[cmd];
      if (reply instanceof Error) throw reply;
      return reply;
    }
    throw new BuddyError('not_frontmost', 'There is no app to paste into in the e2e test.');
  },
});

// The test must never read or overwrite the person's real clipboard, so the app gets this one. Like Electron's
// (from Electron 44), readText and writeText answer promises.
let clipboardText = '';
const clipboard = {
  readText: async () => clipboardText,
  writeText: async (text) => {
    clipboardText = text;
  },
};

// Nor may it grab the person's real shortcut (⌥Space, or Ctrl+Shift+Space on Windows), which another app of theirs
// may be using. This one only records what the app registers; a check calls the handler to press it. ⌃⌘K belongs to
// another app here: registering it fails, as the real one's does for a shortcut that is taken.
const globalShortcut = {
  registered: new Map(), // accelerator -> handler
  taken: new Set(['Control+Command+K']),
  register(accelerator, handler) {
    if (this.taken.has(accelerator)) return false;
    this.registered.set(accelerator, handler);
    return true;
  },
  unregister(accelerator) {
    this.registered.delete(accelerator);
  },
  unregisterAll() {
    this.registered.clear();
  },
};

// Nor may it ask this Mac about the microphone: the app gets this in place of Electron's systemPreferences. A check sets
// what macOS (or Windows' privacy switch) says (`microphone`), and what macOS says once it has asked the person
// (`answer`). Windows is never asked.
const systemPreferences = {
  microphone: 'granted',
  answer: 'granted',
  asked: 0,
  getMediaAccessStatus(type) {
    return type === 'microphone' ? this.microphone : 'unknown';
  },
  async askForMediaAccess() {
    this.asked += 1;
    this.microphone = this.answer;
    return this.answer === 'granted';
  },
};

// Nor may it sign in to Google or call Buddy's server: the app gets this account and this server. A check changes
// cloud.server, as the admin would, to see the app follow once it asks again, and signs out and in again (as someone
// else, after changing account.uid; or not at all, after setting account.nextSignInError).
const account = {
  signedIn: true,
  uid: 'e2e-user',
  nextSignInError: null, // a BuddyError the next signIn() fails with, as when the person presses Cancel on Google's page
  listeners: [],
  isSignedIn() {
    return this.signedIn;
  },
  user() {
    return this.signedIn ? { uid: this.uid, email: 'e2e@example.com', name: 'E2E Tester', photo: '' } : null;
  },
  async signIn() {
    const refusal = this.nextSignInError;
    if (refusal) {
      this.nextSignInError = null;
      throw refusal;
    }
    this.signedIn = true;
    for (const fn of this.listeners) fn();
    return this.user();
  },
  signOut() {
    this.signedIn = false;
    for (const fn of this.listeners) fn();
  },
  async idToken() {
    if (!this.signedIn) throw new BuddyError('signed_out', 'Sign in to use Buddy.');
    return 'e2e-token';
  },
  onChange(fn) {
    this.listeners.push(fn);
  },
};

const SERVER_SETTINGS = { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };

const cloud = {
  server: { ...SERVER_SETTINGS }, // what the server answers when the app asks for this person's free-mode settings
  free: { ...SERVER_SETTINGS }, // what the app kept the last time it asked, which is what last() gives back
  forgets: 0, // how often the app forgot the kept settings, as it does when someone signs out
  asks: [],
  adminConfig: { enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  adminUsers: [{
    uid: 'u1', email: 'rahul@example.com', name: 'Rahul', joined: '2026-10-01T10:00:00.000Z',
    lastActive: '2026-10-07T06:00:00.000Z', blocked: false, usedToday: 3,
  }],
  admin: {
    async settings() {
      return {
        config: cloud.adminConfig,
        providers: PROVIDER_IDS.map((id) => ({
          id, label: PROVIDERS[id].label, hasKey: id === 'anthropic', fallbackModels: PROVIDERS[id].fallbackModels,
        })),
      };
    },
    async save(patch) {
      if (patch.dailyRequests === 0) throw new BuddyError('bad_request', 'The daily limit must be a whole number from 1 to 10000.');
      cloud.adminConfig = { ...cloud.adminConfig, ...patch };
      return cloud.admin.settings();
    },
    async models() {
      return { models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'], live: true };
    },
    async users() {
      return { users: cloud.adminUsers };
    },
    async block(uid, blocked) {
      const user = cloud.adminUsers.find((u) => u.uid === uid);
      user.blocked = blocked;
      return { user };
    },
  },
  listeners: [],
  last() {
    return account.signedIn ? this.free : null;
  },
  async settings() {
    if (account.signedIn) this.free = { ...this.server };
    return this.last();
  },
  forget() {
    this.forgets += 1;
    for (const fn of this.listeners) fn();
  },
  heard: '', // what the server writes down from the next recording
  recordings: [], // { audio, mime, signal } of each recording the app sent to be written down
  async transcribe({ audio, mime }, { signal } = {}) {
    this.recordings.push({ audio, mime, signal });
    return this.heard;
  },
  async ask(action, input) {
    this.asks.push({ action, input });
    // The panel's chat request comes back read, as the app's free route reads it (src/main/cloud.js).
    if (action === 'chat') return { text: 'A free answer', model: 'free-model', chat: parseChat('A free answer') };
    return { text: 'A free answer', model: 'free-model' };
  },
  onChange(fn) {
    this.listeners.push(fn);
  },
};

// cloud.json's values: the account and the server above are what use them, so they only make Buddy "set up".
const cloudConfig = { serverUrl: 'https://e2e.invalid', firebaseApiKey: 'e2e', googleClientId: 'e2e', googleClientSecret: 'e2e' };

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const WATCHDOG_MS = 120_000;

let finished = false;

/**
 * Remove the temporary settings folder and exit. Chromium writes a few profile
 * files into it while it shuts down, after this function has returned, so a
 * small helper that outlives us removes the folder once more.
 */
function finish(code) {
  if (finished) return; // the first exit code stands
  finished = true;
  try {
    fs.rmSync(userData, { recursive: true, force: true });
    // Windows has no sh: there the few files Chromium writes last stay in the temporary folder.
    if (process.platform !== 'win32') {
      const sweep = 'while kill -0 "$1" 2>/dev/null; do sleep 0.1; done; sleep 1; rm -rf "$2"';
      spawn('/bin/sh', ['-c', sweep, 'sh', String(process.pid), userData], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch (err) {
    // Windows does not let go of files Electron still holds open (EBUSY): they stay in the temporary folder.
    console.warn(`e2e: could not remove ${userData} yet (${err.code})`);
  } finally {
    app.exit(code); // whatever happened above: a run that cannot exit would leave the buddy on screen
  }
}

// A check that hangs must fail the run, not leave a buddy floating on screen.
setTimeout(() => {
  console.error('e2e failed: timed out');
  finish(1);
}, WATCHDOG_MS);

async function waitFor(fn, what, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return;
    await delay(50);
  }
  throw new Error(`timed out waiting for ${what}`);
}

(async () => {
  try {
    const { start } = require('../../src/main/main.js');
    const ctx = await start({
      singleInstance: false,
      animate: false,
      helper,
      clipboard,
      globalShortcut,
      account,
      cloud,
      cloudConfig,
      systemPreferences,
      loginItems: { get: () => false, set: (on) => loginCalls.push(on) },
    });
    Object.assign(ctx, { helper, clipboard, globalShortcut, loginCalls, systemPreferences });
    const dir = path.join(__dirname, 'checks');
    for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js')).sort()) {
      await require(path.join(dir, file))(ctx, { assert, delay, waitFor });
      console.log(`ok - ${file}`);
    }
    console.log('e2e: all checks passed');
    finish(0);
  } catch (err) {
    console.error('e2e failed:', err);
    finish(1);
  }
})();
