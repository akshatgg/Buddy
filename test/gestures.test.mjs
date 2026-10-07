import test from 'node:test';
import assert from 'node:assert';
import { createPetDetector, createShakeDetector } from '../src/renderer/buddy/gestures.js';

// The traces are made the way a hand moves a pointer, as the page sees it: an event every 16 ms or so, the pointer about
// ten points further on each time (quicker in the middle of a stroke than at its ends, where a hand slows down), and
// never quite steady. Whole points, as a screen has. The jitter is seeded, so every run sees the same hand.

/** A seeded random number in [0, 1) (mulberry32). */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let r = Math.imul(a ^ (a >>> 15), 1 | a);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * The events of a hand that goes through `route`: points ([x, y]) to go to, and { rest: ms } to stay where it is. On its
 * way it moves about `speed` points between events `frame` ms apart. Each event is off by up to `jitter` points, and by up
 * to 2 ms in time. `reached[i]` is the index of the event at which the hand was done with route[i].
 */
function hand(route, { speed = 10, jitter = 2, frame = 16, start = 1000, seed = 1 } = {}) {
  const random = seeded(seed);
  const off = (most) => Math.round((random() * 2 - 1) * most);
  const events = [];
  const reached = [];
  let here = route[0];
  const emit = ([x, y]) => events.push({
    x: Math.round(x) + off(jitter), y: Math.round(y) + off(jitter), t: start + events.length * frame + off(2),
  });
  emit(here);
  reached.push(0);
  for (const next of route.slice(1)) {
    if ('rest' in next) {
      for (let i = 0; i < Math.round(next.rest / frame); i += 1) emit(here);
    } else {
      const strokeEvents = Math.max(1, Math.round(Math.hypot(next[0] - here[0], next[1] - here[1]) / speed));
      for (let i = 1; i <= strokeEvents; i += 1) {
        const k = i / strokeEvents;
        const ease = k * k * (3 - 2 * k); // slow at both ends of the stroke
        emit([here[0] + (next[0] - here[0]) * ease, here[1] + (next[1] - here[1]) * ease]);
      }
      here = next;
    }
    reached.push(events.length - 1);
  }
  return { events, reached };
}

/** A route along x only: numbers are x positions, anything else (a rest) is kept as it is. */
const across = (...stops) => stops.map((stop) => (typeof stop === 'number' ? [stop, 300] : stop));

/** The x positions of a hand rubbing: `strokes` strokes of `length` points, right and left in turn. */
const rubbing = (strokes, length) => Array.from({ length: strokes + 1 }, (_, i) => 100 + (i % 2) * length);

/** The route of a hand wagging: `strokes` strokes of `length` points, up and down the axis in turn. */
const wagging = (strokes, length, axis = 'x') => Array.from({ length: strokes + 1 }, (_, i) => {
  const at = 300 + (i % 2) * length;
  return axis === 'x' ? [at, 300] : [300, at];
});

/** The route of a hand wagging along a diagonal: `strokes` strokes of `length` points on each axis, there and back in turn. */
const diagonally = (strokes, length, [dx, dy]) => Array.from({ length: strokes + 1 }, (_, i) => [
  300 + (i % 2) * dx * length,
  300 + (i % 2) * dy * length,
]);

/** How often the pointer changes direction from one event to the next, however little: what a plain detector would count. */
function reversals(events, axis = 'x') {
  let last = 0;
  let count = 0;
  for (let i = 1; i < events.length; i += 1) {
    const way = Math.sign(events[i][axis] - events[i - 1][axis]);
    if (way === 0) continue;
    if (last !== 0 && way !== last) count += 1;
    last = way;
  }
  return count;
}

/** The indexes of the events at which the detector says the gesture is done. */
function petted(events, options) {
  const pet = createPetDetector(options);
  return events.flatMap((e, i) => (pet.feed(e.x, e.t) ? [i] : []));
}

