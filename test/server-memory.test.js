'use strict';

// What Buddy knows about the person, kept with their account: the rules (shared/memory-sync.js) and POST /api/memory.

const test = require('node:test');
const assert = require('node:assert');
const sync = require('../shared/memory-sync');
const { memoryRoute, handle } = require('../web/lib/handlers');
const { fakeDb } = require('./helpers/fake-db');
const { MAX_FACTS } = require('../shared/memory-rules');

const add = (id, text, at = 1) => ({ op: 'add', id, text, at });
const forget = (id) => ({ op: 'forget', id });
const BOSS = { id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1 };
const CITY = { id: 'f2', text: 'You live in Pune.', at: 2 };

// ---- the rules ----

test('adds keep to the memory rules: no secret, nothing twice (by id or in any case), over 50 the oldest goes', () => {
  const { next, result } = sync.applyOps(null, [
    add('f1', BOSS.text), add('f9', 'My password is hunter2'), add('f1', 'Another text, same id'), add('f3', 'YOUR BOSS IS MR. SHARMA.'),
  ]);
  assert.deepStrictEqual(result.facts, [BOSS]);
  assert.deepStrictEqual(next, { facts: [BOSS], gone: [] });

  const many = Array.from({ length: MAX_FACTS + 2 }, (_, i) => add(`n${i}`, `Fact number ${'x'.repeat(i)}.`, i));
  const facts = sync.applyOps(null, many).result.facts;
  assert.strictEqual(facts.length, MAX_FACTS);
  assert.strictEqual(facts[0].id, 'n2', 'the two oldest went');
});

test('a forgotten fact stays forgotten: the same id sent again later (a device that was away) is not added back', () => {
  const doc = sync.applyOps({ facts: [BOSS, CITY] }, [forget('f1')]).next;
  assert.deepStrictEqual(doc, { facts: [CITY], gone: ['f1'] });
  const again = sync.applyOps(doc, [add('f1', BOSS.text)]);
  assert.deepStrictEqual(again.result.facts, [CITY]);
  assert.strictEqual(again.next, undefined, 'nothing changed: not written');
  assert.deepStrictEqual(sync.applyOps(doc, [add('f7', BOSS.text)]).result.facts, [CITY, { ...BOSS, id: 'f7' }], 'learnt again later, as a new fact');
});

test('"forget everything" forgets every fact there is, for every device; no ops only reads', () => {
  const { next, result } = sync.applyOps({ facts: [BOSS, CITY] }, [{ op: 'clear' }, add('f3', 'You like tea.', 3)]);
  assert.deepStrictEqual(result.facts, [{ id: 'f3', text: 'You like tea.', at: 3 }]);
  assert.deepStrictEqual(next.gone, ['f1', 'f2']);
  assert.deepStrictEqual(sync.applyOps({ facts: [BOSS] }, []), { next: undefined, result: { facts: [BOSS] } });
  assert.deepStrictEqual(sync.applyOps(null, [{ op: 'clear' }, forget('nope')]).result.facts, []);
});

test("a device's changes are checked: a list of at most 100, each one right or skipped", () => {
  assert.deepStrictEqual(sync.checkOps(undefined), []);
  assert.deepStrictEqual(sync.checkOps([add('a', 'x'), { op: 'add', id: 'bad id!', text: 'x' }, { op: 'eat' }, forget(''), null, { op: 'clear', id: 9 }]),
    [add('a', 'x'), { op: 'clear' }]);
  assert.deepStrictEqual(sync.checkOps([{ op: 'add', id: 'a', text: 'x', at: 'later' }]), [{ op: 'add', id: 'a', text: 'x', at: 0 }]);
  for (const bad of ['ops', {}, Array(101).fill(forget('a'))]) {
    assert.throws(() => sync.checkOps(bad), { code: 'bad_request' });
  }
});

