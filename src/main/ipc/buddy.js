'use strict';

/** IPC for the buddy window. Only the buddy's own page may use these channels. */

/** The point the page sent, or null unless both coordinates are finite numbers. */
const toPoint = (p) => (Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null);

function registerBuddyIpc({ ipcMain, buddy, characters, store, onClick }) {
  const fromBuddy = (event) => event.sender === buddy.window()?.webContents;

  ipcMain.handle('buddy:model', (event) => {
    if (!fromBuddy(event)) throw new Error('not allowed');
    return { bytes: characters.modelBytes(store.get('buddyId')) };
  });
  ipcMain.on('buddy:hover', (event, over) => fromBuddy(event) && buddy.setHover(Boolean(over)));
  ipcMain.on('buddy:drag-start', (event, p) => {
    const point = toPoint(p);
    if (fromBuddy(event) && point) buddy.beginDrag(point);
  });
  ipcMain.on('buddy:drag-move', (event, p) => {
    const point = toPoint(p);
    if (fromBuddy(event) && point) buddy.dragTo(point);
  });
  ipcMain.on('buddy:drag-end', (event) => fromBuddy(event) && buddy.endDrag());
  ipcMain.on('buddy:click', (event) => fromBuddy(event) && onClick());
}

module.exports = { registerBuddyIpc };
