'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickChat } = require('../shared/message-pick');
const { contactLine, appLine } = require('../shared/pick-lines');

test('contacts: nobody is "not in your contacts"; which one and too many are the message lines', () => {
  assert.strictEqual(contactLine('Zoya', pickChat('Zoya', ['Prince Sharma'])), "I couldn't find Zoya in your contacts.");
  assert.strictEqual(contactLine('Prince', pickChat('Prince', ['Prince Sharma'])), null);
  assert.strictEqual(contactLine('Prince', pickChat('Prince', ['Prince Sharma', 'Prince Kumar'])), 'Which Prince: Prince Sharma or Prince Kumar? Tell me the full name.');
  assert.strictEqual(contactLine('a', pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f'])), 'I found lots of people called a. Tell me the full name.');
});

test('apps: one opens; which one; none on this phone or Mac; too many', () => {
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', ['YouTube', 'YouTube Music']), 'phone'), null);
  assert.strictEqual(appLine('you', pickChat('you', ['YouTube', 'YouTube Music']), 'phone'), 'Which one: YouTube or YouTube Music?');
  assert.strictEqual(appLine('you', pickChat('you', ['YouTube', 'YouTube Music', 'YouTube Kids']), 'Mac'), 'Which one: YouTube, YouTube Music or YouTube Kids?');
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', ['Safari']), 'Mac'), "I couldn't find YouTube on this Mac.");
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', []), 'phone'), "I couldn't find YouTube on this phone.");
  assert.strictEqual(appLine('a', pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f']), 'phone'), 'I found lots of apps called a. Tell me the full name.');
});
