'use strict';

const { BrowserWindow } = require('electron');

// The buddy, the panel and the bubble show only their own page. Nothing in them opens another window today; refusing
// window.open is a second line of defence, so that a page that somehow got a script of its own still has no way out.
module.exports = async function windowsCheck(ctx, { assert, delay }) {
  const pages = { buddy: ctx.buddy.window(), panel: ctx.panel.window(), bubble: ctx.bubble.window() };
  const known = new Set(BrowserWindow.getAllWindows());
  const opened = {};
  try {
    for (const [name, win] of Object.entries(pages)) {
      assert.ok(win && !win.isDestroyed(), `the ${name} window exists`);
      opened[name] = await win.webContents.executeJavaScript("window.open('about:blank') !== null");
    }
    await delay(200);
  } finally {
    // Whatever was opened by mistake must not outlive this check.
    for (const win of BrowserWindow.getAllWindows()) if (!known.has(win)) win.destroy();
  }
  assert.deepStrictEqual(opened, { buddy: false, panel: false, bubble: false }, 'window.open gets nothing in any of them');
  const strays = BrowserWindow.getAllWindows().filter((win) => !known.has(win));
  assert.strictEqual(strays.length, 0);
};
