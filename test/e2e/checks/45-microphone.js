'use strict';

// The microphone, before any voice: the panel's state says whether the page may listen; Buddy's permission rules
// (src/main/panel-window.js) give the panel's page Chromium's fake microphone and nothing else, and give no other page
// a microphone or a camera; that fake microphone sounds like someone speaking and then stopping, as 46-voice needs it
// to; and Settings has "Listen when the panel opens" and, on the Mac, the Microphone row.
module.exports = async function microphoneCheck(ctx, { assert, delay, waitFor }) {
  const mac = process.platform === 'darwin';
  const prefs = ctx.systemPreferences;
  const free = ctx.cloud.free;
  let settings = null;

  try {
    // The state's voice: on only for someone signed in whose server can write down what is said, the "listen when
    // the panel opens" switch, and the microphone as macOS (or Windows' privacy switch) says.
    const voice = () => ctx.actions.state().voice;
    assert.deepStrictEqual(voice(), { on: false, auto: true, mic: 'granted', system: process.platform },
      'the fake server has no Groq key');
    ctx.cloud.free = { ...free, voiceOn: true };
    assert.strictEqual(voice().on, true);
    ctx.account.signedIn = false; // only for this line: nobody is told, so nothing else changes
    assert.strictEqual(voice().on, false, 'nobody signed in');
    ctx.account.signedIn = true;
    ctx.cloud.free = { ...free, voiceOn: true, blocked: true };
    assert.strictEqual(voice().on, false, 'a blocked person');
    ctx.cloud.free = { ...free, voiceOn: true };
    ctx.store.set({ listenOnOpen: false });
    assert.strictEqual(voice().auto, false);
    ctx.store.set({ listenOnOpen: true });
    prefs.microphone = 'denied';
    assert.strictEqual(voice().mic, 'denied');
    prefs.microphone = 'granted';
    ctx.cloud.free = free;

    // The panel's page has the (fake) microphone; not the camera, alone or with it; and nothing else.
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    const media = (win, constraints) => win.webContents.executeJavaScript(`navigator.mediaDevices.getUserMedia(${JSON.stringify(constraints)})
      .then((stream) => { stream.getTracks().forEach((track) => track.stop()); return 'allowed'; }, (err) => err.name)`);
    const notifications = (win) => win.webContents.executeJavaScript('Notification.requestPermission()');
    assert.strictEqual(await media(panel, { audio: true }), 'allowed', 'the panel has the microphone');
    assert.strictEqual(await media(panel, { video: true }), 'NotAllowedError', 'not the camera');
    assert.strictEqual(await media(panel, { audio: true, video: true }), 'NotAllowedError', 'nor both');
    assert.strictEqual(await notifications(panel), 'denied', 'nor anything else');

    // What the fake microphone sends, as the panel's page hears it (with the voice settings it records with): loud
    // like a voice for a while, then quiet. Its RMS, every 100 ms.
    const levels = await panel.webContents.executeJavaScript(`(async () => {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
      const context = new AudioContext();
      const analyser = context.createAnalyser();
      analyser.fftSize = 2048;
      context.createMediaStreamSource(stream).connect(analyser);
      const samples = new Float32Array(analyser.fftSize);
      const levels = [];
      for (let i = 0; i < 30; i += 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
        analyser.getFloatTimeDomainData(samples);
        levels.push(Math.sqrt(samples.reduce((sum, s) => sum + s * s, 0) / samples.length));
      }
      stream.getTracks().forEach((track) => track.stop());
      await context.close();
      return levels;
    })()`);
    const SPEECH_LEVEL = 0.06; // src/renderer/panel/voice-timing.js
    assert.ok(levels.filter((level) => level >= SPEECH_LEVEL).length >= 5,
      `the fake microphone sounds like a voice for at least half a second: ${levels.map((l) => l.toFixed(3)).join(' ')}`);
    assert.ok(levels.slice(-5).every((level) => level < SPEECH_LEVEL), `and then it is quiet: ${levels.map((l) => l.toFixed(3)).join(' ')}`);
    await ctx.actions.dismiss();

    // No other page has a microphone or a camera, and they keep what they had before: here, notifications.
    settings = ctx.windows.open('settings');
    const page = (script) => settings.webContents.executeJavaScript(script);
    await waitFor(() => page("document.getElementById('listen-on-open') !== null").catch(() => false), 'the Settings page to load');
    assert.strictEqual(await media(settings, { audio: true }), 'NotAllowedError', 'Settings has no microphone');
    assert.strictEqual(await media(settings, { video: true }), 'NotAllowedError', 'nor a camera');
    assert.strictEqual(await notifications(settings), 'granted', 'and keeps what it had');

    // General: "Listen when the panel opens", on, saved off and on again.
    await page("document.querySelector('.nav-item[data-section=\"general\"]').click()");
    assert.strictEqual(await page("document.getElementById('listen-on-open').checked"), true);
    await page("document.getElementById('listen-on-open').click()");
    await waitFor(() => ctx.store.get('listenOnOpen') === false, 'listening as the panel opens to be turned off');
    await waitFor(async () => (await page("document.getElementById('listen-status').textContent")) === 'Saved ✓', 'Saved ✓');
    await page("document.getElementById('listen-on-open').click()");
    await waitFor(() => ctx.store.get('listenOnOpen') === true, 'and on again');

    if (mac) {
      // Permissions: the Microphone row. macOS has not asked yet: Allow has it ask, and the row follows its answer.
      prefs.microphone = 'not-determined';
      prefs.answer = 'granted';
      await page("document.querySelector('.nav-item[data-section=\"permissions\"]').click()");
      const row = () => page("[document.getElementById('perm-microphone').textContent, document.getElementById('perm-microphone-btn').hidden]");
      await page("window.dispatchEvent(new Event('focus'))"); // back from System Settings, say
      await waitFor(async () => JSON.stringify(await row()) === JSON.stringify(['Not allowed', false]), 'the row to say the microphone is not allowed');
      await page("document.getElementById('perm-microphone-btn').click()");
      await waitFor(() => prefs.asked === 1, 'macOS to ask the person');
      await waitFor(async () => JSON.stringify(await row()) === JSON.stringify(['Allowed', true]), 'the row to say it is allowed, with no Allow');
      // Taken away in System Settings: coming back to the window shows it. (Allow would now open System Settings.)
      prefs.microphone = 'denied';
      await page("window.dispatchEvent(new Event('focus'))");
      await waitFor(async () => JSON.stringify(await row()) === JSON.stringify(['Not allowed', false]), 'the row to follow');
      await delay(100);
      assert.strictEqual(prefs.asked, 1, 'macOS is not asked again');
    }
  } finally {
    prefs.microphone = 'granted';
    prefs.answer = 'granted';
    ctx.cloud.free = free;
    ctx.account.signedIn = true;
    ctx.store.set({ listenOnOpen: true });
    if (settings && !settings.isDestroyed()) {
      ctx.windows.close('settings');
      await waitFor(() => settings.isDestroyed(), 'the Settings window to close');
    }
  }
};
