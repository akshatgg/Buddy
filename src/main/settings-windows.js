'use strict';

/** The Settings, Welcome and Admin windows: ordinary windows, at most one of each. */

const path = require('node:path');

const KINDS = {
  settings: { title: 'Buddy Settings', width: 520, height: 720, preload: 'settings.js' },
  onboarding: { title: 'Welcome to Buddy', width: 520, height: 620, preload: 'settings.js' },
  admin: { title: 'Buddy Admin', width: 680, height: 780, preload: 'admin.js' },
};

// BrowserWindow can be passed in so tests can run without Electron; the real one is loaded
// only when none is.
function createSettingsWindows({ app, BrowserWindow = require('electron').BrowserWindow }) {
  const windows = {};
  const alive = (win) => win && !win.isDestroyed();

  return {
    open(kind) {
      if (alive(windows[kind])) {
        // As when it first opens: Buddy has no Dock icon, so the app must come forward too or the window stays behind.
        app.focus({ steal: true });
        windows[kind].show();
        windows[kind].focus();
        return windows[kind];
      }
      const { title, width, height, preload } = KINDS[kind];
      const win = new BrowserWindow({
        title,
        width,
        height,
        resizable: false,
        minimizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', preload),
          sandbox: true,
          contextIsolation: true,
        },
      });
      // The pages only ever show their own content: they never navigate away or open other windows.
      win.webContents.on('will-navigate', (event) => event.preventDefault());
      win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
      win.loadFile(path.join(__dirname, '..', 'renderer', kind, 'index.html')).catch((err) => {
        console.error(`[buddy] the ${kind} page failed to load:`, err);
      });
      win.once('ready-to-show', () => {
        // Buddy has no Dock icon, so it has to bring itself forward or the window opens behind.
        app.focus({ steal: true });
        win.show();
      });
      windows[kind] = win;
      return win;
    },
    close(kind) {
      if (alive(windows[kind])) windows[kind].close();
    },
    /** Is this page one of these windows' own? With a `kind` ('settings', 'onboarding' or 'admin'), only that kind counts. */
    owns(webContents, kind) {
      return Object.entries(windows).some(
        ([name, win]) => (kind === undefined || name === kind) && alive(win) && win.webContents === webContents,
      );
    },
  };
}

module.exports = { createSettingsWindows };
