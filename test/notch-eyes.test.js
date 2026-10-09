'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  createEyes, ease,
  BLINK_MS, BLINK_SLOW_MS, BLINK_MIN_MS, BLINK_SPAN_MS, HAPPY_MS, CELEBRATE_MS, SAD_MS, WINK_MS, RAMP_MS, WIDE_MS,
  LOOK_MAX, LOOK_MAX_X, YAWN_MS, WAKE_MS, LOVE_MS, Z_FOR_MS, FIDGET_MIN_MS, FIDGET_SPAN_MS, FIDGETS,
  SAY_GROW_MS, SAY_HOLD_MS, SAY_SHRINK_MS,
} = require('../src/renderer/notch/eyes.js');

const open = { open: 1, arch: 0, curl: 0, heart: 0, droop: 0, tilt: 0 };
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
  assert.strictEqual(LOOK_MAX_X, 3);
  assert.strictEqual(YAWN_MS, 1600);
  assert.strictEqual(WAKE_MS, 900);
  assert.strictEqual(LOVE_MS, 1600);
  assert.strictEqual(Z_FOR_MS, 5 * 60 * 1000);
  assert.deepStrictEqual([FIDGET_MIN_MS, FIDGET_SPAN_MS], [15_000, 10_000]);
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
  const eyes = createEyes({ random: () => rolls.shift(), wander: () => 0 });
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

test('look: 1/200 of the pointer\'s distance, up to 3 pt across and 2 pt up or down', () => {
  const eyes = createEyes({ random: () => 0 });
  assert.strictEqual(eyes.setLook(100, -50), true);
  assert.deepStrictEqual(eyes.frame(0).look, { x: 0.5, y: -0.25 });
  eyes.setLook(1000, -1000);
  assert.deepStrictEqual(eyes.frame(0).look, { x: 3, y: -2 });
  eyes.setLook(-601, 0);
  assert.deepStrictEqual(eyes.frame(0).look, { x: -3, y: 0 });
  // A pointer that is far away turns the eyes no further: nothing to wake for.
  assert.strictEqual(eyes.setLook(-900, 0), false);
  assert.strictEqual(eyes.setLook(-600, 2), false);
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
  eyes.setMood('dizzy', 0);
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

test('ease: the words\' wing grows or shrinks most of the way in 220 ms, and is there once within half a point', () => {
  let w = 0;
  for (let t = 0; t < SAY_GROW_MS; t += 33) w = ease(w, 200, 33);
  assert.ok(w > 190 && w <= 200, `grown ${w}`);
  assert.strictEqual(ease(199.7, 200, 1), 200);
  assert.strictEqual(ease(0.3, 0, 1), 0);
  assert.strictEqual(ease(50, 50, 33), 50);
  assert.strictEqual(ease(100, 0, 0), 100, 'no time: no change');
  assert.ok(ease(100, 0, 33) < 100 && ease(100, 0, 33) > 0);
  assert.strictEqual(SAY_HOLD_MS, 2600);
  assert.strictEqual(SAY_SHRINK_MS, 220);
});

test('drowsy: a yawn (nearly shut, then half open) with slow blinks; woken: wide open, then idle', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('drowsy', 0);
  const yawn = eyes.frame(YAWN_MS / 2);
  assert.ok(yawn.left.open < 0.2, `squeezed ${yawn.left.open}`);
  assert.strictEqual(yawn.active, true);
  const after = eyes.frame(YAWN_MS + 10);
  near(after.left.open, 0.5);
  assert.strictEqual(after.active, false, 'half shut, nothing moving');
  eyes.setMood('wake', 2000);
  const woken = eyes.frame(2000);
  assert.strictEqual(woken.wide, 1);
  assert.strictEqual(woken.left.open, 1);
  assert.ok(eyes.frame(2000 + WAKE_MS / 2).wide > 0.4);
  assert.strictEqual(eyes.frame(2000 + WAKE_MS).done, true);
});

test('asleep: "z" letters for the first 5 minutes only', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.setMood('asleep', 0);
  assert.strictEqual(eyes.frame(1000).z, true);
  assert.strictEqual(eyes.frame(Z_FOR_MS - 1).z, true);
  assert.strictEqual(eyes.frame(Z_FOR_MS).z, false);
  eyes.setMood('asleep', Z_FOR_MS + 10);
  assert.strictEqual(eyes.frame(Z_FOR_MS + 20).z, false, 'asleep again is the same sleep: not started over');
  eyes.setMood('idle', Z_FOR_MS + 30);
  assert.strictEqual(eyes.frame(Z_FOR_MS + 40).z, false);
});

