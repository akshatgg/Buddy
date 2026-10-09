'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { remoteMac, remotePhone, handle } = require('../web/lib/handlers');
const remote = require('../web/lib/remote');
const { fakeDb } = require('./helpers/fake-db');

const { macReport, phoneLook, phoneSend, phoneStop, cleanItems, cleanSessions, ONLINE_MS, WATCH_MS, SEEN_EVERY_MS, INBOX_KEEP_MS, OFFLINE, NO_SESSION } = remote;

const T = 1_800_000_000_000;
const S1 = { id: 'aaaa-1111', name: 'shop', title: 'Fix the cart total', status: 'working', canTalk: true };
const S2 = { id: 'bbbb-2222', name: 'blog', title: null, status: 'done', canTalk: false };
const S3 = { id: 'cccc-3333', name: 'api', title: null, status: 'waiting', canTalk: true };
const MAC = { id: 'mac-11111111', name: "Akshat's MacBook Air" };
const PC = { id: 'pc-222222222', name: 'Office PC' };
const ITEMS = [{ id: 1, kind: 'you', text: 'fix it' }, { id: 2, kind: 'claude', text: 'Done.' }];
const on = (device, sessions, seenAt = T) => ({ name: device.name, seenAt, sessions });
const record = (extra = {}) => ({ devices: { [MAC.id]: on(MAC, [S1, S2]) }, watch: null, feed: null, inbox: [], ...extra });
const report = (doc, body, at) => macReport(doc, { device: MAC, sessions: [S1, S2], ...body }, at);
const listed = (device, ...sessions) => sessions.map((s) => ({ ...s, device: device.name }));

// ---- the rules ----

test("a computer's report keeps its sessions and says nobody watches; a report that changes nothing is not written", () => {
  assert.deepStrictEqual(report(null, {}, T), { next: record(), result: { watch: null, inbox: [] } });
  assert.strictEqual(report(record(), {}, T + 5000).next, undefined, 'the same, a moment later');
  assert.strictEqual(report(record(), {}, T + SEEN_EVERY_MS).next.devices[MAC.id].seenAt, T + SEEN_EVERY_MS, 'but it is still seen');
  assert.deepStrictEqual(report(record(), { sessions: [S1] }, T + 1000).next.devices[MAC.id].sessions, [S1], 'a session gone');
  assert.throws(() => macReport(null, { sessions: [S1] }, T), { code: 'bad_request' }, 'no device');
  assert.throws(() => macReport(null, { device: { id: '../x' }, sessions: [] }, T), { code: 'bad_request' });
});

test('two computers share at once: each keeps its own entry, and a watcher sees all their sessions with their names', () => {
  const both = macReport(record(), { device: PC, sessions: [S3] }, T + 1000).next;
  assert.deepStrictEqual(Object.keys(both.devices).sort(), [MAC.id, PC.id].sort());
  assert.deepStrictEqual(phoneLook(both, null, T + 2000).result, { online: true, sessions: [...listed(MAC, S1, S2), ...listed(PC, S3)], feed: null });
  assert.deepStrictEqual(phoneLook(both, null, T + 2000, MAC.id).result.sessions, listed(PC, S3), 'the Mac watching: its own are left out');
  assert.deepStrictEqual(phoneLook(both, null, T + 1000 + ONLINE_MS - 1).result.sessions, listed(PC, S3), 'the Mac gone quiet: only the PC');
  assert.deepStrictEqual(report(both, {}, T + SEEN_EVERY_MS).next.devices[PC.id], on(PC, [S3], T + 1000), "the Mac's report leaves the PC's entry alone");
});

