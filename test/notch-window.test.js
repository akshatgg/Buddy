'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createNotchWindow } = require('../src/main/notch-window');
const { REACH, DROP, notchWindowBounds } = require('../src/main/notch-geometry');

const NOTCH = { x: 645, y: 0, width: 180, height: 32 };
const MOVED = { x: 2000, y: -100, width: 160, height: 30 };
const DISPLAY = { id: 1, bounds: { x: 0, y: 0, width: 1470, height: 956 }, workArea: { x: 0, y: 32, width: 1470, height: 924 } };
const CURSOR_MS = 66;
const MINUTE = 60_000;
const LAYOUT = { notchWidth: 180, notchHeight: 32, reach: REACH, drop: DROP, wing: 44, wingHover: 56, sayMax: 260, corner: 12, look: 'face' };
/** What a page that has just loaded is told, before any mood: the layout, whether it is paused, the panel and the mic. */
const FRESH = (paused = false, layout = LAYOUT) => [
  ['notch:layout', layout], ['notch:pause', paused], ['notch:panel-open', false], ['notch:mic-on', false],
];
const PAGE = path.join(__dirname, '..', 'src', 'renderer', 'notch', 'index.html');
const PRELOAD = path.join(__dirname, '..', 'src', 'preload', 'notch.js');

/**
 * Just enough of BrowserWindow to see what the notch window does with it and sends its page. As in Electron,
 * webContents.send() throws once the page's process is gone; kill() ends that process without telling anyone.
 */
function setup(t, { loadFails = false, look } = {}) {
  const made = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.loadFails = loadFails;
      this.bounds = { x: options.x ?? 0, y: options.y ?? 0, width: options.width ?? 0, height: options.height ?? 0 };
      this.visible = false;
      this.destroyed = false;
      this.dead = false;
      this.noticed = false;
      this.handlers = {}; // the webContents events listened to
      this.events = {}; // the window events listened to
      this.calls = []; // [method, ...args] of what was done with the window
      this.sent = []; // [channel, value] of everything the page was sent
      this.reloads = 0;
      const win = this;
      this.webContents = {
        on(event, fn) {
          win.handlers[event] = fn;
        },
        setWindowOpenHandler(fn) {
          win.openHandler = fn;
        },
        isDestroyed: () => win.destroyed,
        isCrashed: () => win.noticed,
        send(channel, value) {
          if (win.dead) throw new Error('Render frame was disposed before WebFrameMain could be accessed');
          win.sent.push([channel, value]);
        },
      };
      made.push(this);
    }

    loadFile(file) {
      this.loaded = file;
      return this.loadFails ? Promise.reject(new Error('no such file')) : Promise.resolve();
    }

    setAlwaysOnTop(...args) {
      this.calls.push(['setAlwaysOnTop', ...args]);
    }

    setVisibleOnAllWorkspaces(...args) {
      this.calls.push(['setVisibleOnAllWorkspaces', ...args]);
    }

    setIgnoreMouseEvents(...args) {
      this.calls.push(['setIgnoreMouseEvents', ...args]);
    }

    setBounds(b) {
      this.bounds = { ...b };
      this.calls.push(['setBounds', b]);
    }

    getBounds() {
      return { ...this.bounds };
    }

    on(event, fn) {
      this.events[event] = fn;
    }

    showInactive() {
      this.visible = true;
      this.calls.push(['showInactive']);
    }

    hide() {
      this.visible = false;
      this.calls.push(['hide']);
    }

    isVisible() {
      return this.visible;
    }

    isDestroyed() {
      return this.destroyed;
    }

    reload() {
      this.reloads += 1;
      this.handlers['did-navigate']();
    }

    destroy() {
      this.destroyed = true;
      this.events.closed?.();
    }

    /** The page has loaded (again): the events Electron sends for a navigation that finished. */
    load() {
      this.dead = false;
      this.noticed = false;
      this.handlers['did-navigate']();
      this.handlers['did-finish-load']();
    }

    kill({ noticed }) {
      this.dead = true;
      this.noticed = noticed;
    }
  }
  let pointer = { x: 10, y: 10 };
  const screen = { getCursorScreenPoint: () => pointer };
  const notch = createNotchWindow({ screen, BrowserWindow: FakeWindow, ...(look ? { look } : {}) });
  t.after(() => notch.destroy()); // its cursor timer would otherwise keep the test process alive
  return {
    notch,
    made,
    win: () => made.at(-1),
    movePointer(x, y) {
      pointer = { x, y };
    },
  };
}

