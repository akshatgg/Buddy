'use strict';

// End-to-end smoke test: starts the real app (src/main/main.js) with a fresh
// settings folder and fakes for the parts that touch the system (the Mac
// helper, the clipboard, the global shortcut, the login item, the Google
// account and Buddy's server), then runs every check in test/e2e/checks in order.
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

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-e2e-'));
app.setPath('userData', userData);
fs.writeFileSync(path.join(userData, 'settings.json'), JSON.stringify({ onboarded: true, buddyOn: true }));

const loginCalls = [];
const helper = Object.assign(new EventEmitter(), {
  lastApp: null,
  calls: [],
  start() {},
  stop() {},
  async call(cmd, args) {
    this.calls.push({ cmd, args });
    if (cmd === 'permissions') return { accessibility: true, screenRecording: true };
    const err = new Error('There is no app to paste into in the e2e test.');
    err.code = 'not_frontmost';
    throw err;
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

// Nor may it grab the person's real shortcut (⌥Space), which another app of theirs may be using. This one only
// records what the app registers; a check calls the handler to press it.
const globalShortcut = {
  registered: new Map(), // accelerator -> handler
  register(accelerator, handler) {
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

// Nor may it sign in to Google or call Buddy's server: the app gets this account and this server. A check changes
// cloud.server, as the admin would, to see the app follow once it asks again, and signs out and in again.
const account = {
  signedIn: true,
  listeners: [],
  isSignedIn() {
    return this.signedIn;
  },
  user() {
    return this.signedIn ? { uid: 'e2e-user', email: 'e2e@example.com', name: 'E2E Tester' } : null;
  },
  async signIn() {
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
  async ask(action, input) {
    this.asks.push({ action, input });
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
  fs.rmSync(userData, { recursive: true, force: true });
  const sweep = 'while kill -0 "$1" 2>/dev/null; do sleep 0.1; done; sleep 1; rm -rf "$2"';
  spawn('/bin/sh', ['-c', sweep, 'sh', String(process.pid), userData], { detached: true, stdio: 'ignore' }).unref();
  app.exit(code);
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
      loginItems: { get: () => false, set: (on) => loginCalls.push(on) },
    });
    Object.assign(ctx, { helper, clipboard, globalShortcut, loginCalls });
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
