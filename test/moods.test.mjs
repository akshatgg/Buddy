import test from 'node:test';
import assert from 'node:assert';
import {
  FPS, IDLE_FPS, REST_FPS, fpsFor, isActive, floatOffset, createBlinker, lookAt, moodPose,
} from '../src/renderer/buddy/moods.js';

// A buddy with nothing going on, and nothing for a long time.
const resting = { mood: 'idle', pressing: false, sinceLookChange: Infinity, blinkSoon: false, sinceActive: Infinity };

test('three frame rates: 30 when busy, 15 while settling, 6 at rest', () => {
  assert.strictEqual(FPS, 30);
  assert.strictEqual(IDLE_FPS, 15);
  assert.strictEqual(REST_FPS, 6);
  assert.strictEqual(fpsFor(resting), 6);
});

test('full rate for any mood but idle', () => {
  for (const mood of ['wave', 'happy', 'thinking', 'sleepy', 'wobble']) {
    assert.strictEqual(fpsFor({ ...resting, mood }), 30, mood);
  }
});

test('full rate while the pointer is pressed or dragging', () => {
  assert.strictEqual(fpsFor({ ...resting, pressing: true }), 30);
});

test('full rate for a second after the head last turned', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 0 }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 0.99 }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 1 }), 6, 'a second on it is no longer a reason');
});

test('full rate around a blink, even at rest', () => {
  assert.strictEqual(fpsFor({ ...resting, blinkSoon: true }), 30);
});

test('15 fps for ten seconds after the last busy moment, then 6', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 0 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 9.99 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 10 }), 6);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: Infinity }), 6);
});

test('a reason for the full rate beats the settling and rest rates', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 3, pressing: true }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 3, mood: 'happy' }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 3, sinceLookChange: 0.5 }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 30, blinkSoon: true }), 30);
});

test('active means a mood, a press or a head turn in the last second; a blink does not count', () => {
  const calm = { mood: 'idle', pressing: false, sinceLookChange: 5 };
  assert.strictEqual(isActive(calm), false);
  assert.strictEqual(isActive({ ...calm, mood: 'happy' }), true);
  assert.strictEqual(isActive({ ...calm, pressing: true }), true);
  assert.strictEqual(isActive({ ...calm, sinceLookChange: 0.99 }), true);
  assert.strictEqual(isActive({ ...calm, sinceLookChange: 1 }), false);
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

test('soon() says a blink is under way or about to start', () => {
  const blinker = createBlinker(() => 0); // first blink at 2 s, over by 2.16 s
  assert.strictEqual(blinker.soon(1.4, 0.5), false, 'more than 0.5 s before');
  assert.strictEqual(blinker.soon(1.5, 0.5), true, 'starts within 0.5 s');
  assert.strictEqual(blinker.soon(1.9, 0), false, 'a lookahead of 0 only covers the blink itself');
  assert.strictEqual(blinker.soon(2.05, 0), true, 'under way');
  assert.strictEqual(blinker.soon(2.15, 0), true, 'still under way just before it ends');
  assert.strictEqual(blinker.soon(2.17, 0.5), false, 'over');
  assert.strictEqual(blinker.soon(10, 0.5), false, 'a long past blink is not soon');
});

test('soon() never schedules the next blink; only value() does', () => {
  let draws = 0;
  const blinker = createBlinker(() => {
    draws += 1;
    return 0;
  });
  assert.strictEqual(draws, 1, 'the first blink time is drawn when it is made');
  for (const t of [1, 1.95, 2.05, 2.2, 5, 100]) blinker.soon(t, 0.1);
  assert.strictEqual(draws, 1, 'asking never draws another blink time');
  assert.strictEqual(blinker.soon(2.05, 0), true, 'and the first blink is still where it was');
  assert.ok(blinker.value(2.07) > 0.99);
  assert.strictEqual(blinker.value(2.2), 0, 'the first value() after the blink schedules the next one: 2.2 + 3 s');
  assert.strictEqual(draws, 2);
  assert.strictEqual(blinker.soon(5.1, 0.2), true, '5.2 s is within 0.2 s of 5.1 s');
  assert.strictEqual(blinker.soon(4.9, 0.2), false);
  assert.strictEqual(draws, 2);
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
