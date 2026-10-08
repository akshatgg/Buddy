'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  createEyes, saying,
  BLINK_MS, BLINK_SLOW_MS, BLINK_MIN_MS, BLINK_SPAN_MS, HAPPY_MS, CELEBRATE_MS, SAD_MS, WINK_MS, RAMP_MS, WIDE_MS,
  LOOK_MAX, SAY_GROW_MS, SAY_HOLD_MS, SAY_SHRINK_MS,
} = require('../src/renderer/notch/eyes.js');

const open = { open: 1, arch: 0, curl: 0, droop: 0, tilt: 0 };
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 1e-6, `${msg ?? ''} ${a} should be ${b}`);

test('the timings are the spec\'s', () => {
  assert.strictEqual(BLINK_MS, 120);
  assert.strictEqual(BLINK_SLOW_MS, 240);
  assert.strictEqual(BLINK_MIN_MS, 3000);
  assert.strictEqual(BLINK_SPAN_MS, 3000);
  assert.strictEqual(HAPPY_MS, 1200);
  assert.strictEqual(CELEBRATE_MS, 1200);
  assert.strictEqual(SAD_MS, 2500);
  assert.strictEqual(WINK_MS, 300);
  assert.strictEqual(WIDE_MS, 180);
  assert.strictEqual(LOOK_MAX, 2);
  assert.strictEqual(SAY_GROW_MS, 220);
  assert.strictEqual(SAY_HOLD_MS, 2600);
  assert.strictEqual(SAY_SHRINK_MS, 220);
});

test('idle: both eyes open, nothing else going on, and the page can sleep until the blink', () => {
  const eyes = createEyes({ random: () => 0 });
  const f = eyes.frame(1000);
  assert.deepStrictEqual(f.left, open);
  assert.deepStrictEqual(f.right, open);
  assert.strictEqual(f.bounce, 0);
  assert.strictEqual(f.dot, 0);
  assert.strictEqual(f.wide, 0);
  assert.deepStrictEqual(f.look, { x: 0, y: 0 });
  assert.strictEqual(f.done, false);
  assert.strictEqual(f.active, false);
  assert.strictEqual(f.nextIn, BLINK_MIN_MS); // the first blink: 3 s after the first frame with random() = 0
  assert.strictEqual(eyes.frame(2000).nextIn, BLINK_MIN_MS - 1000);
});

test('blinks: 120 ms, 3 to 6 s apart, from the injected random', () => {
  const rolls = [0, 1, 0.5];
  const eyes = createEyes({ random: () => rolls.shift() });
  eyes.frame(0); // random() = 0: the first blink at 3000
  assert.strictEqual(eyes.frame(2999).left.open, 1);
  assert.strictEqual(eyes.frame(2999).active, false);
  const shut = eyes.frame(3050);
  assert.ok(shut.left.open < 0.05, `shut ${shut.left.open}`);
  assert.strictEqual(shut.left.open, shut.right.open);
  assert.strictEqual(shut.active, true);
  assert.strictEqual(shut.nextIn, 0);
  const opening = eyes.frame(3100);
  assert.ok(opening.left.open > 0.5 && opening.left.open < 1, `opening ${opening.left.open}`);
  const over = eyes.frame(3000 + BLINK_MS);
  assert.strictEqual(over.left.open, 1);
  assert.strictEqual(over.active, false);
  // random() = 1: the next one 6 s after this one ended.
  assert.strictEqual(over.nextIn, BLINK_MIN_MS + BLINK_SPAN_MS);
  assert.strictEqual(eyes.frame(3120 + 5999).left.open, 1);
  assert.ok(eyes.frame(3120 + 6000 + 50).left.open < 0.05);
});

test('a blink never tears a closed eye: one due during happy is skipped', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.frame(0); // the blink at 3000
  eyes.setMood('happy', 2950);
  const f = eyes.frame(3100);
  assert.strictEqual(f.left.arch, 1);
  assert.strictEqual(f.left.open, 0);
  // Happy is over at 4150; the skipped blink was moved on (3 s from now), not left half-done.
  const after = eyes.frame(4200);
  assert.deepStrictEqual(after.left, open);
  assert.strictEqual(after.nextIn, BLINK_MIN_MS);
});

