'use strict';

/**
 * The Android app (android/) cannot run shared/'s JavaScript, so it reads what shared/ decides from one JSON file:
 * every system prompt as the app would build it, the limits, the refusals' words, each AI's label, key starts and
 * fallback models, what Buddy may remember (memoryRules: cleanFact's limits and patterns) and how its memory is kept
 * with the person's account (memorySync: shared/memory-sync.js's limits). This writes that file. `npm test` fails while it is out of date (test/android-shared.test.js).
 *
 *   npm run sync:android
 */

const fs = require('node:fs');
const path = require('node:path');
const prompts = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const memoryRules = require('../shared/memory-rules');
const memorySync = require('../shared/memory-sync');
const { pickChat, pickLine, PICK_CASES } = require('../shared/message-pick');
const { contactLine, appLine, LINE_CASES } = require('../shared/pick-lines');

const ROOT = path.join(__dirname, '..');
const TO = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'shared.json');
// Not shipped: what shared/prompts.js answers for some chat inputs, which the Kotlin port's tests must answer the same.
const CASES_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'chat-cases.json');
const PICK_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'pick-cases.json');
const LINES_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'line-cases.json');
const VOICE_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'voice-cases.json');
const voice = require('../shared/voice-words');
const HEARD = [['yes', 'send'], ['Haan.', 'call'], ['ok send it', 'send'], ['send', 'call'], ['call', 'call'], ['no, send it', 'send'],
  ['Don’t', 'call'], ['nahin', 'send'], ['[unk] [unk]', 'send'], ['', 'call'], ['maybe later', 'send'],
  ...['[unk] bhejo', '[unk] send it', 'yes [unk]', 'haan [unk]', '[unk]', '<unk> yes', 'bhej do'].map((t) => [t, 'send']), ['yes no', 'call'],
  ...['do not send it', 'do not call', 'Okay, not now', 'not okay', 'haan mat bhejo', 'nope, send', 'wait, send it', 'never mind okay', 'not yet',
    'haan nahi', 'no problem', "okay don't", 'abhi nahi'].map((t) => [t, 'send']), ['yes send it', 'send'], ['haan', 'send'], ['haan ji', 'send'],
  ['okay send it please', 'send'], ['yes call now', 'call'], ['please', 'send'],
  ...['haan bhej do', 'bhej do', 'haan ji bhejo', 'bhejdo', 'bhejna', 'bhejiye', 'mat bhejo', 'bhej mat', 'nahi bhejo', 'abhi mat bhejo'].map((t) => [t, 'send']),
  ...['haan bhej do', 'bhej do', 'bhejo', 'call karo', 'haan call kar do', 'kar do', 'haan kar do'].map((t) => [t, 'call']),
  ...['ha', 'ha ha', 'ha ha ha', 'ha send it', 'haan ha'].map((t) => [t, 'send'])];
// [text, verb, a word of the card's grammar is missing from the model]: should the server hear it (wantsServer).
const WANTS = [['yes [unk]', 'send', false], ['haan <unk>', 'send', false], ['[unk] send', 'send', false], ['[unk] call', 'call', false],
  ['[unk] call', 'send', false], ['no [unk]', 'send', true], ['yes no [unk]', 'send', false], ['[unk]', 'send', true], ['[unk] it', 'send', false],
  ['[unk] it', 'send', true], ['yes', 'send', true], ['', 'send', true], ['yes banana', 'send', false], ['yes [unk]', 'call', true],
  ['haan [unk] ji', 'send', false], ['[unk] please', 'call', true]];
const QUESTIONS = [{ kind: 'message', name: 'Priya Sharma', text: "I'm running late" }, { kind: 'message', name: 'Priya', text: 'Kahan ho? ' }, { kind: 'message', name: 'Priya', text: ' ' },
  { kind: 'call', name: 'Prince Narasimhan', how: 'phone' }, { kind: 'call', name: 'Prince', how: 'whatsapp' }, { kind: 'call', name: 'Prince', how: 'whatsapp_video' }];
const LINE_ITEMS = [[{ type: 'buddy', say: 'Okay!', text: 'x' }, { type: 'buddy', say: '', text: 'Which Priya: A or B? Tell me the full name.' },
  { type: 'buddy', say: '', text: 'y'.repeat(241) }, { type: 'event', text: '✅ Opened YouTube' }, { type: 'event', text: '📝 Remembered: x' },
  { type: 'error', text: 'x', code: 'network' }, { type: 'error', text: 'Sign in to use Buddy.', code: 'signed_out' }, { type: 'question', text: 'q' }]];
