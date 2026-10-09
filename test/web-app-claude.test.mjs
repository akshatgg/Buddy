// Buddy on iPhone: Claude mode without the page (web/public/app/claude-core.js).

import test from 'node:test';
import assert from 'node:assert';
import { createClaude, readLook, byDevice, POLL_MS, GONE } from '../web/public/app/claude-core.js';
import { ApiError } from '../web/public/app/api.js';

const S1 = { id: 'aaaa-1111', name: 'shop', status: 'working', canTalk: true, device: 'MacBook Air' };
const S2 = { id: 'bbbb-2222', name: 'blog', status: 'done', canTalk: false, device: 'Office PC' };
const ITEMS = [{ id: 1, kind: 'you', text: 'fix it', error: false }, { id: 2, kind: 'claude', text: 'Done.', error: false }];
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Claude mode with fake calls: `looks` answers each look in turn (a function of the session asked for, or an Error to
 * throw), and fake timers: tick() runs the timers that are due, as if POLL_MS went by.
 */
function setup(looks) {
  const asked = [];
  const sent = [];
  let stops = 0;
  const timers = new Map();
  let nextTimer = 1;
  const claude = createClaude({
    look: async (session) => {
      asked.push(session);
      const next = looks.shift();
      if (next === undefined) throw new Error('no more looks planned');
      const r = typeof next === 'function' ? next(session) : next;
      if (r instanceof Error) throw r;
      return r;
    },
    send: async (session, text) => {
      sent.push({ session, text });
      if (text === 'fail') throw new ApiError('mac_offline', 'None of your computers is sharing right now.');
    },
    stop: async () => {
      stops += 1;
    },
    later: (fn, ms) => {
      assert.strictEqual(ms, POLL_MS);
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, fn);
      return id;
    },
    cancelLater: (id) => timers.delete(id),
  });
  return {
    claude,
    asked,
    sent,
    stops: () => stops,
    pending: () => timers.size,
    async tick() {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
      await settle();
    },
  };
}

const online = (sessions, feed = null) => ({ online: true, sessions, feed });

test('entering lists the sessions; picking one looks at it every 2 s and shows its items once its computer sends them', async () => {
  const s = setup([online([S1, S2]), online([S1, S2]), online([S1, S2], { session: S1, items: ITEMS })]);
  s.claude.enter();
  assert.strictEqual(s.claude.state.looking, true);
  await settle();
  assert.deepStrictEqual([s.claude.state.on, s.claude.state.online, s.claude.state.sessions], [true, true, [S1, S2]]);
  s.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual(s.asked, [null, S1.id]);
  assert.strictEqual(s.claude.state.session, S1);
  assert.strictEqual(s.claude.state.items, null, 'nothing from the computer yet');
  assert.strictEqual(s.pending(), 1, 'the next look waits');
  await s.tick();
  assert.deepStrictEqual(s.claude.state.items, ITEMS);
});

test('the session ended: back to the list, saying so; the computer stopped sharing: the list says it is offline', async () => {
  const s = setup([online([S1]), new ApiError('not_found', GONE), online([S2])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  await settle();
  assert.deepStrictEqual([s.claude.state.session, s.claude.state.sessions, s.claude.state.listError], [null, [S2], GONE]);

  const off = setup([online([S1]), { online: false, sessions: [], feed: null }]);
  off.claude.enter();
  await settle();
  off.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual([off.claude.state.session, off.claude.state.online], [null, false]);
  assert.strictEqual(off.pending(), 0, 'no more looks');
  assert.strictEqual(off.stops(), 1);
});

test('a look that fails says why and looks again', async () => {
  const s = setup([online([S1]), new ApiError('network', 'No internet.'), online([S1], { session: S1, items: ITEMS })]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  assert.strictEqual(s.claude.state.problem, 'No internet.');
  await s.tick();
  assert.strictEqual(s.claude.state.problem, null);
  assert.deepStrictEqual(s.claude.state.items, ITEMS);
});

test('out of view the looks stop and the computer is told; in view again they start again', async () => {
  const s = setup([online([S1]), online([S1]), online([S1])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  s.claude.hidden();
  await settle();
  assert.strictEqual(s.pending(), 0);
  assert.strictEqual(s.stops(), 1);
  s.claude.shown();
  await settle();
  assert.deepStrictEqual(s.asked, [null, S1.id, S1.id]);
});

test('back to the list stops the computer; signing out drops what is on its way', async () => {
  let release;
  const s = setup([online([S1]), online([S1]), online([S1]), () => new Promise((resolve) => { release = resolve; })]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  s.claude.list();
  await settle();
  assert.strictEqual(s.stops(), 1);
  assert.strictEqual(s.claude.state.session, null);
  s.claude.list();
  s.claude.leave();
  release(online([S1, S2]));
  await settle();
  assert.strictEqual(s.claude.state.on, false);
  assert.deepStrictEqual(s.claude.state.sessions, [], 'the late answer is dropped');
});

test("a notification's link opens its session once the list comes, or says it is gone", async () => {
  const s = setup([online([S1, S2]), online([S1, S2])]);
  s.claude.enter(S2.id);
  await settle();
  await settle();
  assert.strictEqual(s.claude.state.session?.id, S2.id);
  const gone = setup([online([S1])]);
  gone.claude.enter('zzzz-9999');
  await settle();
  assert.deepStrictEqual([gone.claude.state.session, gone.claude.state.listError], [null, GONE]);
});

test('words go to the session shown; when they cannot, the box hears why', async () => {
  const s = setup([online([S1]), online([S1])]);
  s.claude.enter();
  await settle();
  assert.deepStrictEqual(await s.claude.send('run tests'), { ok: false, error: '' }, 'no session shown yet');
  s.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual(await s.claude.send('  run the tests  '), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: 'run the tests' }]);
  assert.deepStrictEqual(await s.claude.send('fail'), { ok: false, error: 'None of your computers is sharing right now.' });
  assert.strictEqual(s.claude.state.boxError, 'None of your computers is sharing right now.');
  assert.deepStrictEqual(await s.claude.send('   '), { ok: false, error: '' });
});

test('a look is read the way the Android app reads it: odd parts left out, each id once', () => {
  assert.deepStrictEqual(readLook({
    online: true,
    sessions: [S1, { id: '../x' }, { id: 'cccc', name: ' ', status: 7 }, S1, null],
    feed: { id: S1.id, name: 'shop', status: 'working', canTalk: true, device: 'MacBook Air', items: [...ITEMS, { id: 2, kind: 'claude', text: 'again' }, { id: 3, kind: 'html', text: 'x' }, { id: 'a', text: 'x' }] },
  }), {
    online: true,
    sessions: [S1, { id: 'cccc', name: 'Claude Code', status: 'idle', canTalk: false, device: null }],
    feed: { session: S1, items: [...ITEMS, { id: 3, kind: 'event', text: 'x', error: false }] },
  });
  assert.deepStrictEqual(readLook(null), { online: false, sessions: [], feed: null });
});

test('sessions are grouped by computer, in the order the computers come', () => {
  const S3 = { ...S1, id: 'cccc-3333', name: 'api' };
  assert.deepStrictEqual(byDevice([S1, S2, S3]), [{ device: 'MacBook Air', sessions: [S1, S3] }, { device: 'Office PC', sessions: [S2] }]);
});
