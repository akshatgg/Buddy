'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createPower } = require('../src/main/power');

function setup({ buddyOn = false, login = false } = {}) {
  const settings = { buddyOn };
  const calls = [];
  const changes = [];
  let registered = login;
  const power = createPower({
    store: { get: (k) => settings[k], set: (patch) => Object.assign(settings, patch) },
    loginItems: { get: () => registered, set: (on) => { calls.push(on); registered = on; } },
    onChange: (on) => changes.push(on),
  });
  return { power, settings, calls, changes };
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

test('at launch, nothing changes when it is off or already registered', () => {
  const off = setup({ buddyOn: false });
  off.power.syncAtLaunch();
  const fine = setup({ buddyOn: true, login: true });
  fine.power.syncAtLaunch();
  assert.deepStrictEqual(off.calls, []);
  assert.deepStrictEqual(fine.calls, []);
});
