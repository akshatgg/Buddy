'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buttonLabel, selectionPreview, thinkingLine, canSend, itemParts, speaker, spokenLine } = require('../src/renderer/panel/chat-view.js');

test('every button has its label', () => {
  assert.deepStrictEqual(
    ['insert', 'replace', 'copy', 'undo', 'retry', 'settings', 'send', 'not-now'].map(buttonLabel),
    ['Insert', 'Replace', 'Copy', 'Undo', 'Try again', 'Open Settings', 'Send', 'Not now'],
  );
  assert.strictEqual(buttonLabel('explode'), '');
  assert.strictEqual(buttonLabel(undefined), '');
});

test('the selection card shows the first words of the selection, on one line', () => {
  assert.strictEqual(selectionPreview('Hello there'), 'Hello there');
  assert.strictEqual(selectionPreview('  Dear Sir,\n\n  I am  writing  '), 'Dear Sir, I am writing');
  const long = 'I would like to ask for a day off tomorrow because my sister is getting married';
  const preview = selectionPreview(long);
  assert.ok(preview.endsWith('…'), preview);
  assert.ok(preview.length <= 41, preview);
  assert.ok(long.startsWith(preview.slice(0, -1)), preview);
  assert.strictEqual(preview, 'I would like to ask for a day off…'); // cut where a word ends
  // One very long word is cut where it has to be, without splitting a character made of two code units.
  assert.strictEqual(selectionPreview('x'.repeat(60)), `${'x'.repeat(40)}…`);
  assert.strictEqual(selectionPreview('😀'.repeat(50)), `${'😀'.repeat(40)}…`);
  assert.strictEqual(selectionPreview(''), '');
  assert.strictEqual(selectionPreview(null), '');
});

test('the thinking line names the buddy', () => {
  assert.strictEqual(thinkingLine('Aarav'), 'Aarav is thinking…');
  assert.strictEqual(thinkingLine(''), 'Buddy is thinking…');
  assert.strictEqual(thinkingLine(undefined), 'Buddy is thinking…');
});

test('a message can be sent when there is something to send and the buddy is not busy', () => {
  assert.strictEqual(canSend({ busy: false, text: 'boss ko mail', selection: '' }), true);
  assert.strictEqual(canSend({ busy: false, text: '', selection: '' }), false);
  assert.strictEqual(canSend({ busy: false, text: '  \n ', selection: '' }), false);
  // An empty box with a selection means "fix this".
  assert.strictEqual(canSend({ busy: false, text: '', selection: 'I has a apple' }), true);
  // One message at a time.
  assert.strictEqual(canSend({ busy: true, text: 'make it shorter', selection: '' }), false);
  assert.strictEqual(canSend({ busy: true, text: '', selection: 'I has a apple' }), false);
  assert.strictEqual(canSend({}), false);
});

test('your message is drawn as your words', () => {
  assert.deepStrictEqual(itemParts({ id: 1, type: 'you', text: 'boss ko mail, kal chutti chahiye' }), {
    id: 1, kind: 'you', say: '', text: 'boss ko mail, kal chutti chahiye', notes: [], buttons: [],
  });
});

test("the buddy's answer has its line, its text, its notes and its buttons", () => {
  const parts = itemParts({
    id: 2,
    type: 'buddy',
    say: 'Here is your mail.',
    text: 'Dear Sir,\n\nI need a day off tomorrow.',
    notes: ['"has" → "have"', '"a apple" → "an apple"'],
    buttons: ['replace', 'copy'],
  });
  assert.deepStrictEqual(parts, {
    id: 2,
    kind: 'buddy',
    say: 'Here is your mail.',
    text: 'Dear Sir,\n\nI need a day off tomorrow.',
    notes: ['"has" → "have"', '"a apple" → "an apple"'],
    buttons: [
      { button: 'replace', label: 'Replace', primary: true },
      { button: 'copy', label: 'Copy', primary: false },
    ],
  });
  // Insert and Send are the main buttons too; Undo, Copy and the rest are not.
  const put = itemParts({ id: 3, type: 'buddy', say: '', text: 'Hi', notes: [], buttons: ['insert', 'undo', 'copy'] });
  assert.deepStrictEqual(put.buttons.map((b) => [b.button, b.primary]), [['insert', true], ['undo', false], ['copy', false]]);
});

