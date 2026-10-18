'use strict';

/**
 * How well each AI can use a computer, and the limits of a job by that rank (spec §8). Data, tuned after real use.
 * Prices are US dollars per million tokens (input, output), for the server's daily spend cap (spec §9); the first
 * pattern that matches the model id wins, and an unknown model is priced high so the cap errs on the safe side.
 */

const RANKS = {
  best: { maxSteps: 30, maxMs: 8 * 60_000, maxShots: 15 },
  hard: { maxSteps: 20, maxMs: 8 * 60_000, maxShots: 12 },
  ok: { maxSteps: 20, maxMs: 6 * 60_000, maxShots: 12 },
  weak: { maxSteps: 15, maxMs: 5 * 60_000, maxShots: 8 },
};

const PRICES = [
  [/opus/i, 5, 25], [/sonnet/i, 3, 15], [/haiku/i, 1, 5], [/fable/i, 15, 75],
  [/gemini.*lite/i, 0.1, 0.4], [/gemini.*pro/i, 1.25, 10], [/gemini.*flash/i, 0.3, 2.5],
  [/nano/i, 0.1, 0.4], [/mini/i, 0.4, 1.6], [/gpt-5/i, 1.25, 10], [/gpt-4\.1/i, 2, 8], [/gpt-4o/i, 2.5, 10], [/^o[34]/i, 2, 8],
  [/llama|qwen|mixtral|gemma|deepseek|kimi/i, 0.6, 0.8],
];
const UNKNOWN_PRICE = [5, 25];

function rankOf(provider, model) {
  const m = String(model || '').toLowerCase();
  if (provider === 'claude-code') {
    if (m === 'sonnet') return 'best';
    if (m === 'opus' || m === 'fable') return 'hard';
    return m === 'haiku' ? 'ok' : 'weak';
  }
  if (provider === 'anthropic') {
    if (m.includes('sonnet')) return 'best';
    if (m.includes('opus') || m.includes('fable')) return 'hard';
    return m.includes('haiku') ? 'ok' : 'weak';
  }
  if (provider === 'openai') {
    if (/(mini|nano)/.test(m)) return 'weak';
    return /^(gpt-5|gpt-4\.1|gpt-4o|o3|o4|chatgpt-4o)/.test(m) ? 'ok' : 'weak';
  }
  if (provider === 'gemini') {
    if (m.includes('lite')) return 'weak';
    return /pro|flash/.test(m) ? 'ok' : 'weak';
  }
  return 'weak';
}

// A model that cannot see the screen gets no screenshots (spec §8).
const limitsFor = (rank, { vision = true } = {}) => ({ ...(Object.hasOwn(RANKS, rank) ? RANKS[rank] : RANKS.weak), ...(vision ? {} : { maxShots: 0 }) });
const atLeastOk = (rank) => rank === 'ok' || rank === 'hard' || rank === 'best';

function warningFor({ label, rank, vision }) {
  const blind = vision ? '' : "It also can't see the screen, so some apps won't work. ";
  if (rank === 'weak') return `Your AI is ${label}. It may get confused using the computer. Claude Sonnet works best. ${blind}Continue anyway?`;
  if (!vision) return "Your AI can't see the screen, so some apps won't work. Continue anyway?";
  return null;
}

function costOf(model, usage = {}) {
  const found = PRICES.find(([re]) => re.test(String(model || '')));
  const [inPrice, outPrice] = found ? found.slice(1) : UNKNOWN_PRICE;
  const input = Number.isFinite(usage.inputTokens) ? usage.inputTokens : 0;
  const output = Number.isFinite(usage.outputTokens) ? usage.outputTokens : 0;
  return (input * inPrice + output * outPrice) / 1_000_000;
}

module.exports = { RANKS, rankOf, limitsFor, atLeastOk, warningFor, costOf };
