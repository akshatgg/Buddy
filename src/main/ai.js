'use strict';

/**
 * Answers one panel action. Phase 1 has a single route -- the user's own key,
 * straight to the provider they picked -- so this picks the provider and
 * model from settings, builds the prompt, and calls it.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const providerRegistry = require('../../shared/providers');

const MAX_TOKENS = 1024;
// How long a person waits for the AI (an answer, or a check of their key) before it is given up on.
const AI_TIMEOUT_MS = 60_000;

function createAi({ store, secrets, providers = providerRegistry, fetchImpl }) {
  function modelFor(providerId) {
    const provider = providers.getProvider(providerId);
    return store.get('models')?.[providerId] || provider.fallbackModels[0];
  }

  async function ask(action, input, { signal } = {}) {
    const providerId = store.get('provider');
    const provider = providers.getProvider(providerId);
    const apiKey = secrets.get(providerId);
    if (!apiKey) throw new BuddyError('no_key', 'Add your API key in Settings first.');
    const prompt = prompts.buildPrompt(action, input);
    const model = modelFor(providerId);
    if (prompt.image && !provider.isVisionModel(model)) {
      throw new BuddyError('no_vision', "This model can't read screenshots. Pick another in Settings.");
    }
    const out = await provider.complete({ apiKey, model, ...prompt, maxTokens: MAX_TOKENS, fetchImpl, signal });
    return action === 'check' ? { ...out, check: prompts.parseCheck(out.text) } : out;
  }

  /** Models for a provider: the live list for the saved key, else the fallback list. */
  async function listModels(providerId, { signal } = {}) {
    const provider = providers.getProvider(providerId);
    const apiKey = secrets.get(providerId);
    if (!apiKey) return provider.fallbackModels;
    const live = await provider.listModels({ apiKey, fetchImpl, signal });
    return live.length ? live : provider.fallbackModels;
  }

  return { ask, listModels, modelFor };
}

module.exports = { createAi, MAX_TOKENS, AI_TIMEOUT_MS };
