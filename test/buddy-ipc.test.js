'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerBuddyIpc } = require('../src/main/ipc/buddy');

function setup() {
  const handlers = {};
  const register = (channel, fn) => {
    handlers[channel] = fn;
  };
  const page = { name: 'the buddy page' };
  const calls = [];
  const buddy = {
    window: () => ({ webContents: page }),
    beginDrag: (p) => calls.push(['beginDrag', p]),
    dragTo: (p) => calls.push(['dragTo', p]),
  };
  registerBuddyIpc({ ipcMain: { on: register, handle: register }, buddy, characters: {}, store: { get: () => 'boy-1' }, onClick() {} });
  return { handlers, calls, fromPage: { sender: page }, fromElsewhere: { sender: {} } };
}

test('drag messages with finite numbers move the window', () => {
  const { handlers, calls, fromPage } = setup();
  handlers['buddy:drag-start'](fromPage, { x: 10, y: 20 });
  handlers['buddy:drag-move'](fromPage, { x: 300.5, y: -4 });
  assert.deepStrictEqual(calls, [['beginDrag', { x: 10, y: 20 }], ['dragTo', { x: 300.5, y: -4 }]]);
});

test('drag messages that are not two finite numbers are ignored', () => {
  const { handlers, calls, fromPage } = setup();
  const bad = [{ x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: 1, y: -Infinity }, { x: '5', y: 1 }, { x: 1 }, {}, null, undefined, 'x'];
  for (const point of bad) {
    handlers['buddy:drag-start'](fromPage, point);
    handlers['buddy:drag-move'](fromPage, point);
  }
  assert.deepStrictEqual(calls, []);
});

test('only the buddy page may send drag messages', () => {
  const { handlers, calls, fromElsewhere } = setup();
  handlers['buddy:drag-start'](fromElsewhere, { x: 1, y: 2 });
  handlers['buddy:drag-move'](fromElsewhere, { x: 1, y: 2 });
  assert.deepStrictEqual(calls, []);
});
