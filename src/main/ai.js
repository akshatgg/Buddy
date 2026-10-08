'use strict';

/**
 * Answers one panel action, by one of three routes (Phase 2 spec §5, "Routing"; the Claude Code brain spec §4):
 *   free        -- Buddy's server answers with the admin's key (src/main/cloud.js);
 *   own         -- the user's own key, straight to the provider they picked (Phase 1);
 *   claude-code -- Claude Code on this computer, signed in to the person's own plan (src/main/claude/run.js).
 * Which one comes from the server's free-mode settings for this person; Claude Code, when it is picked and signed in,
 * counts as an own key in every rule. Nobody uses any route without signing in.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const providerRegistry = require('../../shared/providers');
const { PROVIDER_ID: CLAUDE_ID, MODELS: CLAUDE_MODELS, DEFAULT_MODEL: CLAUDE_DEFAULT } = require('./claude/find');
const { createRun, claudeError } = require('./claude/run');

const { MAX_TOKENS } = prompts;
// How long a person waits for the AI (an answer, or a check of their key) before it is given up on.
const AI_TIMEOUT_MS = 60_000;

// What the server says when it will not answer for free; the settings are fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

const signedOut = () => new BuddyError('signed_out', 'Sign in to use Buddy.');
// With no finder (older callers, and tests of the other routes), Claude Code is simply not there.
const NO_CLAUDE = Object.freeze({ installed: false, loggedIn: false });

/**
 * `find` is claude/find.js's finder and `dataDir` Buddy's data folder, for the Claude Code route; `run` replaces the
 * runner built from them (tests pass a fake).
 */
function createAi({
  store, secrets, cloud, account, providers = providerRegistry, fetchImpl, find = null, dataDir = null,
  run = find && createRun({ find, dataDir, timeoutMs: AI_TIMEOUT_MS }),
}) {
  const usingClaude = () => store.get('provider') === CLAUDE_ID;
  // Claude Code's status as find.js keeps it: asked again after a minute, never a wait of more than 10 s.
  const claudeStatus = () => (find ? find.status() : Promise.resolve(NO_CLAUDE));

  function modelFor(providerId) {
    if (providerId === CLAUDE_ID) {
      const saved = store.get('models')?.[CLAUDE_ID];
      return CLAUDE_MODELS.includes(saved) ? saved : CLAUDE_DEFAULT;
    }
    const provider = providers.getProvider(providerId);
    return store.get('models')?.[providerId] || provider.fallbackModels[0];
  }

  /** The person's own way to an answer: a key saved for the AI they picked, or Claude Code picked and signed in. */
  async function hasOwn() {
    if (usingClaude()) return (await claudeStatus()).loggedIn === true;
    return secrets.has(store.get('provider'));
  }

  /** A Check's and a chat's answers come back read (prompts.parseCheck, parseChat). */
  function parsed(action, out) {
    if (action === 'check') return { ...out, check: prompts.parseCheck(out.text) };
    if (action === 'chat') return { ...out, chat: prompts.parseChat(out.text) };
    return out;
  }

  /** Claude Code on this computer: one `claude -p` a request (claude/run.js). Every one of its models reads images. */
  async function askClaude(action, input, { signal } = {}) {
    const status = await claudeStatus();
    if (!status.installed) throw claudeError('no_claude');
    if (!status.loggedIn) throw claudeError('claude_signed_out');
    const prompt = prompts.buildPrompt(action, input);
    return parsed(action, await run.runPrompt({ ...prompt, model: modelFor(CLAUDE_ID), signal }));
  }

  /** The user's own key, straight to their provider (Phase 1's route); or Claude Code, when that is what they picked. */
  async function askOwn(action, input, options = {}) {
    if (usingClaude()) return askClaude(action, input, options);
    const { signal } = options;
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
    return parsed(action, out);
  }

  /**
   * The server would not answer for free: carry on with the user's own key (or Claude Code) where the admin allows it.
   * `own` is whether they have one (hasOwn(), decided before the server was asked). When the settings cannot be fetched
   * again, the ones from before the request decide, unless the person has been signed out meanwhile.
   */
  async function afterRefusal(err, before, own, action, input, options) {
    const fresh = await cloud.settings({ force: true }).catch((fetchErr) => {
      if (fetchErr.code === 'signed_out') throw fetchErr;
      return null;
    });
    // Signed out while the settings were being fetched again, which then comes back with none (signing out forgets
    // them): nobody uses either route without signing in, and the settings from before the request must not decide.
    if (!account.isSignedIn()) throw signedOut();
    const now = fresh || before;
    if (err.code === 'free_off') {
      if (!now.freeOn) return askOwn(action, input, options);
      throw err;
    }
    if (now.allowOwnKey && own) return askOwn(action, input, options);
    if (err.code === 'free_limit' && now.allowOwnKey) {
      const limit = now.limit ?? before.limit;
      const used = limit ? `today's ${limit} free requests` : "today's free requests";
      throw new BuddyError('need_key', `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`);
    }
    throw err;
  }

  async function ask(action, input, options = {}) {
    if (!account.isSignedIn()) throw signedOut();
    const free = await cloud.settings();
    // Signed out while the settings were being fetched: signing out forgets them, so the fetch comes back with none,
    // which is not "the server was never reached" (nor a reason to use either route).
    if (!account.isSignedIn()) throw signedOut();
    const own = await hasOwn();
    if (!free) {
      // The server has never been reached: the user's own key, when there is one.
      if (own) return askOwn(action, input, options);
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    if (!free.freeOn) return askOwn(action, input, options);
    if (free.blocked) {
      if (free.allowOwnKey && own) return askOwn(action, input, options);
      throw new BuddyError('blocked', 'Your free access is paused.');
    }
    // Today's free requests are used up and the admin lets this person go on with their own key: the server would only
    // refuse (and the settings be fetched again), so the own key answers at once.
    const usedUp = free.limitMode === 'daily' && free.limit !== null && free.usedToday >= free.limit;
    if (usedUp && free.allowOwnKey && own) return askOwn(action, input, options);
    prompts.buildPrompt(action, input); // input that is not valid is refused here, without a call to the server
    try {
      return await cloud.ask(action, input, options);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err.code)) throw err;
      return afterRefusal(err, free, own, action, input, options);
    }
  }

  /** Models for a provider: the live list for the saved key, else the fallback list. Claude Code's are its own names. */
  async function listModels(providerId, { signal } = {}) {
    if (providerId === CLAUDE_ID) return CLAUDE_MODELS;
    const provider = providers.getProvider(providerId);
    const apiKey = secrets.get(providerId);
    if (!apiKey) return provider.fallbackModels;
    const live = await provider.listModels({ apiKey, fetchImpl, signal });
    return live.length ? live : provider.fallbackModels;
  }

  return { ask, listModels, modelFor };
}

module.exports = { createAi, MAX_TOKENS, AI_TIMEOUT_MS };
