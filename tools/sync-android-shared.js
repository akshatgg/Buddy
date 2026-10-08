'use strict';

/**
 * The Android app (android/) cannot run shared/'s JavaScript, so it reads what shared/ decides from one JSON file:
 * every system prompt as the app would build it, the limits, the refusals' words, and each AI's label, key starts and
 * fallback models. This writes that file. `npm test` fails while it is out of date (test/android-shared.test.js).
 *
 *   npm run sync:android
 */

const fs = require('node:fs');
const path = require('node:path');
const prompts = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');

const ROOT = path.join(__dirname, '..');
const TO = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'shared.json');
// Not shipped: what shared/prompts.js answers for some chat inputs, which the Kotlin port's tests must answer the same.
const CASES_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'chat-cases.json');

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
];

/** Model answers, and what parseChat reads in them. */
const fields = (f) => JSON.stringify({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...f });
const CHAT_REPLIES = [
  ...['write', 'fix', 'answer', 'box', 'screen', 'send', 'code'].map((kind) => fields({ kind, say: 'Here you go.', text: 'Some text' })),
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
  fields({ kind: 'write', say: `${SPACES}hey${SPACES}`, text: `\u00a0x\u2003` }),
];

function buildChatCases() {
  return {
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

if (require.main === module) {
  for (const [to, made] of [[TO, buildShared()], [CASES_TO, buildChatCases()]]) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.writeFileSync(to, `${JSON.stringify(made, null, 2)}\n`);
    console.log(`wrote ${path.relative(ROOT, to)}`);
  }
}

module.exports = { buildShared, buildChatCases, TO, CASES_TO };
