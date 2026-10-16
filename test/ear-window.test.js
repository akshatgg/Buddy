'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const path = require('node:path');
const { createEarWindow } = require('../src/main/ear-window');

const PAGE = path.join(__dirname, '..', 'src', 'renderer', 'ear', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'ear.js');

function setup(t, { model = null, idleMs = 120000 } = {}) {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const made = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.sent = [];
      this.events = {};
      this.handlers = {};
      const win = this;
      this.webContents = {
        on(event, fn) { win.handlers[event] = fn; },
        setWindowOpenHandler(fn) { win.openHandler = fn; },
        isDestroyed: () => win.destroyed,
        send(channel, value) { win.sent.push([channel, value]); },
      };
      made.push(this);
    }
    loadFile(file, options) { this.loaded = file; this.loadOptions = options; return Promise.resolve(); }
    on(event, fn) { this.events[event] = fn; }
    isDestroyed() { return this.destroyed; }
    close() { this.destroy(); }
    destroy() { this.destroyed = true; this.events.closed?.(); }
  }
  const ipcMain = new EventEmitter();
  ipcMain.handlers = {};
  ipcMain.handle = (channel, fn) => { ipcMain.handlers[channel] = fn; };
  const ear = createEarWindow({ BrowserWindow: FakeWindow, ipcMain, idleMs, model });
  const tick = () => new Promise((resolve) => setImmediate(resolve));
  /** The page answers the command sent last. */
  const answer = (win, result, sender = win.webContents) => {
    const [, msg] = win.sent.filter(([c]) => c === 'ear:do').at(-1);
    ipcMain.emit('ear:done', { sender }, { id: msg.id, result });
  };
  return { ear, made, ipcMain, answer, tick };
}

test('call makes the hidden window on first use and sends ear:do; the page answers', async (t) => {
  const { ear, made, answer, tick } = setup(t);
  assert.strictEqual(made.length, 0);
  const p = ear.call('say', { text: 'Send it?' });
  await tick();
  assert.strictEqual(made.length, 1);
  const w = made[0];
  assert.strictEqual(w.options.show, false);
  assert.strictEqual(w.options.skipTaskbar, true);
  assert.strictEqual(w.options.focusable, false);
  assert.deepStrictEqual(w.options.webPreferences, { preload: PRELOAD, sandbox: true, contextIsolation: true, backgroundThrottling: false });
  assert.strictEqual(w.loaded, PAGE);
  assert.strictEqual(w.sent[0][0], 'ear:do');
  assert.deepStrictEqual({ cmd: w.sent[0][1].cmd, args: w.sent[0][1].args }, { cmd: 'say', args: { text: 'Send it?' } });
  answer(w, {});
  assert.deepStrictEqual(await p, {});
  ear.call('say', { text: 'again' });
  await tick();
  assert.strictEqual(made.length, 1, 'the same window');
});

test('ear:done from another page is ignored', async (t) => {
  const { ear, made, answer, tick } = setup(t);
  const p = ear.call('hear', {});
  await tick();
  let done = false;
  p.then(() => { done = true; });
  answer(made[0], { text: 'yes' }, { other: true });
  await tick();
  assert.strictEqual(done, false);
  answer(made[0], { text: 'no' });
  assert.deepStrictEqual(await p, { text: 'no' });
});

test('a page that crashes resolves every call with gone, and the next call makes a new window', async (t) => {
  const { ear, made, tick } = setup(t);
  const a = ear.call('hear', {});
  const b = ear.call('listen', {});
  await tick();
  made[0].handlers['render-process-gone']({}, { reason: 'crashed' });
  assert.deepStrictEqual(await a, { gone: true });
  assert.deepStrictEqual(await b, { gone: true });
  ear.call('say', { text: 'x' });
  await tick();
  assert.strictEqual(made.length, 2);
});

test('a page that does not load is gone too', async (t) => {
  const { ear, made, tick } = setup(t);
  const p = ear.call('say', {});
  await tick();
  made[0].handlers['did-fail-load']({}, -6, 'nope', 'file:///x', true);
  assert.deepStrictEqual(await p, { gone: true });
});

test('the 120 s cap answers gone and tells the page to stop', async (t) => {
  const { ear, made, tick } = setup(t);
  const p = ear.call('hear', {});
  await tick();
  t.mock.timers.tick(120000);
  assert.deepStrictEqual(await p, { gone: true });
  assert.ok(made[0].sent.some(([c]) => c === 'ear:stop'));
});

test('stop() sends ear:stop', async (t) => {
  const { ear, made, tick } = setup(t);
  ear.stop(); // no window: nothing
  ear.call('hear', {});
  await tick();
  ear.stop();
  assert.deepStrictEqual(made[0].sent.at(-1), ['ear:stop', undefined]);
});

