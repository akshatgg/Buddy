'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { tagNames, findTag, splitAtTag, cleanAnswer } = require('../shared/tag');
const { buildPrompt } = require('../shared/prompts');
const { createTagWatch, KEPT_TYPING } = require('../src/main/tag');

const AARAV = tagNames('Aarav');

// ---- the rules (shared/tag.js) ----

test("the tag's names: buddy, and the buddy's own name when it is one word", () => {
  assert.deepStrictEqual(tagNames('Aarav'), ['buddy', 'aarav']);
  assert.deepStrictEqual(tagNames('Buddy'), ['buddy']);
  assert.deepStrictEqual(tagNames('Mr Bean'), ['buddy']);
  assert.deepStrictEqual(tagNames(''), ['buddy']);
  assert.deepStrictEqual(tagNames(undefined), ['buddy']);
  assert.deepStrictEqual(tagNames('आरव'), ['buddy', 'आरव']);
});

test('the last tag is found, with what came after it on its line; not inside a word or an email address', () => {
  assert.deepStrictEqual(findTag('i not coming @buddy', AARAV), { start: 13, end: 19, instruction: '' });
  assert.deepStrictEqual(findTag('hello @Buddy  make it formal  ', AARAV).instruction, 'make it formal');
  assert.strictEqual(findTag('kal chutti @aarav polite', AARAV).instruction, 'polite');
  assert.strictEqual(findTag('a @buddy one\nb @buddy two', AARAV).instruction, 'two', 'the last one');
  for (const text of ['mail me at sam@buddy.com', 'see @buddyx', 'x@@buddy', 'no tag here', '', null]) {
    assert.strictEqual(findTag(text, AARAV), null, String(text));
  }
  assert.ok(findTag('(@buddy)', AARAV), 'after a bracket');
  assert.strictEqual(findTag('done @aarav fix', ['buddy']), null, "another buddy's name is not a tag");
});

test('the text is cut around the tag: the paragraph it ends is rewritten, the rest stays', () => {
  assert.deepStrictEqual(splitAtTag('i not coming tomorow @buddy', AARAV), { prefix: '', target: 'i not coming tomorow', instruction: '', suffix: '' });
  assert.deepStrictEqual(splitAtTag('Thanks.\ncan u send it @buddy polite\nBye', AARAV),
    { prefix: 'Thanks.\n', target: 'can u send it', instruction: 'polite', suffix: '\nBye' });
  assert.deepStrictEqual(splitAtTag('one\ntwo @buddy all formal', AARAV), { prefix: '', target: 'one\ntwo', instruction: 'formal', suffix: '' });
  assert.deepStrictEqual(splitAtTag('@buddy fix', AARAV), null, 'nothing before it');
  assert.deepStrictEqual(splitAtTag('hello\n   @buddy', AARAV), null, 'nothing in its paragraph');
  assert.strictEqual(splitAtTag('no tag', AARAV), null);
});

test("the AI's answer is taken as the text: no fence, no quotes around it", () => {
  assert.strictEqual(cleanAnswer('  Hello there.  '), 'Hello there.');
  assert.strictEqual(cleanAnswer('```\nHello there.\n```'), 'Hello there.');
  assert.strictEqual(cleanAnswer('"Hello there."'), 'Hello there.');
  assert.strictEqual(cleanAnswer('“Hello there.”'), 'Hello there.');
  assert.strictEqual(cleanAnswer('He said "hi" and "bye"'), 'He said "hi" and "bye"', 'quotes inside stay');
  assert.strictEqual(cleanAnswer(undefined), '');
});

test("the tag's request: the instruction (fix when none), then their text; nothing to rewrite is refused", () => {
  const p = buildPrompt('tag', { text: 'i not coming', instruction: '' });
  assert.strictEqual(p.user, 'Instruction: fix\n\nTheir text:\n"""\ni not coming\n"""');
  assert.match(p.system, /Return ONLY the finished text/);
  assert.match(buildPrompt('tag', { text: 'x', instruction: 'formal' }).user, /^Instruction: formal\n/);
  assert.throws(() => buildPrompt('tag', { text: '  ' }), { code: 'bad_request', message: 'Write something before @buddy first.' });
  assert.throws(() => buildPrompt('tag', { text: 'x'.repeat(8001) }), { code: 'bad_request' });
});

// ---- the Mac and Windows side (src/main/tag.js) ----

/**
 * createTagWatch with a fake helper: `box` is what is in the app's text box and `selected` what is selected in it;
 * the commands work on them as the real helper does on the app. `typeMeanwhile` is typed while the AI answers.
 */
function setup({ box = '', answer = 'Hi sir, I am not coming tomorrow.', aiFails = null, typeMeanwhile = '', stored = {}, helperFails = null } = {}) {
  const saved = { tagOn: true, buddyName: 'Aarav', ...stored };
  const listeners = {};
  const calls = [];
  const app = { box, selected: '' };
  const helper = {
    on: (event, fn) => { listeners[event] = fn; },
    async call(cmd, args) {
      calls.push([cmd, args]);
      if (helperFails && cmd === helperFails.cmd) throw helperFails.err;
      if (cmd === 'captureSelection') {
        if (args.selectAll) return { text: app.box }; // the helper lets go of a select-all at once
        if (args.select === 'paragraph') app.selected = app.box.slice(app.box.lastIndexOf('\n') + 1);
        return { text: app.selected };
      }
      if (cmd === 'paste') {
        if (args.selectAll) app.box = args.text;
        else app.box = app.box.slice(0, app.box.length - app.selected.length) + args.text;
        app.selected = '';
      }
      if (cmd === 'press' && args.key === 'right') app.selected = '';
      return {};
    },
  };
  const asked = [];
  const ai = {
    async ask(action, input) {
      asked.push([action, input]);
      if (typeMeanwhile) {
        app.box += typeMeanwhile; // typing replaces the selection, here: it is gone
        app.selected = '';
      }
      if (aiFails) throw aiFails;
      return { text: answer };
    },
  };
  const ui = { moods: [], bubbles: [], mood(m) { this.moods.push(m); }, bubble(b) { this.bubbles.push(b); } };
  const timers = [];
  const watch = createTagWatch({
    helper, ai, ui, platform: 'darwin',
    store: { get: (k) => saved[k] },
    later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    cancel: () => {},
  });
  return { watch, app, calls, asked, ui, listeners, saved, timers };
}

