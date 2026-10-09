'use strict';

const { PANEL, PANEL_BIG } = require('../../../src/main/geometry');

// The panel's size (panel-window.js): the grip in its outer corner, dragged with the mouse (real input events, as the
// person's), makes it bigger and is kept for the next opening; the header's ⤢ makes it big, and again back.
module.exports = async function panelSizeCheck(ctx, { assert, waitFor }) {
  ctx.store.set({ panelSize: null });
  await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
  await ctx.actions.toggle();
  const win = ctx.panel.window();
  await waitFor(() => win.isVisible(), 'the panel to open');
  const page = (script) => win.webContents.executeJavaScript(script);
  const before = win.getBounds();
  assert.deepStrictEqual([before.width, before.height], [PANEL.width, PANEL.height], 'it opens at its first size');

  // Drag the grip 60 points outwards and 40 down.
  const side = (await page("document.getElementById('grip').className")).split(' ')[1];
  const g = await page("(() => { const r = document.getElementById('grip').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()");
  const outwards = side === 'left' ? -60 : 60;
  // A real mouse's events carry where the pointer is on the screen; these made-up ones must be given it.
  const mouse = (type, x, y) => win.webContents.sendInputEvent({
    type, x, y, globalX: before.x + x, globalY: before.y + y, button: 'left', ...(type === 'mouseMove' ? {} : { clickCount: 1 }),
  });
  mouse('mouseDown', g.x, g.y);
  mouse('mouseMove', g.x + outwards, g.y + 40);
  mouse('mouseUp', g.x + outwards, g.y + 40);
  await waitFor(() => ctx.store.get('panelSize') !== null, 'the new size to be kept');
  const after = win.getBounds();
  const grew = side === 'both' ? [120, 40] : [60, 80];
  assert.deepStrictEqual([after.width - before.width, after.height - before.height], grew, `the panel grew with the drag (${side})`);
  assert.deepStrictEqual(ctx.store.get('panelSize'), { width: after.width, height: after.height });

  // ⤢: big, then back to the first size.
  await page("document.getElementById('size').click()");
  await waitFor(() => win.getBounds().width === PANEL_BIG.width, 'the panel to be big');
  assert.strictEqual(await page("document.getElementById('size').title"), 'Smaller');
  await page("document.getElementById('size').click()");
  await waitFor(() => win.getBounds().width === PANEL.width, 'the panel to be its first size again');
  assert.strictEqual(await page("document.getElementById('size').title"), 'Bigger');

  await ctx.actions.dismiss();
  ctx.store.set({ panelSize: null });
};
