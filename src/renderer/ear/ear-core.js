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
   * One short answer. `result(text)` is what to do with a final result from the recognizer: a decisive one ends it.
   * `timeUp(finalText)` at the deadline: the words if decisive, else the recording when the server must hear it AND a
   * voice was heard (nothing is sent to the server for silence), else the words as they are.
   */
  function createAnswerTurn({ decisive, needsServer }) {
    let voice = false;
    const result = (text) => (isDecisive(text, decisive) ? { text } : null);
    return {
      level(x) {
        if (Number.isFinite(x) && x >= SPEECH_LEVEL) voice = true;
      },
      result,
      timeUp(finalText) {
        return result(finalText) || (needsServer && voice ? { audio: true } : { text: String(finalText ?? '') });
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

  return { isDecisive, createAnswerTurn, toPcm16, PcmKeeper };
})();

if (typeof module !== 'undefined') module.exports = EarCore;
