// Buddy on iPhone: what the phone keeps (web/public/app/store.js), what Buddy remembers there (memory.js), and how
// that is kept with the person's account (startMemorySync).

import test from 'node:test';
import assert from 'node:assert';
import { createStore, localStorageOf } from '../web/public/app/store.js';
import { createMemory, startMemorySync, whereKept } from '../web/public/app/memory.js';
import { applyOps, checkOps } from '../web/public/app/shared/memory-sync.js';

/** A storage like the page's, in a Map: `broken` makes every call throw, as Safari's private tabs once did. */
function fakeStorage(entries = {}, { broken = false } = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    localStorage: {
      getItem: (key) => {
        if (broken) throw new Error('SecurityError');
        return map.has(key) ? map.get(key) : null;
      },
      setItem: (key, value) => {
        if (broken) throw new Error('QuotaExceededError');
        map.set(key, String(value));
      },
    },
  };
}

function setup(entries = {}) {
  const win = fakeStorage(entries);
  const store = createStore(localStorageOf(win));
  let n = 0;
  let t = 1000;
  const memory = createMemory({ store, newId: () => `f${(n += 1)}`, now: () => (t += 1) });
  return { win, store, memory };
}

test('the store keeps JSON under buddy.<key>, and answers the fallback for nothing kept or something broken', () => {
  const { win, store } = setup({ 'buddy.broken': '{nope' });
  assert.strictEqual(store.read('buddy', 'boy-1'), 'boy-1');
  store.write('buddy', 'girl-1');
  assert.strictEqual(win.map.get('buddy.buddy'), '"girl-1"');
  assert.strictEqual(store.read('buddy', 'boy-1'), 'girl-1');
  assert.strictEqual(store.read('broken', 7), 7);
});

test('a browser that keeps nothing never throws: the app works on and forgets', () => {
  const store = createStore(localStorageOf(fakeStorage({}, { broken: true })));
  store.write('buddy', 'girl-1');
  assert.strictEqual(store.read('buddy', 'boy-1'), 'boy-1');
});

test('memory keeps clean facts, oldest first, and sends their words with each chat', () => {
  const { memory } = setup();
  assert.deepStrictEqual(memory.add('  Your boss is\nMr. Sharma.  '), { id: 'f1', text: 'Your boss is Mr. Sharma.' });
  assert.deepStrictEqual(memory.add('You work at Infosys.'), { id: 'f2', text: 'You work at Infosys.' });
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.', 'You work at Infosys.']);
  assert.deepStrictEqual(memory.list().map((f) => f.at), [1001, 1002]);
});

test('memory never keeps a secret, an empty fact, or one it knows already (in any letter case)', () => {
  const { memory } = setup();
  assert.strictEqual(memory.add('My password is hunter2.'), null);
  assert.strictEqual(memory.add('Card 4111 1111 1111 1111'), null);
  assert.strictEqual(memory.add('   '), null);
  memory.add('You like tea.');
  assert.strictEqual(memory.add('YOU LIKE TEA.'), null);
  assert.deepStrictEqual(memory.facts(), ['You like tea.']);
});

test('memory keeps at most 50 facts: the oldest goes', () => {
  const { memory } = setup();
  for (let i = 0; i < 52; i += 1) memory.add(`Fact number ${i}.`);
  const facts = memory.facts();
  assert.strictEqual(facts.length, 50);
  assert.strictEqual(facts[0], 'Fact number 2.');
  assert.strictEqual(facts[49], 'Fact number 51.');
});

test('with learning off a chat adds nothing, but Settings still can; facts can be forgotten one by one or all', () => {
  const { memory } = setup();
  assert.strictEqual(memory.learning(), true, 'on until switched off');
  memory.setLearning(false);
  assert.strictEqual(memory.learning(), false);
  assert.strictEqual(memory.add('You live in Pune.'), null);
  const typed = memory.add('You live in Pune.', { source: 'settings' });
  assert.ok(typed);
  memory.add('You have a dog.', { source: 'settings' });
  assert.strictEqual(memory.remove(typed.id), true);
  assert.strictEqual(memory.remove(typed.id), false);
  assert.deepStrictEqual(memory.facts(), ['You have a dog.']);
  memory.clear();
  assert.deepStrictEqual(memory.facts(), []);
});

