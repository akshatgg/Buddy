'use strict';

// Notifications on the phone: the subscriptions (web/lib/push.js, POST /api/push), the trigger in a computer's report
// (remote.justFinished, remoteMac) and Web Push's setup (web/lib/deps.js pushFrom).

const test = require('node:test');
const assert = require('node:assert');
const { config, remoteMac, pushRoute, handle } = require('../web/lib/handlers');
const remote = require('../web/lib/remote');
const pushRules = require('../web/lib/push');
const { pushFrom } = require('../web/lib/deps');
const { fakeDb } = require('./helpers/fake-db');

const T = 1_800_000_000_000;
const MAC = { id: 'mac-11111111', name: "Akshat's MacBook Air" };
const S1 = { id: 'aaaa-1111', name: 'shop', status: 'working', canTalk: true };
const S2 = { id: 'bbbb-2222', name: 'blog', status: 'working', canTalk: true };
const APPLE = 'https://web.push.apple.com/QGuQyavXutnMHabc';
const GOOGLE = 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bHq';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const sub = (endpoint = APPLE) => ({ endpoint, keys: KEYS });
const TOKENS = { a: { uid: 'u1', email: 'a@gmail.com', name: 'A', emailVerified: true } };

/**
 * The handlers with fakes. `push` is Web Push (null: no VAPID keys); its send records each notification, and answers
 * the status in `refuse[endpoint]` (a push service's refusal) or throws `fail`.
 */
function setup({ remotes = {}, pushes = {}, push = true, refuse = {}, fail = null, at = T } = {}) {
  const db = fakeDb({ remotes, pushes });
  const sent = [];
  const deps = {
    db,
    now: () => new Date(at),
    verifyToken: async (token) => {
      if (!TOKENS[token]) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return TOKENS[token];
    },
    push: push ? {
      publicKey: 'BPublicKey',
      async send(subscription, payload) {
        sent.push({ endpoint: subscription.endpoint, keys: subscription.keys, payload: JSON.parse(payload) });
        if (fail) throw fail;
        if (refuse[subscription.endpoint]) throw Object.assign(new Error('Received unexpected response code'), { name: 'WebPushError', statusCode: refuse[subscription.endpoint] });
      },
    } : null,
  };
  const run = (handler, method, { token = 'a', body } = {}) => handle(handler, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
  const report = (sessions, extra = {}) => run(remoteMac, 'POST', { body: { device: MAC, sessions, ...extra } });
  return { db, sent, deps, run, report, setAt: (t) => { deps.now = () => new Date(t); } };
}

const record = (sessions, extra = {}) => ({ devices: { [MAC.id]: { name: MAC.name, seenAt: T - 3000, sessions } }, watch: null, feed: null, inbox: [], ...extra });

// ---- the rules ----

test('a session that was working and now is done or waiting has just finished; anything else has not', () => {
  const doc = record([S1, S2, { ...S1, id: 'cccc-3333', status: 'idle' }]);
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }, { ...S2, status: 'waiting' }, { ...S1, id: 'cccc-3333', status: 'done' }] };
  assert.deepStrictEqual(remote.justFinished(doc, body, T), [
    { id: S1.id, name: 'shop', title: null, status: 'done' },
    { id: S2.id, name: 'blog', title: null, status: 'waiting' },
  ]);
  assert.deepStrictEqual(remote.justFinished(doc, { device: MAC, sessions: [S1, { ...S2, status: 'failed' }] }, T), [], 'still working, or failed');
  assert.deepStrictEqual(remote.justFinished(null, body, T), [], "a computer's first report");
  assert.deepStrictEqual(remote.justFinished(doc, { device: MAC, off: true }, T), [], 'sharing turned off');
  assert.deepStrictEqual(remote.justFinished(doc, { device: { id: 'pc-222222222', name: 'PC' }, sessions: body.sessions }, T), [], "another computer's");
});