test('look: 1/200 of the pointer\'s distance, up to 2 pt either way', () => {
  const eyes = createEyes({ random: () => 0 });
  assert.strictEqual(eyes.setLook(100, -50), true);
  assert.deepStrictEqual(eyes.frame(0).look, { x: 0.5, y: -0.25 });
  eyes.setLook(1000, -1000);
  assert.deepStrictEqual(eyes.frame(0).look, { x: 2, y: -2 });
  eyes.setLook(-401, 0);
  assert.deepStrictEqual(eyes.frame(0).look, { x: -2, y: 0 });
  // A pointer that is far away turns the eyes no further: nothing to wake for.
  assert.strictEqual(eyes.setLook(-900, 0), false);
  assert.strictEqual(eyes.setLook(-400, 2), false);
  assert.strictEqual(eyes.setLook(0, 0), true);
});

test('happy: closed as arches for 1.2 s, then idle', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('happy', 1000);
  const start = eyes.frame(1000);
  assert.strictEqual(start.left.arch, 0); // eases in over the ramp
  assert.strictEqual(start.active, true);
  const mid = eyes.frame(1000 + RAMP_MS / 2);
  assert.ok(mid.left.arch > 0 && mid.left.arch < 1);
  near(mid.left.open, 1 - mid.left.arch);
  const full = eyes.frame(1000 + RAMP_MS);
  assert.deepStrictEqual(full.left, { ...open, open: 0, arch: 1 });
  assert.deepStrictEqual(full.right, { ...open, open: 0, arch: 1 });
  assert.strictEqual(full.done, false);
  assert.strictEqual(eyes.frame(2199).done, false);
  const end = eyes.frame(2200);
  assert.strictEqual(end.done, true);
  assert.deepStrictEqual(end.left, open);
  assert.strictEqual(end.active, false);
  const later = eyes.frame(2300);
  assert.strictEqual(later.done, false);
  assert.deepStrictEqual(later.right, open);
});

test('celebrate: the arches and two bounces within 1.2 s', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('celebrate', 0);
  near(eyes.frame(0).bounce, 0);
  near(eyes.frame(300).bounce, 1, 'first bounce');
  near(eyes.frame(600).bounce, 0);
  near(eyes.frame(900).bounce, 1, 'second bounce');
  assert.strictEqual(eyes.frame(600).left.arch, 1);
  assert.strictEqual(eyes.frame(1199).done, false);
  const end = eyes.frame(1200);
  assert.strictEqual(end.done, true);
  assert.strictEqual(end.bounce, 0);
  assert.deepStrictEqual(end.left, open);
});

test('sad: drooping and tilted outward for 2.5 s', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('sad', 0);
  const f = eyes.frame(RAMP_MS);
  assert.strictEqual(f.left.droop, 1);
  assert.strictEqual(f.right.droop, 1);
  assert.ok(f.left.tilt > 0 && f.left.tilt <= 20, `tilt ${f.left.tilt}`);
  assert.strictEqual(f.right.tilt, -f.left.tilt);
  assert.strictEqual(f.left.open, 1);
  assert.strictEqual(eyes.frame(2499).done, false);
  assert.strictEqual(eyes.frame(2500).done, true);
  assert.deepStrictEqual(eyes.frame(2500).left, open);
});

test('wave: the right eye winks once, 300 ms', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('wave', 0);
  near(eyes.frame(0).right.open, 1);
  near(eyes.frame(150).right.open, 0, 'shut at the middle');
  assert.strictEqual(eyes.frame(150).left.open, 1);
  assert.strictEqual(eyes.frame(150).active, true);
  assert.strictEqual(eyes.frame(299).done, false);
  const end = eyes.frame(300);
  assert.strictEqual(end.done, true);
  assert.deepStrictEqual(end.right, open);
});

test('thinking: up and to the left, the dot pulses, slow blinks', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setLook(500, 500);
  eyes.setMood('thinking', 0);
  const f = eyes.frame(0);
  assert.deepStrictEqual(f.look, { x: -2, y: -2 });
  near(f.dot, 0);
  assert.strictEqual(f.active, true);
  near(eyes.frame(600).dot, 1);
  near(eyes.frame(1200).dot, 0);
  // The blink due at 3000 takes 240 ms, not 120.
  assert.ok(eyes.frame(3000 + 200).left.open < 1);
  assert.strictEqual(eyes.frame(3000 + BLINK_SLOW_MS).left.open, 1);
  // Never over by itself.
  assert.strictEqual(eyes.frame(10000).done, false);
  assert.deepStrictEqual(eyes.frame(10000).look, { x: -2, y: -2 });
});

