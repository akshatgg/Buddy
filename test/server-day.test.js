'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { dayKey } = require('../web/lib/day');

test('the day is the date in India, which turns at 18:30 UTC', () => {
  assert.strictEqual(dayKey(new Date('2026-10-06T18:29:59Z')), '2026-10-06');
  assert.strictEqual(dayKey(new Date('2026-10-06T18:30:00Z')), '2026-10-07');
});

test('it is written YYYY-MM-DD', () => {
  assert.strictEqual(dayKey(new Date('2026-01-05T00:00:00Z')), '2026-01-05');
});