test('events, errors and the question are lines with their buttons', () => {
  assert.deepStrictEqual(itemParts({ id: 4, type: 'event', text: '📝 Remembered: Your boss is Mr. Sharma.', buttons: ['undo'] }), {
    id: 4, kind: 'event', say: '', text: '📝 Remembered: Your boss is Mr. Sharma.', notes: [],
    buttons: [{ button: 'undo', label: 'Undo', primary: false }],
  });
  assert.deepStrictEqual(itemParts({ id: 5, type: 'error', text: 'Add your API key in Settings first.', code: 'no_key', buttons: ['retry', 'settings'] }), {
    id: 5, kind: 'error', say: '', text: 'Add your API key in Settings first.', notes: [],
    buttons: [{ button: 'retry', label: 'Try again', primary: false }, { button: 'settings', label: 'Open Settings', primary: false }],
  });
  assert.deepStrictEqual(itemParts({ id: 6, type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] }), {
    id: 6, kind: 'question', say: '', text: 'Send it?', notes: [],
    buttons: [{ button: 'send', label: 'Send', primary: true }, { button: 'not-now', label: 'Not now', primary: false }],
  });
  // An event with no buttons (an Undo that was used) is just its line.
  assert.deepStrictEqual(itemParts({ id: 7, type: 'event', text: 'Okay, I forgot that.', buttons: [] }).buttons, []);
});

test('missing or odd fields are drawn as nothing rather than as "undefined"', () => {
  assert.deepStrictEqual(itemParts({ id: 8, type: 'buddy', text: 'Hello' }), {
    id: 8, kind: 'buddy', say: '', text: 'Hello', notes: [], buttons: [],
  });
  const odd = itemParts({ id: 9, type: 'buddy', say: 42, text: null, notes: ['ok', 7, '', null], buttons: ['copy', 'explode', 'copy', null] });
  assert.deepStrictEqual(odd, {
    id: 9, kind: 'buddy', say: '', text: '', notes: ['ok'], buttons: [{ button: 'copy', label: 'Copy', primary: false }],
  });
  // Notes and say belong to the buddy's answers only.
  assert.deepStrictEqual(itemParts({ id: 10, type: 'event', say: 'x', text: '✅ Sent', notes: ['y'] }), {
    id: 10, kind: 'event', say: '', text: '✅ Sent', notes: [], buttons: [],
  });
});

test('an item the page does not know, or one with nothing in it, is not drawn', () => {
  assert.strictEqual(itemParts({ id: 11, type: 'mystery', text: 'hi' }), null);
  assert.strictEqual(itemParts({ id: 12, type: 'you', text: '' }), null);
  assert.strictEqual(itemParts({ id: 13, type: 'buddy', say: '', text: '', notes: [], buttons: [] }), null);
  assert.strictEqual(itemParts({ id: 14, type: 'event', text: '' }), null);
  assert.strictEqual(itemParts(null), null);
  assert.strictEqual(itemParts('you'), null);
});

test('a screen reader hears who each message is from: you, or the buddy by its name', () => {
  assert.strictEqual(speaker('you', 'Aarav'), 'You:');
  for (const kind of ['buddy', 'error', 'question']) assert.strictEqual(speaker(kind, 'Aarav'), 'Aarav:', kind);
  assert.strictEqual(speaker('buddy', ''), 'Buddy:');
  assert.strictEqual(speaker('buddy', undefined), 'Buddy:');
  // A small line about what happened is from nobody.
  assert.strictEqual(speaker('event', 'Aarav'), '');
});

test('a new item is read out as who it is from, then all its words', () => {
  const answer = itemParts({
    id: 1, type: 'buddy', say: 'Here is your mail.', text: 'Dear Sir,\nI need a day off.', notes: ['"has" → "have"'], buttons: ['insert'],
  });
  assert.strictEqual(spokenLine(answer, 'Aarav'), 'Aarav: Here is your mail. Dear Sir,\nI need a day off. "has" → "have"');
  assert.strictEqual(spokenLine(itemParts({ id: 2, type: 'you', text: 'fix this' }), 'Aarav'), 'You: fix this');
  assert.strictEqual(spokenLine(itemParts({ id: 3, type: 'error', text: 'Sign in to use Buddy.', buttons: ['retry'] }), ''), 'Buddy: Sign in to use Buddy.');
  assert.strictEqual(spokenLine(itemParts({ id: 4, type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] }), 'Aarav'), 'Aarav: Send it?');
  assert.strictEqual(spokenLine(itemParts({ id: 5, type: 'event', text: '✅ Sent' }), 'Aarav'), '✅ Sent');
  // An answer that is only its line has no empty text after it.
  assert.strictEqual(spokenLine(itemParts({ id: 6, type: 'buddy', say: 'Got it!', text: '' }), 'Aarav'), 'Aarav: Got it!');
});
