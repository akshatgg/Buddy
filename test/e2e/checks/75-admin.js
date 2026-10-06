'use strict';

const { BuddyError } = require('../../../shared/errors');

// The Admin window with the fake server from smoke.js: the menu offers it only to the admin; the page shows nothing
// until the settings have arrived; it then offers the switches (only the providers that have a key on the server) and
// the users; Unlimited hides what belongs to a daily limit and saves although that is left empty; Save sends the
// switches, shows a refusal in plain words, and its "Saved ✓" goes when a field is changed; Block blocks, and the row
// shows it even when the list cannot be loaded again; signing out closes the window.
module.exports = async function adminCheck(ctx, { assert, waitFor }) {
  // What the server answers, what the app has kept, and the fake server's admin data: all put back at the end.
  const server = { ...ctx.cloud.server };
  const kept = { ...ctx.cloud.free };
  const adminConfig = { ...ctx.cloud.adminConfig };
  const blocked = ctx.cloud.adminUsers[0].blocked;
  // Two calls of the fake server are held back or made to fail for a while below: they are put back too.
  const { admin } = ctx.cloud;
  const { settings: adminSettings, users: adminUsers } = admin;
  let answerSettings = () => {};
  try {
    assert.strictEqual(ctx.trayState().isAdmin, false, 'no Admin… for someone who is not the admin');
    ctx.cloud.server = { ...server, isAdmin: true }; // the server says this person is the admin, and the app keeps it once it asks
    await ctx.cloud.settings();
    assert.strictEqual(ctx.trayState().isAdmin, true, 'Admin… for the admin');

    // The server's answer with the settings is held back, to see the page before it arrives.
    const held = new Promise((resolve) => {
      answerSettings = resolve;
    });
    admin.settings = async () => {
      await held;
      return adminSettings.call(admin);
    };
    const win = ctx.windows.open('admin');
    const page = (script) => win.webContents.executeJavaScript(script);
    const cards = () => page("[document.getElementById('free-card').hidden, document.getElementById('users-card').hidden]");
    const rows = () => page("[document.getElementById('daily-row').hidden, document.getElementById('own-row').hidden]");
    const limitMode = (mode) => page(`document.querySelector('input[name="limitMode"][value="${mode}"]').click()`);
    try {
      await waitFor(() => page("document.getElementById('save') !== null").catch(() => false), 'the Admin page to load');
      assert.deepStrictEqual(await cards(), [true, true], 'nothing is offered until the settings have arrived');
      answerSettings();
      admin.settings = adminSettings;
      await waitFor(() => page("document.getElementById('users').children.length === 1").catch(() => false), 'the Admin window to show the users');
      assert.deepStrictEqual(await cards(), [false, false], 'both cards show once they have');
      assert.strictEqual(await page("document.getElementById('enabled').checked"), false);
      assert.strictEqual(await page("document.getElementById('provider').value"), 'anthropic');
      assert.deepStrictEqual(await page("[...document.getElementById('provider').options].map((o) => o.value)"), ['anthropic'],
        'only a provider that has a key on the server is offered');
      assert.strictEqual(await page("document.getElementById('users').textContent.includes('rahul@example.com')"), true);
      assert.strictEqual(await page("getComputedStyle(document.getElementById('own-row')).marginLeft"), '26px',
        'the own-key box is indented under the daily limit');

      await page(`
        document.getElementById('enabled').checked = true;
        document.querySelector('input[name="limitMode"][value="daily"]').checked = true;
        document.getElementById('daily').value = '10';
        document.getElementById('own').checked = true;
        document.getElementById('save').click();
      `);
      await waitFor(() => page("document.getElementById('save-status').textContent.startsWith('Saved')"), 'the switches to be saved');
      assert.strictEqual(await page("document.getElementById('save-status').textContent"), 'Saved ✓ Every Buddy app uses it the next time it is opened.');
      assert.deepStrictEqual({ ...ctx.cloud.adminConfig }, {
        enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      });

      // "Saved ✓" is about what was saved: it goes as soon as a field is changed.
      await page("document.getElementById('own').click()");
      assert.strictEqual(await page("document.getElementById('save-status').textContent"), '', 'no "Saved ✓" beside an edit that is not saved');

      // Unlimited hides what belongs to a daily limit, and saves although the daily box was emptied first: what is in
      // the hidden boxes is not sent.
      await page("document.getElementById('daily').value = ''");
      await limitMode('unlimited');
      assert.deepStrictEqual(await rows(), [true, true], 'Unlimited hides the daily box and the own-key box');
      await page("document.getElementById('save').click()");
      await waitFor(() => page("['good', 'error'].includes(document.getElementById('save-status').className)"), 'Unlimited to be answered');
      assert.strictEqual(await page("document.getElementById('save-status').textContent"), 'Saved ✓ Every Buddy app uses it the next time it is opened.');
      assert.deepStrictEqual({ ...ctx.cloud.adminConfig }, {
        enabled: true, limitMode: 'unlimited', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
      }, 'only the mode changed: the hidden boxes were left as saved');

      // Back to a daily limit: both boxes are there again, as they were saved.
      await limitMode('daily');
      assert.deepStrictEqual(await rows(), [false, false], 'a daily limit shows them again');
      assert.deepStrictEqual(await page("[document.getElementById('daily').value, document.getElementById('own').checked]"), ['10', true]);

      await page("document.getElementById('daily').value = '0'; document.getElementById('save').click();");
      await waitFor(() => page("document.getElementById('save-status').className === 'error'"), 'the refusal');
      assert.strictEqual(await page("document.getElementById('save-status').textContent"), 'The daily limit must be a whole number from 1 to 10000.');

      await page("document.querySelector('#users button').click()");
      await waitFor(() => page("document.querySelector('#users button').textContent === 'Unblock'"), 'the user to show as blocked');
      assert.strictEqual(ctx.cloud.adminUsers[0].blocked, true);
      // The row already shows the block while the list is still being loaded again: wait for that, so that the answer
      // to it cannot land in the middle of what follows.
      await waitFor(() => page("document.getElementById('users-status').textContent !== 'Loading…'"), 'the list to be loaded again');

      // When the list cannot be loaded again just after a block, the row still shows what the server answered, and can
      // be used again.
      admin.users = async () => {
        throw new BuddyError('server', "Buddy's server had a problem. Try again.");
      };
      const row = () => page(`(() => {
        const tr = document.querySelector('#users tr');
        const button = tr.querySelector('button');
        return [button.textContent, button.disabled, tr.className];
      })()`);
      const rowShows = (expected, what) => waitFor(async () => JSON.stringify(await row()) === JSON.stringify(expected), what);
      await page("document.querySelector('#users button').click()");
      await rowShows(['Block', false, ''], 'the row to show the user unblocked');
      await waitFor(() => page("document.getElementById('users-status').className === 'error'"), 'the list to fail to load again');
      assert.strictEqual(await page("document.getElementById('users-status').textContent"), "Buddy's server had a problem. Try again.");
      assert.strictEqual(ctx.cloud.adminUsers[0].blocked, false);
      await page("document.querySelector('#users button').click()");
      await rowShows(['Unblock', false, 'blocked'], 'the row to show the user blocked again');
      assert.strictEqual(ctx.cloud.adminUsers[0].blocked, true);
      await waitFor(() => page("document.getElementById('users-status').textContent !== 'Loading…'"), 'the list to be tried again');
      admin.users = adminUsers;
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
  } finally {
    answerSettings();
    admin.settings = adminSettings;
    admin.users = adminUsers;
    ctx.cloud.server = server;
    ctx.cloud.free = kept;
    ctx.cloud.adminConfig = adminConfig;
    ctx.cloud.adminUsers[0].blocked = blocked;
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
  }
};
