// Buddy on iPhone: the person's own AI key (web/public/app/own-ai.js), kept on the phone and used straight from it.

import test from 'node:test';
import assert from 'node:assert';
import { createOwnAi, withBrowserAccess, BROWSER_ACCESS, PASTE_FIRST, NOT_A_KEY, NO_KEY } from '../web/public/app/own-ai.js';
import { createStore } from '../web/public/app/store.js';
import { MAX_TOKENS } from '../web/public/app/shared/prompts.js';

/** A response as fetch gives it, with JSON `body`. */
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** An own AI over a fake localStorage (`map`), whose fetch answers `replies` in turn; `calls` are the fetches. */
function setup(replies = [], kept = null) {
  const map = new Map();
  if (kept) map.set('buddy.ai', JSON.stringify(kept));
  const store = createStore({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) });
  const calls = [];
  const own = createOwnAi({
    store,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
      return replies.shift();
    },
  });
  return { own, calls, kept: () => JSON.parse(map.get('buddy.ai') ?? 'null') };
}

test('nothing kept: Claude is picked, with no key and its first model', () => {
  const { own } = setup();
  assert.strictEqual(own.provider(), 'anthropic');
  assert.strictEqual(own.hasKey(), false);
  assert.strictEqual(own.keyEnd(), '');
  assert.strictEqual(own.model(), 'claude-haiku-4-5-20251001');
});

test('what is kept that is not right is left out: an unknown AI, keys that are not text', () => {
  const { own } = setup([], { provider: 'constructor', keys: { anthropic: 42, groq: 'gsk_abcd1234' }, models: [] });
  assert.strictEqual(own.provider(), 'anthropic');
  assert.strictEqual(own.hasKey(), false);
  assert.strictEqual(own.keyEnd('groq'), '1234');
});

test('a key is kept under ai, trimmed, for the AI it starts like, which is then picked', () => {
  const s = setup();
  assert.strictEqual(s.own.saveKey('anthropic', '  gsk_secret9876 '), 'groq');
  assert.deepStrictEqual(s.kept(), { provider: 'groq', keys: { groq: 'gsk_secret9876' }, models: {} });
  assert.strictEqual(s.own.hasKey(), true);
  assert.strictEqual(s.own.keyEnd(), '9876');
  assert.strictEqual(s.own.saveKey('openai', 'my-own-key'), 'openai', 'a key like none of them is for the AI asked for');
  assert.throws(() => s.own.saveKey('openai', '   '), { code: 'bad_request', message: PASTE_FIRST });
  assert.throws(() => s.own.saveKey('openai', 'two words'), { code: 'bad_key', message: NOT_A_KEY });
  assert.throws(() => s.own.saveKey('nope', 'sk-1'), { code: 'bad_request' });
});

test('Remove forgets the key and its model; picking an AI and a model is kept', () => {
  const s = setup();
  s.own.saveKey('openai', 'sk-proj-1234');
  s.own.setModel('openai', 'gpt-4.1');
  assert.strictEqual(s.own.model(), 'gpt-4.1');
  s.own.pick('gemini');
  assert.strictEqual(s.own.provider(), 'gemini');
  assert.strictEqual(s.own.hasKey(), false);
  s.own.removeKey('openai');
  assert.deepStrictEqual(s.kept(), { provider: 'gemini', keys: {}, models: {} });
  assert.throws(() => s.own.pick('claude-code'), { code: 'bad_request' });
});

test("Anthropic's browser header goes to api.anthropic.com only", async () => {
  const seen = [];
  const send = withBrowserAccess(async (url, init) => seen.push([url, init.headers]));
  await send('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': 'k' } });
  await send('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer k' } });
  await send('https://api.anthropic.com.evil.example/v1', { headers: {} });
  assert.deepStrictEqual(seen, [
    ['https://api.anthropic.com/v1/messages', { 'x-api-key': 'k', [BROWSER_ACCESS]: 'true' }],
    ['https://api.openai.com/v1/models', { Authorization: 'Bearer k' }],
    ['https://api.anthropic.com.evil.example/v1', {}],
  ]);
});

test("a message goes to the AI picked as the Mac's chat prompt, and its answer is read as the server's is", async () => {
  const answer = JSON.stringify({ kind: 'write', say: 'Here you go!', text: 'Dear Sir,', notes: [], remember: ['Works at Infosys'] });
  const s = setup([reply(200, { content: [{ type: 'text', text: answer }], model: 'claude-haiku-4-5-20251001' })]);
  s.own.saveKey('anthropic', 'sk-ant-key1');
  const out = await s.own.ask({ action: 'chat', message: 'boss ko mail likho', history: [], facts: ['Boss: Mr. Sharma'], step: 1, userName: 'Akshat' });
  assert.strictEqual(s.calls.length, 1);
  const call = s.calls[0];
  assert.strictEqual(call.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(call.headers['x-api-key'], 'sk-ant-key1');
  assert.strictEqual(call.headers[BROWSER_ACCESS], 'true');
  assert.ok(call.signal instanceof AbortSignal, 'a deadline');
  assert.strictEqual(call.body.model, 'claude-haiku-4-5-20251001');
  assert.strictEqual(call.body.max_tokens, MAX_TOKENS);
  assert.match(call.body.system, /You are Buddy, a friendly helper/);
  assert.match(call.body.messages[0].content, /Their first name: Akshat/);
  assert.match(call.body.messages[0].content, /- Boss: Mr\. Sharma/);
  assert.match(call.body.messages[0].content, /Their message:\n"""\nboss ko mail likho\n"""/);
  assert.deepStrictEqual(out.chat, {
    kind: 'write', say: 'Here you go!', text: 'Dear Sir,', notes: [], doIt: false, send: false, remember: ['Works at Infosys'], again: false,
  });
});

test("the provider's own words come through: a refused key, and no key at all", async () => {
  const s = setup([reply(401, { error: { type: 'authentication_error' } })]);
  await assert.rejects(s.own.ask({ message: 'hi' }), { code: 'no_key', message: NO_KEY });
  s.own.saveKey('openai', 'sk-bad');
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(s.own.ask({ message: 'hi' }), { code: 'bad_key', message: 'Your OpenAI key was rejected. Check it in Settings.' });
  } finally {
    console.warn = warn;
  }
  assert.strictEqual(s.calls[0].headers[BROWSER_ACCESS], undefined, 'no Anthropic header for OpenAI');
});

test('the models: the live list with a saved key, else the usual ones', async () => {
  const s = setup([reply(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] }), reply(200, { data: [] })]);
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct']);
  assert.strictEqual(s.calls.length, 0, 'no key: nothing asked');
  s.own.saveKey('groq', 'gsk_1');
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile']);
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'], 'an empty list');
});
