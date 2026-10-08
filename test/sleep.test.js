'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createSleep, DROWSY_MS, ASLEEP_MS } = require('../src/main/sleep');

const SECOND = 1000;

/**
 * Fake timers: nothing runs until `advance` says that much time has gone by. Then each timer that comes due runs at its
 * time, the earliest first, and so do the timers set meanwhile.
 */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id → { at, fn }
  return {
    later(fn, ms) {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    cancelLater(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = end;
    },
    /** How long until each timer that is waiting runs, soonest first. */
    waiting: () => [...timers.values()].map((timer) => timer.at - now).sort((a, b) => a - b),
  };
}

/** A sleep with fake timers; `moods` is every mood it sent, in order. */
function setup(options) {
  const clock = fakeClock();
  const moods = [];
  const sleep = createSleep({ onMood: (mood) => moods.push(mood), later: clock.later, cancelLater: clock.cancelLater, ...options });
  return { sleep, clock, moods };
}

test('it starts awake, with the countdown running: drowsy in a minute, asleep in two', () => {
  assert.strictEqual(DROWSY_MS, 60 * SECOND);
  assert.strictEqual(ASLEEP_MS, 120 * SECOND);
  const s = setup();
  assert.strictEqual(s.sleep.state(), 'awake');
  assert.deepStrictEqual(s.moods, []);
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
});

test('without use it gets drowsy after a minute and asleep after two, counted from the same start', () => {
  const s = setup();
  s.clock.advance(DROWSY_MS - 1);
  assert.strictEqual(s.sleep.state(), 'awake');
  assert.deepStrictEqual(s.moods, []);
  s.clock.advance(1);
  assert.strictEqual(s.sleep.state(), 'drowsy');
  assert.deepStrictEqual(s.moods, ['drowsy']);
  s.clock.advance(ASLEEP_MS - DROWSY_MS - 1);
  assert.strictEqual(s.sleep.state(), 'drowsy', 'a minute after drowsy is 119.999 s from the start: not yet');
  s.clock.advance(1);
  assert.strictEqual(s.sleep.state(), 'asleep');
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
});

test('asleep is the end of it: nothing more is sent, and nothing more is waiting', () => {
  const s = setup();
  s.clock.advance(ASLEEP_MS);
  assert.deepStrictEqual(s.clock.waiting(), []);
  s.clock.advance(60 * 60 * SECOND);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
  assert.strictEqual(s.sleep.state(), 'asleep');
});

test('a poke while awake sends nothing and starts the countdown again from then', () => {
  const s = setup();
  s.clock.advance(50 * SECOND);
  s.sleep.poke();
  assert.deepStrictEqual(s.moods, []);
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS], 'the old countdown is gone, a new one is running');
  s.clock.advance(DROWSY_MS - 1);
  assert.strictEqual(s.sleep.state(), 'awake', 'it would have been drowsy by now without the poke');
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods, ['drowsy']);
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep'], 'asleep two minutes after the poke');
});

test('every use keeps it awake: a poke every 50 seconds never lets it get drowsy', () => {
  const s = setup();
  for (let i = 0; i < 100; i += 1) {
    s.clock.advance(50 * SECOND);
    s.sleep.poke();
  }
  assert.deepStrictEqual(s.moods, []);
  assert.strictEqual(s.sleep.state(), 'awake');
});

test('a poke while drowsy wakes it, once, and the countdown starts again', () => {
  const s = setup();
  s.clock.advance(DROWSY_MS);
  s.sleep.poke();
  assert.deepStrictEqual(s.moods, ['drowsy', 'wake']);
  assert.strictEqual(s.sleep.state(), 'awake');
  s.sleep.poke();
  assert.deepStrictEqual(s.moods, ['drowsy', 'wake'], 'awake already: no second wake');
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
  s.clock.advance(ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'wake', 'drowsy', 'asleep'], 'and it falls asleep again in time');
});

test('a poke while asleep sends wake once, however many pokes follow', () => {
  const s = setup();
  s.clock.advance(ASLEEP_MS);
  s.sleep.poke();
  s.sleep.poke();
  s.sleep.poke();
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake']);
  assert.strictEqual(s.sleep.state(), 'awake');
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake', 'drowsy'], 'it counts down again after waking');
});

test('holding stops the countdown, and nothing is waiting while it is held', () => {
  const s = setup();
  s.clock.advance(30 * SECOND);
  s.sleep.hold('panel', true);
  assert.deepStrictEqual(s.clock.waiting(), []);
  s.clock.advance(60 * 60 * SECOND);
  assert.deepStrictEqual(s.moods, []);
  assert.strictEqual(s.sleep.state(), 'awake');
});

test('releasing the only hold starts the countdown again from then', () => {
  const s = setup();
  s.sleep.hold('panel', true);
  s.clock.advance(10 * 60 * SECOND);
  s.sleep.hold('panel', false);
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
  s.clock.advance(DROWSY_MS - 1);
  assert.deepStrictEqual(s.moods, []);
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods, ['drowsy']);
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
});

test('with two reasons holding, the countdown starts only when the last is released, in either order', () => {
  for (const order of [['panel', 'pointer'], ['pointer', 'panel']]) {
    const s = setup();
    s.sleep.hold('panel', true);
    s.sleep.hold('pointer', true);
    s.sleep.hold(order[0], false);
    assert.deepStrictEqual(s.clock.waiting(), [], `${order[0]} released, the other still holds`);
    s.clock.advance(60 * 60 * SECOND);
    assert.deepStrictEqual(s.moods, []);
    s.sleep.hold(order[1], false);
    assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS], `${order[1]} released too: counting`);
    s.clock.advance(ASLEEP_MS);
    assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
  }
});

