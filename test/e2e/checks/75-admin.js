'use strict';

// The Admin window with the fake server from smoke.js: the menu offers it only to the admin; it shows the switches
// and the users; Save sends the switches and shows a refusal in plain words; Block blocks; signing out closes it.
module.exports = async function adminCheck(ctx, { assert, waitFor }) {
  const free = { ...ctx.cloud.free };
  assert.strictEqual(ctx.trayState().isAdmin, false, 'no Admin… for someone who is not the admin');
  ctx.cloud.free = { ...free, isAdmin: true };
  assert.strictEqual(ctx.trayState().isAdmin, true, 'Admin… for the admin');

  const win = ctx.windows.open('admin');
  const page = (script) => win.webContents.executeJavaScript(script);
  try {
    await waitFor(() => page("document.getElementById('users').children.length === 1").catch(() => false), 'the Admin window to show the users');
    assert.strictEqual(await page("document.getElementById('enabled').checked"), false);
    assert.strictEqual(await page("document.getElementById('provider').value"), 'anthropic');
    assert.strictEqual(await page("document.getElementById('users').textContent.includes('rahul@example.com')"), true);

    await page(`
      document.getElementById('enabled').checked = true;
      document.querySelector('input[name="limitMode"][value="daily"]').checked = true;
      document.getElementById('daily').value = '10';
      document.getElementById('own').checked = true;
      document.getElementById('save').click();
    `);
    await waitFor(() => page("document.getElementById('save-status').textContent.startsWith('Saved')"), 'the switches to be saved');
    assert.deepStrictEqual({ ...ctx.cloud.adminConfig }, {
      enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
    });

    await page("document.getElementById('daily').value = '0'; document.getElementById('save').click();");
    await waitFor(() => page("document.getElementById('save-status').className === 'error'"), 'the refusal');
    assert.strictEqual(await page("document.getElementById('save-status').textContent"), 'The daily limit must be a whole number from 1 to 10000.');

    await page("document.querySelector('#users button').click()");
    await waitFor(() => page("document.querySelector('#users button').textContent === 'Unblock'"), 'the user to show as blocked');
    assert.strictEqual(ctx.cloud.adminUsers[0].blocked, true);
  } finally {
    ctx.windows.close('admin');
    await waitFor(() => win.isDestroyed(), 'the Admin window to close');
  }

  // Signing out closes the Admin window.
  const again = ctx.windows.open('admin');
  await waitFor(() => again.webContents.executeJavaScript("document.getElementById('users') !== null").catch(() => false),
    'the Admin window to load again');
  ctx.account.signOut();
  await waitFor(() => again.isDestroyed(), 'signing out to close the Admin window');
  await ctx.account.signIn();
  ctx.cloud.free = free;
  ctx.cloud.adminUsers[0].blocked = false;
};
