'use strict';

// What Buddy knows about the person, kept with their account on the Mac and Windows (src/main/memory-sync.js), with
// memory.js on a real store and a fake server that keeps the account's record by the shared rules.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, DEFAULTS } = require('../src/main/store');
const { createMemory } = require('../src/main/memory');
const { createMemorySync, AFTER_CHANGE_MS, STALE_MS } = require('../src/main/memory-sync');
const { applyOps } = require('../shared/memory-sync');
const { BuddyError } = require('../shared/errors');

const PHONE = { id: 'p1', text: 'You live in Pune.', at: 5 };

function setup(t, { uid = 'u1', record = null, stored } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-memory-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const store = createStore({ file: path.join(dir, 'settings.json') });
  if (stored) store.set(stored);
  let ids = 0;
  let clock = 1_000_000;
  const memory = createMemory({ store, newId: () => `f${++ids}`, now: () => (clock += 1000) });
  const user = { uid };
  const account = { user: () => (user.uid ? { uid: user.uid } : null) };
  const server = {
    records: { [uid]: record },
    sent: [],
    fail: null,
    hold: null, // a promise the next answer waits for
    async memory(ops) {
      server.sent.push(ops);
      const who = user.uid;
      if (server.hold) await server.hold;
      if (server.fail) throw server.fail;
      const { next, result } = applyOps(server.records[who] ?? null, ops);
      if (next !== undefined) server.records[who] = next;
      return result;
    },
  };
  const timers = [];
  let time = 0;
  const sync = createMemorySync({
    memory, store, account, cloud: server, now: () => time,
    later: (fn, ms) => { const timer = { fn, ms }; timers.push(timer); return timer; },
    cancel: (timer) => { timer.cancelled = true; },
  });
  const settle = async () => {
    for (let i = 0; i < 5; i += 1) await new Promise((resolve) => setImmediate(resolve));
  };
  /** The timer's sync, as it runs a second after a change, and its answer. */
  const fire = async () => {
    for (const timer of timers.splice(0)) if (!timer.cancelled) timer.fn();
    await settle();
  };
  return { store, memory, sync, server, user, timers, fire, settle, setTime: (ms) => { time = ms; } };
}

test('a new store has no outbox and is kept with no account yet', () => {
  assert.deepStrictEqual(DEFAULTS.memoryOutbox, []);
  assert.strictEqual(DEFAULTS.memoryUid, null);
});

test('every change goes into the outbox, signed in or not, and a sync is asked for a second later', (t) => {
  const s = setup(t);
  const fact = s.memory.add('Your boss is Mr. Sharma.');
  s.memory.remove(fact.id);
  assert.deepStrictEqual(s.store.get('memoryOutbox').map((op) => op.op), ['add', 'forget']);
  assert.strictEqual(s.timers.length, 2);
  assert.strictEqual(s.timers[0].cancelled, true, 'one sync for changes close together');
  assert.strictEqual(s.timers[1].ms, AFTER_CHANGE_MS);
  s.memory.clear(); // nothing to forget: no change
  assert.strictEqual(s.timers.length, 2);
});

test("the first sync: what this computer knew joins the account's facts, and it keeps them all", async (t) => {
  const s = setup(t, { record: { facts: [PHONE], gone: [] } });
  s.memory.add('Your boss is Mr. Sharma.');
  await s.fire();
  assert.deepStrictEqual(s.server.sent, [[{ op: 'add', id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1_001_000 }]]);
  assert.deepStrictEqual(s.memory.facts(), ['You live in Pune.', 'Your boss is Mr. Sharma.']);
  assert.deepStrictEqual(s.server.records.u1.facts.map((f) => f.text), ['You live in Pune.', 'Your boss is Mr. Sharma.']);
  assert.deepStrictEqual(s.store.get('memoryOutbox'), []);
  assert.strictEqual(s.store.get('memoryUid'), 'u1');
});

test('later syncs send only the changes; one forgotten on another device is gone here too', async (t) => {
  const s = setup(t, { record: { facts: [PHONE], gone: [] } });
  await s.sync.sync();
  const fact = s.memory.add('You like tea.');
  await s.fire();
  assert.deepStrictEqual(s.server.sent.at(-1), [{ op: 'add', id: fact.id, text: 'You like tea.', at: 1_001_000 }]);
  // The phone forgets "You live in Pune.".
  s.server.records.u1 = applyOps(s.server.records.u1, [{ op: 'forget', id: 'p1' }]).next;
  await s.sync.sync();
  assert.deepStrictEqual(s.server.sent.at(-1), []);
  assert.deepStrictEqual(s.memory.facts(), ['You like tea.']);
});

