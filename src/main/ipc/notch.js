'use strict';

/** IPC for the notch window. Only the notch's own page may use these channels. */

// Until a sleep countdown is given (src/main/sleep.js), nothing counts down, so there is nobody to tell.
const NO_SLEEP = { hold() {} };

/**
 * `sleep` is the buddy's sleep countdown: the pointer on the notch holds it, as on the floating buddy (a click opens
 * the panel, which holds it too). `characters` and `store` give the face its model (notch:model), as for the floating
 * buddy (ipc/buddy.js).
 */
function registerNotchIpc({ ipcMain, notch, onClick, sleep = NO_SLEEP, characters = null, store = null }) {
  const fromNotch = (event) => Boolean(notch.window()) && event.sender === notch.window().webContents;

  ipcMain.handle('notch:model', (event) => {
    if (!fromNotch(event) || !characters || !store) throw new Error('not allowed');
    const id = store.get('buddyId');
    return { bytes: characters.modelBytes(id), accent: characters.get(id).accent };
  });
  ipcMain.on('notch:hover', (event, over) => {
    if (!fromNotch(event)) return;
    notch.setHover(Boolean(over));
    sleep.hold('hover', Boolean(over));
  });
  ipcMain.on('notch:click', (event) => fromNotch(event) && onClick());
}

module.exports = { registerNotchIpc };
