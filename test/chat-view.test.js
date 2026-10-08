'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buttonLabel, selectionPreview, thinkingLine, canSend, itemParts, speaker, spokenLine, exampleLine, jobHeading } = require('../src/renderer/panel/chat-view.js');

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

test('the job buttons have their labels, and a project button is named after its folder', () => {
  assert.deepStrictEqual(['stop', 'open-folder', 'allow', 'deny'].map(buttonLabel), ['Stop', 'Open folder', 'Allow', 'No']);
  assert.strictEqual(buttonLabel('project:/Users/me/code/my-app'), 'my-app');
  assert.strictEqual(buttonLabel('project:C:\\Users\\me\\code\\site\\'), 'site');
  assert.strictEqual(buttonLabel('project:'), '');
});

test("a job is drawn with its project, its live lines, whether it is done, its summary and its buttons", () => {
  const running = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Reading src/login.js', 'Running: npm test'], done: false, text: '', buttons: ['stop'] });
  assert.deepStrictEqual(running, {
    id: 5, kind: 'job', say: '', text: '', notes: [], project: 'my-app', lines: ['Reading src/login.js', 'Running: npm test'], done: false,
    buttons: [{ button: 'stop', label: 'Stop', primary: false }],
  });
  const done = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: true, text: 'I fixed it.', buttons: ['open-folder', 'copy'] });
  assert.deepStrictEqual(done.buttons, [{ button: 'open-folder', label: 'Open folder', primary: true }, { button: 'copy', label: 'Copy', primary: false }]);
  assert.deepStrictEqual([done.done, done.text, done.lines], [true, 'I fixed it.', []]);
  // A job with nothing yet is still drawn: its project is its heading.
  assert.deepStrictEqual(itemParts({ id: 6, type: 'job', project: 'site', lines: [], done: false, text: '', buttons: [] }).project, 'site');
  // Odd fields read as nothing.
  const odd = itemParts({ id: 7, type: 'job', project: 7, lines: ['ok', 3, ''], done: 'yes', text: null, buttons: ['stop', 'nope'] });
  assert.deepStrictEqual([odd.project, odd.lines, odd.done, odd.text, odd.buttons.map((b) => b.button)], ['', ['ok'], false, '', ['stop']]);
});

test('the questions a job asks are drawn as questions, with Allow as the main button', () => {
  const parts = itemParts({ id: 8, type: 'question', text: 'Run npm test?', buttons: ['allow', 'deny'] });
  assert.deepStrictEqual(parts.buttons, [{ button: 'allow', label: 'Allow', primary: true }, { button: 'deny', label: 'No', primary: false }]);
  const which = itemParts({ id: 9, type: 'question', text: 'Which project?', buttons: ['project:/a/my-app', 'project:/b/site', 'not-now'] });
  assert.deepStrictEqual(which.buttons.map((b) => b.label), ['my-app', 'site', 'Not now']);
});

test('a screen reader hears a job as the buddy: what it is doing now, or what it did', () => {
  assert.strictEqual(speaker('job', 'Aarav'), 'Aarav:');
  const running = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Reading a.js', 'Editing a.js'], done: false, text: '', buttons: ['stop'] });
  assert.strictEqual(spokenLine(running, 'Aarav'), 'Aarav: Working in my-app. Editing a.js');
  const started = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: false, text: '', buttons: ['stop'] });
  assert.strictEqual(spokenLine(started, 'Aarav'), 'Aarav: Working in my-app.');
  const done = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Editing a.js'], done: true, text: 'I fixed it.', buttons: ['copy'] });
  assert.strictEqual(spokenLine(done, 'Aarav'), 'Aarav: Done in my-app. I fixed it.');
  const stopped = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: true, text: 'Stopped.', buttons: [] });
  assert.strictEqual(spokenLine(stopped, 'Aarav'), 'Aarav: Stopped.');
});

test('the example line for the empty chat names the project when there is one', () => {
  assert.strictEqual(exampleLine('my-app'), '“fix the login bug in my-app”');
  assert.strictEqual(exampleLine(''), '');
  assert.strictEqual(exampleLine(undefined), '');
});

test("a job's heading says where it works, and how it ended: done, stopped, or not finished (the red line after it says why)", () => {
  const job = (fields) => itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: false, text: '', buttons: [], ...fields });
  assert.strictEqual(jobHeading(job({})), '🔧 Working in my-app');
  assert.strictEqual(jobHeading(job({ done: true, text: 'I fixed it.' })), '✅ Done in my-app');
  assert.strictEqual(jobHeading(job({ done: true, text: 'Stopped.' })), '⏹ Stopped in my-app');
  assert.strictEqual(jobHeading(job({ done: true, text: '' })), '🔧 Was working in my-app');
  assert.strictEqual(spokenLine(job({ done: true, text: '' }), 'Aarav'), 'Aarav: Was working in my-app.');
});
