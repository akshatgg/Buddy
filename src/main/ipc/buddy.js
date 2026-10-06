'use strict';

/** IPC for the buddy window. Only the buddy's own page may use these channels. */

const toPoint = (p) => ({ x: Number(p?.x) || 0, y: Number(p?.y) || 0 });

function registerBuddyIpc({ ipcMain, buddy, characters, store, onClick }) {
  const fromBuddy = (event) => event.sender === buddy.window()?.webContents;

  ipcMain.handle('buddy:model', (event) => {
    if (!fromBuddy(event)) throw new Error('not allowed');
    return { bytes: characters.modelBytes(store.get('buddyId')) };
  });
  ipcMain.on('buddy:hover', (event, over) => fromBuddy(event) && buddy.setHover(Boolean(over)));
  ipcMain.on('buddy:drag-start', (event, p) => fromBuddy(event) && buddy.beginDrag(toPoint(p)));
  ipcMain.on('buddy:drag-move', (event, p) => fromBuddy(event) && buddy.dragTo(toPoint(p)));
  ipcMain.on('buddy:drag-end', (event) => fromBuddy(event) && buddy.endDrag());
  ipcMain.on('buddy:click', (event) => fromBuddy(event) && onClick());
}

module.exports = { registerBuddyIpc };
