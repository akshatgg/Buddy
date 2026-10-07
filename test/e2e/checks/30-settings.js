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
// back when the waiting ends: saved, refused, Esc, another section chosen, or the window losing the focus (a second
// after, so that a key tapped just then is still saved: fn, when macOS opens its emoji picker). The
// modifiers held show as key caps and follow the keys; a key that can't be used says why and the box goes on waiting;
// a shortcut another app owns (⌃⌘K, in the fake) is refused and the old one kept. Esc cancels, and Reset puts back
// ⌥ Space. A key tapped on its own is heard by the Mac helper (the fake one in ctx.helper, which the check makes report
// the taps): it is recorded and saved, opens the panel when it is tapped alone and not with another key, and has a note
// under the box that turns red without Accessibility, where a box that waits for keys says so too. The keys, and the
// taps the helper reports, are synthetic: no real key is pressed.
async function sectionsAndShortcutCheck(ctx, win, { assert, delay, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const registered = () => [...ctx.globalShortcut.registered.keys()];
  const recording = () => page("document.getElementById('shortcut').classList.contains('recording')");
  const keysShown = () => page("document.getElementById('shortcut-keys').textContent");
  const caps = () => page("[...document.querySelectorAll('#shortcut-keys kbd')].map((cap) => cap.textContent)");
  const status = () => page("document.getElementById('shortcut-status').textContent");
  const press = (init, type = 'keydown') => page(`document.dispatchEvent(new KeyboardEvent('${type}', ${JSON.stringify({ ...init, bubbles: true })}))`);
  const letGo = (init) => press(init, 'keyup');
  // The colour of the box's edge as [r, g, b] (a canvas reads any CSS colour), with its transition off, so that what
  // is read is the colour it ends at. It is only ever asked whether it is red: the real pointer may be over the box,
  // which gives it its (grey) hover edge.
  await win.webContents.insertCSS('#shortcut { transition: none !important; }');
  const edge = () => page(`(() => {
    const canvas = document.createElement('canvas').getContext('2d');
    canvas.fillStyle = getComputedStyle(document.getElementById('shortcut')).borderTopColor;
    canvas.fillRect(0, 0, 1, 1);
    return [...canvas.getImageData(0, 0, 1, 1).data].slice(0, 3);
  })()`);
  const red = ([r, g, b]) => r - Math.max(g, b) > 60;

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

  // While it waits, the modifiers held show as key caps, with a cap for the key still to come, and they follow the keys
  // as they are let go.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  assert.strictEqual(await keysShown(), 'Press your shortcut…');
  await press({ code: 'MetaLeft', key: 'Meta', metaKey: true });
  assert.deepStrictEqual(await caps(), ['⌘', '…'], '⌘ held');
  await press({ code: 'ShiftLeft', key: 'Shift', metaKey: true, shiftKey: true });
  assert.deepStrictEqual(await caps(), ['⇧', '⌘', '…'], '⇧ and ⌘ held, in the Mac order');
  await letGo({ code: 'ShiftLeft', key: 'Shift', metaKey: true });
  assert.deepStrictEqual(await caps(), ['⌘', '…'], '⇧ let go');
  await letGo({ code: 'MetaLeft', key: 'Meta' });
  assert.deepStrictEqual(await caps(), [], 'nothing held');
  assert.strictEqual(await keysShown(), 'Press your shortcut…');

  // A key that can't make a shortcut says why, and so does one that every app uses; the box goes on waiting. Esc then
  // gives up: what was said goes with it, and the box is not left red around the saved shortcut.
  await press({ code: 'KeyB', key: 'b' });
  assert.strictEqual(await status(), 'Hold ⌘, ⌥ or ⌃ with the key.');
  await press({ code: 'KeyC', key: 'c', metaKey: true });
  assert.strictEqual(await status(), '⌘C is used by every app (Copy). Pick another one.');
  assert.strictEqual(await recording(), true, 'the box still waits');
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again');
  assert.strictEqual(ctx.store.get('shortcut'), 'Shift+Command+B', 'nothing was saved');
  assert.strictEqual(await status(), '', 'no refusal is left once the box stops waiting');
  assert.ok(!red(await edge()), 'and the box is not red');
  assert.strictEqual(await keysShown(), '⇧⌘B');

  // ⌃⌘K belongs to another app (in the fake): it is refused, the box shows the saved keys again with a red edge, and
  // the saved shortcut is registered again. The red goes when the box is clicked again.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  await press({ code: 'KeyK', key: 'k', ctrlKey: true, metaKey: true });
  await waitFor(async () => (await status()).includes('taken'), 'the shortcut to be refused');
  assert.strictEqual(await status(), '⌃ ⌘ K is taken. Try another one.');
  assert.strictEqual(await keysShown(), '⇧⌘B', 'the saved keys are shown again');
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again');
  assert.deepStrictEqual(registered(), ['Shift+Command+B']);
  assert.strictEqual(ctx.store.get('shortcut'), 'Shift+Command+B', 'nothing was saved');
  assert.strictEqual(await recording(), false);
  assert.ok(red(await edge()), 'the box is red');
  await page("document.getElementById('shortcut').click()");
  assert.strictEqual(await status(), '', 'a new recording starts afresh');
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again');
  assert.ok(!red(await edge()), 'and the box is not red any more');

  // Reset puts back ⌥ Space (and leaves it so, for the checks after this one).
  await page("document.getElementById('shortcut-reset').click()");
  await waitFor(() => ctx.store.get('shortcut') === 'Alt+Space', 'the default shortcut to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  assert.strictEqual(await keysShown(), '⌥Space');

  // Reset with ⌥ Space already saved says so, and saves nothing.
  const { set } = ctx.store;
  let saves = 0;
  ctx.store.set = function counted(patch) {
    if (Object.hasOwn(patch, 'shortcut')) saves += 1;
    return set.call(this, patch);
  };
  try {
    await page("document.getElementById('shortcut-reset').click()");
    await waitFor(async () => (await status()) === 'Already ⌥ Space.', 'Reset to say it is ⌥ Space already');
  } finally {
    ctx.store.set = set;
  }
  assert.strictEqual(saves, 0, 'nothing was saved');
  assert.deepStrictEqual(registered(), ['Alt+Space']);

  // A key tapped on its own. While the box waits, the Mac helper (the fake in ctx.helper) listens to the modifier keys;
  // the tap it reports is saved at once, and from then on the helper listens for it, not Electron. Tapped on its own it
  // opens the panel; with another key pressed meanwhile it does not. The reports are the real helper's: a key code, the
  // flags after the change (their bits say which side is down) and the time in milliseconds.
  const keys = (...events) => {
    for (const event of events) ctx.helper.emit('keys', event);
  };
  const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags, t });
  const RIGHT_OPTION_DOWN = 0x80040; // an ⌥ is down, and it is the right one
  const note = () => page("document.getElementById('shortcut-note').hidden ? null : document.getElementById('shortcut-note').textContent");
  const TAP_NOTE = 'Tap it on its own to open your buddy: press and let go, with no other key.';
  const CAPS_NOTE = `${TAP_NOTE} Caps Lock also turns capitals on and off when you tap it.`;
  assert.strictEqual(await note(), null, 'no note for keys pressed together');
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0 && ctx.helper.watching === true, 'the helper to listen while the box waits');
  keys(change(61, RIGHT_OPTION_DOWN, 1000), change(61, 0, 1120));
  await waitFor(() => ctx.store.get('shortcut') === 'Tap:RightOption', 'the tapped key to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  assert.deepStrictEqual(await caps(), ['Right ⌥'], 'the key is shown with its side');
  assert.strictEqual(await recording(), false);
  assert.deepStrictEqual(registered(), [], 'nothing is registered with Electron');
  await waitFor(async () => (await note()) === TAP_NOTE, 'the note under the box');
  assert.strictEqual(ctx.helper.watching, true, 'the helper listens for the shortcut');

  keys(change(61, RIGHT_OPTION_DOWN, 5000), { kind: 'other' }, change(61, 0, 5100)); // ⌥ with a letter
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(ctx.panel.isVisible(), false, 'Right ⌥ with another key does not open the panel');
  keys(change(61, RIGHT_OPTION_DOWN, 6000), change(61, 0, 6100));
  await waitFor(() => ctx.panel.isVisible(), 'Right ⌥ tapped on its own to open the panel');
  ctx.panel.hide();
  await waitFor(() => !ctx.panel.isVisible(), 'the panel to close');

  // Caps Lock: one press is a tap, and the note says what macOS also does with it.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => recording(), 'the box to wait for keys');
  // The box waits at once; Buddy lets go of its shortcut, and starts to hear the taps for the box, a moment later. A tap
  // reported before that would be lost.
  await waitFor(() => ctx.shortcut.current() === null, 'the saved shortcut to be let go');
  keys(change(57, 0x10000, 9000));
  await waitFor(() => ctx.store.get('shortcut') === 'Tap:CapsLock', 'Caps Lock to be saved');
  assert.deepStrictEqual(await caps(), ['⇪ Caps Lock']);
  await waitFor(async () => (await note()) === CAPS_NOTE, 'the Caps Lock note');

  // Without Accessibility Buddy cannot hear a key tapped on its own. Coming back to the window (from System Settings,
  // where the permission was taken away) turns the note red, and a box that waits for keys says so too, as keys pressed
  // together can still be recorded. Given again, the note is as it was.
  const CANNOT_HEAR = 'Buddy needs Accessibility to hear this key. Allow it in Permissions.';
  const CANNOT_HEAR_TAPS = 'Buddy needs Accessibility to hear a key tapped on its own. Allow it in Permissions.';
  const noteRed = () => page("document.getElementById('shortcut-note').classList.contains('error')");
  const comeBack = () => page("window.dispatchEvent(new Event('focus'))");
  assert.strictEqual(await noteRed(), false, 'the note is not red while Buddy can hear the key');
  ctx.helper.accessibility = false;
  await comeBack();
  await waitFor(async () => (await noteRed()) && ((await note()) ?? '').startsWith(CANNOT_HEAR), 'the note to turn red');
  assert.strictEqual(await note(), `${CANNOT_HEAR} Caps Lock also turns capitals on and off when you tap it.`);
  // The note is a live region, which a screen reader reads out when it is written: coming back to the window with
  // nothing changed must not write it again.
  const asked = () => ctx.helper.calls.filter((call) => call.cmd === 'permissions').length;
  await page(`window.__noteWrites = [];
    new MutationObserver((records) => window.__noteWrites.push(...records.map((record) => record.type)))
      .observe(document.getElementById('shortcut-note'), { attributes: true, childList: true, characterData: true, subtree: true });`);
  const askedBefore = asked();
  await comeBack();
  await waitFor(() => asked() >= askedBefore + 2, 'the page to ask about the permissions again (for itself, and for the note)');
  await delay(200);
  assert.deepStrictEqual(await page('window.__noteWrites'), [], 'the note says the same, so it is not written again');
  await page("document.getElementById('shortcut').click()");
  await waitFor(async () => (await status()) === CANNOT_HEAR_TAPS, 'the box to say it cannot hear a key tapped on its own');
  assert.strictEqual(await page("document.getElementById('shortcut-status').className"), 'status small muted', 'in the normal style');
  assert.strictEqual(await recording(), true, 'and the box still waits for keys');
  assert.strictEqual(ctx.shortcut.current(), null, 'with the saved shortcut let go');
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => ctx.shortcut.current() === 'Tap:CapsLock', 'the saved shortcut to be taken back');
  assert.strictEqual(await recording(), false);
  assert.strictEqual(await status(), '', 'the line goes when the box stops waiting');
  ctx.helper.accessibility = true;
  await comeBack();
  await waitFor(async () => !(await noteRed()) && (await note()) === CAPS_NOTE, 'the note to be as it was');

  // Reset: ⌥ Space again, the helper stops listening, and the note goes.
  await page("document.getElementById('shortcut-reset').click()");
  await waitFor(() => ctx.store.get('shortcut') === 'Alt+Space', 'the default shortcut to be saved');
  await waitFor(() => ctx.helper.watching === false, 'the helper to stop listening');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  await waitFor(async () => (await note()) === null, 'the note to go');
  // Hidden or not, the note is part of what describes the Shortcut box: nothing of it may be left to be read.
  assert.strictEqual(await page("document.getElementById('shortcut-note').textContent"), '', 'no words are left in the hidden note');

  // Choosing another section ends a recording, and the shortcut is given back.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  await page(`document.querySelector('.nav-item[data-section="general"]').click()`);
  await waitFor(() => registered().length === 1, 'the shortcut to be given back when another section is chosen');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  assert.strictEqual(await recording(), false);

  // General: Always on is a switch, on, and the version is shown.
  assert.deepStrictEqual(await page(SECTIONS_SHOWN), {
    shown: ['section-general'], active: ['general'], current: ['general'],
  }, 'the General section, and only it');
  assert.deepStrictEqual(
    await page("(({ type, checked, className }) => ({ type, checked, isSwitch: className.split(' ').includes('switch') }))(document.getElementById('power'))"),
    { type: 'checkbox', checked: true, isSwitch: true },
    'Always on is a switch, and it is on',
  );
  // Buddy's own version (package.json's), not Electron's: under this test app.getVersion() answers Electron's.
  assert.strictEqual(
    await page("document.getElementById('version').textContent"),
    `Buddy ${require('../../../package.json').version}`,
    "General shows Buddy's version",
  );

  // The switch turns Buddy off and on again: the switch, its words, the saved setting and the shortcut follow.
  const power = () => page("[document.getElementById('power').checked, document.getElementById('power-status').textContent]");
  await page("document.getElementById('power').click()");
  await waitFor(() => ctx.store.get('buddyOn') === false, 'Buddy to be turned off');
  await waitFor(async () => JSON.stringify(await power()) === JSON.stringify([false, 'Your buddy is off.']), 'the switch to show Buddy off');
  assert.deepStrictEqual(registered(), [], 'its shortcut is let go');
  await page("document.getElementById('power').click()");
  await waitFor(() => ctx.store.get('buddyOn') === true, 'Buddy to be turned on again');
  await waitFor(async () => (await power())[0] === true && (await power())[1].startsWith('Your buddy is on'), 'the switch to show Buddy on');
  assert.deepStrictEqual(registered(), ['Alt+Space'], 'and its shortcut is taken again');
  await waitFor(() => ctx.buddy.isVisible(), 'the buddy to be back');

  // The window losing the focus ends a recording too (a second later), and the shortcut is given back.
  await page(`document.querySelector('.nav-item[data-section="shortcut"]').click()`);
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  await page("window.dispatchEvent(new Event('blur'))");
  await waitFor(() => registered().length === 1, 'the shortcut to be given back when the window loses the focus');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  assert.strictEqual(await recording(), false);

  // With "Press 🌐 key to: Show Emoji & Symbols", tapping fn while the box waits opens the emoji picker, which takes the
  // focus: the window loses it as the tap arrives. A key tapped within the second after the window loses the focus is
  // still saved (and the picker is left for the person to close; the note says how to stop it from opening).
  const FN_NOTE = `${TAP_NOTE} If fn also opens emoji or dictation, set “Press 🌐 key to” to “Do Nothing” in System Settings → Keyboard.`;
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0 && ctx.helper.watching === true, 'the helper to listen while the box waits');
  await page("window.dispatchEvent(new Event('blur'))");
  assert.strictEqual(await recording(), true, 'the box still waits the moment the window loses the focus');
  keys(change(63, 0x800000, 20000), change(63, 0, 20080)); // fn tapped, at once
  await waitFor(() => ctx.store.get('shortcut') === 'Tap:Fn', 'fn, tapped as the window lost the focus, to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  assert.deepStrictEqual(await caps(), ['fn']);
  assert.strictEqual(await recording(), false);
  await waitFor(async () => (await note()) === FN_NOTE, 'the fn note under the box');
  // The recording is over: the focus coming back, or the second running out, ends nothing and changes nothing.
  await delay(1200);
  assert.strictEqual(ctx.store.get('shortcut'), 'Tap:Fn');
  assert.strictEqual(ctx.shortcut.current(), 'Tap:Fn', 'the saved shortcut is the one that is taken');
  // Put back what the checks after this one expect: ⌥ Space, and the helper not listening.
  await page("document.getElementById('shortcut-reset').click()");
  await waitFor(() => ctx.store.get('shortcut') === 'Alt+Space', 'the default shortcut to be saved');
  await waitFor(() => ctx.helper.watching === false && registered().length === 1, 'the helper to stop listening, and ⌥ Space to be registered');
  assert.deepStrictEqual(registered(), ['Alt+Space']);

  // A window that gets the focus back within that second keeps recording: nothing ends it.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0, 'the shortcut to be let go again');
  await page("window.dispatchEvent(new Event('blur'))");
  await page("window.dispatchEvent(new Event('focus'))");
  await delay(1300);
  assert.strictEqual(await recording(), true, 'the box still waits: the window had the focus back');
  assert.deepStrictEqual(registered(), [], 'and the shortcut is still let go');
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again');
  assert.strictEqual(await recording(), false);
}

