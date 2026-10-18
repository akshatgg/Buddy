'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createQuitGuard, silenceOnQuit, QUIT_LIMIT_MS } = require('../src/main/quit');
const { createEarWindow } = require('../src/main/ear-window');
const { createWake } = require('../src/main/wake');

/**
 * Electron's quit as it is (shell/browser/browser.cc, window_list.cc, native_window.cc): a second quit while one is
 * under way does nothing; the quit closes the windows there are, newest first on the Mac; a window's 'closed' handlers
 * run before it leaves the list; will-quit comes when the list is empty. app.exit emits nothing.
 */
function fakeElectron() {
  const app = new EventEmitter();
  const list = [];
  let quitting = false;
  app.exits = [];
  app.willQuits = 0;
  app.on('will-quit', () => { app.willQuits += 1; });
  app.exit = (code) => { app.exits.push(code); };
  app.quit = () => {
    if (quitting) return;
    let prevented = false;
    app.emit('before-quit', { preventDefault() { prevented = true; } });
    if (prevented) return;
    quitting = true;
    if (!list.length) app.emit('will-quit', { preventDefault() {} });
    else for (const w of [...list].reverse()) if (!w.isDestroyed()) w.close();
  };
  class BrowserWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.events = {};
      const win = this;
      this.webContents = {
        on() {},
        setWindowOpenHandler() {},
        isDestroyed: () => win.destroyed,
        send() {},
      };
      list.push(this);
      app.emit('browser-window-created', {}, this);
    }
    loadFile() { return Promise.resolve(); }
    on(event, fn) { (this.events[event] ||= []).push(fn); }
    isDestroyed() { return this.destroyed; }
    close() { this.destroy(); }
    destroy() {
      if (this.destroyed) return;
      this.destroyed = true;
      for (const fn of this.events.closed || []) fn();
      list.splice(list.indexOf(this), 1);
      if (!list.length && quitting) app.emit('will-quit', { preventDefault() {} });
    }
  }
  return { app, BrowserWindow, windows: list };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Buddy's ear and wake loop, real, with the panel's window, as main.js puts them together. */
function buddy({ app, BrowserWindow }, { guard }) {
  const ipcMain = new EventEmitter();
  ipcMain.handle = () => {};
  const ear = createEarWindow({ BrowserWindow, ipcMain });
  if (guard) guard.onQuit(() => ear.quit());
  const store = { get: (k) => ({ buddyName: 'Buddy', wakeOn: true })[k], set() {} };
  const wake = createWake({
    store, ear, model: { ready: () => true, missing: () => new Set() }, lock: { locked: () => false },
    microphone: { status: () => 'granted' }, power: { isOn: () => true }, account: { isSignedIn: () => true },
    cloud: { last: () => ({ voiceOn: true }) }, powerMonitor: new EventEmitter(), actions: {}, talkBack: { say: async () => {} },
  });
  // The panel, opened once and kept: when its window goes, a listening there is over (main.js onGone).
  const panel = new BrowserWindow({});
  panel.on('closed', () => wake.panelListening(false));
  // The ear's window is newer than the panel's (the loop started after the panel was first opened, or the page was made
  // again after a crash): the quit closes it first.
  wake.refresh();
  return { app, ear, wake };
}

test('without the guard: the wake loop makes the ear again as the quit closes the panel, and Buddy never quits', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const electron = fakeElectron();
  buddy(electron, { guard: null });
  await tick();
  assert.strictEqual(electron.windows.length, 2);
  electron.app.quit();
  assert.strictEqual(electron.app.willQuits, 0, 'a new ear window is left open');
  assert.strictEqual(electron.windows.length, 1);
  electron.app.quit(); // the menu bar's Quit, a TERM signal: ignored, one is under way
  assert.strictEqual(electron.app.willQuits, 0);
});