test('the sessions and items are cleaned: unknown fields, bad ids, too many, too long', () => {
  assert.deepStrictEqual(cleanSessions([{ ...S1, extra: 1 }, { id: '../x' }, { id: 'ok', status: 'nope', name: ' ' }, 'x', null]), [
    S1, { id: 'ok', name: 'Claude Code', title: null, status: 'idle', canTalk: false },
  ]);
  assert.strictEqual(cleanSessions(Array.from({ length: 30 }, (_, i) => ({ id: `s${i}` }))).length, 20);
  assert.deepStrictEqual(cleanItems([{ id: 1, kind: 'result', text: 'x', error: true, more: 1 }, { id: 'a', kind: 'you', text: 'x' }, { id: 2, kind: 'html', text: 'x' }]),
    [{ id: 1, kind: 'result', text: 'x', error: true }]);
  const many = Array.from({ length: 300 }, (_, i) => ({ id: i, kind: 'tool', text: 'x'.repeat(5000) }));
  const kept = cleanItems(many);
  assert.ok(kept.length <= 200);
  assert.strictEqual(kept[kept.length - 1].id, 299, 'the newest are kept');
  assert.ok(kept.every((i) => i.text.length <= 4001));
  assert.ok(kept.reduce((n, i) => n + i.text.length, 0) <= 400_000);
});

test('a watcher looks: the sessions while a computer is on; looking at one watches it, and only its computer is told', () => {
  assert.deepStrictEqual(phoneLook(null, null, T), { next: undefined, result: { online: false, sessions: [], feed: null } });
  assert.deepStrictEqual(phoneLook(record(), null, T + ONLINE_MS).result, { online: false, sessions: [], feed: null }, 'not seen for 45 s: offline');
  assert.deepStrictEqual(phoneLook(record(), null, T + 1000), { next: undefined, result: { online: true, sessions: listed(MAC, S1, S2), feed: null } });

  const look = phoneLook(record(), S1.id, T + 1000);
  assert.deepStrictEqual(look.next.watch, { sessionId: S1.id, at: T + 1000 });
  assert.strictEqual(look.result.feed, null, 'nothing from the computer yet');
  assert.throws(() => phoneLook(record(), 'zzzz', T + 1000), { code: 'not_found', message: NO_SESSION });

  assert.strictEqual(report(look.next, {}, T + 2000).result.watch, S1.id, 'its computer hears which session to send');
  assert.strictEqual(macReport(look.next, { device: PC, sessions: [S3] }, T + 2000).result.watch, null, 'another computer does not');
});

test("the computer sends the watched session's items; the watcher gets them; looking again soon writes nothing", () => {
  const watched = record({ watch: { sessionId: S1.id, at: T } });
  const { next } = report(watched, { feed: { ...S1, items: ITEMS } }, T + 1000);
  assert.deepStrictEqual(next.feed, { sessionId: S1.id, device: MAC.name, name: 'shop', title: 'Fix the cart total', status: 'working', canTalk: true, items: ITEMS, at: T + 1000 });
  const look = phoneLook(next, S1.id, T + 2000);
  assert.deepStrictEqual(look.result.feed, { id: S1.id, device: MAC.name, name: 'shop', title: 'Fix the cart total', status: 'working', canTalk: true, items: ITEMS });
  assert.strictEqual(look.next, undefined, 'watched a moment ago: no write');
  assert.ok(phoneLook(next, S1.id, T + WATCH_MS / 3).next, 'a while later the watch is kept fresh');
  assert.strictEqual(report(record(), { feed: { ...S1, items: ITEMS } }, T + 1000).next, undefined, 'a feed nobody watches is not kept');
  assert.strictEqual(macReport(watched, { device: PC, sessions: [S3], feed: { ...S1, items: ITEMS } }, T + 1000).next.feed, null,
    "a computer cannot send another's session");
});

test('a watch the watcher stopped keeping lapses, and the items go with it', () => {
  const kept = record({ watch: { sessionId: S1.id, at: T }, feed: { sessionId: S1.id, device: MAC.name, name: 'shop', status: 'done', canTalk: true, items: ITEMS, at: T } });
  const later = report(kept, {}, T + WATCH_MS);
  assert.strictEqual(later.result.watch, null);
  assert.strictEqual(later.next.watch, null);
  assert.strictEqual(later.next.feed, null, 'nobody watches: the items are gone');
  assert.strictEqual(phoneLook(kept, S2.id, T + 1000).next.feed, null, 'looking at another session drops the first one\'s items');
});

