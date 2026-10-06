'use strict';

const { screen } = require('electron');

module.exports = async function buddyCheck(ctx, { assert, delay, waitFor }) {
  const win = ctx.buddy.window();
  await waitFor(() => win.isVisible(), 'the buddy window to show');
  assert.ok(win.isAlwaysOnTop(), 'the buddy floats on top');
  assert.strictEqual(win.isFocusable(), false, 'the buddy never takes focus');
  await waitFor(() => win.webContents.executeJavaScript('window.__buddyReady === true'), 'the 3D buddy to load');

  // Drag it into the left half and let go: it glides to the left edge and remembers.
  const display = screen.getDisplayMatching(win.getBounds());
  const area = display.workArea;
  const start = win.getBounds();
  ctx.buddy.beginDrag({ x: start.x, y: start.y });
  ctx.buddy.dragTo({ x: area.x + 200, y: area.y + 300 });
  ctx.buddy.endDrag();
  await delay(100);
  assert.strictEqual(win.getBounds().x, area.x + 8, 'snaps to the left edge');
  assert.strictEqual(ctx.store.get('positions')[String(display.id)].x, area.x + 8, 'the position is remembered');
};
