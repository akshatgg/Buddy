'use strict';

/**
 * The words of Buddy's voice flow (docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md §2): what a spoken
 * answer to "Send it?" or "Call Prince Sharma?" means, the short list the on-device recognizer listens for, what Buddy
 * says out loud for a card and around it, and whether a line asks the person something back. The Android app has a
 * port (voice/VoiceWords.kt), checked against the cases tools/sync-android-shared.js writes out.
 */

const YES_WORDS = ['yes', 'yeah', 'haan', 'ha', 'okay'];
const NO_WORDS = ['no', 'nahi', 'na', 'cancel', "don't", 'stop', 'not', 'mat', 'nope', 'nah', 'wait'];
// A yes is only these words (the yes words, the card's verb and these): any other word, "not" and "later" too, makes it a no.
const FILLERS = ['it', 'please', 'ji', 'now', 'do', 'karo', 'kar', 'de'];
const VERBS = ['send', 'call']; // a card's own word is a yes for that card only
// The same word as a recognizer or Whisper may write it.
const SAME = { ok: 'okay', dont: "don't", nahin: 'nahi', haa: 'haan', han: 'haan', nope: 'no', nah: 'no' };
const SPOKEN_MAX = 240; // a line of Buddy's own longer than this is only shown
const ANSWER_MS = 8000; // nothing decisive heard this long after the question: no
const UNLOCK_WAIT_MS = 60000;
const MAX_FOLLOW_UPS = 2; // "Which Priya?" answered by voice, at most twice in a row
const DONE = /^(✅|📞|📹)\s*/u;
const NO_INTERNET = ['network', 'timeout'];

const VOICE_LINES = {
  sent: 'Sent.',
  notSent: 'Okay, not sent.',
  notNow: 'Okay, not now.',
  noInternet: "I can't reach the internet right now.",
  didntSend: "I didn't send it.",
  didntCall: "I didn't call.",
};

/** The words said, lower case, punctuation and [unk] gone, each as the lists write it. */
function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\[unk\]/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .map((w) => SAME[w] || w);
}

function heardWords(text, verb) {
  const words = wordsOf(text);
  if (!words.length) return null;
  if (words.some((w) => NO_WORDS.includes(w))) return 'no';
  const isYes = (w) => YES_WORDS.includes(w) || w === verb;
  if (!words.every((w) => isYes(w) || FILLERS.includes(w))) return 'no';
  return words.some(isYes) ? 'yes' : null;
}

function heardAnswer(text, verb) {
  return heardWords(text, verb) ?? 'no';
}

function answerGrammar(verb, known = null) {
  const all = [...YES_WORDS, verb, ...NO_WORDS];
  const kept = known ? all.filter((w) => known.has(w)) : all;
  return { grammar: [...kept, '[unk]'], missing: all.filter((w) => !kept.includes(w)) };
}

function spokenQuestion(card) {
  if (card.kind === 'message') {
    const text = String(card.text || '').trim();
    if (!text) return `To ${card.name}. Send it?`;
    return `To ${card.name}: ${/[.!?…]$/.test(text) ? text : `${text}.`} Send it?`;
  }
  if (card.how === 'whatsapp_video') return `WhatsApp video call ${card.name}?`;
  if (card.how === 'whatsapp') return `WhatsApp call ${card.name}?`;
  return `Call ${card.name}?`;
}

function spokenLines(items) {
  const out = [];
  for (const item of items) {
    const say = String(item.say || '').trim();
    const text = String(item.text || '').trim();
    if (item.type === 'buddy') {
      const line = say || (text.length <= SPOKEN_MAX ? text : '');
      if (line) out.push(line);
    } else if (item.type === 'error') {
      out.push(NO_INTERNET.includes(item.code) ? VOICE_LINES.noInternet : text);
    } else if (item.type === 'event' && DONE.test(text)) {
      out.push(text.replace(DONE, ''));
    }
  }
  return out;
}

function asksBack(line) {
  const text = String(line || '').trim();
  return text.includes('?') || text.endsWith('Tell me the full name.');
}

function unlockLine(device, kind, name) {
  if (device === 'Mac') return kind === 'call' ? `Unlock your Mac and I'll call ${name}.` : "Unlock your Mac and I'll send it.";
  return kind === 'call' ? `Unlock your phone and I'll call ${name}.` : `Unlock your phone and I'll send it to ${name}.`;
}

function callingLine(name) {
  return `Calling ${name}.`;
}

module.exports = {
  YES_WORDS, NO_WORDS, VERBS, SPOKEN_MAX, ANSWER_MS, UNLOCK_WAIT_MS, MAX_FOLLOW_UPS, VOICE_LINES,
  heardWords, heardAnswer, answerGrammar, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine,
};
