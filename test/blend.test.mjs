import test from 'node:test';
import assert from 'node:assert';
import { BLEND, blendPose, smoothLevel } from '../src/renderer/buddy/blend.js';
import { moodPose, blinkWeight, FPS } from '../src/renderer/buddy/moods.js';

const MOODS = [
  'idle', 'thinking', 'happy', 'wave', 'wobble', 'sleepy', 'sad', 'drowsy', 'asleep', 'wake', 'love', 'dizzy',
  'celebrate', 'listening', 'look', 'swing', 'hum', 'hop', 'confused',
];
const EYES = ['blink', 'smile', 'heart', 'swirl', 'sad', 'half', 'sleep'];

// A pose as buddy.js draws it: the eyes' blink weight is a number, `blink`, so that it can ease like the rest.
const drawn = (pose, blink = 0) => ({ ...pose, blink: blinkWeight(pose, blink) });
const numbers = (pose) => Object.fromEntries(Object.entries(pose).filter(([, v]) => typeof v === 'number'));

test('a new mood takes about 0.2 s to ease in', () => {
  assert.ok(BLEND >= 0.15 && BLEND <= 0.25, String(BLEND));
});

test('the blend starts in the pose that was showing and ends in the new mood\'s', () => {
  const from = drawn(moodPose('thinking', 0.7));
  const to = drawn(moodPose('happy', 0.1));
  assert.deepStrictEqual(numbers(blendPose(from, to, 0)), numbers(from), 'at first, what was showing');
  assert.strictEqual(blendPose(from, to, BLEND), to, 'after BLEND seconds, the new pose itself');
  assert.strictEqual(blendPose(from, to, 3), to);
  const half = blendPose(from, to, BLEND / 2);
  for (const [field, value] of Object.entries(numbers(to))) {
    assert.ok(Math.abs(half[field] - (from[field] + value) / 2) < 1e-12, `${field} is halfway at half time`);
  }
});

test('what is not a number comes from the new pose: its symbols and whether it is done', () => {
  const from = drawn(moodPose('asleep', 3));
  const to = drawn(moodPose('wake', 0));
  for (const since of [0, 0.05, 0.1, 0.19]) {
    const pose = blendPose(from, to, since);
    assert.strictEqual(pose.effect, null, 'the "z" letters go at once');
    assert.strictEqual(pose.done, false);
    assert.strictEqual(pose.eyesClosed, true);
  }
});

test('with nothing showing yet (no model), the new pose is drawn as it is', () => {
  const to = drawn(moodPose('wave', 0.3));
  assert.strictEqual(blendPose(null, to, 0), to);
});

// From every mood, caught at several moments, to every other: the drawn pose moves smoothly. As in moods.test.mjs, a
// smooth curve's step shrinks 100 to 1 when the samples are 100 times closer; a snap's does not.
test('no mood change snaps: from any mood at any moment into any other, every field moves smoothly', () => {
  const coarse = 1 / 240;
  const fine = coarse / 100;
  for (const a of MOODS) {
    for (const at of [0.05, 0.4, 1.1]) {
      const from = drawn(moodPose(a, at), 0.6); // caught in mid-blink, too
      const fields = Object.keys(numbers(from));
      for (const b of MOODS) {
        const pose = (since) => blendPose(from, drawn(moodPose(b, since)), since);
        const worstCoarse = Object.fromEntries(fields.map((field) => [field, 0]));
        const worstFine = { ...worstCoarse };
        for (let since = 0; since < 0.3; since += coarse) {
          const [here, near, next] = [pose(since), pose(since + fine), pose(since + coarse)];
          for (const field of fields) {
            worstCoarse[field] = Math.max(worstCoarse[field], Math.abs(next[field] - here[field]));
            worstFine[field] = Math.max(worstFine[field], Math.abs(near[field] - here[field]));
          }
        }
        for (const field of fields) {
          assert.ok(100 * worstFine[field] <= 2 * worstCoarse[field] + 1e-9,
            `${a} (at ${at} s) into ${b}: ${field} snaps (${worstFine[field]} in ${fine} s, ${worstCoarse[field]} in ${coarse} s)`);
        }
      }
    }
  }
});

