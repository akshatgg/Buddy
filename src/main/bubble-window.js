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

  function create() {
    win = new BrowserWindow({
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
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true);
    ready = win.loadFile(path.join(__dirname, '..', 'renderer', 'bubble', 'index.html'));
  }

  return {
    window: () => win,
    async say(text, buddyBounds, area) {
      if (!win) create();
      await ready;
      win.setBounds(bubbleBounds(buddyBounds, area));
      win.webContents.send('bubble:text', text);
      win.showInactive();
      clearTimeout(timer);
      timer = setTimeout(() => win.hide(), SHOW_MS);
    },
  };
}

module.exports = { createBubbleWindow };
