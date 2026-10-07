'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerUpdatesIpc } = require('../src/main/ipc/updates');

// A fake Electron whose app records quit() and lets the test fire will-quit, and whose dialog records what it was
// asked to show and answers `response`. Handlers are called as the guarded IPC calls them, with an event first.
function harness(state, { busy = false, response = 1, autoState = state, allowed = () => true, installs = true } = {}) {
  const handlers = {};
  const events = {};
  const calls = [];
  const dialogs = [];
  const saved = {};
  const app = {
    quit: () => calls.push('quit'),
    relaunch: () => calls.push('relaunch'),
    on: (name, fn) => { events[name] = fn; },
  };
  const updater = {
    state: () => state,
    install: (opts) => { calls.push(['install', opts]); return installs; },
    requestInstall: () => { calls.push('requestInstall'); return true; },
    installsItself: () => state.kind === 'installer' || state.kind === 'bundle',
    autoCheck: async () => { calls.push('autoCheck'); return autoState; },
    check: async () => { calls.push('check'); return state; },
  };
  const ipc = registerUpdatesIpc({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = (...args) => fn({ sender: 'page' }, ...args); } },
    electron: {
      app,
      shell: { openExternal: async (url) => calls.push(['open', url]) },
      dialog: { showMessageBox: async (o) => { dialogs.push(o); return { response }; } },
    },
    getUpdater: () => updater,
    allowed,
    store: { set: (patch) => Object.assign(saved, patch) },
    isBusy: () => busy,
  });
  return { handlers, events, calls, dialogs, saved, ipc, setState: (s) => { state = s; } };
}

const latest = { version: '1.3.0', url: 'https://github.com/akshatgg/Buddy/releases/tag/v1.3.0' };
const tick = () => new Promise((r) => setImmediate(r));

test('Update now quits first and runs the update only once the quit really happens', async () => {
  for (const kind of ['installer', 'bundle']) {
    const { handlers, events, calls } = harness({ kind, status: 'ready', latest });
    await handlers['updates:install']();
    assert.deepStrictEqual(calls, ['quit']);
    events['will-quit']();
    assert.deepStrictEqual(calls, ['quit', ['install', { relaunch: true }]]);
  }
});

test('a plain quit installs a ready update without opening Buddy again', () => {
  const { events, calls } = harness({ kind: 'installer', status: 'ready', latest });
  events['will-quit']();
  assert.deepStrictEqual(calls, [['install', { relaunch: false }]]);
});

test('Update now before the download is ready is remembered, then restarts Buddy when it is', async () => {
  const h = harness({ kind: 'bundle', status: 'downloading', latest });
  await h.handlers['updates:install']();
  assert.deepStrictEqual(h.calls, ['requestInstall']);
  h.ipc.stateChanged({ kind: 'bundle', status: 'downloading', latest, pending: true });
  assert.deepStrictEqual(h.calls, ['requestInstall']);
  const ready = { kind: 'bundle', status: 'ready', latest, pending: true };
  h.setState(ready);
  h.ipc.stateChanged(ready);
  assert.deepStrictEqual(h.calls, ['requestInstall', 'quit']);
});

test('a download that finishes while the panel is open does not restart Buddy under the person', () => {
  const ready = { kind: 'installer', status: 'ready', latest, pending: true };
  const h = harness(ready, { busy: true });
  h.ipc.stateChanged(ready);
  assert.deepStrictEqual(h.calls, []);
});

test('where Buddy cannot update itself, Update now opens the release page', async () => {
  const h = harness({ kind: 'download', status: 'available', latest });
  await h.handlers['updates:install']();
  assert.deepStrictEqual(h.calls, [['open', latest.url]]);
});

test('opening Buddy with an update out shows the Update now dialog, once per launch', async () => {
  const downloading = { kind: 'installer', status: 'downloading', currentVersion: '1.2.0', latest };
  const h = harness(downloading, { response: 0 });
  const launched = h.ipc.launchCheck();
  h.ipc.stateChanged(downloading);
  await launched;
  await tick();
  assert.strictEqual(h.dialogs.length, 1);
  assert.strictEqual(h.dialogs[0].message, 'Buddy 1.3.0 is available');
  assert.match(h.dialogs[0].detail, /You have 1\.2\.0/);
  assert.deepStrictEqual(h.dialogs[0].buttons, ['Update now', 'Later']);
  assert.deepStrictEqual(h.calls, ['autoCheck', 'requestInstall']); // "Update now" was chosen while it downloads
  h.ipc.stateChanged({ ...downloading, status: 'ready' });
  await tick();
  assert.strictEqual(h.dialogs.length, 1);
});

