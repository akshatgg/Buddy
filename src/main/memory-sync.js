'use strict';

/**
 * What Buddy knows about the person, kept with their account (shared/memory-sync.js has the rules): while someone is
 * signed in, this computer sends its changes to Buddy's server and keeps the facts the server answers, so that their
 * other computers and their phones know the same facts. Signed out, the facts stay on this computer, and the changes
 * made meanwhile go to the server at the next sign-in.
 *
 * It syncs when Buddy starts or someone signs in, a second after each change made here, when Settings → Memory opens,
 * and when the panel opens and the last sync is over two minutes old. Never on a timer: each sync is a read of the
 * account's record, and the server's database counts those.
 */

const { opsToSend, outboxAfter, afterSync, factsOf } = require('../../shared/memory-sync');

const AFTER_CHANGE_MS = 1000;
const STALE_MS = 2 * 60_000;
// The server out of reach, or the person signed out meanwhile: the changes wait in the outbox for the next sync.
const QUIET = ['network', 'timeout', 'server', 'signed_out', 'not_set_up'];

/** `memory` is memory.js's, `cloud` cloud.js's (memory) and `account` account.js's (user). The timers are passed in by the unit tests. */
function createMemorySync({ memory, store, account, cloud, now = Date.now, later = setTimeout, cancel = clearTimeout }) {
  let running = null; // the sync in progress
  let again = false; // asked for once more while one was running
  let syncedAt = 0;
  let soon = null;

  async function run() {
    const uid = account.user()?.uid;
    if (!uid) return;
    const outbox = store.get('memoryOutbox');
    const { ops, sent } = opsToSend({ uid, linked: store.get('memoryUid') ?? null, facts: memory.list(), outbox });
    const j = await cloud.memory(ops);
    if (account.user()?.uid !== uid) return; // signed out, or someone else signed in, meanwhile
    const rest = outboxAfter(outbox, sent, store.get('memoryOutbox'));
    memory.replace(afterSync(factsOf(j), rest), { memoryOutbox: rest, memoryUid: uid });
    syncedAt = now();
  }

  /** Sync now (after the one running, when there is one). Never throws. */
  function sync() {
    if (running) {
      again = true;
      return running;
    }
    running = run()
      .catch((err) => {
        if (!QUIET.includes(err?.code)) console.warn('[buddy] could not sync what Buddy knows:', err?.code || err?.name);
      })
      .finally(() => {
        running = null;
        if (again) {
          again = false;
          sync();
        }
      });
    return running;
  }

  memory.onLocalChange(() => {
    if (soon) cancel(soon);
    soon = later(() => {
      soon = null;
      sync();
    }, AFTER_CHANGE_MS);
    soon.unref?.();
  });

  return {
    sync,
    /** The panel opened: sync when the last one is over two minutes old. */
    syncIfStale() {
      if (now() - syncedAt > STALE_MS) sync();
    },
  };
}

module.exports = { createMemorySync, AFTER_CHANGE_MS, STALE_MS };
