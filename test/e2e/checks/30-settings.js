'use strict';

// The AI form shows every AI at once, as choices, not in a closed list that hides three of them. This only looks and
// picks. It never clicks Save key (that would ask the real provider over the network), "Get a key" (that opens the
// browser) or Refresh: the app has no key here, so choosing an AI lists its built-in models and goes nowhere. A made-up
// key is typed into the key box, to see that it stays when an AI is chosen; it is never saved.
async function aiFormCheck(ctx, win, { assert, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const labels = "[...document.querySelectorAll('#ai fieldset label')]";
  const chosen = () => page("document.querySelector('#ai input[type=radio]:checked')?.value");
  const models = () => page("[...document.getElementById('ai-model').options].map((o) => o.value)");
  const savedBefore = ctx.store.get('provider');

  // The form is in the AI section, which has to be on screen for its layout to be measured.
  await page(`document.querySelector('.nav-item[data-section="ai"]').click()`);
  assert.strictEqual(await page("document.getElementById('section-ai').hidden"), false, 'the AI section is shown');
  await waitFor(() => page("document.querySelectorAll('#ai input[type=radio]').length === 4"), 'the four AI choices');
  assert.strictEqual(await page("document.querySelector('#ai fieldset legend').textContent"), 'Which AI do you have a key for?');
  assert.deepStrictEqual(
    await page(`${labels}.map((label) => label.textContent.trim())`),
    ['Claude (Anthropic)', 'OpenAI', 'Google Gemini', 'Groq'],
    'all four AIs are there, in order',
  );
  assert.strictEqual(await page("document.querySelectorAll('#ai select').length"), 1, 'the only list left is the models');

  // Two by two, and inside the window: no sideways scrolling.
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

  // A person may paste the key first and click their AI after. The key is only put in the box here, never saved.
  await page("document.getElementById('ai-key').value = 'AIzaFAKE-pasted-first'");

  // Choose Google Gemini by its label, as a person does.
  await page(`${labels}.find((label) => label.textContent.trim() === 'Google Gemini').click()`);
  await waitFor(async () => (await models()).includes('gemini-flash-latest'), 'the Gemini models');
  assert.deepStrictEqual(await models(), ['gemini-flash-latest', 'gemini-pro-latest']);
  assert.strictEqual(await chosen(), 'gemini');
  assert.strictEqual(await page("document.getElementById('ai-key').placeholder"), 'Paste your Google Gemini key');
  assert.strictEqual(await page("document.getElementById('ai-key').value"), 'AIzaFAKE-pasted-first', 'choosing an AI keeps the key that was pasted');
  assert.strictEqual(ctx.store.get('provider'), 'gemini', 'Gemini is saved as the AI');
  await page("document.getElementById('ai-key').value = ''");

  ctx.store.set({ provider: savedBefore }); // as it was, for the checks after this one
}

/** Which sections are shown, and which sidebar items are marked as the chosen one. */
const SECTIONS_SHOWN = `({
  shown: [...document.querySelectorAll('.section')].filter((s) => !s.hidden).map((s) => s.id),
  active: [...document.querySelectorAll('.nav-item.active')].map((item) => item.dataset.section),
  current: [...document.querySelectorAll('.nav-item[aria-current="page"]')].map((item) => item.dataset.section),
})`;

// The sidebar moves between the sections. The Shortcut box records the keys pressed and saves them at once; while it
// waits for them, Buddy lets go of its global shortcut (the fake one in ctx.globalShortcut), and takes the saved one
// back when the waiting ends. Esc cancels, and Reset puts back ⌥ Space. The keys are synthetic: no real key is pressed.
async function sectionsAndShortcutCheck(ctx, win, { assert, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const registered = () => [...ctx.globalShortcut.registered.keys()];
  const recording = () => page("document.getElementById('shortcut').classList.contains('recording')");
  const keysShown = () => page("document.getElementById('shortcut-keys').textContent");
  const status = () => page("document.getElementById('shortcut-status').textContent");
  const press = (init) => page(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ ...init, bubbles: true })}))`);

  // Sections: the sidebar shows one at a time, and marks the one shown.
  await page(`document.querySelector('.nav-item[data-section="shortcut"]').click()`);
  assert.deepStrictEqual(await page(SECTIONS_SHOWN), {
    shown: ['section-shortcut'], active: ['shortcut'], current: ['shortcut'],
  }, 'the Shortcut section, and only it');
  // The arrow keys move between the sections, and the focus goes along.
  const arrow = (key) => page(`document.querySelector('.nav-item.active').dispatchEvent(new KeyboardEvent('keydown', { key: '${key}', bubbles: true }))`);
  await arrow('ArrowDown');
  assert.deepStrictEqual(await page(SECTIONS_SHOWN), { shown: ['section-ai'], active: ['ai'], current: ['ai'] }, 'Down: AI');
  assert.strictEqual(await page('document.activeElement.dataset.section'), 'ai');
  await arrow('ArrowUp');
  assert.deepStrictEqual(await page(SECTIONS_SHOWN), {
    shown: ['section-shortcut'], active: ['shortcut'], current: ['shortcut'],
  }, 'Up: back to Shortcut');

  // The recorder: a click starts it, and the global shortcut is let go while it waits.
  assert.deepStrictEqual(registered(), ['Alt+Space'], 'the shortcut is registered before recording');
  assert.strictEqual(await keysShown(), '⌥Space');
  await page("document.getElementById('shortcut').click()");
  assert.strictEqual(await recording(), true, 'the box waits for keys');
  await waitFor(() => registered().length === 0, 'the shortcut to be let go while recording');

  // ⌘⇧B: saved at once, in the Mac's order, and registered.
  await press({ code: 'KeyB', key: 'B', metaKey: true, shiftKey: true });
  await waitFor(() => ctx.store.get('shortcut') === 'Shift+Command+B', 'the new shortcut to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  await waitFor(() => registered().length === 1, 'the new shortcut to be registered');
  assert.deepStrictEqual(registered(), ['Shift+Command+B']);
  assert.strictEqual(await keysShown(), '⇧⌘B');
  assert.strictEqual(await recording(), false, 'the box stops waiting');

  // Esc cancels: the saved shortcut stays, and is registered again.
  await page("document.getElementById('shortcut').click()");
  assert.strictEqual(await recording(), true);
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again');
  assert.deepStrictEqual(registered(), ['Shift+Command+B']);
  assert.strictEqual(ctx.store.get('shortcut'), 'Shift+Command+B', 'Esc changes nothing');
  assert.strictEqual(await recording(), false);
  assert.strictEqual(await keysShown(), '⇧⌘B');

  // Reset puts back ⌥ Space (and leaves it so, for the checks after this one).
  await page("document.getElementById('shortcut-reset').click()");
  await waitFor(() => ctx.store.get('shortcut') === 'Alt+Space', 'the default shortcut to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  assert.strictEqual(await keysShown(), '⌥Space');

  // General: Always on is a switch, on, and the version is shown.
  await page(`document.querySelector('.nav-item[data-section="general"]').click()`);
  assert.deepStrictEqual(await page(SECTIONS_SHOWN), {
    shown: ['section-general'], active: ['general'], current: ['general'],
  }, 'the General section, and only it');
  assert.deepStrictEqual(
    await page("(({ type, checked, className }) => ({ type, checked, isSwitch: className.split(' ').includes('switch') }))(document.getElementById('power'))"),
    { type: 'checkbox', checked: true, isSwitch: true },
    'Always on is a switch, and it is on',
  );
  assert.match(await page("document.getElementById('version').textContent"), /^Buddy \S/);
}

module.exports = async function settingsCheck(ctx, { assert, waitFor }) {
  const win = ctx.windows.open('settings');
  await waitFor(
    () => win.webContents.executeJavaScript("document.querySelector('#size input:checked')?.value === 'medium'"),
    'the Settings window to load',
  );
  // It opens on the Buddy section.
  assert.deepStrictEqual(await win.webContents.executeJavaScript(SECTIONS_SHOWN), {
    shown: ['section-buddy'], active: ['buddy'], current: ['buddy'],
  }, 'Settings opens on Buddy');
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
  await sectionsAndShortcutCheck(ctx, win, { assert, waitFor });

  win.close();
  // A window that is closing still counts as open, so wait for it to be gone: the next check may open Settings again.
  await waitFor(() => win.isDestroyed(), 'the Settings window to close');
};
