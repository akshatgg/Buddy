import test from 'node:test';
import assert from 'node:assert';
import { FPS, floatOffset, createBlinker, lookAt, moodPose } from '../src/renderer/buddy/moods.js';

test('30 frames a second', () => {
  assert.strictEqual(FPS, 30);
});

test('floats on a 3 second sine', () => {
  assert.strictEqual(floatOffset(0), 0);
  assert.ok(Math.abs(floatOffset(0.75) - 0.035) < 1e-9);
  assert.ok(Math.abs(floatOffset(3)) < 1e-9);
});

test('blinks shut and open again, then waits 3-6 s', () => {
  const blinker = createBlinker(() => 0); // first blink at 2 s, then every 3 s
  assert.strictEqual(blinker.value(1.9), 0);
  assert.ok(Math.abs(blinker.value(2.035) - 0.5) < 1e-9);
  assert.ok(blinker.value(2.07) > 0.99, 'shut at 70 ms');
  assert.strictEqual(blinker.value(2.2), 0);
  assert.strictEqual(blinker.value(4), 0);
  assert.ok(blinker.value(5.27) > 0.99, 'next blink 3 s after the last one ended');
});

test('looks toward the pointer, within limits', () => {
  assert.deepStrictEqual(lookAt(0, 0), { yaw: 0, pitch: 0 });
  assert.deepStrictEqual(lookAt(300, 100), { yaw: 0.45, pitch: 0.2 }); // 300/600 = 0.5, capped at 0.45
  assert.deepStrictEqual(lookAt(-5000, -5000), { yaw: -0.45, pitch: -0.2 });
});

test('idle is the rest pose and never ends', () => {
  const p = moodPose('idle', 100);
  assert.strictEqual(p.lift, 0);
  assert.strictEqual(p.done, false);
});

test('happy bounces and smiles for 1.2 s', () => {
  assert.strictEqual(moodPose('happy', 0.5).smile, 1);
  assert.strictEqual(moodPose('happy', 1.1).done, false);
  assert.strictEqual(moodPose('happy', 1.2).done, true);
});

test('wave raises the left arm and ends after 1.8 s', () => {
  assert.ok(moodPose('wave', 0.9).armL > 1.5);
  assert.strictEqual(moodPose('wave', 1.8).done, true);
  assert.strictEqual(moodPose('wave', 2).armL, 0);
});

test('sleepy closes the eyes and stays', () => {
  assert.strictEqual(moodPose('sleepy', 10).eyesClosed, true);
  assert.strictEqual(moodPose('sleepy', 10).done, false);
});

test('thinking tilts the head; unknown moods rest', () => {
  assert.ok(moodPose('thinking', 0).headTilt > 0.1);
  assert.strictEqual(moodPose('confused', 1).headTilt, 0);
});
