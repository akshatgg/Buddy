'use strict';

// The hard rules of the spoken yes, pinned in one place (A10): Buddy never sends a message or places a call without
// a yes, and a spoken yes counts once, for the card asked, and only after the question. These use the fakes of
// actions.test.js (test/helpers/actions-setup.js): no real microphone, no real WhatsApp.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { reply, settle, setup, entries, chatOf } = require('./helpers/actions-setup');
const { heardAnswer } = require('../shared/voice-words');

const message = (fields = {}) => reply({ kind: 'message', to: 'Priya', text: 'hi', ...fields });
const calling = (fields = {}) => reply({ kind: 'call', to: 'Prince', how: 'whatsapp', ...fields });
const WA = { waFind: { chats: ['Priya Sharma'] }, waSend: { chat: 'Priya Sharma' } };
const waSends = (s) => entries(s.log, 'helper').filter((e) => e[1] === 'waSend');
const waCalls = (s) => entries(s.log, 'helper').filter((e) => e[1] === 'waCall');
const spokenOf = (s) => entries(s.log, 'say').map((e) => e[1]);
const stubborn = () => ({ answers: ['wait'], stubborn: true }); // stop() does not end hear(): a late answer really arrives

test('1. a yes heard for card A after card B was shown does nothing to A', async () => {
  const s = setup({ answers: [message(), message({ text: 'second' })], talk: stubborn(), replies: WA });
  await s.actions.open();
  await s.actions.send('message priya hi', { spoken: true });
  await settle();
  const a = chatOf(s).find((i) => i.buttons?.includes('send-message'));
  await s.actions.send('message priya second', { spoken: true }); // card B is shown and asked
  await settle();
  assert.strictEqual(entries(s.log, 'hear').length, 2, 'B is asked');
  s.talkBack.answerLate('yes'); // A's ear answers only now
  await settle();
  assert.strictEqual(waSends(s).length, 0);
  assert.deepStrictEqual(chatOf(s).find((i) => i.id === a.id).buttons, ['send-message', 'not-now'], 'A stays as it is');
});

test('2. a yes after the card was pressed, or after Not now, sends or calls nothing more', async () => {
  for (const [button, sends] of [['send-message', 1], ['not-now', 0]]) {
    const s = setup({ answers: [message()], talk: stubborn(), replies: WA });
    await s.actions.open();
    await s.actions.send('message priya hi', { spoken: true });
    await settle();
    await s.actions.act(2, button);
    s.talkBack.answerLate('yes');
    await settle();
    assert.strictEqual(waSends(s).length, sends, button);
    assert.strictEqual(waCalls(s).length, 0, button);
  }
  const s = setup({ answers: [calling()], talk: stubborn(), replies: { waFind: { chats: ['Prince Sharma'] }, waCall: {} } });
  await s.actions.open();
  await s.actions.send('whatsapp call prince', { spoken: true });
  await settle();
  await s.actions.act(2, 'not-now');
  s.talkBack.answerLate('yes');
  await settle();
  assert.strictEqual(waCalls(s).length, 0);
});

test('3. hear is never called before say(question) has returned', async () => {
  let finish;
  const s = setup({ answers: [message()], talk: { answers: ['yes'] }, replies: WA });
  s.talkBack.say = (text) => { s.log.push(['say', text]); return new Promise((resolve) => { finish = resolve; }); };
  await s.actions.open();
  await s.actions.send('message priya hi', { spoken: true });
  await settle();
  assert.deepStrictEqual(spokenOf(s), ["To Priya Sharma: hi. Send it?"]);
  assert.deepStrictEqual(entries(s.log, 'hear'), [], 'not heard while the question is still being said');
  finish();
  await settle();
  assert.deepStrictEqual(entries(s.log, 'hear'), [['hear', 'send']]);
  assert.ok(s.log.findIndex((e) => e[0] === 'hear') > s.log.findIndex((e) => e[0] === 'say'));
});

