'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerNotchIpc } = require('../src/main/ipc/notch');

function setup({ hasWindow = true } = {}) {
  const handlers = {};
  const invokes = {};
  const page = { name: 'the notch page' };
  const calls = [];
  const notch = {
    window: () => (hasWindow ? { webContents: page } : null),
    setHover: (over) => calls.push(['setHover', over]),
    onHoverLost: (fn) => { notch.lose = fn; },
  };
  registerNotchIpc({
    ipcMain: { on: (channel, fn) => { handlers[channel] = fn; }, handle: (channel, fn) => { invokes[channel] = fn; } },
    notch,
    onClick: () => calls.push(['click']),
    onClaude: () => calls.push(['claude']),
    sleep: { hold: (reason, on) => calls.push(['hold', reason, on]) },
    characters: { modelBytes: (id) => `bytes of ${id}`, get: (id) => ({ accent: `${id} glow` }) },
    store: { get: (key) => (key === 'buddyId' ? 'boy-1' : undefined) },
  });
  return { handlers, invokes, calls, notch, fromPage: { sender: page }, fromElsewhere: { sender: {} } };
}

test('the notch page tells main three things: whether the pointer is over the shape, a click, and a click on Clawd', () => {
  const { handlers, calls, fromPage, fromElsewhere } = setup();
  assert.deepStrictEqual(Object.keys(handlers).sort(), ['notch:claude', 'notch:click', 'notch:hover']);
  handlers['notch:claude'](fromPage);
  handlers['notch:claude'](fromElsewhere);
  assert.deepStrictEqual(calls, [['claude']], 'Claude mode, for the notch page only');
});

test('hover goes to the notch window as true or false, and holds the sleep countdown while it lasts', () => {
  const { handlers, calls, fromPage } = setup();
  for (const over of [true, false, 1, 0, 'yes', undefined, null]) handlers['notch:hover'](fromPage, over);
  assert.deepStrictEqual(calls.filter(([name]) => name === 'setHover'), [
    ['setHover', true], ['setHover', false], ['setHover', true], ['setHover', false], ['setHover', true],
    ['setHover', false], ['setHover', false],
  ]);
  assert.deepStrictEqual(calls.filter(([name]) => name === 'hold').map(([, , on]) => on), [true, false, true, false, true, false, false]);
  assert.ok(calls.every(([name, reason]) => name !== 'hold' || reason === 'hover'));
});

test('the face asks for the model of the chosen character, with its glow; only the notch page may', () => {
  const { invokes, fromPage, fromElsewhere } = setup();
  assert.deepStrictEqual(invokes['notch:model'](fromPage), { bytes: 'bytes of boy-1', accent: 'boy-1 glow' });
  assert.throws(() => invokes['notch:model'](fromElsewhere), /not allowed/);
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

test('a notch that hid or went with the pointer on it lets go of the sleep hold', () => {
  const { calls, notch } = setup();
  notch.lose();
  assert.deepStrictEqual(calls, [['hold', 'hover', false]]);
});
