'use strict';

// Only the Welcome window may finish the Welcome (onboarding:finish). Both windows use the same page script, so the
// sender is what tells them apart. A choice that is not an object is refused with "bad_request" after the sender is
// accepted, and finishes nothing: that tells the two windows apart without turning the buddy on or changing anything.
// Then two things the Welcome shows: Accessibility allowed, as a badge; and why it could not load, on a card in the
// middle of the window.
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
    // The Accessibility step: the fake helper says it is allowed, shown as a badge as in Settings (its dot says it, so
    // there is no ✓).
    const w = (script) => welcome.webContents.executeJavaScript(script);
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'the Welcome to know who is signed in');
    await w("document.getElementById('next').click(); document.getElementById('next').click();");
    await waitFor(() => w("document.getElementById('acc-status').textContent !== ''"), 'the Accessibility badge');
    assert.deepStrictEqual(await w("['acc-status'].map((id) => [document.getElementById(id).textContent, document.getElementById(id).className])[0]"),
      ['Allowed', 'badge good']);
  } finally {
    ctx.windows.close('settings');
    ctx.windows.close('onboarding');
    await waitFor(() => settings.isDestroyed() && welcome.isDestroyed(), 'both windows to close');
  }

  // A Welcome that can't load its settings (here the account can't be read) says why on a card in the middle.
  const { user } = ctx.account;
  const logError = console.error;
  ctx.account.user = () => {
    throw new Error('e2e: the account cannot be read');
  };
  console.error = (...args) => {
    if (!String(args[0]).startsWith('[buddy] unexpected error')) logError(...args); // the main process logs the failure
  };
  const broken = ctx.windows.open('onboarding');
  try {
    const card = () => broken.webContents.executeJavaScript(`(() => {
      const card = document.querySelector('.load-error');
      if (!card) return null;
      const b = card.getBoundingClientRect();
      return { text: card.textContent, off: [b.left + b.width / 2 - innerWidth / 2, b.top + b.height / 2 - innerHeight / 2].map((d) => Math.round(d) || 0) };
    })()`).catch(() => null);
    await waitFor(async () => (await card()) !== null, 'the Welcome to say it could not load');
    assert.deepStrictEqual(await card(), { text: 'Something went wrong. Try again.', off: [0, 0] });
  } finally {
    ctx.account.user = user;
    console.error = logError;
    ctx.windows.close('onboarding');
    await waitFor(() => broken.isDestroyed(), 'the Welcome to close');
  }
};
