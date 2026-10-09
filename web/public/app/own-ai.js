// The person's own AI key, on this phone only: kept with store.js under 'ai' as { provider, keys: { [id]: key },
// models: { [id]: model } }, never sent to Buddy's server, kept on sign out (as on the Mac, the key belongs to the
// device), and forgotten by Remove. A message goes straight from the page to the provider, with the shared providers
// and prompts, as the Mac's own-key route does (src/main/ai.js askOwn).

import { PROVIDER_IDS, getProvider, providerForKey } from './shared/providers/index.js';
import { buildPrompt, parseChat, MAX_TOKENS } from './shared/prompts.js';
import { BuddyError } from './shared/errors.js';

export const AI_TIMEOUT_MS = 60_000; // as long as POST /api/ask is given (api.js TIMEOUTS.ask)
export const BROWSER_ACCESS = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC = 'https://api.anthropic.com/';
// A key is one run of printable characters, as on the Mac (src/main/ipc/settings.js).
const KEY_SHAPE = /^[\x21-\x7e]+$/;
export const PASTE_FIRST = 'Paste your key first.';
export const NOT_A_KEY = "That doesn't look like an API key. Copy only the key and paste it again.";
export const NO_KEY = 'Add your API key in Settings first.';

/**
 * fetch, with the header Anthropic wants before it answers a web page, on calls to api.anthropic.com only. OpenAI,
 * Gemini and Groq answer a web page as they are, and get no extra header.
 */
export function withBrowserAccess(fetchImpl) {
  return (url, init = {}) => {
    if (!String(url).startsWith(ANTHROPIC)) return fetchImpl(url, init);
    return fetchImpl(url, { ...init, headers: { ...init.headers, [BROWSER_ACCESS]: 'true' } });
  };
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** store is store.js's. Answers the own key's settings and its calls. */
export function createOwnAi({ store, fetchImpl = (...args) => fetch(...args), timeoutMs = AI_TIMEOUT_MS }) {
  const send = withBrowserAccess(fetchImpl);

  /** What is kept, with the AI picked always one of the four, and only text kept as keys and models. */
  function read() {
    const kept = store.read('ai', null);
    const textOf = (map) => (isObject(map)
      ? Object.fromEntries(PROVIDER_IDS.filter((id) => typeof map[id] === 'string' && map[id]).map((id) => [id, map[id]]))
      : {});
    return {
      provider: PROVIDER_IDS.includes(kept?.provider) ? kept.provider : PROVIDER_IDS[0],
      keys: textOf(kept?.keys),
      models: textOf(kept?.models),
    };
  }

  const write = (next) => store.write('ai', next);
  const picked = () => read().provider;

  /** The model for `id`: the one picked, else the provider's first. */
  function model(id = picked()) {
    return read().models[id] || getProvider(id).fallbackModels[0];
  }

  return {
    /** The AI picked: 'anthropic', 'openai', 'gemini' or 'groq'. */
    provider: picked,

    /** A key is saved for the AI picked. */
    hasKey: () => Boolean(read().keys[picked()]),

    /** The last 4 characters of the key saved for `id`, or '' when none is: a saved key is never shown again. */
    keyEnd: (id = picked()) => (read().keys[id] || '').slice(-4),

    model,

    pick(id) {
      getProvider(id); // an unknown name is refused
      write({ ...read(), provider: id });
    },

    /**
     * Keep `key` for the AI `id`, or for the one it belongs to by how it starts (providerForKey), which is then picked.
     * Answers that AI's id. Throws a BuddyError for no key, or one that is not a key.
     */
    saveKey(id, key) {
      getProvider(id);
      const apiKey = typeof key === 'string' ? key.trim() : '';
      if (!apiKey) throw new BuddyError('bad_request', PASTE_FIRST);
      if (!KEY_SHAPE.test(apiKey)) throw new BuddyError('bad_key', NOT_A_KEY);
      const owner = providerForKey(apiKey) ?? id;
      const now = read();
      write({ ...now, provider: owner, keys: { ...now.keys, [owner]: apiKey } });
      return owner;
    },

    /** Remove: the key for `id` is forgotten, and the model picked with it. */
    removeKey(id = picked()) {
      const now = read();
      delete now.keys[id];
      delete now.models[id];
      write(now);
    },

    setModel(id, name) {
      getProvider(id);
      const now = read();
      write({ ...now, models: { ...now.models, [id]: name } });
    },

    /** The models for `id`: its live list with the saved key, else (no key, or an empty list) its usual ones. */
    async listModels(id = picked()) {
      const provider = getProvider(id);
      const apiKey = read().keys[id];
      if (!apiKey) return provider.fallbackModels;
      const live = await provider.listModels({ apiKey, fetchImpl: send, signal: AbortSignal.timeout(timeoutMs) });
      return live.length ? live : provider.fallbackModels;
    },

    /** One chat message (chat-core.js chatRequest's body), answered by the AI picked: { text, model, usage, chat }. */
    async ask(body) {
      const id = picked();
      const apiKey = read().keys[id];
      if (!apiKey) throw new BuddyError('no_key', NO_KEY);
      const prompt = buildPrompt('chat', body);
      const out = await getProvider(id).complete({
        apiKey, model: model(id), ...prompt, maxTokens: MAX_TOKENS, fetchImpl: send, signal: AbortSignal.timeout(timeoutMs),
      });
      return { ...out, chat: parseChat(out.text) };
    },
  };
}
