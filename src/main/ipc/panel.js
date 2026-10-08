'use strict';

/**
 * IPC for the panel. Every answer is { ok: true, ... } or { ok: false, error }. The chat lives in actions.js, which
 * sends the page the whole state on 'panel:open' and 'panel:state': the page only sends what the person types and
 * the buttons they press.
 */

const { guarded } = require('./result');
const { sectionFor } = require('../actions');

function registerPanelIpc({ ipcMain, panel, actions, openSettings }) {
  const fromPanel = (webContents) => webContents === panel.window()?.webContents;
  const handle = guarded(ipcMain, fromPanel);

  // Answers once the answer is in (or it failed, which then shows in the chat).
  handle('panel:send', (message) => actions.send(typeof message === 'string' ? message : ''));
  handle('panel:act', (id, button) => actions.act(id, button));
  handle('panel:drop-selection', () => actions.dropSelection());

  ipcMain.on('panel:close', (event) => {
    // Through actions, which ends the chat and on Windows also hands the keyboard back to the app it was opened from.
    if (fromPanel(event.sender)) actions.dismiss().catch((err) => console.error('[buddy] could not close the panel', err));
  });
  ipcMain.on('panel:open-settings', (event, code) => {
    if (!fromPanel(event.sender)) return;
    panel.hide();
    openSettings(sectionFor(code));
  });
}

module.exports = { registerPanelIpc };
