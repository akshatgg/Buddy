'use strict';

module.exports = async function settingsCheck(ctx, { assert, waitFor }) {
  const win = ctx.windows.open('settings');
  await waitFor(
    () => win.webContents.executeJavaScript("document.getElementById('size').value === 'medium'"),
    'the Settings window to load',
  );
  const before = ctx.buddy.window().getBounds();
  const r = await win.webContents.executeJavaScript("window.buddy.set({ size: 'large' })");
  assert.strictEqual(r.ok, true, 'size saved');
  const after = ctx.buddy.window().getBounds();
  assert.ok(after.width > before.width, 'the buddy grew');
  assert.strictEqual(after.y + after.height, before.y + before.height, 'it kept its bottom edge');

  const bad = await win.webContents.executeJavaScript("window.buddy.set({ size: 'huge' })");
  assert.deepStrictEqual(bad, { ok: false, error: { code: 'bad_request', message: 'Unknown size.' } });

  const perms = await win.webContents.executeJavaScript('window.buddy.permissions()');
  assert.deepStrictEqual(perms, { ok: true, accessibility: true, screenRecording: true });
  win.close();
};
