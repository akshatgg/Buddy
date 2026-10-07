'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerPanelIpc } = require('../src/main/ipc/panel');

const PANEL_PAGE = { name: 'the panel page' };
const SOMEONE_ELSE = { sender: { name: 'someone else' } };

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

test('the panel asks through three channels; the old ones are gone', () => {
  const s = setup();
  assert.deepStrictEqual(Object.keys(s.handlers).sort(), ['panel:act', 'panel:drop-selection', 'panel:send']);
  assert.deepStrictEqual(Object.keys(s.listeners).sort(), ['panel:close', 'panel:open-settings']);
});

test('a message goes to actions.send, and the answer is { ok: true } once it is in: the state events show the rest', async () => {
  const sent = [];
  const s = setup({ send: async (message) => { sent.push(message); return {}; } });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'mail to my boss'), { ok: true });
  // Anything but text is an empty message.
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, { text: 'x' }), { ok: true });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel), { ok: true });
  assert.deepStrictEqual(sent, ['mail to my boss', '', '']);
});

test('a button goes to actions.act with its item, and ✕ on the selection to actions.dropSelection', async () => {
  const done = [];
  const s = setup({
    act: async (id, button) => { done.push(['act', id, button]); return {}; },
    dropSelection: () => { done.push(['dropSelection']); return {}; },
  });
  assert.deepStrictEqual(await s.handlers['panel:act'](s.fromPanel, 3, 'insert'), { ok: true });
  assert.deepStrictEqual(await s.handlers['panel:drop-selection'](s.fromPanel), { ok: true });
  assert.deepStrictEqual(done, [['act', 3, 'insert'], ['dropSelection']]);
});

test('a refusal reaches the panel with its code and its message, and nothing else', async () => {
  const s = setup({
    send: async () => { throw Object.assign(new BuddyError('bad_request', 'Wait for my answer first.'), { detail: 'inner', cause: new Error('x') }); },
    act: async () => { throw new BuddyError('bad_request', "That isn't there any more."); },
  });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'again'), {
    ok: false,
    error: { code: 'bad_request', message: 'Wait for my answer first.' },
  });
  assert.deepStrictEqual(await s.handlers['panel:act'](s.fromPanel, 9, 'copy'), {
    ok: false,
    error: { code: 'bad_request', message: "That isn't there any more." },
  });
});

test('an error that is not a BuddyError reaches the panel as a generic one: no internal text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = setup({ send: async () => { throw new Error('ENOENT: no such file or directory, open /Users/someone/keys.json'); } });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'mail'), {
    ok: false,
    error: { code: 'failed', message: 'Something went wrong. Try again.' },
  });
});

test('only the panel page may ask', async () => {
  let ran = false;
  const nope = async () => { ran = true; return {}; };
  const s = setup({ send: nope, act: nope, dropSelection: nope });
  for (const [channel, args] of [['panel:send', ['mail']], ['panel:act', [1, 'copy']], ['panel:drop-selection', []]]) {
    assert.deepStrictEqual(await s.handlers[channel](SOMEONE_ELSE, ...args), {
      ok: false,
      error: { code: 'not_allowed', message: 'Not allowed.' },
    }, channel);
  }
  assert.strictEqual(ran, false);
});

test('the gear shares one way to Settings with Open Settings: the panel steps aside, then Settings opens', () => {
  const s = setup();
  s.listeners['panel:open-settings'](s.fromPanel);
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]]);
  s.listeners['panel:open-settings'](SOMEONE_ELSE);
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]], 'and only for the panel page');
});

test('Open Settings goes to the AI section for a key, model or free-mode problem, to Permissions for a permission, and to the start otherwise', () => {
  for (const [code, section] of [
    ['no_key', 'ai'], ['bad_key', 'ai'], ['no_credit', 'ai'], ['bad_model', 'ai'], ['no_vision', 'ai'], ['need_key', 'ai'],
    ['free_off', 'ai'], ['no_accessibility', 'permissions'], ['no_screen_recording', 'permissions'],
    ['signed_out', undefined], ['not_set_up', undefined], [undefined, undefined], ['constructor', undefined], [7, undefined],
  ]) {
    const s = setup();
    s.listeners['panel:open-settings'](s.fromPanel, code);
    assert.deepStrictEqual(s.calls, ['hide', ['openSettings', section]], String(code));
  }
});

test('Esc and the close button close the panel through actions.dismiss, which ends the chat and on Windows hands the keyboard back', () => {
  const dismissed = [];
  const s = setup({ dismiss: async () => dismissed.push('dismiss') });
  s.listeners['panel:close'](s.fromPanel);
  s.listeners['panel:close'](SOMEONE_ELSE);
  assert.deepStrictEqual(dismissed, ['dismiss'], 'only for the panel page');
  assert.deepStrictEqual(s.calls, [], 'and not by hiding the window behind its back');
});
