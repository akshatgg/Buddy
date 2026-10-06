'use strict';

/**
 * The panel: Write for me / Fix my English / Check screen. It opens beside the
 * buddy and hides as soon as the user clicks anywhere else.
 */

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { PANEL, panelBounds } = require('./geometry');

// Clicking the buddy blurs the panel first (which hides it) and then arrives as
// a click: without this guard, that click would open the panel straight back up.
const REOPEN_GUARD_MS = 300;

// The error code of a load that was cancelled rather than one that failed.
const ERR_ABORTED = -3;

function createPanelWindow() {
  let win = null;
  let ready = null;
  let hiddenAt = 0;

  function hide() {
    if (win && win.isVisible()) {
      win.hide();
      hiddenAt = Date.now();
    }
  }

  /** Forget a window that is gone, so that the next show() builds a new one. */
  function forget(w) {
    if (win === w) {
      win = null;
      ready = null;
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
      type: 'panel',
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
      if (!w.isDestroyed() && !w.webContents.isDevToolsOpened()) hide();
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
    ready = w.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html')).catch((err) => {
      console.error('[buddy] could not load the panel page:', err.message);
      drop(w); // the load failed, whether or not did-fail-load was emitted for it
    });
  }

  return {
    window: () => win,
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
    hide,
    isVisible: () => Boolean(win && win.isVisible()),
    justClosed: () => Date.now() - hiddenAt < REOPEN_GUARD_MS,
  };
}

module.exports = { createPanelWindow };
