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