function shaken(events, options) {
  const shake = createShakeDetector(options);
  return events.flatMap((e, i) => (shake.feed(e.x, e.y, e.t) ? [i] : []));
}

// ---------------------------------------------------------------------------------------------------------------------
// Petting: the pointer rubbed back and forth over the head. 3 turns within 1.5 s, each after at least 6 points.

test('rubbing back and forth over the head is petting: it says so at the third turn, once', () => {
  // Four strokes of 60 points, 10 points between events 16 ms apart, 2 points of jitter: right, left, right, left.
  const { events, reached } = hand(across(...rubbing(4, 60)));
  const done = petted(events);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0] > reached[3], 'not before the hand has turned back from its third stroke');
  assert.ok(done[0] <= reached[3] + 3, 'and then at once: within a few events');
});

// [what it is, points in a stroke, points between events, ms between events]
const RUBS = [
  ['a quick, wide rub', 100, 16, 16],
  ['the usual rub', 60, 10, 16],
  ['a gentle rub', 24, 5, 16],
  ['a tiny rub', 14, 3, 16],
  ['the usual rub at 120 events a second', 60, 5, 8],
  ['the usual rub at 30 events a second', 60, 20, 33],
];

test('every kind of rub counts, from any hand and at any rate of events; the same rub with one turn less does not', () => {
  for (const [what, length, speed, frame] of RUBS) {
    for (const seed of [1, 2, 3, 4, 5]) {
      for (const [side, flip] of [['right first', 1], ['left first', -1]]) {
        const why = `${what}, hand ${seed}, ${side}`;
        const options = { speed, frame, seed };
        const rub = (strokes) => across(...rubbing(strokes, length).map((x) => 300 + flip * (x - 300)));
        assert.strictEqual(petted(hand(rub(4), options).events).length, 1, why);
        assert.deepStrictEqual(petted(hand(rub(3), options).events), [], `${why}: two turns`);
      }
    }
  }
});

test('two turns are not petting, however long the hand goes on after them', () => {
  const { events } = hand(across(...rubbing(3, 60), { rest: 3000 }));
  assert.deepStrictEqual(petted(events), []);
});

test('turns more than 1.5 s apart do not add up: a slow rub, or one that stops in the middle', () => {
  // Strokes of 60 points at one point between events take about a second each: any three turns are 2 s apart or more.
  const slow = hand(across(...rubbing(8, 60)), { speed: 1, jitter: 1 });
  assert.deepStrictEqual(petted(slow.events), []);
  // The same strokes at the hand's usual pace do count (seven turns: at the third and at the sixth): it is only the pace.
  assert.strictEqual(petted(hand(across(...rubbing(8, 60)), { jitter: 1 }).events).length, 2);
  // One turn, then the hand stops for 1.6 s, and the second and third turns come after it: first to last, more than 1.5 s.
  const stops = hand(across(100, 160, 100, { rest: 1600 }, 160, 100));
  assert.deepStrictEqual(petted(stops.events), []);
});

test('the window slides: turns that are too old drop out, and the next three count', () => {
  // Right, left, right (two turns), a stop of two seconds, then left, right, left, right. The turn that is seen when the
  // hand sets off again is the third, but two seconds after the first: too late. The fifth, two strokes later, makes
  // three quick ones (the third, the fourth and the fifth).
  const route = across(100, 160, 100, 160, { rest: 2000 }, 100, 160, 100, 160);
  const { events, reached } = hand(route);
  const done = petted(events);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0] > reached[6] && done[0] <= reached[6] + 3, 'at the turn after the fifth stroke, not before');
});

