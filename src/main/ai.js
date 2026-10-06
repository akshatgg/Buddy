'use strict';

/**
 * Answers one panel action, by one of two routes (Phase 2 spec §5, "Routing"):
 *   free -- Buddy's server answers with the admin's key (src/main/cloud.js);
 *   own  -- the user's own key, straight to the provider they picked (Phase 1).
 * Which one comes from the server's free-mode settings for this person. Nobody uses either without signing in.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const providerRegistry = require('../../shared/providers');

const { MAX_TOKENS } = prompts;
// How long a person waits for the AI (an answer, or a check of their key) before it is given up on.
const AI_TIMEOUT_MS = 60_000;

// What the server says when it will not answer for free; the settings are fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

function createAi({ store, secrets, cloud, account, providers = providerRegistry, fetchImpl }) {
  function modelFor(providerId) {
    const provider = providers.getProvider(providerId);
    return store.get('models')?.[providerId] || provider.fallbackModels[0];
  }

  const hasOwnKey = () => secrets.has(store.get('provider'));

  /** The user's own key, straight to their provider: Phase 1's route. */
  async function askOwn(action, input, { signal } = {}) {
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

  /** The server would not answer for free: carry on with the user's own key where the admin allows it. */
  async function afterRefusal(err, before, action, input, options) {
    const now = (await cloud.settings({ force: true }).catch(() => null)) || before;
    if (err.code === 'free_off') {
      if (!now.freeOn) return askOwn(action, input, options);
      throw err;
    }
    if (now.allowOwnKey && hasOwnKey()) return askOwn(action, input, options);
    if (err.code === 'free_limit' && now.allowOwnKey) {
      const limit = now.limit ?? before.limit;
      const used = limit ? `today's ${limit} free requests` : "today's free requests";
      throw new BuddyError('need_key', `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`);
    }
    throw err;
  }

  async function ask(action, input, options = {}) {
    if (!account.isSignedIn()) throw new BuddyError('signed_out', 'Sign in to use Buddy.');
    const free = await cloud.settings();
    if (!free) {
      // The server has never been reached: the user's own key, when there is one.
      if (hasOwnKey()) return askOwn(action, input, options);
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    if (!free.freeOn) return askOwn(action, input, options);
    if (free.blocked) {
      if (free.allowOwnKey && hasOwnKey()) return askOwn(action, input, options);
      throw new BuddyError('blocked', 'Your free access is paused.');
    }
    prompts.buildPrompt(action, input); // input that is not valid is refused here, without a call to the server
    try {
      return await cloud.ask(action, input, options);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err.code)) throw err;
      return afterRefusal(err, free, action, input, options);
    }
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