test('the window closes idleMs after the last call, unless kept', async (t) => {
  const { ear, made, answer, tick } = setup(t, { idleMs: 1000 });
  const p = ear.call('say', {});
  await tick();
  answer(made[0], {});
  await p;
  t.mock.timers.tick(999);
  assert.strictEqual(made[0].destroyed, false);
  t.mock.timers.tick(1);
  assert.strictEqual(made[0].destroyed, true);

  const q = ear.call('say', {});
  await tick();
  ear.keep(true);
  answer(made[1], {});
  await q;
  t.mock.timers.tick(5000);
  assert.strictEqual(made[1].destroyed, false);
  ear.keep(false);
  t.mock.timers.tick(1000);
  assert.strictEqual(made[1].destroyed, true);
});

test('the page gets the model only from the ear page', async (t) => {
  const bytes = Buffer.from([1, 2, 3]);
  const { ear, made, ipcMain, tick } = setup(t, { model: { ready: () => true, bytes: async () => bytes } });
  ear.call('hear', {});
  await tick();
  const mine = await ipcMain.handlers['ear:model']({ sender: made[0].webContents });
  assert.deepStrictEqual(Buffer.from(mine.bytes), bytes);
  assert.deepStrictEqual(await ipcMain.handlers['ear:model']({ sender: {} }), {});
});

test('no model yet: the page gets nothing', async (t) => {
  const { ear, made, ipcMain, tick } = setup(t, { model: { ready: () => false, bytes: async () => Buffer.alloc(1) } });
  ear.call('hear', {});
  await tick();
  assert.deepStrictEqual(await ipcMain.handlers['ear:model']({ sender: made[0].webContents }), {});
});

// ---- the wake loop ----

test('wake sends ear:wake to the page; null ends it and never makes a window', async (t) => {
  const { ear, made, tick } = setup(t);
  await ear.wake(null);
  assert.strictEqual(made.length, 0);
  const args = { phrases: ['hey rahul', 'hey buddy'], floor: 0.6, testOnly: false };
  await ear.wake(args);
  await tick();
  assert.strictEqual(made.length, 1);
  assert.deepStrictEqual(made[0].sent.filter(([c]) => c === 'ear:wake'), [['ear:wake', args]]);
  await ear.wake(null);
  assert.deepStrictEqual(made[0].sent.at(-1), ['ear:wake', null]);
});

test('the page\'s woke and request reach main\'s listeners, only from the ear\'s own page', async (t) => {
  const { ear, made, ipcMain, tick } = setup(t);
  await ear.wake({ phrases: ['hey rahul', 'hey buddy'], floor: 0.6 });
  await tick();
  const seen = [];
  ear.on('woke', () => seen.push('woke'));
  ear.on('request', (r) => seen.push(r));
  ipcMain.emit('ear:woke', { sender: made[0].webContents });
  ipcMain.emit('ear:request', { sender: made[0].webContents }, { audio: 'AAAA' });
  ipcMain.emit('ear:request', { sender: made[0].webContents }, { audio: 5 });
  ipcMain.emit('ear:woke', { sender: {} });
  ipcMain.emit('ear:request', { sender: {} }, { audio: 'AAAA' });
  assert.deepStrictEqual(seen, ['woke', { audio: 'AAAA' }, { audio: null }]);
});

test('the idle close does not take the window while the loop is kept', async (t) => {
  const { ear, made, tick } = setup(t);
  await ear.wake({ phrases: ['hey rahul', 'hey buddy'], floor: 0.6 });
  ear.keep(true);
  await tick();
  t.mock.timers.tick(10 * 60 * 1000);
  assert.strictEqual(made[0].destroyed, false);
});

test('a window that goes while the loop runs is told to the listeners', async (t) => {
  const { ear, made, tick } = setup(t);
  let gone = 0;
  ear.on('gone', () => { gone += 1; });
  await ear.wake({ phrases: ['hey rahul', 'hey buddy'], floor: 0.6 });
  await tick();
  made[0].destroy();
  assert.strictEqual(gone, 1);
});

test('a window made only to list the voices is loaded quietly; any other is not', async (t) => {
  const a = setup(t);
  const p = a.ear.call('voices', {}, { quiet: true });
  await a.tick();
  assert.deepStrictEqual(a.made[0].loadOptions, { query: { quiet: '1' } });
  a.answer(a.made[0], { voices: [] });
  await p;
});

test('a window made for any other command is not loaded quietly', async (t) => {
  const b = setup(t);
  const q = b.ear.call('say', { text: 'Hi' });
  await b.tick();
  assert.strictEqual(b.made[0].loadOptions, undefined);
  b.answer(b.made[0], {});
  await q;
});