test('a trembling hand has no turns in its jitter: at rest, and in the middle of a rub', () => {
  // A hand resting on the head, trembling by 2 points: the pointer changes direction all the time.
  const resting = hand(across(150, { rest: 6000 }));
  assert.ok(reversals(resting.events) > 100, 'the pointer does change direction all the time');
  assert.deepStrictEqual(petted(resting.events), []);
  // A gentle rub, 3 points between events: two turns, and at least three times as many changes of direction that a plain
  // detector would count, at the ends of the strokes, where the hand is slow and the jitter wins.
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const twoTurns = hand(across(...rubbing(3, 60)), { speed: 3, seed });
    assert.ok(reversals(twoTurns.events) >= 3 * 2, `hand ${seed}: ${reversals(twoTurns.events)} changes of direction`);
    assert.deepStrictEqual(petted(twoTurns.events), [], `hand ${seed}: two turns`);
    const threeTurns = hand(across(...rubbing(4, 60)), { speed: 3, seed });
    assert.strictEqual(petted(threeTurns.events).length, 1, `hand ${seed}: three turns`);
  }
});

test('a drag that steps back by less than 6 points now and then has no turns', () => {
  // On 60 points, back 4, on 60 again, back 4 …: four steps back, so eight changes of direction, and none of it is travel.
  const { events } = hand(across(60, 120, 116, 176, 172, 232, 228, 288, 284, 344), { jitter: 0 });
  assert.ok(reversals(events) >= 8);
  assert.deepStrictEqual(petted(events), []);
});

test('a stroke has to be at least 6 points: strokes of 6 count, strokes of 5 do not', () => {
  assert.strictEqual(petted(hand(across(...rubbing(4, 6)), { speed: 2, jitter: 0 }).events).length, 1);
  assert.deepStrictEqual(petted(hand(across(...rubbing(12, 5)), { speed: 2, jitter: 0 }).events), []);
});

test('a slow drag across the head, even there and back, is not petting', () => {
  const { events } = hand(across(60, 360, 60), { speed: 1, jitter: 1 });
  assert.deepStrictEqual(petted(events), []);
});

test('after it says so it counts afresh: the two turns that follow are not enough, the third is', () => {
  // Seven strokes are six turns: it says so at the third and again at the sixth, and not at the fourth or the fifth.
  const { events, reached } = hand(across(...rubbing(7, 60)));
  const done = petted(events);
  assert.strictEqual(done.length, 2);
  assert.ok(done[1] > reached[6], 'the second time is at the sixth turn');
  // Six strokes are five turns: once.
  assert.strictEqual(petted(hand(across(...rubbing(6, 60))).events).length, 1);
});

test('turns are timed by the event that shows them: three within 1500 ms, first to last, count; a ms more does not', () => {
  for (const [last, expected] of [[2500, true], [2501, false]]) {
    const pet = createPetDetector();
    assert.strictEqual(pet.feed(0, 0), false);
    assert.strictEqual(pet.feed(10, 500), false); // off to the right
    assert.strictEqual(pet.feed(0, 1000), false); // back: the first turn, at 1000
    assert.strictEqual(pet.feed(10, 1750), false); // the second
    assert.strictEqual(pet.feed(0, last), expected, `the third at ${last}`);
  }
});

test('reset forgets the turns and which way the hand was going: the detector is as new', () => {
  const first = hand(across(...rubbing(3, 60))); // two turns, the hand ends on the right
  const second = hand(across(160, 100, 160, 100, 160, 100), { start: first.events.at(-1).t + 16, seed: 9 });
  const run = (reset) => {
    const pet = createPetDetector();
    first.events.forEach((e) => pet.feed(e.x, e.t));
    if (reset) pet.reset();
    return second.events.flatMap((e, i) => (pet.feed(e.x, e.t) ? [i] : []));
  };
  const asNew = petted(second.events);
  assert.strictEqual(asNew.length, 1);
  assert.deepStrictEqual(run(true), asNew, 'the same as a detector that never saw the first');
  assert.ok(run(false)[0] < asNew[0], 'without it, the two turns of the first rub would have joined the next');
});

