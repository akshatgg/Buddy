'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EarCore = require('../src/renderer/ear/ear-core');
const VoiceTiming = require('../src/renderer/panel/voice-timing');
const { YES_WORDS, NO_WORDS, heardWords, wantsServer } = require('../shared/voice-words');

const decisive = (verb) => ({ yes: [...YES_WORDS, verb], no: NO_WORDS });

test('isDecisive agrees with heardWords for every case Android is checked with', () => {
  const cases = require('../android/app/src/test/resources/voice-cases.json');
  assert.ok(cases.heard.length > 10);
  for (const c of cases.heard) assert.strictEqual(EarCore.isDecisive(c.text, decisive(c.verb)), heardWords(c.text, c.verb) !== null, c.text);
});

test('an answer turn: a decisive final result decides; a no wins', () => {
  const turn = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: false });
  assert.strictEqual(turn.result('[unk]'), null);
  assert.deepStrictEqual(turn.result('haan'), { text: 'haan' });
});

test('at the deadline: decisive, else the recording when the server must hear it and a voice was heard, else nothing', () => {
  const a = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: true });
  a.level(0.2);
  assert.deepStrictEqual(a.timeUp('[unk]'), { audio: true });
  const b = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: true });
  assert.deepStrictEqual(b.timeUp(''), { text: '' }, 'nothing said: nothing goes to the server');
  const c = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: false });
  c.level(0.2);
  assert.deepStrictEqual(c.timeUp('[unk]'), { text: '[unk]' });
  const d = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: true });
  d.level(0.2);
  assert.deepStrictEqual(d.timeUp('no'), { text: 'no' }, 'a decisive word is never sent to the server');
});

test('a quiet level is not a voice', () => {
  const t = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: true });
  t.level(0.001);
  t.level(NaN);
  assert.deepStrictEqual(t.timeUp(''), { text: '' });
});

test('samples are kept up to a limit, newest last', () => {
  const k = new EarCore.PcmKeeper(4);
  k.add(Int16Array.from([1, 2, 3])); k.add(Int16Array.from([4, 5]));
  assert.deepStrictEqual([...k.all()], [2, 3, 4, 5]);
  assert.deepStrictEqual([...k.from(3)], [4, 5], 'from the 4th sample ever kept');
  assert.deepStrictEqual([...k.from(0)], [2, 3, 4, 5]);
});

test('float samples become PCM16, clipped', () => {
  assert.deepStrictEqual([...EarCore.toPcm16(Float32Array.from([0, 0.5, -1, 2]))], [0, 16383, -32768, 32767]);
});

test('wantsServer agrees with voice-words.js for every case Android is checked with', () => {
  const cases = require('../android/app/src/test/resources/voice-cases.json');
  assert.ok(cases.wantsServer.length > 5);
  for (const c of cases.wantsServer) {
    assert.strictEqual(wantsServer(c.text, c.verb, c.missing), c.wants, c.text);
    const turn = EarCore.createAnswerTurn({ decisive: decisive(c.verb), needsServer: c.missing });
    turn.level(0.3);
    const r = turn.result(c.text);
    if (heardWords(c.text, c.verb) === null) assert.strictEqual(r, null, c.text);
    else assert.deepStrictEqual(r, c.wants ? { audio: true } : { text: c.text }, c.text);
  }
});

test('a yes next to a word not made out asks for the server only when a voice was heard; a no word decides it here', () => {
  const quiet = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: false });
  assert.deepStrictEqual(quiet.result('yes [unk]'), { text: 'yes [unk]' }, 'no voice, no server');
  const t = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: false });
  t.level(0.3);
  assert.deepStrictEqual(t.result('yes [unk]'), { audio: true });
  assert.deepStrictEqual(t.result('no [unk]'), { text: 'no [unk]' });
  assert.deepStrictEqual(t.result('yes'), { text: 'yes' });
  assert.deepStrictEqual(t.timeUp('haan [unk]'), { audio: true });
});

test('with a model an undecided answer ends on quiet after the voice, not at 8 s; 8 s of nothing is no with no server', () => {
  const timing = () => VoiceTiming.createVoiceTiming({ quietMs: 1500, nothingMs: 8000, maxMs: 10000 });
  const a = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: true, timing: timing() });
  let ended = null;
  for (let ms = 100; ms <= 1000 && !ended; ms += 100) if (a.feed(0.3, ms) !== 'listen') ended = ms;
  assert.strictEqual(ended, null, 'talking goes on');
  for (let ms = 1100; ms <= 6000 && !ended; ms += 100) if (a.feed(0, ms) !== 'listen') ended = ms;
  assert.ok(ended && ended <= 2600, `ended at ${ended}, long before 8000`);
  assert.deepStrictEqual(a.timeUp('[unk]'), { audio: true });
  const b = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: true, timing: timing() });
  let at = null;
  for (let ms = 100; ms <= 9000 && !at; ms += 100) if (b.feed(0, ms) !== 'listen') at = ms;
  assert.strictEqual(at, 8000);
  assert.deepStrictEqual(b.timeUp(''), { text: '' }, 'nothing said: no, and nothing to the server');
});