test("a computer last seen long ago (offline, then back) has no late news: only a recent report counts", () => {
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }] };
  const old = (seenAt) => ({ ...record([S1]), devices: { [MAC.id]: { name: MAC.name, seenAt, sessions: [S1] } } });
  assert.deepStrictEqual(remote.justFinished(old(T - remote.ONLINE_MS + 1), body, T).map((s) => s.id), [S1.id]);
  assert.deepStrictEqual(remote.justFinished(old(T - remote.ONLINE_MS), body, T), []);
  assert.deepStrictEqual(remote.justFinished(old(T - 2 * 60 * 60_000), body, T), []);
});

test('the session being watched right now is left out: the person sees it already', () => {
  const watched = record([S1, S2], { watch: { sessionId: S1.id, at: T - 1000 } });
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }, { ...S2, status: 'done' }] };
  assert.deepStrictEqual(remote.justFinished(watched, body, T).map((s) => s.id), [S2.id]);
  assert.deepStrictEqual(remote.justFinished(watched, body, T + remote.WATCH_MS).map((s) => s.id), [S1.id, S2.id], 'a watch that lapsed');
});

test("a watch not refreshed lately is not \"right now\": a look in flight as the phone locked must not keep its notification away", () => {
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }] };
  const at = (ago) => record([S1], { watch: { sessionId: S1.id, at: T - ago } });
  assert.deepStrictEqual(remote.justFinished(at(5_000), body, T), [], 'watched 5 s ago: still looking');
  assert.deepStrictEqual(remote.justFinished(at(20_000), body, T).map((s) => s.id), [S1.id], 'watched 20 s ago: a push');
  assert.ok(remote.NOTIFY_WATCH_MS < remote.WATCH_MS);
});

test('a subscription is checked: a push service of Apple, Google, Mozilla or Microsoft, over https, with its keys', () => {
  assert.deepStrictEqual(pushRules.checkSubscription({ ...sub(), expirationTime: null }), sub());
  for (const endpoint of [GOOGLE, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    assert.strictEqual(pushRules.checkSubscription(sub(endpoint)).endpoint, endpoint);
  }
  const refused = [
    null, 'x', {}, sub('http://web.push.apple.com/x'), sub('https://evil.example.com/x'), sub('https://web.push.apple.com.evil.io/x'),
    sub(`https://web.push.apple.com/${'x'.repeat(1000)}`), { endpoint: APPLE }, { endpoint: APPLE, keys: { p256dh: 'short', auth: KEYS.auth } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: 'has spaces in it' } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh.slice(0, 40), auth: KEYS.auth } }, // not 65 bytes
    { endpoint: APPLE, keys: { p256dh: `${KEYS.p256dh}AAAA`, auth: KEYS.auth } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: 'tBHItJI5svbpez7K' } }, // not 16 bytes
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: `${KEYS.auth}AAAA` } },
    // addresses the two URL parsers read differently (web-push sends to url.parse's hostname), or with more than a host
    ...[
      'https://169.254.169.254;.push.apple.com/latest', 'https://evil.com;.push.apple.com/', 'https://evil.com{.push.apple.com/',
      "https://evil.com'.push.apple.com/", 'https://evil.com".push.apple.com/', 'https://evil.com`.push.apple.com/',
      'https://evil.com%E3%80%82push.apple.com/', ' https://web.push.apple.com/x', 'https://web.push.apple.com:22/x',
      'https://user@web.push.apple.com/x', 'https://web.push.apple.com', 'https://web.push.apple.com/x y',
    ].map((endpoint) => sub(endpoint)),
  ];
  for (const value of refused) assert.throws(() => pushRules.checkSubscription(value), { code: 'bad_request' }, JSON.stringify(value)?.slice(0, 60));
});

