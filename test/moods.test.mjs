import test from 'node:test';
import assert from 'node:assert';
import {
  FPS, IDLE_FPS, REST_FPS, SLEEP_FPS, BLINK_LOOKAHEAD, SWEEP_HZ, SWEEP_LAG, FIDGETS,
  fpsFor, isActive, wakeDelay, floatOffset, createBlinker, blinkWeight, lookAt, moodPose, createFidgeter,
} from '../src/renderer/buddy/moods.js';

// A buddy with nothing going on, and nothing for a long time.
const resting = { mood: 'idle', pressing: false, sinceLookChange: Infinity, blinkSoon: false, sinceActive: Infinity };

// The moods that draw at the full rate all the time they play: all but idle, drowsy and asleep.
const LIVELY = [
  'thinking', 'happy', 'wave', 'wobble', 'sleepy', 'sad', 'wake', 'love', 'dizzy', 'celebrate', 'listening',
  'look', 'swing', 'hum', 'hop',
];

test('four frame rates: 30 for a mood, a press or a blink; 15 while settling; 6 at rest; 4 asleep', () => {
  assert.strictEqual(FPS, 30);
  assert.strictEqual(IDLE_FPS, 15);
  assert.strictEqual(REST_FPS, 6);
  assert.strictEqual(SLEEP_FPS, 4);
  assert.strictEqual(fpsFor(resting), 6);
});

test('full rate for any mood but idle, drowsy (once it has yawned) and asleep', () => {
  for (const mood of LIVELY) {
    assert.strictEqual(fpsFor({ ...resting, mood }), 30, mood);
    assert.strictEqual(fpsFor({ ...resting, mood, since: 0.5 }), 30, mood);
  }
});

test('asleep draws 4 frames a second, whatever the blinker and the pointer do', () => {
  const asleep = { ...resting, mood: 'asleep', since: 30 };
  assert.strictEqual(fpsFor(asleep), 4);
  assert.strictEqual(fpsFor({ ...asleep, since: 0 }), 4, 'also while it falls asleep');
  assert.strictEqual(fpsFor({ ...asleep, blinkSoon: true }), 4, 'a blink coming: sleeping eyes do not blink');
  assert.strictEqual(fpsFor({ ...asleep, sinceLookChange: 0 }), 4, 'a sleeping head does not follow the pointer');
  assert.strictEqual(fpsFor({ ...asleep, sinceActive: 0 }), 4);
  assert.strictEqual(fpsFor({ ...asleep, pressing: true }), 30, 'but a press is drawn at the full rate');
});

