'use strict';

/** IPC for the panel. Every answer is { ok: true, ... } or { ok: false, error }. */

const { guarded } = require('./result');

function registerPanelIpc({ ipcMain, panel, actions, openSettings }) {
  const fromPanel = (webContents) => webContents === panel.window()?.webContents;
  const handle = guarded(ipcMain, fromPanel);

  handle('panel:whole-box', () => actions.wholeBox());
  handle('panel:run', async (action, input) => ({ result: await actions.run(action, input) }));
  handle('panel:screenshot', () => actions.screenshot());
  handle('panel:insert', (text, mode) => actions.insert(String(text || ''), mode));
  handle('panel:copy', (text) => actions.copy(String(text || '')));

  ipcMain.on('panel:close', (event) => {
    if (fromPanel(event.sender)) panel.hide();
  });
  ipcMain.on('panel:open-settings', (event) => {
    if (!fromPanel(event.sender)) return;
    panel.hide();
    openSettings();
  });
}

module.exports = { registerPanelIpc };
