'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBuddyWindow } = require('../src/main/buddy-window');

const DISPLAY = { id: 1, workArea: { x: 0, y: 0, width: 1440, height: 900 } };
const CURSOR_MS = 66;

/**
 * Just enough of BrowserWindow to see what the buddy window sends its page. As in Electron, webContents.send() throws
 * once the page's process is gone ("Render frame was disposed…"). kill() ends that process without telling anyone, as
 * in the moment before render-process-gone arrives; `noticed` says whether webContents.isCrashed() already knows.
 */
function setup(stored = {}) {
  const made = [];
  class FakeWindow {
    constructor(options) {
      this.bounds = { x: options.x, y: options.y, width: options.width, height: options.height };
      this.visible = false;
      this.destroyed = false;
      this.dead = false; // the page's process is gone
      this.noticed = false; // and webContents.isCrashed() says so
      this.handlers = {}; // the webContents events the buddy window listens to
      this.sent = []; // [channel, value] of everything the page was sent
      this.tries = 0; // calls of webContents.send(), including the ones that threw
      const win = this;
      this.webContents = {
        on(event, fn) {
          win.handlers[event] = fn;
        },
        setWindowOpenHandler() {},
        isDestroyed: () => win.destroyed,
        isCrashed: () => win.noticed,
        send(channel, value) {
          win.tries += 1;
          if (win.dead) throw new Error('Render frame was disposed before WebFrameMain could be accessed');
          win.sent.push([channel, value]);
        },
      };
      made.push(this);
    }

    loadFile() {
      return Promise.resolve();
    }

    setAlwaysOnTop() {}

    setVisibleOnAllWorkspaces() {}

    setIgnoreMouseEvents() {}

    showInactive() {
      this.visible = true;
    }

    hide() {
      this.visible = false;
    }

    isVisible() {
      return this.visible;
    }

    isDestroyed() {
      return this.destroyed;
    }

    getBounds() {
      return { ...this.bounds };
    }

    setPosition(x, y) {
      this.bounds = { ...this.bounds, x, y };
    }

    setBounds(bounds) {
      this.bounds = { ...bounds };
    }

    reload() {}

    destroy() {
      this.destroyed = true;
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
  const settings = { size: 'medium', lastDisplayId: 1, positions: {}, ...stored };
  const store = { get: (key) => settings[key], set: (patch) => Object.assign(settings, patch) };
  let pointer = { x: 10, y: 10 };
  const screen = {
    getAllDisplays: () => [DISPLAY],
    getPrimaryDisplay: () => DISPLAY,
    getDisplayMatching: () => DISPLAY,
    getCursorScreenPoint: () => pointer,
  };
  const make = () => createBuddyWindow({ store, screen, BrowserWindow: FakeWindow });
  return {
    buddy: make(),
    another: make, // a buddy window made later (at the next launch) with the same settings
    settings,
    win: () => made.at(-1),
    movePointer() {
      pointer = { x: pointer.x + 5, y: pointer.y };
    },
    pointTo(point) {
      pointer = point;
    },
  };
}

// The page can die (a crash, or the e2e check that kills it on purpose) a moment before render-process-gone says so.
// The cursor timer firing in between used to send to the dead page, and the throw was an uncaught error in the main
// process: a blocking error dialog in the app.
test('a page that has died but not yet said so is sent nothing, and its mood waits for the page that comes back', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.mock.method(console, 'error', () => {}); // "[buddy] the page crashed", from onCrash below
  const { buddy, win, movePointer } = setup();
  buddy.show();
  win().load();
  win().kill({ noticed: true });
  const before = win().sent.length;
  const tries = win().tries;

  movePointer();
  assert.doesNotThrow(() => t.mock.timers.tick(CURSOR_MS), 'the cursor timer');
  assert.doesNotThrow(() => buddy.mood('sleepy'), 'a mood');
  assert.doesNotThrow(() => buddy.pause(true), 'a pause');
  assert.strictEqual(win().tries, tries, 'a page known to be dead is not even tried');

  win().handlers['render-process-gone']({}, { reason: 'killed' });
  win().load();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', true], ['buddy:mood', 'sleepy']],
    'the page that came back is told it is paused, and the mood');
});

