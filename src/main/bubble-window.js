'use strict';

/** A short speech bubble beside the buddy ("Copied — press ⌘V"). Clicks pass through it. */

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { BUBBLE, bubbleBounds } = require('./geometry');

const SHOW_MS = 2600;

function createBubbleWindow() {
  let win = null;
  let ready = null;
  let timer = null;

  /** Forget a window that is gone, so that the next say() builds a new one. */
  function forget(w) {
    if (win !== w) return;
    clearTimeout(timer); // its hide timer would otherwise reach into a window that no longer exists
    win = null;
    ready = null;
  }

  function create() {
    const w = new BrowserWindow({
      ...BUBBLE,
      type: 'panel',
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'bubble.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    win = w;
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setIgnoreMouseEvents(true);
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.on('did-fail-load', (_event, code, description) => {
      console.error('[buddy] the bubble page failed to load:', code, description);
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the bubble page crashed:', details.reason);
      // Drop the window, so that the next say() builds a new one.
      if (!w.isDestroyed()) w.destroy();
      forget(w);
    });
    ready = w.loadFile(path.join(__dirname, '..', 'renderer', 'bubble', 'index.html')).catch((err) => {
      console.error('[buddy] could not load the bubble page:', err.message);
    });
  }

  return {
    window: () => win,
    /** Never rejects: whoever asks for a bubble cannot do anything about one that fails, so it is logged. */
    async say(text, buddyBounds, area) {
      try {
        if (!win) create();
        const w = win;
        await ready;
        if (w !== win) return; // the page crashed while it was loading, and the window was dropped
        w.setBounds(bubbleBounds(buddyBounds, area));
        w.webContents.send('bubble:text', text);
        w.showInactive();
        clearTimeout(timer);
        timer = setTimeout(() => w.hide(), SHOW_MS);
      } catch (err) {
        console.error('[buddy] could not show the bubble:', err);
      }
    },
  };
}

module.exports = { createBubbleWindow };
