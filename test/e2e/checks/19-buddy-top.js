'use strict';

const { screen } = require('electron');
const { buddyBox, clampBuddy, TOP_TUCK } = require('../../../src/main/geometry');

// The buddy goes right to the top of the screen (geometry.js clampBuddy): dragged up, its own box stops at the top of
// the work area (a little past it, where the head has room above it), and the room above it for its symbols goes under
// the menu bar. macOS lets the window go there only because it may be larger than the screen (buddy-window.js).
module.exports = async function buddyTopCheck(ctx, { assert, waitFor }) {
  const win = () => ctx.home.window();
  const before = win().getBounds();
  const area = screen.getDisplayMatching(before).workArea;
  try {
    ctx.home.beginDrag({ x: before.x + 10, y: before.y + 10 });
    ctx.home.dragTo({ x: area.x + area.width / 2, y: area.y - 400 });
    ctx.home.endDrag();
    const want = clampBuddy({ ...before, x: 0, y: area.y - 1000 }, area);
    await waitFor(() => win().getBounds().y === want.y, `the buddy at the top (${JSON.stringify(win().getBounds())}, wanted y ${want.y})`);
    const box = buddyBox(win().getBounds());
    assert.strictEqual(box.y, area.y - Math.round(box.height * TOP_TUCK), 'its box right at the top of the work area');
    assert.ok(win().getBounds().y < area.y, 'the room above it under the menu bar');
  } finally {
    win().setBounds(before); // where the checks after expect it
  }
};
