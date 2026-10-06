'use strict';

// A click on the buddy opens the panel (spec section 9: "panel opens on click"). The page sends buddy:click when the
// pointer is released on the buddy without having moved: window.buddy.click(). Everything after that is the real
// app: the main process checks the sender, and the panel opens through the same actions the shortcut uses.
module.exports = async function clickCheck(ctx, { assert, delay, waitFor }) {
  const win = ctx.buddy.window();
  const page = win.webContents;
  await waitFor(() => page.executeJavaScript('window.__buddyReady === true').catch(() => false), 'the buddy page');
  assert.strictEqual(ctx.panel.isVisible(), false, 'the panel starts closed');
  /** A panel that has just closed stays closed for a moment, so that the click that blurred it does not reopen it. */
  const settled = () => waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');

  // 1. What the page sends.
  await page.executeJavaScript('window.buddy.click()');
  await waitFor(() => ctx.panel.isVisible(), 'the panel to open after a click on the buddy');
  // Another click while it is open closes it again, as the shortcut does.
  await page.executeJavaScript('window.buddy.click()');
  await waitFor(() => !ctx.panel.isVisible(), 'the panel to close after a second click');
  await settled();

  // 2. What the person does: move the pointer onto the buddy (the page finds the robot under it and says so), press and
  // release. The events go to the page itself; the real pointer does not move.
  const { width, height } = win.getBounds();
  const [x, y] = [Math.round(width / 2), Math.round(height / 2)];
  page.sendInputEvent({ type: 'mouseMove', x, y });
  await waitFor(() => page.executeJavaScript("document.getElementById('c').style.cursor === 'grab'"), 'the page to find the buddy under the pointer');
  page.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await delay(50);
  page.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
  await waitFor(() => ctx.panel.isVisible(), 'the panel to open after a press and release on the buddy');

  // The pointer leaves the buddy, and the panel is put away for the checks that follow.
  page.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 });
  ctx.panel.hide();
  await settled();
};