test('love: hearts for 1.6 s with a little bounce, no blink on top, then idle', () => {
  const eyes = createEyes({ random: () => 0 });
  eyes.frame(0); // the blink at 3000
  eyes.setMood('love', 2900);
  const f = eyes.frame(3050);
  assert.strictEqual(f.left.heart, 1);
  assert.strictEqual(f.right.heart, 1);
  assert.strictEqual(f.left.open, 0);
  assert.ok(f.bounce > 0);
  assert.strictEqual(f.active, true);
  assert.strictEqual(eyes.frame(2900 + LOVE_MS).done, true);
  assert.strictEqual(eyes.frame(2900 + LOVE_MS + 10).left.heart, 0);
});

test('idle and left alone, the eyes look around every 15 to 25 s; hover or a mood puts it off', () => {
  const rolls = [0, 0]; // the wait (15 s), then the first look-around: a glance
  const eyes = createEyes({ random: () => 0.99, wander: () => rolls.shift() ?? 0.5 });
  const first = eyes.frame(0);
  assert.strictEqual(first.nextIn, BLINK_MIN_MS + 0.99 * BLINK_SPAN_MS > FIDGET_MIN_MS ? FIDGET_MIN_MS : first.nextIn);
  const quarter = eyes.frame(FIDGET_MIN_MS + FIDGETS.glance / 4);
  assert.ok(quarter.look.x < -2.9, `looks left ${quarter.look.x}`);
  assert.strictEqual(quarter.active, true);
  const threeQuarters = eyes.frame(FIDGET_MIN_MS + (FIDGETS.glance * 3) / 4);
  assert.ok(threeQuarters.look.x > 2.9, `then right ${threeQuarters.look.x}`);
  const over = eyes.frame(FIDGET_MIN_MS + FIDGETS.glance);
  assert.deepStrictEqual(over.look, { x: 0, y: 0 }, 'back to the pointer');
  assert.strictEqual(over.active, false);

  const busy = createEyes({ random: () => 0.99, wander: () => 0 });
  busy.frame(0);
  busy.setMood('thinking', 1);
  assert.strictEqual(busy.frame(FIDGET_MIN_MS + 100).look.x, -LOOK_MAX, 'thinking looks its own way, no look-around');
  busy.setMood('idle', FIDGET_MIN_MS + 200);
  busy.setHover(true);
  assert.deepStrictEqual(busy.frame(FIDGET_MIN_MS * 3).look, { x: 0, y: 0 }, 'hovered: none');
  busy.setHover(false);
  busy.setWander(false);
  assert.deepStrictEqual(busy.frame(FIDGET_MIN_MS * 6).look, { x: 0, y: 0 }, 'the face shows instead: none');
});

test('a double blink shuts the eyes twice; a look up looks up and back', () => {
  const double = createEyes({ random: () => 0.99, wander: (() => { const r = [0, 0.99]; return () => r.shift() ?? 0.5; })() });
  double.frame(0);
  const shut = double.frame(FIDGET_MIN_MS + FIDGETS.double * 0.21);
  assert.ok(shut.left.open < 0.05, `shut ${shut.left.open}`);
  const between = double.frame(FIDGET_MIN_MS + FIDGETS.double * 0.49);
  assert.ok(between.left.open > 0.9);
  const up = createEyes({ random: () => 0.99, wander: (() => { const r = [0, 0.5]; return () => r.shift() ?? 0.5; })() });
  up.frame(0);
  const top = up.frame(FIDGET_MIN_MS + FIDGETS.up / 2);
  near(top.look.y, -LOOK_MAX);
  assert.ok(top.look.x > 0);
});
