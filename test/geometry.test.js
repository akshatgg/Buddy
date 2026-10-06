'use strict';

const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/main/geometry');

const AREA = { x: 0, y: 25, width: 1440, height: 875 }; // a laptop screen below the menu bar

test('window size follows the buddy size, medium for unknown sizes', () => {
  assert.deepStrictEqual(g.buddyWindowSize('small'), { width: 72, height: 84 });
  assert.deepStrictEqual(g.buddyWindowSize('medium'), { width: 96, height: 112 });
  assert.deepStrictEqual(g.buddyWindowSize('large'), { width: 132, height: 154 });
  assert.deepStrictEqual(g.buddyWindowSize('huge'), { width: 96, height: 112 });
});

test('a new buddy starts in the bottom-right corner', () => {
  assert.deepStrictEqual(g.defaultBounds(AREA, { width: 96, height: 112 }), { x: 1336, y: 780, width: 96, height: 112 });
});

test('clampToArea keeps the window inside the work area', () => {
  assert.deepStrictEqual(
    g.clampToArea({ x: -50, y: 2000, width: 96, height: 112 }, AREA),
    { x: 8, y: 780, width: 96, height: 112 },
  );
});

test('snapToEdge goes to the nearer side', () => {
  assert.strictEqual(g.snapToEdge({ x: 300, y: 400, width: 96, height: 112 }, AREA).x, 8);
  assert.strictEqual(g.snapToEdge({ x: 1000, y: 400, width: 96, height: 112 }, AREA).x, 1336);
  assert.strictEqual(g.snapToEdge({ x: 1000, y: 400, width: 96, height: 112 }, AREA).y, 400);
});

test('the panel opens on the side away from the edge, centred on the buddy', () => {
  const right = g.panelBounds({ x: 1336, y: 400, width: 96, height: 112 }, AREA);
  assert.deepStrictEqual(right, { x: 1336 - 360 - 8, y: 400 + 56 - 240, width: 360, height: 480 });
  const left = g.panelBounds({ x: 8, y: 400, width: 96, height: 112 }, AREA);
  assert.strictEqual(left.x, 8 + 96 + 8);
});

test('the panel never leaves the screen', () => {
  const p = g.panelBounds({ x: 1336, y: 780, width: 96, height: 112 }, AREA);
  assert.strictEqual(p.y + p.height, AREA.y + AREA.height - 8);
});

test('the bubble sits beside the buddy, level with its top', () => {
  const b = g.bubbleBounds({ x: 1336, y: 400, width: 96, height: 112 }, AREA);
  assert.deepStrictEqual(b, { x: 1336 - 230 - 8, y: 400, width: 230, height: 54 });
});

test('resizing keeps the bottom-centre point', () => {
  const b = g.resizeAround({ x: 1000, y: 400, width: 96, height: 112 }, { width: 132, height: 154 }, AREA);
  assert.deepStrictEqual(b, { x: 982, y: 358, width: 132, height: 154 });
});
