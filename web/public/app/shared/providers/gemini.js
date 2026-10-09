// Made by tools/sync-web-app.js from shared/providers/gemini.js. Do not edit: run `npm run sync:web-app`.
import * as dep0 from '../errors.js';
import * as dep1 from './http.js';
const module = { exports: {} };
const require = (name) => ({ '../errors': dep0, './http': dep1 })[name];
(function () {
'use strict';

const { BuddyError } = require('../errors');
const { requestJson } = require('./http');

const BASE = 'https://generativelanguage.googleapis.com/v1beta';
const LABEL = 'Gemini';
// Thinking models spend part of maxOutputTokens on thoughts before the answer;
// without this room a short cap can come back with no answer at all.
const THINKING_ROOM = 4;

async function complete({ apiKey, model, system, user, image, maxTokens, fetchImpl, signal }) {
  const parts = [{ text: user }];
  if (image) parts.push({ inline_data: { mime_type: 'image/jpeg', data: image } });
  const j = await requestJson({
    fetchImpl,
    signal,
    label: LABEL,
    method: 'POST',
    url: `${BASE}/models/${encodeURIComponent(model)}:generateContent`,
    headers: { 'x-goog-api-key': apiKey },
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts }],
      generationConfig: { maxOutputTokens: maxTokens * THINKING_ROOM },
    },
  });
  if (j.promptFeedback?.blockReason) throw new BuddyError('empty', `${LABEL} blocked this request.`);
  const text = (j.candidates?.[0]?.content?.parts || [])
    .filter((p) => p.thought !== true)
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new BuddyError('empty', `${LABEL} returned no text. Try again, or pick another model in Settings.`);
  const meta = j.usageMetadata || {};
  return {
    text,
    model: j.modelVersion || model,
    usage: {
      inputTokens: meta.promptTokenCount ?? 0,
      // Thoughts are billed as output.
      outputTokens: (meta.candidatesTokenCount ?? 0) + (meta.thoughtsTokenCount ?? 0),
    },
  };
}

async function listModels({ apiKey, fetchImpl, signal }) {
  const j = await requestJson({
    fetchImpl,
    signal,
    label: LABEL,
    url: `${BASE}/models?pageSize=1000`,
    headers: { 'x-goog-api-key': apiKey },
  });
  return (j.models || [])
    .filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name).replace(/^models\//, ''))
    .filter((m) => /^gemini/.test(m) && !/(embedding|aqa|image|tts|live|audio|robotics|computer-use)/.test(m))
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
}

module.exports = {
  id: 'gemini',
  label: 'Google Gemini',
  keyUrl: 'https://aistudio.google.com/apikey',
  keyPrefixes: ['AIza'],
  fallbackModels: ['gemini-flash-latest', 'gemini-pro-latest'],
  isVisionModel: (m) => /^gemini/.test(m),
  complete,
  listModels,
};
})();
export const { id, label, keyUrl, keyPrefixes, fallbackModels, isVisionModel, complete, listModels } = module.exports;
