'use strict';

const path = require('node:path');
const { nativeImage } = require('electron');
const { BuddyError } = require('../../../shared/errors');

module.exports = async function panelCheck(ctx, { assert, waitFor }) {
  await ctx.actions.toggle();
  const panel = ctx.panel.window();
  await waitFor(() => panel.isVisible(), 'the panel to open');
  await waitFor(
    () => panel.webContents.executeJavaScript(`document.querySelector('[data-tab="write"]').classList.contains('active')`),
    'the Write tab, since no text was selected',
  );

  // The fake helper has no app to paste into, so the answer goes to the clipboard: the fake one in ctx.clipboard.
  const r = await panel.webContents.executeJavaScript("window.buddy.insert('Hello from Buddy', 'insert')");
  assert.deepStrictEqual(r, { ok: true, copied: true });
  assert.strictEqual(await ctx.clipboard.readText(), 'Hello from Buddy');
  assert.strictEqual(panel.isVisible(), false, 'the panel closes on insert');
  await waitFor(() => ctx.bubble.window()?.isVisible(), 'the "Copied" bubble');

  const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: '' })");
  assert.deepStrictEqual(ran, { ok: false, error: { code: 'no_key', message: 'Add your API key in Settings first.' } });

  // The panel shows that error with an "Open Settings" button, because the person fixes it there.
  const page = (script) => panel.webContents.executeJavaScript(script);
  const errorShown = () => page(`({
    message: document.getElementById('error').hidden ? null : document.getElementById('error').textContent,
    button: !document.getElementById('error-settings').hidden,
  })`);
  async function writeSomething() {
    await page(`document.getElementById('write-text').value = 'mail to my boss'; document.getElementById('write-go').click();`);
    await waitFor(async () => (await errorShown()).message !== null, 'the error to show');
    return errorShown();
  }
  assert.deepStrictEqual(await writeSomething(), { message: 'Add your API key in Settings first.', button: true });

  // The same for a key that was refused, an account out of credit, and a model that cannot be used (it is not
  // there for this key, or it cannot read screenshots), whose messages say to pick another in Settings; not for
  // errors Settings cannot fix.
  const run = ctx.actions.run;
  try {
    for (const [code, message, button] of [
      ['bad_key', 'Your Claude key was rejected. Check it in Settings.', true],
      ['no_credit', 'Your Claude account is out of credit.', true],
      ['bad_model', "This model isn't available for your key. Pick another in Settings.", true],
      ['no_vision', "This model can't read screenshots. Pick another in Settings.", true],
      ['rate_limited', 'Claude is busy right now. Try again in a minute.', false],
      ['timeout', 'Claude took too long to answer. Try again.', false],
      ['network', "Couldn't reach Claude. Check your internet.", false],
    ]) {
      ctx.actions.run = async () => { throw new BuddyError(code, message); };
      assert.deepStrictEqual(await writeSomething(), { message, button }, code);
      await page(`document.getElementById('error').hidden = true`); // so the next one is waited for
    }
  } finally {
    ctx.actions.run = run;
  }

  // The button uses the same way to Settings as the gear: the panel steps aside and Settings opens.
  ctx.actions.run = async () => { throw new BuddyError('bad_key', 'Your Claude key was rejected. Check it in Settings.'); };
  const open = ctx.windows.open;
  const opened = [];
  let settingsWindow = null;
  ctx.windows.open = (kind, options) => {
    opened.push(kind);
    settingsWindow = open.call(ctx.windows, kind, options);
    return settingsWindow;
  };
  try {
    await writeSomething();
    await page(`document.getElementById('error-settings').click()`);
    await waitFor(() => opened.length > 0, 'Settings to open');
    assert.deepStrictEqual(opened, ['settings']);
    assert.strictEqual(panel.isVisible(), false, 'the panel steps aside');
    // Let its page finish loading before it is closed again, so that closing it does not cut the load short.
    await waitFor(() => settingsWindow.webContents.executeJavaScript("document.getElementById('size') !== null"), 'the Settings page to load');
    // A key that was refused is fixed in the AI section, so Settings opens there.
    await waitFor(
      () => settingsWindow.webContents.executeJavaScript("!document.getElementById('section-ai').hidden"),
      'Settings to open on the AI section',
    );
  } finally {
    ctx.windows.open = open;
    ctx.actions.run = run;
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
  }

  // Opening the panel again (or changing tab) clears the error and the button with it.
  await page(`document.querySelector('[data-tab="fix"]').click()`);
  assert.deepStrictEqual(await errorShown(), { message: null, button: false });

  // The tabs say which one is chosen, and what goes wrong or is under way is read out as it appears.
  assert.deepStrictEqual(await page("[...document.querySelectorAll('[data-tab]')].map((tab) => tab.getAttribute('aria-pressed'))"),
    ['false', 'true', 'false']);
  assert.deepStrictEqual(await page("['error', 'busy'].map((id) => document.getElementById(id).getAttribute('aria-live'))"), ['polite', 'polite']);

  // A check of the screen, with the screenshot, a verdict, three problems and the corrected text: Replace and Copy are
  // in view without scrolling (the screenshot is smaller while an answer is shown).
  const picture = nativeImage.createFromPath(path.join(__dirname, '..', '..', '..', 'assets', 'buddies', 'previews', 'boy-1.png'));
  const { screenshot } = ctx.actions;
  ctx.actions.screenshot = async () => ({ image: picture.toJPEG(80).toString('base64') });
  ctx.actions.run = async () => ({
    text: '',
    check: {
      verdict: 'problems',
      problems: ['"recieve" should be "receive".', 'The greeting has no name after "Dear".', 'The last line ends without a full stop'],
      corrected: 'Dear Rahul,\n\nI am happy to receive your reply. See you on Monday.',
    },
  });
  try {
    await ctx.panel.show({ buddyName: 'Buddy', appName: 'Mail', selection: '', tab: 'check', notice: '' }, ctx.buddy.bounds(), ctx.buddy.display().workArea);
    await waitFor(() => page("document.getElementById('shot').naturalHeight > 0 && !document.getElementById('shot').hidden"), 'the screenshot');
    await page("document.getElementById('check-go').click()");
    await waitFor(() => page("!document.getElementById('result').hidden"), 'the answer');
    const view = await page(`(() => {
      const panel = document.querySelector('.panel');
      const box = panel.getBoundingClientRect();
      const bottom = Math.max(...['insert', 'copy'].map((id) => document.getElementById(id).getBoundingClientRect().bottom));
      return { scrollTop: panel.scrollTop, inView: bottom <= box.bottom - panel.clientTop, label: document.getElementById('insert').textContent };
    })()`);
    assert.deepStrictEqual(view, { scrollTop: 0, inView: true, label: 'Replace' }, 'Replace and Copy are in view, unscrolled');
  } finally {
    ctx.actions.run = run;
    ctx.actions.screenshot = screenshot;
    ctx.panel.hide();
  }
};
