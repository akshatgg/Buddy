'use strict';
/* global module */
/* exported EarCore */

/**
 * The sums of the ear page, free of the DOM (like VoiceTiming) so that the unit tests can run them. The page cannot
 * load the CommonJS shared/ code, so the yes/no MEANING stays in main (talk-back.js, through shared/voice-words.js
 * heardAnswer) and the page only tells whether an answer is DECISIVE: whether it is enough to stop listening. This
 * mirrors voice-words.js heardWords() != null (a test checks every case Android is checked with), so the words below
 * are copies of its folding.
 */
const EarCore = (() => {
  const UNK = 'unk';
  // Copies of voice-words.js: the same word as a recognizer or Whisper may write it, and the words a yes may also hold.
  const SAME = { ok: 'okay', dont: "don't", nahin: 'nahi', haa: 'haan', han: 'haan', nope: 'no', nah: 'no', bhej: 'send', bhejo: 'send', bhejdo: 'send', bhejna: 'send', bhejiye: 'send' };
  const FILLERS = ['it', 'please', 'ji', 'now', 'do', 'karo', 'kar', 'de'];
  const SPEECH_LEVEL = 0.06; // as VoiceTiming's: a voice is at least this loud

  function wordsOf(text) {
    return String(text || '')
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/[[<]\s*unk\s*[\]>]/g, ' unk ')
      .replace(/[^a-z' ]+/g, ' ')
      .split(/\s+/)
      .map((w) => w.replace(/^'+|'+$/g, ''))
      .filter(Boolean)
      .map((w) => SAME[w] || w);
  }

  /** Whether `text` is an answer that settles it (a yes, or a no of any kind); nothing made out yet is not. */
  function isDecisive(text, decisive) {
    const words = wordsOf(text);
    if (!words.length || words.every((w) => w === UNK)) return false;
    if (words.some((w) => decisive.no.includes(w))) return true;
    const isYes = (w) => decisive.yes.includes(w);
    if (!words.every((w) => isYes(w) || FILLERS.includes(w))) return true; // any other word: a no
    return words.some(isYes);
  }

  /**
   * A copy of voice-words.js wantsServer(): a word not made out next to a yes word (or the card's verb), with no no word, or
   * any missing word of the card's grammar (`someMissing`): the server hears it, the device alone never decides it a no.
   */
  function wantsServer(text, decisive, someMissing) {
    const words = wordsOf(text);
    if (!words.includes(UNK) || words.every((w) => w === UNK)) return false;
    if (words.some((w) => decisive.no.includes(w))) return false;
    return Boolean(someMissing) || words.some((w) => decisive.yes.includes(w));
  }

  /**
   * One short answer. `result(text)` is what to do with a final result from the recognizer: a decisive one ends it.
   * A result with a yes word next to a word not made out (or with a word of the grammar missing from the model) is not
   * judged here: when a voice was heard it asks for the recording, which the server writes down. `feed(level, ms)` takes the
   * microphone's level and, with a `timing` (VoiceTiming's), says whether the answer is over by itself: quiet after the
   * voice, nothing said for 8 s, or too long. `timeUp(finalText)` at that point or the deadline: the words if decisive, else the recording when the server must hear it AND a
   * voice was heard (nothing is sent to the server for silence), else the words as they are.
   */
  function createAnswerTurn({ decisive, needsServer, timing = null }) {
    let voice = false;
    const level = (x) => {
      if (Number.isFinite(x) && x >= SPEECH_LEVEL) voice = true;
    };
    const result = (text) => {
      if (!isDecisive(text, decisive)) return null;
      return voice && wantsServer(text, decisive, needsServer) ? { audio: true } : { text };
    };
    return {
      level,
      feed(x, ms) {
        level(x);
        return timing ? timing.feed(x, ms) : 'listen';
      },
      result,
      timeUp(finalText) {
        return result(finalText) || (needsServer && voice ? { audio: true } : { text: String(finalText ?? '') });
      },
    };
  }

  /**
   * A copy of voice-words.js wakeFrom(): whether Vosk's final result starts with one of the phrases, its words first and in
   * order, each at least `floor` sure; the longest phrase that matches wins. `endSec` is when the last phrase word ended;
   * `follows` whether more was said after it.
   */
  function wakeFrom(result, phrases, floor) {
    const got = result && Array.isArray(result.result) ? result.result : [];
    const list = (Array.isArray(phrases) ? phrases : [phrases])
      .map((p) => String(p || '').split(' ').filter(Boolean))
      .filter((w) => w.length)
      .sort((a, b) => b.length - a.length);
    for (const want of list) {
      if (got.length < want.length) continue;
      if (want.every((w, i) => got[i].word === w && got[i].conf >= floor)) {
        return { endSec: got[want.length - 1].end, follows: got.length > want.length, phrase: want.join(' ') };
      }
    }
    return null;
  }

  /**
   * The wake loop's decision. `result(json, keptFrom)` takes a final result of a recognizer that began at sample `keptFrom`
   * (counted from the keeper's first sample): null when it is not a phrase, else where the request begins (`fromSample`,
   * right after the phrase) and whether it follows in the same breath.
   */
  function createWakeTurn({ phrases, floor }) {
    return {
      result(json, keptFrom) {
        const w = wakeFrom(json, phrases, floor);
        if (!w) return null;
        return { follows: w.follows, fromSample: keptFrom + Math.round(w.endSec * 16000) };
      },
    };
  }

  /** Float samples (-1 to 1) as 16-bit PCM, clipped. */
  function toPcm16(float32) {
    const out = new Int16Array(float32.length);
    for (let i = 0; i < float32.length; i++) {
      const v = Math.max(-1, Math.min(1, float32[i]));
      out[i] = Math.trunc(v < 0 ? v * 32768 : v * 32767);
    }
    return out;
  }

  /** The last `maxSamples` samples added; `from(sample)` counts samples since the first one ever added. */
  class PcmKeeper {
    constructor(maxSamples) {
      this.max = maxSamples;
      this.buf = new Int16Array(maxSamples);
      this.total = 0;
    }

    add(pcm) {
      for (let i = 0; i < pcm.length; i++) this.buf[(this.total + i) % this.max] = pcm[i];
      this.total += pcm.length;
    }

    from(sample) {
      const size = Math.min(this.total, this.max);
      const first = this.total - size; // the number of the oldest sample kept
      const start = Math.max(sample, first);
      const out = new Int16Array(this.total - start);
      for (let i = 0; i < out.length; i++) out[i] = this.buf[(start + i) % this.max];
      return out;
    }

    all() {
      return this.from(0);
    }
  }

  /**
   * Microphones, one per caller. `open(deliver)` opens a real one and calls deliver(chunk) for each buffer; it answers
   * { release() }. acquire() gives a handle of its own: set `onChunk` to hear it, `close()` lets go of that stream only (twice is
   * harmless). So the wake loop and a command never close each other's microphone, and none is left open.
   */
  function createMicPool(open) {
    const live = new Set();
    return {
      async acquire() {
        let handle = null;
        const raw = await open((chunk) => { if (handle && handle.onChunk) handle.onChunk(chunk); });
        handle = {
          onChunk: null,
          closed: false,
          close() {
            if (handle.closed) return;
            handle.closed = true;
            handle.onChunk = null;
            live.delete(handle);
            raw.release();
          },
        };
        live.add(handle);
        return handle;
      },
      size: () => live.size,
    };
  }

  /** The recording of a wake request that a command cut off: sent when a voice was heard in it, else there is nothing to send. */
  function finishRequest(request, audioOf) {
    return request && request.timing.heardVoice() ? audioOf() : null;
  }

  return { isDecisive, createAnswerTurn, createWakeTurn, toPcm16, PcmKeeper, createMicPool, finishRequest };
})();

if (typeof module !== 'undefined') module.exports = EarCore;