test('a sample that is not a number is ignored', () => {
  const pet = createPetDetector();
  assert.strictEqual(pet.feed(NaN, 0), false);
  assert.strictEqual(pet.feed(undefined, 5), false);
  assert.strictEqual(pet.feed(10, undefined), false);
  assert.strictEqual(pet.feed('7', 10), false);
  const { events } = hand(across(...rubbing(4, 60)));
  assert.strictEqual(events.map((e) => pet.feed(e.x, e.t)).filter(Boolean).length, 1, 'and it works as before');
});

test('the number of turns, the time they must fall in and the step can be set', () => {
  // Two turns within half a second, each after 10 points.
  const options = { turns: 2, withinMs: 500, step: 10 };
  assert.strictEqual(petted(hand(across(...rubbing(3, 60))).events, options).length, 1);
  assert.deepStrictEqual(petted(hand(across(...rubbing(3, 60)), { speed: 1 }).events, options), [], 'too slow for half a second');
  assert.deepStrictEqual(petted(hand(across(...rubbing(12, 8)), { speed: 2, jitter: 0 }).events, options), [], 'strokes under the step');
  assert.strictEqual(petted(hand(across(...rubbing(3, 60)), { speed: 1 }).events, { ...options, withinMs: 3000 }).length, 1);
});

// ---------------------------------------------------------------------------------------------------------------------
// Shaking: the pointer dragged back and forth, on either axis. 4 turns within 1 s, each after at least 24 points. A move is
// one turn at most, whichever axis turns on it, or both.

test('shaking from side to side is shaking: it says so at the fourth turn, once', () => {
  // Five strokes of 120 points, 15 points between events 16 ms apart, 4 points of jitter: right, left, right, left, right.
  const { events, reached } = hand(wagging(5, 120), { speed: 15, jitter: 4 });
  const done = shaken(events);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0] > reached[4], 'not before the hand has turned back from its fourth stroke');
  assert.ok(done[0] <= reached[4] + 5, 'and then at once: within a few events');
});

test('shaking up and down is shaking', () => {
  const vertical = hand(wagging(5, 120, 'y'), { speed: 15, jitter: 4 });
  assert.strictEqual(shaken(vertical.events).length, 1);
});

test('a steady diagonal shake at 45 degrees is shaking, and needs four reversals like any other: three are not enough', () => {
  // The pointer reverses on both axes on the same move, and that is one turn, not two. 120 points on each axis, 20 points
  // along the diagonal between events, in each of the four diagonal directions.
  for (const direction of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const why = `diagonal ${direction}`;
    const options = { speed: 20, jitter: 0 };
    const four = hand(diagonally(5, 120, direction), options); // away, back, away, back, away: four reversals
    const done = shaken(four.events);
    assert.strictEqual(done.length, 1, why);
    assert.ok(done[0] > four.reached[4] && done[0] <= four.reached[4] + 5, `${why}: at the fourth reversal, not before`);
    assert.deepStrictEqual(shaken(hand(diagonally(4, 120, direction), options).events), [], `${why}: three reversals`);
  }
});

test('a turn on either axis counts: two turns on x and two on y make four', () => {
  // Right, left, right (two turns on x); then down, up, down along the right edge (two turns on y).
  const route = [[300, 300], [420, 300], [300, 300], [420, 300], [420, 420], [420, 300], [420, 420]];
  const { events, reached } = hand(route, { speed: 15, jitter: 4 });
  const done = shaken(events);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0] > reached[5] && done[0] <= reached[5] + 5, 'at the second turn on y, which is the fourth in all');
  // Without the last stroke there are only three turns.
  assert.deepStrictEqual(shaken(hand(route.slice(0, -1), { speed: 15, jitter: 4 }).events), []);
});

// [what it is, points in a stroke, points between events, ms between events]
const SHAKES = [
  ['a hard shake', 200, 25, 16],
  ['the usual shake', 120, 15, 16],
  ['a small shake', 40, 8, 16],
  ['the usual shake at 120 events a second', 120, 8, 8],
  ['the usual shake at 30 events a second', 120, 30, 33],
];

