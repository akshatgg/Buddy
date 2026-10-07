'use strict';

// The pages leave out what the system does not have, and speak its keys. Windows asks for no permissions, so there
// Settings has no Permissions in its sidebar and the Welcome has no permission steps; its default shortcut is
// Ctrl+Shift+Space, written by name.
module.exports = async function platformPagesCheck(ctx, { assert, waitFor }) {
  const onWindows = process.platform === 'win32';
  const settings = ctx.windows.open('settings');
  const welcome = ctx.windows.open('onboarding');
  const run = (win, code) => win.webContents.executeJavaScript(code);
  try {
    await waitFor(() => run(settings, "document.getElementById('power-status').textContent !== ''"), 'the Settings page to fill in');
    assert.strictEqual(await run(settings, `document.querySelector('.nav-item[data-section="permissions"]').hidden`), onWindows,
      'Permissions is in the sidebar on the Mac only');
    assert.match(await run(settings, "document.getElementById('power-status').textContent"),
      onWindows ? /every time your PC starts/ : /every time your Mac starts/);
    assert.strictEqual(await run(settings, "document.getElementById('shortcut-reset').textContent"),
      onWindows ? 'Reset to Ctrl Shift Space' : 'Reset to ⌥ Space');

    // The steps are decided once the page has its settings (`snap` and `steps` are the page's own).
    await waitFor(() => run(welcome, 'Boolean(snap && snap.ok)'), 'the Welcome page to fill in');
    const steps = await run(welcome, 'steps');
    assert.deepStrictEqual(steps.slice(0, 2), ['signin', 'pick'], 'sign in, then pick a buddy, everywhere');
    assert.strictEqual(steps.includes('accessibility'), !onWindows, 'the Accessibility step is there on the Mac only');
    assert.strictEqual(steps.includes('screen'), !onWindows, 'the Screen Recording step is there on the Mac only');
  } finally {
    ctx.windows.close('settings');
    ctx.windows.close('onboarding');
    await waitFor(() => settings.isDestroyed() && welcome.isDestroyed(), 'both windows to close');
  }
};
