import test from 'node:test';
import assert from 'node:assert';
import { createRequire } from 'node:module';
import { Box3, PerspectiveCamera, Raycaster, Vector3 } from 'three';
import { boxHeight, fitCamera, toWindow, fromWindow, headMark } from '../src/renderer/buddy/layout.js';

const geometry = createRequire(import.meta.url)('../src/main/geometry.js');

const WINDOWS = Object.keys(geometry.SIZES).map((size) => ({ size, ...geometry.buddyWindowSize(size) }));

/** A camera where buddy.js puts it for a model 2.1 tall: straight at its middle, from far enough to fit it 1.3 times. */
function camera() {
  const c = new PerspectiveCamera(28, 1, 0.1, 100);
  c.position.set(0, 1.05, 5.5);
  c.lookAt(0, 1.05, 0);
  return c;
}

// Points around a buddy about 2.1 tall standing on y = 0, and above it (an arm up, the top of a jump).
const POINTS = [];
for (const x of [-1, -0.4, 0, 0.7, 1.1]) for (const y of [-0.1, 0.5, 1.2, 2.1, 2.6]) for (const z of [-0.6, 0, 0.5]) POINTS.push(new Vector3(x, y, z));

test('the buddy page finds the same box in its window as geometry.js makes it, for every size', () => {
  for (const win of WINDOWS) {
    const box = geometry.buddyBox({ x: 0, y: 0, width: win.width, height: win.height });
    assert.strictEqual(boxHeight(win.width, win.height), box.height, win.size);
  }
  assert.strictEqual(boxHeight(96, 112), 112, 'a window that is only the box (from before) is all box');
});

test('the camera draws the buddy at the same size and place as in a window that is only its box', () => {
  for (const { size, width, height } of WINDOWS) {
    const box = boxHeight(width, height);
    const before = camera(); // as it was: the window was the box
    before.aspect = width / box;
    before.updateProjectionMatrix();
    before.updateMatrixWorld();
    const now = camera();
    fitCamera(now, width, height);
    now.updateMatrixWorld();
    for (const point of POINTS) {
      const was = toWindow(point, before, width, box);
      const is = toWindow(point, now, width, height);
      assert.ok(Math.abs(is.x - was.x) < 1e-9, `${size}: x of ${point.toArray()}`);
      assert.ok(Math.abs(is.y - (was.y + height - box)) < 1e-9, `${size}: y of ${point.toArray()}, the room above it added`);
    }
  }
});

test('above the box the view carries on, so a raised arm or a jump is drawn there, not cut off', () => {
  const { width, height } = geometry.buddyWindowSize('medium');
  const c = camera();
  fitCamera(c, width, height);
  c.updateMatrixWorld();
  const box = boxHeight(width, height);
  const top = new Vector3(0, 2.5, 0); // above the top of the box's view
  const before = camera();
  before.aspect = width / box;
  before.updateProjectionMatrix();
  before.updateMatrixWorld();
  assert.ok(toWindow(top, before, width, box).y < 0, 'it used to be above the window');
  const y = toWindow(top, c, width, height).y;
  assert.ok(y > 0 && y < height - box, `it is in the room above now (${y})`);
});

test('the pointer finds what is drawn under it, in the room above too', () => {
  const { width, height } = geometry.buddyWindowSize('large');
  const c = camera();
  fitCamera(c, width, height);
  c.updateMatrixWorld();
  const raycaster = new Raycaster();
  for (const point of POINTS) {
    const { x, y } = toWindow(point, c, width, height);
    raycaster.setFromCamera(fromWindow(x, y, width, height), c);
    assert.ok(raycaster.ray.distanceToPoint(point) < 1e-9, `the ray under ${point.toArray()} passes through it`);
  }
});

test("headMark gives the head's top centre and its width, in the window's pixels", () => {
  const { width, height } = geometry.buddyWindowSize('medium');
  const c = camera();
  fitCamera(c, width, height);
  c.updateMatrixWorld();
  const head = new Box3(new Vector3(-0.75, 1.0, -0.5), new Vector3(0.75, 2.1, 0.5));
  const mark = headMark(head, c, width, height);
  const top = toWindow(new Vector3(0, 2.1, 0), c, width, height);
  const left = toWindow(new Vector3(-0.75, 1.55, 0), c, width, height);
  const right = toWindow(new Vector3(0.75, 1.55, 0), c, width, height);
  assert.deepStrictEqual(mark, { x: top.x, y: top.y, size: right.x - left.x });
  assert.ok(Math.abs(mark.x - width / 2) < 1e-9, 'a head straight ahead is in the middle');
  assert.ok(mark.y > 0 && mark.y < height && mark.size > 0);
});
