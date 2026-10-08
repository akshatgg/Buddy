'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPanelWindow, permissionRules, PAGE } = require('../src/main/panel-window');

const PAGE_URL = pathToFileURL(PAGE).href;
const SETTINGS_URL = pathToFileURL(path.join(__dirname, '..', 'src', 'renderer', 'settings', 'index.html')).href;
const PANEL = { name: 'the panel page' };
const SETTINGS = { name: 'the Settings page' };

/** The rules with the panel's page being PANEL, and a request's or a check's answer, as Electron gets it. */
function rules(platform) {
  const r = permissionRules({ isPanel: (webContents) => webContents === PANEL, platform });
  return {
    request(webContents, permission, details) {
      let answer;
      r.request(webContents, permission, (granted) => { answer = granted; }, details);
      return answer;
    },
    check: (webContents, permission, details) => r.check(webContents, permission, 'file:///', details),
  };
}

const microphone = (fields = {}) => ({ isMainFrame: true, requestingUrl: PAGE_URL, mediaTypes: ['audio'], securityOrigin: 'file:///', ...fields });

test('the panel page may have the microphone', () => {
  assert.strictEqual(rules().request(PANEL, 'media', microphone()), true);
  // Whatever comes after the page's address (#…, ?…) is still the page.
  assert.strictEqual(rules().request(PANEL, 'media', microphone({ requestingUrl: `${PAGE_URL}#voice` })), true);
  assert.strictEqual(rules().request(PANEL, 'media', microphone({ requestingUrl: `${PAGE_URL}?a=1` })), true);
});

test('the panel page may not have the camera, with the microphone or without it, nor media of no kind', () => {
  for (const mediaTypes of [['video'], ['audio', 'video'], ['video', 'audio'], [], undefined, 'audio', ['screen']]) {
    assert.strictEqual(rules().request(PANEL, 'media', microphone({ mediaTypes })), false, JSON.stringify(mediaTypes));
  }
});

test('the microphone is only for the panel page itself: not a frame inside it, nor another page in its window', () => {
  for (const details of [
    microphone({ isMainFrame: false }),
    microphone({ requestingUrl: 'https://example.com/' }),
    microphone({ requestingUrl: SETTINGS_URL }),
    microphone({ requestingUrl: pathToFileURL(path.join(path.dirname(PAGE), 'other.html')).href }),
    microphone({ requestingUrl: 'file://host/index.html' }),
    microphone({ requestingUrl: 'not a url' }),
    microphone({ requestingUrl: undefined }),
  ]) {
    assert.strictEqual(rules().request(PANEL, 'media', details), false, JSON.stringify(details));
  }
});

test("another window's page may not have the microphone or the camera, even when it shows the panel's address", () => {
  assert.strictEqual(rules().request(SETTINGS, 'media', microphone({ requestingUrl: SETTINGS_URL })), false);
  assert.strictEqual(rules().request(SETTINGS, 'media', microphone()), false);
  assert.strictEqual(rules().request(SETTINGS, 'media', microphone({ requestingUrl: SETTINGS_URL, mediaTypes: ['video'] })), false);
});

test('the panel page gets nothing else: no notifications, no clipboard reading, no screen, no opening other apps', () => {
  for (const permission of ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture', 'geolocation', 'fullscreen', 'openExternal', 'midi', 'unknown']) {
    assert.strictEqual(rules().request(PANEL, permission, { isMainFrame: true, requestingUrl: PAGE_URL }), false, permission);
  }
});

test("the other windows keep what they had: everything Electron allows when nobody decides, but the microphone and the camera", () => {
  for (const permission of ['notifications', 'clipboard-sanitized-write', 'fullscreen', 'openExternal', 'pointerLock']) {
    assert.strictEqual(rules().request(SETTINGS, permission, { isMainFrame: true, requestingUrl: SETTINGS_URL }), true, permission);
  }
});