test('a tag and a pause: the paragraph is read, rewritten and put back over itself', async () => {
  const s = setup({ box: 'Dear team,\ni not coming tomorow @buddy' });
  await s.watch.onTag(42);
  assert.deepStrictEqual(s.calls[0], ['captureSelection', { pid: 42, select: 'paragraph' }]);
  assert.deepStrictEqual(s.asked, [['tag', { text: 'i not coming tomorow', instruction: '' }]]);
  assert.strictEqual(s.app.box, 'Dear team,\nHi sir, I am not coming tomorrow.', 'only that paragraph changed');
  assert.deepStrictEqual(s.ui.moods, ['thinking', 'celebrate']);
  assert.deepStrictEqual(s.ui.bubbles, ['Fixing it…', 'Fixed ✅ ⌘Z undoes it']);
});

test('"@buddy all": the whole box is rewritten', async () => {
  const s = setup({ box: 'one line\nand another @aarav all formal', answer: 'One line, and another.' });
  await s.watch.onTag(42);
  assert.deepStrictEqual(s.asked, [['tag', { text: 'one line\nand another', instruction: 'formal' }]]);
  assert.strictEqual(s.app.box, 'One line, and another.');
  assert.ok(s.calls.some(([cmd, args]) => cmd === 'paste' && args.selectAll === true));
});

test('kept typing while the AI answered: nothing is replaced, and Buddy says why', async () => {
  const s = setup({ box: 'i not coming @buddy', typeMeanwhile: ' and also' });
  await s.watch.onTag(42);
  assert.strictEqual(s.app.box, 'i not coming @buddy and also');
  assert.ok(!s.calls.some(([cmd]) => cmd === 'paste'));
  assert.strictEqual(s.ui.bubbles.at(-1), KEPT_TYPING);
});

test('no tag in the paragraph (it was in another one): the selection is let go of, nothing asked', async () => {
  const s = setup({ box: 'x @buddy\nnew line' });
  await s.watch.onTag(42);
  assert.deepStrictEqual(s.asked, []);
  assert.deepStrictEqual(s.calls.at(-1), ['press', { pid: 42, key: 'right' }]);
  assert.deepStrictEqual(s.ui.bubbles, []);
});

test("the AI's refusal, or a password field, is said in Buddy's bubble, and the buddy is sad", async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({ box: 'i not coming @buddy', aiFails: new BuddyError('no_key', 'Add an API key in Settings first.') });
  await s.watch.onTag(42);
  assert.strictEqual(s.app.box, 'i not coming @buddy');
  assert.deepStrictEqual(s.ui.moods, ['thinking', 'sad']);
  assert.strictEqual(s.ui.bubbles.at(-1), 'Add an API key in Settings first.');

  const secure = setup({ box: 'x @buddy', helperFails: { cmd: 'captureSelection', err: new BuddyError('secure_field', "I don't read password fields.") } });
  await secure.watch.onTag(42);
  assert.strictEqual(secure.ui.bubbles.at(-1), "I don't read password fields.");
});

test('turned off in Settings: a tag does nothing', async () => {
  const s = setup({ box: 'i not coming @buddy', stored: { tagOn: false } });
  await s.watch.onTag(42);
  assert.deepStrictEqual(s.calls, []);
});

test('the helper watches for the names while it is wanted, is told again when they change, and asked again later without Accessibility', async () => {
  const s = setup();
  await s.watch.refresh();
  assert.deepStrictEqual(s.calls, [['watchTyping', { on: true, names: ['buddy', 'aarav'] }]]);
  await s.watch.refresh();
  assert.strictEqual(s.calls.length, 1, 'nothing changed: not told again');
  s.saved.buddyName = 'Mira';
  await s.watch.refresh();
  assert.deepStrictEqual(s.calls.at(-1), ['watchTyping', { on: true, names: ['buddy', 'mira'] }]);
  s.saved.tagOn = false;
  await s.watch.refresh();
  assert.deepStrictEqual(s.calls.at(-1), ['watchTyping', { on: false }]);

  const denied = setup({ helperFails: { cmd: 'watchTyping', err: new BuddyError('no_accessibility', 'no') } });
  await denied.watch.refresh();
  assert.strictEqual(denied.timers.length, 1);
  assert.strictEqual(denied.timers[0].ms, 10_000);
});

test("the helper's tag event starts it; a restarted helper is told again", async () => {
  const s = setup({ box: 'i not coming @buddy' });
  s.listeners.tag({ event: 'tag', pid: 7 });
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(s.calls[0], ['captureSelection', { pid: 7, select: 'paragraph' }]);
  s.calls.length = 0;
  s.listeners.started();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(s.calls, [['watchTyping', { on: true, names: ['buddy', 'aarav'] }]]);
});
