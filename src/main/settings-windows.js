'use strict';

/** The Settings and Welcome windows: ordinary windows, at most one of each. */

const path = require('node:path');
const { BrowserWindow } = require('electron');

const KINDS = {
  settings: { title: 'Buddy Settings', width: 520, height: 720 },
  onboarding: { title: 'Welcome to Buddy', width: 520, height: 620 },
};

function createSettingsWindows({ app }) {
  const windows = {};
  const alive = (win) => win && !win.isDestroyed();

  return {
    open(kind) {
      if (alive(windows[kind])) {
        windows[kind].show();
        windows[kind].focus();
        return windows[kind];
      }
      const { title, width, height } = KINDS[kind];
      const win = new BrowserWindow({
        title,
        width,
        height,
        resizable: false,
        minimizable: false,
        fullscreenable: false,
        show: false,
        webPreferences: {
          preload: path.join(__dirname, '..', 'preload', 'settings.js'),
          sandbox: true,
          contextIsolation: true,
        },
      });
      win.loadFile(path.join(__dirname, '..', 'renderer', kind, 'index.html'));
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
    owns(webContents) {
      return Object.values(windows).some((win) => alive(win) && win.webContents === webContents);
    },
  };
}

module.exports = { createSettingsWindows };
