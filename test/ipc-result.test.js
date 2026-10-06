'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { guarded, errorResult } = require('../src/main/ipc/result');

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

const FAILED = { ok: false, error: { code: 'failed', message: 'Something went wrong. Try again.' } };

test('a plain Error is logged and the page gets a generic answer, never the error text', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handlers, handle } = setup();
  const boom = new Error('ENOENT: no such file or directory, open /Users/someone/keys.json');
  handle('x', () => { throw boom; });
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }), FAILED);
  assert.strictEqual(logged.mock.callCount(), 1);
  assert.deepStrictEqual(logged.mock.calls[0].arguments, ['[buddy] unexpected error:', boom]);
});

test('a TypeError from a bug gets the same generic answer', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handlers, handle } = setup();
  handle('x', async (patch) => ({ name: patch.name }));
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }, null), FAILED);
  assert.strictEqual(logged.mock.callCount(), 1);
  assert.ok(logged.mock.calls[0].arguments[1] instanceof TypeError);
});

test('an error that only looks like a BuddyError (it has a code) is not trusted', async (t) => {
  t.mock.method(console, 'error', () => {});
  const { handlers, handle } = setup();
  handle('x', () => { throw Object.assign(new Error('There is no app to paste into.'), { code: 'not_frontmost' }); });
  assert.deepStrictEqual(await handlers.x({ sender: 'ours' }), FAILED);
});

test('errorResult: a BuddyError passes through; anything else is generic and logged', (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  assert.deepStrictEqual(errorResult(new BuddyError('no_key', 'Add your API key in Settings first.')), {
    ok: false,
    error: { code: 'no_key', message: 'Add your API key in Settings first.' },
  });
  assert.strictEqual(logged.mock.callCount(), 0);
  for (const odd of [undefined, null, 'a string', 42, {}]) assert.deepStrictEqual(errorResult(odd), FAILED);
  assert.strictEqual(logged.mock.callCount(), 5);
});

test('a refused window is answered not_allowed, and that is not logged as a bug', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const { handlers, handle } = setup();
  handle('x', () => {});
  assert.deepStrictEqual(await handlers.x({ sender: 'someone else' }), {
    ok: false,
    error: { code: 'not_allowed', message: 'Not allowed.' },
  });
  assert.strictEqual(logged.mock.callCount(), 0);
});
