// Buddy on iPhone: the chat without the page (web/public/app/chat-core.js).

import test from 'node:test';
import assert from 'node:assert';
import {
  createChat, chatRequest, historyBefore, answerItem, canSend, failureText,
  EMPTY, TOO_LONG, CANT_SEE, CANT_SEND, NO_ANSWER, FREE_OFF, FAILED, FORGOT,
} from '../web/public/app/chat-core.js';
import { ApiError } from '../web/public/app/api.js';
import { createMemory } from '../web/public/app/memory.js';
import { createStore } from '../web/public/app/store.js';

/** parseChat's shape, with `fields` over a written answer. */
const chat = (fields = {}) => ({ chat: { kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...fields } });

/** A chat whose server answers `replies` in turn (an Error is thrown instead). */
function setup(replies = [], { name = 'Akshat' } = {}) {
  const map = new Map();
  let n = 0;
  const memory = createMemory({ store: createStore({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) }), newId: () => `f${(n += 1)}` });
  const asked = [];
  const moods = [];
  let changes = 0;
  const c = createChat({
    ask: async (body) => {
      asked.push(structuredClone(body));
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    memory,
    userName: () => name,
    onMood: (m) => moods.push(m),
    onChange: () => {
      changes += 1;
    },
  });
  return { c, memory, asked, moods, changes: () => changes };
}

const shown = (c) => c.state.items.map(({ type, say, text, buttons }) => ({ type, say, text, buttons }));

test("a message goes as the Mac panel's first step: message, chat so far, facts, first name, step 1, and nothing from other apps", async () => {
  const s = setup([chat({ kind: 'write', say: 'Here you go!', text: 'Dear Sir, ...' }), chat({ kind: 'write', text: 'Short.' })]);
  s.memory.add('Your boss is Mr. Sharma.', { source: 'settings' });
  assert.deepStrictEqual(await s.c.send('  boss ko mail likho  '), { ok: true });
  await s.c.send('make it shorter');
  assert.deepStrictEqual(s.asked[0], {
    action: 'chat', message: 'boss ko mail likho', history: [], facts: ['Your boss is Mr. Sharma.'], step: 1, userName: 'Akshat',
  });
  assert.deepStrictEqual(s.asked[1].history, [{ from: 'you', text: 'boss ko mail likho' }, { from: 'buddy', text: 'Here you go!\n\nDear Sir, ...' }]);
  for (const body of s.asked) {
    for (const field of ['box', 'image', 'selection', 'appName', 'projects']) assert.ok(!(field in body), `no ${field}`);
  }
});

test('an answer with text gets Copy and Share; the buddy thinks, then is happy', async () => {
  const s = setup([chat({ kind: 'fix', say: 'Fixed!', text: 'I am going.', notes: ['"go" should be "going".'] })]);
  await s.c.send('i am go');
  assert.deepStrictEqual(shown(s.c), [
    { type: 'you', say: '', text: 'i am go', buttons: [] },
    { type: 'buddy', say: 'Fixed!', text: 'I am going.', buttons: ['copy', 'share'] },
  ]);
  assert.deepStrictEqual(s.c.state.items[1].notes, ['"go" should be "going".']);
  assert.deepStrictEqual(s.moods, ['thinking', 'happy']);
  assert.strictEqual(s.c.state.busy, false);
});

test('an answer that wants the text box or the screen, or to send, says what the phone cannot do', () => {
  assert.strictEqual(answerItem(chat({ kind: 'box' }).chat).say, CANT_SEE);
  assert.strictEqual(answerItem(chat({ kind: 'screen' }).chat).say, CANT_SEE);
  assert.deepStrictEqual(answerItem(chat({ kind: 'send', say: 'Sending!' }).chat), { type: 'buddy', say: CANT_SEND, text: '', notes: [], buttons: [] });
  assert.strictEqual(answerItem(chat({ kind: 'answer' }).chat).say, NO_ANSWER);
  assert.deepStrictEqual(answerItem(chat({ kind: 'answer', text: 'Kal = tomorrow.' }).chat).buttons, ['copy', 'share']);
  assert.deepStrictEqual(answerItem(chat({ kind: 'code', say: 'On it!', text: 'Fix the bug.' }).chat).text, 'Fix the bug.');
});

test('a box answer leaves the buddy idle, not happy', async () => {
  const s = setup([chat({ kind: 'box' })]);
  await s.c.send('fix my English');
  assert.deepStrictEqual(s.moods, ['thinking', 'idle']);
  assert.strictEqual(s.c.state.items[1].say, CANT_SEE);
});

