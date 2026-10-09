// Made by tools/sync-web-app.js from shared/providers/index.js. Do not edit: run `npm run sync:web-app`.
import * as dep0 from '../errors.js';
import * as dep1 from './anthropic.js';
import * as dep2 from './gemini.js';
import * as dep3 from './openai-compatible.js';
const module = { exports: {} };
const require = (name) => ({ '../errors': dep0, './anthropic': dep1, './gemini': dep2, './openai-compatible': dep3 })[name];
(function () {
'use strict';

const { BuddyError } = require('../errors');
const anthropic = require('./anthropic');
const gemini = require('./gemini');
const { openai, groq } = require('./openai-compatible');

const PROVIDERS = { anthropic, openai, gemini, groq };
const PROVIDER_IDS = Object.keys(PROVIDERS);

function getProvider(id) {
  // Own ids only: PROVIDERS[id] would also find "constructor", "__proto__" and the like,
  // and hasOwn alone would turn ['anthropic'] into 'anthropic'.
  if (typeof id !== 'string' || !Object.hasOwn(PROVIDERS, id)) {
    throw new BuddyError('bad_request', `Unknown provider: ${String(id)}`);
  }
  return PROVIDERS[id];
}

/**
 * The id of the provider a key belongs to, going by how the key starts; null when it starts like none of
 * them, or is not text. The longest matching start wins, so "sk-ant-..." is Claude's and any other
 * "sk-..." is OpenAI's, whichever of the two is listed first.
 */
function providerForKey(key) {
  if (typeof key !== 'string') return null;
  let owner = null;
  let longest = 0;
  for (const id of PROVIDER_IDS) {
    for (const prefix of PROVIDERS[id].keyPrefixes) {
      if (prefix.length > longest && key.startsWith(prefix)) {
        owner = id;
        longest = prefix.length;
      }
    }
  }
  return owner;
}

module.exports = { PROVIDERS, PROVIDER_IDS, getProvider, providerForKey };
})();
export const { PROVIDERS, PROVIDER_IDS, getProvider, providerForKey } = module.exports;
