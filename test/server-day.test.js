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

test("it is put together from the date's parts, whatever order the locale writes a date in", (t) => {
  const Real = Intl.DateTimeFormat;
  const file = require.resolve('../web/lib/day');
  t.after(() => {
    Intl.DateTimeFormat = Real;
    delete require.cache[file];
  });
  // The same formatter, but in a locale that writes the day first: 07/10/2026.
  Intl.DateTimeFormat = class extends Real {
    constructor(_locale, options) {
      super('en-GB', options);
    }
  };
  delete require.cache[file];
  const { dayKey: inDayFirstLocale } = require('../web/lib/day');
  assert.strictEqual(inDayFirstLocale(new Date('2026-10-06T18:30:00Z')), '2026-10-07');
});
