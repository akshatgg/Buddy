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
    openSettings: (section) => calls.push(['openSettings', section]),
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

test('an error that Settings can fix reaches the panel with its code next to its message, so it can offer Open Settings', async () => {
  for (const [code, message] of [
    ['no_key', 'Add your API key in Settings first.'],
    ['bad_key', 'Your Claude key was rejected. Check it in Settings.'],
    ['no_credit', 'Your Claude account is out of credit.'],
    ['bad_model', "This model isn't available for your key. Pick another in Settings."],
    ['no_vision', "This model can't read screenshots. Pick another in Settings."],
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
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]]);
  s.listeners['panel:open-settings']({ sender: { name: 'someone else' } });
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]], 'and only for the panel page');
});

test("Open Settings goes to the AI section for a key, model or free-mode problem, and to the start otherwise", () => {
  for (const [code, section] of [
    ['no_key', 'ai'], ['bad_key', 'ai'], ['no_credit', 'ai'], ['bad_model', 'ai'], ['no_vision', 'ai'], ['need_key', 'ai'],
    ['free_off', 'ai'], ['signed_out', undefined], ['not_set_up', undefined], [undefined, undefined], ['constructor', undefined], [7, undefined],
  ]) {
    const s = setup();
    s.listeners['panel:open-settings'](s.fromPanel, code);
    assert.deepStrictEqual(s.calls, ['hide', ['openSettings', section]], String(code));
  }
});

test('Esc and the close button close the panel through actions.dismiss, which on Windows also hands the keyboard back', () => {
  const dismissed = [];
  const s = setup({ dismiss: async () => dismissed.push('dismiss') });
  s.listeners['panel:close'](s.fromPanel);
  s.listeners['panel:close']({ sender: { name: 'someone else' } });
  assert.deepStrictEqual(dismissed, ['dismiss'], 'only for the panel page');
  assert.deepStrictEqual(s.calls, [], 'and not by hiding the window behind its back');
});
