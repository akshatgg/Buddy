'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickChat, pickLine, sameName } = require('../shared/message-pick');

test('one match by a word of the name', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Rahul Verma', 'Priya Sharma', 'Coorg trip']), { kind: 'one', name: 'Priya Sharma' });
});
test('case, accents, extra spaces and the left-to-right mark do not matter', () => {
  assert.deepStrictEqual(pickChat('  priyá  ', ['‎Priya Sharma']), { kind: 'one', name: '‎Priya Sharma' });
  assert.strictEqual(sameName('‎Priya  Sharma', 'priya sharma'), true);
});
test('an exact full name wins over other matches', () => {
  assert.deepStrictEqual(pickChat('Priya Sharma', ['Priya Sharma', 'Priya Sharma Office']), { kind: 'one', name: 'Priya Sharma' });
});
test('an exact one-word name wins too ("Mummy" over "Mummy Office")', () => {
  assert.deepStrictEqual(pickChat('mummy', ['Mummy Office', 'Mummy']), { kind: 'one', name: 'Mummy' });
});
test('two to four matches: which one', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Priya Sharma', 'Priya Verma']), { kind: 'choose', names: ['Priya Sharma', 'Priya Verma'] });
});
test('every word they said must be in the name, as a word start', () => {
  assert.deepStrictEqual(pickChat('Priya Ver', ['Priya Sharma', 'Priya Verma']), { kind: 'one', name: 'Priya Verma' });
  assert.deepStrictEqual(pickChat('riya', ['Priya Sharma']), { kind: 'none' });
});
test('the same name twice counts once', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Priya Sharma', 'Priya Sharma']), { kind: 'one', name: 'Priya Sharma' });
});
test('no match, and more than four', () => {
  assert.deepStrictEqual(pickChat('Zoya', ['Priya Sharma']), { kind: 'none' });
  assert.deepStrictEqual(pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f']), { kind: 'many' });
  assert.deepStrictEqual(pickChat('', ['Priya']), { kind: 'none' });
});
test('the lines Buddy says', () => {
  assert.strictEqual(pickLine('Priya', { kind: 'one', name: 'Priya Sharma' }), null);
  assert.strictEqual(pickLine('Priya', { kind: 'choose', names: ['Priya Sharma', 'Priya Verma'] }), 'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.');
  assert.strictEqual(pickLine('Priya', { kind: 'choose', names: ['A', 'B', 'C'] }), 'Which Priya: A, B or C? Tell me the full name.');
  assert.strictEqual(pickLine('Zoya', { kind: 'none' }), "I couldn't find Zoya on WhatsApp.");
  assert.strictEqual(pickLine('a', { kind: 'many' }), 'I found lots of people called a. Tell me the full name.');
});
