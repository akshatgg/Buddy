'use strict';

// Phase 2 in the real app, with the fake account and server from smoke.js (ctx.account, ctx.cloud): Settings shows who
// is signed in and what free mode means for them, asking the server as it opens; the panel uses the free route when
// free mode is on and sends a signed-out person to Settings; Settings and the Welcome follow an account that changed
// behind their back when they get the focus back; and the Welcome cannot be finished signed out.
module.exports = async function accountCheck(ctx, { assert, waitFor }) {
  const server = { ...ctx.cloud.server }; // what the server answers
  const kept = { ...ctx.cloud.free }; // and what the app has kept: both are put back at the end
  const settings = ctx.windows.open('settings');
  const page = (script) => settings.webContents.executeJavaScript(script);
  const loaded = () => page("document.getElementById('account-line').textContent !== ''").catch(() => false);
  /** Load Settings again, and wait for the new page, not the old one. */
  async function reload() {
    await page('window.__old = true');
    settings.webContents.reload();
    await waitFor(async () => (await page('!window.__old').catch(() => false)) && loaded(), 'Settings to load again');
  }
  const aiCard = () => page(`({
    note: document.getElementById('ai-note').hidden ? null : document.getElementById('ai-note').textContent,
    form: !document.getElementById('ai').hidden,
  })`);
  /**
   * Settings draws the AI card from the settings the app kept, then asks the server and draws it again. Wait for the
   * card the server's answer gives: it only comes if Settings really asks, because the kept settings are the old ones.
   */
  async function cardShows(expected, what) {
    const shows = async () => JSON.stringify(await aiCard().catch(() => null)) === JSON.stringify(expected);
    await waitFor(shows, `the AI card for ${what}`);
    assert.deepStrictEqual(await aiCard(), expected, what);
  }
  const accountButtons = () => page("[document.getElementById('sign-in').hidden, document.getElementById('sign-out').hidden]");
  const accountStatus = () => page("document.getElementById('account-status').textContent");

  try {
    await waitFor(loaded, 'the Settings window to load');
    assert.strictEqual(await page("document.getElementById('account-line').textContent"), 'Signed in as E2E Tester (e2e@example.com)');
    assert.deepStrictEqual(await accountButtons(), [true, false], 'Sign out is offered');

    // The AI card follows the admin's switches.
    await cardShows({ note: null, form: true }, 'free mode off: the key form');
    for (const [change, expected] of [
      [{ freeOn: true, limitMode: 'unlimited', limit: null }, { note: 'Free AI is on. No key needed.', form: false }],
      [{ freeOn: true, usedToday: 4 }, { note: 'You get 30 free requests a day. Used today: 4.', form: false }],
      [{ freeOn: true, usedToday: 4, allowOwnKey: true }, {
        note: 'You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.',
        form: true,
      }],
    ]) {
      ctx.cloud.server = { ...server, ...change };
      await reload();
      await cardShows(expected, JSON.stringify(change));
    }

    // With free mode on, the panel's answer comes from the server.
    ctx.cloud.server = { ...server, freeOn: true, limitMode: 'unlimited', limit: null };
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: 'mail to my boss', tone: 'formal' })");
    assert.deepStrictEqual(ran, { ok: true, result: { text: 'A free answer', model: 'free-model' } });
    assert.deepStrictEqual(ctx.cloud.asks.at(-1), { action: 'write', input: { instruction: 'mail to my boss', tone: 'formal' } });

    // Signed out: the app forgets this person's free settings, Settings offers Sign in, and the panel sends the person there.
    const forgets = ctx.cloud.forgets;
    ctx.account.signOut();
    assert.strictEqual(ctx.cloud.forgets, forgets + 1, "signing out forgot this person's free settings");
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

    // Someone else signing in over this person, with no sign-out in between, makes the app forget the first person's
    // free settings too. The same person signing in again forgets nothing.
    const signedInBefore = ctx.cloud.forgets;
    await ctx.account.signIn();
    assert.strictEqual(ctx.cloud.forgets, signedInBefore, 'the same person again: nothing is forgotten');
    ctx.account.uid = 'e2e-someone-else';
    await ctx.account.signIn();
    assert.strictEqual(ctx.cloud.forgets, signedInBefore + 1, "someone else: the first person's free settings are forgotten");
    ctx.account.uid = 'e2e-user';
    await ctx.account.signIn(); // and back

    // A sign-in that ends behind the page's back (it expired, or another window signed out) is shown when the window
    // gets the focus back, and "Signed in ✓", which the page said about the sign-in it knew of, goes.
    assert.strictEqual(await accountStatus(), 'Signed in ✓');
    ctx.account.signOut();
    await page("window.dispatchEvent(new Event('focus'))");
    await waitFor(async () => JSON.stringify(await accountButtons()) === '[false,true]', 'Settings to show the sign-out when it gets the focus back');
    assert.strictEqual(await accountStatus(), '', '"Signed in ✓" is gone');
  } finally {
    ctx.cloud.server = server;
    ctx.cloud.free = kept;
    ctx.account.uid = 'e2e-user';
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.panel.hide();
    ctx.windows.close('settings');
    await waitFor(() => settings.isDestroyed(), 'the Settings window to close');
  }

  // The Welcome cannot be finished signed out; its Sign in button signs the person in and lets them go on.
  ctx.account.signOut();
  const welcome = ctx.windows.open('onboarding');
  const w = (script) => welcome.webContents.executeJavaScript(script);
  const signInStatus = () => w("document.getElementById('signin-status').textContent");
  const signInOfferedWithNextOff = () => w("document.getElementById('sign-in').hidden === false && document.getElementById('next').disabled === true");
  const signIn = ctx.account.signIn;
  let finishSignIn = null;
  try {
    await waitFor(() => w("document.getElementById('next')?.disabled === true").catch(() => false), 'the Welcome window, with Next off');
    assert.deepStrictEqual(await w('window.buddy.finishOnboarding({})'),
      { ok: false, error: { code: 'signed_out', message: 'Sign in with Google first.' } });
    await w("document.getElementById('sign-in').click()");
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'Next to come on once signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);

    // Signed out behind its back: the Welcome offers Sign in again when it gets the focus back, instead of leaving the
    // person to find out at the last step.
    assert.strictEqual(await signInStatus(), 'Signed in as e2e@example.com ✓');
    ctx.account.signOut();
    await w("window.dispatchEvent(new Event('focus'))");
    await waitFor(signInOfferedWithNextOff, 'the Welcome to offer Sign in again when it gets the focus back');
    assert.strictEqual(await signInStatus(), '', '"Signed in as …" is gone');

    // A sign-in that waits for the browser (the account is in, and the answer to the page is still on its way): the
    // person coming back from the browser must not find "Finish signing in in your browser…" wiped.
    ctx.account.signIn = async function waitingForTheBrowser() {
      this.signedIn = true;
      await new Promise((resolve) => {
        finishSignIn = resolve;
      });
      return signIn.call(this);
    };
    await w("document.getElementById('sign-in').click()");
    await waitFor(() => finishSignIn !== null, 'the sign-in to be under way');
    await w("window.dispatchEvent(new Event('focus'))");
    await w('window.buddy.get().then(() => true)'); // answered after the one the focus asked for: that one has been dealt with
    assert.strictEqual(await signInStatus(), 'Finish signing in in your browser…', 'the waiting sign-in is not overwritten');
    ctx.account.signIn = signIn;
    finishSignIn();
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'Next to come on once the sign-in finished');
  } finally {
    ctx.account.signIn = signIn;
    finishSignIn?.(); // a sign-in still waiting is let go, so that nothing hangs
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.windows.close('onboarding');
    await waitFor(() => welcome.isDestroyed(), 'the Welcome window to close');
  }
};
