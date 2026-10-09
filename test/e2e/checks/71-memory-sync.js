'use strict';

// What Buddy knows about the person, kept with their account (src/main/memory-sync.js), with the fake server from
// smoke.js (ctx.cloud.memory): Settings → Memory says the facts are saved to the account; opening it brings what
// another device learnt; a fact added here, and one forgotten here, reach the account a moment later.
module.exports = async function memorySyncCheck(ctx, { assert, waitFor }) {
  const PHONE = { id: 'phone-fact-1', text: 'You live in Pune.', at: 1 };
  const ADDED = 'You like masala chai.';
  const onServer = () => (ctx.cloud.memoryRecord?.facts || []).map((f) => f.text);
  if (!ctx.account.isSignedIn()) await ctx.account.signIn();

  // Learnt on the person's phone: the server has it, this computer not yet.
  await ctx.cloud.memory([{ op: 'add', ...PHONE }]);
  assert.strictEqual(ctx.memory.facts().includes(PHONE.text), false);

  const settings = ctx.windows.open('settings');
  const page = (script) => settings.webContents.executeJavaScript(script);
  try {
    await waitFor(() => page("document.querySelector('[data-section=\"memory\"]') !== null").catch(() => false), 'the Settings page to load');
    await page("document.querySelector('[data-section=\"memory\"]').click()");
    assert.match(await page("document.getElementById('memory-lead').textContent"), /saved to your account/);
    await waitFor(
      async () => (await page("document.getElementById('memory-list').innerText")).includes(PHONE.text),
      "the phone's fact to show in Settings",
    );
    assert.ok(ctx.memory.facts().includes(PHONE.text), 'kept on this computer too');

    // Added here: on the server a second later (memory-sync.js AFTER_CHANGE_MS).
    await page(`document.getElementById('memory-new').value = ${JSON.stringify(ADDED)};
      document.getElementById('memory-new').dispatchEvent(new Event('input'));
      document.getElementById('memory-add').click()`);
    await waitFor(() => onServer().includes(ADDED), 'the added fact to reach the account', 5000);

    // Forgotten here: gone from the account, and kept out of it.
    await page(`document.querySelector('#memory-list li[data-id="${PHONE.id}"] .forget').click()`);
    await waitFor(() => !onServer().includes(PHONE.text), "the phone's fact to be forgotten on the account", 5000);
    assert.ok(ctx.cloud.memoryRecord.gone.includes(PHONE.id));
    assert.deepStrictEqual(ctx.memory.facts().filter((f) => f === PHONE.text), []);
    assert.deepStrictEqual(ctx.store.get('memoryOutbox'), [], 'nothing left to send');
    assert.strictEqual(ctx.store.get('memoryUid'), ctx.account.user().uid);
  } finally {
    const added = ctx.memory.list().find((f) => f.text === ADDED);
    if (added) ctx.memory.remove(added.id);
    ctx.windows.close('settings');
    await waitFor(() => settings.isDestroyed(), 'the Settings window to close');
  }
};