test('a phone switching on is kept in place of the same one; at most 5, the newest; switching off forgets it', () => {
  let doc = null;
  doc = pushRules.addSub(doc, sub(APPLE), T).next;
  doc = pushRules.addSub(doc, sub(GOOGLE), T + 1).next;
  doc = pushRules.addSub(doc, sub(APPLE), T + 2).next;
  assert.deepStrictEqual(doc.subs.map((s) => [s.endpoint, s.at]), [[GOOGLE, T + 1], [APPLE, T + 2]]);
  for (let i = 0; i < 6; i += 1) doc = pushRules.addSub(doc, sub(`${APPLE}${i}`), T + 10 + i).next;
  assert.strictEqual(doc.subs.length, 5);
  assert.strictEqual(doc.subs[4].endpoint, `${APPLE}5`);
  assert.deepStrictEqual(pushRules.removeEndpoints(doc, ['https://web.push.apple.com/none']), { next: undefined, result: { on: false } });
  const fewer = pushRules.removeEndpoints(doc, [`${APPLE}5`]).next;
  assert.strictEqual(fewer.subs.length, 4);
  assert.deepStrictEqual(pushRules.removeEndpoints({ subs: [{ ...sub(), at: 1 }] }, [APPLE]), { next: null, result: { on: false } }, 'the last one: the record goes');
  assert.deepStrictEqual(pushRules.subsOf({ subs: [sub(), { endpoint: 'https://evil.example.com/x', keys: KEYS }, { endpoint: 'https://evil.com;.push.apple.com/', keys: KEYS }, null] }), [{ ...sub(), at: 0 }]);
});

