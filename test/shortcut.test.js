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

test('unregister releases the shortcut, and registering it again takes it back', () => {
  const globalShortcut = fakeGlobalShortcut();
  const onPress = () => {};
  const shortcut = createShortcut({ globalShortcut, onPress });
  shortcut.register('CommandOrControl+Shift+B');
  shortcut.unregister();
  assert.deepStrictEqual([...globalShortcut.registered.keys()], [], 'nothing is registered with the system');
  assert.strictEqual(shortcut.current(), null);
  assert.strictEqual(shortcut.register('CommandOrControl+Shift+B'), true);
  assert.strictEqual(globalShortcut.registered.get('CommandOrControl+Shift+B'), onPress, 'with the same handler');
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

test('registering no accelerator (none given, or a blank setting) fails instead of throwing, and registers nothing', () => {
  const globalShortcut = fakeGlobalShortcut();
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  for (const nothing of [undefined, null, '']) assert.strictEqual(shortcut.register(nothing), false, String(nothing));
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(shortcut.current(), null);
});

test('register() with no accelerator takes nothing back after unregister(): the caller passes the saved one', () => {
  const globalShortcut = fakeGlobalShortcut();
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.unregister();
  assert.strictEqual(shortcut.register(), false, 'the one that was let go is not remembered');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(shortcut.current(), null);
});

test('register() with no accelerator while one is registered leaves it as it is', () => {
  const globalShortcut = fakeGlobalShortcut();
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  assert.strictEqual(shortcut.register(), false);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['Alt+Space']);
  assert.strictEqual(shortcut.current(), 'Alt+Space');
});

test('while released, a new shortcut that is taken fails and nothing is left registered', () => {
  const globalShortcut = fakeGlobalShortcut(['Command+Space']);
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.unregister();
  assert.strictEqual(shortcut.register('Command+Space'), false);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(shortcut.current(), null);
});
