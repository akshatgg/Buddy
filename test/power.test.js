'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPower, electronLoginItems, loginItemsFor } = require('../src/main/power');

function setup({ buddyOn = false, login = false, failing = null } = {}) {
  const settings = { buddyOn };
  const calls = [];
  const changes = [];
  let registered = login;
  const power = createPower({
    store: { get: (k) => settings[k], set: (patch) => Object.assign(settings, patch) },
    loginItems: {
      get: () => {
        if (failing === 'get') throw new Error('the login item list is not available');
        return registered;
      },
      set: (on) => {
        calls.push(on);
        if (failing === 'set') throw new Error('the Mac refused the login item');
        registered = on;
      },
    },
    onChange: (on) => changes.push(on),
  });
  return { power, settings, calls, changes, isRegistered: () => registered };
}

test('turning on saves it, adds the login item and shows the buddy', () => {
  const s = setup();
  s.power.setOn(true);
  assert.strictEqual(s.settings.buddyOn, true);
  assert.strictEqual(s.power.isOn(), true);
  assert.deepStrictEqual(s.calls, [true]);
  assert.deepStrictEqual(s.changes, [true]);
});

test('turning off saves it and removes the login item', () => {
  const s = setup({ buddyOn: true, login: true });
  s.power.setOn(false);
  assert.strictEqual(s.settings.buddyOn, false);
  assert.deepStrictEqual(s.calls, [false]);
  assert.deepStrictEqual(s.changes, [false]);
});

test('at launch, a buddy that is on gets its login item back', () => {
  const s = setup({ buddyOn: true, login: false });
  s.power.syncAtLaunch();
  assert.deepStrictEqual(s.calls, [true]);
});

test('at launch, a buddy that is off gets a login item that is still there removed', () => {
  const s = setup({ buddyOn: false, login: true });
  s.power.syncAtLaunch();
  assert.deepStrictEqual(s.calls, [false]);
  assert.strictEqual(s.isRegistered(), false);
});

test('at launch, nothing changes when the login item already agrees with the setting', () => {
  const off = setup({ buddyOn: false, login: false });
  off.power.syncAtLaunch();
  const fine = setup({ buddyOn: true, login: true });
  fine.power.syncAtLaunch();
  assert.deepStrictEqual(off.calls, []);
  assert.deepStrictEqual(fine.calls, []);
});

test('syncing at launch never changes the setting or shows or hides the buddy', () => {
  for (const [buddyOn, login] of [[true, false], [false, true], [true, true], [false, false]]) {
    const s = setup({ buddyOn, login });
    s.power.syncAtLaunch();
    assert.strictEqual(s.settings.buddyOn, buddyOn);
    assert.deepStrictEqual(s.changes, []);
  }
});

test('a login item the Mac refuses to add is logged; the buddy still turns on and the setting is kept', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ failing: 'set' });
  assert.doesNotThrow(() => s.power.setOn(true));
  assert.strictEqual(s.settings.buddyOn, true, 'the setting is kept');
  assert.deepStrictEqual(s.changes, [true], 'and the buddy is shown');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not add the login item:', 'the Mac refused the login item'],
  ]);
});

test('a login item the Mac refuses to remove is logged; the buddy still turns off and the setting is kept', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ buddyOn: true, login: true, failing: 'set' });
  assert.doesNotThrow(() => s.power.setOn(false));
  assert.strictEqual(s.settings.buddyOn, false);
  assert.deepStrictEqual(s.changes, [false]);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not remove the login item:', 'the Mac refused the login item'],
  ]);
});

test('at launch, a login item that cannot be changed is logged and does not stop Buddy starting', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const on = setup({ buddyOn: true, login: false, failing: 'set' });
  assert.doesNotThrow(() => on.power.syncAtLaunch());
  const off = setup({ buddyOn: false, login: true, failing: 'set' });
  assert.doesNotThrow(() => off.power.syncAtLaunch());
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not add the login item:', 'the Mac refused the login item'],
    ['[buddy] could not remove the login item:', 'the Mac refused the login item'],
  ]);
  assert.strictEqual(on.settings.buddyOn, true);
  assert.strictEqual(off.settings.buddyOn, false);
});

test('at launch, a login item list that cannot be read is logged and does not stop Buddy starting', (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ buddyOn: true, failing: 'get' });
  assert.doesNotThrow(() => s.power.syncAtLaunch());
  assert.deepStrictEqual(s.calls, []);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not read the login item:', 'the login item list is not available'],
  ]);
});

// ---- which login items the app uses ----

/** An app that records what is asked of its login item settings. */
function fakeApp({ isPackaged, openAtLogin = false }) {
  const asked = [];
  let current = openAtLogin;
  return {
    isPackaged,
    asked,
    getLoginItemSettings() {
      asked.push('get');
      return { openAtLogin: current };
    },
    setLoginItemSettings(settings) {
      asked.push(settings);
      current = settings.openAtLogin;
    },
  };
}

test('the installed app uses its real login item', (t) => {
  const info = t.mock.method(console, 'info', () => {});
  const app = fakeApp({ isPackaged: true });
  const items = loginItemsFor(app);
  assert.strictEqual(items.get(), false);
  items.set(true);
  assert.strictEqual(items.get(), true);
  items.set(false);
  assert.deepStrictEqual(app.asked, ['get', { openAtLogin: true }, 'get', { openAtLogin: false }]);
  assert.strictEqual(info.mock.callCount(), 0, 'nothing to explain');
});

test('electronLoginItems reads and writes openAtLogin', () => {
  const app = fakeApp({ isPackaged: true, openAtLogin: true });
  const items = electronLoginItems(app);
  assert.strictEqual(items.get(), true);
  items.set(false);
  assert.deepStrictEqual(app.asked, ['get', { openAtLogin: false }]);
});

test('a development run has no login item: it says there is none and never touches the app', (t) => {
  const info = t.mock.method(console, 'info', () => {});
  const app = fakeApp({ isPackaged: false });
  const items = loginItemsFor(app);
  assert.strictEqual(items.get(), false);
  items.set(true);
  items.set(false);
  assert.strictEqual(items.get(), false, 'even right after asking for one');
  assert.deepStrictEqual(app.asked, [], 'Electron.app is never registered as a login item');
  assert.strictEqual(info.mock.callCount(), 1, 'one line, when the choice is made');
  assert.match(info.mock.calls[0].arguments[0], /login item is only used by the installed app/);
});

test('a development run drives power without ever registering anything', (t) => {
  t.mock.method(console, 'info', () => {});
  const app = fakeApp({ isPackaged: false, openAtLogin: true }); // a stray one, left by an earlier run
  const settings = { buddyOn: true };
  const power = createPower({
    store: { get: (k) => settings[k], set: (patch) => Object.assign(settings, patch) },
    loginItems: loginItemsFor(app),
    onChange() {},
  });
  power.syncAtLaunch();
  power.setOn(false);
  power.setOn(true);
  assert.deepStrictEqual(app.asked, []);
});
