'use strict';

const { BuddyError } = require('../errors');
const { requestJson } = require('./http');

const BASE = 'https://api.anthropic.com/v1';
const LABEL = 'Claude';

function headers(apiKey) {
  return { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' };
}

async function complete({ apiKey, model, system, user, image, maxTokens, fetchImpl, signal }) {
  const content = image
    ? [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
        { type: 'text', text: user },
      ]
    : user;
  const j = await requestJson({
    fetchImpl,
    signal,
    label: LABEL,
    method: 'POST',
    url: `${BASE}/messages`,
    headers: headers(apiKey),
    body: { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content }] },
  });
  const text = (j.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  if (!text) throw new BuddyError('empty', `${LABEL} returned no text. Try again.`);
  return {
    text,
    model: j.model || model,
    usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 },
  };
}

async function listModels({ apiKey, fetchImpl, signal }) {
  const j = await requestJson({ fetchImpl, signal, label: LABEL, url: `${BASE}/models?limit=100`, headers: headers(apiKey) });
  return (j.data || []).map((m) => m.id).filter(Boolean);
}

module.exports = {
  id: 'anthropic',
  label: 'Claude (Anthropic)',
  keyUrl: 'https://console.anthropic.com/settings/keys',
  keyPrefixes: ['sk-ant-'],
  fallbackModels: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'],
  isVisionModel: () => true,
  complete,
  listModels,
};