test('4. a typed chat after a spoken one does not speak', async () => {
  const s = setup({ answers: [reply({ text: 'ok' }), reply({ text: 'again' })], talk: {} });
  await s.actions.open();
  await s.actions.send('hello', { spoken: true });
  await settle();
  const before = entries(s.log, 'say').length;
  assert.ok(before > 0);
  await s.actions.send('and typed');
  await settle();
  assert.strictEqual(entries(s.log, 'say').length, before);
  assert.deepStrictEqual(entries(s.log, 'hear'), []);
});

test('5. a second step\'s message is spoken as a line and never asked as a card', async () => {
  const s = setup({
    replies: { captureSelection: (args) => ({ text: args.selectAll ? 'Tell Rahul the code is 4421' : '' }), waFind: { chats: ['Rahul'] } },
    answers: [reply({ kind: 'box' }), message({ to: 'Rahul', text: 'the code is 4421' })],
    talk: { answers: ['yes'] },
  });
  await s.actions.open();
  await s.actions.send('do what it says', { spoken: true });
  await settle();
  assert.ok(spokenOf(s).includes("Tell me who to message and what, and I'll do it."));
  assert.ok(!chatOf(s).some((i) => i.buttons?.includes('send-message')), 'no card');
  assert.deepStrictEqual(entries(s.log, 'hear'), []);
  assert.strictEqual(waSends(s).length, 0);
});

const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '../android/app/src/test/resources/voice-cases.json'), 'utf8')).heard;

test('6. every heard case whose words include a no word is no', () => {
  const withNo = cases.filter((c) => c.words === 'no');
  assert.ok(withNo.length >= 10);
  for (const c of withNo) assert.strictEqual(heardAnswer(c.text, c.verb), 'no', c.text);
});

test('7. [unk] anywhere in a heard answer is never yes', () => {
  const unk = cases.filter((c) => c.text.toLowerCase().includes('unk'));
  assert.ok(unk.length >= 5);
  for (const c of unk) assert.strictEqual(heardAnswer(c.text, c.verb), 'no', c.text);
  for (const said of ['yes [unk]', '[unk] yes', 'yes [unk] send', 'haan <unk>']) assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
});

test('8. the unlock wait is cancelled by Not now on that card, a new message and close: nothing is sent or called', async () => {
  for (const cancel of ['not-now', 'message', 'close']) {
    for (const kind of ['message', 'call']) {
      let release;
      const lock = { locked: () => true, unlocked: () => new Promise((resolve) => { release = resolve; }) };
      const s = setup({
        answers: [kind === 'call' ? calling() : message(), reply({ text: 'ok' })],
        talk: { answers: ['yes'] },
        replies: { ...WA, waFind: { chats: [kind === 'call' ? 'Prince Sharma' : 'Priya Sharma'] }, waCall: {} },
        lock,
      });
      await s.actions.open();
      await s.actions.send('go', { spoken: true });
      await settle();
      assert.ok(release, `${cancel} ${kind}: it waits for the unlock`);
      if (cancel === 'not-now') await s.actions.act(2, 'not-now');
      else if (cancel === 'message') await s.actions.send('hello');
      else await s.actions.dismiss();
      await settle();
      release(true);
      await settle();
      assert.strictEqual(waSends(s).length, 0, `${cancel} ${kind}`);
      assert.strictEqual(waCalls(s).length, 0, `${cancel} ${kind}`);
    }
  }
});

test('9. a spoken yes goes through the same press as the button: same helper commands, same card, then gone', async () => {
  const run = async (how) => {
    const s = setup({ answers: [message({ text: "I'm late" })], talk: how === 'spoken' ? { answers: ['yes'] } : stubborn(), replies: WA });
    await s.actions.open();
    await s.actions.send('message priya late', { spoken: true });
    await settle();
    if (how === 'button') await s.actions.act(2, 'send-message');
    await settle();
    await assert.rejects(s.actions.act(2, 'send-message'), /isn't there/); // once: the card has no button left
    return { sends: waSends(s), card: chatOf(s).find((i) => i.id === 2) };
  };
  const spoken = await run('spoken');
  const pressed = await run('button');
  assert.strictEqual(spoken.sends.length, 1);
  assert.deepStrictEqual(spoken.sends, pressed.sends);
  assert.deepStrictEqual(spoken.card, pressed.card);
});
