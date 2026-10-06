'use strict';

// Phase 2 in the real app, with the fake account and server from smoke.js (ctx.account, ctx.cloud): Settings shows who
// is signed in and what free mode means for them; the panel uses the free route when free mode is on and sends a
// signed-out person to Settings; and the Welcome cannot be finished signed out.
module.exports = async function accountCheck(ctx, { assert, waitFor }) {
  const free = { ...ctx.cloud.free };
  const settings = ctx.windows.open('settings');
  const page = (script) => settings.webContents.executeJavaScript(script);
  const loaded = () => page("document.getElementById('account-line').textContent !== ''").catch(() => false);
  /** Load Settings again (it reads the free settings as it opens), and wait for the new page, not the old one. */
  async function reload() {
    await page('window.__old = true');
    settings.webContents.reload();
    await waitFor(async () => (await page('!window.__old').catch(() => false)) && loaded(), 'Settings to load again');
  }
  const aiCard = () => page(`({
    note: document.getElementById('ai-note').hidden ? null : document.getElementById('ai-note').textContent,
    form: !document.getElementById('ai').hidden,
  })`);
  const accountButtons = () => page("[document.getElementById('sign-in').hidden, document.getElementById('sign-out').hidden]");

  try {
    await waitFor(loaded, 'the Settings window to load');
    assert.strictEqual(await page("document.getElementById('account-line').textContent"), 'Signed in as E2E Tester (e2e@example.com)');
    assert.deepStrictEqual(await accountButtons(), [true, false], 'Sign out is offered');

    // The AI card follows the admin's switches.
    assert.deepStrictEqual(await aiCard(), { note: null, form: true }, 'free mode off: the key form');
    for (const [change, expected] of [
      [{ freeOn: true, limitMode: 'unlimited', limit: null }, { note: 'Free AI is on. No key needed.', form: false }],
      [{ freeOn: true, usedToday: 4 }, { note: 'You get 30 free requests a day. Used today: 4.', form: false }],
      [{ freeOn: true, usedToday: 4, allowOwnKey: true }, {
        note: 'You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.',
        form: true,
      }],
    ]) {
      ctx.cloud.free = { ...free, ...change };
      await reload();
      assert.deepStrictEqual(await aiCard(), expected, JSON.stringify(change));
    }

    // With free mode on, the panel's answer comes from the server.
    ctx.cloud.free = { ...free, freeOn: true, limitMode: 'unlimited', limit: null };
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: 'mail to my boss', tone: 'formal' })");
    assert.deepStrictEqual(ran, { ok: true, result: { text: 'A free answer', model: 'free-model' } });
    assert.deepStrictEqual(ctx.cloud.asks.at(-1), { action: 'write', input: { instruction: 'mail to my boss', tone: 'formal' } });

    // Signed out: Settings offers Sign in, and the panel sends the person there.
    ctx.account.signOut();
    await reload();
    assert.deepStrictEqual(await accountButtons(), [false, true], 'Sign in is offered');
    assert.deepStrictEqual(await aiCard(), { note: null, form: true }, 'signed out: no free settings apply');
    await panel.webContents.executeJavaScript(
      "document.getElementById('write-text').value = 'mail to my boss'; document.getElementById('write-go').click();",
    );
    await waitFor(() => panel.webContents.executeJavaScript("!document.getElementById('error').hidden"), 'the error to show');
    assert.deepStrictEqual(
      await panel.webContents.executeJavaScript("[document.getElementById('error').textContent, !document.getElementById('error-settings').hidden]"),
      ['Sign in to use Buddy.', true],
    );
    ctx.panel.hide();

    // Signing in from Settings.
    await page("document.getElementById('sign-in').click()");
    await waitFor(() => page("document.getElementById('sign-out').hidden === false"), 'Settings to show the person signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
  } finally {
    ctx.cloud.free = free;
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.panel.hide();
    ctx.windows.close('settings');
    await waitFor(() => settings.isDestroyed(), 'the Settings window to close');
  }

  // The Welcome cannot be finished signed out; its Sign in button signs the person in and lets them go on.
  ctx.account.signOut();
  const welcome = ctx.windows.open('onboarding');
  const w = (script) => welcome.webContents.executeJavaScript(script);
  try {
    await waitFor(() => w("document.getElementById('next')?.disabled === true").catch(() => false), 'the Welcome window, with Next off');
    assert.deepStrictEqual(await w('window.buddy.finishOnboarding({})'),
      { ok: false, error: { code: 'signed_out', message: 'Sign in with Google first.' } });
    await w("document.getElementById('sign-in').click()");
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'Next to come on once signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
  } finally {
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.windows.close('onboarding');
    await waitFor(() => welcome.isDestroyed(), 'the Welcome window to close');
  }
};