test('memory skips what is broken in the store', () => {
  const { memory } = setup({ 'buddy.memory': JSON.stringify([{ id: 'a', text: 'Kept.', at: 5 }, { id: 2, text: 'x' }, null, 'y', { id: 'b', text: 'No time.' }]) });
  assert.deepStrictEqual(memory.list(), [{ id: 'a', text: 'Kept.', at: 5 }, { id: 'b', text: 'No time.', at: 0 }]);
  const { memory: odd } = setup({ 'buddy.memory': '"not a list"' });
  assert.deepStrictEqual(odd.list(), []);
});

// ---- kept with the account (shared/memory-sync.js) ----

/** Buddy's server's POST /api/memory for one account, as web/lib/handlers.js answers it: `calls` are the ops sent. */
function fakeServer(facts = []) {
  const server = { doc: { facts, gone: [] }, calls: [], fail: false };
  server.post = async ({ ops }) => {
    server.calls.push(ops);
    if (server.fail) throw new Error('No internet.');
    const { next, result } = applyOps(server.doc, checkOps(ops));
    if (next) server.doc = next;
    return result;
  };
  return server;
}

function syncSetup({ entries = {}, facts = [], uid = 'u1' } = {}) {
  const { store, memory } = setup(entries);
  const server = fakeServer(facts);
  const who = { uid };
  let synced = 0;
  let t = 0;
  const clock = { now: () => t, later: (ms) => (t += ms) };
  const sync = startMemorySync({ memory, uid: () => who.uid, post: (body) => server.post(body), onSynced: () => (synced += 1), now: clock.now });
  return { store, memory, server, who, sync, synced: () => synced, clock };
}

test('every change goes in the outbox, signed in or not; "Forget everything" makes what came before moot', () => {
  let changes = 0;
  const { store } = setup();
  const memory = createMemory({ store, newId: () => `id${changes}`, now: () => 7, onChange: () => (changes += 1) });
  memory.add('You like tea.');
  memory.add('You have a dog.', { source: 'settings' });
  memory.remove('id0');
  assert.deepStrictEqual(memory.outbox(), [
    { op: 'add', id: 'id0', text: 'You like tea.', at: 7 },
    { op: 'add', id: 'id1', text: 'You have a dog.', at: 7 },
    { op: 'forget', id: 'id0' },
  ]);
  assert.strictEqual(memory.add('My password is hunter2.'), null);
  assert.strictEqual(memory.remove('nope'), false);
  assert.strictEqual(changes, 3, 'only what changed counts');
  memory.clear();
  assert.deepStrictEqual(memory.outbox(), [{ op: 'clear' }]);
  assert.strictEqual(changes, 4);
  assert.strictEqual(memory.linked(), null, 'never synced');
});

test('the first sync with an account sends every fact, and keeps the account\'s facts with them', async () => {
  const { memory, server, sync, synced } = syncSetup({ facts: [{ id: 'mac1', text: 'You work at Infosys.', at: 5 }] });
  memory.add('You like tea.');
  memory.add('You like tea, a lot.');
  memory.remove('f2');
  await sync.sync();
  assert.deepStrictEqual(server.calls, [[{ op: 'add', id: 'f1', text: 'You like tea.', at: 1001 }]], 'the facts, not the outbox');
  assert.deepStrictEqual(memory.facts(), ['You work at Infosys.', 'You like tea.']);
  assert.deepStrictEqual(memory.outbox(), []);
  assert.strictEqual(memory.linked(), 'u1');
  assert.strictEqual(synced(), 1);
});

test('later syncs send the outbox only, and take what other devices changed', async () => {
  const { memory, server, sync } = syncSetup();
  memory.add('You like tea.');
  await sync.sync();
  memory.add('You have a dog.');
  server.doc = applyOps(server.doc, [{ op: 'add', id: 'win1', text: 'You live in Pune.', at: 3 }]).next; // from Windows
  await sync.sync();
  assert.deepStrictEqual(server.calls[1], [{ op: 'add', id: 'f2', text: 'You have a dog.', at: 1002 }]);
  assert.deepStrictEqual(memory.facts(), ['You like tea.', 'You live in Pune.', 'You have a dog.']);
  memory.remove('win1');
  await sync.sync();
  assert.deepStrictEqual(server.calls[2], [{ op: 'forget', id: 'win1' }]);
  assert.deepStrictEqual(server.doc.facts.map((f) => f.text), ['You like tea.', 'You have a dog.']);
  await sync.sync();
  assert.deepStrictEqual(server.calls[3], [], 'nothing to send: only a read');
});

