'use strict';

// Runs against the Firestore emulator: `npm run test:firestore` starts it (firebase emulators:exec) and sets
// FIRESTORE_EMULATOR_HOST. The same expectations as the in-memory fake in test/helpers/fake-db.js.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createFirestoreDb } = require('../../web/lib/firestore-db');

const webRequire = createRequire(path.join(__dirname, '..', '..', 'web', 'package.json'));
const { initializeApp, deleteApp } = webRequire('firebase-admin/app');
const { getFirestore } = webRequire('firebase-admin/firestore');

const PROJECT = 'demo-buddy';
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run this with `npm run test:firestore`, which starts the emulator');

const app = initializeApp({ projectId: PROJECT });
const db = createFirestoreDb(getFirestore(app));

const NOW = new Date('2026-10-07T06:30:00.000Z');
const LATER = new Date('2026-10-07T07:00:00.000Z');
const TODAY = '2026-10-07';
const count = (extra = {}) => db.countRequest({ uid: 'u1', email: 'a@x.com', name: 'A', day: TODAY, now: NOW, limit: null, ...extra });

test.beforeEach(async () => {
  // The emulator's own way to wipe a project's data.
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  assert.ok(res.ok, 'the emulator cleared its data');
});

test.after(() => deleteApp(app));

test('no config yet reads as null; a saved one reads back as saved', async () => {
  assert.strictEqual(await db.getConfig(), null);
  const cfg = { enabled: true, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'm' };
  await db.setConfig(cfg);
  assert.deepStrictEqual(await db.getConfig(), cfg);
});

test('ensureUser adds a person once and follows their email and name', async () => {
  const first = await db.ensureUser({ uid: 'u1', email: 'a@x.com', name: 'A', now: NOW });
  assert.deepStrictEqual(first, { uid: 'u1', email: 'a@x.com', name: 'A', joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });
  const again = await db.ensureUser({ uid: 'u1', email: 'b@x.com', name: 'B', now: LATER });
  assert.deepStrictEqual(again, { ...first, email: 'b@x.com', name: 'B' }, 'joined stays the first day');
  const [stored] = await db.listUsers({ limit: 10 });
  assert.deepStrictEqual([stored.email, stored.name], ['b@x.com', 'B']);
});

test('countRequest counts up to the limit, and a new day starts again from zero', async () => {
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: true, usedCount: 1 }, 'the first request adds the person too');
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: true, usedCount: 2 });
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: false, reason: 'limit', usedCount: 2 });
  assert.deepStrictEqual(await count({ limit: 2, day: '2026-10-08' }), { ok: true, usedCount: 1 });
  assert.deepStrictEqual(await count({ day: '2026-10-08' }), { ok: true, usedCount: 2 }, 'unlimited still counts');
  const [u] = await db.listUsers({ limit: 10 });
  assert.deepStrictEqual([u.usedDay, u.usedCount, u.lastActive], ['2026-10-08', 2, NOW]);
});

test('requests made at the same moment cannot slip past the limit', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => count({ limit: 2 })));
  assert.strictEqual(results.filter((r) => r.ok).length, 2);
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 2);
});

test('refundRequest gives back one request of the same day only', async () => {
  await count();
  await count();
  await db.refundRequest({ uid: 'u1', day: TODAY });
  await db.refundRequest({ uid: 'u1', day: '2026-10-06' });
  await db.refundRequest({ uid: 'nobody', day: TODAY });
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 1);
});

test('a blocked person is not counted; setBlocked answers the person, or null for nobody', async () => {
  await db.ensureUser({ uid: 'u1', email: 'a@x.com', name: 'A', now: NOW });
  assert.strictEqual((await db.setBlocked('u1', true)).blocked, true);
  assert.deepStrictEqual(await count(), { ok: false, reason: 'blocked' });
  assert.strictEqual((await db.setBlocked('u1', false)).blocked, false);
  assert.strictEqual(await db.setBlocked('nobody', true), null);
});

test('setBlocked answers null, not an error, for an id that Firestore cannot have', async () => {
  await db.ensureUser({ uid: 'a', email: 'a@x.com', name: 'A', now: NOW });
  // "a/b", "a//b" and "" make users.doc() throw; "." and ".." and "__x__" are refused by Firestore itself; a lone
  // surrogate is not text; and "/a" and "a/" would be read as the person "a".
  for (const uid of ['a/b', 'a//b', '', '.', '..', '__x__', '\uD800', '/a', 'a/']) {
    assert.strictEqual(await db.setBlocked(uid, true), null, JSON.stringify(uid));
  }
  const [stored] = await db.listUsers({ limit: 10 });
  assert.strictEqual(stored.blocked, false, 'nobody was blocked on the way');
});

test('listUsers: the most recently active first, those who never asked last, up to the limit', async () => {
  await db.ensureUser({ uid: 'never', email: 'n@x.com', name: 'N', now: NOW });
  await db.countRequest({ uid: 'early', email: 'e@x.com', name: 'E', day: TODAY, now: NOW, limit: null });
  await db.countRequest({ uid: 'late', email: 'l@x.com', name: 'L', day: TODAY, now: LATER, limit: null });
  assert.deepStrictEqual((await db.listUsers({ limit: 10 })).map((u) => u.uid), ['late', 'early', 'never']);
  assert.deepStrictEqual((await db.listUsers({ limit: 2 })).map((u) => u.uid), ['late', 'early']);
});