test('a send that throws because the page has just gone does not throw out of the cursor timer, a mood or a pause', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  t.mock.method(console, 'error', () => {});
  const warn = t.mock.method(console, 'warn', () => {});
  const { buddy, win, movePointer } = setup();
  buddy.show();
  win().load();
  movePointer();
  t.mock.timers.tick(CURSOR_MS);
  assert.strictEqual(win().sent.at(-1)[0], 'buddy:cursor', 'a live page is sent the pointer');

  win().kill({ noticed: false }); // isCrashed() does not know yet: only the throw says the page is gone
  movePointer();
  assert.doesNotThrow(() => t.mock.timers.tick(CURSOR_MS), 'the cursor timer');
  assert.doesNotThrow(() => buddy.mood('sleepy'), 'a mood');
  assert.doesNotThrow(() => buddy.pause(false), 'a pause');
  assert.ok(warn.mock.callCount() >= 1, 'it is logged');
  for (const call of warn.mock.calls) {
    assert.ok(!call.arguments.join(' ').includes('Render frame'), 'by kind, not with the error message');
  }

  win().handlers['render-process-gone']({}, { reason: 'killed' });
  const before = win().sent.length;
  win().load();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', false], ['buddy:mood', 'sleepy']],
    'the mood that could not be sent is sent to the page that came back');
});

// The window grew upward by 0.6 × the buddy's size, for the symbols over its head. The buddy's own box, the bottom of
// the window, is what the window used to be: the buddy stays where it was and the panel and the bubble go beside it.
test("bounds() is the buddy's own box at the bottom of its window, where the window used to be", (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  const before = buddy.bounds(); // no window yet: where it will be
  buddy.show();
  assert.deepStrictEqual(win().getBounds(), { x: 1336, y: 742, width: 96, height: 150 }, 'the window has room on top');
  assert.deepStrictEqual(buddy.bounds(), { x: 1336, y: 780, width: 96, height: 112 }, 'the box, where the window was');
  assert.deepStrictEqual(before, buddy.bounds());
});

test('a position saved before the window grew keeps the buddy where it was', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup({ positions: { 1: { x: 400, y: 300 } } }); // the old window's top-left corner
  buddy.show();
  assert.deepStrictEqual(win().getBounds(), { x: 400, y: 262, width: 96, height: 150 }, 'the same bottom centre');
  assert.deepStrictEqual(buddy.bounds(), { x: 400, y: 300, width: 96, height: 112 });
});

test("a drag moves and snaps the real window, and the place remembered is the box's corner", (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win, settings, another } = setup();
  buddy.show();
  buddy.beginDrag({ x: 1400, y: 800 }); // the pointer on the buddy
  buddy.dragTo({ x: 300, y: 500 });
  assert.deepStrictEqual(win().getBounds(), { x: 236, y: 442, width: 96, height: 150 }, 'the window follows the pointer');
  buddy.endDrag();
  assert.deepStrictEqual(win().getBounds(), { x: 8, y: 442, width: 96, height: 150 }, 'and glides to the left edge');
  assert.deepStrictEqual(settings.positions, { 1: { x: 8, y: 480 } }, "the box's top-left corner");
  assert.deepStrictEqual(buddy.bounds(), { x: 8, y: 480, width: 96, height: 112 });

  const next = another();
  next.show();
  assert.deepStrictEqual(next.bounds(), buddy.bounds(), 'the next launch puts it back there');
  assert.deepStrictEqual(win().getBounds(), { x: 8, y: 442, width: 96, height: 150 });
});

test('the room above the buddy stays on the screen: a drag to the top is clamped by the whole window', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win, settings } = setup();
  buddy.show();
  buddy.beginDrag({ x: 1400, y: 800 });
  buddy.dragTo({ x: 300, y: 20 });
  buddy.endDrag();
  assert.deepStrictEqual(win().getBounds(), { x: 8, y: 8, width: 96, height: 150 });
  assert.deepStrictEqual(settings.positions, { 1: { x: 8, y: 46 } });
});

test("a new size keeps the box's bottom centre, and remembers the new box's corner", (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win, settings } = setup({ positions: { 1: { x: 400, y: 300 } } });
  buddy.show();
  settings.size = 'large';
  buddy.resize();
  assert.deepStrictEqual(win().getBounds(), { x: 382, y: 205, width: 132, height: 207 });
  assert.deepStrictEqual(buddy.bounds(), { x: 382, y: 258, width: 132, height: 154 }, 'the bottom centre is still (448, 412)');
  assert.deepStrictEqual(settings.positions, { 1: { x: 382, y: 258 } });
});