test('offline: the changes wait in the outbox, and go with the next sync', async (t) => {
  const s = setup(t, { stored: { memoryUid: 'u1' } });
  s.server.fail = new BuddyError('network', "Couldn't reach Buddy's server.");
  s.memory.add('You like tea.');
  await s.fire();
  assert.strictEqual(s.store.get('memoryOutbox').length, 1);
  assert.deepStrictEqual(s.memory.facts(), ['You like tea.'], 'still known here');
  s.server.fail = null;
  await s.sync.sync();
  assert.deepStrictEqual(s.store.get('memoryOutbox'), []);
  assert.deepStrictEqual(s.server.records.u1.facts.map((f) => f.text), ['You like tea.']);
});

test('a change made while a sync is on its way is kept, and sent with the next one', async (t) => {
  const s = setup(t, { stored: { memoryUid: 'u1' } });
  s.memory.add('You like tea.');
  let go;
  s.server.hold = new Promise((resolve) => { go = resolve; });
  const first = s.sync.sync();
  s.memory.add('You live in Pune.');
  s.server.hold = null;
  go();
  await first;
  assert.deepStrictEqual(s.memory.facts(), ['You like tea.', 'You live in Pune.'], 'not lost to the answer');
  await s.fire(); // the sync the second change asked for, a second later
  assert.deepStrictEqual(s.server.records.u1.facts.map((f) => f.text), ['You like tea.', 'You live in Pune.']);
  assert.deepStrictEqual(s.store.get('memoryOutbox'), []);
});

test("signed out: nothing is sent; someone else signs in: this computer takes their facts, and the first person's stay theirs", async (t) => {
  const s = setup(t, { uid: null });
  s.memory.add('You like tea.');
  await s.sync.sync();
  assert.deepStrictEqual(s.server.sent, []);

  s.user.uid = 'u1';
  await s.sync.sync();
  assert.deepStrictEqual(s.server.records.u1.facts.map((f) => f.text), ['You like tea.']);

  s.user.uid = 'u2';
  s.server.records.u2 = { facts: [PHONE], gone: [] };
  s.memory.add('Your boss is Mr. Sharma.'); // made for u1 while u2 signed in: not sent to u2
  await s.sync.sync();
  assert.deepStrictEqual(s.server.sent.at(-1), []);
  assert.deepStrictEqual(s.memory.facts(), ['You live in Pune.']);
  assert.strictEqual(s.store.get('memoryUid'), 'u2');
  assert.deepStrictEqual(s.server.records.u1.facts.map((f) => f.text), ['You like tea.']);
});

test('an answer for someone who signed out meanwhile is not kept', async (t) => {
  const s = setup(t, { record: { facts: [PHONE], gone: [] } });
  let go;
  s.server.hold = new Promise((resolve) => { go = resolve; });
  const pending = s.sync.sync();
  s.user.uid = null;
  go();
  await pending;
  assert.deepStrictEqual(s.memory.facts(), []);
  assert.strictEqual(s.store.get('memoryUid'), null);
});

test('the panel opening syncs only when the last sync is over two minutes old', async (t) => {
  const s = setup(t);
  await s.sync.sync();
  const before = s.server.sent.length;
  s.setTime(STALE_MS);
  s.sync.syncIfStale();
  await s.sync.sync();
  assert.strictEqual(s.server.sent.length, before + 1, 'only the explicit one');
  s.setTime(2 * STALE_MS + 1);
  s.sync.syncIfStale();
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(s.server.sent.length, before + 2);
});

test('an unexpected failure is logged by its kind only; the quiet ones are not', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup(t);
  s.server.fail = new BuddyError('network', 'offline');
  await s.sync.sync();
  assert.strictEqual(warn.mock.callCount(), 0);
  s.server.fail = new BuddyError('bad_request', 'secret words');
  await s.sync.sync();
  assert.deepStrictEqual(warn.mock.calls[0].arguments, ['[buddy] could not sync what Buddy knows:', 'bad_request']);
});
