'use strict';

const { clipboard } = require('electron');

module.exports = async function panelCheck(ctx, { assert, waitFor }) {
  const saved = clipboard.readText();
  try {
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    await waitFor(
      () => panel.webContents.executeJavaScript(`document.querySelector('[data-tab="write"]').classList.contains('active')`),
      'the Write tab, since no text was selected',
    );

    // The fake helper has no app to paste into, so the answer goes to the clipboard.
    const r = await panel.webContents.executeJavaScript("window.buddy.insert('Hello from Buddy', 'insert')");
    assert.deepStrictEqual(r, { ok: true, copied: true });
    assert.strictEqual(clipboard.readText(), 'Hello from Buddy');
    assert.strictEqual(panel.isVisible(), false, 'the panel closes on insert');
    await waitFor(() => ctx.bubble.window()?.isVisible(), 'the "Copied" bubble');

    const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: '' })");
    assert.deepStrictEqual(ran, { ok: false, error: { code: 'no_key', message: 'Add your API key in Settings first.' } });
  } finally {
    clipboard.writeText(saved);
  }
};