test('the outbox: one change after another, "forget everything" makes what came before moot, at most 100', () => {
  let box = sync.addToOutbox([], add('a', 'x'));
  box = sync.addToOutbox(box, forget('a'));
  assert.deepStrictEqual(box, [add('a', 'x'), forget('a')]);
  assert.deepStrictEqual(sync.addToOutbox(box, { op: 'clear' }), [{ op: 'clear' }]);
  assert.deepStrictEqual(sync.addToOutbox('broken', forget('b')), [forget('b')]);
  let full = [];
  for (let i = 0; i < 105; i += 1) full = sync.addToOutbox(full, forget(`i${i}`));
  assert.strictEqual(full.length, 100);
  assert.deepStrictEqual(full[0], forget('i5'));
});

test('what a device sends: its outbox for its own account, all its facts the first time, nothing for another account', () => {
  const facts = [BOSS, CITY];
  const outbox = [forget('f1')];
  assert.deepStrictEqual(sync.opsToSend({ uid: 'u1', linked: 'u1', facts, outbox }), { ops: [forget('f1')], sent: 1 });
  assert.deepStrictEqual(sync.opsToSend({ uid: 'u1', linked: null, facts, outbox }), {
    ops: [add('f1', BOSS.text, 1), add('f2', CITY.text, 2)], sent: 1,
  });
  assert.deepStrictEqual(sync.opsToSend({ uid: 'u2', linked: 'u1', facts, outbox }), { ops: [], sent: 1 });
});

test('the outbox after a sync: without what was sent, unless "forget everything" rewrote it meanwhile', () => {
  const then = [forget('a'), forget('b')];
  assert.deepStrictEqual(sync.outboxAfter(then, 2, [...then, forget('c')]), [forget('c')]);
  assert.deepStrictEqual(sync.outboxAfter(then, 0, [...then, forget('c')]), [...then, forget('c')], 'nothing was sent of it');
  assert.deepStrictEqual(sync.outboxAfter(then, 2, [{ op: 'clear' }]), [{ op: 'clear' }]);
  assert.deepStrictEqual(sync.outboxAfter(then, 2, then), []);
});

test("after a sync, the device keeps the server's facts with what it changed meanwhile on top", () => {
  assert.deepStrictEqual(sync.afterSync([BOSS, CITY], [forget('f2'), add('f3', 'You like tea.', 3)]),
    [BOSS, { id: 'f3', text: 'You like tea.', at: 3 }]);
  assert.deepStrictEqual(sync.afterSync([BOSS], []), [BOSS]);
});

// ---- POST /api/memory ----

const TOKENS = { a: { uid: 'u1', email: 'a@gmail.com', name: 'A', emailVerified: true } };

function setup(memories = {}) {
  const db = fakeDb({ memories });
  const deps = {
    db,
    now: () => new Date(1_800_000_000_000),
    verifyToken: async (token) => {
      if (!TOKENS[token]) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return TOKENS[token];
    },
  };
  const run = (method, body, token = 'a') => handle(memoryRoute, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
  return { db, run };
}

test("POST /api/memory applies the device's changes to the account's facts and answers them", async () => {
  const s = setup({ u1: { facts: [BOSS], gone: [] } });
  assert.deepStrictEqual(await s.run('POST', { ops: [add('f2', CITY.text, 2), forget('f1')] }), { status: 200, body: { facts: [CITY] } });
  assert.deepStrictEqual(s.db.state.memories.u1, { facts: [CITY], gone: ['f1'] });
  assert.deepStrictEqual(await s.run('POST', undefined), { status: 200, body: { facts: [CITY] } }, 'no body: just the facts');
});

test('POST /api/memory: signed in only, POST only, and a list of changes only', async () => {
  const s = setup();
  assert.strictEqual((await s.run('POST', {}, null)).status, 401);
  assert.strictEqual((await s.run('GET', {})).status, 405);
  const bad = await s.run('POST', { ops: 'clear' });
  assert.deepStrictEqual(bad, { status: 400, body: { error: { code: 'bad_request', message: "Buddy couldn't save what it knows about you. Try again." } } });
  assert.deepStrictEqual(await s.run('POST', {}), { status: 200, body: { facts: [] } }, 'nobody has facts yet: none');
  assert.deepStrictEqual(s.db.state.memories, {}, 'and nothing written');
});
