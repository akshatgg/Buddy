'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { rankVoices, bestVoice, chooseVoice, voiceLabel, shortName } = require('../src/main/voices');

const v = (name, lang) => ({ name, lang });

test('prefers en-IN, then en-US, then en-GB, then any other English', () => {
  const list = [v('Karen', 'en-AU'), v('Daniel', 'en-GB'), v('Samantha', 'en-US'), v('Rishi', 'en-IN')];
  assert.deepStrictEqual(rankVoices(list).map((x) => x.name), ['Rishi', 'Samantha', 'Daniel', 'Karen']);
});

test('inside a language, Premium beats Enhanced beats the rest', () => {
  const list = [v('Samantha', 'en-US'), v('Ava (Enhanced)', 'en-US'), v('Zoe (Premium)', 'en-US')];
  assert.deepStrictEqual(rankVoices(list).map((x) => x.name), ['Zoe (Premium)', 'Ava (Enhanced)', 'Samantha']);
});

test('the language comes before the quality', () => {
  const list = [v('Ava (Premium)', 'en-US'), v('Rishi', 'en-IN')];
  assert.strictEqual(bestVoice(list), 'Rishi');
});

test('novelty voices are never picked, whatever their language or quality', () => {
  const list = [v('Zarvox', 'en-US'), v('Bad News', 'en-US'), v('eddy (English (US))', 'en-US'), v('Fred', 'en-US'), v('Samantha', 'en-GB')];
  assert.deepStrictEqual(rankVoices(list).map((x) => x.name), ['Samantha']);
});

test('novelty names are matched case-insensitively on the part before the bracket', () => {
  assert.deepStrictEqual(rankVoices([v('Grandma (English (UK))', 'en-GB'), v('Flo (Premium)', 'en-US'), v('Floyd', 'en-US')]).map((x) => x.name), ['Floyd']);
});

test('voices that are not English are left out; underscores in the language are fine', () => {
  const list = [v('Amelie', 'fr-CA'), v('Lekha', 'hi-IN'), v('Rishi', 'en_IN')];
  assert.deepStrictEqual(rankVoices(list).map((x) => x.name), ['Rishi']);
});

test('bestVoice is null with no usable voice', () => {
  assert.strictEqual(bestVoice([]), null);
  assert.strictEqual(bestVoice([v('Zarvox', 'en-US'), v('Amelie', 'fr-FR')]), null);
  assert.strictEqual(bestVoice(null), null);
});

test('the same voice listed twice is kept once', () => {
  assert.strictEqual(rankVoices([v('Rishi', 'en-IN'), v('Rishi', 'en-IN')]).length, 1);
});

test('chooseVoice: a chosen voice that is still there is used', () => {
  const list = [v('Rishi', 'en-IN'), v('Daniel', 'en-GB')];
  assert.strictEqual(chooseVoice(list, 'Daniel'), 'Daniel');
});

test('chooseVoice: a chosen voice that is gone, or none, falls back to the best', () => {
  const list = [v('Rishi', 'en-IN'), v('Daniel', 'en-GB')];
  assert.strictEqual(chooseVoice(list, 'Gone'), 'Rishi');
  assert.strictEqual(chooseVoice(list, null), 'Rishi');
  assert.strictEqual(chooseVoice([], 'Rishi'), null);
});

test('labels: short name, then the quality and region', () => {
  assert.strictEqual(voiceLabel(v('Rishi', 'en-IN')), 'Rishi (India)');
  assert.strictEqual(voiceLabel(v('Ava (Premium)', 'en-US')), 'Ava (Premium, US)');
  assert.strictEqual(voiceLabel(v('Ava (Enhanced)', 'en-GB')), 'Ava (Enhanced, UK)');
  assert.strictEqual(voiceLabel(v('Karen', 'en-AU')), 'Karen (Australia)');
  assert.strictEqual(voiceLabel(v('Odd', 'en-NZ')), 'Odd (NZ)');
  assert.strictEqual(shortName('Ava (Premium)'), 'Ava');
});
