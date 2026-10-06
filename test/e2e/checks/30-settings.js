'use strict';

// The AI form shows every AI at once, as choices, not in a closed list that hides three of them. This only looks and
// picks. It never clicks Save key (that would ask the real provider over the network), "Get a key" (that opens the
// browser) or Refresh: the app has no key here, so choosing an AI lists its built-in models and goes nowhere.
async function aiFormCheck(ctx, win, { assert, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const labels = "[...document.querySelectorAll('#ai fieldset label')]";
  const chosen = () => page("document.querySelector('#ai input[type=radio]:checked')?.value");
  const models = () => page("[...document.getElementById('ai-model').options].map((o) => o.value)");
  const savedBefore = ctx.store.get('provider');

  await waitFor(() => page("document.querySelectorAll('#ai input[type=radio]').length === 4"), 'the four AI choices');
  assert.strictEqual(await page("document.querySelector('#ai fieldset legend').textContent"), 'Which AI do you have a key for?');
  assert.deepStrictEqual(
    await page(`${labels}.map((label) => label.textContent.trim())`),
    ['Claude (Anthropic)', 'OpenAI', 'Google Gemini', 'Groq'],
    'all four AIs are there, in order',
  );
  assert.strictEqual(await page("document.querySelectorAll('#ai select').length"), 1, 'the only list left is the models');

  // Two by two, and inside the 520 px window: no sideways scrolling.
  const boxes = await page(`${labels}.map((label) => {
    const { left, right, top } = label.getBoundingClientRect();
    return { left, right, top };
  })`);
  const same = (a, b) => Math.abs(a - b) < 1;
  assert.ok(same(boxes[0].top, boxes[1].top) && same(boxes[2].top, boxes[3].top) && boxes[2].top > boxes[0].top + 1, 'two rows of two');
  assert.ok(same(boxes[0].left, boxes[2].left) && same(boxes[1].left, boxes[3].left) && boxes[1].left > boxes[0].right, 'two columns');
  const windowWidth = await page('document.documentElement.clientWidth');
  assert.ok(Math.max(...boxes.map((box) => box.right)) <= windowWidth, 'the choices end inside the window');
  assert.strictEqual(
    await page("document.getElementById('ai').scrollWidth <= document.getElementById('ai').clientWidth"),
    true,
    'nothing in the AI form sticks out sideways',
  );

  assert.strictEqual(await chosen(), 'anthropic', 'a new Buddy starts with Claude chosen');
  assert.strictEqual(await page("document.getElementById('ai-key').placeholder"), 'Paste your Claude (Anthropic) key');

  // Choose Google Gemini by its label, as a person does.
  await page(`${labels}.find((label) => label.textContent.trim() === 'Google Gemini').click()`);
  await waitFor(async () => (await models()).includes('gemini-flash-latest'), 'the Gemini models');
  assert.deepStrictEqual(await models(), ['gemini-flash-latest', 'gemini-pro-latest']);
  assert.strictEqual(await chosen(), 'gemini');
  assert.strictEqual(await page("document.getElementById('ai-key').placeholder"), 'Paste your Google Gemini key');
  assert.strictEqual(ctx.store.get('provider'), 'gemini', 'Gemini is saved as the AI');

  ctx.store.set({ provider: savedBefore }); // as it was, for the checks after this one
}

module.exports = async function settingsCheck(ctx, { assert, waitFor }) {
  const win = ctx.windows.open('settings');
  await waitFor(
    () => win.webContents.executeJavaScript("document.getElementById('size').value === 'medium'"),
    'the Settings window to load',
  );
  const before = ctx.buddy.window().getBounds();
  const r = await win.webContents.executeJavaScript("window.buddy.set({ size: 'large' })");
  assert.strictEqual(r.ok, true, 'size saved');
  const after = ctx.buddy.window().getBounds();
  assert.ok(after.width > before.width, 'the buddy grew');
  assert.strictEqual(after.y + after.height, before.y + before.height, 'it kept its bottom edge');

  const bad = await win.webContents.executeJavaScript("window.buddy.set({ size: 'huge' })");
  assert.deepStrictEqual(bad, { ok: false, error: { code: 'bad_request', message: 'Unknown size.' } });

  const perms = await win.webContents.executeJavaScript('window.buddy.permissions()');
  assert.deepStrictEqual(perms, { ok: true, accessibility: true, screenRecording: true });

  await aiFormCheck(ctx, win, { assert, waitFor });

  win.close();
  // A window that is closing still counts as open, so wait for it to be gone: the next check may open Settings again.
  await waitFor(() => win.isDestroyed(), 'the Settings window to close');
};