test('changes made while a sync is under way stay in the outbox, a "Forget everything" too, and are kept on top', async () => {
  const { memory, server, sync, store } = syncSetup();
  memory.add('You like tea.');
  await sync.sync();
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  const post = server.post;
  server.post = async (body) => {
    await gate;
    return post(body);
  };
  memory.add('You have a dog.');
  const first = sync.sync();
  memory.add('You live in Pune.'); // after the outbox was sent
  open();
  await first;
  assert.deepStrictEqual(memory.outbox(), [{ op: 'add', id: 'f3', text: 'You live in Pune.', at: 1003 }]);
  assert.deepStrictEqual(memory.facts(), ['You like tea.', 'You have a dog.', 'You live in Pune.']);

  let openAgain;
  const gateAgain = new Promise((resolve) => (openAgain = resolve));
  server.post = async (body) => {
    await gateAgain;
    return post(body);
  };
  const second = sync.sync();
  memory.clear();
  openAgain();
  await second;
  assert.deepStrictEqual(store.read('memoryOutbox'), [{ op: 'clear' }], 'the clear is still to be sent');
  assert.deepStrictEqual(memory.facts(), []);
  server.post = post;
  await sync.sync();
  assert.deepStrictEqual(server.doc.facts, []);
  assert.deepStrictEqual(memory.outbox(), []);
});

test('signed in with another account, the phone sends nothing and takes that account\'s facts in place of its own', async () => {
  const { memory, server, sync, who } = syncSetup({ facts: [{ id: 'a1', text: 'You like tea.', at: 1 }] });
  await sync.sync();
  memory.add('You have a dog.');
  const other = fakeServer([{ id: 'b1', text: 'You drive a Tesla.', at: 2 }]);
  server.post = other.post;
  who.uid = 'u2';
  await sync.sync();
  assert.deepStrictEqual(other.calls, [[]]);
  assert.deepStrictEqual(memory.facts(), ['You drive a Tesla.']);
  assert.strictEqual(memory.linked(), 'u2');
  assert.deepStrictEqual(memory.outbox(), []);
});

test('a sync fails quietly and keeps the outbox; signed out there is none; an answer for someone signed out is dropped', async () => {
  const { memory, server, sync, who, synced } = syncSetup();
  memory.add('You like tea.');
  server.fail = true;
  await sync.sync();
  assert.strictEqual(server.calls.length, 1);
  assert.strictEqual(memory.outbox().length, 1);
  assert.strictEqual(memory.linked(), null);
  assert.strictEqual(synced(), 0);

  who.uid = null;
  await sync.sync();
  assert.strictEqual(server.calls.length, 1, 'signed out: no call');

  who.uid = 'u1';
  server.fail = false;
  const post = server.post;
  server.post = async (body) => {
    const answer = await post(body);
    who.uid = null; // signed out while it was asked
    return answer;
  };
  await sync.sync();
  assert.strictEqual(memory.linked(), null);
  assert.strictEqual(memory.outbox().length, 1);
});

test('one sync at a time: one asked for meanwhile follows it, once', async () => {
  const { memory, server, sync } = syncSetup();
  let open;
  const gate = new Promise((resolve) => (open = resolve));
  const post = server.post;
  let at = 0;
  let most = 0;
  server.post = async (body) => {
    at += 1;
    most = Math.max(most, at);
    await gate;
    at -= 1;
    return post(body);
  };
  memory.add('You like tea.');
  const first = sync.sync();
  memory.add('You have a dog.');
  sync.sync();
  sync.sync();
  open();
  await first;
  assert.strictEqual(server.calls.length, 2);
  assert.strictEqual(most, 1);
  assert.deepStrictEqual(server.doc.facts.map((f) => f.text), ['You like tea.', 'You have a dog.']);
});

test('changes sync a second after the last one, and coming back to the app syncs when the last sync is 2 minutes old', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { memory, server, sync, clock } = syncSetup();
  memory.add('You like tea.');
  sync.changed();
  t.mock.timers.tick(600);
  memory.add('You have a dog.');
  sync.changed();
  t.mock.timers.tick(999);
  assert.strictEqual(server.calls.length, 0);
  t.mock.timers.tick(1);
  await sync.sync(); // waits for the one under way, then one more (nothing to send)
  assert.strictEqual(server.calls[0].length, 2, 'both in one sync');

  const before = server.calls.length;
  clock.later(60_000);
  sync.syncIfStale();
  assert.strictEqual(server.calls.length, before, 'a minute: not yet');
  clock.later(61_000);
  sync.syncIfStale();
  await sync.sync();
  assert.ok(server.calls.length > before);
});

test('Settings says where the facts are kept', () => {
  assert.match(whereKept(true), /your account/);
  assert.match(whereKept(true), /other devices/);
  assert.match(whereKept(false), /this phone/);
});