// Settings goes away while the Shortcut box is waiting for keys, with Buddy's own shortcut let go. A page that is on its
// way out may never get to give it back (its call can arrive after the window is gone, and then it is refused), so
// Buddy's main process takes the saved shortcut back once the window has closed. The window is destroyed here, not
// closed: a closing window lets its page run a little longer, and the page gives the shortcut back itself when it loses
// the focus, which would hide whether the main process does it too. This step ends with the Settings window gone.
async function closingWhileRecordingCheck(ctx, win, { assert, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const registered = () => [...ctx.globalShortcut.registered.keys()];
  const saved = ctx.store.get('shortcut'); // ⌥Space on the Mac, Ctrl+Shift+Space on Windows

  await page(`document.querySelector('.nav-item[data-section="shortcut"]').click()`); // a recording stops when the section is left
  assert.deepStrictEqual(registered(), [saved], 'the saved shortcut is registered before recording');
  await page("document.getElementById('shortcut').click()");
  assert.strictEqual(await page("document.getElementById('shortcut').classList.contains('recording')"), true, 'the box waits for keys');
  await waitFor(() => registered().length === 0, 'the shortcut to be let go while recording');

  win.destroy();
  await waitFor(() => win.isDestroyed(), 'the Settings window to be gone');
  await waitFor(() => registered().length === 1, 'the saved shortcut to be registered again once Settings has closed');
  assert.deepStrictEqual(registered(), [saved], 'the shortcut that was saved is the one that came back');
  assert.strictEqual(ctx.store.get('shortcut'), saved, 'and nothing was saved meanwhile');
}

// A section says how a change went on one line at a time: a new line takes the place of what the section said before.
// "Saved ✓" fades after a few seconds; a refusal stays until the next try (the Shortcut box's, here: ⌃⌘K is another
// app's in the fake).
async function statusLinesCheck(ctx, win, { assert, waitFor }) {
  const page = (script) => win.webContents.executeJavaScript(script);
  const lines = async () => JSON.stringify(await page("['buddy-status', 'name-status', 'size-status'].map((id) => document.getElementById(id).textContent)"));
  const shortcutStatus = () => page("document.getElementById('shortcut-status').textContent");
  const press = (init) => page(`document.dispatchEvent(new KeyboardEvent('keydown', ${JSON.stringify({ ...init, bubbles: true })}))`);
  const { buddyId, buddyName, size } = ctx.store.all();

  await page(`document.querySelector('.nav-item[data-section="shortcut"]').click()`);
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => ctx.globalShortcut.registered.size === 0, 'the shortcut to be let go');
  await press({ code: 'KeyK', key: 'k', ctrlKey: true, metaKey: true });
  await waitFor(async () => (await shortcutStatus()).includes('taken'), 'the shortcut to be refused');
  await waitFor(() => ctx.globalShortcut.registered.size === 1, 'the saved shortcut to be registered again');

  // Another buddy, a name and a size: one line, about the latest.
  await page(`document.querySelector('.nav-item[data-section="buddy"]').click()`);
  await page("document.querySelector('#buddies input:not(:checked)').click()");
  await waitFor(async () => (await lines()) === '["Saved ✓","",""]', 'the buddy to be saved');
  await page("const box = document.getElementById('name'); box.value = 'Lines'; box.dispatchEvent(new Event('change'));");
  await waitFor(async () => (await lines()) === '["","Saved ✓",""]', 'the name to be saved, on its line only');
  await page("document.querySelector('#size input:not(:checked)').click()");
  await waitFor(async () => (await lines()) === '["","","Saved ✓"]', 'the size to be saved, on its line only');
  assert.strictEqual(await page("document.querySelectorAll('#section-buddy .status:not(:empty)').length"), 1, 'one line in the section');

  await waitFor(async () => (await lines()) === '["","",""]', '"Saved ✓" to fade', 6000);
  await page(`document.querySelector('.nav-item[data-section="shortcut"]').click()`);
  assert.strictEqual(await shortcutStatus(), '⌃ ⌘ K is taken. Try another one.', 'the refusal is still there');
  await page("document.getElementById('shortcut').click()");
  await press({ code: 'Escape', key: 'Escape' });
  await waitFor(() => ctx.globalShortcut.registered.size === 1, 'the saved shortcut to be registered again');
  assert.strictEqual(await shortcutStatus(), '', 'and goes with the next try');

  const back = await page(`window.buddy.set(${JSON.stringify({ buddyId, buddyName, size })})`); // as it was, for the checks after this one
  assert.strictEqual(back.ok, true);
}