test("the pointer is measured from the middle of the buddy's box, not of the taller window", (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] });
  const { buddy, win, pointTo } = setup();
  buddy.show();
  win().load();
  const box = buddy.bounds();
  pointTo({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  t.mock.timers.tick(CURSOR_MS);
  assert.deepStrictEqual(win().sent.at(-1), ['buddy:cursor', { dx: 0, dy: 0 }]);
  pointTo({ x: box.x, y: box.y });
  t.mock.timers.tick(CURSOR_MS);
  assert.deepStrictEqual(win().sent.at(-1), ['buddy:cursor', { dx: -48, dy: -56 }]);
});

test('voiceLevel sends the voice level to the page, from 0 to 1; anything that is not a number is silence', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  const levels = [[0.5, 0.5], [0, 0], [1, 1], [1.7, 1], [-0.2, 0], [Infinity, 1], [-Infinity, 0], [NaN, 0], ['0.5', 0], [undefined, 0], [null, 0]];
  for (const [given, sent] of levels) {
    buddy.voiceLevel(given);
    assert.deepStrictEqual(win().sent.at(-1), ['buddy:voice-level', sent], String(given));
  }
});

test('a voice level is never kept for a page that is loading: by the time it is ready, the level is old', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  win().handlers['did-navigate'](); // a reload starts
  const before = win().sent.length;
  buddy.voiceLevel(0.8);
  buddy.mood('listening');
  assert.strictEqual(win().sent.length, before, 'nothing reaches a loading page');
  win().handlers['did-finish-load']();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', false], ['buddy:mood', 'listening']], 'the mood waits; the level does not');
});

test('mood() and voiceLevel() do nothing without a window: the sleep countdown calls mood() from a timer', () => {
  const { buddy } = setup();
  assert.doesNotThrow(() => buddy.mood('drowsy'));
  assert.doesNotThrow(() => buddy.voiceLevel(0.5));
  assert.strictEqual(buddy.window(), null);
});

test('panelOpen tells the page whether the panel is open, as true or false', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  for (const [given, sent] of [[true, true], [false, false], [1, true], [undefined, false]]) {
    buddy.panelOpen(given);
    assert.deepStrictEqual(win().sent.at(-1), ['buddy:panel-open', sent], String(given));
  }
});

test('a page that loads while the panel is open is told so; one that loads while it is closed hears nothing of it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  buddy.panelOpen(true);
  win().handlers['did-navigate'](); // a reload starts
  let before = win().sent.length;
  win().handlers['did-finish-load']();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', false], ['buddy:panel-open', true]], 'a new page starts with the panel closed');

  buddy.panelOpen(false);
  win().handlers['did-navigate']();
  before = win().sent.length;
  win().handlers['did-finish-load']();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', false]], 'which is what it starts with');
});

test('panelOpen does nothing without a window, and a window made later is told the panel is open', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  assert.doesNotThrow(() => buddy.panelOpen(true));
  buddy.show();
  win().load();
  assert.deepStrictEqual(win().sent, [['buddy:pause', false], ['buddy:panel-open', true]]);
});

test('micOn tells the page whether the microphone is on, as true or false', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  for (const [given, sent] of [[true, true], [false, false], [1, true], [undefined, false]]) {
    buddy.micOn(given);
    assert.deepStrictEqual(win().sent.at(-1), ['buddy:mic-on', sent], String(given));
  }
});

test('a page that loads while the microphone is on is told so, before the mood; one that loads after hears nothing of it', (t) => {
  t.mock.timers.enable({ apis: ['setInterval'] }); // show() starts the cursor timer
  const { buddy, win } = setup();
  buddy.show();
  win().load();
  buddy.panelOpen(true);
  buddy.micOn(true);
  win().handlers['did-navigate'](); // a reload starts
  buddy.mood('happy'); // an answer while it loads
  let before = win().sent.length;
  win().handlers['did-finish-load']();
  assert.deepStrictEqual(win().sent.slice(before), [
    ['buddy:pause', false], ['buddy:panel-open', true], ['buddy:mic-on', true], ['buddy:mood', 'happy'],
  ], 'a new page starts with the microphone off: it listens once happy is over');

  buddy.panelOpen(false);
  buddy.micOn(false);
  win().handlers['did-navigate']();
  before = win().sent.length;
  win().handlers['did-finish-load']();
  assert.deepStrictEqual(win().sent.slice(before), [['buddy:pause', false]], 'which is what it starts with');
});
