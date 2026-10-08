'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore, DEFAULTS } = require('../src/main/store');
const { createMemory } = require('../src/main/memory');
const { MAX_FACTS } = require('../shared/memory-rules');

/** A real store in a fresh temporary folder, which is removed when the test ends. */
function tmpStore(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-memory-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'settings.json');
  return { store: createStore({ file }), file };
}

/** createMemory on a real store, with ids f1, f2, … and a clock that moves one second per fact. */
function setup(t, { stored } = {}) {
  const { store, file } = tmpStore(t);
  if (stored) store.set(stored);
  let ids = 0;
  let clock = 1_000_000;
  const memory = createMemory({ store, newId: () => `f${++ids}`, now: () => (clock += 1000) });
  return { memory, store, file };
}

test('a new store knows nothing yet, and learns from chats', () => {
  assert.deepStrictEqual(DEFAULTS.memory, []);
  assert.strictEqual(DEFAULTS.learnFromChats, true);
});

test('add keeps a fact, and list and facts answer it, oldest first', (t) => {
  const { memory } = setup(t);
  assert.deepStrictEqual(memory.list(), []);
  assert.deepStrictEqual(memory.facts(), []);
  assert.deepStrictEqual(memory.add('Your boss is Mr. Sharma.'), { id: 'f1', text: 'Your boss is Mr. Sharma.' });
  assert.deepStrictEqual(memory.add('  You work at Infosys.\n'), { id: 'f2', text: 'You work at Infosys.' });
  assert.deepStrictEqual(memory.list(), [
    { id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1_001_000 },
    { id: 'f2', text: 'You work at Infosys.', at: 1_002_000 },
  ]);
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.', 'You work at Infosys.']);
});

test('the facts are saved in the settings file, and are there after a restart', (t) => {
  const { memory, file } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  const again = createMemory({ store: createStore({ file }) });
  assert.deepStrictEqual(again.facts(), ['Your boss is Mr. Sharma.']);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).memory, [{ id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1_001_000 }]);
});

