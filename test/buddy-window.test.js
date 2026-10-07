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
function setup() {
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
  const settings = { size: 'medium', lastDisplayId: 1, positions: {} };
  const store = { get: (key) => settings[key], set: (patch) => Object.assign(settings, patch) };
  let pointer = { x: 10, y: 10 };
  const screen = {
    getAllDisplays: () => [DISPLAY],
    getPrimaryDisplay: () => DISPLAY,
    getDisplayMatching: () => DISPLAY,
    getCursorScreenPoint: () => pointer,
  };
  const buddy = createBuddyWindow({ store, screen, BrowserWindow: FakeWindow });
  return {
    buddy,
    win: () => made.at(-1),
    movePointer() {
      pointer = { x: pointer.x + 5, y: pointer.y };
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
