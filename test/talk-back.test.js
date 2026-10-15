'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTalkBack } = require('../src/main/talk-back');
const { answerGrammar, YES_WORDS, NO_WORDS } = require('../shared/voice-words');

function setup({ answers = [], ready = true, transcribe, missing = [] } = {}) {
  const log = [];
  const ear = {
    call: async (cmd, args) => {
      log.push([cmd, args]);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a ?? {};
    },
    stop: () => log.push(['stop']),
  };
  let ensures = 0;
  const model = { ready: () => ready, words: () => null, missing: () => new Set(missing), ensure: () => { ensures += 1; return Promise.resolve(); } };
  const sent = [];
  const tb = createTalkBack({ ear, model, transcribe: transcribe || (async (a, m) => { sent.push([a, m]); return 'yes'; }) });
  return { tb, log, sent, ensures: () => ensures };
}

test('say speaks and returns nothing', async () => {
  const { tb, log } = setup({ answers: [{}] });
  assert.strictEqual(await tb.say('Send it?'), undefined);
  assert.deepStrictEqual(log, [['say', { text: 'Send it?' }]]);
});

test('hear with the model ready: the grammar, no server, and the words decide', async () => {
  const { tb, log } = setup({ answers: [{ text: 'yes' }] });
  assert.strictEqual(await tb.hear('send'), 'yes');
  assert.deepStrictEqual(log[0], ['hear', {
    verb: 'send', grammar: answerGrammar('send', null).grammar, needsServer: false,
    decisive: { yes: [...YES_WORDS, 'send'], no: NO_WORDS },
  }]);
});

test('a word the model lacks is left out of the grammar and the server hears the answer too', async () => {
  const { tb, log } = setup({ answers: [{ audio: 'QUJD' }], missing: ['nahi'] });
  assert.strictEqual(await tb.hear('send'), 'yes');
  const args = log[0][1];
  assert.ok(!args.grammar.includes('nahi'));
  assert.ok(args.grammar.includes('yes') && args.grammar.includes('[unk]'));
  assert.strictEqual(args.needsServer, true);
});

test('a no word, or anything unclear, is no', async () => {
  assert.strictEqual(await setup({ answers: [{ text: 'no' }] }).tb.hear('send'), 'no');
  assert.strictEqual(await setup({ answers: [{ text: '[unk]' }] }).tb.hear('send'), 'no');
  assert.strictEqual(await setup({ answers: [{ text: '' }] }).tb.hear('call'), 'no');
});

test('a recording goes to transcribe as audio/wav and is judged the same way', async () => {
  const s = setup({ answers: [{ audio: 'QUJD' }] });
  assert.strictEqual(await s.tb.hear('send'), 'yes');
  assert.deepStrictEqual(s.sent, [['QUJD', 'audio/wav']]);
});

test('transcribe failing is no', async () => {
  const s = setup({ answers: [{ audio: 'QUJD' }], transcribe: async () => { throw new Error('offline'); } });
  assert.strictEqual(await s.tb.hear('send'), 'no');
});

test('the model missing: it is fetched once, no grammar, the server must hear', async () => {
  const s = setup({ answers: [{ text: 'haan' }], ready: false });
  assert.strictEqual(await s.tb.hear('send'), 'yes');
  assert.strictEqual(s.ensures(), 1);
  assert.strictEqual(s.log[0][1].grammar, null);
  assert.strictEqual(s.log[0][1].needsServer, true);
});

test('stopped, gone or an error is no', async () => {
  assert.strictEqual(await setup({ answers: [{ stopped: true }] }).tb.hear('send'), 'no');
  assert.strictEqual(await setup({ answers: [{ gone: true }] }).tb.hear('send'), 'no');
  assert.strictEqual(await setup({ answers: [new Error('x')] }).tb.hear('send'), 'no');
});

test('listen gives the trimmed words, or null', async () => {
  const s = setup({ answers: [{ audio: 'QUJD' }, {}, { audio: 'QUJD' }, new Error('x')], transcribe: async () => '  hello there ' });
  assert.strictEqual(await s.tb.listen(), 'hello there');
  assert.deepStrictEqual(s.log[0], ['listen', { quietMs: 1500, nothingMs: 8000, maxMs: 20000 }]);
  assert.strictEqual(await s.tb.listen(), null);
  const t = setup({ answers: [{ audio: 'QUJD' }], transcribe: async () => '   ' });
  assert.strictEqual(await t.tb.listen(), null);
  const u = setup({ answers: [new Error('x')] });
  assert.strictEqual(await u.tb.listen(), null);
});

test('listen with a failing transcribe is null', async () => {
  const s = setup({ answers: [{ audio: 'QUJD' }], transcribe: async () => { throw new Error('x'); } });
  assert.strictEqual(await s.tb.listen(), null);
});

test('stop stops the ear', () => {
  const s = setup();
  s.tb.stop();
  assert.deepStrictEqual(s.log, [['stop']]);
});
