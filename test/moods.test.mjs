import test from 'node:test';
import assert from 'node:assert';
import {
  FPS, IDLE_FPS, REST_FPS, BLINK_LOOKAHEAD, SWEEP_HZ, SWEEP_LAG,
  fpsFor, isActive, wakeDelay, floatOffset, createBlinker, lookAt, moodPose,
} from '../src/renderer/buddy/moods.js';

// A buddy with nothing going on, and nothing for a long time.
const resting = { mood: 'idle', pressing: false, sinceLookChange: Infinity, blinkSoon: false, sinceActive: Infinity };

test('three frame rates: 30 for a mood, a press or a blink; 15 while settling; 6 at rest', () => {
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

test('full rate around a blink, even at rest', () => {
  assert.strictEqual(fpsFor({ ...resting, blinkSoon: true }), 30);
});

test('the head following the pointer runs at 15 fps, not 30, until ten seconds after it last turned', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 0 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 0.5 }), 15, 'not a reason for the full rate');
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 9.99 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 10 }), 6);
});

test('15 fps for ten seconds after the last mood or press, then 6', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 0 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 9.99 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 10 }), 6);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: Infinity }), 6);
});

test('either a recent head turn or a recent mood keeps it at 15 fps', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 50, sinceActive: 3 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 3, sinceActive: 50 }), 15);
  assert.strictEqual(fpsFor({ ...resting, sinceLookChange: 50, sinceActive: 50 }), 6);
});

test('a reason for the full rate beats the settling and rest rates', () => {
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 3, sinceLookChange: 0, pressing: true }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 3, sinceLookChange: 0, mood: 'happy' }), 30);
  assert.strictEqual(fpsFor({ ...resting, sinceActive: 30, sinceLookChange: 30, blinkSoon: true }), 30);
});

test('active means a mood or a press; a blink and a head turn do not count', () => {
  const calm = { mood: 'idle', pressing: false };
  assert.strictEqual(isActive(calm), false);
  assert.strictEqual(isActive({ ...calm, mood: 'happy' }), true);
  assert.strictEqual(isActive({ ...calm, pressing: true }), true);
  assert.strictEqual(isActive({ ...calm, sinceLookChange: 0 }), false, 'the head turning is not');
  assert.strictEqual(isActive({ ...calm, blinkSoon: true }), false, 'nor is a blink');
});

test('the blink lookahead is one rest frame, so the frame before a blink always sees it coming', () => {
  assert.strictEqual(BLINK_LOOKAHEAD, 1 / REST_FPS);
});

test('at rest every blink is drawn at the full rate from its first frame', () => {
  // The page's loop: ask for the rate (blinker.soon), schedule the next frame at it, then draw (blinker.value).
  // Timers are never early, so try them on time and a few ms late. The blink starts at every phase of the rest frames.
  for (const lateness of [0, 0.003]) {
    for (let offset = 0; offset < 1 / REST_FPS; offset += 0.005) {
      const start = 2 + offset;
      const blinker = createBlinker(() => (start - 2) / 3);
      const frames = []; // the times of the frames drawn from the start of the blink to its end
      for (let t = 0; t < start + 0.3; ) {
        const fps = fpsFor({ ...resting, blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD) });
        if (t >= start && t < start + 0.16) frames.push(t);
        blinker.value(t);
        t += 1 / fps + lateness;
      }
      const why = `blink at ${start.toFixed(3)} s, timers ${lateness * 1000} ms late: frames ${frames.map((t) => ((t - start) * 1000).toFixed(0))} ms into it`;
      assert.ok(frames.length >= 4, why);
      assert.ok(frames[0] - start <= 1 / FPS + lateness + 1e-9, `the first frame comes within one full-rate frame: ${why}`);
      frames.slice(1).forEach((t, i) => assert.ok(t - frames[i] <= 1 / FPS + lateness + 1e-9, `no slow frame inside it: ${why}`));
    }
  }
});

test('waking draws at once, but never sooner than the full rate allows', () => {
  assert.strictEqual(wakeDelay(Infinity), 0, 'nothing drawn yet');
  assert.strictEqual(wakeDelay(1), 0, 'the last frame was long ago: draw now');
  assert.strictEqual(wakeDelay(1 / FPS), 0);
  assert.ok(Math.abs(wakeDelay(0.01) - (1 / FPS - 0.01)) < 1e-12, 'a frame was just drawn: wait out the rest of its 1/30 s');
  assert.ok(Math.abs(wakeDelay(0) - 1 / FPS) < 1e-12);
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

test('thinking shows the eyes as lines, and no mouth', () => {
  for (const since of [0, 0.4, 7]) {
    assert.strictEqual(moodPose('thinking', since).eyesClosed, true, `eyes are lines at ${since} s`);
    assert.strictEqual(moodPose('thinking', since).mouthO, 0, `no mouth at ${since} s`);
  }
});

test('thinking sweeps the eye lines up and down 1.2 times a second, the right one 0.6 rad behind', () => {
  assert.strictEqual(SWEEP_HZ, 1.2);
  assert.strictEqual(SWEEP_LAG, 0.6);
  const cycle = 1 / SWEEP_HZ;
  assert.ok(Math.abs(moodPose('thinking', cycle / 4).eyeL - 1) < 1e-9, 'the left line is at the top a quarter cycle in');
  assert.ok(Math.abs(moodPose('thinking', (3 * cycle) / 4).eyeL + 1) < 1e-9, 'and at the bottom three quarters in');
  assert.ok(Math.abs(moodPose('thinking', 0).eyeL) < 1e-9, 'it starts from the middle');
});

test('while thinking the right eye line trails the left one', () => {
  const behind = SWEEP_LAG / (2 * Math.PI * SWEEP_HZ); // seconds
  for (const since of [0.1, 0.37, 0.8, 2.3, 5.05]) {
    const now = moodPose('thinking', since);
    assert.ok(Math.abs(now.eyeR - moodPose('thinking', since - behind).eyeL) < 1e-9, `the right line is where the left was, at ${since} s`);
  }
  const top = moodPose('thinking', 1 / SWEEP_HZ / 4);
  assert.ok(top.eyeR < top.eyeL, 'when the left line reaches the top, the right one is still on its way up');
  assert.ok(top.eyeR > 0.5, 'but not far behind');
});

test('the eye lines rest in place when not thinking', () => {
  for (const [mood, since] of [['idle', 3], ['happy', 0.5], ['wave', 0.9], ['sleepy', 10], ['wobble', 0.2]]) {
    const p = moodPose(mood, since);
    assert.strictEqual(p.eyeL, 0, `${mood}: eyeL`);
    assert.strictEqual(p.eyeR, 0, `${mood}: eyeR`);
  }
});
