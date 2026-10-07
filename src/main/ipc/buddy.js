'use strict';

/** IPC for the buddy window. Only the buddy's own page may use these channels. */

/** The point the page sent, or null unless both coordinates are finite numbers. */
const toPoint = (p) => (Number.isFinite(p?.x) && Number.isFinite(p?.y) ? { x: p.x, y: p.y } : null);

// Until a sleep countdown is given (src/main/sleep.js), nothing counts down, so there is nobody to tell.
const NO_SLEEP = { poke() {}, hold() {} };

/**
 * `sleep` is the buddy's sleep countdown: the pointer on the buddy and a press hold it, and a click is a use. These are
 * the only uses the page reports; the moods the countdown sends itself (drowsy, asleep, wake) are not uses.
 */
function registerBuddyIpc({ ipcMain, buddy, characters, store, onClick, sleep = NO_SLEEP }) {
  const fromBuddy = (event) => event.sender === buddy.window()?.webContents;

  ipcMain.handle('buddy:model', (event) => {
    if (!fromBuddy(event)) throw new Error('not allowed');
    const id = store.get('buddyId');
    // The accent is the colour of the buddy's glow, which its symbols are drawn in.
    return { bytes: characters.modelBytes(id), accent: characters.get(id).accent };
  });
  ipcMain.on('buddy:hover', (event, over) => {
    if (!fromBuddy(event)) return;
    buddy.setHover(Boolean(over));
    // A press ends with a drag-end or a click, but one the page loses before it moves ends with neither. The page
    // reports the pointer leaving only between presses, so by then any press is over.
    if (!over) sleep.hold('drag', false);
    sleep.hold('hover', Boolean(over));
  });
  ipcMain.on('buddy:drag-start', (event, p) => {
    const point = toPoint(p);
    if (!fromBuddy(event) || !point) return;
    buddy.beginDrag(point);
    sleep.hold('drag', true); // pressed: it may become a drag or a click
  });
  ipcMain.on('buddy:drag-move', (event, p) => {
    const point = toPoint(p);
    if (fromBuddy(event) && point) buddy.dragTo(point);
  });
  ipcMain.on('buddy:drag-end', (event) => {
    if (!fromBuddy(event)) return;
    buddy.endDrag();
    sleep.hold('drag', false);
  });
  ipcMain.on('buddy:click', (event) => {
    if (!fromBuddy(event)) return;
    sleep.hold('drag', false); // the press that was a click is over
    sleep.poke();
    onClick();
  });
}

module.exports = { registerBuddyIpc };
