// Buddy on iPhone: a shake of the phone (web/public/app/motion.js).

import test from 'node:test';
import assert from 'node:assert';
import { createMotionShake, motionNeedsAsking, askForMotion, JOLT } from '../web/public/app/motion.js';

test('four jolts within 1.2 s are a shake, once; then it counts afresh', () => {
  const shake = createMotionShake();
  assert.deepStrictEqual([0, 200, 400].map((t) => shake.feed(JOLT + 5, 0, 0, t)), [false, false, false]);
  assert.strictEqual(shake.feed(0, -(JOLT + 5), 0, 600), true);
  assert.strictEqual(shake.feed(JOLT + 5, 0, 0, 800), false, 'a new count');
});

test('small moves, jolts too far apart, and readings of the same jolt are not a shake', () => {
  const shake = createMotionShake();
  for (let t = 0; t < 2000; t += 16) assert.strictEqual(shake.feed(3, 4, 2, t), false, 'walking');
  const slow = createMotionShake();
  assert.ok([0, 500, 1000, 1500, 2000].every((t) => !slow.feed(JOLT + 1, 0, 0, t)), 'one jolt every half second');
  const same = createMotionShake();
  assert.ok([0, 16, 32, 48, 64].every((t) => !same.feed(JOLT + 1, 0, 0, t)), 'one jolt read five times');
  assert.strictEqual(createMotionShake().feed(null, 1, 1, 0), false, 'no reading');
});

test('reset forgets the jolts so far', () => {
  const shake = createMotionShake();
  [0, 200, 400].forEach((t) => shake.feed(JOLT + 1, 0, 0, t));
  shake.reset();
  assert.strictEqual(shake.feed(JOLT + 1, 0, 0, 600), false);
});

test('iOS asks before it tells the motion; other browsers do not', () => {
  assert.strictEqual(motionNeedsAsking({ requestPermission: async () => 'granted' }), true);
  assert.strictEqual(motionNeedsAsking(function DeviceMotionEvent() {}), false);
  assert.strictEqual(motionNeedsAsking(undefined), false);
});

test('askForMotion: nothing to ask is granted; the answer is passed on; a refused ask is "later"', async () => {
  assert.strictEqual(await askForMotion({}), 'granted', 'no requestPermission');
  assert.strictEqual(await askForMotion(undefined), 'granted', 'no DeviceMotionEvent');
  assert.strictEqual(await askForMotion({ requestPermission: async () => 'granted' }), 'granted');
  assert.strictEqual(await askForMotion({ requestPermission: async () => 'denied' }), 'denied');
  const warn = console.warn;
  console.warn = () => {};
  try {
    const refused = Promise.reject(Object.assign(new Error('no tap'), { name: 'NotAllowedError' }));
    assert.strictEqual(await askForMotion({ requestPermission: () => refused }), 'later', 'not from a tap iOS accepts');
  } finally {
    console.warn = warn;
  }
});
