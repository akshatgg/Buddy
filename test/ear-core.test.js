'use strict';

const test = require('node:test');
const assert = require('node:assert');
const EarCore = require('../src/renderer/ear/ear-core');
const { YES_WORDS, NO_WORDS, heardWords } = require('../shared/voice-words');

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
