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

test('unregister releases the shortcut, and register() with no argument puts the same one back', () => {
  const globalShortcut = fakeGlobalShortcut();
  const onPress = () => {};
  const shortcut = createShortcut({ globalShortcut, onPress });
  shortcut.register('CommandOrControl+Shift+B');
  shortcut.unregister();
  assert.deepStrictEqual([...globalShortcut.registered.keys()], [], 'nothing is registered with the system');
  assert.strictEqual(shortcut.current(), null);
  assert.strictEqual(shortcut.register(), true);
  assert.strictEqual(globalShortcut.registered.get('CommandOrControl+Shift+B'), onPress, 'the same one, with the same handler');
  assert.strictEqual(shortcut.current(), 'CommandOrControl+Shift+B');
});

test('unregister with nothing registered does not ask the system to release anything', () => {
  const globalShortcut = fakeGlobalShortcut();
  const released = [];
  const unregister = globalShortcut.unregister;
  globalShortcut.unregister = (accelerator) => {
    released.push(accelerator);
    unregister(accelerator);
  };
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.unregister(); // never registered
  shortcut.register('Alt+Space');
  shortcut.unregister();
  shortcut.unregister(); // already released
  assert.deepStrictEqual(released, ['Alt+Space']);
});

test('register() with nothing to put back fails instead of throwing', () => {
  const shortcut = createShortcut({ globalShortcut: fakeGlobalShortcut(), onPress: () => {} });
  assert.strictEqual(shortcut.register(), false);
  assert.strictEqual(shortcut.current(), null);
});

test('while released, a new shortcut that is taken fails and nothing is left registered', () => {
  const globalShortcut = fakeGlobalShortcut(['Command+Space']);
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.unregister();
  assert.strictEqual(shortcut.register('Command+Space'), false);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(shortcut.register(), true, 'the one that was released is still the one to put back');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['Alt+Space']);
});

test('a new shortcut registered while released becomes the one to put back', () => {
  const globalShortcut = fakeGlobalShortcut();
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.unregister();
  shortcut.register('CommandOrControl+Shift+B'); // for example, to see that it is free
  shortcut.unregister();
  assert.strictEqual(shortcut.register(), true);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['CommandOrControl+Shift+B']);
});
