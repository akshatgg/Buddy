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

module.exports = { PROVIDERS, PROVIDER_IDS, getProvider };