test('sleepy: half closed; asleep: closed as a smile, no blinks', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('sleepy', 0);
  eyes.frame(0);
  assert.strictEqual(eyes.frame(100).left.open, 0.5);
  assert.strictEqual(eyes.frame(100).left.curl, 0);
  assert.strictEqual(eyes.frame(100).active, false);
  assert.ok(eyes.frame(3100).left.open < 0.5, 'a slow blink closes it further');
  assert.strictEqual(eyes.frame(3000 + BLINK_SLOW_MS).left.open, 0.5);
  eyes.setMood('asleep', 4000);
  assert.strictEqual(eyes.frame(4000).active, true); // the eyes are closing: drawn at the full rate
  const asleep = eyes.frame(4000 + RAMP_MS);
  assert.deepStrictEqual(asleep.left, { ...open, open: 0, curl: 1 });
  assert.deepStrictEqual(asleep.right, { ...open, open: 0, curl: 1 });
  assert.strictEqual(asleep.active, false);
  // The blink due at 6240 is skipped.
  assert.deepStrictEqual(eyes.frame(6300).left, { ...open, open: 0, curl: 1 });
  assert.strictEqual(eyes.frame(20000).done, false);
});

test('listening and hover open the eyes a little wider, over 180 ms', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('listening', 0);
  assert.strictEqual(eyes.frame(0).wide, 0);
  const mid = eyes.frame(90);
  assert.ok(mid.wide > 0 && mid.wide < 1, `wide ${mid.wide}`);
  assert.strictEqual(mid.active, true);
  assert.strictEqual(eyes.frame(WIDE_MS).wide, 1);
  assert.strictEqual(eyes.frame(WIDE_MS).active, false);
  assert.deepStrictEqual(eyes.frame(WIDE_MS).left, open);
  eyes.setMood('idle', 1000);
  assert.strictEqual(eyes.frame(1000).wide, 1);
  assert.strictEqual(eyes.frame(1000 + WIDE_MS).wide, 0);
  eyes.setHover(true);
  assert.strictEqual(eyes.frame(2000).wide, 0);
  assert.strictEqual(eyes.frame(2000 + WIDE_MS).wide, 1);
  // The change starts at the first frame after it (the page draws one at once).
  eyes.setHover(false);
  assert.strictEqual(eyes.frame(3000).wide, 1);
  assert.strictEqual(eyes.frame(3000 + WIDE_MS).wide, 0);
});

test('a mood this page does not know looks like idle; a new mood replaces the old one', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('love', 0);
  const f = eyes.frame(500);
  assert.deepStrictEqual(f.left, open);
  assert.strictEqual(f.active, false);
  assert.strictEqual(f.done, false);
  eyes.setMood('sad', 1000);
  eyes.setMood('happy', 1100);
  assert.strictEqual(eyes.frame(1100 + RAMP_MS).left.arch, 1);
  assert.strictEqual(eyes.frame(1100 + RAMP_MS).left.droop, 0);
  assert.strictEqual(eyes.frame(1100 + HAPPY_MS).done, true);
});

test('saying: grows over 220 ms, holds 2.6 s, shrinks over 220 ms', () => {
  assert.deepStrictEqual(saying(200, 0), { grow: 0, hold: false, done: false, width: 0 });
  const growing = saying(200, 110);
  assert.ok(growing.grow > 0 && growing.grow < 1, `grow ${growing.grow}`);
  assert.strictEqual(growing.hold, false);
  near(growing.width, 200 * growing.grow);
  assert.deepStrictEqual(saying(200, 220), { grow: 1, hold: true, done: false, width: 200 });
  assert.deepStrictEqual(saying(200, 2000), { grow: 1, hold: true, done: false, width: 200 });
  assert.deepStrictEqual(saying(200, 2819), { grow: 1, hold: true, done: false, width: 200 });
  const shrinking = saying(200, 2930);
  assert.ok(shrinking.grow > 0 && shrinking.grow < 1, `shrink ${shrinking.grow}`);
  assert.strictEqual(shrinking.hold, false);
  assert.strictEqual(shrinking.done, false);
  assert.deepStrictEqual(saying(200, 3040), { grow: 0, hold: false, done: true, width: 0 });
  assert.deepStrictEqual(saying(200, 9000), { grow: 0, hold: false, done: true, width: 0 });
  // Monotonic: the grow never steps back while growing.
  let last = 0;
  for (let ms = 0; ms <= 220; ms += 10) {
    const { grow } = saying(100, ms);
    assert.ok(grow >= last, `at ${ms}: ${grow} < ${last}`);
    last = grow;
  }
});
