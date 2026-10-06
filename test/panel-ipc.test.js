'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerPanelIpc } = require('../src/main/ipc/panel');

const PANEL_PAGE = { name: 'the panel page' };

/** registerPanelIpc with fakes: `actions` is whatever the test wants the panel's calls to do. */
function setup(actions = {}) {
  const handlers = {};
  const listeners = {};
  const calls = [];
  registerPanelIpc({
    ipcMain: {
      handle: (channel, fn) => { handlers[channel] = fn; },
      on: (channel, fn) => { listeners[channel] = fn; },
    },
    panel: { window: () => ({ webContents: PANEL_PAGE }), hide: () => calls.push('hide') },
    actions,
    openSettings: () => calls.push('openSettings'),
  });
  return { handlers, listeners, calls, fromPanel: { sender: PANEL_PAGE } };
}

test('an answer comes back as { ok: true, result }', async () => {
  const s = setup({ run: async (action, input) => ({ text: `${action}: ${input.text}` }) });
  assert.deepStrictEqual(await s.handlers['panel:run'](s.fromPanel, 'fix', { text: 'me go' }), {
    ok: true,
    result: { text: 'fix: me go' },
  });
});

test('an error about the key reaches the panel with its code next to its message, so it can offer Open Settings', async () => {
  for (const [code, message] of [
    ['no_key', 'Add your API key in Settings first.'],
    ['bad_key', 'Your Claude key was rejected. Check it in Settings.'],
    ['no_credit', 'Your Claude account is out of credit.'],
  ]) {
    const s = setup({ run: async () => { throw new BuddyError(code, message); } });
    assert.deepStrictEqual(await s.handlers['panel:run'](s.fromPanel, 'write', { instruction: 'x' }), {
      ok: false,
      error: { code, message },
    }, code);
  }
});

test('the error holds the code and the message and nothing else', async () => {
  const s = setup({ run: async () => { throw Object.assign(new BuddyError('bad_key', 'Rejected.'), { detail: 'sk-secret', cause: new Error('inner') }); } });
  const r = await s.handlers['panel:run'](s.fromPanel, 'write', { instruction: 'x' });
  assert.deepStrictEqual(Object.keys(r).sort(), ['error', 'ok']);
  assert.deepStrictEqual(Object.keys(r.error).sort(), ['code', 'message']);
});

test('an error that is not a BuddyError reaches the panel as a generic one: no internal text, and not a code that offers Settings', async (t) => {
  t.mock.method(console, 'error', () => {});
  const leaky = [
    new Error('ENOENT: no such file or directory, open /Users/someone/keys.json'),
    Object.assign(new Error('Add your API key in Settings first.'), { code: 'no_key' }), // looks like a key error, but is not one
    new TypeError('x is not a function'),
  ];
  for (const err of leaky) {
    const s = setup({ run: async () => { throw err; } });
    assert.deepStrictEqual(await s.handlers['panel:run'](s.fromPanel, 'write', { instruction: 'x' }), {
      ok: false,
      error: { code: 'failed', message: 'Something went wrong. Try again.' },
    }, err.message);
  }
});

test('only the panel page may ask', async () => {
  let ran = false;
  const s = setup({ run: async () => { ran = true; return {}; } });
  assert.deepStrictEqual(await s.handlers['panel:run']({ sender: { name: 'someone else' } }, 'fix', { text: 'x' }), {
    ok: false,
    error: { code: 'not_allowed', message: 'Not allowed.' },
  });
  assert.strictEqual(ran, false);
});

test('the gear and the Open Settings button share one way to Settings: the panel steps aside, then Settings opens', () => {
  const s = setup();
  s.listeners['panel:open-settings'](s.fromPanel);
  assert.deepStrictEqual(s.calls, ['hide', 'openSettings']);
  s.listeners['panel:open-settings']({ sender: { name: 'someone else' } });
  assert.deepStrictEqual(s.calls, ['hide', 'openSettings'], 'and only for the panel page');
});