test('show makes a see-through panel above the menu bar that never takes focus, over the notch, and shows it without focusing', (t) => {
  const { notch, win } = setup(t);
  assert.strictEqual(notch.window(), null);
  assert.strictEqual(notch.notch(), null);
  notch.show(NOTCH, DISPLAY);
  const w = win();
  assert.strictEqual(notch.window(), w);
  const o = w.options;
  assert.strictEqual(o.type, 'panel');
  assert.deepStrictEqual(
    [o.transparent, o.frame, o.hasShadow, o.resizable, o.focusable, o.alwaysOnTop, o.skipTaskbar, o.show],
    [true, false, false, false, false, true, true, false],
  );
  assert.strictEqual(o.enableLargerThanScreen, true, 'or macOS keeps it below the menu bar');
  assert.strictEqual(o.webPreferences.preload, PRELOAD);
  assert.strictEqual(o.webPreferences.sandbox, true);
  assert.strictEqual(o.webPreferences.contextIsolation, true);
  assert.strictEqual(o.webPreferences.backgroundThrottling, false);
  assert.ok(w.calls.some((c) => c[0] === 'setAlwaysOnTop' && c[1] === true && c[2] === 'screen-saver'), 'above the menu bar');
  assert.ok(w.calls.some((c) => c[0] === 'setVisibleOnAllWorkspaces' && c[1] === true && c[2].visibleOnFullScreen === true));
  assert.ok(w.calls.some((c) => c[0] === 'setIgnoreMouseEvents' && c[1] === true && c[2].forward === true), 'clicks pass through at first');
  assert.ok(w.calls.some((c) => c[0] === 'setBounds'), 'placed over the notch');
  assert.deepStrictEqual(w.getBounds(), notchWindowBounds(NOTCH));
  assert.strictEqual(w.loaded, PAGE);
  assert.strictEqual(w.visible, true);
  assert.ok(w.calls.some((c) => c[0] === 'showInactive'));
  assert.deepStrictEqual(notch.notch(), NOTCH);
  assert.strictEqual(notch.isVisible(), true);
});

test('the page may not go anywhere else nor open windows', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  let prevented = false;
  win().handlers['will-navigate']({ preventDefault: () => { prevented = true; } });
  assert.strictEqual(prevented, true);
  assert.deepStrictEqual(win().openHandler(), { action: 'deny' });
});

test('a page that is not loaded yet is sent the layout, whether it is paused and the latest mood once it loads; a say meanwhile is dropped', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  notch.mood('wave');
  notch.mood('happy');
  notch.say('Done! It\'s in Gmail ✅');
  assert.deepStrictEqual(win().sent, [], 'nothing reaches a page that is not there yet');
  win().load();
  assert.deepStrictEqual(win().sent, [...FRESH(), ['notch:mood', 'happy']]);
  assert.ok(win().calls.filter((c) => c[0] === 'setIgnoreMouseEvents').length >= 2, 'a fresh page starts without hover');
});

test('once loaded, moods, says and pauses go straight to the page', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  const before = win().sent.length;
  notch.mood('thinking');
  notch.say('Copied — press ⌘V');
  notch.pause(true);
  notch.pause(false);
  assert.deepStrictEqual(win().sent.slice(before), [
    ['notch:mood', 'thinking'], ['notch:say', 'Copied — press ⌘V'], ['notch:pause', true], ['notch:pause', false],
  ]);
});

test('show again moves the window to the notch it is given and tells the page the new layout; the window is made once', (t) => {
  const { notch, win, made } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  const before = win().sent.length;
  notch.show(MOVED, { ...DISPLAY, id: 2 });
  assert.strictEqual(made.length, 1);
  assert.deepStrictEqual(win().getBounds(), notchWindowBounds(MOVED));
  assert.deepStrictEqual(win().sent.slice(before), [
    ['notch:layout', { ...LAYOUT, notchWidth: 160, notchHeight: 30 }], ['notch:pause', false],
  ]);
  assert.deepStrictEqual(notch.notch(), MOVED);
});

test('hide hides the window and pauses the page; show starts it again', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  notch.hide();
  assert.strictEqual(notch.isVisible(), false);
  assert.strictEqual(win().visible, false);
  assert.deepStrictEqual(win().sent.at(-1), ['notch:pause', true]);
  notch.show(NOTCH, DISPLAY);
  assert.strictEqual(notch.isVisible(), true);
  assert.deepStrictEqual(win().sent.at(-1), ['notch:pause', false]);
});

test('hide before any show makes no window', (t) => {
  const { notch, made } = setup(t);
  notch.hide();
  notch.mood('happy');
  notch.say('x');
  notch.pause(true);
  notch.setHover(true);
  assert.strictEqual(made.length, 0);
  assert.strictEqual(notch.isVisible(), false);
});

test('a page loaded while hidden is told it is paused', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  notch.hide();
  win().load();
  assert.deepStrictEqual(win().sent, FRESH(true));
});

