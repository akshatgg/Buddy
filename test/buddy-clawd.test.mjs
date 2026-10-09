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