// Settings that can't be loaded (here the account can't be read): the page says so where the sections were. Choosing a
// section, a section asked for from outside (as the panel's Open Settings does) and the window getting the focus back
// then do nothing, and throw nothing.
async function loadFailureCheck(ctx, { assert, delay, waitFor }) {
  const { user } = ctx.account;
  const logError = console.error;
  ctx.account.user = () => {
    throw new Error('e2e: the account cannot be read');
  };
  console.error = (...args) => {
    if (!String(args[0]).startsWith('[buddy] unexpected error')) logError(...args); // the main process logs the failure
  };
  const win = ctx.windows.open('settings');
  const page = (script) => win.webContents.executeJavaScript(script);
  try {
    await waitFor(() => page("document.querySelector('.content').textContent.includes('Something went wrong. Try again.')").catch(() => false),
      'Settings to say it could not load');
    await page(`window.__errors = [];
      window.addEventListener('error', (e) => window.__errors.push(e.message));
      window.addEventListener('unhandledrejection', (e) => window.__errors.push(String(e.reason)));`);
    for (const section of ['shortcut', 'ai', 'general']) await page(`document.querySelector('.nav-item[data-section="${section}"]').click()`);
    ctx.windows.open('settings', { section: 'ai' });
    await page("window.dispatchEvent(new Event('focus'))");
    await delay(300);
    assert.deepStrictEqual(await page('window.__errors'), [], 'nothing threw');
    assert.deepStrictEqual(await page(SECTIONS_SHOWN), { shown: [], active: [], current: [] }, 'and no section is shown or marked');
  } finally {
    ctx.account.user = user;
    console.error = logError;
    win.destroy();
    await waitFor(() => win.isDestroyed(), 'the Settings window to be gone');
  }
}

