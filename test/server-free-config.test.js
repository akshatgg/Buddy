'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { withDefaults, isFreeOn, applyPatch, DEFAULT_LIMIT, MAX_LIMIT } = require('../web/lib/free-config');

/** hasKey for a server that has keys for these providers only. */
const keys = (...ids) => (id) => ids.includes(id);
const SAVED = { enabled: true, limitMode: 'daily', dailyRequests: 5, allowOwnKey: true, provider: 'anthropic', model: 'claude-x' };
const refused = (message) => ({ code: 'bad_request', message });

test('nothing saved: free mode off, 30 a day, own keys not allowed, the first provider with a key', () => {
  assert.strictEqual(DEFAULT_LIMIT, 30);
  assert.strictEqual(MAX_LIMIT, 10_000);
  assert.deepStrictEqual(withDefaults(null, keys('groq')), {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'groq', model: 'llama-3.3-70b-versatile',
  });
  assert.strictEqual(withDefaults(undefined, keys()).provider, 'anthropic', 'with no key at all, the first provider');
  assert.strictEqual(withDefaults(undefined, keys()).model, 'claude-haiku-4-5-20251001');
});

test('saved switches read back as saved', () => {
  assert.deepStrictEqual(withDefaults(SAVED, keys('anthropic')), SAVED);
  assert.strictEqual(withDefaults({ ...SAVED, limitMode: 'unlimited' }, keys()).limitMode, 'unlimited');
});

test('a value that is not valid falls back to its default, field by field', () => {
  const odd = { enabled: 'yes', limitMode: 'weekly', dailyRequests: 0, allowOwnKey: 1, provider: 'constructor', model: '  ' };
  assert.deepStrictEqual(withDefaults(odd, keys('openai')), {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'openai', model: 'gpt-4.1-mini',
  });
  assert.strictEqual(withDefaults({ dailyRequests: 2.5 }, keys()).dailyRequests, 30);
  assert.strictEqual(withDefaults({ dailyRequests: 10_001 }, keys()).dailyRequests, 30);
  assert.strictEqual(withDefaults('text', keys()).enabled, false);
});

test('free mode is on only when it is switched on and the server has a key for its provider', () => {
  assert.strictEqual(isFreeOn(SAVED, keys('anthropic')), true);
  assert.strictEqual(isFreeOn(SAVED, keys('openai')), false);
  assert.strictEqual(isFreeOn({ ...SAVED, enabled: false }, keys('anthropic')), false);
});

test('a patch changes only what it names, and leaves the current switches alone', () => {
  const current = { ...SAVED };
  const next = applyPatch(current, { dailyRequests: 50, allowOwnKey: false, ignored: 'x' }, keys('anthropic'));
  assert.deepStrictEqual(next, { ...SAVED, dailyRequests: 50, allowOwnKey: false });
  assert.deepStrictEqual(current, SAVED);
});

test('a new provider brings its own first model, unless a model comes with it', () => {
  assert.strictEqual(applyPatch(SAVED, { provider: 'groq' }, keys('anthropic', 'groq')).model, 'llama-3.3-70b-versatile');
  assert.strictEqual(applyPatch(SAVED, { provider: 'groq', model: 'llama-4' }, keys('anthropic', 'groq')).model, 'llama-4');
  assert.strictEqual(applyPatch(SAVED, { provider: 'anthropic' }, keys('anthropic')).model, 'claude-x', 'the same provider keeps its model');
  assert.strictEqual(applyPatch(SAVED, { model: '  claude-y ' }, keys('anthropic')).model, 'claude-y');
});

test('each field that is not valid is refused in plain words', () => {
  const k = keys('anthropic');
  for (const [patch, message] of [
    ['text', 'Those settings are not valid.'],
    [null, 'Those settings are not valid.'],
    [[], 'Those settings are not valid.'],
    [{ enabled: 'on' }, 'Free mode must be on or off.'],
    [{ limitMode: 'weekly' }, 'Pick Unlimited or a daily limit.'],
    [{ dailyRequests: 0 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: 2.5 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: '30' }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: 10_001 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ allowOwnKey: 'yes' }, '"Also let users add their own key" must be on or off.'],
    [{ provider: 'constructor' }, 'Unknown AI provider.'],
    [{ model: '' }, 'Pick a model.'],
    [{ model: 'm'.repeat(201) }, 'Pick a model.'],
  ]) {
    assert.throws(() => applyPatch(SAVED, patch, k), refused(message), JSON.stringify(patch));
  }
});

test('free mode cannot be on for a provider the server has no key for', () => {
  assert.throws(
    () => applyPatch({ ...SAVED, enabled: false }, { enabled: true, provider: 'openai' }, keys('anthropic')),
    refused("There is no OpenAI key on the server, so free mode can't use it."),
  );
  assert.strictEqual(
    applyPatch(SAVED, { enabled: false, provider: 'openai' }, keys('anthropic')).provider,
    'openai',
    'switched off, any provider may be picked',
  );
});
