'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerAdminIpc } = require('../src/main/ipc/admin');

const ADMIN_PAGE = 'the admin page';
const tick = () => new Promise((resolve) => setImmediate(resolve));

/**
 * registerAdminIpc with a fake server: `calls` records what reached it; `fails` makes every admin call fail;
 * `refreshFails` makes the app's own fetch of the free settings (which follows a save) fail; `voiceOn` is what the
 * server says about voice.
 */
function setup({ fails = null, refreshFails = null, voiceOn = false } = {}) {
  const handlers = {};
  const calls = [];
  const answer = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (fails) throw fails;
    return value;
  };
  const cloud = {
    admin: {
      settings: answer('settings', { config: { enabled: false }, providers: [], voiceOn }),
      save: answer('save', { config: { enabled: true }, providers: [], voiceOn }),
      models: answer('models', { models: ['m'], live: true }),
      users: answer('users', { users: [] }),
      block: answer('block', { user: { uid: 'u1', blocked: true } }),
    },
    async settings(options) {
      calls.push(['refresh', options]);
      if (refreshFails) throw refreshFails;
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
  assert.deepStrictEqual(await s.call('admin:settings'), { ok: true, config: { enabled: false }, providers: [], voiceOn: false });
  assert.deepStrictEqual(await s.call('admin:models', 'groq'), { ok: true, models: ['m'], live: true });
  assert.deepStrictEqual(await s.call('admin:users'), { ok: true, users: [] });
  assert.deepStrictEqual(await s.call('admin:block', 'u1', true), { ok: true, user: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual(s.calls, [['settings'], ['models', 'groq'], ['users'], ['block', 'u1', true]]);
});

test("saving sends the switches, and the admin's own app follows them at once", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('admin:save', { enabled: true }), { ok: true, config: { enabled: true }, providers: [], voiceOn: false });
  assert.deepStrictEqual(s.calls, [['save', { enabled: true }], ['refresh', { force: true }]]);
});

test('whether voice is on reaches the Admin page as the server says it, with the settings and after a save', async () => {
  const s = setup({ voiceOn: true });
  assert.strictEqual((await s.call('admin:settings')).voiceOn, true);
  assert.strictEqual((await s.call('admin:save', { enabled: true })).voiceOn, true);
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

test('a save the server refuses fetches nothing again', async () => {
  const refusal = new BuddyError('bad_request', 'The daily limit must be a whole number from 1 to 10000.');
  const s = setup({ fails: refusal });
  assert.deepStrictEqual(await s.call('admin:save', { dailyRequests: 0 }),
    { ok: false, error: { code: 'bad_request', message: refusal.message } });
  assert.deepStrictEqual(s.calls, [['save', { dailyRequests: 0 }]], 'no refresh after a refused save');
});

test('a fetch that fails after a save does not fail the save: it is logged, by its kind only', async (t) => {
  const warned = t.mock.method(console, 'warn', () => {});
  for (const failure of [
    new BuddyError('network', "Couldn't reach Buddy's server. Check your internet."),
    new TypeError('x is not a function'),
  ]) {
    const s = setup({ refreshFails: failure });
    assert.deepStrictEqual(await s.call('admin:save', { enabled: true }), { ok: true, config: { enabled: true }, providers: [], voiceOn: false });
    await tick(); // the fetch is not waited for: let its failure be dealt with
  }
  assert.deepStrictEqual(warned.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not fetch the free settings:', 'network'],
    ['[buddy] could not fetch the free settings:', 'TypeError'],
  ], 'the code, or the name of the failure, and nothing it says');
});
