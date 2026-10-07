'use strict';

/**
 * The panel: a chat with the buddy (actions.js holds it, the page draws it). It
 * opens beside the buddy and hides as soon as the user clicks anywhere else.
 * Its page is the only one in Buddy that may use the microphone (permissionRules).
 */

const path = require('node:path');
const { fileURLToPath } = require('node:url');
const electron = require('electron');
const { PANEL, panelBounds } = require('./geometry');
const { floatingType } = require('./platform');

// The panel's page.
const PAGE = path.join(__dirname, '..', 'renderer', 'panel', 'index.html');

// Clicking the buddy blurs the panel first (which hides it) and then arrives as
// a click: without this guard, that click would open the panel straight back up.
const REOPEN_GUARD_MS = 300;

// The error code of a load that was cancelled rather than one that failed.
const ERR_ABORTED = -3;

// What Electron refuses by itself when nobody decides: the old way for a page to read the clipboard (on paste).
const REFUSED_BY_ELECTRON = ['deprecated-sync-clipboard-read'];

/**
 * Whether `url` is the page in the file `page`, whatever comes after it (#…, ?…). Windows does not tell capitals from
 * small letters in a file's name, and neither does this there.
 */
function isPage(url, page, platform) {
  let file;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'file:') return false;
    file = path.resolve(fileURLToPath(parsed));
  } catch {
    return false; // not an address at all, or a file on another computer (file://host/…)
  }
  const wanted = path.resolve(page);
  return platform === 'win32' ? file.toLowerCase() === wanted.toLowerCase() : file === wanted;
}

/**
 * Who may use what, for the session the panel's window is in. That is Electron's default session, which Buddy's other
 * windows (the buddy, its bubble, Settings, the Welcome, Admin) share, so the rules are about every page in Buddy:
 *   - The panel's own page (its window's, the main frame, the panel page's file) may have the microphone, and nothing
 *     else: not the camera, not notifications, not the clipboard, not anything.
 *   - No other page may have the microphone or the camera.
 *   - Everything else for the other pages is as Electron answers when nobody decides, which is what they had before:
 *     a request is allowed, and a check too, but for the old way of reading the clipboard on paste.
 * `isPanel(webContents)` says whether a page is the panel window's. `request` and `check` are Electron's permission
 * request and check handlers.
 */
function permissionRules({ isPanel, page = PAGE, platform = process.platform }) {
  const inPanel = (webContents) => Boolean(webContents) && isPanel(webContents);
  const panelPage = (webContents, details) => inPanel(webContents) && details?.isMainFrame === true
    && isPage(details.requestingUrl, page, platform);
  return {
    request(webContents, permission, callback, details) {
      if (permission !== 'media') {
        callback(!inPanel(webContents));
        return;
      }
      const types = details?.mediaTypes;
      const audioOnly = Array.isArray(types) && types.length > 0 && types.every((type) => type === 'audio');
      callback(audioOnly && panelPage(webContents, details));
    },
    check(webContents, permission, _requestingOrigin, details) {
      if (permission === 'media') return details?.mediaType === 'audio' && panelPage(webContents, details);
      return !inPanel(webContents) && !REFUSED_BY_ELECTRON.includes(permission);
    },
  };
}

/**
 * `BrowserWindow` and `session` are Electron's unless given (the tests give their own). The panel's window has no
 * session of its own, so it is in the default one, with the other windows: the permission rules go on it as soon as
 * there is a panel (main.js makes it at launch), not only once its window is made, so that no other page has the
 * microphone meanwhile. `onGone()` is called once for each window whose page is gone: it crashed or did not load, or
 * the window was closed. Such a page cannot say that it stopped listening.
 */
function createPanelWindow({
  BrowserWindow = electron.BrowserWindow,
  session = electron.session.defaultSession,
  onGone = () => {},
} = {}) {
  let win = null;
  let ready = null;
  let hiddenAt = 0;

  const rules = permissionRules({ isPanel: (webContents) => Boolean(win) && !win.isDestroyed() && webContents === win.webContents });
  session.setPermissionRequestHandler(rules.request);
  session.setPermissionCheckHandler(rules.check);

  // While macOS asks the person whether Buddy may use the microphone, its question has the focus: the panel must not
  // hide on that blur, or the page would stop listening before the person has answered.
  let held = 0;

  function hide() {
    if (win && win.isVisible()) {
      win.hide();
      hiddenAt = Date.now();
    }
  }

  /** Forget a window that is gone, so that the next show() builds a new one; and say it is gone. */
  function forget(w) {
    if (win === w) {
      win = null;
      ready = null;
      onGone();
    }
  }

  /** Throw a window away because its page crashed or did not load, so that the next show() builds a new one. */
  function drop(w) {
    if (!w.isDestroyed()) w.destroy();
    forget(w);
  }

  function create() {
    const w = new BrowserWindow({
      ...PANEL,
      type: floatingType,
      frame: false,
      transparent: true,
      hasShadow: true,
      resizable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'panel.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    win = w;
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.on('blur', () => {
      if (!w.isDestroyed() && !w.webContents.isDevToolsOpened() && held === 0) hide();
    });
    // Buddy hides the panel rather than closing it (the menu's Close Window leaves it alone). A window that
    // is closed all the same cannot be shown again: it is forgotten here, so the next open makes a new one.
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); // the page shows only its own content: no pop-ups either
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      console.error('[buddy] the panel page failed to load:', code, description);
      // A cancelled load or a failure in a sub-frame leaves the page as it was: only a real failure drops the window.
      if (isMainFrame && code !== ERR_ABORTED) drop(w);
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the panel page crashed:', details.reason);
      drop(w);
    });
    ready = w.loadFile(PAGE).catch((err) => {
      console.error('[buddy] could not load the panel page:', err.message);
      drop(w); // the load failed, whether or not did-fail-load was emitted for it
    });
  }

  return {
    window: () => win,
    /** Runs `ask()` (a question the system puts on screen) with the panel kept open, and gives it the keyboard back after. */
    async whileHeld(ask) {
      held += 1;
      try {
        return await ask();
      } finally {
        held -= 1;
        if (held === 0 && win && !win.isDestroyed() && win.isVisible()) win.focus();
      }
    },
    async show(state, buddyBounds, area) {
      if (!win) create();
      const w = win;
      await ready;
      if (w !== win) return; // the window was closed or dropped (a crash, a failed load) while its page was loading
      w.setBounds(panelBounds(buddyBounds, area));
      w.webContents.send('panel:open', state);
      w.show();
      w.focus();
    },
    /**
     * Send to the panel's page, if there is one ('panel:state' after each change in the chat). A page that is still
     * loading may miss it: show() sends the whole state again when it opens.
     */
    send(channel, payload) {
      if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
    },
    hide,
    isVisible: () => Boolean(win && win.isVisible()),
    justClosed: () => Date.now() - hiddenAt < REOPEN_GUARD_MS,
    /** When the panel last hid (0: never), for the chat that comes back when it only hid a short while ago (actions.js). */
    hiddenAt: () => hiddenAt,
  };
}

module.exports = { createPanelWindow, permissionRules, PAGE };