test('drowsy draws its yawn at 30 frames a second, then 15', () => {
  const drowsy = { ...resting, mood: 'drowsy' };
  assert.strictEqual(fpsFor(drowsy), 30, 'with no `since`, it has just started');
  assert.strictEqual(fpsFor({ ...drowsy, since: 0 }), 30);
  assert.strictEqual(fpsFor({ ...drowsy, since: 1.59 }), 30, 'still yawning');
  assert.strictEqual(fpsFor({ ...drowsy, since: 1.6 }), 15, 'the yawn is over');
  assert.strictEqual(fpsFor({ ...drowsy, since: 59 }), 15, 'and never 6, however long it lasts');
  assert.strictEqual(fpsFor({ ...drowsy, since: 5, blinkSoon: true }), 15, 'a blink coming: half-shut eyes do not blink');
  assert.strictEqual(fpsFor({ ...drowsy, since: 5, pressing: true }), 30, 'a press');
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

test('active: a press, or any mood but idle, drowsy once it has yawned, and asleep', () => {
  const calm = { mood: 'idle', pressing: false };
  for (const mood of LIVELY) assert.strictEqual(isActive({ ...calm, mood, since: 0.5 }), true, mood);
  assert.strictEqual(isActive({ ...calm, mood: 'drowsy', since: 0 }), true, 'yawning');
  assert.strictEqual(isActive({ ...calm, mood: 'drowsy', since: 1.59 }), true, 'still yawning');
  assert.strictEqual(isActive({ ...calm, mood: 'drowsy', since: 1.6 }), false, 'the yawn is over');
  assert.strictEqual(isActive({ ...calm, mood: 'drowsy' }), true, 'with no `since`, it has just started');
  for (const since of [0, 1, 100]) assert.strictEqual(isActive({ ...calm, mood: 'asleep', since }), false, `asleep, ${since} s`);
  assert.strictEqual(isActive({ ...calm, mood: 'asleep', since: 100, pressing: true }), true, 'a press always is');
  assert.strictEqual(isActive({ ...calm, mood: 'drowsy', since: 30, pressing: true }), true);
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

test('sleepy, which the app sends for "no internet", is now the sad pose, and ends with it', () => {
  for (const since of [0, 0.3, 1, 2, 2.4, 2.5, 10]) {
    assert.deepStrictEqual(moodPose('sleepy', since), moodPose('sad', since), `at ${since} s`);
  }
  assert.strictEqual(moodPose('sleepy', 1).eyesClosed, false, 'droopy eyes, not shut ones');
  assert.strictEqual(moodPose('sleepy', 2.5).done, true);
});

test('thinking tilts the head; an unknown mood keeps it level', () => {
  assert.ok(moodPose('thinking', 0).headTilt > 0.1);
  assert.strictEqual(moodPose('confused', 1).headTilt, 0);
});

test('thinking shows the eyes as lines, and no mouth', () => {
  for (const since of [0, 0.4, 7]) {
    assert.strictEqual(moodPose('thinking', since).eyesClosed, true, `eyes are lines at ${since} s`);
    assert.strictEqual(moodPose('thinking', since).mouthO, 0, `no mouth at ${since} s`);
  }
});

test('thinking sweeps the eye lines up and down 1.2 times a second', () => {
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

test('the eye lines rest in place when not thinking (listening raises the eyes a little, below)', () => {
  const moods = [
    ['idle', 3], ['happy', 0.5], ['wave', 0.9], ['sleepy', 10], ['wobble', 0.2], ['sad', 1], ['drowsy', 5], ['asleep', 10],
    ['wake', 0.6], ['love', 1], ['dizzy', 1], ['celebrate', 0.5], ['look', 1], ['swing', 0.7], ['hum', 1], ['hop', 0.4],
  ];
  for (const [mood, since] of moods) {
    const p = moodPose(mood, since);
    assert.strictEqual(p.eyeL, 0, `${mood}: eyeL`);
    assert.strictEqual(p.eyeR, 0, `${mood}: eyeR`);
  }
});

test('a pose that shuts the eyes gives a blink weight of 1, whatever the blinker says', () => {
  const shut = [['drowsy', 0.5], ['drowsy', 1.2], ['wake', 0], ['wake', 0.2], ['thinking', 0], ['thinking', 0.4], ['thinking', 7]];
  for (const [mood, since] of shut) {
    const pose = moodPose(mood, since);
    for (const blink of [0, 0.5, 1]) {
      assert.strictEqual(blinkWeight(pose, blink), 1, `${mood} at ${since} s, blink ${blink}`);
    }
  }
});

// The blink and the smile both reshape the same eye, and on top of each other they tear it (see blinkWeight). So no pose
// may ask for both, whatever the mood and however long it has lasted. 'confused' is not a mood: it ends at once.
const MOODS = [
  'idle', 'thinking', 'happy', 'wave', 'sleepy', 'wobble', 'drowsy', 'asleep', 'wake', 'love', 'dizzy', 'sad', 'celebrate',
  'listening', 'look', 'swing', 'hum', 'hop', 'confused',
];

test('no mood, at any time in its first 10 seconds, both smiles and shuts the eyes', () => {
  for (const name of MOODS) {
    for (let hundredths = 0; hundredths <= 1000; hundredths += 1) {
      const since = hundredths / 100;
      const pose = moodPose(name, since);
      assert.ok(!(pose.smile > 0 && pose.eyesClosed), `${name} at ${since} s smiles and shuts the eyes`);
    }
  }
});

test('the happy "∩" eyes never blink: while smiling the blink weight is 0, even in mid-blink', () => {
  // The blink and the smile both reshape the same eye, and on top of each other they tear it.
  for (const [mood, times] of [['happy', [0, 0.2, 0.6, 1, 1.19]], ['wave', [0, 0.3, 0.9, 1.5, 1.79]]]) {
    for (const since of times) {
      const pose = moodPose(mood, since);
      assert.ok(pose.smile > 0, `${mood} at ${since} s is smiling`);
      for (const blink of [0, 0.5, 1]) {
        assert.strictEqual(blinkWeight(pose, blink), 0, `${mood} at ${since} s, blink ${blink}`);
      }
    }
  }
});

test('an idle pose passes the blinker through', () => {
  const pose = moodPose('idle', 100);
  for (const blink of [0, 0.4, 1]) assert.strictEqual(blinkWeight(pose, blink), blink, `blink ${blink}`);
});

// ---------------------------------------------------------------- the feelings

const near = (actual, expected, within = 1e-9) => Math.abs(actual - expected) <= within;
/** Times from `from` to `to`, both included, `step` apart. */
const times = (from, to, step = 0.01) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => from + i * step);

// The rest pose: every field a pose has. The page reads them all, so every pose has every one.
const REST_POSE = {
  lift: 0, scaleX: 1, scaleY: 1, headTilt: 0, headPitch: 0, headYaw: 0, armL: 0, armR: 0, smile: 0, mouthO: 0,
  eyesClosed: false, eyeL: 0, eyeR: 0, heart: 0, swirl: 0, sad: 0, half: 0, sleep: 0, glow: 1, ears: 1, look: 1,
  float: 1, effect: null, done: false,
};
const NUMBERS = Object.keys(REST_POSE).filter((field) => typeof REST_POSE[field] === 'number');
// The eye shapes. Each reshapes both eyes, as the blink does.
const SHAPES = ['smile', 'heart', 'swirl', 'sad', 'half', 'sleep'];
// How long each timed mood lasts, in seconds. The others last until another mood replaces them.
const LENGTHS = {
  happy: 1.2, wave: 1.8, sad: 2.5, sleepy: 2.5, wake: 1.2, love: 2, dizzy: 2, celebrate: 1.6,
  look: 2, swing: 1.5, hum: 2, hop: 0.8,
};

/** The numeric fields in which two poses differ by more than `within`. */
const differences = (a, b, fields = NUMBERS, within = 1e-9) => fields.filter((field) => !near(a[field], b[field], within));

test('idle is the rest pose, with every field', () => {
  assert.deepStrictEqual(moodPose('idle', 3), REST_POSE);
});

test('every pose has every field of the rest pose, and no other', () => {
  for (const name of MOODS) {
    for (const since of [0, 0.25, 0.7, 1.4, 2.2, 10]) {
      const pose = moodPose(name, since, { level: 0.5 });
      const at = `${name} at ${since} s`;
      assert.deepStrictEqual(Object.keys(pose).sort(), Object.keys(REST_POSE).sort(), at);
      for (const field of NUMBERS) assert.ok(Number.isFinite(pose[field]), `${at}: ${field} is ${pose[field]}`);
      assert.strictEqual(typeof pose.eyesClosed, 'boolean', at);
      assert.strictEqual(typeof pose.done, 'boolean', at);
      assert.ok(pose.effect === null || typeof pose.effect === 'string', `${at}: effect ${pose.effect}`);
    }
  }
});

test('each timed mood is done at its length, and not before', () => {
  for (const [name, length] of Object.entries(LENGTHS)) {
    assert.strictEqual(moodPose(name, 0).done, false, `${name} at 0 s`);
    assert.strictEqual(moodPose(name, length - 0.001).done, false, `${name} just before ${length} s`);
    assert.strictEqual(moodPose(name, length).done, true, `${name} at ${length} s`);
  }
});

test('drowsy, asleep and listening last until another mood replaces them', () => {
  for (const name of ['drowsy', 'asleep', 'listening']) {
    for (const since of [0, 1, 1.6, 2.5, 60, 3600]) assert.strictEqual(moodPose(name, since).done, false, `${name} at ${since} s`);
  }
});

test('an unknown mood is done at once, in the rest pose', () => {
  for (const name of ['confused', '', undefined]) {
    assert.deepStrictEqual(moodPose(name, 0), { ...REST_POSE, done: true }, String(name));
  }
});

test('each feeling shows its eyes and its symbols', () => {
  // mood, a time in its middle, the eye shape it shows in full, the symbols
  const shown = [
    ['sad', 1.2, 'sad', 'drop'], ['sleepy', 1.2, 'sad', 'drop'], ['drowsy', 5, 'half', null], ['asleep', 5, 'sleep', 'z'],
    ['love', 1, 'heart', 'hearts'], ['dizzy', 1, 'swirl', 'stars'], ['celebrate', 0.8, 'smile', 'sparkles'],
    ['hum', 1, 'smile', 'notes'],
  ];
  for (const [name, since, shape, effect] of shown) {
    const pose = moodPose(name, since);
    assert.strictEqual(pose[shape], 1, `${name} shows ${shape}`);
    for (const other of SHAPES.filter((s) => s !== shape)) assert.strictEqual(pose[other], 0, `${name}: no ${other}`);
    assert.strictEqual(pose.eyesClosed, false, `${name}: not shut`);
    assert.strictEqual(pose.effect, effect, `${name}: symbols`);
  }
  for (const [name, since] of [['wake', 0.6], ['listening', 5], ['look', 1], ['swing', 0.7], ['hop', 0.4]]) {
    const pose = moodPose(name, since);
    for (const shape of SHAPES) assert.strictEqual(pose[shape], 0, `${name}: no ${shape}`);
    assert.strictEqual(pose.effect, null, `${name}: no symbols`);
  }
  for (const name of ['idle', 'thinking', 'happy', 'wave', 'wobble']) assert.strictEqual(moodPose(name, 0.5).effect, null, name);
});

test('sad: droopy eyes, the head and arms down, and one sigh', () => {
  const pose = moodPose('sad', 1.5);
  assert.ok(near(pose.headPitch, 0.18), `the head down: ${pose.headPitch}`);
  assert.ok(pose.armL < 0 && pose.armL > -0.2 && near(pose.armR, pose.armL), 'both arms down a little');
  const body = times(0, 2.5).map((t) => ({ t, scaleY: moodPose('sad', t).scaleY }));
  const lowest = body.reduce((a, b) => (b.scaleY < a.scaleY ? b : a));
  assert.ok(near(lowest.scaleY, 0.97, 0.005), `the body sinks to about 97 %: ${lowest.scaleY}`);
  assert.ok(lowest.t > 0.8 && lowest.t < 1.2, `around 1 s: ${lowest.t}`);
  assert.ok(body.filter(({ t }) => t >= 1.6).every(({ scaleY }) => near(scaleY, 1)), 'and comes back: one sigh');
});

test('drowsy: a yawn, then half-shut eyes, the head a little down and a slower float', () => {
  const yawn = times(0, 1.6).map((t) => moodPose('drowsy', t));
  assert.ok(near(Math.max(...yawn.map((p) => p.mouthO)), 1), 'the mouth opens wide');
  for (const t of [0.2, 0.5, 1, 1.39]) assert.strictEqual(moodPose('drowsy', t).eyesClosed, true, `the eyes shut at ${t} s`);
  for (const t of [0, 0.19, 1.4, 1.6, 30]) assert.strictEqual(moodPose('drowsy', t).eyesClosed, false, `not at ${t} s`);
  const arms = Math.max(...yawn.map((p) => p.armL));
  assert.ok(arms > 0.2 && arms < 1, `the arms out a little: ${arms}`);
  for (const t of [1.6, 5, 59]) {
    const pose = moodPose('drowsy', t);
    assert.strictEqual(pose.half, 1, `half-shut eyes at ${t} s`);
    assert.deepStrictEqual(differences(pose, { ...REST_POSE, half: 1, headPitch: 0.08, float: 0.6 }), [], `at ${t} s`);
  }
});

test('asleep: sleeping eyes, the head down, slow breathing, the glow down, the pointer ignored', () => {
  const fading = moodPose('asleep', 0.3).sleep;
  assert.ok(fading > 0 && fading < 1, `the sleeping eyes fade in: ${fading}`);
  assert.strictEqual(moodPose('asleep', 0.6).sleep, 1, 'over 0.6 s');
  for (const t of [3, 10, 61.5, 3600]) {
    const pose = moodPose('asleep', t);
    const at = `at ${t} s`;
    assert.strictEqual(pose.sleep, 1, at);
    assert.ok(near(pose.headPitch, 0.22), `the head down ${at}`);
    assert.ok(near(pose.scaleY, 1 + 0.02 * Math.sin((2 * Math.PI * t) / 4)), `a breath every 4 s, ${at}`);
    assert.ok(near(pose.glow, 0.5), `the eyes' glow at half ${at}`);
    // The rims glow near the top of the tone curve: at half they would look almost as they do awake.
    assert.ok(near(pose.ears, 0.2), `the ear rims' glow well down ${at}`);
    assert.ok(near(pose.look, 0), `the head does not follow the pointer ${at}`);
    assert.ok(near(pose.float, 0.5), `less float ${at}`);
    assert.strictEqual(pose.effect, 'z', at);
  }
});

test('wake: the eyes open after 0.25 s, the arms stretch up, then a little shake of the head', () => {
  for (const t of [0, 0.1, 0.24]) assert.strictEqual(moodPose('wake', t).eyesClosed, true, `shut at ${t} s`);
  for (const t of [0.25, 0.5, 1.1]) assert.strictEqual(moodPose('wake', t).eyesClosed, false, `open at ${t} s`);
  const stretch = times(0.25, 0.85).map((t) => moodPose('wake', t));
  assert.ok(near(Math.max(...stretch.map((p) => p.armL)), 2.4, 0.01), 'the arms up to about 2.4');
  assert.ok(near(Math.max(...stretch.map((p) => p.scaleY)), 1.06, 0.005), 'the body stretches up with them');
  for (const t of [...times(0, 0.25), ...times(0.85, 1.2)]) {
    const { armL, armR } = moodPose('wake', t);
    assert.ok(near(armL, 0) && near(armR, 0), `the arms rest at ${t} s`);
  }
  const shake = times(0, 1.2).map((t) => ({ t, yaw: Math.abs(moodPose('wake', t).headYaw) }));
  assert.ok(shake.filter(({ t }) => t <= 0.85).every(({ yaw }) => near(yaw, 0)), 'no shake before 0.85 s');
  const early = Math.max(...shake.filter(({ t }) => t > 0.85 && t < 1).map(({ yaw }) => yaw));
  const late = Math.max(...shake.filter(({ t }) => t >= 1.1).map(({ yaw }) => yaw));
  assert.ok(early > 0.05, `a shake of the head: ${early}`);
  assert.ok(late < early / 3, `that dies away: ${early} then ${late}`);
});

test('love: heart eyes and a gentle sway of the head', () => {
  for (const t of [0.4, 0.8, 1.2]) {
    const pose = moodPose('love', t);
    assert.strictEqual(pose.heart, 1, `at ${t} s`);
    assert.ok(near(pose.headTilt, 0.1 * Math.sin(4 * t)), `the sway at ${t} s: ${pose.headTilt}`);
  }
});

test('dizzy: swirl eyes, the head circling until 1.6 s, then it shakes it off', () => {
  // The head's tilt and pitch go round together: the angle they make keeps turning the same way.
  const angles = times(0.3, 1.25).map((t) => moodPose('dizzy', t)).map((p) => Math.atan2(p.headPitch, p.headTilt));
  const steps = angles.slice(1).map((angle, i) => Math.atan2(Math.sin(angle - angles[i]), Math.cos(angle - angles[i])));
  assert.ok(steps.every((s) => s < 0) || steps.every((s) => s > 0), 'one way round');
  const turned = Math.abs(steps.reduce((a, b) => a + b, 0));
  assert.ok(turned > 2 * Math.PI, `more than once round: ${turned} radians`);
  for (const t of times(1.6, 2)) {
    const pose = moodPose('dizzy', t);
    assert.ok(near(pose.headTilt, 0) && near(pose.headPitch, 0), `no more circling at ${t} s`);
  }
  for (const t of times(0, 1.6)) assert.ok(near(moodPose('dizzy', t).headYaw, 0), `no shake yet at ${t} s`);
  const yaws = times(1.6, 2).map((t) => moodPose('dizzy', t).headYaw);
  assert.ok(Math.max(...yaws) > 0.05 && Math.min(...yaws) < -0.05, 'a shake of the head, both ways');
  assert.strictEqual(moodPose('dizzy', 1.5).swirl, 1);
  const fading = moodPose('dizzy', 1.85).swirl;
  assert.ok(fading > 0 && fading < 1, `the swirls fade while it shakes: ${fading}`);
});

test('celebrate: a jump with happy eyes and the arms up', () => {
  const highest = Math.max(...times(0, 0.6).map((t) => moodPose('celebrate', t).lift));
  assert.ok(near(highest, 0.15, 0.002), `up about 0.15: ${highest}`);
  for (const t of times(0.6, 1.6)) assert.ok(near(moodPose('celebrate', t).lift, 0), `down by 0.6 s, at ${t} s`);
  const landing = Math.min(...times(0.6, 1).map((t) => moodPose('celebrate', t).scaleY));
  assert.ok(landing < 0.95, `a squash on landing: ${landing}`);
  const top = moodPose('celebrate', 0.4);
  assert.ok(top.armL > 1.8 && near(top.armR, top.armL), 'both arms up');
  const lowering = times(0.7, 1.6).map((t) => moodPose('celebrate', t).armL);
  assert.ok(lowering.every((arm, i) => i === 0 || arm <= lowering[i - 1]), 'then coming down');
  assert.strictEqual(moodPose('celebrate', 0.5).smile, 1, 'happy eyes');
});

test('listening: the head tilted, the eyes a little up, the ear rims dim while it is quiet and bright with the voice', () => {
  const pose = moodPose('listening', 5, { level: 0.4 });
  assert.ok(near(pose.headTilt, 0.14) && near(pose.headPitch, -0.04), 'the head tilted, as if leaning in');
  assert.ok(near(pose.eyeL, 0.15) && near(pose.eyeR, 0.15), 'the eyes a little up');
  assert.ok(near(pose.look, 0.5), 'it follows the pointer only halfway');
  for (const level of [0, 0.25, 0.4, 0.5, 1]) {
    assert.ok(near(moodPose('listening', 5, { level }).ears, 0.3 + 4 * level), `level ${level}`);
  }
  // At rest the rims glow at 1, near the top of the tone curve: 0.5 hardly looks dimmer, and 2 is the least that looks
  // clearly brighter (moods.js, REST).
  assert.ok(moodPose('listening', 5, { level: 0 }).ears < 0.5, 'silence: clearly dimmer than at rest');
  assert.ok(moodPose('listening', 5, { level: 0.5 }).ears > 2, 'a normal voice: clearly brighter than at rest');
  assert.ok(near(moodPose('listening', 5).ears, 0.3), 'no level: silence');
  assert.ok(near(moodPose('listening', 5, {}).ears, 0.3));
  assert.ok(near(moodPose('listening', 5, { level: 3 }).ears, 4.3), 'a level above 1 counts as 1');
  assert.ok(near(moodPose('listening', 5, { level: -1 }).ears, 0.3), 'one below 0, as 0');
  assert.ok(near(moodPose('listening', 5, { level: NaN }).ears, 0.3), 'and one that is not a number, as silence');
  assert.strictEqual(moodPose('happy', 0.5, { level: 1 }).ears, 1, 'only listening shows the voice');
});

test('listening: the ear rims start at rest and dim as it leans in, so going from idle does not jump', () => {
  const ears = times(0, 0.4).map((t) => moodPose('listening', t).ears);
  assert.strictEqual(ears[0], 1, 'at rest when it starts');
  assert.ok(ears.every((value, i) => i === 0 || value <= ears[i - 1]), 'then only going down');
  assert.ok(near(ears.at(-1), 0.3), 'to the quiet glow once it leans in');
});

test('the look fidget glances one way, then the other, and back, not following the pointer meanwhile', () => {
  const yaws = times(0, 2).map((t) => moodPose('look', t).headYaw);
  const one = yaws.findIndex((yaw) => Math.abs(yaw) > 0.2);
  const other = yaws.findIndex((yaw, i) => i > one && Math.abs(yaw) > 0.2 && Math.sign(yaw) !== Math.sign(yaws[one]));
  assert.ok(one >= 0 && other > one, 'one way, then the other');
  assert.ok(near(moodPose('look', 2).headYaw, 0), 'and back');
  for (const t of times(0.3, 1.7)) assert.ok(near(moodPose('look', t).look, 0), `not following the pointer at ${t} s`);
});

test('the swing fidget swings the arms in turn, dying away', () => {
  const apart = times(0, 1.5).map((t) => moodPose('swing', t)).map((p) => p.armL - p.armR);
  let turns = 0;
  let last = 0;
  for (const sign of apart.map(Math.sign).filter((sign) => sign !== 0)) {
    if (last !== 0 && sign !== last) turns += 1;
    last = sign;
  }
  assert.ok(turns >= 3, `the arms take turns: ${turns} times`);
  const early = Math.max(...apart.slice(0, 50).map(Math.abs));
  const late = Math.max(...apart.slice(120).map(Math.abs));
  assert.ok(late < early / 3, `dying away: ${early} then ${late}`);
  for (const t of times(0, 1.5)) {
    const { armL, armR } = moodPose('swing', t);
    assert.ok(armL > -0.15 && armR > -0.15, `the arms stay clear of the body at ${t} s`);
  }
});

test('the hum fidget: happy eyes and a gentle sway, while notes rise', () => {
  assert.strictEqual(moodPose('hum', 1).smile, 1);
  assert.strictEqual(moodPose('hum', 1).effect, 'notes');
  const sway = times(0, 2).map((t) => moodPose('hum', t).headTilt);
  assert.ok(Math.max(...sway) > 0.04 && Math.min(...sway) < -0.04, 'the head sways both ways');
  assert.ok(Math.max(...sway.map(Math.abs)) < 0.15, 'gently');
});

test('the hop fidget: one small hop, with a squash', () => {
  const lifts = times(0, 0.8).map((t) => moodPose('hop', t).lift);
  assert.ok(near(Math.max(...lifts), 0.06, 0.002), `about 0.06 up: ${Math.max(...lifts)}`);
  assert.strictEqual(lifts.filter((lift, i) => lift > 0 && !(lifts[i - 1] > 0)).length, 1, 'one hop');
  assert.ok(Math.min(...times(0, 0.8).map((t) => moodPose('hop', t).scaleY)) < 0.96, 'with a squash');
});

// The only snaps that are meant. Shut eyes are all or nothing (eyesClosed is a boolean), so the eyes cannot fade into
// them: where drowsy shuts its eyes (0.2 s) and where it opens them again (1.4 s), and where wake opens its eyes
// (0.25 s), the half-shut eyes (`half`) are swapped for them, or back, in one step. Nothing else may snap.
const EYE_SWITCHES = [
  { mood: 'drowsy', field: 'half', at: 0.2 },
  { mood: 'drowsy', field: 'half', at: 1.4 },
  { mood: 'wake', field: 'half', at: 0.25 },
];

/**
 * For each numeric field of a mood, the biggest change between two samples `gap` seconds apart, from 0 to `end`, and
 * the time it ends at. The step over a meant snap (EYE_SWITCHES) is left out.
 */
function biggestSteps(name, end, gap) {
  const meant = EYE_SWITCHES.filter((s) => s.mood === name);
  const biggest = Object.fromEntries(NUMBERS.map((field) => [field, { step: 0, at: 0 }]));
  const count = Math.round(end / gap);
  let before = moodPose(name, 0, { level: 0.5 });
  for (let i = 1; i <= count; i += 1) {
    const at = i * gap;
    const pose = moodPose(name, at, { level: 0.5 });
    for (const field of NUMBERS) {
      if (meant.some((s) => s.field === field && (i - 1) * gap < s.at && s.at <= at)) continue;
      const step = Math.abs(pose[field] - before[field]);
      if (step > biggest[field].step) biggest[field] = { step, at };
    }
    before = pose;
  }
  return biggest;
}

test('no mood snaps: in every field, the step between two samples shrinks with the time between them', () => {
  // A smooth curve moves in proportion to the time between two samples: samples 100 times closer move 100 times less.
  // A snap does not shrink: the two samples around it still see all of it, however close they are. So a hundred times
  // the biggest step at 1/24000 s may not be more than about twice the biggest step at 1/240 s. That catches a snap in
  // any field, however little the field moves: a limit on the step cannot (scaleX, scaleY, lift and headPitch never
  // move by 0.1 in one step).
  const SHRINK = 100; // how many times closer together the fine samples are than the coarse ones
  for (const { mood, at } of EYE_SWITCHES) {
    assert.notStrictEqual(moodPose(mood, at - 0.001).eyesClosed, moodPose(mood, at).eyesClosed, `${mood}: no switch of the eyes at ${at} s`);
  }
  for (const name of MOODS) {
    const end = LENGTHS[name] ?? 5; // the others last until another mood replaces them
    const coarse = biggestSteps(name, end, 1 / 240);
    const fine = biggestSteps(name, end, 1 / (240 * SHRINK));
    for (const field of NUMBERS) {
      // The 1e-9 is for rounding, where a field hardly moves at all.
      assert.ok(
        fine[field].step * SHRINK <= 2 * coarse[field].step + 1e-9,
        `${name}: ${field} snaps at about ${fine[field].at.toFixed(3)} s: it moves by ${fine[field].step} in 1/24000 s and ${coarse[field].step} in 1/240 s, not ${SHRINK} times less`,
      );
    }
  }
});

test('a timed feeling ends in the rest pose, so going back to idle does not jump', () => {
  // thinking, happy, wave and wobble are as they were; these are the new ones.
  for (const name of ['sad', 'sleepy', 'wake', 'love', 'dizzy', 'celebrate', 'look', 'swing', 'hum', 'hop']) {
    const length = LENGTHS[name];
    assert.deepStrictEqual(differences(moodPose(name, length), REST_POSE), [], `${name} at ${length} s`);
    assert.deepStrictEqual(differences(moodPose(name, length - 0.001), REST_POSE, NUMBERS, 1e-3), [], `${name} just before`);
    assert.strictEqual(moodPose(name, length - 0.001).eyesClosed, false, name);
  }
});

test('a feeling that comes from idle starts in the rest pose', () => {
  for (const name of ['sad', 'sleepy', 'drowsy', 'love', 'celebrate', 'listening', 'look', 'swing', 'hum', 'hop']) {
    const pose = moodPose(name, 0);
    assert.deepStrictEqual(differences(pose, REST_POSE), [], name);
    assert.strictEqual(pose.eyesClosed, false, name);
  }
});

test('asleep, wake and dizzy pick up where the mood before them leaves off', () => {
  // asleep comes after drowsy: the half-shut eyes, the head and the float carry on.
  assert.deepStrictEqual(differences(moodPose('asleep', 0), moodPose('drowsy', 30)), [], 'asleep after drowsy');
  // wake comes after asleep: the head, the glow and the float carry on, and the eyes are still shut.
  const asleep = moodPose('asleep', 60);
  const wake = moodPose('wake', 0);
  assert.deepStrictEqual(differences(wake, asleep, ['headPitch', 'glow', 'ears', 'look', 'float']), [], 'wake after asleep');
  assert.ok(wake.eyesClosed && asleep.sleep === 1, 'shut eyes in both');
  // dizzy comes after a shaken drag: wobble's open mouth carries on.
  assert.strictEqual(moodPose('dizzy', 0).mouthO, moodPose('wobble', 1).mouthO);
});

test('no pose shows more than one eye: shut eyes and the eye shapes add up to at most 1', () => {
  // Shapes on top of each other tear the eye, as the blink and the smile do; fading one into another is fine.
  for (const name of MOODS) {
    for (const t of times(0, 10)) {
      const pose = moodPose(name, t);
      const total = (pose.eyesClosed ? 1 : 0) + SHAPES.reduce((sum, shape) => sum + pose[shape], 0);
      assert.ok(total <= 1 + 1e-9, `${name} at ${t.toFixed(2)} s: ${total}`);
    }
  }
});

test('the eyes blink only when they are the plain open ones', () => {
  const rest = moodPose('idle', 0);
  for (const shape of SHAPES) {
    for (const weight of [0.01, 0.5, 1]) {
      assert.strictEqual(blinkWeight({ ...rest, [shape]: weight }, 0.7), 0, `${shape} at ${weight}`);
    }
  }
  assert.strictEqual(blinkWeight({ ...rest, eyesClosed: true }, 0.3), 1, 'shut eyes are shut');
  const shaped = [
    ['sad', 1], ['sleepy', 1], ['drowsy', 0.1], ['drowsy', 5], ['asleep', 0], ['asleep', 5], ['wake', 0.3], ['love', 1],
    ['dizzy', 1], ['celebrate', 0.5], ['hum', 1],
  ];
  for (const [mood, since] of shaped) {
    for (const blink of [0.5, 1]) {
      assert.strictEqual(blinkWeight(moodPose(mood, since), blink), 0, `${mood} at ${since} s, blink ${blink}`);
    }
  }
  for (const [mood, since] of [['listening', 5], ['look', 1], ['swing', 0.7], ['hop', 0.4], ['wake', 0.6]]) {
    assert.strictEqual(blinkWeight(moodPose(mood, since), 0.6), 0.6, `${mood} at ${since} s blinks`);
  }
});

// ---------------------------------------------------------------- fidgets

test('four fidgets, each a mood that ends by itself within 2 s', () => {
  assert.deepStrictEqual(FIDGETS, ['look', 'swing', 'hum', 'hop']);
  for (const name of FIDGETS) {
    assert.strictEqual(moodPose(name, 0).done, false, name);
    assert.strictEqual(moodPose(name, 2).done, true, name);
  }
});

test('a fidget is due 15 to 25 s after reset(); take() returns null until then', () => {
  const soonest = createFidgeter(() => 0);
  soonest.reset(100);
  assert.strictEqual(soonest.take(114.99), null);
  assert.strictEqual(soonest.take(115), 'look', '15 s, and the first fidget');
  const latest = createFidgeter(() => 0.999);
  latest.reset(100);
  assert.strictEqual(latest.take(124.9), null);
  assert.strictEqual(latest.take(125), 'hop', 'almost 25 s, and the last fidget');
});

test('take() hands out one fidget, and the next wait starts from then', () => {
  const fidgeter = createFidgeter(() => 0.5); // a 20 s wait, and the third fidget
  fidgeter.reset(10); // due at 30 s
  assert.strictEqual(fidgeter.take(33), 'hum', 'asked a little late');
  assert.strictEqual(fidgeter.take(33.1), null, 'one at a time');
  assert.strictEqual(fidgeter.take(52.9), null, 'the next wait runs from the take, not from when it was due');
  assert.strictEqual(fidgeter.take(53), 'hum', '20 s after the last one');
});

test('reset() pushes the next fidget back, so a buddy in use does not fidget', () => {
  const fidgeter = createFidgeter(() => 0.5);
  fidgeter.reset(10); // due at 30 s
  fidgeter.reset(25); // used again: now due at 45 s
  assert.strictEqual(fidgeter.take(30), null);
  assert.strictEqual(fidgeter.take(44.9), null);
  assert.strictEqual(fidgeter.take(45), 'hum');
});

test('before the first reset() the wait runs from time 0; take() draws the fidget, then the next wait', () => {
  const draws = [0.25, 0.25, 0.75, 0.5, 0]; // the first wait; a fidget and a wait; a fidget and a wait
  const fidgeter = createFidgeter(() => draws.shift());
  assert.strictEqual(fidgeter.take(17.4), null, 'the first is due at 15 + 0.25 * 10 = 17.5 s');
  assert.strictEqual(draws.length, 4, 'asking early draws nothing');
  assert.strictEqual(fidgeter.take(17.5), 'swing', 'FIDGETS[floor(0.25 * 4)]');
  assert.strictEqual(fidgeter.take(39.9), null, 'the next is due 15 + 0.75 * 10 = 22.5 s later, at 40 s');
  assert.strictEqual(fidgeter.take(40), 'hum', 'FIDGETS[floor(0.5 * 4)]');
  assert.strictEqual(draws.length, 0);
});
