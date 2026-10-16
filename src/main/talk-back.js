'use strict';

const { chooseVoice } = require('./voices');
const { answerGrammar, heardAnswer, YES_WORDS, NO_WORDS } = require('../../shared/voice-words');

/**
 * Buddy's voice on the Mac, as the rest of the app uses it: say a line, hear a yes or no, listen for one more
 * request. The ear window does the speaking and the microphone; this decides what was meant. Anything unclear, an
 * error included, is a no.
 */
const VOICES_KEEP_MS = 30000; // the device's voices change only when the person downloads one

function createTalkBack({ ear, model, transcribe, voiceName = () => null, now = Date.now }) {
  let known = null; // { list, at }
  // The voices macOS has, as [{ name, lang }]; [] when the ear cannot say (then Buddy speaks with the default voice).
  async function voices() {
    if (known && now() - known.at < VOICES_KEEP_MS) return known.list;
    try {
      const r = await ear.call('voices', {});
      const list = Array.isArray(r?.voices) ? r.voices : [];
      if (list.length) known = { list, at: now() };
      return list;
    } catch {
      return [];
    }
  }
  // The voice for a line: the one chosen if still on this device, else the best English one, else null (the default).
  const pickVoice = async (chosen) => chooseVoice(await voices(), chosen === undefined ? voiceName() : chosen);
  const writtenDown = async (audio) => String(await transcribe(audio, 'audio/wav')).trim();
  // Every yes/no word except the ones the model is known not to have; those are heard by the server instead.
  const knownWords = (verb) => {
    const missing = model.missing ? model.missing() : new Set();
    const words = model.words();
    const all = answerGrammar(verb).grammar.filter((w) => w !== '[unk]');
    return new Set(all.filter((w) => !missing.has(w) && (!words || words.has(w))));
  };
  return {
    voices,
    /** `chosen`: a voice to try instead of the saved one (Settings → Play); null is Automatic. */
    say: async (text, chosen) => {
      let name = null;
      try { name = await pickVoice(chosen); } catch { /* the default voice */ }
      await ear.call('say', { text, voiceName: name });
    },
    async hear(verb) {
      try {
        if (!model.ready()) model.ensure().catch((err) => console.warn('[buddy] voice model:', err.code || err.message));
        const g = model.ready() ? answerGrammar(verb, knownWords(verb)) : null;
        const r = await ear.call('hear', {
          verb,
          grammar: g ? g.grammar : null,
          needsServer: !g || g.missing.length > 0,
          decisive: { yes: [...YES_WORDS, verb], no: NO_WORDS },
        });
        if (typeof r.text === 'string') return heardAnswer(r.text, verb);
        if (!r.audio) return 'no';
        return heardAnswer(await writtenDown(r.audio), verb);
      } catch {
        return 'no';
      }
    },
    async listen() {
      try {
        const r = await ear.call('listen', { quietMs: 1500, nothingMs: 8000, maxMs: 20000 });
        if (!r.audio) return null;
        return (await writtenDown(r.audio)) || null;
      } catch {
        return null;
      }
    },
    stop: () => ear.stop(),
  };
}

module.exports = { createTalkBack };