test('a blend shows one eye at a time: the blink and the eye shapes add up to at most 1', () => {
  for (const a of MOODS) {
    const from = drawn(moodPose(a, 0.5), 0.8);
    for (const b of MOODS) {
      for (let since = 0; since <= BLEND; since += BLEND / 20) {
        const pose = blendPose(from, drawn(moodPose(b, since), 0.3), since);
        const sum = EYES.reduce((total, shape) => total + pose[shape], 0);
        assert.ok(sum <= 1 + 1e-9, `${a} into ${b} at ${since.toFixed(3)} s: ${sum}`);
      }
    }
  }
});

// Task 2's concern: woken from drowsy, the head dipped 0.14 rad, the eyes' and ears' glow halved and the head stopped
// following the pointer, all in one frame; dizzy dropped wobble's tilt. Now the first frame moves under a tenth of the
// way, and no frame more than a third: the change is spread over about 0.2 s.
test('a mood cut short no longer jumps: woken from drowsy, or dizzy after a wobble, it eases over about 0.2 s', () => {
  const frame = 1 / FPS;
  for (const [a, at, b] of [['drowsy', 30, 'wake'], ['wobble', 0.43, 'dizzy']]) {
    const from = drawn(moodPose(a, at));
    const start = drawn(moodPose(b, 0));
    const jumps = Object.keys(numbers(start)).filter((field) => Math.abs(start[field] - from[field]) >= 0.1);
    assert.ok(jumps.length > 0, `${a} into ${b} would jump without the blend`);
    for (const field of jumps) {
      const jump = Math.abs(start[field] - from[field]);
      let last = from[field];
      for (let n = 1; n * frame <= BLEND + 1e-9; n += 1) { // after that the mood's own moves (wake opens its eyes at 0.25 s)
        const value = blendPose(from, drawn(moodPose(b, n * frame)), n * frame)[field];
        const step = Math.abs(value - last);
        assert.ok(step <= (n === 1 ? 0.1 : 1 / 3) * jump + 0.03, `${a} into ${b}: ${field} moves ${step} of ${jump} in frame ${n}`);
        last = value;
      }
    }
  }
});

test('the voice level drawn moves toward each reading and never past it', () => {
  for (const level of [0, 0.3, 1]) {
    for (const target of [0, 0.5, 1]) {
      for (const dt of [0, 1 / 120, 1 / 30, 0.1, 0.5]) {
        const next = smoothLevel(level, target, dt);
        assert.ok(next >= Math.min(level, target) - 1e-12 && next <= Math.max(level, target) + 1e-12, `${level} to ${target} in ${dt} s: ${next}`);
      }
    }
  }
  assert.strictEqual(smoothLevel(0.4, 0.9, 0), 0.4, 'no time, no change');
  assert.strictEqual(smoothLevel(0.4, 0.4, 0.1), 0.4);
  assert.strictEqual(smoothLevel(0.4, 0.9, 30), 0.9, 'after a long gap (a paused page), the reading itself');
  assert.strictEqual(smoothLevel(0.4, 0.9, -1), 0.4, 'a clock that went back changes nothing');
  assert.strictEqual(smoothLevel(0.4, 0.9, NaN), 0.4);
});

test('the voice level rises quickly and falls back more slowly, like a sound meter', () => {
  const up = smoothLevel(0, 1, 0.1);
  const down = 1 - smoothLevel(1, 0, 0.1);
  assert.ok(up > down, `up ${up}, down ${down}`);
  assert.ok(up >= 0.6, 'a louder voice shows within a tenth of a second');
});

test('readings that come 10 times a second do not step: at 30 frames a second, each frame moves a part of the way', () => {
  let level = 0;
  let worst = 0;
  for (let frame = 1; frame <= 60; frame += 1) {
    const reading = Math.floor(frame / 3) % 2; // 0 and 1 in turn, a reading every 0.1 s
    const next = smoothLevel(level, reading, 1 / 30);
    worst = Math.max(worst, Math.abs(next - level));
    level = next;
  }
  assert.ok(worst <= 0.4, `the biggest step in a frame is ${worst} of a full jump`);
});
