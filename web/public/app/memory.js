// What Buddy knows about the person: short facts ("Your boss is Mr. Sharma."), kept in the store (store.js, `memory`)
// as [{ id, text, at }] oldest first, and sent with each chat message. The Mac's rules (src/main/memory.js): every fact
// goes through cleanFact (shared/memory-rules.js), so a password or a card number is never kept; a fact known already
// is not kept twice; over 50, the oldest goes; and while "Learn about me from chats" is off (`learn`), a chat adds
// nothing, though what is known is still used.
//
// Signed in, the facts are kept with the person's account too, so that every device signed in with it knows the same
// (shared/memory-sync.js). Every change is also put in an outbox (`memoryOutbox`), signed in or not, and a sync
// (startMemorySync) sends it to Buddy's server and keeps the account's facts it answers. `memoryUid` is the account the
// facts belong to; absent, they were never synced.

import { cleanFact, MAX_FACTS } from './shared/memory-rules.js';
import { addToOutbox, opsToSend, outboxAfter, afterSync, factsOf } from './shared/memory-sync.js';

const SYNC_AFTER_CHANGE_MS = 1000; // changes close together go in one sync
const STALE_MS = 2 * 60_000; // back in view, the app syncs when the last sync is older than this

/** Where the facts are kept, for Settings → Memory. */
export function whereKept(signedIn) {
  return signedIn
    ? 'Saved to your account: your other devices signed in with the same Google account know this too.'
    : 'Kept on this phone only.';
}

/** A fact as it is kept, copied; null for anything broken in the store. */
function readFact(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string') return null;
  return { id: entry.id, text: entry.text, at: Number.isFinite(entry.at) ? entry.at : 0 };
}

/** onChange() is called after each change made on the phone (not after a sync). */
export function createMemory({ store, now = Date.now, newId = () => crypto.randomUUID(), onChange = () => {} }) {
  function list() {
    const saved = store.read('memory', []);
    return Array.isArray(saved) ? saved.map(readFact).filter(Boolean) : [];
  }

  const learning = () => store.read('learn', true) !== false;

  function outbox() {
    const saved = store.read('memoryOutbox', []);
    return Array.isArray(saved) ? saved : [];
  }

  /** `facts` kept, and `op` put in the outbox for the account. */
  function change(facts, op) {
    store.write('memory', facts);
    store.write('memoryOutbox', addToOutbox(outbox(), op));
    onChange();
  }

  return {
    list,
    facts: () => list().map((fact) => fact.text),
    learning,
    outbox,
    /** The account uid the facts belong to, or null when they were never synced. */
    linked: () => store.read('memoryUid', null),

    /** Keep a fact: { id, text }, or null when the rules refuse it, it is known already, or a chat adds it while learning is off. */
    add(text, { source = 'chat' } = {}) {
      if (source === 'chat' && !learning()) return null;
      const clean = cleanFact(text);
      if (!clean) return null;
      const known = list();
      if (known.some((fact) => fact.text.toLowerCase() === clean.toLowerCase())) return null;
      const fact = { id: newId(), text: clean, at: now() };
      change([...known, fact].slice(-MAX_FACTS), { op: 'add', ...fact });
      return { id: fact.id, text: fact.text };
    },

    /** Forget one fact; false when there was none with that id. */
    remove(id) {
      const known = list();
      const left = known.filter((fact) => fact.id !== id);
      if (left.length === known.length) return false;
      change(left, { op: 'forget', id });
      return true;
    },

    /** Forget them all; with none here, nothing is sent (an empty list must not wipe facts this phone never showed). */
    clear() {
      if (list().length) change([], { op: 'clear' });
    },

    /**
     * The server answered `facts` for the account `uid`, having taken the first `sent` changes of `then` (the outbox
     * as it was sent): those leave the outbox, and the account's facts are kept, with the changes made meanwhile on top.
     */
    synced({ uid, facts, then, sent }) {
      const rest = outboxAfter(then, sent, outbox());
      store.write('memoryOutbox', rest);
      store.write('memoryUid', uid);
      store.write('memory', afterSync(factsOf({ facts }), rest));
    },

    /** "Learn about me from chats". Off, a chat saves nothing new. */
    setLearning(on) {
      store.write('learn', Boolean(on));
    },
  };
}

/**
 * Keeps `memory` (createMemory's) and the account's facts the same. uid() is the signed-in person's uid, or null;
 * post(body) is POST /api/memory (api.js); onSynced() after the facts came from the server. One sync at a time: one
 * asked for meanwhile follows it. A failed sync says nothing and keeps the outbox for the next one. Answers
 * { sync, changed, syncIfStale }.
 */
export function startMemorySync({ memory, uid, post, onSynced = () => {}, now = Date.now }) {
  let running = null; // the sync under way
  let again = false;
  let lastSync = 0; // when the last sync succeeded
  let timer = null;

  async function once() {
    const who = uid();
    if (!who) return;
    const then = memory.outbox();
    const { ops, sent } = opsToSend({ uid: who, linked: memory.linked(), facts: memory.list(), outbox: then });
    let answer;
    try {
      answer = await post({ ops });
    } catch {
      return; // offline or refused: the outbox waits for the next sync
    }
    if (uid() !== who || !Array.isArray(answer?.facts)) return; // signed out (or someone else in) meanwhile
    memory.synced({ uid: who, facts: answer.facts, then, sent });
    lastSync = now();
    onSynced();
  }

  /** Sync now; answers when it (and one asked for meanwhile) is done. */
  function sync() {
    clearTimeout(timer);
    timer = null;
    if (running) {
      again = true;
      return running;
    }
    running = (async () => {
      try {
        do {
          again = false;
          await once();
        } while (again);
      } finally {
        running = null;
      }
    })();
    return running;
  }

  return {
    sync,

    /** A change on the phone: synced a moment later, with any that follow it. */
    changed() {
      clearTimeout(timer);
      timer = setTimeout(sync, SYNC_AFTER_CHANGE_MS);
    },

    /** Back in view: a sync when the last one is a while ago. */
    syncIfStale() {
      if (now() - lastSync > STALE_MS) sync();
    },
  };
}
