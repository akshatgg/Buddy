'use strict';

// The pages leave out what the system does not have. Windows asks for no permissions, so there Settings has no
// Permissions card and the Welcome goes from picking a buddy straight to connecting an AI.
module.exports = async function platformPagesCheck(ctx, { assert, waitFor }) {
  const onWindows = process.platform === 'win32';
  const settings = ctx.windows.open('settings');
  const welcome = ctx.windows.open('onboarding');
  const run = (win, code) => win.webContents.executeJavaScript(code);
  try {
    await waitFor(() => run(settings, "document.getElementById('power').textContent !== ''"), 'the Settings page to fill in');
    assert.strictEqual(await run(settings, "document.getElementById('permissions-card').hidden"), onWindows,
      'the Permissions card is there on the Mac only');
    assert.match(await run(settings, "document.getElementById('power-status').textContent"),
      onWindows ? /every time your PC starts/ : /every time your Mac starts/);

    // The AI form is mounted once the page knows which system it is on.
    await waitFor(() => run(welcome, "document.getElementById('ai').childElementCount > 0"), 'the Welcome page to fill in');
    await run(welcome, "document.getElementById('next').click()");
    const shown = await run(welcome, "[...document.querySelectorAll('main > section')].filter((s) => !s.hidden).map((s) => s.id)");
    assert.deepStrictEqual(shown, [onWindows ? 'step-ai' : 'step-accessibility'], 'the step after picking a buddy');
  } finally {
    ctx.windows.close('settings');
    ctx.windows.close('onboarding');
    await waitFor(() => settings.isDestroyed() && welcome.isDestroyed(), 'both windows to close');
  }
};
