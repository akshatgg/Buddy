'use strict';

/**
 * What Buddy knows about the person: short facts ("Your boss is Mr. Sharma."), kept in the settings file (store.js
 * `memory`), as [{ id, text, at }] oldest first. They go along with each chat request so that the AI can use them.
 * Signed in, they are kept with the person's account as well, so that all their devices know the same facts
 * (memory-sync.js): every change goes into the outbox (store.js `memoryOutbox`) for the server too.
 *
 * The chat adds the facts the AI picked up (source 'chat'), but only while "Learn about me from chats" is on (store.js
 * `learnFromChats`); Settings → Memory adds the ones the person types in (source 'settings'), forgets one, or forgets
 * them all. Every fact goes through cleanFact first, so a password or a card number is never kept.
 */

const crypto = require('node:crypto');
const { cleanFact, MAX_FACTS } = require('../../shared/memory-rules');
const { addToOutbox } = require('../../shared/memory-sync');

/** A fact as it is kept, copied; null for anything a damaged or hand-edited settings file holds instead. */
function readFact(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string') return null;
  return { id: entry.id, text: entry.text, at: Number.isFinite(entry.at) ? entry.at : 0 };
}

function createMemory({ store, now = Date.now, newId = () => crypto.randomUUID() }) {
  const listeners = [];
  const changeListeners = [];

  function list() {
    const saved = store.get('memory');
    return Array.isArray(saved) ? saved.map(readFact).filter(Boolean) : [];
  }

  /** Keep the store's settings as patched, then tell the listeners (main.js: the Settings window). */
  function save(patch) {
    store.set(patch);
    const facts = list();
    for (const fn of listeners) fn(facts);
  }

  /** Keep `patch`, with `op` in the outbox for the server, and tell those who sync that there is a change. */
  function change(patch, op) {
    save({ ...patch, memoryOutbox: addToOutbox(store.get('memoryOutbox'), op) });
    for (const fn of changeListeners) fn();
  }

  const learning = () => store.get('learnFromChats') !== false;

  return {
    list,
    facts: () => list().map((fact) => fact.text),
    learning,

    /** Keep a fact: { id, text }, or null when the rules refuse it, it is known already, or a chat adds it while learning is off. */
    add(text, { source = 'chat' } = {}) {
      if (source === 'chat' && !learning()) return null;
      const clean = cleanFact(text);
      if (!clean) return null;
      const known = list();
      if (known.some((fact) => fact.text.toLowerCase() === clean.toLowerCase())) return null;
      const fact = { id: newId(), text: clean, at: now() };
      // Over 50, the oldest goes.
      change({ memory: [...known, fact].slice(-MAX_FACTS) }, { op: 'add', ...fact });
      return { id: fact.id, text: fact.text };
    },

    /** Forget one fact; false when there was none with that id. */
    remove(id) {
      const known = list();
      const left = known.filter((fact) => fact.id !== id);
      if (left.length === known.length) return false;
      change({ memory: left }, { op: 'forget', id });
      return true;
    },

    clear() {
      if (list().length) change({ memory: [] }, { op: 'clear' });
    },

    /** "Learn about me from chats". Off, a chat saves nothing new; what is known is still used. */
    setLearning(on) {
      if (Boolean(on) !== learning()) save({ learnFromChats: Boolean(on) });
    },

    /** The facts as the account has them (memory-sync.js), in place of these; `patch` is kept with them. */
    replace(facts, patch = {}) {
      save({ ...patch, memory: facts.map(readFact).filter(Boolean) });
    },

    /** fn(list()) after every change, here or from the account. */
    onChange(fn) {
      listeners.push(fn);
    },

    /** fn() after each change made here, which the account does not have yet. */
    onLocalChange(fn) {
      changeListeners.push(fn);
    },
  };
}

module.exports = { createMemory };