test('ids are made with crypto.randomUUID and times with Date.now unless others are given', (t) => {
  const { store } = tmpStore(t);
  const before = Date.now();
  const added = createMemory({ store }).add('Your city is Pune.');
  assert.match(added.id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
  const { at } = createMemory({ store }).list()[0];
  assert.ok(at >= before && at <= Date.now());
});

test('a fact already known is not saved again, whatever its case', (t) => {
  const { memory } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  assert.strictEqual(memory.add('your BOSS is mr. sharma.'), null);
  assert.strictEqual(memory.add('  Your boss is   Mr. Sharma. '), null, 'nor with other spaces around and in it');
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.']);
});

test('a fact the rules refuse is not saved', (t) => {
  const { memory } = setup(t);
  for (const fact of ['', '   ', 'Your PIN is 1234.', 'Your card is 4111 1111 1111 1111.', 'a'.repeat(201), null, 7]) {
    assert.strictEqual(memory.add(fact), null, JSON.stringify(fact));
    assert.strictEqual(memory.add(fact, { source: 'settings' }), null, `${JSON.stringify(fact)} from Settings`);
  }
  assert.deepStrictEqual(memory.list(), []);
});

test('there are at most 50 facts: a new one pushes out the oldest', (t) => {
  const { memory } = setup(t);
  for (let i = 1; i <= MAX_FACTS; i += 1) memory.add(`Fact number ${i}.`);
  assert.strictEqual(memory.list().length, 50);
  assert.deepStrictEqual(memory.add('One more fact.'), { id: 'f51', text: 'One more fact.' });
  const facts = memory.facts();
  assert.strictEqual(facts.length, 50);
  assert.strictEqual(facts[0], 'Fact number 2.', 'the oldest went');
  assert.strictEqual(facts.at(-1), 'One more fact.');
});

test('with learning off, the chat saves nothing new, Settings still can, and what is known is still used', (t) => {
  const { memory, store } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  assert.strictEqual(memory.learning(), true);
  memory.setLearning(false);
  assert.strictEqual(memory.learning(), false);
  assert.strictEqual(store.get('learnFromChats'), false, 'saved in the settings');
  assert.strictEqual(memory.add('Your city is Pune.'), null, 'a chat is the source when none is given');
  assert.strictEqual(memory.add('Your city is Pune.', { source: 'chat' }), null);
  assert.deepStrictEqual(memory.add('Your city is Pune.', { source: 'settings' }), { id: 'f2', text: 'Your city is Pune.' });
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.', 'Your city is Pune.']);
  memory.setLearning(true);
  assert.deepStrictEqual(memory.add('You work at Infosys.'), { id: 'f3', text: 'You work at Infosys.' });
});

test('remove forgets one fact by its id, and says whether there was one', (t) => {
  const { memory } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  memory.add('Your city is Pune.');
  assert.strictEqual(memory.remove('f1'), true);
  assert.deepStrictEqual(memory.facts(), ['Your city is Pune.']);
  assert.strictEqual(memory.remove('f1'), false, 'already gone');
  assert.strictEqual(memory.remove('nope'), false);
  assert.strictEqual(memory.remove(undefined), false);
  assert.deepStrictEqual(memory.facts(), ['Your city is Pune.']);
  assert.deepStrictEqual(memory.add('Your boss is Mr. Sharma.'), { id: 'f3', text: 'Your boss is Mr. Sharma.' }, 'a forgotten fact can be learnt again');
});

test('clear forgets everything, and leaves the learning switch as it is', (t) => {
  const { memory } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  memory.add('Your city is Pune.');
  memory.setLearning(false);
  memory.clear();
  assert.deepStrictEqual(memory.list(), []);
  assert.strictEqual(memory.learning(), false);
});

test('onChange hears the list after every change, and nothing when nothing changed', (t) => {
  const { memory } = setup(t);
  const heard = [];
  memory.onChange((list) => heard.push(list.map((f) => f.text)));
  memory.add('Your boss is Mr. Sharma.');
  memory.add('Your boss is Mr. Sharma.'); // known already
  memory.add('Your PIN is 1234.'); // refused
  memory.add('Your city is Pune.');
  memory.remove('f1');
  memory.remove('f1'); // gone already
  memory.setLearning(false);
  memory.setLearning(false); // off already
  memory.add('You work at Infosys.'); // learning is off
  memory.clear();
  memory.clear(); // nothing left
  assert.deepStrictEqual(heard, [
    ['Your boss is Mr. Sharma.'],
    ['Your boss is Mr. Sharma.', 'Your city is Pune.'],
    ['Your city is Pune.'],
    ['Your city is Pune.'], // the switch changed: the list is the same
    [],
  ]);
});

test('what list answers is a copy: changing it does not change what is known', (t) => {
  const { memory } = setup(t);
  memory.add('Your boss is Mr. Sharma.');
  memory.list()[0].text = 'changed';
  memory.list().push({ id: 'x', text: 'pushed', at: 0 });
  memory.facts().push('pushed');
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.']);
});

test('a settings file with a damaged memory still works: what is not a fact is left out', (t) => {
  const { memory } = setup(t, {
    stored: {
      memory: [
        { id: 'a', text: 'Your boss is Mr. Sharma.', at: 5 },
        null,
        'a bare string',
        { id: 7, text: 'a number for an id', at: 6 },
        { id: 'b', text: 42, at: 7 },
        { id: 'c', text: 'Your city is Pune.' },
      ],
    },
  });
  assert.deepStrictEqual(memory.list(), [
    { id: 'a', text: 'Your boss is Mr. Sharma.', at: 5 },
    { id: 'c', text: 'Your city is Pune.', at: 0 },
  ]);
  const notAList = setup(t, { stored: { memory: { not: 'a list' } } }).memory;
  assert.deepStrictEqual(notAList.list(), []);
  assert.deepStrictEqual(notAList.add('Your city is Pune.'), { id: 'f1', text: 'Your city is Pune.' });
});

test('a learning setting that is not false counts as on', (t) => {
  assert.strictEqual(setup(t, { stored: { learnFromChats: undefined } }).memory.learning(), true);
  assert.strictEqual(setup(t, { stored: { learnFromChats: false } }).memory.learning(), false);
});
