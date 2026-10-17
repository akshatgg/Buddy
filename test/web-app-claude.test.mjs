// Buddy on iPhone: Claude mode without the page (web/public/app/claude-core.js).

import test from 'node:test';
import assert from 'node:assert';
import { createClaude, readLook, byDevice, screen, POLL_MS, GONE, MODEL_SET, EFFORT_SET, NO_SUCH_MODEL, STOPPING, CLEARED } from '../web/public/app/claude-core.js';
import { ApiError } from '../web/public/app/api.js';

const S1 = { id: 'aaaa-1111', name: 'shop', title: null, status: 'working', canTalk: true, device: 'MacBook Air' };
const S2 = { id: 'bbbb-2222', name: 'blog', title: null, status: 'done', canTalk: false, device: 'Office PC' };
const ITEMS = [{ id: 1, kind: 'you', text: 'fix it', error: false }, { id: 2, kind: 'claude', text: 'Done.', error: false }];
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Claude mode with fake calls: `looks` answers each look in turn (a function of the session asked for, or an Error to
 * throw), and fake timers: tick() runs the timers that are due, as if POLL_MS went by.
 */
function setup(looks) {
  const asked = [];
  const sent = [];
  const interrupted = [];
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
      if (text === 'fail' || text === '/model haiku') throw new ApiError('mac_offline', 'None of your computers is sharing right now.');
    },
    interrupt: async (session) => {
      interrupted.push(session);
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
    interrupted,
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
    sessions: [S1, { id: 'cccc', name: 'Claude Code', title: null, status: 'idle', canTalk: false, device: null }],
    feed: { session: S1, items: [...ITEMS, { id: 3, kind: 'event', text: 'x', error: false }], stats: null, workers: [] },
  });
  assert.deepStrictEqual(readLook(null), { online: false, sessions: [], feed: null });
});

test('the title Claude Code gave a session is kept (trimmed), else null', () => {
  const r = readLook({
    online: true,
    sessions: [{ ...S1, title: '  Fix the login bug ' }, { ...S2, title: '   ' }, { id: 'dddd', name: 'x', title: 5 }],
    feed: { ...S1, title: 'Fix the login bug', items: [] },
  });
  assert.deepStrictEqual(r.sessions.map((s) => s.title), ['Fix the login bug', null, null]);
  assert.strictEqual(r.feed.session.title, 'Fix the login bug');
});

test('sessions are grouped by computer, in the order the computers come', () => {
  const S3 = { ...S1, id: 'cccc-3333', name: 'api' };
  assert.deepStrictEqual(byDevice([S1, S2, S3]), [{ device: 'MacBook Air', sessions: [S1, S3] }, { device: 'Office PC', sessions: [S2] }]);
});

const W = { id: 'toolu_01', task: 'Fix the login bug', status: 'running', startedAt: 1_000, endedAt: null, tokens: 12_300 };
const STATS = { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 };

test("a look reads the session's tokens and workers, leaving out what is odd", () => {
  const r = readLook({ online: true, sessions: [S1], feed: { ...S1, items: [], stats: { ...STATS, extra: 1 }, workers: [W, { id: 7 }, { ...W, id: 'x', status: 'dancing' }, W] } });
  assert.deepStrictEqual(r.feed.stats, STATS);
  assert.deepStrictEqual(r.feed.workers, [W]);
  assert.deepStrictEqual(readLook({ online: true, sessions: [S1], feed: { ...S1, items: [], stats: 'x', workers: 'y' } }).feed, { session: S1, items: [], stats: null, workers: [] });
});

/** Claude mode on S1, its feed `feed` (readLook's shape) come in. */
async function opened(feed = { session: S1, items: ITEMS, stats: STATS, workers: [W] }) {
  const s = setup([online([S1]), online([S1]), online([S1], feed), online([S1], feed), online([S1])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  await s.tick();
  return s;
}

test('/help, /cost and /model are answered on the phone; an unknown / command goes to Claude Code as typed', async () => {
  const s = await opened();
  assert.deepStrictEqual(s.claude.state.stats, STATS);
  for (const words of ['/help', '/cost', '/model gpt', '/effort huge']) assert.deepStrictEqual(await s.claude.send(words), { ok: true });
  assert.deepStrictEqual(s.sent, []);
  const notes = s.claude.state.notes;
  assert.match(notes[0].text, /^\/model · pick the model/);
  assert.match(notes[1].text, /^Tokens so far: 1\.2M in · 34k out\nModel: Opus 5\.5\nWorkers: 1 · 12\.3k tokens/);
  assert.strictEqual(notes[2].text, NO_SUCH_MODEL('gpt'));
  assert.strictEqual(notes[3].text, 'There is no effort level called huge. Try low, medium, high, xhigh or max.');
  assert.deepStrictEqual(await s.claude.send('/compact'), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: '/compact' }]);
  assert.strictEqual(s.claude.state.notes.length, 4, 'no answer of its own for it');
});

