'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { cleanFact, MAX_FACTS, MAX_FACT_CHARS } = require('../shared/memory-rules');

test('at most 50 facts, each at most 200 characters', () => {
  assert.strictEqual(MAX_FACTS, 50);
  assert.strictEqual(MAX_FACT_CHARS, 200);
});

test('a fact is kept trimmed, on one line', () => {
  assert.strictEqual(cleanFact('  Your boss is Mr. Sharma.  '), 'Your boss is Mr. Sharma.');
  assert.strictEqual(cleanFact('You work at\nInfosys,\r\n  in Pune.'), 'You work at Infosys, in Pune.');
  assert.strictEqual(cleanFact('You sign off with\t"Regards, Akshat".'), 'You sign off with "Regards, Akshat".');
});

test('nothing, blanks and things that are not text are not facts', () => {
  for (const value of ['', '   ', '\n\t', null, undefined, 42, {}, ['a fact'], true]) {
    assert.strictEqual(cleanFact(value), null, JSON.stringify(value));
  }
});

test('a fact up to 200 characters is kept, a longer one is refused', () => {
  const longest = `You like ${'a'.repeat(MAX_FACT_CHARS - 9)}`;
  assert.strictEqual(longest.length, 200);
  assert.strictEqual(cleanFact(longest), longest);
  assert.strictEqual(cleanFact(`${longest}a`), null);
  assert.strictEqual(cleanFact(`   ${longest}   `), longest, 'the spaces around it do not count');
});

test('a fact that names a password, passcode, PIN, OTP or CVV is refused, in any case', () => {
  for (const fact of [
    'Your password is tiger123.',
    'Your Gmail PASSWORD is hunter2',
    'Your phone passcode is 4321.',
    'Your ATM PIN is 1234.',
    'Your pin is 0000',
    'The OTP was 482913.',
    'Your card CVV is 123.',
    'Your cvv: 999',
    'Your passwords are in a notebook.',
    'Your PINs are on a sticky note.',
  ]) {
    assert.strictEqual(cleanFact(fact), null, fact);
  }
});

test('only whole words count: words that just contain them are fine', () => {
  for (const fact of [
    'You love spinach.',
    'You use Pinterest for recipes.',
    'Your team is Spinning Wheels.',
    'You prefer the second option.',
    'Your passport is renewed every ten years.',
  ]) {
    assert.strictEqual(cleanFact(fact), fact, fact);
  }
});

test('12 or more digits are refused, even with spaces, dots or dashes between them', () => {
  for (const fact of [
    'Your card is 4111111111111111.',
    'Your card is 4111 1111 1111 1111.',
    'Your account number is 1234-5678-9012.',
    'Your Aadhaar is 1234 5678 9012.',
    'Your ID is 1234.5678.9012.',
    'Your number is 123456789012.',
  ]) {
    assert.strictEqual(cleanFact(fact), null, fact);
  }
});

test('a 10-digit phone number and shorter numbers are kept', () => {
  for (const fact of [
    'Your phone is 98765 43210.',
    'Your phone is 987-654-3210.',
    'Your office is at 221B Baker Street, 2nd floor.',
    'You were born in 1990 and joined in 2015.',
    'Your pincode is 110001.',
  ]) {
    assert.strictEqual(cleanFact(fact), fact, fact);
  }
});

test('a phone number with its country code and a PIN code (the postal code) are kept', () => {
  for (const fact of [
    'Your phone is +91 98765 43210.',
    'Your office phone is +44 (20) 7946 0958.',
    'Your PIN code is 110001.',
    'Your pin-code is 400001.',
  ]) {
    assert.strictEqual(cleanFact(fact), fact, fact);
  }
  // A card number does not become a phone number by starting with "+", nor a PIN by being near a code.
  assert.strictEqual(cleanFact('Your card is +4111 1111 1111 1111.'), null);
  assert.strictEqual(cleanFact('Your PIN is 1234, the code for the door.'), null);
});

test('the add box in Settings takes no more than a fact can hold', () => {
  const html = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'settings', 'index.html'), 'utf8');
  const box = html.match(/<input id="memory-new"[^>]*>/);
  assert.ok(box, 'Settings has the add box');
  assert.match(box[0], new RegExp(`maxlength="${MAX_FACT_CHARS}"`));
});