test('with the guard: the ear is not made again and the quit finishes', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const electron = fakeElectron();
  const guard = createQuitGuard({ app: electron.app });
  buddy(electron, { guard });
  await tick();
  electron.app.quit();
  assert.strictEqual(electron.app.willQuits, 1);
  assert.strictEqual(electron.windows.length, 0);
  t.mock.timers.tick(5000); // the loop asks again for the page that went (wake.js 'gone'): still nothing
  await tick();
  assert.strictEqual(electron.windows.length, 0);
  assert.deepStrictEqual(electron.app.exits, []);
});

test('a window made while Buddy quits is destroyed, so the quit finishes', async () => {
  const { app, BrowserWindow, windows } = fakeElectron();
  createQuitGuard({ app });
  const panel = new BrowserWindow({});
  panel.on('closed', () => new BrowserWindow({})); // anything at all that makes a window as the others close
  app.quit();
  assert.strictEqual(app.willQuits, 0);
  assert.strictEqual(windows.length, 1);
  await tick();
  assert.strictEqual(windows.length, 0);
  assert.strictEqual(app.willQuits, 1);
});

test('windows made before a quit are left alone', async () => {
  const { app, BrowserWindow } = fakeElectron();
  createQuitGuard({ app });
  const w = new BrowserWindow({});
  await tick();
  assert.strictEqual(w.isDestroyed(), false);
});

test('a quit that does not finish in time runs the will-quit handlers (the update install) and exits', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new EventEmitter();
  app.exits = [];
  app.exit = (code) => app.exits.push(code);
  createQuitGuard({ app, later: () => {} }); // nothing destroys what is in the way
  const order = [];
  app.on('will-quit', () => order.push('install'));
  app.emit('before-quit', { preventDefault() {} });
  t.mock.timers.tick(QUIT_LIMIT_MS - 1);
  assert.deepStrictEqual(order, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(order, ['install']);
  assert.deepStrictEqual(app.exits, [0]);
  t.mock.timers.tick(QUIT_LIMIT_MS);
  assert.deepStrictEqual(order, ['install'], 'once');
});

test('a quit that finishes does not exit again later', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const app = new EventEmitter();
  app.exits = [];
  app.exit = (code) => app.exits.push(code);
  createQuitGuard({ app });
  let installs = 0;
  app.on('will-quit', () => { installs += 1; });
  app.emit('before-quit', { preventDefault() {} });
  app.emit('will-quit', { preventDefault() {} });
  t.mock.timers.tick(QUIT_LIMIT_MS * 2);
  assert.strictEqual(installs, 1);
  assert.deepStrictEqual(app.exits, []);
});

test('onQuit runs once, as the quit starts, even when a quit is asked for again; one that throws does not stop the others', () => {
  const app = new EventEmitter();
  const guard = createQuitGuard({ app, setTimer: () => null, clearTimer: () => {} });
  const ran = [];
  guard.onQuit(() => { throw new Error('boom'); });
  guard.onQuit(() => ran.push('ear'));
  const err = console.error;
  console.error = () => {};
  try {
    assert.strictEqual(guard.quitting(), false);
    app.emit('before-quit', {});
    app.emit('before-quit', {});
  } finally {
    console.error = err;
  }
  assert.deepStrictEqual(ran, ['ear']);
  assert.strictEqual(guard.quitting(), true);
});

test('a quit stops a running job, and after it the job says nothing and opens no panel', () => {
  const { app } = fakeElectron();
  const guard = createQuitGuard({ app });
  const shown = [];
  const ui = { showPanel: () => shown.push('panel'), bubble: () => shown.push('bubble'), speech: () => shown.push('speech'), speechDone: () => shown.push('done') };
  silenceOnQuit(ui, () => guard.quitting());
  const stops = [];
  guard.onQuit(() => stops.push('quit'));
  ui.speech('a step');
  app.emit('before-quit', {});
  ui.speech('Stopped.');
  ui.showPanel();
  ui.bubble('x');
  ui.speechDone();
  assert.deepStrictEqual(stops, ['quit']);
  assert.deepStrictEqual(shown, ['speech']);
});