module.exports = async function settingsCheck(ctx, { assert, delay, waitFor }) {
  const win = ctx.windows.open('settings');
  await waitFor(
    () => win.webContents.executeJavaScript("document.querySelector('#size input:checked')?.value === 'medium'"),
    'the Settings window to load',
  );
  // It opens on the Buddy section.
  assert.deepStrictEqual(await win.webContents.executeJavaScript(SECTIONS_SHOWN), {
    shown: ['section-buddy'], active: ['buddy'], current: ['buddy'],
  }, 'Settings opens on Buddy');
  // For a screen reader: the page's language, the lines that say how something went (read out when they change, as is
  // what the Shortcut box shows), each Allow button named for what it allows, and what describes the Shortcut box (its
  // hint, and the note that comes with a key tapped on its own).
  assert.deepStrictEqual(await win.webContents.executeJavaScript(`({
    lang: document.documentElement.lang,
    live: [...document.querySelectorAll('.status'), document.getElementById('shortcut-keys')]
      .filter((el) => el.getAttribute('aria-live') !== 'polite').map((el) => el.id),
    allow: [...document.querySelectorAll('#section-permissions button')].map((b) => b.getAttribute('aria-label')),
    described: document.getElementById('shortcut').getAttribute('aria-describedby'),
  })`), {
    lang: 'en', live: [], allow: ['Allow Accessibility', 'Allow Screen Recording'], described: 'shortcut-hint shortcut-note',
  });
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
  // These two press the Mac's keys (⌘⇧B, ⌃⌘K) and read its symbols. Windows' keys and names are in
  // test/shortcut-keys.test.js, and 36-platform-pages checks what its Settings show.
  if (process.platform !== 'win32') {
    await sectionsAndShortcutCheck(ctx, win, { assert, delay, waitFor });
    await statusLinesCheck(ctx, win, { assert, waitFor });
  }
  await closingWhileRecordingCheck(ctx, win, { assert, waitFor }); // and the window is gone
  await loadFailureCheck(ctx, { assert, delay, waitFor }); // in a window of its own, gone too: the next check may open Settings again
};