const ASKS = ['Who should I call?', 'I found lots of apps called a. Tell me the full name.', "I couldn't find YouTube on this phone.", ''];
const WAKE_NAMES = ['Rahul', 'Anaya', 'R2D2', 'Aarav Priya', '  Mr.  Rahul  Kumar Singh ', 'Zoë', '123', '', 'Xyzzy', 'Aarav', 'Buddy', 'Max Power', 'Hey', 'Hey Buddy', 'Hey Rahul'];
const wk = (word, conf, start, end) => ({ word, conf, start, end });
const wsaid = (...words) => ({ text: words.map((x) => x.word).join(' '), result: words });
const WAKE_SAID = [wsaid(wk('hey', 0.9, 1, 1.2), wk('rahul', 0.8, 1.2, 1.6)), wsaid(wk('hey', 0.9, 1, 1.2), wk('rahul', 0.8, 1.2, 1.6), wk('[unk]', 1, 1.7, 2.5)),
  wsaid(wk('[unk]', 1, 0, 1), wk('hey', 0.9, 1, 1.2), wk('rahul', 0.9, 1.2, 1.6)), wsaid(wk('rahul', 0.9, 0, 0.4)), wsaid(wk('hey', 0.5, 1, 1.2), wk('rahul', 0.9, 1.2, 1.6)),
  wsaid(wk('hey', 0.6, 1, 1.2), wk('rahul', 0.6, 1.2, 1.6)), { text: '', result: [] },
  wsaid(wk('hey', 0.9, 1, 1.2), wk('rahul', 0.9, 1.2, 1.6), wk('call', 0.9, 1.7, 2), wk('mom', 0.9, 2, 2.3)),
  wsaid(wk('hey', 0.9, 1, 1.2), wk('buddy', 0.9, 1.2, 1.5), wk('what', 0.9, 1.6, 1.8)), wsaid(wk('buddy', 0.9, 0, 0.4)),
  wsaid(wk('rahul', 0.9, 0, 0.4), wk('call', 0.9, 0.5, 0.8)), wsaid(wk('buddy', 0.5, 0, 0.4)), wsaid(wk('[unk]', 1, 0, 1), wk('buddy', 0.9, 1, 1.4))];
const WAKE_LIST = ['hey rahul', 'hey buddy'];
const WAKE_UNSORTED = ['hey buddy', 'hey rahul']; // the order does not matter
const KNOWN = [null, ['yes', 'okay', 'send', 'no', 'cancel', 'stop']];

function buildVoiceCases() {
  return {
    voiceModel: require('../shared/voice-model').VOICE_MODEL,
    note: 'Made by tools/sync-android-shared.js from shared/voice-words.js. Do not edit: run npm run sync:android.',
    heard: HEARD.map(([text, verb]) => ({ text, verb, words: voice.heardWords(text, verb), answer: voice.heardAnswer(text, verb) })),
    wantsServer: WANTS.map(([text, verb, missing]) => ({ text, verb, missing, wants: voice.wantsServer(text, verb, missing) })),
    grammar: KNOWN.flatMap((known) => voice.VERBS.map((verb) => ({ verb, known, ...voice.answerGrammar(verb, known && new Set(known)) }))),
    questions: QUESTIONS.map((card) => ({ card, said: voice.spokenQuestion(card) })),
    lines: LINE_ITEMS.map((items) => ({ items, said: voice.spokenLines(items) })),
    asksBack: ASKS.map((line) => ({ line, asks: voice.asksBack(line) })),
    wake: {
      phrases: WAKE_NAMES.map((name) => ({
        name, phrase: voice.wakePhrase(name), missing: voice.wakeMissing(name, ['aarav', 'priya']),
        all: voice.wakePhrases(name, ['aarav', 'priya']), nameHeard: voice.wakeNameHeard(name, ['aarav', 'priya']),
      })),
      lacks: ['aarav', 'priya'],
      floor: voice.WAKE_FLOOR,
      request: voice.REQUEST,
      from: [...WAKE_SAID.map((said) => ({ said, phrases: WAKE_LIST })), { said: WAKE_SAID[7], phrases: WAKE_UNSORTED }]
        .map((c) => ({ ...c, wake: voice.wakeFrom(c.said, c.phrases, voice.WAKE_FLOOR) })),
      lines: { name: ' Rahul ', ...Object.fromEntries(Object.entries(voice.WAKE_LINES).map(([k, v]) => [k, typeof v === 'function' ? v(' Rahul ', true) : v])) },
      unheard: Object.fromEntries(Object.entries(voice.WAKE_LINES).filter(([, v]) => typeof v === 'function').map(([k, v]) => [k, v(' Aarav ', false)])),
    },
    unlock: [['phone', 'message'], ['phone', 'call'], ['Mac', 'message'], ['Mac', 'call']]
      .map(([device, kind]) => ({ device, kind, name: 'Priya Sharma', said: voice.unlockLine(device, kind, 'Priya Sharma') })),
  };
}

