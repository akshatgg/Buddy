'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { chooseModel } = require('../src/main/ipc/settings');

test('keeps the model the user picked when the key can use it', () => {
  assert.strictEqual(chooseModel(['a', 'b'], ['b'], 'a'), 'a');
});

test('otherwise uses the provider default when the key has it', () => {
  assert.strictEqual(chooseModel(['a', 'b'], ['b'], 'gone'), 'b');
});

test('otherwise the first model the key can use', () => {
  assert.strictEqual(chooseModel(['a', 'c'], ['b'], null), 'a');
});
