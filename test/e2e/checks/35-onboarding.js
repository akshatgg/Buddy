'use strict';

// Only the Welcome window may finish the Welcome (onboarding:finish). Both windows use the same page script, so the
// sender is what tells them apart. A choice that is not an object is refused with "bad_request" after the sender is
// accepted, and finishes nothing: that tells the two windows apart without turning the buddy on or changing anything.
module.exports = async function onboardingCheck(ctx, { assert, waitFor }) {
  const settings = ctx.windows.open('settings');
  const welcome = ctx.windows.open('onboarding');
  try {
    for (const [name, win] of [['Settings', settings], ['Welcome', welcome]]) {
      await waitFor(() => win.webContents.executeJavaScript("typeof window.buddy?.finishOnboarding === 'function'"), `the ${name} page`);
    }
    const before = ctx.store.all();
    const fromSettings = await settings.webContents.executeJavaScript("window.buddy.finishOnboarding('not a choice')");
    assert.deepStrictEqual(fromSettings, { ok: false, error: { code: 'not_allowed', message: 'Not allowed.' } }, 'the Settings window is refused');
    const fromWelcome = await welcome.webContents.executeJavaScript("window.buddy.finishOnboarding('not a choice')");
    assert.deepStrictEqual(fromWelcome, { ok: false, error: { code: 'bad_request', message: 'Those choices are not valid.' } }, 'the Welcome window is heard');
    assert.deepStrictEqual(ctx.store.all(), before, 'and nothing was saved');
  } finally {
    ctx.windows.close('settings');
    ctx.windows.close('onboarding');
    await waitFor(() => settings.isDestroyed() && welcome.isDestroyed(), 'both windows to close');
  }
};
