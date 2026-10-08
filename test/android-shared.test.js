'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const prompts = require('../shared/prompts');
const { PROVIDER_IDS } = require('../shared/providers');
const memoryRules = require('../shared/memory-rules');
const { buildShared, TO } = require('../tools/sync-android-shared');

test('android shared.json is up to date with shared/ (run `npm run sync:android` after changing shared/)', () => {
  assert.equal(fs.readFileSync(TO, 'utf8'), `${JSON.stringify(buildShared(), null, 2)}\n`);
});

test('shared.json holds every tone, the three system prompts and the refusals, as the app builds them', () => {
  const s = buildShared();
  assert.deepEqual(s.tones, Object.keys(prompts.TONES));
  for (const tone of s.tones) assert.equal(s.system.write[tone], prompts.buildPrompt('write', { instruction: 'x', tone }).system);
  assert.equal(s.system.fix, prompts.buildPrompt('fix', { text: 'x' }).system);
  assert.equal(s.check.defaultQuestion, 'Is my text okay?');
  assert.equal(`${s.check.questionPrefix}Q`, prompts.buildPrompt('check', { image: 'x', instruction: 'Q' }).user);
  assert.equal(s.messages.writeEmpty, 'Tell me what to write first.');
  assert.match(s.messages.tooLongText, /over 8000 characters/);
  assert.deepEqual(s.providers.map((p) => p.id), PROVIDER_IDS);
});

test('shared.json holds the memory rules: the limits and every pattern cleanFact uses, with its flags', () => {
  const { memoryRules: m } = buildShared();
  assert.equal(m.maxFacts, memoryRules.MAX_FACTS);
  assert.equal(m.maxFactChars, memoryRules.MAX_FACT_CHARS);
  assert.equal(m.nearChars, 30);
  assert.equal(m.maxPhoneDigits, 15);
  const { PATTERNS } = memoryRules;
  assert.deepEqual(Object.keys(m.patterns).sort(), Object.keys(PATTERNS).sort());
  for (const [name, re] of Object.entries(PATTERNS)) assert.deepEqual(m.patterns[name], { source: re.source, flags: re.flags }, name);
  // Each pattern, rebuilt from shared.json, refuses and keeps as the original does.
  const secret = new RegExp(m.patterns.secretWords.source, m.patterns.secretWords.flags);
  assert.ok(secret.test('Your ATM PIN is 1234.'));
  assert.ok(!secret.test('Your PIN code is 110001.'));
});