/** The message buildPrompt refuses `input` with. */
function refusal(action, input) {
  try {
    prompts.buildPrompt(action, input);
  } catch (err) {
    return err.message;
  }
  throw new Error(`buildPrompt(${action}) did not refuse`);
}

function buildShared() {
  const write = {};
  for (const tone of Object.keys(prompts.TONES)) write[tone] = prompts.buildPrompt('write', { instruction: 'x', tone }).system;
  const asked = prompts.buildPrompt('check', { image: 'x', instruction: 'Q' }).user;
  const { LIMITS } = prompts;
  return {
    voiceModel: require('../shared/voice-model').VOICE_MODEL,
    note: 'Made by tools/sync-android-shared.js from shared/. Do not edit: run npm run sync:android.',
    maxTokens: prompts.MAX_TOKENS,
    limits: LIMITS,
    tones: Object.keys(prompts.TONES),
    defaultTone: 'formal',
    system: {
      write,
      fix: prompts.buildPrompt('fix', { text: 'x' }).system,
      check: prompts.buildPrompt('check', { image: 'x' }).system,
    },
    check: {
      defaultQuestion: prompts.buildPrompt('check', { image: 'x' }).user,
      questionPrefix: asked.slice(0, -1),
    },
    messages: {
      writeEmpty: refusal('write', {}),
      fixEmpty: refusal('fix', {}),
      checkEmpty: refusal('check', {}),
      checkTooBig: refusal('check', { image: 'x'.repeat(LIMITS.imageChars + 1) }),
      tooLongInstruction: refusal('write', { instruction: 'x'.repeat(LIMITS.instruction + 1) }),
      tooLongText: refusal('fix', { text: 'x'.repeat(LIMITS.text + 1) }),
    },
    // Buddy where you type (shared/tag.js): the app builds the user turn itself, as buildPrompt('tag') does.
    tag: {
      system: prompts.buildPrompt('tag', { text: 'x' }).system,
      userExample: prompts.buildPrompt('tag', { text: 'x', instruction: 'formal' }).user,
      empty: refusal('tag', {}),
    },
    // The panel's one request (the chat panel design §3): the app builds its user turn itself (ChatPrompt.kt), and
    // test/android-shared.test.js with chat-cases.json keeps it to what chatPrompt and parseChat do.
    chat: {
      system: prompts.buildPrompt('chat', { message: 'x' }).system,
      kinds: prompts.KINDS,
      limits: prompts.CHAT_LIMITS,
      messages: {
        empty: refusal('chat', {}),
        tooLongMessage: refusal('chat', { message: 'x'.repeat(LIMITS.instruction + 1) }),
        tooLongText: refusal('chat', { message: 'x', selection: 'x'.repeat(LIMITS.text + 1) }),
        imageTooBig: refusal('chat', { message: 'x', step: 2, image: 'x'.repeat(LIMITS.imageChars + 1) }),
        secondStepOnly: refusal('chat', { message: 'x', box: 'x' }),
      },
    },
    providers: PROVIDER_IDS.map((id) => {
      const p = PROVIDERS[id];
      return { id, label: p.label, keyUrl: p.keyUrl, keyPrefixes: p.keyPrefixes, fallbackModels: p.fallbackModels };
    }),
    memoryRules: {
      maxFacts: memoryRules.MAX_FACTS,
      maxFactChars: memoryRules.MAX_FACT_CHARS,
      nearChars: memoryRules.NEAR_CHARS,
      maxPhoneDigits: memoryRules.MAX_PHONE_DIGITS,
      // JavaScript patterns: the app reads \d as 0-9 and \b by ASCII letters and digits, as JavaScript does.
      patterns: Object.fromEntries(Object.entries(memoryRules.PATTERNS).map(([name, re]) => [name, { source: re.source, flags: re.flags }])),
    },
    // What Buddy knows, kept with the account (shared/memory-sync.js): the app's MemorySync.kt follows its rules.
    memorySync: { maxOps: memorySync.MAX_OPS, maxGone: memorySync.MAX_GONE },
  };
}