test('while shown, the pointer is sent from the window\'s centre about 15 times a second, and only when it moved', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { notch, win, movePointer } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  const b = notchWindowBounds(NOTCH);
  movePointer(b.x + b.width / 2 + 30, b.y + b.height / 2 + 5);
  t.mock.timers.tick(CURSOR_MS);
  assert.deepStrictEqual(win().sent.at(-1), ['notch:cursor', { dx: 30, dy: 5 }]);
  const count = win().sent.length;
  t.mock.timers.tick(CURSOR_MS * 3);
  assert.strictEqual(win().sent.length, count, 'a pointer that did not move is not sent again');
  notch.hide();
  movePointer(0, 0);
  t.mock.timers.tick(CURSOR_MS * 3);
  assert.ok(!win().sent.slice(count).some(([channel]) => channel === 'notch:cursor'), 'nothing while hidden');
});

test('hover over the black shape stops the clicks passing through, and leaving it lets them again', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  notch.setHover(true);
  assert.deepStrictEqual(win().calls.at(-1), ['setIgnoreMouseEvents', false, { forward: true }]);
  notch.setHover(false);
  assert.deepStrictEqual(win().calls.at(-1), ['setIgnoreMouseEvents', true, { forward: true }]);
});

test('a page that crashed is logged and reloaded; another crash within the minute waits for the minute to pass', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const error = t.mock.method(console, 'error', () => {});
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  win().handlers['render-process-gone']({}, { reason: 'crashed' });
  assert.strictEqual(error.mock.callCount(), 1);
  assert.strictEqual(win().reloads, 1, 'the first crash reloads at once');
  assert.ok(win().calls.at(-1)[0] === 'setIgnoreMouseEvents' && win().calls.at(-1)[1] === true, 'a dead page cannot report that the pointer left');
  notch.mood('sad');
  assert.ok(!win().sent.some(([channel, value]) => channel === 'notch:mood' && value === 'sad'), 'a page that is loading again is sent nothing');
  win().load();
  assert.deepStrictEqual(win().sent.slice(-5), [...FRESH(), ['notch:mood', 'sad']]);

  t.mock.timers.tick(10_000);
  win().handlers['render-process-gone']({}, { reason: 'crashed' });
  assert.strictEqual(win().reloads, 1, 'not yet');
  t.mock.timers.tick(MINUTE - 10_000 - 1);
  assert.strictEqual(win().reloads, 1);
  t.mock.timers.tick(1);
  assert.strictEqual(win().reloads, 2, 'a minute after the last reload');
  assert.strictEqual(notch.window(), win(), 'the window is kept');
});

test('a load that failed is logged and reloaded in the same way; a cancelled load or a failure in a frame inside the page is not', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1_000_000 });
  const error = t.mock.method(console, 'error', () => {});
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().handlers['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x', true);
  assert.strictEqual(error.mock.callCount(), 1);
  assert.strictEqual(win().reloads, 1);
  win().handlers['did-fail-load']({}, -3, 'ERR_ABORTED', 'file:///x', true);
  win().handlers['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///frame', false);
  t.mock.timers.tick(MINUTE * 2);
  assert.strictEqual(win().reloads, 1, 'neither reloads');
});

test('a load that fails outright is logged, and nothing is thrown; the window is kept', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const { notch, win } = setup(t, { loadFails: true });
  notch.show(NOTCH, DISPLAY);
  await new Promise((resolve) => setImmediate(resolve));
  // Only Buddy's own line: Node's warning about its experimental mock timers can land here too.
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments).filter(([first]) => String(first).startsWith('[buddy]')),
    [['[buddy] could not load the notch page:', 'no such file']]);
  assert.strictEqual(notch.window(), win());
  assert.strictEqual(notch.isVisible(), true);
});

test('a page that has died but not yet said so is sent nothing, and a send that throws is caught', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.mock.method(console, 'error', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const { notch, win, movePointer } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  win().kill({ noticed: false });
  movePointer(500, 500);
  assert.doesNotThrow(() => t.mock.timers.tick(CURSOR_MS));
  assert.doesNotThrow(() => notch.mood('sleepy'));
  assert.doesNotThrow(() => notch.say('x'));
  assert.ok(warn.mock.callCount() >= 1, 'logged, by kind');
  for (const call of warn.mock.calls) assert.ok(!call.arguments.join(' ').includes('Render frame'));
  win().kill({ noticed: true });
  const warned = warn.mock.callCount();
  assert.doesNotThrow(() => notch.pause(true));
  assert.strictEqual(warn.mock.callCount(), warned, 'a page known to be dead is not even tried');
});

