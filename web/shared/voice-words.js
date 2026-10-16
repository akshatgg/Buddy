'use strict';

const { VOICE_MODEL } = require('./voice-model');

/**
 * The words of Buddy's voice flow (docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md §2): what a spoken
 * answer to "Send it?" or "Call Prince Sharma?" means, the short list the on-device recognizer listens for, what Buddy
 * says out loud for a card and around it, and whether a line asks the person something back. The Android app has a
 * port (voice/VoiceWords.kt), checked against the cases tools/sync-android-shared.js writes out.
 */

const YES_WORDS = ['yes', 'yeah', 'haan', 'okay'];
const NO_WORDS = ['no', 'nahi', 'na', 'cancel', "don't", 'stop', 'not', 'mat', 'nope', 'nah', 'wait'];
// A yes is only these words (the yes words, the card's verb and these): any other word, "not" and "later" too, makes it a no.
const FILLERS = ['it', 'please', 'ji', 'now', 'do', 'karo', 'kar', 'de'];
// The fillers the on-device model knows, so they are in its grammar too ("do" and "now" are left out: too close to "don't" and "not").
const GRAMMAR_FILLERS = ['it', 'please', 'ji', 'de'];
const VERBS = ['send', 'call']; // a card's own word is a yes for that card only
// The same word as a recognizer or Whisper may write it.
const SAME = { ok: 'okay', dont: "don't", nahin: 'nahi', haa: 'haan', han: 'haan', nope: 'no', nah: 'no' };
// The Hinglish ways to say "send": the same word for a message card (and no yes at all for a call card).
const BHEJ = ['bhej', 'bhejo', 'bhejdo', 'bhejna', 'bhejiye'];
for (const w of BHEJ) SAME[w] = 'send';
const UNK = 'unk'; // a word the recognizer could not make out: never allowed, so never a yes
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

/** The words said, lower case, punctuation gone, a word not made out ([unk], <unk>) kept as 'unk', each as the lists write it. */
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

function heardWords(text, verb) {
  const words = wordsOf(text);
  if (!words.length || words.every((w) => w === UNK)) return null; // nothing made out yet
  if (words.some((w) => NO_WORDS.includes(w))) return 'no';
  const isYes = (w) => YES_WORDS.includes(w) || w === verb;
  if (!words.every((w) => isYes(w) || FILLERS.includes(w))) return 'no';
  return words.some(isYes) ? 'yes' : null;
}

function heardAnswer(text, verb) {
  return heardWords(text, verb) ?? 'no';
}

/**
 * Whether an answer the device made out must be heard by the server instead of being judged here: it has a word not made
 * out ([unk]) next to a yes word or the card's verb (and no no word), or a word of this card's grammar is missing from the
 * model (`someMissing`) so the unknown word may be one of those. The device alone never turns such an answer into a no.
 */
function wantsServer(text, verb, someMissing = false) {
  const words = wordsOf(text);
  if (!words.includes(UNK) || words.every((w) => w === UNK)) return false;
  if (words.some((w) => NO_WORDS.includes(w))) return false;
  return someMissing || words.some((w) => YES_WORDS.includes(w) || w === verb);
}

