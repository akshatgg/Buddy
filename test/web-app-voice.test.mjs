// Buddy on iPhone: speaking to Buddy (web/public/app/voice.js), with the browser's parts stood in for.

import test from 'node:test';
import assert from 'node:assert';
import { createVoice, pickType, toBase64, voiceFailure, MIC_DENIED, NO_MIC, NOT_HEARD, VOICE_OFF, NOT_WRITTEN } from '../web/public/app/voice.js';
import { ApiError } from '../web/public/app/api.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A browser with a microphone that hears `level` (the samples' value), a recorder that records `mimeType`, a clock
 * the test moves (tick(ms) runs the timers that are due), and `denied` for a microphone the person said no to.
 */
function fakeBrowser({ level = 0.3, mimeType = 'audio/mp4', denied = false, supports = ['audio/mp4'], recorderBreaks = false, slow = false } = {}) {
  let now = 0;
  let timers = [];
  const mic = { level };
  const seen = { tracksStopped: 0, closed: 0, resumed: 0, recorderStarted: null, asked: 0 };
  const pending = [];
  class Recorder extends EventTarget {
    static isTypeSupported(type) {
      return supports.includes(type);
    }
    constructor(stream, options) {
      super();
      if (recorderBreaks) throw new Error('no recorder');
      this.options = options;
      this.mimeType = mimeType;
      this.state = 'inactive';
    }
    start(slice) {
      seen.recorderStarted = { slice, options: this.options };
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      const data = new Event('dataavailable');
      data.data = new Blob([new Uint8Array([1, 2, 3])], { type: mimeType });
      this.dispatchEvent(data);
      this.dispatchEvent(new Event('stop'));
    }
  }
  class AudioCtx {
    async resume() {
      seen.resumed += 1;
    }
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData: (samples) => samples.fill(mic.level) };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async close() {
      seen.closed += 1;
    }
  }
  const env = {
    Blob,
    MediaRecorder: Recorder,
    AudioContext: AudioCtx,
    performance: { now: () => now },
    setTimeout: (fn, ms) => {
      timers.push({ fn, at: now + ms });
      return fn;
    },
    clearTimeout: (fn) => {
      timers = timers.filter((t) => t.fn !== fn);
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          seen.asked += 1;
          if (slow) await new Promise((resolve) => pending.push(resolve)); // the phone is still asking
          if (denied) throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
          return { getTracks: () => [{ stop: () => { seen.tracksStopped += 1; } }] };
        },
      },
    },
  };
  return {
    env,
    seen,
    /** The phone answers the questions it was asked. */
    answer() {
      while (pending.length) pending.shift()();
    },
    /** From now on the microphone hears this. */
    hear(value) {
      mic.level = value;
    },
    async tick(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
      await settle();
    },
  };
}

function setup(browser, { words = 'kal chutti chahiye', fail = null } = {}) {
  const seen = { states: [], levels: [], words: [], errors: [], sent: [] };
  const voice = createVoice({
    transcribe: async (audio, mime) => {
      seen.sent.push({ audio, mime });
      if (fail) throw fail;
      return words;
    },
    onState: (s) => seen.states.push(s),
    onLevel: (l) => seen.levels.push(l),
    onWords: (w) => seen.words.push(w),
    onError: (e) => seen.errors.push(e),
    env: browser.env,
  });
  return { voice, seen };
}

test('🎤 listens, in audio/mp4 on Safari; tapped again, the words are written down and put in the box', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  assert.strictEqual(voice.state, 'listening');
  assert.deepStrictEqual(browser.seen.recorderStarted, { slice: 250, options: { mimeType: 'audio/mp4' } });
  for (let i = 0; i < 5; i += 1) await browser.tick(100); // half a second of voice
  assert.ok(seen.levels.length >= 5 && seen.levels.every((l) => l > 0.5), 'the buddy hears a loud voice');
  voice.stop();
  await settle();
  await settle();
  assert.deepStrictEqual(seen.sent, [{ audio: 'AQID', mime: 'audio/mp4' }]);
  assert.deepStrictEqual(seen.words, ['kal chutti chahiye']);
  assert.deepStrictEqual(seen.states, ['listening', 'writing', 'idle']);
  assert.strictEqual(browser.seen.tracksStopped, 1, 'the microphone is let go');
});

