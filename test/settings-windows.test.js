'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createSettingsWindows } = require('../src/main/settings-windows');

const SRC = path.join(__dirname, '..', 'src');
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Just enough of BrowserWindow and app to see what createSettingsWindows asks of them. */
function setup({ loadFile = () => Promise.resolve() } = {}) {
  const created = [];
  const focusCalls = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.shown = 0;
      this.focused = 0;
      this.onceHandlers = {};
      this.navigationHandler = null;
      this.openHandler = null;
      this.webContents = {
        on: (event, fn) => {
          if (event === 'will-navigate') this.navigationHandler = fn;
        },
        setWindowOpenHandler: (fn) => {
          this.openHandler = fn;
        },
      };
      created.push(this);
    }

    loadFile(file) {
      this.file = file;
      return loadFile(file);
    }

    once(event, fn) {
      this.onceHandlers[event] = fn;
    }

    show() {
      this.shown += 1;
    }

    focus() {
      this.focused += 1;
    }

    isDestroyed() {
      return this.destroyed;
    }

    close() {
      this.destroyed = true;
    }
  }
  const windows = createSettingsWindows({ app: { focus: (options) => focusCalls.push(options) }, BrowserWindow: FakeWindow });
  return { windows, created, focusCalls };
}

test('each kind opens its own page, in a sandboxed window with the settings preload', () => {
  const { windows, created } = setup();
  windows.open('settings');
  windows.open('onboarding');
  assert.strictEqual(created.length, 2);
  const [settings, onboarding] = created;
  assert.strictEqual(settings.options.title, 'Buddy Settings');
  assert.strictEqual(settings.file, path.join(SRC, 'renderer', 'settings', 'index.html'));
  assert.strictEqual(onboarding.options.title, 'Welcome to Buddy');
  assert.strictEqual(onboarding.file, path.join(SRC, 'renderer', 'onboarding', 'index.html'));
  for (const win of created) {
    assert.strictEqual(win.options.webPreferences.preload, path.join(SRC, 'preload', 'settings.js'));
    assert.strictEqual(win.options.webPreferences.sandbox, true);
    assert.strictEqual(win.options.webPreferences.contextIsolation, true);
  }
});

test('when its page is ready the window comes forward, with the app, since Buddy has no Dock icon', () => {
  const { windows, created, focusCalls } = setup();
  windows.open('settings');
  assert.deepStrictEqual(focusCalls, []);
  created[0].onceHandlers['ready-to-show']();
  assert.deepStrictEqual(focusCalls, [{ steal: true }]);
  assert.strictEqual(created[0].shown, 1);
});

test('opening a window that is already open brings the app and that window forward, with no second window', () => {
  const { windows, created, focusCalls } = setup();
  const first = windows.open('settings');
  const again = windows.open('settings');
  assert.strictEqual(again, first);
  assert.strictEqual(created.length, 1);
  assert.deepStrictEqual(focusCalls, [{ steal: true }]);
  assert.strictEqual(first.shown, 1);
  assert.strictEqual(first.focused, 1);
});

test('a closed window is replaced by a new one the next time; closing one that is not open does nothing', () => {
  const { windows, created } = setup();
  const first = windows.open('settings');
  windows.close('settings');
  assert.strictEqual(first.destroyed, true);
  const second = windows.open('settings');
  assert.notStrictEqual(second, first);
  assert.strictEqual(created.length, 2);
  windows.close('onboarding');
  assert.strictEqual(second.destroyed, false);
});

test('owns() says yes only for the pages of its own live windows', () => {
  const { windows } = setup();
  const win = windows.open('settings');
  assert.strictEqual(windows.owns(win.webContents), true);
  assert.strictEqual(windows.owns({}), false);
  windows.close('settings');
  assert.strictEqual(windows.owns(win.webContents), false);
});

test('owns() can be asked about one kind of window: the Settings page is not the Welcome page', () => {
  const { windows } = setup();
  const settings = windows.open('settings');
  const welcome = windows.open('onboarding');
  assert.strictEqual(windows.owns(settings.webContents, 'settings'), true);
  assert.strictEqual(windows.owns(settings.webContents, 'onboarding'), false);
  assert.strictEqual(windows.owns(welcome.webContents, 'onboarding'), true);
  assert.strictEqual(windows.owns(welcome.webContents, 'settings'), false);
  assert.strictEqual(windows.owns(welcome.webContents), true, 'with no kind, either one');
  assert.strictEqual(windows.owns(settings.webContents), true);
  assert.strictEqual(windows.owns({}, 'onboarding'), false);
  assert.strictEqual(windows.owns(welcome.webContents, 'constructor'), false, 'only the kinds there are');
  windows.close('onboarding');
  assert.strictEqual(windows.owns(welcome.webContents, 'onboarding'), false, 'a closed window owns nothing');
});

test('a page cannot navigate away or open other windows', () => {
  const { windows } = setup();
  const win = windows.open('settings');
  let prevented = false;
  win.navigationHandler({ preventDefault: () => { prevented = true; } });
  assert.strictEqual(prevented, true);
  assert.deepStrictEqual(win.openHandler({ url: 'https://example.com' }), { action: 'deny' });
});

test('a page that fails to load is logged, not left as an unhandled rejection', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const failure = new Error('ERR_FILE_NOT_FOUND');
  const { windows } = setup({ loadFile: () => Promise.reject(failure) });
  windows.open('onboarding');
  await tick();
  assert.strictEqual(logged.mock.callCount(), 1);
  const [message, err] = logged.mock.calls[0].arguments;
  assert.match(message, /onboarding/);
  assert.strictEqual(err, failure);
});
