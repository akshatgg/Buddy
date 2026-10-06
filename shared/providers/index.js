'use strict';

const { BuddyError } = require('../errors');
const anthropic = require('./anthropic');
const gemini = require('./gemini');
const { openai, groq } = require('./openai-compatible');

const PROVIDERS = { anthropic, openai, gemini, groq };
const PROVIDER_IDS = Object.keys(PROVIDERS);

function getProvider(id) {
  const provider = PROVIDERS[id];
  if (!provider) throw new BuddyError('bad_request', `Unknown provider: ${id}`);
  return provider;
}

module.exports = { PROVIDERS, PROVIDER_IDS, getProvider };