test('listening ends by itself after a quiet once something was said', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  for (let i = 0; i < 5; i += 1) await browser.tick(100); // half a second of voice
  browser.hear(0);
  for (let i = 0; i < 16; i += 1) await browser.tick(100); // then 1.6 s of quiet
  await settle();
  assert.deepStrictEqual(seen.words, ['kal chutti chahiye']);
  assert.strictEqual(voice.state, 'idle');
});

test('nothing said: nothing is sent, and the person hears so', async () => {
  const browser = fakeBrowser({ level: 0 });
  const { voice, seen } = setup(browser);
  await voice.start();
  for (let i = 0; i < 81; i += 1) await browser.tick(100); // 8 s of quiet
  await settle();
  assert.deepStrictEqual(seen.sent, []);
  assert.deepStrictEqual(seen.errors, [NOT_HEARD]);
  assert.strictEqual(voice.state, 'idle');
});

test('a microphone the person said no to, or none at all, is said plainly', async () => {
  const denied = setup(fakeBrowser({ denied: true }));
  await denied.voice.start();
  assert.deepStrictEqual(denied.seen.errors, [MIC_DENIED]);
  assert.strictEqual(denied.voice.state, 'idle');
  const none = setup({ env: { navigator: {} } });
  await none.voice.start();
  assert.deepStrictEqual(none.seen.errors, [NO_MIC]);
});

test('cancel drops the recording: nothing is sent', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  await browser.tick(100);
  voice.cancel();
  await settle();
  assert.strictEqual(voice.state, 'idle');
  assert.deepStrictEqual(seen.sent, []);
  assert.strictEqual(browser.seen.tracksStopped, 1);
});

test("the server's refusals in its words; voice off and anything else in the phone's", async () => {
  assert.strictEqual(voiceFailure(new ApiError('voice_busy', 'Voice is busy right now.')), 'Voice is busy right now.');
  assert.strictEqual(voiceFailure(new ApiError('voice_off', "Voice isn't set up yet.")), VOICE_OFF);
  assert.strictEqual(voiceFailure(new Error('x')), NOT_WRITTEN);
});

test('the kind of recording, and base64', () => {
  assert.strictEqual(pickType((t) => t === 'audio/mp4'), 'audio/mp4');
  assert.strictEqual(pickType((t) => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.strictEqual(pickType(() => { throw new Error('old Safari'); }), '');
  assert.strictEqual(toBase64(new Uint8Array([104, 105])), 'aGk=');
  const big = new Uint8Array(100_000).fill(65);
  assert.strictEqual(Buffer.from(toBase64(big), 'base64').length, 100_000);
});

test('a recorder that cannot be made lets the microphone go, and the next tap works', async () => {
  const broken = fakeBrowser({ recorderBreaks: true });
  const { voice, seen } = setup(broken);
  await voice.start();
  assert.strictEqual(broken.seen.tracksStopped, 1, 'the microphone is let go');
  assert.strictEqual(voice.state, 'idle');
  assert.deepStrictEqual(seen.errors, [NO_MIC]);
  broken.env.MediaRecorder = fakeBrowser().env.MediaRecorder; // now it can
  await voice.start();
  assert.strictEqual(voice.state, 'listening');
});

test('the sound is woken (iOS may start it asleep)', async () => {
  const browser = fakeBrowser();
  const { voice } = setup(browser);
  await voice.start();
  assert.strictEqual(browser.seen.resumed, 1);
});

test('cancel and a new tap while the phone is still asking: only the new one listens', async () => {
  const browser = fakeBrowser({ slow: true });
  const { voice } = setup(browser);
  const first = voice.start();
  voice.cancel();
  const second = voice.start();
  browser.answer();
  await Promise.all([first, second]);
  assert.strictEqual(voice.state, 'listening');
  assert.strictEqual(browser.seen.tracksStopped, 1, "the first tap's microphone is let go");
  assert.strictEqual(browser.seen.asked, 2);
});
