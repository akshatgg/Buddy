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
    // Electron's default menu has File > Close Window (Cmd+W), which closes even a frameless panel,
    // and after `closed` the window must not be used again.
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('did-fail-load', (_event, code, description) => {
      console.error('[buddy] the panel page failed to load:', code, description);
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the panel page crashed:', details.reason);
      // Drop the window, so that the next show() builds a new one.
      if (!w.isDestroyed()) w.destroy();
      forget(w);
    });
    ready = w.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html')).catch((err) => {
      console.error('[buddy] could not load the panel page:', err.message);
    });
  }

  return {
    window: () => win,
    async show(state, buddyBounds, area) {
      if (!win) create();
      const w = win;
      await ready;
      if (w !== win) return; // the page crashed while it was loading, and the window was dropped
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
