'use strict';

/**
 * "Only my voice" (docs/superpowers/specs/2026-10-16-only-my-voice-design.md): the voice-check model, the numbers both
 * apps decide with, the setup's steps, the phrase clip, the profile file and the copy. The voice itself never leaves
 * the device. The Android app has a port (voice/MyVoiceRules.kt), checked against the cases
 * tools/sync-android-shared.js writes out.
 */
const { wakePhrases } = require('./voice-words');
const { VOICE_MODEL } = require('./voice-model');

const BASE = 'https://github.com/akshatgg/Buddy/releases/download/speaker-model-1';
const SPEAKER_MODEL = {
  name: 'campplus-zh-en-advanced',
  tag: 'speaker-model-1',
  file: 'campplus-zh-en-advanced.onnx',
  url: `${BASE}/campplus-zh-en-advanced.onnx`,
  sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
  bytes: 28281164,
  dim: 192,
  // 3D-Speaker CAM++ zh-en common-advanced (Apache 2.0), as sherpa-onnx exports it. tools/pack-speaker-model.js takes it from here.
  upstream: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
};

const MY_VOICE = {
  match: 0.5, // "Balanced": the wake phrase is the owner's when its score against the profile is at least this
  agree: 0.45, // a setup take scoring below this against the other takes is odd, and asked again
  takes: 5,
  extraTakes: 3, // odd takes allowed in one setup, in all
  minPhraseMs: 350, // a shorter phrase can't be checked: refused
  maxPhraseMs: 3000,
  padMs: 100, // a little before the first word and after the last one
  setupMs: 90000,
  checkMs: 3000, // a check that takes longer is a no
  rate: 16000,
};

function unit(v) {
  if (!v || !v.length) return null;
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) return null;
    sum += x * x;
  }
  const n = Math.sqrt(sum);
  return n > 1e-6 ? Array.from(v, (x) => x / n) : null;
}

function cosine(a, b) {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub || ua.length !== ub.length) return -1;
  let dot = 0;
  for (let i = 0; i < ua.length; i++) dot += ua[i] * ub[i];
  return dot;
}

function meanUnit(list) {
  const us = (list || []).map(unit);
  if (!us.length || us.some((u) => !u || u.length !== us[0].length)) return null;
  return unit(us[0].map((_, k) => us.reduce((t, u) => t + u[k], 0) / us.length));
}

function oddTakes(takes, agree = MY_VOICE.agree) {
  if (takes.length < 2) return [];
  return takes.flatMap((take, i) => (cosine(take, meanUnit(takes.filter((_, j) => j !== i))) < agree ? [i] : []));
}

function isMe(profile, embedding, match = MY_VOICE.match) {
  return cosine(profile, embedding) >= match;
}

/** Where the phrase is in the audio since the recognizer began, in samples, padded; null when it is too short to check. */
function phraseSpan(startSec, endSec, rate = MY_VOICE.rate) {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  if ((endSec - startSec) * 1000 < MY_VOICE.minPhraseMs) return null;
  const pad = MY_VOICE.padMs / 1000;
  const from = Math.max(0, Math.round((startSec - pad) * rate));
  const to = Math.min(Math.round((endSec + pad) * rate), from + Math.round((MY_VOICE.maxPhraseMs / 1000) * rate));
  return { from, to };
}

/**
 * The setup's steps. `add(embedding)` for each take the wake loop heard (null for one that was too short or could not be
 * checked): 'again' (refused, ask again; it does not count), 'more' (kept), 'odd' (after the fifth: some takes did not
 * agree with the rest; they are dropped and asked again), 'done' (with the profile) or 'failed'. Once done or failed,
 * it stays so.
 */
function createSetup({ takes = MY_VOICE.takes, extraTakes = MY_VOICE.extraTakes, agree = MY_VOICE.agree } = {}) {
  let good = [];
  let extra = 0;
  let over = null;
  return {
    add(embedding) {
      if (over) return over;
      const u = unit(embedding);
      if (!u) return { step: 'again', count: good.length };
      good.push(u);
      if (good.length < takes) return { step: 'more', count: good.length };
      const odd = oddTakes(good, agree);
      if (!odd.length) {
        over = { step: 'done', count: takes, profile: meanUnit(good) };
        return over;
      }
      extra += odd.length;
      good = good.filter((_, i) => !odd.includes(i));
      if (extra > extraTakes) {
        over = { step: 'failed', count: good.length };
        return over;
      }
      return { step: 'odd', count: good.length };
    },
  };
}

function profileJson(profile, at = new Date().toISOString()) {
  return { v: 1, model: SPEAKER_MODEL.sha256, dim: profile.length, profile: Array.from(profile), at };
}

/** The saved profile, or null when it is not one this app can use (another model, another size, bad numbers). */
function readProfile(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || json.model !== SPEAKER_MODEL.sha256) return null;
  if (json.dim !== SPEAKER_MODEL.dim || !Array.isArray(json.profile) || json.profile.length !== SPEAKER_MODEL.dim) return null;
  if (!json.profile.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return unit(json.profile) ? json.profile : null;
}

/** What setup asks for: "hey <name>" when the model can hear the name, else "hey buddy". */
function setupPhrase(name, missing = VOICE_MODEL.missing) {
  return wakePhrases(name, missing)[0];
}

const MY_VOICE_LINES = {
  label: 'Only my voice',
  about: 'Buddy answers only you. Your voice stays on this device.',
  gettingModel: 'Getting the voice check ready (28 MB)…',
  modelFailed: "Couldn't get the voice check ready. Check the internet and try again.",
  start: (name) => `Say "Hey ${name}" ${MY_VOICE.takes} times. Wait for the tick each time.`,
  got: (count) => `Got it ✓ ${count} of ${MY_VOICE.takes}`,
  again: (name) => `I didn't get that. Say "Hey ${name}" again.`,
  odd: (name) => `That one sounded different. Say "Hey ${name}" again.`,
  done: 'Done. Buddy now answers only your voice.',
  failed: "I couldn't learn your voice. Try again somewhere quiet.",
  timedOut: "I didn't hear you. Try again.",
  on: 'On. Buddy answers only you.',
  setUpAgain: 'Set up Only my voice again.',
  notYou: "That didn't sound like you.",
  redo: 'Set up again',
};

module.exports = {
  SPEAKER_MODEL, MY_VOICE, MY_VOICE_LINES, unit, cosine, meanUnit, oddTakes, isMe, phraseSpan, createSetup,
  profileJson, readProfile, setupPhrase,
};
