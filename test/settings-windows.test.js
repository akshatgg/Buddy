'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createSettingsWindows } = require('../src/main/settings-windows');

const SRC = path.join(__dirname, '..', 'src');
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** Just enough of BrowserWindow and app to see what createSettingsWindows asks of them. */
function setup({ loadFile = () => Promise.resolve(), platform = 'darwin' } = {}) {
  const created = [];
  const focusCalls = [];
  class FakeWindow {
    constructor(options) {
      this.options = options;
      this.destroyed = false;
      this.shown = 0;
      this.focused = 0;
      this.onceHandlers = {};
      this.handlers = {};
      this.sent = []; // [channel, ...args] of everything the window's page was sent
      this.navigationHandler = null;
      this.openHandler = null;
      this.webContents = {
        on: (event, fn) => {
          if (event === 'will-navigate') this.navigationHandler = fn;
        },
        setWindowOpenHandler: (fn) => {
          this.openHandler = fn;
        },
        send: (...args) => {
          this.sent.push(args);
        },
      };
      created.push(this);
    }

    loadFile(file, options) {
      this.file = file;
      this.loadOptions = options;
      return loadFile(file);
    }

    once(event, fn) {
      this.onceHandlers[event] = fn;
    }

    on(event, fn) {
      this.handlers[event] = fn;
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
  const windows = createSettingsWindows({ app: { focus: (options) => focusCalls.push(options) }, BrowserWindow: FakeWindow, platform });
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

test('the admin window opens its own page, with its own preload, sandboxed', () => {
  const { windows, created } = setup();
  windows.open('admin');
  const [admin] = created;
  assert.strictEqual(admin.options.title, 'Buddy Admin');
  assert.strictEqual(admin.file, path.join(SRC, 'renderer', 'admin', 'index.html'));
  assert.strictEqual(admin.options.webPreferences.preload, path.join(SRC, 'preload', 'admin.js'));
  assert.strictEqual(admin.options.webPreferences.sandbox, true);
  assert.strictEqual(admin.options.webPreferences.contextIsolation, true);
  assert.strictEqual(windows.owns(admin.webContents, 'admin'), true);
  assert.strictEqual(windows.owns(admin.webContents, 'settings'), false);
});

test('Settings can open on a section: a new window loads with it in the hash, an open one is told', () => {
  const { windows, created } = setup();
  const win = windows.open('settings', { section: 'ai' });
  assert.deepStrictEqual(win.loadOptions, { hash: 'ai' });
  windows.open('settings', { section: 'shortcut' });
  assert.deepStrictEqual(win.sent, [['settings:section', 'shortcut']]);
  windows.open('settings');
  assert.deepStrictEqual(win.sent, [['settings:section', 'shortcut']], 'no section, nothing sent');
  assert.strictEqual(created.length, 1);
  const plain = setup().windows.open('onboarding');
  assert.strictEqual(plain.loadOptions, undefined);
});

test('onClosed hears which kind of window closed', () => {
  const { windows } = setup();
  const heard = [];
  windows.onClosed((kind) => heard.push(kind));
  const win = windows.open('settings');
  win.handlers.closed();
  assert.deepStrictEqual(heard, ['settings']);
});

test('no options, null or empty options all mean no section, for a new window and for one that is open', () => {
  const { windows, created } = setup();
  for (const options of [undefined, null, {}, { section: undefined }, { section: '' }]) {
    const first = windows.open('settings', options);
    assert.strictEqual(first.loadOptions, undefined, `new window, ${JSON.stringify(options)}`);
    assert.doesNotThrow(() => windows.open('settings', options), `open window, ${JSON.stringify(options)}`);
    assert.deepStrictEqual(first.sent, [], `nothing sent, ${JSON.stringify(options)}`);
    windows.close('settings');
  }
  assert.strictEqual(created.length, 5, 'each round opened a window of its own');
});

test('on Windows the window comes forward by itself: app.focus, which would focus whichever window of Buddy comes first, is left alone', () => {
  const { windows, created, focusCalls } = setup({ platform: 'win32' });
  const first = windows.open('settings');
  created[0].onceHandlers['ready-to-show']();
  assert.strictEqual(first.shown, 1);
  windows.open('settings');
  assert.strictEqual(first.focused, 1);
  assert.deepStrictEqual(focusCalls, []);
});