test('the checks answer as the requests do: the microphone for the panel page alone', () => {
  const r = rules();
  const audio = { isMainFrame: true, requestingUrl: PAGE_URL, mediaType: 'audio', securityOrigin: 'file:///' };
  assert.strictEqual(r.check(PANEL, 'media', audio), true);
  assert.strictEqual(r.check(PANEL, 'media', { ...audio, mediaType: 'video' }), false);
  assert.strictEqual(r.check(PANEL, 'media', { ...audio, mediaType: 'unknown' }), false);
  assert.strictEqual(r.check(PANEL, 'media', { ...audio, requestingUrl: SETTINGS_URL }), false);
  assert.strictEqual(r.check(PANEL, 'media', { ...audio, isMainFrame: false }), false);
  assert.strictEqual(r.check(PANEL, 'notifications', { isMainFrame: true, requestingUrl: PAGE_URL }), false);
  assert.strictEqual(r.check(SETTINGS, 'media', { ...audio, requestingUrl: SETTINGS_URL }), false);
  // A check made for no page at all (a worker) is not the panel's.
  assert.strictEqual(r.check(null, 'media', { isMainFrame: false, mediaType: 'audio' }), false);
});

test('the checks of the other windows answer as Electron does when nobody decides: yes, but for the old clipboard paste', () => {
  const r = rules();
  for (const permission of ['notifications', 'clipboard-sanitized-write', 'fullscreen', 'pointerLock']) {
    assert.strictEqual(r.check(SETTINGS, permission, { isMainFrame: true, requestingUrl: SETTINGS_URL }), true, permission);
    assert.strictEqual(r.check(null, permission, { isMainFrame: false }), true, `${permission}, for no page`);
  }
  assert.strictEqual(r.check(SETTINGS, 'deprecated-sync-clipboard-read', { isMainFrame: true, requestingUrl: SETTINGS_URL }), false);
});

test('on Windows the panel page is known by its file whatever the case of its letters, as Windows knows files', () => {
  const upper = PAGE_URL.replace('/src/renderer/panel/', '/SRC/Renderer/Panel/');
  assert.strictEqual(rules('win32').request(PANEL, 'media', microphone({ requestingUrl: upper })), true);
  assert.strictEqual(rules('darwin').request(PANEL, 'media', microphone({ requestingUrl: upper })), false);
});

// ---- the rules on the panel's session ----

/** Just enough of BrowserWindow for the panel window to make one and show it. */
class FakeWindow {
  constructor() {
    this.visible = false;
    this.destroyed = false;
    this.events = {};
    this.webContents = {
      handlers: {},
      on(event, fn) {
        this.handlers[event] = fn;
      },
      setWindowOpenHandler() {},
      send() {},
      isDevToolsOpened: () => false,
    };
  }

  setAlwaysOnTop() {}

  setVisibleOnAllWorkspaces() {}

  on(event, fn) {
    this.events[event] = fn;
  }

  loadFile(file) {
    this.loaded = file;
    return Promise.resolve();
  }

  setBounds() {}

  show() {
    this.visible = true;
  }

  focus() {}

  isFocused() {
    return Boolean(this.focused);
  }

  isVisible() {
    return this.visible;
  }

  isDestroyed() {
    return this.destroyed;
  }

  hide() {
    this.visible = false;
  }

  destroy() {
    this.destroyed = true;
    this.events.closed?.();
  }
}

/** A session that keeps the handlers set on it, and answers a request or a check through them. */
function fakeSession() {
  const session = {
    setPermissionRequestHandler(fn) {
      this.requestHandler = fn;
    },
    setPermissionCheckHandler(fn) {
      this.checkHandler = fn;
    },
    request(webContents, permission, details) {
      let answer;
      this.requestHandler(webContents, permission, (granted) => { answer = granted; }, details);
      return answer;
    },
  };
  return session;
}

const BUDDY = { x: 1000, y: 700, width: 120, height: 120 };
const AREA = { x: 0, y: 0, width: 1440, height: 900 };

test("the rules are set on the panel's session as soon as there is a panel, before its window is made", () => {
  const session = fakeSession();
  createPanelWindow({ BrowserWindow: FakeWindow, session });
  assert.strictEqual(typeof session.requestHandler, 'function');
  assert.strictEqual(typeof session.checkHandler, 'function');
  // No panel window yet: no page is the panel's.
  assert.strictEqual(session.request(PANEL, 'media', microphone()), false);
  assert.strictEqual(session.request(SETTINGS, 'notifications', { isMainFrame: true, requestingUrl: SETTINGS_URL }), true);
});

