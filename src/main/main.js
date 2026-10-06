'use strict';

/**
 * Buddy's main process. start() builds everything and hands back the pieces,
 * so the end-to-end test (test/e2e/smoke.js) can drive the real app with fakes
 * in place of the parts that touch the system.
 */

const path = require('node:path');
const { app, ipcMain, screen } = require('electron');
const { createStore } = require('./store');
const { loadCharacters } = require('./characters');
const { createBuddyWindow } = require('./buddy-window');
const { registerBuddyIpc } = require('./ipc/buddy');

async function start(options = {}) {
  if (options.singleInstance !== false && !app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  await app.whenReady();
  if (app.dock) app.dock.hide();
  app.on('window-all-closed', () => {}); // a menu bar app: closing windows must not quit it

  const store = createStore({ file: path.join(app.getPath('userData'), 'settings.json') });
  const characters = loadCharacters();
  const buddy = createBuddyWindow({ store, screen, animate: options.animate !== false });

  // Task 11 makes a click open the panel; for now the buddy just smiles.
  registerBuddyIpc({ ipcMain, buddy, characters, store, onClick: () => buddy.mood('happy') });

  buddy.show();
  buddy.mood('wave');
  return { store, characters, buddy };
}

module.exports = { start };
