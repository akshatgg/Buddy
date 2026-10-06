'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildMenuTemplate } = require('../src/main/tray');

function handlers() {
  const calls = [];
  return {
    calls,
    setVisible: (v) => calls.push(['setVisible', v]),
    openSettings: () => calls.push(['openSettings']),
    setBuddyOn: (on) => calls.push(['setBuddyOn', on]),
    quit: () => calls.push(['quit']),
  };
}

const labels = (template) => template.filter((i) => i.label).map((i) => i.label);

test('menu when the buddy is on and showing', () => {
  const t = buildMenuTemplate({ buddyOn: true, visible: true }, handlers());
  assert.deepStrictEqual(labels(t), ['Hide buddy', 'Settings…', 'Turn off buddy', 'Quit Buddy']);
  assert.strictEqual(t[0].enabled, true);
});

test('menu when the buddy is off', () => {
  const t = buildMenuTemplate({ buddyOn: false, visible: false }, handlers());
  assert.deepStrictEqual(labels(t), ['Show buddy', 'Settings…', 'Turn on buddy', 'Quit Buddy']);
  assert.strictEqual(t[0].enabled, false);
});

test('menu items call their handlers', () => {
  const h = handlers();
  const t = buildMenuTemplate({ buddyOn: true, visible: true }, h);
  for (const item of t) if (item.click) item.click();
  assert.deepStrictEqual(h.calls, [['setVisible', false], ['openSettings'], ['setBuddyOn', false], ['quit']]);
});

test('the menu bar icon files exist and are PNGs', () => {
  for (const name of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', name));
    assert.strictEqual(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  }
});