function answerGrammar(verb, known = null) {
  const all = [...YES_WORDS, verb, ...(verb === 'send' ? BHEJ : []), ...GRAMMAR_FILLERS, ...NO_WORDS];
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

// The wake phrase ("Hey <name>"): see docs/superpowers/specs for the design. The device listens for it all the time.
const WAKE_FLOOR = 0.6; // each word of the phrase must be at least this sure
const REQUEST = { quietMs: 1200, nothingMs: 8000, maxMs: 20000 }; // listening for the request after the wake
const trimmed = (name) => String(name ?? '').trim();
// What the person can say: "Hey Buddy" always, and "Hey <name>" when the model can hear the name (`heard`).
const calls = (name, heard, q) => {
  const buddy = `${q}Hey Buddy${q}`;
  return heard ? `${buddy} or ${q}Hey ${trimmed(name)}${q}` : buddy;
};
const WAKE_LINES = {
  cantListen: (name) => `Buddy can't hear '${trimmed(name)}'. Say "Hey Buddy" instead, or try another spelling.`,
  notCaught: (name, heard = true) => `I didn't catch that. Say ${calls(name, heard, "'")} and try again.`,
  sayNow: (name, heard = true) => `Say ${calls(name, heard, '"')} now.`,
  heard: 'Heard you ✓',
  notHeard: (name, heard = true) => `I didn't hear ${calls(name, heard, '"')}. Try again.`,
  privacy: (name, heard = true) => `Your microphone stays on. Nothing leaves this device until you say ${calls(name, heard, "'")}.`,
  label: (name, heard = true) => `Listen for ${calls(name, heard, '"')}`,
  tapToListen: 'Tap me to listen again',
  listening: (name, heard = true) => `Listening for ${calls(name, heard, '"')}`,
  gettingEars: "Getting Buddy's ears ready (36 MB)…",
  earsFailed: "Couldn't get Buddy's ears ready. Check the internet and try again.",
  signIn: 'Sign in to talk to Buddy.',
  spellingHint: "If Test it doesn't hear you, try another spelling of the name.",
};

/** "hey " and the name: lower case, accents gone, letters and spaces only, at most 3 words. Null when no name is left. */
function wakePhrase(name) {
  const words = trimmed(name)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z]+/g, ' ')
    .split(' ')
    .filter(Boolean)
    .slice(0, 3);
  return words.length ? `hey ${words.join(' ')}` : null;
}

/**
 * The name's words the model can't hear: the phrase's words that are in `missing` (the words it lacks), and any word with
 * a digit in it (the phrase is letters only). Empty when Buddy can listen for the name.
 */
function wakeMissing(name, missing = VOICE_MODEL.missing) {
  const lacks = new Set(missing);
  const folded = trimmed(name).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const digits = folded.split(/\s+/).filter((t) => /\d/.test(t)).map((t) => t.replace(/[^a-z0-9]/g, ''));
  const phrase = wakePhrase(name);
  return [...digits, ...(phrase ? phrase.split(' ').filter((w) => lacks.has(w)) : [])];
}

/** Every phrase that wakes Buddy: "hey <name>", "<name>" (both only when the model can hear the name), "hey buddy", "buddy". */
function wakePhrases(name, missing = VOICE_MODEL.missing) {
  const phrase = wakePhrase(name);
  const named = phrase && wakeMissing(name, missing).length === 0 ? [phrase, phrase.slice(4)] : [];
  return [...new Set([...named, 'hey buddy', 'buddy'])];
}

/** Whether "Hey <name>" wakes Buddy besides "Hey Buddy": the name can be heard, and it is not Buddy itself. */
function wakeNameHeard(name, missing = VOICE_MODEL.missing) {
  return wakePhrases(name, missing).length > 2;
}

/**
 * Whether Vosk's final result starts with one of the phrases (a list; one string is a list of one): its words first, in
 * order, each at least `floor` sure. The longest phrase that matches wins ("hey rahul" over "rahul"). `endSec` is when the
 * last phrase word ended; `follows` whether more was said after it (the request in the same breath); `phrase` the one heard.
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

module.exports = {
  YES_WORDS, NO_WORDS, VERBS, FILLERS, BHEJ, SPOKEN_MAX, ANSWER_MS, UNLOCK_WAIT_MS, MAX_FOLLOW_UPS, VOICE_LINES,
  heardWords, heardAnswer, wantsServer, answerGrammar, GRAMMAR_FILLERS, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine,
  WAKE_FLOOR, REQUEST, WAKE_LINES, wakePhrase, wakeMissing, wakePhrases, wakeNameHeard, wakeFrom,
};
