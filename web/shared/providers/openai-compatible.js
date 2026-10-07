'use strict';

const { BuddyError } = require('../errors');
const { requestJson } = require('./http');

/**
 * OpenAI's Chat Completions shape, which Groq speaks too. One factory, two
 * providers: they differ in base URL, labels, how their keys begin, which
 * models can see images, and whether "thinking" models need to be told to keep
 * it short.
 */
function createOpenAICompatible({
  id, label, baseUrl, keyUrl, keyPrefixes, fallbackModels, isVisionModel, isChatModel, reasoningEffort,
}) {
  async function complete({ apiKey, model, system, user, image, maxTokens, fetchImpl, signal }) {
    const content = image
      ? [{ type: 'text', text: user }, { type: 'image_url', image_url: { url: `data:image/jpeg;base64,${image}` } }]
      : user;
    const body = {
      model,
      max_completion_tokens: maxTokens,
      messages: [{ role: 'system', content: system }, { role: 'user', content }],
    };
    const effort = reasoningEffort(model);
    if (effort) body.reasoning_effort = effort;
    const j = await requestJson({
      fetchImpl,
      signal,
      label,
      method: 'POST',
      url: `${baseUrl}/chat/completions`,
      headers: { Authorization: `Bearer ${apiKey}` },
      body,
    });
    const text = String(j.choices?.[0]?.message?.content || '').trim();
    if (!text) {
      throw new BuddyError('empty', `${label} returned no text. If this is a "thinking" model, pick a simpler one in Settings.`);
    }
    return {
      text,
      model: j.model || model,
      usage: { inputTokens: j.usage?.prompt_tokens ?? 0, outputTokens: j.usage?.completion_tokens ?? 0 },
    };
  }

  async function listModels({ apiKey, fetchImpl, signal }) {
    const j = await requestJson({
      fetchImpl,
      signal,
      label,
      url: `${baseUrl}/models`,
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    return (j.data || [])
      .map((m) => m.id)
      .filter((m) => typeof m === 'string' && isChatModel(m))
      .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
  }

  return { id, label, keyUrl, keyPrefixes, fallbackModels, isVisionModel, complete, listModels };
}

const openai = createOpenAICompatible({
  id: 'openai',
  label: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  keyUrl: 'https://platform.openai.com/api-keys',
  keyPrefixes: ['sk-'],
  fallbackModels: ['gpt-4.1-mini', 'gpt-4.1'],
  isVisionModel: (m) => /^(gpt-4o|gpt-4\.1|gpt-5|o1(?!-mini)|o3(?!-mini)|o4|chatgpt-4o)/.test(m),
  isChatModel: (m) => /^(gpt-|o\d|chatgpt-)/.test(m)
    && !/(embedding|tts|whisper|transcribe|audio|realtime|image|dall-e|moderation|search|instruct|codex)/.test(m),
  // Reasoning models spend max_completion_tokens on thinking first; keep that short.
  reasoningEffort: (m) => (/^(gpt-5|o\d)/.test(m) ? 'low' : null),
});

const groq = createOpenAICompatible({
  id: 'groq',
  label: 'Groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyUrl: 'https://console.groq.com/keys',
  keyPrefixes: ['gsk_'],
  fallbackModels: ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'],
  isVisionModel: (m) => /llama-4|vision/i.test(m),
  isChatModel: (m) => !/(whisper|tts|guard|playai|orpheus|compound|distil)/i.test(m),
  reasoningEffort: () => null,
});

module.exports = { createOpenAICompatible, openai, groq };
