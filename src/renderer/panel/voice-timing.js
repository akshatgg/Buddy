'use strict';
/* global module */
/* exported VoiceTiming */

/**
 * When the panel's listening ends, worked out from how loud the microphone is (panel.js measures it every 100 ms):
 * after 1.5 s of quiet that follows speech, after 8 s in which nothing was said, or at 60 s. And the small sums around
 * it: how loud some samples are, the recording's type as Buddy's server takes it, and whether the panel listens by
 * itself when it opens. The panel page loads this as a script; the unit tests require it. So it must stay free of the
 * DOM.
 */
const VoiceTiming = (() => {
  const SPEECH_LEVEL = 0.06; // a voice is at least this loud (the RMS of the samples, 0 to 1)
  const QUIET_MS = 1500; // quiet this long after speaking: they have said it
  const MIN_SPEECH_MS = 300; // less sound than this in all is noise (a click, a cough), not a voice
  const NOTHING_MS = 8000; // nothing said by then: stop
  const MAX_MS = 60000; // the longest it listens
  // A level stands for the sound since the one before it, but for no more than this: a long gap with no levels (the
  // page was busy) is not taken for that much speech.
  const LEVEL_SPAN_MS = 250;

  // The kinds of recording Buddy's server takes (web/lib/transcribe.js), written exactly so.
  const TYPES = ['audio/webm', 'audio/webm;codecs=opus', 'audio/ogg', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/wav'];
  const CHROMIUM_TYPE = 'audio/webm';

  /**
   * One listening's timing. Feed it each level with the time it was measured (ms since listening began); each feed
   * answers 'listen' (go on), 'done' (they have said it), 'nothing' (nothing was said) or 'too-long' (60 s). Once it
   * has ended, it stays so. `heardVoice()` says whether a voice was heard at all: only then is the recording sent.
   */
  function createVoiceTiming() {
    let last = 0; // when the level before came
    let speech = 0; // how long a voice was heard, all together
    let lastVoice = 0; // when it was last heard
    let end = null;

    const heardVoice = () => speech >= MIN_SPEECH_MS;

    function feed(level, ms) {
      if (end) return end;
      const loud = Number.isFinite(level) && level >= SPEECH_LEVEL;
      if (loud) {
        speech += Math.min(Math.max(0, ms - last), LEVEL_SPAN_MS);
        lastVoice = ms;
      }
      last = Math.max(last, ms);
      if (heardVoice() && !loud && ms - lastVoice >= QUIET_MS) end = 'done';
      else if (ms >= MAX_MS) end = 'too-long';
      else if (!heardVoice() && !loud && ms >= NOTHING_MS) end = 'nothing'; // a word begun just now is heard out first
      return end || 'listen';
    }

    return { feed, heardVoice };
  }

  /** How loud some samples (-1 to 1) are: their RMS, 0 to 1. */
  function levelOf(samples) {
    if (!samples || !samples.length) return 0;
    let sum = 0;
    for (const s of samples) sum += s * s;
    return Math.min(1, Math.sqrt(sum / samples.length));
  }

  /**
   * The recording's type as the server takes it: what the recorder says, in small letters and with no spaces
   * ('audio/webm; codecs=opus' → 'audio/webm;codecs=opus'). A kind it takes with codecs it does not list goes as the
   * kind alone; nothing, or anything else, as WebM, which is what Chromium records.
   */
  function recordingMime(type) {
    const clean = String(type ?? '').toLowerCase().replace(/[\s"']/g, '');
    if (TYPES.includes(clean)) return clean;
    const kind = clean.split(';')[0];
    return TYPES.includes(kind) ? kind : CHROMIUM_TYPE;
  }

  /**
   * Whether the panel listens by itself as it opens (the state's `voice`): voice is on, "Listen when the panel opens"
   * is on, and the microphone is allowed (the Mac), or the system does not ask per app (Windows: 'unknown').
   */
  function listensOnOpen(voice) {
    return voice?.on === true && voice.auto === true && (voice.mic === 'granted' || voice.mic === 'unknown');
  }

  return { createVoiceTiming, levelOf, recordingMime, listensOnOpen, SPEECH_LEVEL, QUIET_MS, MIN_SPEECH_MS, NOTHING_MS, MAX_MS };
})();

if (typeof module !== 'undefined') module.exports = VoiceTiming;
