'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { rankOf, limitsFor, atLeastOk, warningFor, costOf } = require('../shared/agent/limits');

test('ranks: Sonnet best, Opus and Fable hard, big GPT / Gemini / Haiku ok, Groq and small models weak', () => {
  assert.strictEqual(rankOf('anthropic', 'claude-sonnet-5-5'), 'best');
  assert.strictEqual(rankOf('anthropic', 'claude-opus-4-5'), 'hard');
  assert.strictEqual(rankOf('anthropic', 'claude-haiku-4-5-20251001'), 'ok');
  assert.strictEqual(rankOf('claude-code', 'sonnet'), 'best');
  assert.strictEqual(rankOf('claude-code', 'opus'), 'hard');
  assert.strictEqual(rankOf('claude-code', 'fable'), 'hard');
  assert.strictEqual(rankOf('claude-code', 'haiku'), 'ok');
  assert.strictEqual(rankOf('openai', 'gpt-4.1'), 'ok');
  assert.strictEqual(rankOf('openai', 'gpt-5'), 'ok');
  assert.strictEqual(rankOf('openai', 'gpt-4.1-mini'), 'weak');
  assert.strictEqual(rankOf('openai', 'o4-mini'), 'weak');
  assert.strictEqual(rankOf('gemini', 'gemini-pro-latest'), 'ok');
  assert.strictEqual(rankOf('gemini', 'gemini-flash-latest'), 'ok');
  assert.strictEqual(rankOf('gemini', 'gemini-2.5-flash-lite'), 'weak');
  assert.strictEqual(rankOf('groq', 'llama-3.3-70b-versatile'), 'weak');
  assert.strictEqual(rankOf('nobody', 'x'), 'weak');
});

test('limits per rank, and ok-or-better', () => {
  assert.deepStrictEqual(limitsFor('best'), { maxSteps: 30, maxMs: 480000, maxShots: 15 });
  assert.deepStrictEqual(limitsFor('hard'), { maxSteps: 20, maxMs: 480000, maxShots: 12 });
  assert.deepStrictEqual(limitsFor('ok'), { maxSteps: 20, maxMs: 360000, maxShots: 12 });
  assert.deepStrictEqual(limitsFor('weak'), { maxSteps: 15, maxMs: 300000, maxShots: 8 });
  assert.deepStrictEqual(limitsFor('???'), limitsFor('weak'));
  assert.deepStrictEqual(['best', 'hard', 'ok', 'weak'].map(atLeastOk), [true, true, true, false]);
});

test('the warning before a job: weak models, and models that cannot see', () => {
  assert.strictEqual(warningFor({ label: 'Claude', rank: 'best', vision: true }), null);
  assert.strictEqual(warningFor({ label: 'Groq', rank: 'weak', vision: true }),
    'Your AI is Groq. It may get confused using the computer. Claude Sonnet works best. Continue anyway?');
  assert.strictEqual(warningFor({ label: 'Groq', rank: 'weak', vision: false }),
    "Your AI is Groq. It may get confused using the computer. Claude Sonnet works best. It also can't see the screen, so some apps won't work. Continue anyway?");
  assert.strictEqual(warningFor({ label: 'OpenAI', rank: 'ok', vision: false }),
    "Your AI can't see the screen, so some apps won't work. Continue anyway?");
});

test('cost in US dollars from the token counts, by the model family', () => {
  assert.strictEqual(costOf('claude-sonnet-5-5', { inputTokens: 1_000_000, outputTokens: 0 }), 3);
  assert.strictEqual(costOf('claude-sonnet-5-5', { inputTokens: 0, outputTokens: 1_000_000 }), 15);
  assert.strictEqual(costOf('gemini-flash-latest', { inputTokens: 1_000_000, outputTokens: 0 }), 0.3);
  assert.strictEqual(costOf('gpt-4.1-mini', { inputTokens: 1_000_000, outputTokens: 0 }), 0.4);
  assert.strictEqual(costOf('something-new', { inputTokens: 1_000_000, outputTokens: 0 }), 5, 'unknown: priced high');
  assert.strictEqual(costOf('claude-sonnet-5-5', {}), 0);
});

test('a model that cannot see the screen gets no screenshots', () => {
  assert.deepStrictEqual(limitsFor('ok', { vision: false }), { maxSteps: 20, maxMs: 360000, maxShots: 0 });
  assert.strictEqual(limitsFor('best', { vision: true }).maxShots, 15);
});
