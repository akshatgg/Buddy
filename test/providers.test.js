'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fakeFetch, offlineFetch } = require('./helpers/fake-fetch');
const { PROVIDERS, PROVIDER_IDS, getProvider } = require('../shared/providers');

const ASK = { apiKey: 'k-123', system: 'SYS', user: 'USER', image: null, maxTokens: 1024 };

test('the four providers are registered in order', () => {
  assert.deepStrictEqual(PROVIDER_IDS, ['anthropic', 'openai', 'gemini', 'groq']);
  for (const id of PROVIDER_IDS) {
    const p = PROVIDERS[id];
    assert.strictEqual(p.id, id);
    assert.ok(p.label && p.keyUrl.startsWith('https://') && p.fallbackModels.length);
  }
  assert.throws(() => getProvider('nope'), { code: 'bad_request' });
});

test('claude: builds a Messages request and reads text and usage', async () => {
  const fetchImpl = fakeFetch(200, {
    model: 'claude-haiku-4-5-20251001',
    content: [{ type: 'text', text: ' Hello. ' }],
    usage: { input_tokens: 11, output_tokens: 3 },
  });
  const out = await getProvider('anthropic').complete({ ...ASK, model: 'claude-haiku-4-5-20251001', fetchImpl });
  const call = fetchImpl.calls[0];
  assert.strictEqual(call.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(call.init.headers['x-api-key'], 'k-123');
  assert.strictEqual(call.init.headers['anthropic-version'], '2023-06-01');
  assert.deepStrictEqual(call.body, {
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    system: 'SYS',
    messages: [{ role: 'user', content: 'USER' }],
  });
  assert.deepStrictEqual(out, {
    text: 'Hello.',
    model: 'claude-haiku-4-5-20251001',
    usage: { inputTokens: 11, outputTokens: 3 },
  });
});

test('claude: a screenshot goes first as a base64 JPEG block', async () => {
  const fetchImpl = fakeFetch(200, { content: [{ type: 'text', text: 'ok' }], usage: {} });
  await getProvider('anthropic').complete({ ...ASK, image: 'IMG', model: 'm', fetchImpl });
  assert.deepStrictEqual(fetchImpl.calls[0].body.messages[0].content, [
    { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: 'IMG' } },
    { type: 'text', text: 'USER' },
  ]);
});