const SPACES = ' \u00a0\u2003\ufeff\t'; // JavaScript's trim and \s know these; Kotlin's own trim does not know them all

/** Chat inputs (only the kinds of values the Kotlin AskInput can hold) and what chatPrompt makes of them. */
const CHAT_INPUTS = [
  { message: '  boss ko mail, kal chutti chahiye  ' },
  { message: `${SPACES}hi${SPACES}` },
  { message: '' },
  { message: '   ' },
  { message: 'a'.repeat(1000) },
  { message: 'a'.repeat(1001) },
  {
    message: 'fix this',
    selection: '  i am go to office  ',
    box: 'Dear sir, i will not come tomorow.',
    history: [{ from: 'you', text: 'hi' }, { from: 'buddy', text: 'Hi Akshat! What should we do?' }],
    facts: ['Your boss is Mr. Sharma.', 'You work at Infosys.'],
    appName: 'Gmail',
    userName: 'Akshat',
    step: 2,
  },
  { message: 'what does this mean?', image: 'IMG', appName: 'Chrome', step: 2 },
  { message: 'what is this?', image: 'IMG', step: 1 },
  { message: 'what is this?', image: 'IMG' },
  { message: 'fix my English', box: 'i am go' },
  { message: 'fix my English', box: 'i am go', step: 3 },
  { message: 'hi', box: '   ', image: '', step: 1 },
  { message: 'fix', selection: 'a'.repeat(8000), box: 'b'.repeat(8000), step: 2 },
  { message: 'fix', selection: 'a'.repeat(8001) },
  { message: 'fix', box: 'a'.repeat(8001), step: 2 },
  { message: 'fix', selection: '   ' },
  { message: 'hi', step: 1 },
  {
    message: 'hi',
    history: [
      { from: 'you', text: 'one' }, { from: 'buddy', text: 'two' }, { from: 'someone', text: 'four' },
      { from: 'you', text: '   ' }, { from: 'buddy', text: 'five' }, { from: 'you', text: ' six ' },
      { from: 'buddy', text: 'seven' }, { from: 'you', text: 'eight' }, { from: 'buddy', text: `nine ${'x'.repeat(3000)}` },
    ],
  },
  { message: 'hi', history: [{ from: 'x', text: 'y' }] },
  { message: 'hi', facts: [...Array.from({ length: 60 }, (_, i) => `Fact ${i}.`), '  ', `Long\n${'y'.repeat(300)}`, `a${SPACES}b`] },
  { message: 'hi', appName: `Google\nChrome ${'c'.repeat(200)}`, userName: ` ${'n'.repeat(150)} ` },
  { message: 'hi', appName: '  ', userName: '' },
  { message: 'hi', appName: `Notes${SPACES}`, userName: `\u00a0Akshat\u2003Gupta ` },
  // The Android app can message on WhatsApp, and says so.
  { message: 'message priya on whatsapp im late', canMessage: true, facts: ['You work at Infosys.'], history: [{ from: 'you', text: 'hi' }] },
  { message: 'fix my English', box: 'i am go', canMessage: true, step: 2 },
  { message: 'hi', canMessage: false },
  // The Android app can call, open apps, see calls and read notifications too; the Mac calls and opens apps.
  { message: 'call prince', canMessage: true, canCall: true, canOpen: true, canSeeCalls: true, canReadNotifs: true },
  { message: 'open youtube', canOpen: true, canCall: false, canSeeCalls: 'true', canReadNotifs: false },
];

