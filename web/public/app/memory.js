// What Buddy knows about the person, on this phone only: short facts ("Your boss is Mr. Sharma."), kept in the store
// (store.js, `memory`) as [{ id, text, at }] oldest first, and sent with each chat message. The Mac's rules
// (src/main/memory.js): every fact goes through cleanFact (shared/memory-rules.js), so a password or a card number is
// never kept; a fact known already is not kept twice; over 50, the oldest goes; and while "Learn about me from chats"
// is off (`learn`), a chat adds nothing, though what is known is still used.

import { cleanFact, MAX_FACTS } from './shared/memory-rules.js';

/** A fact as it is kept, copied; null for anything broken in the store. */
function readFact(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string') return null;
  return { id: entry.id, text: entry.text, at: Number.isFinite(entry.at) ? entry.at : 0 };
}

export function createMemory({ store, now = Date.now, newId = () => crypto.randomUUID() }) {
  function list() {
    const saved = store.read('memory', []);
    return Array.isArray(saved) ? saved.map(readFact).filter(Boolean) : [];
  }

  const learning = () => store.read('learn', true) !== false;

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
      store.write('memory', [...known, fact].slice(-MAX_FACTS));
      return { id: fact.id, text: fact.text };
    },

    /** Forget one fact; false when there was none with that id. */
    remove(id) {
      const known = list();
      const left = known.filter((fact) => fact.id !== id);
      if (left.length === known.length) return false;
      store.write('memory', left);
      return true;
    },

    clear() {
      store.write('memory', []);
    },

    /** "Learn about me from chats". Off, a chat saves nothing new. */
    setLearning(on) {
      store.write('learn', Boolean(on));
    },
  };
}
