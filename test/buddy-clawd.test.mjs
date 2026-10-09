import test from 'node:test';
import assert from 'node:assert';
import { FRAMES, COLUMNS, ROWS, EYES, STEP, WAVE, MOMENT, clawdPose, clawdMoving } from '../src/renderer/buddy/clawd.js';

test('every frame of Clawd is a 12 × 8 grid, with its four legs', () => {
  for (const [name, rows] of Object.entries(FRAMES)) {
    assert.strictEqual(rows.length, ROWS, name);
    for (const row of rows) assert.strictEqual(row.length, COLUMNS, `${name}: ${row}`);
  }
  assert.strictEqual(FRAMES.stand.slice(-2).join('').split('X').length - 1, 8, 'standing: four legs, two cells each');
});

test('working: Clawd walks, a step every quarter second, bobbing', () => {
  const a = clawdPose('working', 0);
  const b = clawdPose('working', STEP);
  assert.deepStrictEqual([a.visible, a.frame, a.eyes], [true, 'walkA', EYES.open]);
  assert.deepStrictEqual([b.frame, b.lift], ['walkB', 0.5]);
  assert.strictEqual(clawdPose('working', 2 * STEP).frame, 'walkA');
  assert.strictEqual(clawdPose('working', 3600).visible, true, 'for as long as the session works');
});

test('needs you: Clawd waves; done: happy and a hop, then the eye is back; failed: sad, then back', () => {
  assert.strictEqual(clawdPose('needsYou', 0).frame, 'stand');
  assert.strictEqual(clawdPose('needsYou', WAVE).frame, 'wave');
  const done = clawdPose('done', 0.2);
  assert.deepStrictEqual([done.visible, done.eyes], [true, EYES.happy]);
  assert.ok(done.lift > 0, 'hopping');
  assert.strictEqual(clawdPose('done', MOMENT).visible, false);
  assert.deepStrictEqual([clawdPose('failed', 1).eyes, clawdPose('failed', 1).lift], [EYES.sad, -0.5]);
  assert.strictEqual(clawdPose('failed', MOMENT + 1).visible, false);
});

test('no status, or one it does not know: the buddy\'s own eye', () => {
  for (const kind of [null, undefined, 'idle', 'nonsense']) assert.strictEqual(clawdPose(kind, 0).visible, false, String(kind));
  assert.strictEqual(clawdMoving('working', 5), true);
  assert.strictEqual(clawdMoving(null, 5), false);
  assert.strictEqual(clawdPose('working', -3).frame, 'walkA', 'a clock that went back is the start');
});

test('working: Clawd walks back and forth and faces the way it goes; otherwise it stands in the middle', async () => {
  const { PACE } = await import('../src/renderer/buddy/clawd.js');
  const quarter = Math.PI / 2 / PACE; // a quarter of the way round: at the right end
  const right = clawdPose('working', quarter, quarter);
  assert.ok(Math.abs(right.x - 1) < 1e-9);
  assert.strictEqual(clawdPose('working', 0.1, 0.1).facing, 1, 'going right');
  assert.strictEqual(clawdPose('working', 0.1, quarter + 0.1).facing, -1, 'coming back');
  for (const kind of ['needsYou', 'done', 'failed']) assert.deepStrictEqual([clawdPose(kind, 0.1).x, clawdPose(kind, 0.1).facing], [0, 1], kind);
});

test("the two looks: on the head the buddy looks up at Clawd, on the face down; it follows Clawd, not the pointer", async () => {
  const { LOOKS, DEFAULT_LOOK, lookOf, watching } = await import('../src/renderer/buddy/clawd.js');
  assert.strictEqual(DEFAULT_LOOK, 'head');
  assert.strictEqual(lookOf('face'), LOOKS.face);
  for (const name of ['head', null, 'eyes', 'toString']) assert.strictEqual(lookOf(name), LOOKS.head, String(name));
  const pose = { visible: true, x: 0.5 };
  const up = watching(pose, LOOKS.head);
  const down = watching(pose, LOOKS.face);
  assert.ok(up.look > 0 && up.pitch < 0, 'up at the head');
  assert.ok(down.look < 0, 'down at the face');
  assert.strictEqual(up.yaw, LOOKS.head.turn * 0.5);
  assert.strictEqual(up.follow, 0);
  assert.deepStrictEqual(watching({ visible: false, x: 0 }, LOOKS.face), { yaw: 0, pitch: 0, look: 0, follow: 1 });
  // Both stay inside the head's own frame: on the head, Clawd's top is below the sprout's (2.0 - 0.74 = 1.26).
  assert.ok(LOOKS.head.y + (LOOKS.head.width * ROWS) / COLUMNS / 2 < 1.26);
});
