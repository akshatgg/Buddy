'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createShortcut } = require('../src/main/shortcut');

function fakeGlobalShortcut(taken = []) {
  const registered = new Map();
  return {
    registered,
    register(accelerator, fn) {
      if (accelerator === 'Bogus+') throw new TypeError('conversion failure');
      if (taken.includes(accelerator)) return false;
      registered.set(accelerator, fn);
      return true;
    },
    unregister(accelerator) {
      registered.delete(accelerator);
    },
  };
}

test('registers the shortcut with the press handler', () => {
  const globalShortcut = fakeGlobalShortcut();
  const onPress = () => {};
  const shortcut = createShortcut({ globalShortcut, onPress });
  assert.strictEqual(shortcut.register('Alt+Space'), true);
  assert.strictEqual(globalShortcut.registered.get('Alt+Space'), onPress);
  assert.strictEqual(shortcut.current(), 'Alt+Space');
});

test('changing it removes the old one', () => {
  const globalShortcut = fakeGlobalShortcut();
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.register('CommandOrControl+Shift+B');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['CommandOrControl+Shift+B']);
});

test('a taken shortcut fails and keeps the old one', () => {
  const globalShortcut = fakeGlobalShortcut(['Command+Space']);
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  assert.strictEqual(shortcut.register('Command+Space'), false);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['Alt+Space']);
  assert.strictEqual(shortcut.current(), 'Alt+Space');
});

test('a malformed shortcut fails instead of throwing', () => {
  const shortcut = createShortcut({ globalShortcut: fakeGlobalShortcut(), onPress: () => {} });
  assert.strictEqual(shortcut.register('Bogus+'), false);
});
