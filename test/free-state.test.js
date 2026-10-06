'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { aiSection } = require('../src/main/free-state');

const free = (extra) => ({ freeOn: true, limitMode: 'daily', limit: 30, usedToday: 4, allowOwnKey: false, blocked: false, isAdmin: false, ...extra });

test('not known yet, or free mode off: the key form, as in Phase 1', () => {
  assert.deepStrictEqual(aiSection(null), { note: '', showForm: true });
  assert.deepStrictEqual(aiSection(free({ freeOn: false })), { note: '', showForm: true });
});

test('free and unlimited: no key needed', () => {
  assert.deepStrictEqual(aiSection(free({ limitMode: 'unlimited', limit: null })), { note: 'Free AI is on. No key needed.', showForm: false });
});

test('a daily limit: how many a day, and how many are used today', () => {
  assert.deepStrictEqual(aiSection(free()), { note: 'You get 30 free requests a day. Used today: 4.', showForm: false });
  assert.strictEqual(aiSection(free({ usedToday: 31 })).note, 'You get 30 free requests a day. Used today: 30.');
});

test('a daily limit with own keys allowed: the form too', () => {
  assert.deepStrictEqual(aiSection(free({ allowOwnKey: true })), {
    note: 'You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.',
    showForm: true,
  });
});

test('blocked: paused, with the form only where own keys are allowed', () => {
  assert.deepStrictEqual(aiSection(free({ blocked: true })), { note: 'Your free access is paused.', showForm: false });
  assert.deepStrictEqual(aiSection(free({ blocked: true, allowOwnKey: true })),
    { note: 'Your free access is paused. You can still use your own key.', showForm: true });
});