test('what a notification says', () => {
  assert.deepStrictEqual(pushRules.message({ id: S1.id, name: 'shop', status: 'done' }),
    { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` });
  assert.strictEqual(pushRules.message({ id: S1.id, name: 'shop', title: 'Fix the login bug', status: 'done' }).title, 'Fix the login bug', 'the title, when it has one');
  assert.strictEqual(pushRules.message({ id: S1.id, name: 'shop', title: null, status: 'done' }).title, 'shop');
  assert.strictEqual(pushRules.message({ id: S1.id, name: 'shop', status: 'waiting' }).body, 'Claude Code needs you');
});

// ---- POST /api/push ----

test('POST /api/push keeps and forgets the phone', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub() } }), { status: 200, body: { on: true } });
  assert.deepStrictEqual(s.db.state.pushes.u1, { subs: [{ ...sub(), at: T }] });
  assert.deepStrictEqual(await s.run(pushRoute, 'POST', { body: { action: 'off', endpoint: APPLE } }), { status: 200, body: { on: false } });
  assert.strictEqual(s.db.state.pushes.u1, undefined);
});

test('POST /api/push refuses what it should', async () => {
  const s = setup();
  assert.strictEqual((await s.run(pushRoute, 'POST', { token: null, body: { action: 'on', subscription: sub() } })).status, 401);
  assert.strictEqual((await s.run(pushRoute, 'GET')).status, 405);
  assert.deepStrictEqual((await s.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub('https://evil.example.com/x') } })).body.error,
    { code: 'bad_request', message: "Notifications couldn't be switched on. Try again." });
  assert.strictEqual((await s.run(pushRoute, 'POST', { body: { action: 'off' } })).status, 400);
  assert.strictEqual((await s.run(pushRoute, 'POST', { body: { action: 'dance' } })).status, 400);
  assert.deepStrictEqual(s.db.state.pushes, {});
  const off = setup({ push: false });
  assert.deepStrictEqual(await off.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub() } }),
    { status: 503, body: { error: { code: 'push_off', message: "Notifications aren't set up yet." } } });
});

test('GET /api/config gives the public key when notifications are set up, and no key when they are not', async () => {
  assert.strictEqual((await setup().run(config, 'GET')).body.pushKey, 'BPublicKey');
  assert.ok(!('pushKey' in (await setup({ push: false }).run(config, 'GET')).body));
});

// ---- the trigger ----

test('a session that finishes on the computer is told to each phone, once', async () => {
  const s = setup({ remotes: { u1: record([S1, S2]) }, pushes: { u1: { subs: [{ ...sub(APPLE), at: 1 }, { ...sub(GOOGLE), at: 2 }] } } });
  const r = await s.report([{ ...S1, status: 'done' }, S2]);
  assert.deepStrictEqual(r, { status: 200, body: { watch: null, inbox: [] } });
  assert.deepStrictEqual(s.sent, [
    { endpoint: APPLE, keys: KEYS, payload: { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` } },
    { endpoint: GOOGLE, keys: KEYS, payload: { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` } },
  ]);
  s.setAt(T + 3000);
  await s.report([{ ...S1, status: 'done' }, { ...S2, status: 'waiting' }]);
  assert.deepStrictEqual(s.sent.slice(2).map((n) => [n.payload.title, n.payload.body]), [['blog', 'Claude Code needs you'], ['blog', 'Claude Code needs you']]);
});

test('an ordinary report reads nothing more, and sends nothing', async () => {
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } } });
  await s.report([S1]);
  await s.report([{ ...S1, status: 'idle' }]);
  assert.deepStrictEqual(s.sent, []);
  assert.ok(!s.db.state.calls.includes('getPush'));
});

test('nobody switched notifications on, or the server has no keys: nothing is sent', async () => {
  const none = setup({ remotes: { u1: record([S1]) } });
  await none.report([{ ...S1, status: 'done' }]);
  assert.deepStrictEqual(none.sent, []);
  const off = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } }, push: false });
  assert.strictEqual((await off.report([{ ...S1, status: 'done' }])).status, 200);
  assert.ok(!off.db.state.calls.includes('getPush'));
});

test('a phone the push service says is gone is forgotten; any other refusal keeps it, and only its status is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(APPLE), at: 1 }, { ...sub(GOOGLE), at: 2 }] } }, refuse: { [APPLE]: 410, [GOOGLE]: 500 } });
  assert.strictEqual((await s.report([{ ...S1, status: 'done' }])).status, 200);
  assert.deepStrictEqual(s.db.state.pushes.u1.subs.map((x) => x.endpoint), [GOOGLE]);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] not sent: 500']);
});

test("Web Push failing never fails the computer's report", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } }, fail: new TypeError('fetch failed') });
  assert.deepStrictEqual(await s.report([{ ...S1, status: 'done' }]), { status: 200, body: { watch: null, inbox: [] } });
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] not sent: TypeError']);

  const broken = setup({ remotes: { u1: record([S1]) } });
  broken.db.getPush = async () => {
    throw Object.assign(new Error('unavailable'), { code: 14 });
  };
  assert.strictEqual((await broken.report([{ ...S1, status: 'done' }])).status, 200);
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments.join(' ')), ['[push] could not notify: 14']);
});

test("a push service that never answers holds the computer's report up only so long", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } } });
  s.deps.push.send = () => new Promise(() => {});
  s.deps.notifyMs = 50;
  const started = Date.now();
  assert.deepStrictEqual(await s.report([{ ...S1, status: 'done' }]), { status: 200, body: { watch: null, inbox: [] } });
  assert.ok(Date.now() - started < 1000, `answered in ${Date.now() - started} ms`);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] took too long']);
});

// ---- Web Push's setup ----

test('Web Push is on only with all three VAPID values, and sends with them, an hour to live and a short wait', async () => {
  const env = { VAPID_PUBLIC_KEY: ' BPub ', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:akshatg9636@gmail.com' };
  let loads = 0;
  const calls = [];
  const load = () => {
    loads += 1;
    return { sendNotification: async (...args) => calls.push(args) };
  };
  assert.strictEqual(pushFrom({}, load), null);
  assert.strictEqual(pushFrom({ ...env, VAPID_PRIVATE_KEY: '' }, load), null);
  assert.strictEqual(loads, 0, 'web-push is not even loaded');
  const push = pushFrom(env, load);
  assert.strictEqual(push.publicKey, 'BPub');
  await push.send(sub(), '{"title":"x"}');
  assert.deepStrictEqual(calls, [[sub(), '{"title":"x"}', {
    vapidDetails: { subject: 'mailto:akshatg9636@gmail.com', publicKey: 'BPub', privateKey: 'priv' }, TTL: 3600, urgency: 'high', timeout: 5000,
  }]]);
});
