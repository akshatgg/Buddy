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
const refund = (extra = {}) => db.refundRequest({ uid: 'u1', day: TODAY, limit: 10, ...extra });

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
  assert.deepStrictEqual(await refund(), { ok: true, refundCount: 1 });
  assert.deepStrictEqual(await refund({ day: '2026-10-06' }), { ok: false, reason: 'not_counted' });
  assert.deepStrictEqual(await refund({ uid: 'nobody' }), { ok: false, reason: 'not_counted' });
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 1);
  assert.deepStrictEqual(await refund(), { ok: true, refundCount: 2 });
  assert.deepStrictEqual(await refund(), { ok: false, reason: 'not_counted' }, 'nothing is left to give back');
});

test('refundRequest gives back at most `limit` requests a day, and a new day starts again from zero', async () => {
  for (let i = 0; i < 3; i += 1) await count();
  assert.deepStrictEqual(await refund({ limit: 2 }), { ok: true, refundCount: 1 });
  assert.deepStrictEqual(await refund({ limit: 2 }), { ok: true, refundCount: 2 });
  assert.deepStrictEqual(await refund({ limit: 2 }), { ok: false, reason: 'limit', refundCount: 2 });
  let [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 1, 'past the limit the request stays counted');
  await count({ day: '2026-10-08' });
  assert.deepStrictEqual(await refund({ limit: 2, day: '2026-10-08' }), { ok: true, refundCount: 1 });
  [u] = await db.listUsers({ limit: 10 });
  assert.deepStrictEqual([u.usedDay, u.usedCount], ['2026-10-08', 0]);
});

test('give-backs made at the same moment cannot slip past the limit', async () => {
  for (let i = 0; i < 4; i += 1) await count();
  const results = await Promise.all(Array.from({ length: 4 }, () => refund({ limit: 2 })));
  assert.strictEqual(results.filter((r) => r.ok).length, 2);
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 2);
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

test("Claude mode's record: written, read back the same, left alone, and deleted, as the change says", async () => {
  const remote = require('../../web/lib/remote');
  const T = 1_800_000_000_000;
  const S1 = { id: 'aaaa-1111', name: 'shop', status: 'working', canTalk: true };
  const MAC = { id: 'mac-11111111', name: 'Mac' };
  const ITEMS = [{ id: 1, kind: 'you', text: 'fix it' }, { id: 2, kind: 'result', text: 'boom', error: true }];
  assert.deepStrictEqual(await db.updateRemote('u1', (doc) => remote.macReport(doc, { device: MAC, sessions: [S1] }, T)), { watch: null, inbox: [] });
  const look = await db.updateRemote('u1', (doc) => remote.phoneLook(doc, S1.id, T + 1000));
  assert.deepStrictEqual(look, { online: true, sessions: [{ ...S1, device: 'Mac' }], feed: null });
  const told = await db.updateRemote('u1', (doc) => remote.macReport(doc, { device: MAC, sessions: [S1], feed: { ...S1, items: ITEMS } }, T + 2000));
  assert.strictEqual(told.watch, S1.id);
  const watched = await db.updateRemote('u1', (doc) => remote.phoneLook(doc, S1.id, T + 3000));
  assert.deepStrictEqual(watched.feed, { id: S1.id, device: 'Mac', name: 'shop', status: 'working', canTalk: true, items: ITEMS });
  await db.updateRemote('u1', (doc) => remote.phoneSend(doc, { sessionId: S1.id, text: 'go on', id: 'm1' }, T + 4000));
  const inbox = await db.updateRemote('u1', (doc) => remote.macReport(doc, { device: MAC, sessions: [S1] }, T + 5000));
  assert.deepStrictEqual(inbox.inbox, [{ id: 'm1', sessionId: S1.id, text: 'go on' }]);
  assert.strictEqual(await db.updateRemote('u2', () => ({ next: undefined, result: 'left alone' })), 'left alone');
  await db.updateRemote('u1', (doc) => remote.macReport(doc, { device: MAC, off: true }, T + 6000));
  assert.deepStrictEqual(await db.updateRemote('u1', (doc) => ({ next: undefined, result: doc })), null, 'deleted');
});

test("the notifications record: written, read back the same, and deleted with its last phone", async () => {
  const pushRules = require('../../web/lib/push');
  const SUB = {
    endpoint: 'https://web.push.apple.com/QGuQyavXutnMHabc',
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  };
  assert.strictEqual(await db.getPush('u1'), null);
  assert.deepStrictEqual(await db.updatePush('u1', (doc) => pushRules.addSub(doc, SUB, 1000)), { on: true });
  assert.deepStrictEqual(await db.getPush('u1'), { subs: [{ ...SUB, at: 1000 }] });
  assert.deepStrictEqual(await db.updatePush('u1', (doc) => pushRules.removeEndpoints(doc, ['https://web.push.apple.com/other'])), { on: false });
  assert.deepStrictEqual(await db.getPush('u1'), { subs: [{ ...SUB, at: 1000 }] }, 'left alone');
  await db.updatePush('u1', (doc) => pushRules.removeEndpoints(doc, [SUB.endpoint]));
  assert.strictEqual(await db.getPush('u1'), null, 'deleted');
});
