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

/**
 * The route of a hand wagging along a line at any angle: `strokes` strokes, there and back in turn, each going `dx`
 * points along x and `dy` points along y (either can be negative or 0).
 */
const diagonally = (strokes, [dx, dy]) => Array.from({ length: strokes + 1 }, (_, i) => [
  300 + (i % 2) * dx,
  300 + (i % 2) * dy,
]);

/**
 * The events of a hand going round a circle of `radius` points, `rounds` times, with about `speed` points along the circle
 * between events. Like `hand`, it has the jitter of a real hand and is seeded.
 */
function circling(radius, rounds, { speed = 10, jitter = 0, frame = 16, start = 1000, seed = 1 } = {}) {
  const random = seeded(seed);
  const off = (most) => Math.round((random() * 2 - 1) * most);
  const count = Math.round((rounds * 2 * Math.PI * radius) / speed);
  return Array.from({ length: count + 1 }, (_, i) => {
    const angle = (i * speed) / radius;
    return {
      x: Math.round(400 + radius * Math.cos(angle)) + off(jitter),
      y: Math.round(400 + radius * Math.sin(angle)) + off(jitter),
      t: start + i * frame + off(2),
    };
  });
}

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
// Shaking: the pointer dragged back and forth along a line at any angle, or round and round. 4 turns within 1 s, each
// after at least 24 points. A turn is the pointer reversing its stroke, wherever the stroke goes: a reversal is one turn.

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

// [what it is, points along x, points along y]
const DIAGONALS = [
  ['at 45 degrees', 120, 120],
  ['2 across to 1 down', 120, 60],
  ['1 across to 2 down', 60, 120],
  ['3 across to 1 down', 120, 40],
  ['1 across to 3 down', 40, 120],
];

test('a diagonal shake at any angle is shaking, and needs four reversals like any other: three are not enough', () => {
  // A reversal turns the pointer on both axes, and on different moves unless the angle is 45 degrees and the hand steady.
  // It is one turn all the same. 15 points between events, a steady hand and five hands with 4 points of jitter, away and
  // back in each of the four diagonal directions.
  for (const [what, dx, dy] of DIAGONALS) {
    for (const [flipX, flipY] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
      for (const [jitter, seed] of [[0, 1], [4, 1], [4, 2], [4, 3], [4, 4], [4, 5]]) {
        const why = `${what}, first to ${flipX},${flipY}, jitter ${jitter}, hand ${seed}`;
        const options = { speed: 15, jitter, seed };
        const shake = (strokes) => diagonally(strokes, [flipX * dx, flipY * dy]);
        const four = hand(shake(5), options); // away, back, away, back, away: four reversals
        const done = shaken(four.events);
        assert.strictEqual(done.length, 1, why);
        assert.ok(done[0] > four.reached[4] && done[0] <= four.reached[4] + 5, `${why}: at the fourth reversal, not before`);
        assert.deepStrictEqual(shaken(hand(shake(4), options).events), [], `${why}: three reversals`);
      }
    }
  }
});

test('turns along x, a corner, then turns along y: four reversals make a shake', () => {
  // Right, left, right (two turns on x); then down, up, down along the right edge (two turns on y).
  const route = [[300, 300], [420, 300], [300, 300], [420, 300], [420, 420], [420, 300], [420, 420]];
  const { events, reached } = hand(route, { speed: 15, jitter: 4 });
  const done = shaken(events);
  assert.strictEqual(done.length, 1);
  assert.ok(done[0] > reached[5] && done[0] <= reached[5] + 5, 'at the second turn on y, which is the fourth in all');
  // Without the last stroke there are only three turns.
  assert.deepStrictEqual(shaken(hand(route.slice(0, -1), { speed: 15, jitter: 4 }).events), []);
});