test("the panel's window, once made, may have the microphone; a window of the panel's that is gone may not", async () => {
  const session = fakeSession();
  const panel = createPanelWindow({ BrowserWindow: FakeWindow, session });
  await panel.show({}, BUDDY, AREA);
  const first = panel.window();
  assert.strictEqual(first.loaded, PAGE);
  assert.strictEqual(session.request(first.webContents, 'media', microphone()), true);
  assert.strictEqual(session.request(first.webContents, 'media', microphone({ mediaTypes: ['video'] })), false);
  assert.strictEqual(session.checkHandler(first.webContents, 'media', 'file:///', { isMainFrame: true, requestingUrl: PAGE_URL, mediaType: 'audio' }), true);

  first.destroy(); // its page crashed, say: the next opening makes a new window
  assert.strictEqual(session.request(first.webContents, 'media', microphone()), false);
  await panel.show({}, BUDDY, AREA);
  assert.notStrictEqual(panel.window(), first);
  assert.strictEqual(session.request(panel.window().webContents, 'media', microphone()), true);
});

test('while macOS asks about the microphone the panel stays open, and gets the keyboard back after', async () => {
  const panel = createPanelWindow({ BrowserWindow: FakeWindow, session: fakeSession() });
  await panel.show({}, BUDDY, AREA);
  const w = panel.window();
  let focused = 0;
  w.focus = () => { focused += 1; };
  const answer = await panel.whileHeld(async () => {
    w.events.blur(); // macOS's question takes the focus
    assert.strictEqual(w.isVisible(), true, 'not hidden while the question is up');
    return 'granted';
  });
  assert.strictEqual(answer, 'granted');
  assert.strictEqual(focused, 1, 'the panel has the keyboard again');
  w.events.blur(); // a click somewhere else afterwards hides it as always
  assert.strictEqual(w.isVisible(), false);
});

test('a page that crashed, a page that did not load, or a window that was closed: main hears the panel is gone, once', async (t) => {
  t.mock.method(console, 'error', () => {});
  for (const [what, end] of [
    ['crashed', (w) => w.webContents.handlers['render-process-gone']({}, { reason: 'crashed' })],
    ['did not load', (w) => w.webContents.handlers['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', PAGE_URL, true)],
    ['closed', (w) => w.destroy()],
  ]) {
    let gone = 0;
    const panel = createPanelWindow({ BrowserWindow: FakeWindow, session: fakeSession(), onGone: () => { gone += 1; } });
    await panel.show({}, BUDDY, AREA);
    const w = panel.window();
    end(w);
    assert.strictEqual(gone, 1, what);
    assert.strictEqual(panel.window(), null, what);
    w.events.closed?.(); // Electron's own "closed" for a window already dropped
    assert.strictEqual(gone, 1, `${what}, and only once`);
  }
});

test('a load that was cancelled, or a failure in a frame inside the page, is not the panel gone', async (t) => {
  t.mock.method(console, 'error', () => {});
  let gone = 0;
  const panel = createPanelWindow({ BrowserWindow: FakeWindow, session: fakeSession(), onGone: () => { gone += 1; } });
  await panel.show({}, BUDDY, AREA);
  const w = panel.window();
  w.webContents.handlers['did-fail-load']({}, -3, 'ERR_ABORTED', PAGE_URL, true);
  w.webContents.handlers['did-fail-load']({}, -6, 'ERR_FILE_NOT_FOUND', 'file:///x.html', false);
  assert.strictEqual(gone, 0);
  assert.strictEqual(panel.window(), w);
});

test('a page whose load fails outright is gone too, and without onGone nothing breaks', async (t) => {
  t.mock.method(console, 'error', () => {});
  class Unloadable extends FakeWindow {
    loadFile() {
      return Promise.reject(new Error('no such file'));
    }
  }
  let gone = 0;
  const panel = createPanelWindow({ BrowserWindow: Unloadable, session: fakeSession(), onGone: () => { gone += 1; } });
  await panel.show({}, BUDDY, AREA);
  assert.strictEqual(gone, 1);
  const quiet = createPanelWindow({ BrowserWindow: FakeWindow, session: fakeSession() });
  await quiet.show({}, BUDDY, AREA);
  quiet.window().destroy();
  assert.strictEqual(quiet.window(), null);
});

test('a late blur from Buddy\'s own brief hide leaves the panel open when it has the keyboard again', async () => {
  const panel = createPanelWindow({ BrowserWindow: FakeWindow, session: fakeSession() });
  await panel.show({}, BUDDY, AREA);
  const w = panel.window();
  w.focused = true; // shown again and focused, then the blur of the earlier hide arrives
  w.events.blur();
  assert.strictEqual(w.isVisible(), true);
  w.focused = false; // a real click somewhere else
  w.events.blur();
  assert.strictEqual(w.isVisible(), false);
});
