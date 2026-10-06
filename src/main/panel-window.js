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

  function create() {
    win = new BrowserWindow({
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
    win.setAlwaysOnTop(true, 'pop-up-menu');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.on('blur', () => {
      if (!win.webContents.isDevToolsOpened()) hide();
    });
    ready = win.loadFile(path.join(__dirname, '..', 'renderer', 'panel', 'index.html'));
  }

  return {
    window: () => win,
    async show(state, buddyBounds, area) {
      if (!win) create();
      await ready;
      win.setBounds(panelBounds(buddyBounds, area));
      win.webContents.send('panel:open', state);
      win.show();
      win.focus();
    },
    hide,
    isVisible: () => Boolean(win && win.isVisible()),
    justClosed: () => Date.now() - hiddenAt < REOPEN_GUARD_MS,
  };
}

module.exports = { createPanelWindow };
