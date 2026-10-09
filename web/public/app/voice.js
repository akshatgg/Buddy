// Speaking to Buddy on the phone: 🎤 records (MediaRecorder; Safari records audio/mp4), Buddy's server writes down what
// was said (POST /api/transcribe, Whisper with the server's Groq key), and the words go into the box to send. Listening
// ends by itself as on the Mac (shared/voice-timing.js): after a short quiet once something was said, after 8 s of
// nothing, at 60 s, or at 2 MB; or when 🎤 is tapped again. While it listens the buddy listens too, its ear rims glowing
// with the voice (onLevel, as shared/feelings.js makes it).

import VoiceTiming from './shared/voice-timing.js';
import { buddyLevel } from './shared/feelings.js';

export const MIC_DENIED = 'Allow the microphone in Settings → Safari.';
export const NO_MIC = "Your phone can't record here.";
export const NOT_HEARD = "I didn't hear anything. Tap 🎤 and speak.";
export const VOICE_OFF = "Voice isn't set up yet.";
export const NOT_WRITTEN = "I couldn't write down what you said. Try again.";
export const MAX_BYTES = 2_000_000; // about 2 MB: the most Buddy's server takes
const LEVEL_EVERY_MS = 100; // how often the loudness is looked at
const SLICE_MS = 250; // the recorder hands over what it has this often, so the size is known as it grows
// What the phone records in, best first: Safari's, then Chromium's (both are kinds Buddy's server takes).
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

/** The first kind of recording this browser can make (isSupported is MediaRecorder.isTypeSupported), or '' for its own. */
export function pickType(isSupported) {
  return TYPES.find((type) => {
    try {
      return isSupported(type);
    } catch {
      return false;
    }
  }) || '';
}

/** Bytes as base64, a piece at a time (a long recording is too big to spread into one call). */
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The words for a recording that could not be written down. */
export function voiceFailure(err) {
  if (err?.code === 'voice_off') return VOICE_OFF;
  return typeof err?.code === 'string' && err.message ? err.message : NOT_WRITTEN;
}

/**
 * transcribe(audio, mime) answers the words (POST /api/transcribe). onState(state) hears 'idle', 'listening' and
 * 'writing'; onLevel(level) the voice for the buddy (0 to 1); onWords(text) what was said; onError(message) what went
 * wrong. The browser's parts come in as `env` so the tests can stand in for them.
 */
export function createVoice({ transcribe, onState = () => {}, onLevel = () => {}, onWords = () => {}, onError = () => {}, env = globalThis }) {
  let state = 'idle';
  let began = 0; // counts the taps that started listening
  let rec = null; // the recording under way: { stream, recorder, chunks, size, ctx, timer, timing, began }

  function set(next) {
    state = next;
    onState(next);
  }

  /** Stop the microphone and its timer; answers the recording's chunks once the recorder has handed over the last. */
  function release() {
    const r = rec;
    rec = null;
    env.clearTimeout(r.timer);
    const stopped = new Promise((resolve) => {
      if (r.recorder.state === 'inactive') resolve();
      else r.recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    for (const track of r.stream.getTracks()) track.stop();
    r.ctx.close().catch(() => {});
    return stopped.then(() => r);
  }

  /** Listening is over: what was said is written down, if anything was. */
  async function finish() {
    if (!rec) return;
    set('writing');
    const r = await release();
    onLevel(0);
    try {
      if (!r.timing.heardVoice()) {
        onError(NOT_HEARD);
        return;
      }
      const blob = new env.Blob(r.chunks, { type: r.recorder.mimeType });
      const audio = toBase64(new Uint8Array(await blob.arrayBuffer()));
      const words = String(await transcribe(audio, VoiceTiming.recordingMime(r.recorder.mimeType)) || '').trim();
      if (words) onWords(words);
      else onError(NOT_HEARD);
    } catch (err) {
      onError(voiceFailure(err));
    } finally {
      set('idle');
    }
  }

  function look() {
    if (!rec) return;
    rec.analyser.getFloatTimeDomainData(rec.samples);
    const rms = VoiceTiming.levelOf(rec.samples);
    onLevel(buddyLevel(rms));
    let end = rec.timing.feed(rms, env.performance.now() - rec.began);
    if (end === 'listen' && rec.size >= MAX_BYTES) end = 'too-long';
    if (end === 'listen') rec.timer = env.setTimeout(look, LEVEL_EVERY_MS);
    else finish();
  }

  return {
    get state() {
      return state;
    },

    /** Start listening. Called from a tap: iOS lets the microphone and the sound start only then. */
    async start() {
      if (state !== 'idle') return;
      const Recorder = env.MediaRecorder;
      const AudioCtx = env.AudioContext || env.webkitAudioContext;
      if (!env.navigator?.mediaDevices?.getUserMedia || !Recorder || !AudioCtx) {
        onError(NO_MIC);
        return;
      }
      set('listening');
      const turn = ++began; // a cancel and a new tap while the phone is still asking must not both go on
      let stream;
      try {
        stream = await env.navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (turn !== began) return;
        set('idle');
        onError(err?.name === 'NotAllowedError' ? MIC_DENIED : NO_MIC);
        return;
      }
      if (state !== 'listening' || turn !== began) {
        for (const track of stream.getTracks()) track.stop(); // cancelled while the phone was asking
        return;
      }
      let ctx;
      try {
        const type = pickType((t) => Recorder.isTypeSupported(t));
        const recorder = new Recorder(stream, type ? { mimeType: type } : {});
        ctx = new AudioCtx();
        ctx.resume?.().catch(() => {}); // made after an await, iOS may start it asleep, and the level would read silence
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        rec = {
          stream, recorder, ctx, analyser, chunks: [], size: 0, timer: null,
          samples: new Float32Array(analyser.fftSize), timing: VoiceTiming.createVoiceTiming(), began: env.performance.now(),
        };
        const mine = rec;
        recorder.addEventListener('dataavailable', (e) => {
          if (!e.data?.size) return;
          mine.chunks.push(e.data);
          mine.size += e.data.size;
        });
        recorder.start(SLICE_MS);
        rec.timer = env.setTimeout(look, LEVEL_EVERY_MS);
      } catch {
        // the microphone must not stay on (iOS keeps its light lit) when the recorder or the sound cannot be made
        rec = null;
        for (const track of stream.getTracks()) track.stop();
        ctx?.close().catch(() => {});
        set('idle');
        onError(NO_MIC);
      }
    },

    /** 🎤 tapped again: listening ends, and what was said is written down. */
    stop() {
      if (state === 'listening' && rec) finish();
    },

    /** Drop the listening without sending it (another tab, the app hidden, signed out). */
    cancel() {
      if (state !== 'listening') return;
      if (rec) release();
      onLevel(0);
      set('idle');
    },
  };
}