test('/model <name> goes as Claude Code\'s own command; /stop asks for Esc; /clear goes and the list shows, saying why', async () => {
  const s = await opened();
  assert.deepStrictEqual(await s.claude.send('/model Sonnet'), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: '/model sonnet' }]);
  assert.strictEqual(s.claude.state.notes.at(-1).text, MODEL_SET('Sonnet'));
  assert.deepStrictEqual(await s.claude.send('/stop'), { ok: true });
  assert.deepStrictEqual(s.interrupted, [S1.id]);
  assert.strictEqual(s.claude.state.notes.at(-1).text, STOPPING);
  assert.deepStrictEqual(await s.claude.send('/clear'), { ok: true });
  assert.deepStrictEqual(s.sent.at(-1), { session: S1.id, text: '/clear' });
  await settle();
  assert.deepStrictEqual([s.claude.state.session, s.claude.state.listError, s.claude.state.notes], [null, CLEARED, []]);
});

test('/model and /effort alone open the picker; Enter types /model and /effort for what changed, with one note', async () => {
  const s = await opened(); // the session runs Opus 5.5
  assert.deepStrictEqual(await s.claude.send('/model'), { ok: true });
  const p = s.claude.state.picker;
  assert.deepStrictEqual([p.current, p.index, p.effort, p.focus, p.rows[1].name], ['opus', 1, null, 'model', 'Opus 5.5']);
  s.claude.pickerMove(1);
  s.claude.pickerEffort(1);
  assert.deepStrictEqual([s.claude.state.picker.index, s.claude.state.picker.effort], [2, 'medium']);
  s.claude.pickerPick({ effort: 'high' });
  assert.deepStrictEqual(await s.claude.pickerApply(), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: '/model sonnet' }, { session: S1.id, text: '/effort high' }]);
  assert.strictEqual(s.claude.state.picker, null);
  assert.strictEqual(s.claude.state.notes.at(-1).text, 'Model: Sonnet · Effort: High');
  // Opened again, it knows the effort picked here; nothing changed: nothing typed.
  await s.claude.send('/effort');
  assert.deepStrictEqual([s.claude.state.picker.effort, s.claude.state.picker.focus], ['high', 'effort']);
  await s.claude.pickerApply();
  assert.strictEqual(s.sent.length, 2);
  assert.match(s.claude.state.notes.at(-1).text, /^No change\./);
  // Esc closes; other words put it away; a direct /effort works and is noted.
  await s.claude.send('/model');
  s.claude.pickerClose();
  assert.strictEqual(s.claude.state.picker, null);
  await s.claude.send('/model');
  await s.claude.send('hello');
  assert.strictEqual(s.claude.state.picker, null);
  assert.deepStrictEqual(await s.claude.send('/effort Max'), { ok: true });
  assert.deepStrictEqual(s.sent.at(-1), { session: S1.id, text: '/effort max' });
  assert.strictEqual(s.claude.state.notes.at(-1).text, EFFORT_SET('Max'));
  assert.deepStrictEqual(await s.claude.send('/model default'), { ok: true });
  assert.deepStrictEqual(s.sent.at(-1), { session: S1.id, text: '/model default' });
});

test('the picker stops when a send fails: the box hears why, and no note says it was set', async () => {
  const s = await opened();
  await s.claude.send('/model');
  s.claude.pickerPick({ model: 'haiku' });
  assert.deepStrictEqual(await s.claude.pickerApply(), { ok: false, error: 'None of your computers is sharing right now.' });
  assert.strictEqual(s.claude.state.notes.length, 0);
});

test('a command that cannot reach the computer gives the words back to the box', async () => {
  const s = await opened();
  assert.deepStrictEqual(await s.claude.send('/model haiku'), { ok: false, error: 'None of your computers is sharing right now.' });
  assert.strictEqual(s.claude.state.boxError, 'None of your computers is sharing right now.');
  assert.strictEqual(s.claude.state.notes.length, 0, 'no "Model set" when it did not go');
});

test('screen says what the session shows: rows, workers, the working verb, the status line, whether it ticks', async () => {
  const s = await opened();
  const view = screen(s.claude.state, 61_000);
  assert.deepStrictEqual(view.rows.map((r) => r.type), ['you', 'claude']);
  assert.strictEqual(view.workers.lines.length, 1);
  assert.strictEqual(typeof view.working, 'string', 'S1 is working');
  assert.strictEqual(view.waiting, false);
  assert.match(view.line, /Opus 5\.5 · 1\.2M in · 34k out/);
  assert.strictEqual(view.ticking, true);
  assert.deepStrictEqual(screen({ session: null, items: null, workers: [], stats: null }, 0).rows, []);
});

test('a look keeps the same caps as the server: a long model, task or worker id', () => {
  const long = { ...W, id: 'x'.repeat(101) };
  const r = readLook({ online: true, sessions: [S1], feed: { ...S1, items: [], stats: { ...STATS, model: 'm'.repeat(200) }, workers: [long, { ...W, task: 't'.repeat(500) }] } });
  assert.strictEqual(r.feed.stats.model.length, 80);
  assert.strictEqual(r.feed.workers.length, 1);
  assert.strictEqual(r.feed.workers[0].task.length, 120);
});
