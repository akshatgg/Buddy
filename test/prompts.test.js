'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildPrompt, parseCheck, LIMITS } = require('../shared/prompts');

test('write: uses the instruction as the user turn and the chosen tone', () => {
  const p = buildPrompt('write', { instruction: '  boss ko mail likho kal chutti chahiye ', tone: 'friendly' });
  assert.strictEqual(p.user, 'boss ko mail likho kal chutti chahiye');
  assert.match(p.system, /warm and friendly/);
  assert.match(p.system, /Hinglish/);
  assert.match(p.system, /Return ONLY the finished text/);
  assert.match(p.system, /\[Name\]/);
  assert.strictEqual(p.image, null);
});

test('write: an unknown tone falls back to formal', () => {
  assert.match(buildPrompt('write', { instruction: 'hi', tone: 'pirate' }).system, /formal and polite/);
});

test('write: an empty instruction is refused with a message for the user', () => {
  assert.throws(() => buildPrompt('write', { instruction: '   ' }), {
    code: 'bad_request',
    message: 'Tell me what to write first.',
  });
});

test('fix: passes the text through and asks for only the corrected text', () => {
  const p = buildPrompt('fix', { text: 'i am go to office' });
  assert.strictEqual(p.user, 'i am go to office');
  assert.match(p.system, /Return ONLY the corrected text/);
});

test('fix: text over the limit is refused', () => {
  assert.throws(() => buildPrompt('fix', { text: 'a'.repeat(LIMITS.text + 1) }), { code: 'bad_request' });
});

test('check: needs a screenshot, and carries it with the optional question', () => {
  assert.throws(() => buildPrompt('check', {}), { code: 'bad_request', message: 'Take a screenshot first.' });
  const p = buildPrompt('check', { image: 'AAAA', instruction: 'is this mail ok?' });
  assert.strictEqual(p.image, 'AAAA');
  assert.strictEqual(p.user, 'The user asks: is this mail ok?');
  assert.match(p.system, /JSON only/);
  assert.strictEqual(buildPrompt('check', { image: 'AAAA' }).user, 'Is my text okay?');
});

test('check: a screenshot over the limit is refused', () => {
  assert.throws(() => buildPrompt('check', { image: 'a'.repeat(LIMITS.imageChars + 1) }), { code: 'bad_request' });
});

test('an unknown action is refused', () => {
  assert.throws(() => buildPrompt('dance', {}), { code: 'bad_request' });
});

test('parseCheck reads the JSON answer, with or without code fences', () => {
  const answer = '```json\n{"verdict":"problems","problems":["Spelling: recieve"],"corrected":"I will receive it."}\n```';
  assert.deepStrictEqual(parseCheck(answer), {
    verdict: 'problems',
    problems: ['Spelling: recieve'],
    corrected: 'I will receive it.',
  });
});

test('parseCheck keeps at most 5 problems and turns a blank correction into null', () => {
  const r = parseCheck(JSON.stringify({ verdict: 'problems', problems: ['1', '2', '3', '4', '5', '6'], corrected: '  ' }));
  assert.strictEqual(r.problems.length, 5);
  assert.strictEqual(r.corrected, null);
});

test('parseCheck falls back to the raw text', () => {
  assert.deepStrictEqual(parseCheck('Looks fine to me!'), { raw: 'Looks fine to me!' });
  assert.deepStrictEqual(parseCheck('{"verdict":"maybe"}'), { raw: '{"verdict":"maybe"}' });
});
