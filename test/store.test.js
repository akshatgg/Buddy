'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, DEFAULTS } = require('../src/main/store');

function tmpFile() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-store-')), 'nested', 'settings.json');
}

test('starts from the defaults when there is no file', () => {
  const store = createStore({ file: tmpFile() });
  assert.deepStrictEqual(store.all(), DEFAULTS);
  assert.strictEqual(store.get('shortcut'), 'Alt+Space');
});

test('set merges, saves to disk, and survives a reload', () => {
  const file = tmpFile();
  const store = createStore({ file });
  store.set({ buddyOn: true, models: { anthropic: 'claude-sonnet-5-5' } });
  const again = createStore({ file });
  assert.strictEqual(again.get('buddyOn'), true);
  assert.deepStrictEqual(again.get('models'), { anthropic: 'claude-sonnet-5-5' });
  assert.strictEqual(again.get('size'), 'medium');
});

test('all() is a copy: changing it does not change the store', () => {
  const store = createStore({ file: tmpFile() });
  store.all().models.x = 'y';
  assert.deepStrictEqual(store.get('models'), {});
});

test('a damaged file falls back to the defaults', () => {
  const file = tmpFile();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, '{not json');
  assert.deepStrictEqual(createStore({ file }).all(), DEFAULTS);
});