test('destroy drops the window and everything kept for it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval', 'setTimeout'] });
  const { notch, win, made, movePointer } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  const first = win();
  notch.mood('happy');
  notch.destroy();
  assert.strictEqual(first.destroyed, true);
  assert.strictEqual(notch.window(), null);
  assert.strictEqual(notch.notch(), null);
  assert.strictEqual(notch.isVisible(), false);
  movePointer(1, 1);
  assert.doesNotThrow(() => t.mock.timers.tick(CURSOR_MS));
  notch.destroy(); // again: nothing to do
  notch.show(NOTCH, DISPLAY);
  assert.strictEqual(made.length, 2, 'a new window after destroy');
  win().load();
  assert.deepStrictEqual(win().sent, FRESH(), 'the old mood is not carried over');
});

test('a window closed from outside is forgotten, and the next show makes a new one', (t) => {
  const { notch, win, made } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().destroy();
  assert.strictEqual(notch.window(), null);
  assert.strictEqual(notch.isVisible(), false);
  notch.show(NOTCH, DISPLAY);
  assert.strictEqual(made.length, 2);
});

test('the look comes from the setting each time the layout is sent: eyes, or the face for anything else', (t) => {
  let look = 'eyes';
  const { notch, win } = setup(t, { look: () => look });
  notch.show(NOTCH, DISPLAY);
  win().load();
  assert.deepStrictEqual(win().sent[0], ['notch:layout', { ...LAYOUT, look: 'eyes' }]);
  look = 'face';
  notch.relayout();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:layout', LAYOUT], 'Settings changed it: the page draws again');
  look = 'wings';
  notch.relayout();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:layout', LAYOUT]);
});

test('relayout before any show sends nothing', (t) => {
  const { notch, made } = setup(t);
  notch.relayout();
  assert.strictEqual(made.length, 0);
});

test('the face hears the panel, the microphone, the voice and a new character, as the floating buddy does', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  const before = win().sent.length;
  notch.panelOpen(1);
  notch.micOn('yes');
  notch.voiceLevel(2);
  notch.voiceLevel('loud');
  notch.voiceLevel(0.3);
  notch.reloadModel();
  assert.deepStrictEqual(win().sent.slice(before), [
    ['notch:panel-open', true], ['notch:mic-on', true], ['notch:voice-level', 1], ['notch:voice-level', 0],
    ['notch:voice-level', 0.3], ['notch:reload', undefined],
  ]);
  win().load();
  assert.deepStrictEqual(win().sent.slice(-4), [
    ['notch:layout', LAYOUT], ['notch:pause', false], ['notch:panel-open', true], ['notch:mic-on', true],
  ], 'a page that loads again is told the panel and the microphone');
});

test('a sleep that lasts is told again to a page that loads, until a use wakes Buddy', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  notch.mood('asleep');
  win().load();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:mood', 'asleep']);
  notch.mood('wake');
  win().load();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:mic-on', false], 'awake again: nothing to tell');
});

test('the status goes to the page; one that lasts is told again to a page that loads, done and failed are not', (t) => {
  const { notch, win } = setup(t);
  notch.show(NOTCH, DISPLAY);
  win().load();
  notch.status({ kind: 'working', text: 'Claude · editing code', extra: 1 });
  assert.deepStrictEqual(win().sent.at(-1), ['notch:status', { kind: 'working', text: 'Claude · editing code' }]);
  win().load();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:status', { kind: 'working', text: 'Claude · editing code' }]);
  notch.status({ kind: 'done', text: 7 });
  assert.deepStrictEqual(win().sent.at(-1), ['notch:status', { kind: 'done', text: '' }]);
  win().load();
  assert.deepStrictEqual(win().sent.at(-1), ['notch:mic-on', false]);
  notch.status('nonsense');
  assert.deepStrictEqual(win().sent.at(-1), ['notch:status', null]);
});

test('a pointer left on the shape is taken off when the window hides, reloads after a crash or goes', (t) => {
  t.mock.method(console, 'error', () => {});
  const { notch, win } = setup(t);
  let lost = 0;
  notch.onHoverLost(() => { lost += 1; });
  notch.show(NOTCH, DISPLAY);
  win().load();
  notch.hide();
  assert.strictEqual(lost, 0, 'no pointer on it: nothing to take off');
  notch.show(NOTCH, DISPLAY);
  notch.setHover(true);
  notch.hide();
  assert.strictEqual(lost, 1);
  notch.hide();
  assert.strictEqual(lost, 1, 'once');
  notch.show(NOTCH, DISPLAY);
  notch.setHover(true);
  win().handlers['render-process-gone']({}, { reason: 'crashed' });
  assert.strictEqual(lost, 2);
  win().load();
  notch.setHover(true);
  notch.setHover(false);
  notch.destroy();
  assert.strictEqual(lost, 2, 'the page said the pointer left');
  notch.show(NOTCH, DISPLAY);
  notch.setHover(true);
  notch.destroy();
  assert.strictEqual(lost, 3);
});
