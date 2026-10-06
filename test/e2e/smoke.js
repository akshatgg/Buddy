'use strict';

// End-to-end smoke test: starts the real app (src/main/main.js) with a fresh
// settings folder and fakes for the parts that touch the system (the Mac
// helper, the login item), then runs every check in test/e2e/checks in order.
//
//   npm run test:e2e

const { app } = require('electron');
const assert = require('node:assert');
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
    app.exit(0);
  } catch (err) {
    console.error('e2e failed:', err);
    app.exit(1);
  }
})();