test('words wait for the computer of their session, which types them and says so; old ones are dropped', () => {
  const both = macReport(record(), { device: PC, sessions: [S3] }, T).next;
  const sent = phoneSend(both, { sessionId: S1.id, text: 'run the tests', id: 'm1' }, T + 1000);
  assert.deepStrictEqual(sent.result, { sent: true });
  assert.deepStrictEqual(sent.next.inbox, [{ id: 'm1', sessionId: S1.id, text: 'run the tests', at: T + 1000 }]);
  assert.deepStrictEqual(report(sent.next, {}, T + 2000).result.inbox, [{ id: 'm1', sessionId: S1.id, text: 'run the tests' }]);
  assert.deepStrictEqual(macReport(sent.next, { device: PC, sessions: [S3] }, T + 2000).result.inbox, [], 'not for the PC');
  assert.deepStrictEqual(report(sent.next, { done: ['m1'] }, T + 3000).next.inbox, [], 'typed: gone');
  assert.deepStrictEqual(report(sent.next, {}, T + 1000 + INBOX_KEEP_MS).next.inbox, [], 'never picked up: dropped');

  let doc = record();
  for (let i = 0; i < 25; i += 1) doc = phoneSend(doc, { sessionId: S1.id, text: `w${i}`, id: `m${i}` }, T).next;
  assert.strictEqual(doc.inbox.length, 20, 'at most 20 wait');
  assert.strictEqual(doc.inbox[19].text, 'w24');

  assert.throws(() => phoneSend(record(), { sessionId: S1.id, text: 'x', id: 'm' }, T + ONLINE_MS), { code: 'mac_offline', message: OFFLINE });
  assert.throws(() => phoneSend(null, { sessionId: S1.id, text: 'x', id: 'm' }, T), { code: 'mac_offline' });
  assert.throws(() => phoneSend(record(), { sessionId: 'zzzz', text: 'x', id: 'm' }, T), { code: 'not_found' });
});

test("the watcher stops: the items go at once; a computer turning sharing off takes out its entry, the last one the record", () => {
  const kept = record({ watch: { sessionId: S1.id, at: T }, feed: { sessionId: S1.id, items: ITEMS } });
  assert.deepStrictEqual(phoneStop(kept).next, record());
  assert.strictEqual(phoneStop(record()).next, undefined);
  assert.strictEqual(phoneStop(null).next, undefined);
  assert.deepStrictEqual(report(kept, { off: true }, T), { next: null, result: { watch: null, inbox: [] } });
  assert.strictEqual(report(null, { off: true }, T).next, undefined);

  const both = macReport(kept, { device: PC, sessions: [S3] }, T).next;
  const macOff = report({ ...both, inbox: [{ id: 'm', sessionId: S1.id, text: 'x', at: T }] }, { off: true }, T + 1000).next;
  assert.deepStrictEqual(Object.keys(macOff.devices), [PC.id], "the PC's entry stays");
  assert.strictEqual(macOff.watch, null, "the Mac's watched session goes");
  assert.strictEqual(macOff.feed, null);
  assert.deepStrictEqual(macOff.inbox, [], 'and the words for it');
});

test('a computer not seen for a day leaves the record', () => {
  const old = record({ devices: { [PC.id]: on(PC, [S3], T - 25 * 60 * 60_000) } });
  assert.deepStrictEqual(Object.keys(report(old, {}, T).next.devices), [MAC.id]);
});

// ---- the handlers ----

const TOKENS = { a: { uid: 'u1', email: 'a@gmail.com', name: 'A', emailVerified: true }, b: { uid: 'u2', email: 'b@gmail.com', name: 'B', emailVerified: true } };
function deps(db, at = T) {
  return {
    db,
    now: () => new Date(at),
    newId: () => 'msg-1',
    verifyToken: async (token) => {
      if (!TOKENS[token]) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return TOKENS[token];
    },
  };
}
const req = (method, token, { body, query } = {}) => ({ method, headers: token ? { authorization: `Bearer ${token}` } : {}, body, query });

