'use strict';

// Buddy where you type (src/main/tag.js): the helper watches for "@buddy" (and the buddy's own name) while Buddy is
// on; when it says one was typed in an app and the person paused, the paragraph is read, rewritten by the AI and put
// back over itself, and the bubble says so. The helper and the app are the fake ones (smoke.js): the paragraph is what
// captureSelection answers, and the paste is read back from the helper's calls.
module.exports = async function tagCheck(ctx, { assert, waitFor }) {
  await waitFor(() => Array.isArray(ctx.helper.watchingTyping), 'the helper to watch for the tag');
  assert.ok(ctx.helper.watchingTyping.includes('buddy'), `the tag's names: ${ctx.helper.watchingTyping}`);

  const typed = 'i not coming tomorow @buddy';
  const answer = 'I am not coming tomorrow.';
  const asked = [];
  const { ask } = ctx.ai;
  ctx.ai.ask = async (action, input) => {
    asked.push({ action, input });
    return { text: answer, model: 'e2e-model' };
  };
  ctx.helper.replies.captureSelection = { text: typed };
  ctx.helper.replies.paste = {};
  ctx.helper.calls.length = 0;
  try {
    ctx.helper.emit('tag', { event: 'tag', pid: 4242 });
    await waitFor(() => ctx.helper.calls.some((c) => c.cmd === 'paste'), 'the new text to be pasted');
    assert.deepStrictEqual(asked, [{ action: 'tag', input: { text: 'i not coming tomorow', instruction: '' } }]);
    assert.deepStrictEqual(ctx.helper.calls.map((c) => c.cmd), ['captureSelection', 'captureSelection', 'paste']);
    assert.deepStrictEqual(ctx.helper.calls[0].args, { pid: 4242, select: 'paragraph' });
    assert.deepStrictEqual(ctx.helper.calls[2].args, { pid: 4242, text: answer, selectAll: false });
    const undo = process.platform === 'darwin' ? '⌘Z' : 'Ctrl+Z';
    await waitFor(async () => {
      const win = ctx.bubble.window();
      return Boolean(win?.isVisible()) && (await win.webContents.executeJavaScript("document.getElementById('text').textContent")) === `Fixed ✅ ${undo} undoes it`;
    }, 'the bubble to say it is fixed');
  } finally {
    ctx.ai.ask = ask;
    delete ctx.helper.replies.captureSelection;
    delete ctx.helper.replies.paste;
  }
};