test('holding the same reason twice is one hold: a single release ends it', () => {
  const s = setup();
  s.sleep.hold('panel', true);
  s.sleep.hold('panel', true);
  s.sleep.hold('panel', false);
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['drowsy']);
});

test('releasing a reason that is not held changes nothing: the countdown is not started again, and other holds stay', () => {
  const s = setup();
  s.clock.advance(40 * SECOND);
  s.sleep.hold('pointer', false);
  assert.deepStrictEqual(s.clock.waiting(), [20 * SECOND, 80 * SECOND], 'the countdown went on from where it was');
  s.sleep.hold('panel', true);
  s.sleep.hold('pointer', false);
  assert.deepStrictEqual(s.clock.waiting(), [], 'and the panel still holds');
  s.sleep.hold('pointer', false);
  s.sleep.hold('pointer', false);
  assert.deepStrictEqual(s.clock.waiting(), []);
  assert.deepStrictEqual(s.moods, []);
});

test('holding while asleep wakes it, once; while drowsy too', () => {
  const asleep = setup();
  asleep.clock.advance(ASLEEP_MS);
  asleep.sleep.hold('panel', true);
  assert.deepStrictEqual(asleep.moods, ['drowsy', 'asleep', 'wake']);
  assert.strictEqual(asleep.sleep.state(), 'awake');
  asleep.sleep.hold('pointer', true);
  asleep.sleep.hold('panel', true);
  assert.deepStrictEqual(asleep.moods, ['drowsy', 'asleep', 'wake'], 'awake already: no second wake');
  assert.deepStrictEqual(asleep.clock.waiting(), [], 'and no countdown while held');

  const drowsy = setup();
  drowsy.clock.advance(DROWSY_MS);
  drowsy.sleep.hold('pointer', true);
  assert.deepStrictEqual(drowsy.moods, ['drowsy', 'wake']);
  assert.strictEqual(drowsy.sleep.state(), 'awake');
});

test('a poke while held keeps it awake and starts no countdown', () => {
  const s = setup();
  s.sleep.hold('panel', true);
  s.sleep.poke();
  assert.deepStrictEqual(s.clock.waiting(), []);
  s.clock.advance(60 * 60 * SECOND);
  assert.deepStrictEqual(s.moods, []);
  s.sleep.hold('panel', false);
  assert.deepStrictEqual(s.clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
});

test('after waking from a hold and releasing it, it falls asleep again two minutes later', () => {
  const s = setup();
  s.clock.advance(ASLEEP_MS);
  s.sleep.hold('panel', true);
  s.clock.advance(5 * 60 * SECOND);
  s.sleep.hold('panel', false);
  s.clock.advance(ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake', 'drowsy', 'asleep']);
});

test('the state has changed by the time the mood is sent', () => {
  const clock = fakeClock();
  const seen = [];
  const sleep = createSleep({
    onMood: (mood) => seen.push([mood, sleep.state()]),
    later: clock.later,
    cancelLater: clock.cancelLater,
  });
  clock.advance(ASLEEP_MS);
  sleep.poke();
  assert.deepStrictEqual(seen, [['drowsy', 'drowsy'], ['asleep', 'asleep'], ['wake', 'awake']]);
});

test('the countdown is already running when wake is sent, and stays so if sending it fails', () => {
  const clock = fakeClock();
  const waitingAtWake = [];
  let broken = false;
  const sleep = createSleep({
    onMood: (mood) => {
      if (mood === 'wake') waitingAtWake.push(clock.waiting());
      if (broken) throw new Error('the buddy window is gone');
    },
    later: clock.later,
    cancelLater: clock.cancelLater,
  });
  clock.advance(ASLEEP_MS);
  broken = true;
  assert.throws(() => sleep.poke(), /gone/);
  assert.deepStrictEqual(waitingAtWake, [[DROWSY_MS, ASLEEP_MS]]);
  assert.strictEqual(sleep.state(), 'awake');
  assert.deepStrictEqual(clock.waiting(), [DROWSY_MS, ASLEEP_MS]);
});

test('the times can be set', () => {
  const s = setup({ drowsyMs: 10, asleepMs: 25 });
  assert.deepStrictEqual(s.clock.waiting(), [10, 25]);
  s.clock.advance(24);
  assert.deepStrictEqual(s.moods, ['drowsy']);
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
});

test('an asleep time before the drowsy time goes straight to asleep, and drowsy does not undo it', () => {
  const s = setup({ drowsyMs: 30, asleepMs: 20 });
  s.clock.advance(100);
  assert.deepStrictEqual(s.moods, ['asleep']);
  assert.strictEqual(s.sleep.state(), 'asleep');
});

test('with no timers given it uses setTimeout and clearTimeout, and the usual times', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const moods = [];
  const sleep = createSleep({ onMood: (mood) => moods.push(mood) });
  t.mock.timers.tick(30 * SECOND);
  sleep.poke(); // clears the two timers set at the start, and sets two new ones
  t.mock.timers.tick(30 * SECOND);
  assert.deepStrictEqual(moods, [], 'a minute from the start, but half a minute from the poke');
  t.mock.timers.tick(30 * SECOND - 1);
  assert.deepStrictEqual(moods, []);
  t.mock.timers.tick(1);
  assert.deepStrictEqual(moods, ['drowsy']);
  t.mock.timers.tick(DROWSY_MS);
  assert.deepStrictEqual(moods, ['drowsy', 'asleep']);
  sleep.poke();
  assert.deepStrictEqual(moods, ['drowsy', 'asleep', 'wake']);
  sleep.hold('panel', true); // clears the two timers the poke set
  t.mock.timers.tick(60 * 60 * SECOND);
  assert.deepStrictEqual(moods, ['drowsy', 'asleep', 'wake']);
});
