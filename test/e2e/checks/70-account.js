'use strict';

const { BuddyError } = require('../../../shared/errors');

// Phase 2 in the real app, with the fake account and server from smoke.js (ctx.account, ctx.cloud): Settings shows who
// is signed in and what free mode means for them, asking the server as it opens; what is typed in Settings stays while
// it asks, and while the person signs in or out; the panel uses the free route when free mode is on and sends a
// signed-out person to Settings; Cancel on Google's page is shown in Settings and in the Welcome; someone else signing
// in makes the app forget the first person's free settings; Settings and the Welcome follow an account that changed
// behind their back when they get the focus back (the Welcome going back to its Sign in step); and the Welcome cannot
// be finished signed out.
module.exports = async function accountCheck(ctx, { assert, waitFor }) {
  const server = { ...ctx.cloud.server }; // what the server answers
  const kept = { ...ctx.cloud.free }; // and what the app has kept: both are put back at the end
  const fetchSettings = ctx.cloud.settings; // held back for a while below, and put back at the end too
  // What signing in fails with when the person presses Cancel on Google's page (src/main/google-signin.js).
  const denied = () => new BuddyError('sign_in_denied', "You didn't finish signing in with Google. Try again.");
  const settings = ctx.windows.open('settings');
  const page = (script) => settings.webContents.executeJavaScript(script);
  const loaded = () => page("document.getElementById('profile-name').textContent !== ''").catch(() => false);
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
  const signInTop = () => page("document.getElementById('sign-in').getBoundingClientRect().top");
  // The profile at the top of the sidebar: the name, the email, the initials and whether the photo is shown.
  const profile = () => page(`({
    name: document.getElementById('profile-name').textContent,
    email: document.getElementById('profile-email').textContent,
    initials: document.getElementById('avatar-initials').textContent,
    photo: !document.getElementById('avatar-img').hidden,
  })`);
  const SIGNED_OUT = { name: 'Not signed in', email: 'Sign in with Google to use your buddy.', initials: '', photo: false };
  // Typing in the name box without leaving it: the page saves a name only when the box is left.
  const typeName = (text) => page(`document.getElementById('name').value = ${JSON.stringify(text)}`);
  const nameBox = () => page("document.getElementById('name').value");
  let answerFetch = null;

  try {
    await waitFor(loaded, 'the Settings window to load');
    // The fake account has no photo, so its initials are shown.
    assert.deepStrictEqual(await profile(), { name: 'E2E Tester', email: 'e2e@example.com', initials: 'ET', photo: false });
    assert.deepStrictEqual(await accountButtons(), [true, false], 'Sign out is offered');
    // A name or an email too long for the sidebar is cut short with "…": the whole of it shows on hover.
    assert.deepStrictEqual(await page("[document.getElementById('profile-name').title, document.getElementById('profile-email').title]"),
      ['E2E Tester', 'e2e@example.com']);

    // Initials are whole characters: a name that starts with an emoji keeps it whole, not half of it.
    const { user } = ctx.account;
    ctx.account.user = function withEmoji() {
      const person = user.call(this);
      return person && { ...person, name: '🦊Fox Tester' };
    };
    try {
      await reload();
      assert.strictEqual((await profile()).initials, '🦊T');
    } finally {
      ctx.account.user = user;
    }
    await reload();

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

    // What is typed while Settings asks the server as it opens stays: the answer redraws the AI card, not the boxes.
    ctx.cloud.settings = async function heldBack(...args) {
      await new Promise((resolve) => {
        answerFetch = resolve;
      });
      return fetchSettings.apply(this, args);
    };
    ctx.cloud.server = { ...server, freeOn: true, limitMode: 'unlimited', limit: null };
    await reload();
    await waitFor(() => answerFetch !== null, 'Settings to ask the server');
    await typeName('Typed while it asks');
    ctx.cloud.settings = fetchSettings;
    answerFetch();
    await cardShows({ note: 'Free AI is on. No key needed.', form: false }, "the server's answer");
    assert.strictEqual(await nameBox(), 'Typed while it asks', 'what was typed while Settings asked stays');

    // With free mode on, the panel's answer comes from the server.
    ctx.cloud.server = { ...server, freeOn: true, limitMode: 'unlimited', limit: null };
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: 'mail to my boss', tone: 'formal' })");
    assert.deepStrictEqual(ran, { ok: true, result: { text: 'A free answer', model: 'free-model' } });
    assert.deepStrictEqual(ctx.cloud.asks.at(-1), { action: 'write', input: { instruction: 'mail to my boss', tone: 'formal' } });

    // Signed out from Settings: the app forgets this person's free settings, Settings offers Sign in (and keeps what is
    // being typed), and the panel sends the person there.
    const forgets = ctx.cloud.forgets;
    await typeName('Typed before signing out');
    await page("document.getElementById('sign-out').click()");
    await waitFor(async () => JSON.stringify(await accountButtons()) === '[false,true]', 'Settings to offer Sign in');
    assert.strictEqual(ctx.account.isSignedIn(), false);
    assert.strictEqual(ctx.cloud.forgets, forgets + 1, "signing out forgot this person's free settings");
    assert.strictEqual(await accountStatus(), 'Signed out.');
    assert.deepStrictEqual(await profile(), SIGNED_OUT, 'the profile says nobody is signed in');
    assert.strictEqual(await nameBox(), 'Typed before signing out', 'what was typed stays');
    await reload();
    assert.deepStrictEqual(await accountButtons(), [false, true], 'Sign in is offered');
    assert.deepStrictEqual(await profile(), SIGNED_OUT, 'and so it does after loading again');
    const signInAt = await signInTop();
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

    // Cancel on Google's page: Settings says so, and the person stays signed out.
    ctx.account.nextSignInError = denied();
    await page("document.getElementById('sign-in').click()");
    await waitFor(async () => (await accountStatus()) === denied().message, 'Settings to say that the sign-in did not finish');
    assert.strictEqual(ctx.account.isSignedIn(), false);
    assert.deepStrictEqual(await accountButtons(), [false, true], 'Sign in is still offered');
    assert.strictEqual(await signInTop(), signInAt, 'and the button has not moved for the lines under it');

    // Signing in from Settings, which keeps what is being typed too.
    await typeName('Typed before signing in');
    await page("document.getElementById('sign-in').click()");
    await waitFor(() => page("document.getElementById('sign-out').hidden === false"), 'Settings to show the person signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
    assert.strictEqual(await accountStatus(), 'Signed in ✓'); // it fades after a few seconds, as "Saved ✓" does
    assert.deepStrictEqual(await profile(), { name: 'E2E Tester', email: 'e2e@example.com', initials: 'ET', photo: false });
    assert.strictEqual(await nameBox(), 'Typed before signing in', 'what was typed stays');

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

    // An account that changes behind the page's back (a sign-in that expired, another window signing out or in) is
    // shown when the window gets the focus back, and what the page said about the account it knew of goes.
    await page("document.getElementById('sign-out').click()");
    await waitFor(async () => (await accountStatus()) === 'Signed out.', 'Settings to say it signed out');
    await ctx.account.signIn();
    await page("window.dispatchEvent(new Event('focus'))");
    await waitFor(async () => JSON.stringify(await accountButtons()) === '[true,false]', 'Settings to show the sign-in when it gets the focus back');
    assert.strictEqual(await accountStatus(), '', '"Signed out." is gone');
    assert.deepStrictEqual(await profile(), { name: 'E2E Tester', email: 'e2e@example.com', initials: 'ET', photo: false });
    ctx.account.signOut();
    await page("window.dispatchEvent(new Event('focus'))");
    await waitFor(async () => JSON.stringify(await accountButtons()) === '[false,true]', 'Settings to show the sign-out when it gets the focus back');
    assert.deepStrictEqual(await profile(), SIGNED_OUT, 'and the profile with it');
  } finally {
    ctx.cloud.settings = fetchSettings;
    answerFetch?.(); // a fetch still held back is let go, so that nothing hangs
    ctx.cloud.server = server;
    ctx.cloud.free = kept;
    ctx.account.uid = 'e2e-user';
    ctx.account.nextSignInError = null;
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
  const shownSteps = () => w("['signin', 'pick', 'accessibility', 'screen', 'ai'].filter((name) => !document.getElementById('step-' + name).hidden)");
  const signIn = ctx.account.signIn;
  let finishSignIn = null;
  try {
    await waitFor(() => w("document.getElementById('next')?.disabled === true").catch(() => false), 'the Welcome window, with Next off');
    assert.deepStrictEqual(await w('window.buddy.finishOnboarding({})'),
      { ok: false, error: { code: 'signed_out', message: 'Sign in with Google first.' } });
    // Each step sits at the top of its card, so the title is in the same place on every step; and once signed in, the
    // line that says so takes the button's place, at its size, so nothing on the step moves.
    const box = (selector) => w(`(({ top, left, width, height }) => [top, left, width, height].map(Math.round))(document.querySelector('${selector}').getBoundingClientRect())`);
    const button = await box('#sign-in');
    const title = await box('#step-signin h1');

    // Cancel on Google's page: the Welcome says so, the person stays signed out, and Next stays off.
    ctx.account.nextSignInError = denied();
    await w("document.getElementById('sign-in').click()");
    await waitFor(async () => (await signInStatus()) === denied().message, 'the Welcome to say that the sign-in did not finish');
    assert.strictEqual(ctx.account.isSignedIn(), false);
    assert.strictEqual(await signInOfferedWithNextOff(), true, 'Sign in is still offered, and Next is still off');

    await w("document.getElementById('sign-in').click()");
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'Next to come on once signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
    assert.deepStrictEqual(await box('#signin-status'), button, '"Signed in as …" is where the button was, at its size');
    assert.deepStrictEqual(await box('#step-signin h1'), title, 'and the title has not moved');

    // Signed out behind its back on a later step: when it gets the focus back, the Welcome goes back to its first step
    // and offers Sign in again, instead of leaving the person to find out at the last step.
    assert.strictEqual(await signInStatus(), 'Signed in as e2e@example.com ✓');
    await w("document.getElementById('next').click()");
    assert.deepStrictEqual(await shownSteps(), ['pick'], 'on to the next step');
    assert.deepStrictEqual(await box('#step-pick h1'), title, "whose title is where the first step's was");
    ctx.account.signOut();
    await w("window.dispatchEvent(new Event('focus'))");
    await waitFor(async () => JSON.stringify(await shownSteps()) === '["signin"]' && (await signInOfferedWithNextOff()),
      'the Welcome to go back to Sign in when it gets the focus back');
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
    ctx.account.nextSignInError = null;
    finishSignIn?.(); // a sign-in still waiting is let go, so that nothing hangs
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.windows.close('onboarding');
    await waitFor(() => welcome.isDestroyed(), 'the Welcome window to close');
  }
};
