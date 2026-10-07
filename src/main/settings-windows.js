'use strict';

/** The Settings, Welcome and Admin windows: ordinary windows, at most one of each. Settings can open on a section. */

const path = require('node:path');

const KINDS = {
  settings: { title: 'Buddy Settings', width: 760, height: 560, preload: 'settings.js' },
  onboarding: { title: 'Welcome to Buddy', width: 520, height: 620, preload: 'settings.js' },
  admin: { title: 'Buddy Admin', width: 680, height: 780, preload: 'admin.js' },
};

// BrowserWindow can be passed in so tests can run without Electron; the real one is loaded
// only when none is.
function createSettingsWindows({ app, BrowserWindow = require('electron').BrowserWindow, platform = process.platform }) {
  const windows = {};
  const listeners = [];
  const alive = (win) => win && !win.isDestroyed();
  // Buddy has no Dock icon, so on the Mac it has to bring itself forward or a window opens behind. On Windows a window
  // comes forward by itself, and app.focus() there would focus whichever of Buddy's windows comes first (the buddy).
  const comeForward = () => {
    if (platform === 'darwin') app.focus({ steal: true });
  };

  return {
    open(kind, options) {
      const { section } = options || {}; // no options, or null, is no section
      if (alive(windows[kind])) {
        // As when it first opens: the app must come forward too or the window stays behind.
        comeForward();
        windows[kind].show();
        windows[kind].focus();
        if (section) windows[kind].webContents.send('settings:section', section);
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
      win.loadFile(path.join(__dirname, '..', 'renderer', kind, 'index.html'), section ? { hash: section } : undefined).catch((err) => {
        console.error(`[buddy] the ${kind} page failed to load:`, err);
      });
      win.once('ready-to-show', () => {
        comeForward();
        win.show();
      });
      win.on('closed', () => {
        for (const fn of listeners) fn(kind);
      });
      windows[kind] = win;
      return win;
    },
    close(kind) {
      if (alive(windows[kind])) windows[kind].close();
    },
    /** Tell the page of that kind of window something, while one is open (Update now's state, say). */
    send(kind, channel, ...args) {
      if (alive(windows[kind])) windows[kind].webContents.send(channel, ...args);
    },
    /** fn(kind) runs after a window of that kind closes. */
    onClosed(fn) {
      listeners.push(fn);
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
