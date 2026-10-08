'use strict';

/**
 * The Android app (android/) cannot run shared/'s JavaScript, so it reads what shared/ decides from one JSON file:
 * every system prompt as the app would build it, the limits, the refusals' words, each AI's label, key starts and
 * fallback models, and what Buddy may remember (memoryRules: cleanFact's limits and patterns). This writes that file. `npm test` fails while it is out of date (test/android-shared.test.js).
 *
 *   npm run sync:android
 */

const fs = require('node:fs');
const path = require('node:path');
const prompts = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const memoryRules = require('../shared/memory-rules');

const ROOT = path.join(__dirname, '..');
const TO = path.join(ROOT, 'android', 'app', 'src', 'main', 'assets', 'shared.json');

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
  };
}

if (require.main === module) {
  fs.mkdirSync(path.dirname(TO), { recursive: true });
  fs.writeFileSync(TO, `${JSON.stringify(buildShared(), null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, TO)}`);
}

module.exports = { buildShared, TO };
