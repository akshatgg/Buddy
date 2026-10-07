'use strict';

const { ipcMain } = require('electron');

// Talking to the panel, through Chromium's fake microphone (test/e2e/smoke.js: someone speaks for 1.5 s, then
// stops). Voice is on for this person and the microphone is allowed, so the panel listens as it opens; once the voice
// has stopped, the page sends the recording to be written down (the test's server answers HEARD), puts the words in
// the box and sends them, as ↩ would. Closed and opened again with voice off, or with "Listen when the panel opens"
// off, it does not listen. What the page tells main about listening is heard here as main hears it.
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
  const asks = [];
  ctx.ai.ask = async (action, input) => {
    asks.push({ action, input });
    const chat = { kind: 'write', say: 'Here it is.', text: 'Dear Sir, I need leave tomorrow.', notes: [], doIt: false, send: false, remember: [] };
    return { text: JSON.stringify(chat), model: 'e2e-model', chat };
  };
  const chat = () => ctx.actions.state().chat;
  const listened = () => told.some(([what, on]) => what === 'listening' && on === true);
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    await waitFor(() => ctx.panel.isVisible(), 'the panel to open');
  }

  try {
    ctx.cloud.free = { ...free, voiceOn: true };
    ctx.cloud.heard = HEARD;
    ctx.cloud.recordings = [];
    ctx.systemPreferences.microphone = 'granted';
    ctx.store.set({ listenOnOpen: true });

    await openPanel();
    await waitFor(listened, 'the panel to listen as it opens', 5000);
    await waitFor(() => ctx.cloud.recordings.length === 1, 'the recording to go to be written down', 15_000);
    const { audio, mime, signal } = ctx.cloud.recordings[0];
    assert.match(mime, /^audio\/webm/, 'WebM, as Chromium records');
    assert.ok(typeof audio === 'string' && audio.length > 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(audio), 'the recording, as base64');
    assert.ok(signal instanceof AbortSignal, 'with a deadline of its own');
    await waitFor(() => chat().some((item) => item.type === 'you' && item.text === HEARD), 'the words to be sent as a message');
    assert.strictEqual(asks.at(-1).input.message, HEARD);
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer');

    // Main heard the page listen, then stop, and how loud the voice was meanwhile (0 to 1, loud enough at times).
    const changes = told.filter(([what]) => what === 'listening').map(([, on]) => on);
    assert.deepStrictEqual(changes, [true, false]);
    const levels = told.filter(([what]) => what === 'level').map(([, level]) => level);
    assert.ok(levels.length >= 10, `levels about 10 times a second (${levels.length})`);
    assert.ok(levels.every((level) => typeof level === 'number' && level >= 0 && level <= 1), 'each from 0 to 1');
    assert.ok(levels.some((level) => level >= 0.06), 'a voice among them');
    assert.strictEqual(ctx.cloud.recordings.length, 1, 'one recording, sent once');

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
    assert.strictEqual(ctx.cloud.recordings.length, 1, 'and nothing more was sent');
  } finally {
    ipcMain.removeListener('panel:listening', onListening);
    ipcMain.removeListener('panel:voice-level', onLevel);
    ctx.ai.ask = ask;
    ctx.cloud.free = free;
    ctx.cloud.heard = '';
    ctx.store.set({ listenOnOpen: true });
    await ctx.actions.dismiss(); // the checks that follow start on a new chat, with the microphone let go
  }
};
