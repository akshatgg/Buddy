'use strict';

const { ipcMain } = require('electron');

// Talking to the panel, through Chromium's fake microphone (test/e2e/smoke.js: someone speaks for 1.5 s, then
// stops). Voice is on for this person and the microphone is allowed, so the panel listens as it opens; once the voice
// has stopped, the page sends the recording to be written down (the test's server answers HEARD), puts the words in
// the box and sends them, as ↩ would. Buddy then reads the person's box and brings the panel back itself: that does not
// listen. Opened again while the buddy is still answering, the panel does not listen by itself either, and words said
// on 🎤 meanwhile wait in the box. A late "hidden" from before a listening began does not stop it; being hidden does.
// A microphone that cannot be opened says nothing when the panel listens by itself, and says what to do on 🎤. While
// what was said is written down, typing or 🎤 stops it. Closed and opened again with voice off, or with "Listen when
// the panel opens" off, it does not listen. What the page tells main about listening is heard here as main hears it.
//
// This needs the panel page's voice (Task G of docs/superpowers/plans/2026-10-08-buddy-voice.md).
module.exports = async function voiceCheck(ctx, { assert, delay, waitFor }) {
  const HEARD = 'boss ko mail karo, kal chutti chahiye';
  const told = []; // ['listening', on] and ['level', level], as the page sent them
  const onListening = (_event, on) => told.push(['listening', on]);
  const onLevel = (_event, level) => told.push(['level', level]);
  ipcMain.on('panel:listening', onListening);
  ipcMain.on('panel:voice-level', onLevel);
  const free = ctx.cloud.free;
  const { ask } = ctx.ai;
  const { transcribe } = ctx.cloud;
  const asks = [];
  const write = { kind: 'write', say: 'Here it is.', text: 'Dear Sir, I need leave tomorrow.', notes: [], doIt: false, send: false, remember: [] };
  const answers = []; // the AI's next answers, in order (a function: answered once it says); then `write`
  ctx.ai.ask = async (action, input) => {
    asks.push({ action, input });
    const next = answers.length ? answers.shift() : write;
    const chat = typeof next === 'function' ? await next() : next;
    return { text: JSON.stringify(chat), model: 'e2e-model', chat };
  };
  const chat = () => ctx.actions.state().chat;
  const listened = () => told.some(([what, on]) => what === 'listening' && on === true);
  const changes = () => told.filter(([what]) => what === 'listening').map(([, on]) => on);
  const page = (script) => ctx.panel.window().webContents.executeJavaScript(script);
  const redLine = () => page("document.getElementById('send-error').hidden ? '' : document.getElementById('send-error-text').textContent");
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    await waitFor(() => ctx.panel.isVisible(), 'the panel to open');
  }
  /** Write `message` in the box and press ↩, as the person does. */
  const typeAndSend = (message) => page(`(() => {
    const box = document.getElementById('box');
    box.value = ${JSON.stringify(message)};
    box.dispatchEvent(new Event('input'));
    box.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
  })()`);
  /** The page as if the system said it is hidden, and told so. */
  const seemHidden = () => page("window.e2eHidden = true; document.dispatchEvent(new Event('visibilitychange'))");

  try {
    ctx.cloud.free = { ...free, voiceOn: true };
    ctx.cloud.heard = HEARD;
    ctx.cloud.recordings = [];
    ctx.systemPreferences.microphone = 'granted';
    ctx.store.set({ listenOnOpen: true });
    // A fake TextEdit, whose box the buddy reads (its first answer asks for it). Reading it takes a little while, as
    // the real helper's ⌘A ⌘C does: the panel's own blur, from stepping aside, has come by the time it is back.
    ctx.helper.lastApp = { pid: 4242, bundleId: 'com.apple.TextEdit', name: 'TextEdit' };
    ctx.helper.replies = {};
    Object.defineProperty(ctx.helper.replies, 'captureSelection', { enumerable: true, get: () => delay(150).then(() => ({ text: 'kal chutti' })) });
    answers.push({ ...write, kind: 'box' });

    await openPanel();
    await waitFor(listened, 'the panel to listen as it opens', 5000);
    // The buddy listens with it, and its ear rims light up with the voice, well past their resting glow (1): main scales
    // the level so that a voice shows (src/main/feelings.js).
    const buddyPage = (script) => ctx.buddy.window().webContents.executeJavaScript(script);
    await waitFor(async () => (await buddyPage('window.__buddyMood')) === 'listening', 'the buddy to listen with the panel');
    await waitFor(() => buddyPage('window.__buddyPose?.ears > 2'), 'the ear rims to light up with the voice', 3000);
    await waitFor(() => ctx.cloud.recordings.length === 1, 'the recording to go to be written down', 15_000);
    const { audio, mime, signal } = ctx.cloud.recordings[0];
    assert.match(mime, /^audio\/webm/, 'WebM, as Chromium records');
    assert.ok(typeof audio === 'string' && audio.length > 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(audio), 'the recording, as base64');
    assert.ok(signal instanceof AbortSignal, 'with a deadline of its own');
    await waitFor(() => chat().some((item) => item.type === 'you' && item.text === HEARD), 'the words to be sent as a message');
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer');
    assert.strictEqual(asks.at(-1).input.message, HEARD);
    assert.strictEqual(asks.at(-1).input.box, 'kal chutti', 'asked again with the box, which Buddy stepped aside to read');
    assert.ok(ctx.panel.isVisible(), 'and the panel came back');
    await delay(1500); // long enough for a listening to have begun, had the panel come back listening

    // Main heard the page listen, then stop, and how loud the voice was meanwhile (0 to 1, loud enough at times).
    // Buddy bringing the panel back after reading the box did not have it listen again.
    assert.deepStrictEqual(changes(), [true, false]);
    const levels = told.filter(([what]) => what === 'level').map(([, level]) => level);
    assert.ok(levels.length >= 10, `levels about 10 times a second (${levels.length})`);
    assert.ok(levels.every((level) => typeof level === 'number' && level >= 0 && level <= 1), 'each from 0 to 1');
    assert.ok(levels.some((level) => level >= 0.06), 'a voice among them');
    assert.strictEqual(ctx.cloud.recordings.length, 1, 'one recording, sent once');
    ctx.helper.lastApp = null;
    ctx.helper.replies = {};

    // While the buddy is still answering, the panel opened again does not listen by itself. Words said on 🎤 meanwhile
    // are not sent: they wait in the box, and the page says why.
    await ctx.actions.dismiss();
    ctx.store.set({ listenOnOpen: false });
    await openPanel();
    let answerNow;
    answers.push(() => new Promise((resolve) => { answerNow = () => resolve(write); }));
    await typeAndSend('write a mail');
    await waitFor(() => ctx.actions.state().busy, 'the buddy to think');
    ctx.store.set({ listenOnOpen: true });
    ctx.panel.hide(); // a click somewhere else
    told.length = 0;
    await openPanel();
    assert.strictEqual(ctx.actions.state().busy, true);
    await delay(1500);
    assert.strictEqual(listened(), false, 'opened while the buddy is answering, the panel does not listen by itself');
    await page("document.getElementById('mic').click()");
    await waitFor(listened, 'the panel to listen on 🎤');
    await waitFor(() => ctx.cloud.recordings.length === 2, 'the recording to go to be written down', 15_000);
    await waitFor(async () => (await page("document.getElementById('box').value")) === HEARD, 'the words to wait in the box');
    assert.strictEqual(await redLine(), 'Wait for my answer first.');
    assert.ok(!chat().some((item) => item.type === 'you' && item.text === HEARD), 'and they were not sent');
    answerNow();
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer');
    assert.strictEqual(await page("document.getElementById('box').value"), HEARD, 'still there, to send now');

    // The system can say "hidden" late, for a brief hide from before this listening began, and "shown" just after: the
    // listening goes on. (The page is made to believe it here.)
    await page(`(() => {
      const real = Object.getOwnPropertyDescriptor(Document.prototype, 'hidden').get;
      window.e2eHidden = null;
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => window.e2eHidden ?? real.call(document) });
      const box = document.getElementById('box');
      box.value = '';
      box.dispatchEvent(new Event('input'));
    })()`);
    told.length = 0;
    await page("document.getElementById('mic').click()");
    await waitFor(listened, 'the panel to listen on 🎤');
    await page(`window.e2eHidden = true;
      document.dispatchEvent(new Event('visibilitychange'));
      setTimeout(() => {
        window.e2eHidden = null;
        document.dispatchEvent(new Event('visibilitychange'));
      }, 30);
      true`);
    await waitFor(() => ctx.cloud.recordings.length === 3, 'the recording to go to be written down', 15_000);
    await waitFor(() => chat().filter((item) => item.type === 'you' && item.text === HEARD).length === 1, 'the words to be sent');
    assert.deepStrictEqual(changes(), [true, false]);

    // Hidden for real, it stops a moment later, and nothing is sent.
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer');
    told.length = 0;
    await page("document.getElementById('mic').click()");
    await waitFor(listened, 'the panel to listen on 🎤');
    await seemHidden();
    await waitFor(() => changes().at(-1) === false, 'the listening to stop', 1500);
    await delay(3000); // longer than the fake voice
    assert.strictEqual(ctx.cloud.recordings.length, 3, 'nothing more was sent');

    // Closed and opened again at once, the page can still be "hidden" from the close a moment after the panel is back
    // (the system says so late): the listening this opening began goes on. (The page is made to believe it here.)
    await ctx.actions.dismiss();
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await page("window.e2eHidden = true; document.dispatchEvent(new Event('visibilitychange'))");
    told.length = 0;
    await ctx.actions.toggle();
    await waitFor(() => ctx.panel.isVisible(), 'the panel to open');
    await waitFor(listened, 'the panel to listen as it opens', 5000);
    // Shown for real from here: a "hidden" the system sends late for that close must not stop it either.
    await page("window.e2eHidden = null; document.dispatchEvent(new Event('visibilitychange'))");
    await delay(400); // past the page's wait after "hidden"
    assert.deepStrictEqual(changes(), [true], 'still listening');
    await page("document.getElementById('mic').click()"); // stopped here, and nothing is sent
    await waitFor(() => changes().at(-1) === false, 'the listening to stop');
    await page('window.e2eHidden = null; delete document.hidden');

    // A microphone that cannot be opened (refused here): listening by itself as the panel opens, the panel says
    // nothing, or it would at every opening; on 🎤 it says what to do.
    await ctx.actions.dismiss();
    await page(`window.e2eTries = 0;
      navigator.mediaDevices.getUserMedia = async () => { window.e2eTries += 1; throw new DOMException('refused', 'NotAllowedError'); };
      true`);
    await openPanel();
    await waitFor(() => page('window.e2eTries === 1'), 'the panel to try the microphone as it opens');
    await delay(300);
    assert.strictEqual(await redLine(), '', 'started by itself, it says nothing');
    await page("document.getElementById('mic').click()");
    const allow = process.platform === 'win32'
      ? 'Turn on the microphone in Windows Settings → Privacy & security → Microphone.'
      : 'Allow the microphone in Settings.';
    await waitFor(async () => (await redLine()) === allow, 'on 🎤, what to do');
    assert.strictEqual(await page("!document.getElementById('send-error-settings').hidden"), true, 'with Open Settings');
    await page('delete navigator.mediaDevices.getUserMedia');

    // While what was said is being written down, the box can be typed in, and typing stops it: nothing is sent. 🎤 then
    // stops it too, and does not listen again.
    const writing = []; // the recordings being written down: each one's function answers it
    ctx.cloud.transcribe = () => new Promise((resolve) => writing.push(() => resolve(HEARD)));
    const placeholder = () => page("document.getElementById('box').placeholder");
    await ctx.actions.dismiss();
    await openPanel(); // it listens by itself
    await waitFor(() => writing.length === 1, 'the recording to be written down', 15_000);
    assert.strictEqual(await placeholder(), 'Writing down what you said…');
    assert.strictEqual(await page("document.getElementById('box').disabled"), false, 'the box can be typed in meanwhile');
    await page(`(() => {
      const box = document.getElementById('box');
      box.value = 'x';
      box.dispatchEvent(new Event('input'));
    })()`);
    assert.strictEqual(await placeholder(), 'Tell me what to do…', 'typing stopped it');
    writing[0]();
    await delay(300);
    assert.strictEqual(await page("document.getElementById('box').value"), 'x', 'the words did not go in the box');
    assert.ok(!chat().some((item) => item.type === 'you'), 'nor were they sent');
    await page("document.getElementById('mic').click()");
    await waitFor(() => writing.length === 2, 'the recording to be written down', 15_000);
    told.length = 0;
    await page("document.getElementById('mic').click()");
    assert.strictEqual(await placeholder(), 'Tell me what to do…', '🎤 stopped it');
    await delay(1000);
    assert.strictEqual(listened(), false, 'and did not listen again');
    writing[1]();
    await delay(300);
    assert.ok(!chat().some((item) => item.type === 'you'), 'nothing was sent');
    ctx.cloud.transcribe = transcribe;

    // Voice off for this person, then "Listen when the panel opens" off: opened again, the panel does not listen.
    for (const [what, change, undo] of [
      ['voice off', () => { ctx.cloud.free = { ...free, voiceOn: false }; }, () => { ctx.cloud.free = { ...free, voiceOn: true }; }],
      ['listening as it opens off', () => ctx.store.set({ listenOnOpen: false }), () => ctx.store.set({ listenOnOpen: true })],
    ]) {
      await ctx.actions.dismiss();
      change();
      told.length = 0;
      await openPanel();
      await delay(1500);
      assert.strictEqual(listened(), false, `${what}: the panel does not listen`);
      undo();
    }
    assert.strictEqual(ctx.cloud.recordings.length, 3, 'and nothing more was sent');
  } finally {
    ipcMain.removeListener('panel:listening', onListening);
    ipcMain.removeListener('panel:voice-level', onLevel);
    ctx.ai.ask = ask;
    ctx.cloud.transcribe = transcribe;
    ctx.cloud.free = free;
    ctx.cloud.heard = '';
    ctx.store.set({ listenOnOpen: true });
    ctx.helper.lastApp = null;
    ctx.helper.replies = {};
    await ctx.actions.dismiss(); // the checks that follow start on a new chat, with the microphone let go
  }
};