test('every kind of shake counts, from any hand and at any rate of events; the same shake with one turn less does not', () => {
  for (const [what, length, speed, frame] of SHAKES) {
    for (const axis of ['x', 'y']) {
      for (const seed of [1, 2, 3, 4, 5]) {
        for (const [way, flip] of [['up the axis first', 1], ['down the axis first', -1]]) {
          const why = `${what}, ${axis}, hand ${seed}, ${way}`;
          const options = { speed, frame, seed, jitter: 4 };
          const shake = (strokes) => wagging(strokes, flip * length, axis);
          assert.strictEqual(shaken(hand(shake(5), options).events).length, 1, why);
          assert.deepStrictEqual(shaken(hand(shake(4), options).events), [], `${why}: three turns`);
        }
      }
    }
  }
});

test('turns more than a second apart do not add up: a lazy wag, or a wag that stops in the middle', () => {
  // Strokes of 120 points at 4 points between events take about half a second each: four turns are 1.4 s apart.
  assert.deepStrictEqual(shaken(hand(wagging(9, 120), { speed: 4, jitter: 4 }).events), []);
  // The same strokes at 8 points do count (eight turns: at the fourth and at the eighth).
  assert.strictEqual(shaken(hand(wagging(9, 120), { speed: 8, jitter: 4 }).events).length, 2);
  // Three quick turns, then a stop of 1.2 s, then the fourth: more than a second from the first to the last.
  const stops = hand([[300, 300], [420, 300], [300, 300], [420, 300], [300, 300], { rest: 1200 }, [420, 300], [300, 300]], {
    speed: 15, jitter: 4,
  });
  assert.deepStrictEqual(shaken(stops.events), []);
});

test('jitter under 24 points is not a turn: a shaky hand dragging, and a trembling one at rest', () => {
  // A drag across the screen with the hand off by up to 8 points either way, so by 16 between events at the most: a slow
  // one, where the pointer changes direction all the time on both axes, and a fast one, where it does so on y.
  const slow = hand([[100, 300], [400, 340]], { speed: 3, jitter: 8 });
  assert.ok(reversals(slow.events) > 10 && reversals(slow.events, 'y') > 10, 'the pointer changes direction on both axes');
  assert.deepStrictEqual(shaken(slow.events), []);
  const fast = hand([[100, 300], [700, 340]], { speed: 10, jitter: 8 });
  assert.ok(reversals(fast.events, 'y') > 10);
  assert.deepStrictEqual(shaken(fast.events), []);
  const resting = hand([[300, 300], { rest: 5000 }], { jitter: 8 });
  assert.ok(reversals(resting.events) > 100);
  assert.deepStrictEqual(shaken(resting.events), []);
});

test('a drag that overshoots, comes back a little and goes on has two turns, not four', () => {
  const { events } = hand([[100, 300], [500, 300], [460, 300], [700, 300]], { speed: 15, jitter: 4 });
  assert.deepStrictEqual(shaken(events), []);
});

test('a stroke has to be at least 24 points: strokes of 24 count, strokes of 23 do not', () => {
  assert.strictEqual(shaken(hand(wagging(5, 24), { speed: 6, jitter: 0 }).events).length, 1);
  assert.deepStrictEqual(shaken(hand(wagging(12, 23), { speed: 6, jitter: 0 }).events), []);
});

test('after it says so it counts afresh: nine strokes are eight turns, so twice', () => {
  const nine = hand(wagging(9, 120), { speed: 15, jitter: 4 });
  assert.strictEqual(shaken(nine.events).length, 2);
  assert.strictEqual(shaken(hand(wagging(8, 120), { speed: 15, jitter: 4 }).events).length, 1, 'seven turns: once');
});

