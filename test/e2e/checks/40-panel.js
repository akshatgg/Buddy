'use strict';

const { BuddyError } = require('../../../shared/errors');
const { pasteKeys } = require('../../../src/main/platform');
const { undoKey } = require('../../../src/main/send-keys');

// The panel is a chat: src/main/actions.js keeps it and sends the page the whole state, which the page draws. This
// check talks to the page as the person does, through its window.buddy (send, act, close), and reads the chat back
// from actions.state(), and from the page's own text where it shows. The AI's answers are the check's own
// (ctx.ai.ask), in the shape of the chat request's reading (shared/prompts.js parseChat), except at the end, where the
// real route says there is no key. The app is a fake TextEdit, whose commands the fake helper answers.
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
  const open = ctx.windows.open;
  let settingsWindow = null;

  try {
    // No app known yet: the greeting, by first name, and an empty chat.
    await openPanel();
    assert.deepStrictEqual([ctx.actions.state().greeting, chat()], ['Hi E2E! What should we do?', []]);
    await pageShows('Hi E2E! What should we do?', 'the greeting');

    // A written answer, then Insert: with no app to paste into, the text is copied (to the fake clipboard).
    answers.push(reply({ say: 'Here it is.', text: 'Dear Sir, I need leave tomorrow.' }));
    assert.deepStrictEqual(await page("window.buddy.send('boss ko mail, kal chutti chahiye')"), { ok: true });
    assert.deepStrictEqual(asks.at(-1), {
      action: 'chat',
      input: { message: 'boss ko mail, kal chutti chahiye', history: [], facts: ctx.memory.facts(), appName: '', userName: 'E2E', step: 1 },
    });
    const written = chat().at(-1);
    assert.deepStrictEqual([written.type, written.buttons], ['buddy', ['insert', 'copy']]);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the answer');
    assert.deepStrictEqual(await page(`window.buddy.act(${written.id}, 'insert')`), { ok: true });
    assert.strictEqual(await ctx.clipboard.readText(), 'Dear Sir, I need leave tomorrow.');
    assert.strictEqual(panel.isVisible(), false, 'the panel steps aside for Insert');
    await bubbleSays(`Copied — press ${pasteKeys}`);

    // The panel only hid: opened again, it shows the same chat.
    await openPanel();
    assert.strictEqual(ctx.actions.state().resumed, true);
    assert.deepStrictEqual(chat().map((item) => item.type), ['you', 'buddy', 'event']);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the same chat');

    // Now there is an app to work in. Closing the panel (Esc, ✕) ends the chat: the next opening is a new one, on it.
    ctx.helper.lastApp = { pid: 4242, bundleId: 'com.apple.TextEdit', name: 'TextEdit' };
    ctx.helper.replies = { captureSelection: { text: '' }, paste: {}, press: { via: 'e2e' }, windowTitle: { title: 'Untitled' }, screenshot: { image: 'ZTJl' } };
    await page('window.buddy.close()');
    await waitFor(() => !panel.isVisible(), 'the panel to close');
    await openPanel();
    assert.deepStrictEqual([ctx.actions.state().resumed, ctx.actions.state().appName, chat()], [false, 'TextEdit', []]);

    // "Do it": the text goes in the app at once, the panel stays hidden and the bubble says so. Opened again, the chat
    // shows it with Undo, which presses the undo keys in the app.
    answers.push(reply({ say: 'Done.', text: 'See you at 5.', doIt: true }));
    assert.deepStrictEqual(await page("window.buddy.send('write see you at 5 here')"), { ok: true });
    assert.deepStrictEqual(ctx.helper.calls.filter((call) => call.cmd === 'paste').at(-1).args, { pid: 4242, text: 'See you at 5.', selectAll: false });
    assert.strictEqual(panel.isVisible(), false, 'the panel stays hidden');
    await bubbleSays("Done! It's in TextEdit ✅");
    await openPanel();
    await pageShows('✅ Put it in TextEdit', 'what Buddy did');
    const put = chat().find((item) => item.type === 'buddy');
    assert.deepStrictEqual(put.buttons, ['undo', 'copy']);
    assert.deepStrictEqual(await page(`window.buddy.act(${put.id}, 'undo')`), { ok: true });
    assert.deepStrictEqual(ctx.helper.calls.filter((call) => call.cmd === 'press').at(-1).args, { pid: 4242, ...undoKey(process.platform) });
    await bubbleSays('Undone');

    // A look at the screen: Buddy takes a picture of the app and asks again with it.
    await openPanel();
    answers.push(reply({ kind: 'screen' }), reply({ kind: 'answer', text: 'It says: see you at 5.' }));
    assert.deepStrictEqual(await page("window.buddy.send('what does this say?')"), { ok: true });
    assert.deepStrictEqual(asks.slice(-2).map((a) => [a.input.step, a.input.image]), [[1, undefined], [2, 'ZTJl']]);
    await pageShows('👀 Looked at TextEdit', 'the look at the screen');
    await pageShows('It says: see you at 5.', 'the answer about the screen');

    // Something about the person: remembered, shown with Undo, and listed in Settings. Undo forgets it again.
    answers.push(reply({ kind: 'answer', say: 'Got it!', remember: [FACT] }));
    assert.deepStrictEqual(await page("window.buddy.send('my boss is Mr. Sharma')"), { ok: true });
    await pageShows(`📝 Remembered: ${FACT}`, 'the remembered fact');
    settingsWindow = open.call(ctx.windows, 'settings');
    const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
    await waitFor(() => settingsPage("typeof window.buddy?.memory === 'function'").catch(() => false), 'the Settings page to load');
    assert.ok((await settingsPage('window.buddy.memory()')).facts.some((fact) => fact.text === FACT), 'Settings lists it');
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;
    const remembered = chat().find((item) => item.type === 'event' && item.buttons.includes('undo'));
    assert.deepStrictEqual(await page(`window.buddy.act(${remembered.id}, 'undo')`), { ok: true });
    assert.strictEqual(ctx.memory.facts().includes(FACT), false);
    assert.strictEqual(chat().find((item) => item.id === remembered.id).text, 'Okay, I forgot that.');

    // Errors show in the chat with Try again, and Open Settings when the fix is there.
    if (!panel.isVisible()) await openPanel(); // Settings took the focus, which hid the panel
    for (const [code, message, buttons] of [
      ['bad_key', 'Your Claude key was rejected. Check it in Settings.', ['retry', 'settings']],
      ['no_credit', 'Your Claude account is out of credit.', ['retry', 'settings']],
      ['bad_model', "This model isn't available for your key. Pick another in Settings.", ['retry', 'settings']],
      ['rate_limited', 'Claude is busy right now. Try again in a minute.', ['retry']],
      ['timeout', 'Claude took too long to answer. Try again.', ['retry']],
      ['network', "Couldn't reach Claude. Check your internet.", ['retry']],
    ]) {
      answers.push(new BuddyError(code, message));
      assert.deepStrictEqual(await page("window.buddy.send('mail to my boss')"), { ok: true });
      const error = chat().at(-1);
      assert.deepStrictEqual([error.type, error.text, error.code, error.buttons], ['error', message, code, buttons], code);
      await pageShows(message, `the ${code} error`);
    }

    // The real route, with no key and free mode off: Open Settings goes to the AI section, as the gear does.
    ctx.ai.ask = ask;
    assert.deepStrictEqual(await page("window.buddy.send('mail to my boss')"), { ok: true });
    const noKey = chat().at(-1);
    assert.deepStrictEqual([noKey.text, noKey.code, noKey.buttons], ['Add your API key in Settings first.', 'no_key', ['retry', 'settings']]);
    const opened = [];
    ctx.windows.open = (kind, options) => {
      opened.push(kind);
      settingsWindow = open.call(ctx.windows, kind, options);
      return settingsWindow;
    };
    assert.deepStrictEqual(await page(`window.buddy.act(${noKey.id}, 'settings')`), { ok: true });
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