/** Model answers, and what parseChat reads in them. */
const fields = (f) => JSON.stringify({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...f });
const CHAT_REPLIES = [
  ...['write', 'fix', 'answer', 'box', 'screen', 'send', 'code', 'message', 'call', 'open', 'calls', 'notifs'].map((kind) => fields({ kind, say: 'Here you go.', text: 'Some text' })),
  JSON.stringify({ kind: 'fix', say: 'Theek kar diya!', text: 'I am going.', notes: ['"go" should be "going".'], doIt: true, send: true, remember: ['You work in an office.'], again: true }),
  `\`\`\`json\n${fields({ kind: 'fix', text: 'x', doIt: true })}\n\`\`\``,
  `\`\`\`\n${fields({ kind: 'answer', text: 'y' })}\n\`\`\``,
  '  Dear Sir,\nI will be on leave tomorrow.  ',
  fields({ kind: 'dance', text: 'x' }),
  '[1, 2]', '"just a string"', '42', 'null', '{"say": "no kind"}', '{"kind": "toString"}', '', '{', '```',
  '{"kind": "write", "text": "\\u12"}', '{"kind":"write"} {"kind":"fix"}',
  fields({ kind: 'write', say: 'Ye lo.', text: 'Dear Sir,\nI need leave.', doIt: true }).replace('\\n', '\n'),
  `Here is my answer:\n${fields({ kind: 'write', text: 'Hi' })}\nHope it helps!`,
  JSON.stringify({ kind: 'answer', say: 'Kal ka matlab tomorrow hai.' }),
  JSON.stringify({ kind: 'write', say: 'Hmm.' }),
  '{"kind": "box"}',
  JSON.stringify({ kind: 'fix', say: 7, text: ['no'], notes: ['1', 2, '  ', '3', '4', '5', '6', '7'], doIt: 'yes', send: 1, remember: ['A', null, 'B', 'C', 'D', 'E', 'F', 'z'.repeat(201), ' '], again: 'yes' }),
  JSON.stringify({ kind: 'write', remember: ['z'.repeat(201), 'z'.repeat(200)] }),
  '{"kind": "send", "notes": "not a list", "remember": {"a": 1}}',
  ...['answer', 'box', 'screen', 'send'].map((kind) => fields({ kind, text: 'x', again: true })),
  ...['true', 1, 'yes', null, {}, [true]].map((again) => fields({ kind: 'write', text: 'x', again })),
  fields({ kind: 'code', say: 'On it!', text: 'Fix the bug.', doIt: true, send: true, notes: ['x'], again: true }),
  JSON.stringify({ kind: 'message', app: 'whatsapp', to: 'Priya', say: 'Okay!', text: "I'm late", notes: ['x'], doIt: true, send: true, remember: [], again: true }),
  JSON.stringify({ kind: 'message', app: 'telegram', to: 'Priya', say: '', text: 'hi', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'message', app: '', to: '', say: '', text: 'hi', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'message', app: 'whatsapp', to: 'Priya', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'call', to: 'Prince', how: 'WhatsApp_Video', say: 'Calling!', text: 'x', notes: ['n'], doIt: true, send: true, remember: ['A'], again: true }),
  JSON.stringify({ kind: 'call', to: 'Prince', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'call', to: 'Prince', how: 'facetime', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'call', to: ' ', how: 'phone', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'open', app: ' YouTube ', say: 'Opening!', text: 'x', notes: [], doIt: true, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'open', app: '', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'calls', what: 'Missed', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'calls', what: 'today', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'notifs', app: ' Instagram ', say: 'Let me see.', text: 'x', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'notifs', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  fields({ kind: 'write', say: `${SPACES}hey${SPACES}`, text: `\u00a0x\u2003` }),
];

function buildChatCases() {
  return {
    voiceModel: require('../shared/voice-model').VOICE_MODEL,
    note: 'Made by tools/sync-android-shared.js from shared/prompts.js. Do not edit: run npm run sync:android.',
    prompts: CHAT_INPUTS.map((input) => {
      try {
        const { user, image } = prompts.buildPrompt('chat', input);
        return { input, user, image };
      } catch (err) {
        return { input, error: { code: err.code, message: err.message } };
      }
    }),
    replies: CHAT_REPLIES.map((raw) => ({ raw, reply: prompts.parseChat(raw) })),
  };
}

function buildPickCases() {
  return PICK_CASES.map(([asked, names]) => {
    const pick = pickChat(asked, names);
    return { asked, names, pick, line: pickLine(asked, pick) };
  });
}

function buildLineCases() {
  return LINE_CASES.map(([asked, names, where]) => {
    const pick = pickChat(asked, names);
    return { asked, names, where, pick, contact: contactLine(asked, pick), app: appLine(asked, pick, where) };
  });
}

if (require.main === module) {
  for (const [to, made] of [[TO, buildShared()], [CASES_TO, buildChatCases()], [PICK_TO, buildPickCases()], [LINES_TO, buildLineCases()], [VOICE_TO, buildVoiceCases()]]) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, `${JSON.stringify(made, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, to)}`);
  }
}

module.exports = { buildShared, buildChatCases, buildPickCases, buildLineCases, TO, CASES_TO, PICK_TO, LINES_TO, VOICE_TO, buildVoiceCases };
