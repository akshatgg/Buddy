'use strict';

const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/main/geometry');

const AREA = { x: 0, y: 25, width: 1440, height: 875 }; // a laptop screen below the menu bar

test('window size follows the buddy size, medium for unknown sizes', () => {
  assert.deepStrictEqual(g.buddyWindowSize('small'), { width: 72, height: 113 });
  assert.deepStrictEqual(g.buddyWindowSize('medium'), { width: 96, height: 150 });
  assert.deepStrictEqual(g.buddyWindowSize('large'), { width: 132, height: 207 });
  assert.deepStrictEqual(g.buddyWindowSize('huge'), { width: 96, height: 150 });
});

// The buddy's own box (1.5 × its size wide, 1.75 × tall) is what the window used to be; the window now has room above
// it for the symbols, 0.6 × the buddy's size.
const BOXES = { small: { width: 72, height: 84 }, medium: { width: 96, height: 112 }, large: { width: 132, height: 154 } };

test("the window is the buddy's own box with 0.6 × its size of room on top", () => {
  for (const [size, s] of Object.entries(g.SIZES)) {
    const win = g.buddyWindowSize(size);
    assert.strictEqual(win.width, BOXES[size].width, size);
    assert.strictEqual(win.height, BOXES[size].height + Math.round(0.6 * s), size);
  }
});

test('buddyBox is the bottom of the window, as big as the window was before it grew', () => {
  for (const size of Object.keys(g.SIZES)) {
    const win = { x: 300, y: 200, ...g.buddyWindowSize(size) };
    const box = g.buddyBox(win);
    assert.deepStrictEqual(box, { x: 300, y: 200 + win.height - BOXES[size].height, ...BOXES[size] }, size);
    assert.strictEqual(box.y + box.height, win.y + win.height, `${size}: the same bottom edge`);
  }
});

test('a window that is only the box (one from before) is its own box', () => {
  assert.deepStrictEqual(g.buddyBox({ x: 8, y: 400, width: 96, height: 112 }), { x: 8, y: 400, width: 96, height: 112 });
});

test('windowAtBox puts the window over a box corner, so a position saved before keeps its bottom centre', () => {
  // A position saved before the window grew is the old window's top-left corner, which was the box's.
  const before = { x: 1000, y: 400, width: 96, height: 112 };
  const after = g.windowAtBox({ x: before.x, y: before.y }, g.buddyWindowSize('medium'));
  assert.deepStrictEqual(after, { x: 1000, y: 362, width: 96, height: 150 });
  assert.strictEqual(after.x + after.width / 2, before.x + before.width / 2, 'the same middle');
  assert.strictEqual(after.y + after.height, before.y + before.height, 'the same bottom');
  assert.deepStrictEqual(g.buddyBox(after), before, 'the buddy is where it was');
  for (const size of Object.keys(g.SIZES)) {
    const corner = { x: 40, y: 500 };
    const box = g.buddyBox(g.windowAtBox(corner, g.buddyWindowSize(size)));
    assert.deepStrictEqual({ x: box.x, y: box.y }, corner, `${size}: the box corner reads back`);
  }
});

test('a new buddy still starts in the bottom-right corner, its box where it always was', () => {
  const win = g.defaultBounds(AREA, g.buddyWindowSize('medium'));
  assert.deepStrictEqual(win, { x: 1336, y: 742, width: 96, height: 150 });
  assert.deepStrictEqual(g.buddyBox(win), g.defaultBounds(AREA, BOXES.medium));
});

test("resizing the grown window keeps the box's bottom centre, and the box is the new size's", () => {
  const win = { x: 1000, y: 362, ...g.buddyWindowSize('medium') };
  const next = g.resizeAround(win, g.buddyWindowSize('large'), AREA);
  const [a, b] = [g.buddyBox(win), g.buddyBox(next)];
  assert.strictEqual(b.x + b.width / 2, a.x + a.width / 2);
  assert.strictEqual(b.y + b.height, a.y + a.height);
  assert.deepStrictEqual({ width: b.width, height: b.height }, BOXES.large);
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

test('clampBuddy keeps the buddy on the screen, not its room above: that may go under the menu bar', () => {
  const win = { x: 600, y: -500, ...g.buddyWindowSize('medium') }; // 96 × 150: the box 112, the room 38
  const top = g.clampBuddy(win, AREA);
  const box = g.buddyBox(top);
  assert.strictEqual(box.y, AREA.y - Math.round(112 * g.TOP_TUCK), 'the box a little past the top, where its head has room');
  assert.strictEqual(top.y, box.y - 38);
  assert.deepStrictEqual(g.clampBuddy({ x: -50, y: 2000, width: 96, height: 150 }, AREA), { x: 8, y: AREA.y + AREA.height - 150 - 8, width: 96, height: 150 }, 'the other edges as before');
  const old = g.clampBuddy({ x: 600, y: -500, width: 96, height: 112 }, AREA); // a window with no room above
  assert.strictEqual(old.y, AREA.y - Math.round(112 * g.TOP_TUCK));
  assert.strictEqual(g.snapToEdge(win, AREA).y, top.y, 'snapping keeps it at the top');
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

test("the panel's size: the person's, within PANEL_MIN and the work area; PANEL when there is none", () => {
  assert.deepStrictEqual(g.panelSize(null, AREA), g.PANEL);
  assert.deepStrictEqual(g.panelSize({ width: 500.4, height: 600.6 }, AREA), { width: 500, height: 601 });
  assert.deepStrictEqual(g.panelSize({ width: 10, height: 10 }, AREA), g.PANEL_MIN);
  assert.deepStrictEqual(g.panelSize({ width: 9999, height: 9999 }, AREA), { width: AREA.width - 16, height: AREA.height - 16 });
  assert.deepStrictEqual(g.panelSize({ width: 'big', height: NaN }, AREA), g.PANEL);
});

test('the grip goes on the side away from the buddy, and a drag grows the panel the right way', () => {
  const right = { kind: 'beside', buddy: { x: 1336, y: 400, width: 96, height: 112 }, area: AREA };
  const left = { kind: 'beside', buddy: { x: 8, y: 400, width: 96, height: 112 }, area: AREA };
  assert.strictEqual(g.panelGrip(right), 'left');
  assert.strictEqual(g.panelGrip(left), 'right');
  assert.strictEqual(g.panelGrip({ kind: 'below' }), 'both');
  const start = { width: 400, height: 500 };
  assert.deepStrictEqual(g.resizedPanel(start, -50, 20, 'left', AREA), { width: 450, height: 540 });
  assert.deepStrictEqual(g.resizedPanel(start, 50, 20, 'right', AREA), { width: 450, height: 540 });
  assert.deepStrictEqual(g.resizedPanel(start, 50, 20, 'both', AREA), { width: 500, height: 520 });
});