test('openai: builds a Chat Completions request with a data-URL image', async () => {
  const fetchImpl = fakeFetch(200, {
    model: 'gpt-4.1-mini',
    choices: [{ message: { content: 'Hi!' } }],
    usage: { prompt_tokens: 20, completion_tokens: 2 },
  });
  const out = await getProvider('openai').complete({ ...ASK, image: 'IMG', model: 'gpt-4.1-mini', fetchImpl });
  const call = fetchImpl.calls[0];
  assert.strictEqual(call.url, 'https://api.openai.com/v1/chat/completions');
  assert.strictEqual(call.init.headers.Authorization, 'Bearer k-123');
  assert.strictEqual(call.body.max_completion_tokens, 1024);
  assert.strictEqual(call.body.reasoning_effort, undefined);
  assert.deepStrictEqual(call.body.messages, [
    { role: 'system', content: 'SYS' },
    {
      role: 'user',
      content: [
        { type: 'text', text: 'USER' },
        { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,IMG' } },
      ],
    },
  ]);
  assert.deepStrictEqual(out.usage, { inputTokens: 20, outputTokens: 2 });
});

test('openai: reasoning models are asked to think briefly', async () => {
  const fetchImpl = fakeFetch(200, { choices: [{ message: { content: 'x' } }], usage: {} });
  await getProvider('openai').complete({ ...ASK, model: 'gpt-5-mini', fetchImpl });
  assert.strictEqual(fetchImpl.calls[0].body.reasoning_effort, 'low');
});

test('groq: same shape, Groq base URL', async () => {
  const fetchImpl = fakeFetch(200, { choices: [{ message: { content: 'x' } }], usage: {} });
  await getProvider('groq').complete({ ...ASK, model: 'llama-3.3-70b-versatile', fetchImpl });
  assert.strictEqual(fetchImpl.calls[0].url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.strictEqual(fetchImpl.calls[0].body.reasoning_effort, undefined);
});

test('gemini: builds generateContent, skips thoughts, counts thoughts as output', async () => {
  const fetchImpl = fakeFetch(200, {
    modelVersion: 'gemini-flash-latest',
    candidates: [{ content: { parts: [{ text: 'thinking...', thought: true }, { text: 'Answer' }] } }],
    usageMetadata: { promptTokenCount: 30, candidatesTokenCount: 5, thoughtsTokenCount: 7 },
  });
  const out = await getProvider('gemini').complete({ ...ASK, image: 'IMG', model: 'gemini-flash-latest', fetchImpl });
  const call = fetchImpl.calls[0];
  assert.strictEqual(call.url, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent');
  assert.strictEqual(call.init.headers['x-goog-api-key'], 'k-123');
  assert.deepStrictEqual(call.body.systemInstruction, { parts: [{ text: 'SYS' }] });
  assert.deepStrictEqual(call.body.contents[0].parts, [
    { text: 'USER' },
    { inline_data: { mime_type: 'image/jpeg', data: 'IMG' } },
  ]);
  assert.strictEqual(call.body.generationConfig.maxOutputTokens, 4096);
  assert.deepStrictEqual(out, { text: 'Answer', model: 'gemini-flash-latest', usage: { inputTokens: 30, outputTokens: 12 } });
});

test('errors are turned into codes with messages for the user', async (t) => {
  const cases = [
    [401, { error: { message: 'invalid x-api-key' } }, 'bad_key'],
    [403, { error: { message: 'forbidden' } }, 'bad_key'],
    [400, { error: { message: 'Your credit balance is too low to access the Anthropic API.' } }, 'no_credit'],
    [429, { error: { message: 'You exceeded your current quota', code: 'insufficient_quota' } }, 'no_credit'],
    [429, { error: { message: 'Rate limit reached' } }, 'rate_limited'],
    [404, { error: { message: 'model: claude-x not found' } }, 'bad_model'],
    [500, 'boom', 'upstream'],
  ];
  for (const [status, body, code] of cases) {
    await t.test(`${status} -> ${code}`, async () => {
      await assert.rejects(
        getProvider('anthropic').complete({ ...ASK, model: 'm', fetchImpl: fakeFetch(status, body) }),
        (err) => err.code === code && typeof err.message === 'string' && err.message.length > 0,
      );
    });
  }
});

test('no network becomes a network error', async () => {
  await assert.rejects(
    getProvider('openai').complete({ ...ASK, model: 'm', fetchImpl: offlineFetch() }),
    { code: 'network', message: "Couldn't reach OpenAI. Check your internet." },
  );
});

test('an empty answer is an error, not an empty paste', async () => {
  const fetchImpl = fakeFetch(200, { content: [], usage: {} });
  await assert.rejects(getProvider('anthropic').complete({ ...ASK, model: 'm', fetchImpl }), { code: 'empty' });
});

test('listModels: OpenAI keeps chat models only, newest-looking first', async () => {
  const fetchImpl = fakeFetch(200, {
    data: [{ id: 'gpt-4.1' }, { id: 'text-embedding-3-small' }, { id: 'gpt-4.1-mini' }, { id: 'whisper-1' }, { id: 'gpt-5' }],
  });
  assert.deepStrictEqual(await getProvider('openai').listModels({ apiKey: 'k', fetchImpl }), ['gpt-5', 'gpt-4.1-mini', 'gpt-4.1']);
});

test('listModels: Gemini strips the models/ prefix and keeps text models', async () => {
  const fetchImpl = fakeFetch(200, {
    models: [
      { name: 'models/gemini-flash-latest', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemini-2.5-flash-preview-tts', supportedGenerationMethods: ['generateContent'] },
    ],
  });
  assert.deepStrictEqual(await getProvider('gemini').listModels({ apiKey: 'k', fetchImpl }), ['gemini-flash-latest']);
});

test('listModels: Claude returns the ids as given', async () => {
  const fetchImpl = fakeFetch(200, { data: [{ id: 'claude-sonnet-5-5' }, { id: 'claude-haiku-4-5-20251001' }] });
  assert.deepStrictEqual(
    await getProvider('anthropic').listModels({ apiKey: 'k', fetchImpl }),
    ['claude-sonnet-5-5', 'claude-haiku-4-5-20251001'],
  );
  assert.strictEqual(fetchImpl.calls[0].url, 'https://api.anthropic.com/v1/models?limit=100');
});

test('vision support per provider', () => {
  assert.strictEqual(getProvider('anthropic').isVisionModel('claude-haiku-4-5-20251001'), true);
  assert.strictEqual(getProvider('openai').isVisionModel('gpt-4.1-mini'), true);
  assert.strictEqual(getProvider('openai').isVisionModel('o3-mini'), false);
  assert.strictEqual(getProvider('groq').isVisionModel('llama-3.3-70b-versatile'), false);
  assert.strictEqual(getProvider('groq').isVisionModel('meta-llama/llama-4-scout-17b-16e-instruct'), true);
  assert.strictEqual(getProvider('gemini').isVisionModel('gemini-flash-latest'), true);
});