test('a circle counts as turns too, about two for each time round, whatever its size', () => {
  // Round and round, the pointer is furthest from where it turned at the other side of the circle, and turns there: one
  // turn for each half round. Ten times round is twenty halves, and the first of them is only a stroke: 19 turns. With one
  // turn to a shake, every turn says so. 10 points along the circle between events.
  for (const radius of [20, 30, 60, 100, 150, 200]) {
    for (const [jitter, seed] of [[0, 1], [4, 1], [4, 2], [4, 3]]) {
      const turns = shaken(circling(radius, 10, { jitter, seed }), { turns: 1 }).length;
      assert.ok(turns >= 19 && turns <= 21, `radius ${radius}, jitter ${jitter}, hand ${seed}: ${turns} turns in ten rounds`);
    }
  }
});

test('going round fast is a shake and going round slowly is not: the four turns must come within a second', () => {
  // A circle 120 points across. At 15 points between events a round takes 0.4 s, and four turns come within 0.6 s.
  assert.ok(shaken(circling(60, 3, { speed: 15 })).length >= 1);
  // At 4 points between events a round takes 1.5 s, and four turns come over 2.3 s.
  assert.deepStrictEqual(shaken(circling(60, 3, { speed: 4 })), []);
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

test('turns more than a second apart do not add up at any angle: a lazy diagonal wag', () => {
  // Strokes of 2 across to 1 down (134 points) at 4 points between events take over half a second each: four turns are
  // 1.6 s apart.
  assert.deepStrictEqual(shaken(hand(diagonally(9, [120, 60]), { speed: 4, jitter: 4 }).events), []);
  // The same strokes at 8 points do count (eight turns: at the fourth and at the eighth).
  assert.strictEqual(shaken(hand(diagonally(9, [120, 60]), { speed: 8, jitter: 4 }).events).length, 2);
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

test('a first move of under 24 points is jitter, not a stroke: going the other way after it is not a turn', () => {
  // 20 points one way, then back past where it began and on, to 40 the other way: the first stroke is the one that goes
  // the other way, and there is no turn. With one turn to a shake, true says the pointer turned. As new, and after a reset.
  const moves = [[0, 0, 100], [20, 0, 200], [-20, 0, 300], [-40, 0, 400]];
  const afterReset = createShakeDetector({ turns: 1 });
  afterReset.feed(0, 0, 0);
  afterReset.feed(100, 0, 10);
  assert.strictEqual(afterReset.feed(0, 0, 20), true, 'it has turned once, to be forgotten');
  afterReset.reset();
  for (const [what, shake] of [['as new', createShakeDetector({ turns: 1 })], ['after a reset', afterReset]]) {
    assert.deepStrictEqual(moves.map(([x, y, t]) => shake.feed(x, y, t)), [false, false, false, false], what);
  }
});

test('a stroke has to be at least 24 points whichever way it goes: along a diagonal, 24 count and 23 do not', () => {
  // 17 across and 17 down is 24.04 points along the line; 16 and 16 is 22.6, and 20 and 10 is 22.4. 6 points between events.
  assert.strictEqual(shaken(hand(diagonally(5, [17, 17]), { speed: 6, jitter: 0 }).events).length, 1);
  // Forty strokes of each, so thirty-nine reversals that are all too short to be turns.
  for (const [dx, dy] of [[16, 16], [16, -16], [20, 10], [10, 20], [23, 0], [0, 23]]) {
    const { events } = hand(diagonally(40, [dx, dy]), { speed: 6, jitter: 0 });
    assert.deepStrictEqual(shaken(events, { turns: 1 }), [], `strokes of ${dx} across and ${dy} down`);
  }
  // A circle 20 points across is too small for a turn too.
  assert.deepStrictEqual(shaken(circling(10, 20), { turns: 1 }), []);
});

test('a short wiggle of an unsteady hand is not a turn either, at any angle', () => {
  // Wiggles of 12 points along x and of 11 along the diagonal, with the hand off by up to 4 points either way on both
  // axes: 21.5 and 22.6 points at the most between two events, less than 24.
  for (const [dx, dy] of [[12, 0], [0, 12], [8, 8], [8, -8]]) {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { events } = hand(diagonally(60, [dx, dy]), { speed: 4, jitter: 4, seed });
      assert.deepStrictEqual(shaken(events, { turns: 1 }), [], `wiggles of ${dx} across and ${dy} down, hand ${seed}`);
    }
  }
});

test('jitter under 24 points is not a turn at any angle: a shaky hand dragging up, down or across', () => {
  // The hand is off by up to 8 points either way on both axes, so the pointer is off by 22.6 points at the most.
  const drags = [[[300, 100], [340, 500]], [[100, 100], [500, 500]], [[500, 450], [100, 380]], [[100, 300], [500, 300]]];
  for (const [from, to] of drags) {
    for (const speed of [3, 10]) {
      for (const seed of [1, 2, 3]) {
        const { events } = hand([from, to], { speed, jitter: 8, seed });
        assert.deepStrictEqual(shaken(events, { turns: 1 }), [], `from ${from} to ${to}, ${speed} points between events, hand ${seed}`);
      }
    }
  }
});

test('after it says so it counts afresh: nine strokes are eight turns, so twice', () => {
  const nine = hand(wagging(9, 120), { speed: 15, jitter: 4 });
  assert.strictEqual(shaken(nine.events).length, 2);
  assert.strictEqual(shaken(hand(wagging(8, 120), { speed: 15, jitter: 4 }).events).length, 1, 'seven turns: once');
});

test('a reversal on a diagonal is one turn, not two: the fourth turn of a diagonal shake is its fourth reversal', () => {
  // The pointer goes down and to the right and back, again and again. After the first move away, every move is a
  // reversal: the turns are at 200, 300, 400 and 500, so the shake is at 500, and not at 300.
  const shake = createShakeDetector();
  const moves = [[0, 0, 0], [50, 50, 100], [0, 0, 200], [50, 50, 300], [0, 0, 400], [50, 50, 500]];
  assert.deepStrictEqual(moves.map(([x, y, t]) => shake.feed(x, y, t)), [false, false, false, false, false, true]);
});

test('a flick back past where the stroke began is a turn, not the stroke going on', () => {
  // A short stroke of 30 points along x, then one fast move to 40 points behind its start: further from the start than
  // the tip ever was, but the other way. That is a reversal.
  const shake = createShakeDetector({ turns: 1 });
  assert.deepStrictEqual([[0, 0, 0], [30, 0, 16], [-40, 0, 32]].map(([x, y, t]) => shake.feed(x, y, t)), [false, false, true]);
});

test('a turn is the pointer coming back 24 points along its stroke: a corner is not one, a reversal at any angle is', () => {
  // With one turn to a shake, true says the pointer turned. It goes along x from (0, 0) to (100, 0): a stroke, not a turn.
  // Then it goes on from there to each of these points.
  const cases = [
    ['straight on', [160, 0], false],
    ['on, and off to the side', [150, 50], false],
    ['a corner: off at a right angle', [100, 80], false],
    ['a corner of a hand that is 4 points short of the tip', [96, 24], false],
    ['a bend a little past a right angle', [86, 80], false],
    ['back 23 points', [77, 0], false],
    ['back 24 points', [76, 0], true],
    ['back at 135 degrees', [50, 50], true],
    ['all the way back', [0, 0], true],
  ];
  for (const [what, [x, y], turned] of cases) {
    const shake = createShakeDetector({ turns: 1 });
    assert.strictEqual(shake.feed(0, 0, 0), false);
    assert.strictEqual(shake.feed(100, 0, 100), false);
    assert.strictEqual(shake.feed(x, y, 200), turned, what);
  }
});

test('after a corner the shake goes on in the new direction: the detector is not left looking the old way', () => {
  // Along x, then down y at a right angle (a corner: no turn), then up and down y again: two turns, and with two turns to
  // a shake it says so on the last move. A steady hand: the corner is exactly a right angle.
  const shake = createShakeDetector({ turns: 2 });
  const moves = [[0, 0, 0], [100, 0, 100], [100, 100, 200], [100, 0, 300], [100, 100, 400]];
  assert.deepStrictEqual(moves.map(([x, y, t]) => shake.feed(x, y, t)), [false, false, false, false, true]);
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
