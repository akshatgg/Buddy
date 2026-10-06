'use strict';

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

  // The same for a key that was refused, and for an account out of credit; not for errors Settings cannot fix.
  const run = ctx.actions.run;
  try {
    for (const [code, message, button] of [
      ['bad_key', 'Your Claude key was rejected. Check it in Settings.', true],
      ['no_credit', 'Your Claude account is out of credit.', true],
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
  ctx.windows.open = (kind) => {
    opened.push(kind);
    return open.call(ctx.windows, kind);
  };
  try {
    await writeSomething();
    await page(`document.getElementById('error-settings').click()`);
    await waitFor(() => opened.length > 0, 'Settings to open');
    assert.deepStrictEqual(opened, ['settings']);
    assert.strictEqual(panel.isVisible(), false, 'the panel steps aside');
  } finally {
    ctx.windows.open = open;
    ctx.actions.run = run;
    ctx.windows.close('settings');
  }

  // Opening the panel again (or changing tab) clears the error and the button with it.
  await page(`document.querySelector('[data-tab="fix"]').click()`);
  assert.deepStrictEqual(await errorShown(), { message: null, button: false });
};