test('no dialog when Buddy is up to date, or when the person pressed Check now', async () => {
  const current = { kind: 'installer', status: 'current', currentVersion: '1.3.0', latest };
  const h = harness(current);
  const launched = h.ipc.launchCheck();
  h.ipc.stateChanged(current);
  await launched;
  await tick();
  assert.strictEqual(h.dialogs.length, 0);

  const available = { kind: 'download', status: 'available', currentVersion: '1.2.0', latest };
  const manual = harness(available);
  manual.ipc.stateChanged(available);
  await tick();
  assert.strictEqual(manual.dialogs.length, 0);
});

test('where Buddy cannot update itself, the dialog offers the download', async () => {
  const available = { kind: 'download', status: 'available', currentVersion: '1.2.0', latest };
  const h = harness(available, { response: 0 });
  const launched = h.ipc.launchCheck();
  h.ipc.stateChanged(available);
  await launched;
  await tick();
  assert.deepStrictEqual(h.dialogs[0].buttons, ['Download', 'Later']);
  assert.match(h.dialogs[0].detail, /Applications folder/);
  assert.deepStrictEqual(h.calls, ['autoCheck', ['open', latest.url]]);
});

test('Update now never does nothing: up to date or after an error, it checks again', async () => {
  for (const status of ['current', 'error', 'idle']) {
    const h = harness({ kind: 'bundle', status, latest: status === 'current' ? latest : null });
    await h.handlers['updates:install']();
    assert.deepStrictEqual(h.calls, ['requestInstall'], status);
  }
  const h = harness({ kind: 'download', status: 'current', latest });
  await h.handlers['updates:install']();
  assert.deepStrictEqual(h.calls, ['check']);
});

test('the calls answer the state the way every Settings call answers', async () => {
  const state = { kind: 'installer', status: 'current', currentVersion: '1.3.0', latest };
  const h = harness(state);
  assert.deepStrictEqual(await h.handlers['updates:state'](), { ok: true, ...state });
  assert.deepStrictEqual(await h.handlers['updates:check'](), { ok: true, ...state });
});

test('"Check for updates automatically" is saved, and switching it on checks', async () => {
  const h = harness({ kind: 'installer', status: 'idle', latest: null });
  assert.deepStrictEqual(await h.handlers['updates:set-auto'](false), { ok: true, checkForUpdates: false });
  assert.deepStrictEqual(h.saved, { checkForUpdates: false });
  assert.deepStrictEqual(h.calls, []);
  await h.handlers['updates:set-auto'](true);
  assert.deepStrictEqual(h.saved, { checkForUpdates: true });
  assert.deepStrictEqual(h.calls, ['autoCheck']);
  const refused = await h.handlers['updates:set-auto']('yes');
  assert.strictEqual(refused.ok, false);
  assert.strictEqual(refused.error.code, 'bad_request');
});

test('only the Settings window may use these calls', async () => {
  const h = harness({ kind: 'installer', status: 'ready', latest }, { allowed: () => false });
  const r = await h.handlers['updates:install']();
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'not_allowed');
  assert.deepStrictEqual(h.calls, []);
});

test('when the update cannot start after Update now, Buddy opens again by itself', async () => {
  const h = harness({ kind: 'installer', status: 'ready', latest }, { installs: false });
  await h.handlers['updates:install']();
  h.events['will-quit']();
  assert.deepStrictEqual(h.calls, ['quit', ['install', { relaunch: true }], 'relaunch']);
  const plain = harness({ kind: 'installer', status: 'ready', latest }, { installs: false });
  plain.events['will-quit'](); // a plain quit stays quit
  assert.deepStrictEqual(plain.calls, [['install', { relaunch: false }]]);
});

