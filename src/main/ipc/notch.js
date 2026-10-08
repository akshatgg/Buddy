'use strict';

/** IPC for the notch window. Only the notch's own page may use these channels. */

function registerNotchIpc({ ipcMain, notch, onClick }) {
  const fromNotch = (event) => Boolean(notch.window()) && event.sender === notch.window().webContents;

  ipcMain.on('notch:hover', (event, over) => fromNotch(event) && notch.setHover(Boolean(over)));
  ipcMain.on('notch:click', (event) => fromNotch(event) && onClick());
}

module.exports = { registerNotchIpc };
