// Made by tools/sync-web-app.js from src/main/free-state.js. Do not edit: run `npm run sync:web-app`.
const module = { exports: {} };
const require = (name) => ({  })[name];
(function () {
'use strict';

/**
 * What the AI part of Settings and the Welcome window shows for this person's free-mode settings (spec §2, "What
 * the AI section shows"): a line about free mode, and whether the provider / key / model form is shown.
 */

function aiSection(free) {
  if (!free || !free.freeOn) return { note: '', showForm: true };
  if (free.blocked) {
    return free.allowOwnKey
      ? { note: 'Your free access is paused. You can still use your own key.', showForm: true }
      : { note: 'Your free access is paused.', showForm: false };
  }
  if (free.limitMode === 'unlimited') return { note: 'Free AI is on. No key needed.', showForm: false };
  const today = `You get ${free.limit} free requests a day. Used today: ${Math.min(free.usedToday, free.limit)}.`;
  if (free.allowOwnKey) {
    return { note: `${today} Add your own key to keep going after your free requests run out.`, showForm: true };
  }
  return { note: today, showForm: false };
}

module.exports = { aiSection };
})();
export const { aiSection } = module.exports;
