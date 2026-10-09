// Buddy on iPhone: what the phone keeps (web/public/app/store.js) and what Buddy remembers there (memory.js).

import test from 'node:test';
import assert from 'node:assert';
import { createStore, localStorageOf } from '../web/public/app/store.js';
import { createMemory } from '../web/public/app/memory.js';

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
