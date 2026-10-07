'use strict';

const { BuddyError } = require('../../../shared/errors');
const { pasteKeys } = require('../../../src/main/platform');
const { undoKey } = require('../../../src/main/send-keys');

// The panel is a chat: src/main/actions.js keeps it and sends the page the whole state, which the page draws. This
// check uses the page as the person does: it writes in the box and presses ↩ (or the send button), clicks the buttons
// the page draws on each item, by their label, and presses Esc; and it reads the chat back from the page's own text,
// and from actions.state(). The AI's answers are the check's own (ctx.ai.ask), in the shape of the chat request's
// reading (shared/prompts.js parseChat), except at the end, where the real route says there is no key. The app is a
// fake TextEdit, whose commands the fake helper answers.
module.exports = async function panelCheck(ctx, { assert, waitFor }) {
  const FACT = 'Your boss is Mr. Sharma.';
  const reply = (fields) => ({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], ...fields });
  const answers = [];
  const asks = [];
  const { ask } = ctx.ai;
  ctx.ai.ask = async (action, input) => {
    asks.push({ action, input });
    const next = answers.shift();
    if (next instanceof Error) throw next;
    return { text: JSON.stringify(next), model: 'e2e-model', chat: next };
  };
  const chat = () => ctx.actions.state().chat;
  let panel = null;
  const page = (script) => panel.webContents.executeJavaScript(script);
  const pageShows = (text, what) => waitFor(async () => (await page('document.body.innerText')).includes(text), what);
  const boxFocused = () => page("document.activeElement === document.getElementById('box')");
  const bubbleSays = (text) => waitFor(async () => {
    const win = ctx.bubble.window();
    return Boolean(win?.isVisible()) && (await win.webContents.executeJavaScript("document.getElementById('text').textContent")) === text;
  }, `the bubble to say "${text}"`);
  /** Open the panel as the shortcut does, once a panel that just hid may open again. */
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
  }
  /** Write `message` in the box and send it as the person does: with ↩, or with the send button. */
  async function type(message, { withButton = false } = {}) {
    await page(`(() => {
      const box = document.getElementById('box');
      box.focus();
      box.value = ${JSON.stringify(message)};
      box.dispatchEvent(new Event('input'));
    })()`);
    // While the buddy is still busy with the last message, the next one cannot go (nor could the person send it).
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page(withButton
      ? "document.getElementById('send').click()"
      : "document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
    assert.strictEqual(await page("document.getElementById('box').value"), '', `"${message}" left the box`);
  }
  // The newest item in the page's chat that shows `text`.
  const itemWith = (text) => `[...document.querySelectorAll('#items > li')].findLast((li) => li.innerText.includes(${JSON.stringify(text)}))`;
  /** The labels of the buttons the page shows on the newest item with `text`; null when there is no such item. */
  const buttonsOn = (text) => page(`(() => {
    const item = ${itemWith(text)};
    return item ? [...item.querySelectorAll('button')].map((b) => b.textContent) : null;
  })()`);
  /** Click the button `label` on the newest item with `text`, as the person does: the click gives the button the focus. */
  async function click(text, label) {
    const clicked = await page(`(() => {
      const button = [...(${itemWith(text)})?.querySelectorAll('button') ?? []].find((b) => b.textContent === ${JSON.stringify(label)});
      if (!button) return false;
      button.focus();
      button.click();
      return true;
    })()`);
    assert.ok(clicked, `the chat shows ${label} on "${text}"`);
  }
  const open = ctx.windows.open;
  let settingsWindow = null;

  try {
    // No app known yet: the greeting, by first name, and an empty chat.
    await openPanel();
    assert.deepStrictEqual([ctx.actions.state().greeting, chat()], ['Hi E2E! What should we do?', []]);
    await pageShows('Hi E2E! What should we do?', 'the greeting');
    await waitFor(boxFocused, 'the box to have the focus');

    // A written answer, then Insert: with no app to paste into, the text is copied (to the fake clipboard).
    answers.push(reply({ say: 'Here it is.', text: 'Dear Sir, I need leave tomorrow.' }));
    await type('boss ko mail, kal chutti chahiye');
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer');
    assert.deepStrictEqual(asks.at(-1), {
      action: 'chat',
      input: { message: 'boss ko mail, kal chutti chahiye', history: [], facts: ctx.memory.facts(), appName: '', userName: 'E2E', step: 1 },
    });
    assert.deepStrictEqual(chat().at(-1).buttons, ['insert', 'copy']);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the answer');
    assert.deepStrictEqual(await buttonsOn('Dear Sir, I need leave tomorrow.'), ['Insert', 'Copy']);
    // A screen reader hears who each message is from, and only what is new is read out: the answer, not the person's
    // own message or the whole chat again.
    const name = ctx.actions.state().buddyName;
    assert.deepStrictEqual(await page("[...document.querySelectorAll('#items .visually-hidden')].map((label) => label.textContent)"),
      ['You: ', `${name}: `]);
    await waitFor(
      async () => (await page("document.getElementById('announce').textContent")) === `${name}: Here it is. Dear Sir, I need leave tomorrow.`,
      'the answer to be read out',
    );
    await click('Dear Sir, I need leave tomorrow.', 'Insert');
    await bubbleSays(`Copied — press ${pasteKeys}`);
    assert.strictEqual(await ctx.clipboard.readText(), 'Dear Sir, I need leave tomorrow.');
    assert.strictEqual(panel.isVisible(), false, 'the panel steps aside for Insert');

    // The panel only hid: opened again, it shows the same chat, with the keyboard in the box again (the page puts it
    // there as the panel opens: it is taken away here first).
    await page("document.getElementById('box').blur()");
    await openPanel();
    assert.strictEqual(ctx.actions.state().resumed, true);
    assert.deepStrictEqual(chat().map((item) => item.type), ['you', 'buddy', 'event']);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the same chat');
    await waitFor(boxFocused, 'the box to have the focus as the panel opens');

    // Now there is an app to work in. Closing the panel (Esc, ✕) ends the chat: the next opening is a new one, on it.
    ctx.helper.lastApp = { pid: 4242, bundleId: 'com.apple.TextEdit', name: 'TextEdit' };
    ctx.helper.replies = { captureSelection: { text: '' }, paste: {}, press: { via: 'e2e' }, windowTitle: { title: 'Untitled' }, screenshot: { image: 'ZTJl' } };
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(() => !panel.isVisible(), 'Esc to close the panel');
    await openPanel();
    assert.deepStrictEqual([ctx.actions.state().resumed, ctx.actions.state().appName, chat()], [false, 'TextEdit', []]);

    // "Do it": the text goes in the app at once, the panel stays hidden and the bubble says so. Opened again, the chat
    // shows it with Undo, which presses the undo keys in the app.
    answers.push(reply({ say: 'Done.', text: 'See you at 5.', doIt: true }));
    await type('write see you at 5 here', { withButton: true });
    await bubbleSays("Done! It's in TextEdit ✅");
    assert.deepStrictEqual(ctx.helper.calls.filter((call) => call.cmd === 'paste').at(-1).args, { pid: 4242, text: 'See you at 5.', selectAll: false });
    assert.strictEqual(panel.isVisible(), false, 'the panel stays hidden');
    await openPanel();
    await pageShows('✅ Put it in TextEdit', 'what Buddy did');
    assert.deepStrictEqual(chat().find((item) => item.type === 'buddy').buttons, ['undo', 'copy']);
    assert.deepStrictEqual(await buttonsOn('See you at 5.'), ['Undo', 'Copy']);
    await click('See you at 5.', 'Undo');
    await bubbleSays('Undone');
    assert.deepStrictEqual(ctx.helper.calls.filter((call) => call.cmd === 'press').at(-1).args, { pid: 4242, ...undoKey(process.platform) });

    // A look at the screen: Buddy takes a picture of the app and asks again with it. Copy keeps the panel open, and
    // the keyboard goes back to the box (the list drawn again took it from the button).
    await openPanel();
    answers.push(reply({ kind: 'screen' }), reply({ kind: 'answer', text: 'It says: see you at 5.' }));
    await type('what does this say?');
    await pageShows('👀 Looked at TextEdit', 'the look at the screen');
    await pageShows('It says: see you at 5.', 'the answer about the screen');
    assert.deepStrictEqual(asks.slice(-2).map((a) => [a.input.step, a.input.image]), [[1, undefined], [2, 'ZTJl']]);
    await click('It says: see you at 5.', 'Copy');
    await waitFor(async () => (await ctx.clipboard.readText()) === 'It says: see you at 5.', 'the answer to be copied');
    await waitFor(boxFocused, 'the box to have the focus back after Copy');
    assert.strictEqual(panel.isVisible(), true, 'Copy keeps the panel open');

    // Something about the person: remembered, shown with Undo, and listed in Settings. Undo forgets it again.
    answers.push(reply({ kind: 'answer', say: 'Got it!', remember: [FACT] }));
    await type('my boss is Mr. Sharma');
    await pageShows(`📝 Remembered: ${FACT}`, 'the remembered fact');
    assert.deepStrictEqual(await buttonsOn(`📝 Remembered: ${FACT}`), ['Undo']);
    settingsWindow = open.call(ctx.windows, 'settings');
    const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
    await waitFor(() => settingsPage("document.querySelector('[data-section=\"memory\"]') !== null").catch(() => false), 'the Settings page to load');
    await settingsPage("document.querySelector('[data-section=\"memory\"]').click()");
    await waitFor(
      async () => (await settingsPage("document.getElementById('memory-list').innerText")).includes(FACT),
      'the fact to be listed in Settings',
    );
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;
    if (!panel.isVisible()) await openPanel(); // Settings took the focus, which hid the panel
    const remembered = chat().find((item) => item.type === 'event' && item.buttons.includes('undo'));
    await click(`📝 Remembered: ${FACT}`, 'Undo');
    await pageShows('Okay, I forgot that.', 'the fact forgotten');
    assert.strictEqual(ctx.memory.facts().includes(FACT), false);
    assert.strictEqual(chat().find((item) => item.id === remembered.id).text, 'Okay, I forgot that.');
    await waitFor(boxFocused, 'the box to have the focus back after Undo');

    // Errors show in the chat with Try again, and Open Settings when the fix is there.
    const LABELS = { retry: 'Try again', settings: 'Open Settings' };
    for (const [code, message, buttons] of [
      ['bad_key', 'Your Claude key was rejected. Check it in Settings.', ['retry', 'settings']],
      ['no_credit', 'Your Claude account is out of credit.', ['retry', 'settings']],
      ['bad_model', "This model isn't available for your key. Pick another in Settings.", ['retry', 'settings']],
      ['rate_limited', 'Claude is busy right now. Try again in a minute.', ['retry']],
      ['timeout', 'Claude took too long to answer. Try again.', ['retry']],
      ['network', "Couldn't reach Claude. Check your internet.", ['retry']],
    ]) {
      answers.push(new BuddyError(code, message));
      await type('mail to my boss');
      await waitFor(() => chat().at(-1)?.code === code, `the ${code} error`);
      const error = chat().at(-1);
      assert.deepStrictEqual([error.type, error.text, error.buttons], ['error', message, buttons], code);
      await pageShows(message, `the ${code} error`);
      assert.deepStrictEqual(await buttonsOn(message), buttons.map((button) => LABELS[button]), code);
    }

    // The real route, with no key and free mode off: Open Settings goes to the AI section, as the gear does.
    ctx.ai.ask = ask;
    await type('mail to my boss');
    await waitFor(() => chat().at(-1)?.code === 'no_key', 'the no_key error');
    const noKey = chat().at(-1);
    assert.deepStrictEqual([noKey.text, noKey.buttons], ['Add your API key in Settings first.', ['retry', 'settings']]);
    await pageShows('Add your API key in Settings first.', 'the no_key error');
    assert.deepStrictEqual(await buttonsOn('Add your API key in Settings first.'), ['Try again', 'Open Settings']);
    const opened = [];
    ctx.windows.open = (kind, options) => {
      opened.push(kind);
      settingsWindow = open.call(ctx.windows, kind, options);
      return settingsWindow;
    };
    await click('Add your API key in Settings first.', 'Open Settings');
    await waitFor(() => opened.length > 0, 'Settings to open');
    assert.deepStrictEqual(opened, ['settings']);
    assert.strictEqual(panel.isVisible(), false, 'the panel steps aside');
    // Let its page finish loading before it is closed again, so that closing it does not cut the load short.
    await waitFor(() => settingsWindow.webContents.executeJavaScript("document.getElementById('size') !== null"), 'the Settings page to load');
    await waitFor(
      () => settingsWindow.webContents.executeJavaScript("!document.getElementById('section-ai').hidden"),
      'Settings to open on the AI section',
    );
  } finally {
    ctx.ai.ask = ask;
    ctx.windows.open = open;
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    await ctx.actions.dismiss(); // the checks that follow start on a new chat
    ctx.helper.lastApp = null;
    ctx.helper.replies = {};
  }
};