test('facts the answer remembers are kept, each shown with Undo, which forgets it', async () => {
  const s = setup([chat({ kind: 'answer', text: 'Noted.', remember: ['You work at Infosys.', 'My password is x'] })]);
  await s.c.send('I work at Infosys');
  assert.deepStrictEqual(s.memory.facts(), ['You work at Infosys.'], 'a secret is never kept');
  const event = s.c.state.items.find((i) => i.type === 'event');
  assert.deepStrictEqual([event.text, event.buttons], ['📝 Remembered: You work at Infosys.', ['undo']]);
  s.c.forget(event.id);
  assert.deepStrictEqual(s.memory.facts(), []);
  assert.deepStrictEqual([event.text, event.buttons], [FORGOT, []]);
});

test('learning off: nothing is remembered from a chat', async () => {
  const s = setup([chat({ kind: 'answer', text: 'Ok.', remember: ['You live in Pune.'] })]);
  s.memory.setLearning(false);
  await s.c.send('I live in Pune');
  assert.deepStrictEqual(s.memory.facts(), []);
  assert.ok(!s.c.state.items.some((i) => i.type === 'event'));
});

test('an empty or too long message is not sent, and the box keeps it', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.c.send('   '), { ok: false, error: EMPTY });
  assert.deepStrictEqual(await s.c.send('x'.repeat(1001)), { ok: false, error: TOO_LONG });
  assert.strictEqual(s.asked.length, 0);
  assert.strictEqual(s.c.state.items.length, 0);
  assert.strictEqual(canSend({ busy: false, text: ' hi ' }), true);
  assert.strictEqual(canSend({ busy: true, text: 'hi' }), false);
  assert.strictEqual(canSend({ busy: false, text: '  ' }), false);
});

test('one message at a time', async () => {
  let release;
  const s = setup([new Promise((resolve) => { release = resolve; })]);
  const first = s.c.send('one');
  assert.strictEqual(s.c.state.busy, true);
  assert.deepStrictEqual(await s.c.send('two'), { ok: false, error: '' });
  release(chat({ text: 'One.' }));
  await first;
  assert.strictEqual(s.asked.length, 1);
});

test('a failure shows in the chat with Try again, the buddy is sad, and Try again asks once more', async () => {
  const s = setup([new ApiError('network', 'No internet.'), chat({ kind: 'answer', text: 'Hi!' })]);
  await s.c.send('hello');
  assert.deepStrictEqual(shown(s.c)[1], { type: 'error', say: '', text: 'No internet.', buttons: ['retry'] });
  assert.deepStrictEqual(s.moods, ['thinking', 'sad']);
  await s.c.retry(s.c.state.items[1].id);
  assert.deepStrictEqual(shown(s.c).map((i) => i.type), ['you', 'buddy']);
  assert.strictEqual(s.asked[1].message, 'hello');
  assert.deepStrictEqual(s.asked[1].history, [], 'the message is not its own history');
});

test("the server's words for free mode's limits are shown; free off and unknown failures get the phone's own", () => {
  assert.strictEqual(failureText(new ApiError('free_limit', "You've used today's 30 free requests.")), "You've used today's 30 free requests.");
  assert.strictEqual(failureText(new ApiError('free_off', 'Free AI is off. Add your own key in Settings.')), FREE_OFF);
  assert.strictEqual(failureText(new Error('boom')), FAILED);
  assert.strictEqual(failureText(null), FAILED);
});

test('no Try again for a message the server refused, or a sign-in that ended', async () => {
  const s = setup([new ApiError('bad_request', 'That is too long.'), new ApiError('unauthenticated', 'Sign in again.')]);
  await s.c.send('a');
  await s.c.send('b');
  assert.deepStrictEqual(s.c.state.items.filter((i) => i.type === 'error').map((i) => i.buttons), [[], []]);
});

test('an answer for a chat that was cleared is dropped', async () => {
  let release;
  const s = setup([new Promise((resolve) => { release = resolve; })]);
  const sent = s.c.send('hi');
  s.c.clear();
  release(chat({ text: 'Late.' }));
  await sent;
  assert.deepStrictEqual(s.c.state.items, []);
  assert.strictEqual(s.c.state.busy, false);
});

test('the chat so far is the last 6 messages, the buddy\'s line and text together; a reply without its reading is a written one', async () => {
  const items = [];
  for (let i = 0; i < 5; i += 1) items.push({ type: 'you', text: `q${i}` }, { type: 'buddy', say: `s${i}`, text: '' }, { type: 'event', text: 'x' });
  const you = { type: 'you', text: 'now' };
  items.push(you);
  const history = historyBefore(items, you);
  assert.strictEqual(history.length, 6);
  assert.deepStrictEqual(history.at(-1), { from: 'buddy', text: 's4' });
  assert.deepStrictEqual(chatRequest({ items: [you], you, facts: [], userName: '  ' }), { action: 'chat', message: 'now', history: [], facts: [], step: 1 });

  const s = setup([{ text: 'Plain words.' }]);
  await s.c.send('hi');
  assert.deepStrictEqual(shown(s.c)[1], { type: 'buddy', say: '', text: 'Plain words.', buttons: ['copy', 'share'] });
});
