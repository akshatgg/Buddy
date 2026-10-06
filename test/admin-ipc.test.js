'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerAdminIpc } = require('../src/main/ipc/admin');

const ADMIN_PAGE = 'the admin page';

/** registerAdminIpc with a fake server: `calls` records what reached it; `fails` makes every admin call fail. */
function setup({ fails = null } = {}) {
  const handlers = {};
  const calls = [];
  const answer = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (fails) throw fails;
    return value;
  };
  const cloud = {
    admin: {
      settings: answer('settings', { config: { enabled: false }, providers: [] }),
      save: answer('save', { config: { enabled: true }, providers: [] }),
      models: answer('models', { models: ['m'], live: true }),
      users: answer('users', { users: [] }),
      block: answer('block', { user: { uid: 'u1', blocked: true } }),
    },
    async settings(options) {
      calls.push(['refresh', options]);
      return null;
    },
  };
  registerAdminIpc({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    windows: { owns: (webContents, kind) => kind === 'admin' && webContents === ADMIN_PAGE },
    cloud,
  });
  const call = (channel, ...args) => handlers[channel]({ sender: ADMIN_PAGE }, ...args);
  return { handlers, calls, call };
}

test('only the admin window may use these calls', async () => {
  const s = setup();
  assert.deepStrictEqual(Object.keys(s.handlers).sort(), ['admin:block', 'admin:models', 'admin:save', 'admin:settings', 'admin:users']);
  for (const channel of Object.keys(s.handlers)) {
    assert.deepStrictEqual(await s.handlers[channel]({ sender: 'the Settings page' }, 'u1', true),
      { ok: false, error: { code: 'not_allowed', message: 'Not allowed.' } }, channel);
  }
  assert.deepStrictEqual(s.calls, []);
});

test('each call goes to the server, and its answer comes back', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('admin:settings'), { ok: true, config: { enabled: false }, providers: [] });
  assert.deepStrictEqual(await s.call('admin:models', 'groq'), { ok: true, models: ['m'], live: true });
  assert.deepStrictEqual(await s.call('admin:users'), { ok: true, users: [] });
  assert.deepStrictEqual(await s.call('admin:block', 'u1', true), { ok: true, user: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual(s.calls, [['settings'], ['models', 'groq'], ['users'], ['block', 'u1', true]]);
});

test("saving sends the switches, and the admin's own app follows them at once", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('admin:save', { enabled: true }), { ok: true, config: { enabled: true }, providers: [] });
  assert.deepStrictEqual(s.calls, [['save', { enabled: true }], ['refresh', { force: true }]]);
});

test('arguments that are not valid are refused before the server is asked', async () => {
  const s = setup();
  for (const [channel, args, message] of [
    ['admin:save', ['text'], 'Those settings are not valid.'],
    ['admin:save', [null], 'Those settings are not valid.'],
    ['admin:models', ['constructor'], 'Unknown AI provider.'],
    ['admin:block', ['', true], 'Pick a user to block or unblock.'],
    ['admin:block', ['u1', 'yes'], 'Pick a user to block or unblock.'],
    ['admin:block', [7, true], 'Pick a user to block or unblock.'],
  ]) {
    assert.deepStrictEqual(await s.call(channel, ...args), { ok: false, error: { code: 'bad_request', message } }, `${channel} ${JSON.stringify(args)}`);
  }
  assert.deepStrictEqual(s.calls, []);
});

test("the server's refusal reaches the page in its own words", async () => {
  const s = setup({ fails: new BuddyError('not_admin', 'Only the admin can do this.') });
  assert.deepStrictEqual(await s.call('admin:users'), { ok: false, error: { code: 'not_admin', message: 'Only the admin can do this.' } });
});
