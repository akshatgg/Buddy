'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerNotchIpc } = require('../src/main/ipc/notch');

function setup({ hasWindow = true } = {}) {
  const handlers = {};
  const page = { name: 'the notch page' };
  const calls = [];
  const notch = {
    window: () => (hasWindow ? { webContents: page } : null),
    setHover: (over) => calls.push(['setHover', over]),
  };
  registerNotchIpc({
    ipcMain: { on: (channel, fn) => { handlers[channel] = fn; } },
    notch,
    onClick: () => calls.push(['click']),
  });
  return { handlers, calls, fromPage: { sender: page }, fromElsewhere: { sender: {} } };
}

test('the notch page tells main two things: whether the pointer is over the shape, and a click', () => {
  const { handlers } = setup();
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['notch:click', 'notch:hover']);
});

test('hover goes to the notch window as true or false', () => {
  const { handlers, calls, fromPage } = setup();
  for (const over of [true, false, 1, 0, 'yes', undefined, null]) handlers['notch:hover'](fromPage, over);
  assert.deepStrictEqual(calls, [
    ['setHover', true], ['setHover', false], ['setHover', true], ['setHover', false], ['setHover', true],
    ['setHover', false], ['setHover', false],
  ]);
});

test('a click on the shape calls onClick, as a click on the floating buddy does', () => {
  const { handlers, calls, fromPage } = setup();
  handlers['notch:click'](fromPage);
  assert.deepStrictEqual(calls, [['click']]);
});

test('only the notch page may send these; with no notch window nobody may', () => {
  const { handlers, calls, fromElsewhere } = setup();
  handlers['notch:hover'](fromElsewhere, true);
  handlers['notch:click'](fromElsewhere);
  assert.deepStrictEqual(calls, []);
  const none = setup({ hasWindow: false });
  none.handlers['notch:hover'](none.fromPage, true);
  none.handlers['notch:click'](none.fromPage);
  assert.deepStrictEqual(none.calls, []);
});
