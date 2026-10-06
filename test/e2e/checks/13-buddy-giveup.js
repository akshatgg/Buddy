'use strict';

// After three crashes within a minute the window stops reloading the page and is dropped. Left in place it would
// be a blank patch that still says it is visible (so the menu bar would offer "Hide buddy"). A later show()
// makes a fresh window, which gets its own reloads. The "[buddy] the page crashed" lines in the output come
// from this check.
module.exports = async function giveUpCheck(ctx, { assert, waitFor }) {
  const ready = async (win) => !win.isDestroyed() && win.webContents.executeJavaScript('window.__buddyReady === true').catch(() => false);
  async function crash(win) {
    let gone = false;
    win.webContents.once('render-process-gone', () => {
      gone = true;
    });
    win.webContents.forcefullyCrashRenderer();
    await waitFor(() => gone, 'the page to crash');
  }

  // The menu bar menu offers "Hide buddy" while the buddy is shown: it must be rebuilt when the window is given up.
  const refresh = ctx.tray.refresh;
  let refreshes = 0;
  ctx.tray.refresh = () => {
    refreshes += 1;
    return refresh();
  };

  const first = ctx.buddy.window();
  await waitFor(() => ready(first), 'the buddy page');
  for (const n of [1, 2]) {
    await crash(first);
    await waitFor(() => ready(first), `the page to come back after crash ${n}`);
  }
  assert.strictEqual(refreshes, 0, 'a crash that is recovered from changes nothing in the menu');
  await crash(first);
  await waitFor(() => ctx.buddy.window() === null, 'the window to be dropped after the third crash');
  assert.ok(first.isDestroyed(), 'the old window is destroyed');
  assert.strictEqual(ctx.buddy.isVisible(), false, 'so the buddy is no longer reported as visible');
  assert.strictEqual(refreshes, 1, 'and the menu bar menu was rebuilt, so it no longer offers "Hide buddy" for a buddy that is gone');
  ctx.tray.refresh = refresh;

  ctx.buddy.show();
  const fresh = ctx.buddy.window();
  assert.ok(fresh && fresh !== first, 'show() makes a fresh window');
  await waitFor(() => ready(fresh), 'the new buddy to load');
  assert.strictEqual(ctx.buddy.isVisible(), true);

  // The new window has its own reloads: one crash now does not count with the three before it.
  await crash(fresh);
  await waitFor(() => ready(fresh), 'the new buddy to come back after a crash');
  assert.strictEqual(ctx.buddy.window(), fresh, 'it was reloaded, not given up on');
};
