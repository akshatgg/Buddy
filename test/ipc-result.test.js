'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { guarded } = require('../src/main/ipc/result');

function setup() {
  const handlers = {};
  const ipcMain = { handle: (channel, fn) => { handlers[channel] = fn; } };
  const handle = guarded(ipcMain, (webContents) => webContents === 'ours');
  return { handlers, handle };
}

test('answers { ok: true } with the handler value', async () => {
  const { handlers, handle } = setup();
  handle('x', async (a, b) => ({ sum: a + b }));
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }, 2, 3), { ok: true, sum: 5 });
});

test('a handler that returns nothing answers { ok: true }', async () => {
  const { handlers, handle } = setup();
  handle('x', () => {});
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }), { ok: true });
});

test('errors become { ok: false, error } with the code and message', async () => {
  const { handlers, handle } = setup();
  handle('x', () => { throw new BuddyError('bad_key', 'Your Claude key was rejected.'); });
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }), {
    ok: false,
    error: { code: 'bad_key', message: 'Your Claude key was rejected.' },
  });
});

test('other windows are refused without running the handler', async () => {
  const { handlers, handle } = setup();
  let ran = false;
  handle('x', () => { ran = true; });
  const r = await handlers.x({ sender: 'someone else' });
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'not_allowed');
  assert.strictEqual(ran, false);
});
