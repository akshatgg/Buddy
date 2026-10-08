'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, DEFAULTS } = require('../src/main/store');
const platform = require('../src/main/platform');
const { onPlatform } = require('./helpers/platform');

/** A settings file path inside a fresh temporary folder, which is removed when the test ends. */
function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-store-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'nested', 'settings.json');
}

test('starts from the defaults when there is no file', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.deepStrictEqual(store.all(), DEFAULTS);
  assert.strictEqual(store.get('shortcut'), platform.defaultShortcut);
});

test('the default shortcut is ⌥Space on the Mac and Ctrl+Shift+Space on Windows', () => {
  const file = path.join(__dirname, '..', 'src', 'main', 'store.js');
  assert.strictEqual(onPlatform('darwin', file, (m) => m.DEFAULTS.shortcut), 'Alt+Space');
  assert.strictEqual(onPlatform('win32', file, (m) => m.DEFAULTS.shortcut), 'Ctrl+Shift+Space');
});

test('set merges, saves to disk, and survives a reload', (t) => {
  const file = tmpFile(t);
  const store = createStore({ file });
  store.set({ buddyOn: true, models: { anthropic: 'claude-sonnet-5-5' } });
  const again = createStore({ file });
  assert.strictEqual(again.get('buddyOn'), true);
  assert.deepStrictEqual(again.get('models'), { anthropic: 'claude-sonnet-5-5' });
  assert.strictEqual(again.get('size'), 'medium');
});

test('all() is a copy: changing it does not change the store', (t) => {
  const store = createStore({ file: tmpFile(t) });
  store.all().models.x = 'y';
  assert.deepStrictEqual(store.get('models'), {});
});

test('a damaged file falls back to the defaults', (t) => {
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(createStore({ file }).all(), DEFAULTS);
});

test('updates are checked for unless turned off, and no version has run yet', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.strictEqual(store.get('checkForUpdates'), true);
  assert.strictEqual(store.get('lastUpdateCheck'), 0);
  assert.strictEqual(store.get('lastRunVersion'), null);
});

test('Buddy lives in the notch unless the person chose Floating (Settings → Buddy → Where Buddy lives)', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.strictEqual(store.get('home'), 'notch');
  // A settings file from before the notch has no such setting: the notch for that person too.
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ onboarded: true, buddyOn: true }));
  assert.strictEqual(createStore({ file }).get('home'), 'notch');
});

test('the panel listens as it opens unless that is turned off (Settings → General)', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.strictEqual(store.get('listenOnOpen'), true);
  // A settings file from before voice has no such setting: it is on for that person too.
  const file = tmpFile(t);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify({ onboarded: true, buddyOn: true }));
  assert.strictEqual(createStore({ file }).get('listenOnOpen'), true);
});

test('no projects for Claude Code yet, and no last pick', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.deepStrictEqual(store.get('projects'), []);
  assert.strictEqual(store.get('lastProject'), null);
});

test('Claude Code is not watched until the person asks; the port and the token come with the first watch', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.strictEqual(store.get('watchClaudeCode'), false);
  assert.strictEqual(store.get('claudeHookPort'), null);
  assert.strictEqual(store.get('claudeHookToken'), null);
});
