'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { createShare, thisDevice, IDLE_MS, WATCHED_MS, FAILED_MS, ON_LINE, OFF_LINE, SIGN_IN } = require('../src/main/claude/share');

const DEVICE = { id: 'mac-11111111', name: "Akshat's MacBook Air" };

const S1 = { id: 's1', name: 'shop', status: 'working', canTalk: true };

/** createShare with a fake store, server, sessions, terminal and timers; `answers` are the server's, in order. */
function setup({ on = true, signed = true, answers = [] } = {}) {
  const saved = { shareClaudeToPhone: on };
  const reports = [];
  const typed = [];
  const timers = [];
  const items = [{ id: 1, kind: 'you', text: 'hi' }];
  const live = {
    items,
    discover: async () => {},
    list: () => [S1],
    refresh: async () => {},
    view: (id) => (id === 's1' ? { ...S1, items: [...items] } : null),
    target: (id) => (id === 's1' ? { tty: 'ttys001', name: 'shop' } : null),
  };
  const queue = [...answers];
  const share = createShare({
    store: { get: (k) => saved[k], set: (p) => Object.assign(saved, p) },
    cloud: {
      async remoteMac(body) {
        reports.push(structuredClone(body));
        const next = queue.length ? queue.shift() : { watch: null, inbox: [] };
        if (next instanceof Error) throw next;
        return next;
      },
    },
    live,
    device: DEVICE,
    terminal: { async type(args) { typed.push(args); if (args.text === 'fail') throw new BuddyError('no_terminal', 'no'); } },
    signedIn: () => signed,
    later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    cancel: (t) => { const i = timers.indexOf(t); if (i >= 0) timers.splice(i, 1); },
  });
  /** Run the next timer and wait for its report. */
  const step = async () => {
    const t = timers.shift();
    await t.fn();
    return timers[0]?.ms;
  };
  return { share, saved, reports, typed, timers, live, step, signIn: (v) => { signed = v; } };
}

test('off, or signed out: nothing is shared', () => {
  for (const s of [setup({ on: false }), setup({ signed: false })]) {
    s.share.start();
    assert.strictEqual(s.timers.length, 0);
    assert.strictEqual(s.share.isRunning(), false);
  }
});

test('on: the sessions are reported at once, then every few seconds while nobody watches', async () => {
  const s = setup();
  s.share.start();
  assert.strictEqual(s.timers[0].ms, 0, 'the first report goes at once');
  assert.strictEqual(await s.step(), IDLE_MS);
  assert.deepStrictEqual(s.reports, [{ device: DEVICE, sessions: [S1] }]);
});

test('watched: the session\'s items go, and again only when they change, every second or so', async () => {
  const s = setup({ answers: [{ watch: 's1', inbox: [] }, { watch: 's1', inbox: [] }, { watch: 's1', inbox: [] }, { watch: 's1', inbox: [] }] });
  s.share.start();
  assert.strictEqual(await s.step(), 0, 'the phone has just begun to watch: its items go at once');
  assert.strictEqual(s.reports[0].feed, undefined, 'the watch is heard of in this answer');
  assert.strictEqual(await s.step(), WATCHED_MS, 'then every second or so');
  assert.deepStrictEqual(s.reports[1].feed, { ...S1, items: [{ id: 1, kind: 'you', text: 'hi' }] });
  await s.step();
  assert.strictEqual(s.reports[2].feed, undefined, 'nothing new: not sent again');
  s.live.items.push({ id: 2, kind: 'claude', text: 'Hello' });
  await s.step();
  assert.strictEqual(s.reports[3].feed.items.length, 2);
});

test('items that did not reach the server go again', async () => {
  const s = setup({ answers: [{ watch: 's1', inbox: [] }, new BuddyError('network', 'offline'), { watch: 's1', inbox: [] }] });
  s.share.start();
  await s.step();
  assert.strictEqual(await s.step(), FAILED_MS, 'unreachable: the next try waits');
  await s.step();
  assert.ok(s.reports[2].feed, 'sent again');
});

test("words from the phone are typed into their session's terminal once, and the server is told", async (t) => {
  const warned = t.mock.method(console, 'warn', () => {}); // the one that cannot be typed is logged, by its code
  const inbox = [{ id: 'm1', sessionId: 's1', text: 'run the tests' }, { id: 'm2', sessionId: 'gone', text: 'fail' }];
  const s = setup({ answers: [{ watch: 's1', inbox }, { watch: 's1', inbox }, { watch: 's1', inbox: [] }] });
  s.share.start();
  await s.step();
  assert.deepStrictEqual(s.typed, [{ tty: 'ttys001', text: 'run the tests' }, { tty: null, text: 'fail' }]);
  assert.strictEqual(warned.mock.callCount(), 1);
  await s.step();
  assert.strictEqual(s.typed.length, 2, 'never typed twice');
  assert.deepStrictEqual(s.reports[1].done, ['m1', 'm2']);
  await s.step();
  assert.strictEqual(s.reports[2].done, undefined, 'told once');
});

test('the switch: on starts, off stops and has the server forget; the line says which, and asks to sign in', async () => {
  const s = setup({ on: false });
  assert.deepStrictEqual(s.share.status(), { on: false, canTurnOn: true, line: OFF_LINE });
  assert.deepStrictEqual(await s.share.setOn(true), { on: true, canTurnOn: true, line: ON_LINE });
  assert.strictEqual(s.share.isRunning(), true);
  assert.deepStrictEqual(await s.share.setOn(false), { on: false, canTurnOn: true, line: OFF_LINE });
  assert.strictEqual(s.share.isRunning(), false);
  assert.strictEqual(s.timers.length, 0);
  assert.deepStrictEqual(s.reports, [{ device: DEVICE, off: true }]);
  s.signIn(false);
  assert.deepStrictEqual(s.share.status(), { on: false, canTurnOn: false, line: SIGN_IN });
});

test('signed out while sharing: the next turn stops', async () => {
  const s = setup();
  s.share.start();
  s.signIn(false);
  await s.step();
  assert.strictEqual(s.share.isRunning(), false);
  assert.deepStrictEqual(s.reports, []);
});

test("this computer: an id made once and kept, and its name from macOS, else the host name", () => {
  const saved = {};
  const store = { get: (k) => saved[k], set: (p) => Object.assign(saved, p) };
  const mac = thisDevice({ store, platform: 'darwin', run: () => Buffer.from("Akshat's MacBook Air\n"), hostname: () => 'x.local' });
  assert.match(mac.id, /^[0-9a-f-]{36}$/);
  assert.strictEqual(mac.name, "Akshat's MacBook Air");
  assert.strictEqual(thisDevice({ store, platform: 'darwin', run: () => { throw new Error('no'); }, hostname: () => 'Akshats-Air.local' }).name, 'Akshats-Air');
  assert.strictEqual(thisDevice({ store, platform: 'win32', hostname: () => 'OFFICE-PC' }).id, mac.id, 'the same id every time');
  assert.strictEqual(thisDevice({ store, platform: 'win32', hostname: () => 'OFFICE-PC' }).name, 'OFFICE-PC');
});
