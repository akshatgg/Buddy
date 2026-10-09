'use strict';

/**
 * The admin's switches for free mode (Firestore config/free): what they are when nothing is saved yet, and
 * whether a change the admin asks for is valid. `hasKey(providerId)` says whether the server has a key for it.
 *
 *   { enabled, limitMode: 'unlimited' | 'daily', dailyRequests, allowOwnKey, provider, model, clawdLook }
 *
 * clawdLook is not about free mode, but it is the admin's too and goes to every app with these: where Clawd walks with
 * the buddy while Claude Code works, 'head' (on top of its head) or 'face' (along its face screen, under the eyes).
 */

const { BuddyError } = require('../shared/errors');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');

const DEFAULT_LIMIT = 30;
const CLAWD_LOOKS = ['head', 'face'];
const MAX_LIMIT = 10_000;
const MODEL_MAX = 200;

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isLimit = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT;
const bad = (message) => new BuddyError('bad_request', message);

/** The saved switches, with a default for each one that is missing or not valid. */
function withDefaults(stored, hasKey) {
  const s = isPlainObject(stored) ? stored : {};
  const provider = PROVIDER_IDS.includes(s.provider) ? s.provider : (PROVIDER_IDS.find(hasKey) || PROVIDER_IDS[0]);
  const model = typeof s.model === 'string' && s.model.trim() ? s.model : PROVIDERS[provider].fallbackModels[0];
  return {
    enabled: s.enabled === true,
    limitMode: s.limitMode === 'unlimited' ? 'unlimited' : 'daily',
    dailyRequests: isLimit(s.dailyRequests) ? s.dailyRequests : DEFAULT_LIMIT,
    allowOwnKey: s.allowOwnKey === true,
    provider,
    model,
    clawdLook: CLAWD_LOOKS.includes(s.clawdLook) ? s.clawdLook : CLAWD_LOOKS[0],
  };
}

/** Free mode is on only when the admin switched it on and the server has a key for the chosen provider. */
function isFreeOn(config, hasKey) {
  return config.enabled && hasKey(config.provider);
}

/** `current` changed as the admin's `patch` asks. Throws a bad_request in plain words for anything not valid. */
function applyPatch(current, patch, hasKey) {
  if (!isPlainObject(patch)) throw bad('Those settings are not valid.');
  const has = (name) => Object.hasOwn(patch, name);
  const next = { ...current };
  if (has('enabled')) {
    if (typeof patch.enabled !== 'boolean') throw bad('Free mode must be on or off.');
    next.enabled = patch.enabled;
  }
  if (has('limitMode')) {
    if (patch.limitMode !== 'unlimited' && patch.limitMode !== 'daily') throw bad('Pick Unlimited or a daily limit.');
    next.limitMode = patch.limitMode;
  }
  if (has('dailyRequests')) {
    if (!isLimit(patch.dailyRequests)) throw bad(`The daily limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    next.dailyRequests = patch.dailyRequests;
  }
  if (has('allowOwnKey')) {
    if (typeof patch.allowOwnKey !== 'boolean') throw bad('"Also let users add their own key" must be on or off.');
    next.allowOwnKey = patch.allowOwnKey;
  }
  if (has('provider')) {
    if (!PROVIDER_IDS.includes(patch.provider)) throw bad('Unknown AI provider.');
    if (patch.provider !== current.provider) {
      next.provider = patch.provider;
      next.model = PROVIDERS[patch.provider].fallbackModels[0]; // the old model belongs to the old provider
    }
  }
  if (has('model')) {
    const model = typeof patch.model === 'string' ? patch.model.trim() : '';
    if (!model || model.length > MODEL_MAX) throw bad('Pick a model.');
    next.model = model;
  }
  if (has('clawdLook')) {
    if (!CLAWD_LOOKS.includes(patch.clawdLook)) throw bad('Pick where Clawd walks: on the head or on the face.');
    next.clawdLook = patch.clawdLook;
  }
  if (next.enabled && !hasKey(next.provider)) {
    throw bad(`There is no ${PROVIDERS[next.provider].label} key on the server, so free mode can't use it.`);
  }
  return next;
}

module.exports = { withDefaults, isFreeOn, applyPatch, DEFAULT_LIMIT, MAX_LIMIT, CLAWD_LOOKS };