test('Mac and phone of the same person meet through the server; another person sees nothing', async () => {
  const db = fakeDb();
  const mac = await handle(remoteMac, req('POST', 'a', { body: { device: MAC, sessions: [S1] } }), deps(db));
  assert.deepStrictEqual(mac, { status: 200, body: { watch: null, inbox: [] } });

  const list = await handle(remotePhone, req('GET', 'a', { query: {} }), deps(db, T + 500));
  assert.deepStrictEqual(list.body, { online: true, sessions: listed(MAC, S1), feed: null });
  const self = await handle(remotePhone, req('GET', 'a', { query: { exclude: MAC.id } }), deps(db, T + 500));
  assert.deepStrictEqual(self.body, { online: false, sessions: [], feed: null }, 'the Mac looking: its own are not listed');
  const other = await handle(remotePhone, req('GET', 'b', { query: {} }), deps(db, T + 500));
  assert.deepStrictEqual(other.body, { online: false, sessions: [], feed: null }, "someone else's phone");

  await handle(remotePhone, req('GET', 'a', { query: { session: S1.id } }), deps(db, T + 1000));
  const told = await handle(remoteMac, req('POST', 'a', { body: { device: MAC, sessions: [S1], feed: { ...S1, items: ITEMS } } }), deps(db, T + 1500));
  assert.strictEqual(told.body.watch, S1.id);
  const watched = await handle(remotePhone, req('GET', 'a', { query: { session: S1.id } }), deps(db, T + 2000));
  assert.deepStrictEqual(watched.body.feed.items, ITEMS);

  const sent = await handle(remotePhone, req('POST', 'a', { body: { action: 'send', session: S1.id, text: '  now commit  ' } }), deps(db, T + 2500));
  assert.deepStrictEqual(sent, { status: 200, body: { sent: true } });
  const picked = await handle(remoteMac, req('POST', 'a', { body: { device: MAC, sessions: [S1] } }), deps(db, T + 3000));
  assert.deepStrictEqual(picked.body.inbox, [{ id: 'msg-1', sessionId: S1.id, text: 'now commit' }]);

  await handle(remotePhone, req('POST', 'a', { body: { action: 'stop' } }), deps(db, T + 3500));
  assert.strictEqual(db.state.remotes.u1.feed, null);
  await handle(remoteMac, req('POST', 'a', { body: { device: MAC, off: true } }), deps(db, T + 4000));
  assert.strictEqual(db.state.remotes.u1, undefined, 'sharing off: nothing is left');
});

test('the phone and Mac calls refuse what they should', async () => {
  const db = fakeDb({ remotes: { u1: record() } });
  const call = (handler, r) => handle(handler, r, deps(db, T + 100));
  assert.strictEqual((await call(remotePhone, req('GET', null))).status, 401);
  assert.strictEqual((await call(remoteMac, req('POST', null, { body: {} }))).status, 401);
  assert.strictEqual((await call(remoteMac, req('GET', 'a'))).status, 405);
  assert.strictEqual((await call(remotePhone, req('DELETE', 'a'))).status, 405);
  assert.deepStrictEqual((await call(remotePhone, req('GET', 'a', { query: { session: '../../x' } }))).body.error.code, 'bad_request');
  assert.deepStrictEqual((await call(remotePhone, req('POST', 'a', { body: { action: 'send', session: S1.id, text: ' ' } }))).body.error,
    { code: 'bad_request', message: 'Type something first.' });
  assert.strictEqual((await call(remotePhone, req('POST', 'a', { body: { action: 'send', session: S1.id, text: 'x'.repeat(4001) } }))).status, 400);
  assert.strictEqual((await call(remotePhone, req('POST', 'a', { body: { action: 'dance' } }))).status, 400);
  assert.strictEqual((await call(remotePhone, req('POST', 'a', { body: { action: 'send', text: 'x' } }))).status, 400);
  const offline = await handle(remotePhone, req('POST', 'a', { body: { action: 'send', session: S1.id, text: 'x' } }), deps(db, T + ONLINE_MS));
  assert.deepStrictEqual(offline, { status: 409, body: { error: { code: 'mac_offline', message: OFFLINE } } });
});