test('a turn on both axes at once is one turn, not two: the fourth turn of a diagonal shake is its fourth reversal', () => {
  // The pointer goes down and to the right and back, again and again. After the first move away, every move is a turn on
  // both axes at once: the turns are at 200, 300, 400 and 500, so the shake is at 500, and not at 300.
  const shake = createShakeDetector();
  const moves = [[0, 0, 0], [50, 50, 100], [0, 0, 200], [50, 50, 300], [0, 0, 400], [50, 50, 500]];
  assert.deepStrictEqual(moves.map(([x, y, t]) => shake.feed(x, y, t)), [false, false, false, false, false, true]);
});

test('neither axis misses a move on which the other turns: a turn on one axis alone still counts after a turn on both', () => {
  // Away on both axes and back on both (the first turn), then a turn on one axis alone (the second). The axis that turns
  // there only sees it if it saw the move before, on which the other axis turned too.
  for (const [alone, last] of [['y', [0, 50, 300]], ['x', [50, 0, 300]]]) {
    const shake = createShakeDetector({ turns: 2 });
    const moves = [[0, 0, 0], [50, 50, 100], [0, 0, 200], last];
    assert.deepStrictEqual(moves.map(([x, y, t]) => shake.feed(x, y, t)), [false, false, false, true], `then ${alone} alone`);
  }
});

test('shake turns are timed by the event that shows them: four within 1000 ms count; a ms more does not', () => {
  for (const [last, expected] of [[2000, true], [2001, false]]) {
    const shake = createShakeDetector();
    assert.strictEqual(shake.feed(0, 0, 0), false);
    assert.strictEqual(shake.feed(50, 0, 500), false); // off to the right
    assert.strictEqual(shake.feed(0, 0, 1000), false); // back: the first turn, at 1000
    assert.strictEqual(shake.feed(50, 0, 1300), false); // the second
    assert.strictEqual(shake.feed(0, 0, 1700), false); // the third
    assert.strictEqual(shake.feed(50, 0, last), expected, `the fourth at ${last}`);
  }
});

test('shake reset forgets the turns and which way the hand was going', () => {
  const first = hand(wagging(4, 120), { speed: 15, jitter: 4 }); // three turns
  const second = hand(wagging(5, 120), { speed: 15, jitter: 4, start: first.events.at(-1).t + 16, seed: 9 });
  const run = (reset) => {
    const shake = createShakeDetector();
    first.events.forEach((e) => shake.feed(e.x, e.y, e.t));
    if (reset) shake.reset();
    return second.events.flatMap((e, i) => (shake.feed(e.x, e.y, e.t) ? [i] : []));
  };
  const asNew = shaken(second.events);
  assert.strictEqual(asNew.length, 1);
  assert.deepStrictEqual(run(true), asNew, 'the same as a detector that never saw the first');
  assert.ok(run(false)[0] < asNew[0], 'without it, the turns of the first shake would have joined the next');
});

test('a shake sample that is not a number is ignored', () => {
  const shake = createShakeDetector();
  assert.strictEqual(shake.feed(NaN, 0, 0), false);
  assert.strictEqual(shake.feed(0, undefined, 5), false);
  assert.strictEqual(shake.feed(0, 0, null), false);
  const { events } = hand(wagging(5, 120), { speed: 15, jitter: 4 });
  assert.strictEqual(events.map((e) => shake.feed(e.x, e.y, e.t)).filter(Boolean).length, 1, 'and it works as before');
});

test('the number of turns, the time they must fall in and the step can be set for shaking too', () => {
  // Three turns within 2 s, each after 50 points.
  const options = { turns: 3, withinMs: 2000, step: 50 };
  assert.strictEqual(shaken(hand(wagging(4, 120), { speed: 15, jitter: 4 }).events, options).length, 1);
  assert.deepStrictEqual(shaken(hand(wagging(4, 40), { speed: 8, jitter: 0 }).events, options), [], 'strokes under the step');
  assert.deepStrictEqual(shaken(hand(wagging(4, 120), { speed: 1, jitter: 4 }).events, options), [], 'too slow for 2 s');
});
