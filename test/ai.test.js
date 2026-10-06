'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createAi, MAX_TOKENS } = require('../src/main/ai');

function setup({ key = 'k-1', model, vision = true, answer = 'Fixed text', live = ['m-live'] } = {}) {
  const calls = [];
  const provider = {
    fallbackModels: ['m-default', 'm-other'],
    isVisionModel: () => vision,
    async complete(opts) {
      calls.push(opts);
      return { text: answer, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels() {
      return live;
    },
  };
  const settings = { provider: 'openai', models: model ? { openai: model } : {} };
  const ai = createAi({
    store: { get: (k) => settings[k] },
    secrets: { get: (p) => (p === 'openai' ? key : null) },
    providers: { getProvider: () => provider },
  });
  return { ai, calls };
}

test('ask calls the chosen provider with the key, the saved model and the prompt', async () => {
  const { ai, calls } = setup({ model: 'gpt-4.1' });
  const out = await ai.ask('fix', { text: 'me go home' });
  assert.strictEqual(out.text, 'Fixed text');
  assert.strictEqual(calls[0].apiKey, 'k-1');
  assert.strictEqual(calls[0].model, 'gpt-4.1');
  assert.strictEqual(calls[0].user, 'me go home');
  assert.strictEqual(calls[0].maxTokens, MAX_TOKENS);
  assert.strictEqual(MAX_TOKENS, 1024);
});

test('without a saved model, the first fallback model is used', async () => {
  const { ai, calls } = setup();
  await ai.ask('write', { instruction: 'leave mail' });
  assert.strictEqual(calls[0].model, 'm-default');
});

test('no key: asks the user to add one', async () => {
  const { ai } = setup({ key: null });
  await assert.rejects(ai.ask('fix', { text: 'x' }), { code: 'no_key', message: 'Add your API key in Settings first.' });
});

test('a screenshot on a model that cannot see is refused before calling', async () => {
  const { ai, calls } = setup({ vision: false });
  await assert.rejects(ai.ask('check', { image: 'IMG' }), { code: 'no_vision' });
  assert.strictEqual(calls.length, 0);
});

test('check answers are parsed', async () => {
  const { ai } = setup({ answer: '{"verdict":"good","problems":[],"corrected":null}' });
  const out = await ai.ask('check', { image: 'IMG' });
  assert.deepStrictEqual(out.check, { verdict: 'good', problems: [], corrected: null });
});

test('bad input is refused before calling', async () => {
  const { ai, calls } = setup();
  await assert.rejects(ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  assert.strictEqual(calls.length, 0);
});

test('listModels: the live list with a key, the fallback list without', async () => {
  assert.deepStrictEqual(await setup().ai.listModels('openai'), ['m-live']);
  assert.deepStrictEqual(await setup({ key: null }).ai.listModels('openai'), ['m-default', 'm-other']);
  assert.deepStrictEqual(await setup({ live: [] }).ai.listModels('openai'), ['m-default', 'm-other']);
});
