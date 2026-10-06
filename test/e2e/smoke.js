'use strict';

// End-to-end smoke test: starts the real app (src/main/main.js) with a fresh
// settings folder and fakes for the parts that touch the system (the Mac
// helper, the login item), then runs every check in test/e2e/checks in order.
//
//   npm run test:e2e

const { app } = require('electron');
const assert = require('node:assert');
const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

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
      loginItems: { get: () => false, set: (on) => loginCalls.push(on) },
    });
    Object.assign(ctx, { helper, loginCalls });
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
