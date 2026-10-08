'use strict';

const test = require('node:test');
const assert = require('node:assert');
const g = require('../src/main/notch-geometry');
const { PANEL } = require('../src/main/geometry');

// A 14" MacBook Pro: the notch in the middle of the top of its screen, the work area below the menu bar.
const SCREEN = { x: 0, y: 0, width: 1512, height: 982 };
const NOTCH = { x: 666, y: 0, width: 180, height: 37 };
const AREA = { x: 0, y: 37, width: 1512, height: 945 };

test('the reach past the notch is the hovered wing plus the longest say text, and the rest are as the design says', () => {
  assert.strictEqual(g.REACH, 316);
  assert.strictEqual(g.REACH, g.WING_HOVER + g.SAY_MAX);
  assert.strictEqual(g.DROP, 8);
  assert.deepStrictEqual([g.WING, g.WING_HOVER, g.SAY_MAX, g.CORNER], [44, 56, 260, 12]);
});

test('the notch window is centred on the notch, flush with the top, reaching past it on both sides, with room under it', () => {
  assert.deepStrictEqual(g.notchWindowBounds(NOTCH), { x: 666 - 316, y: 0, width: 180 + 2 * 316, height: 37 + 8 });
  // On a screen that is not the primary one, the notch's own place is kept.
  assert.deepStrictEqual(g.notchWindowBounds({ x: 2000, y: -200, width: 160, height: 32 }), { x: 2000 - 316, y: -200, width: 160 + 632, height: 40 });
});

test('the panel under the notch is centred on it, its top at the top of the work area, the same size as beside the buddy', () => {
  assert.deepStrictEqual(g.panelUnderNotch(NOTCH, AREA), { x: 666 + 90 - 180, y: 37, width: 360, height: 480 });
  assert.deepStrictEqual(g.panelUnderNotch(NOTCH, AREA, { width: 200, height: 100 }), { x: 666 + 90 - 100, y: 37, width: 200, height: 100 });
  assert.deepStrictEqual(PANEL, { width: 360, height: 480 });
});

test('the panel under the notch stays inside the work area', () => {
  const narrow = { x: 0, y: 37, width: 500, height: 300 };
  const p = g.panelUnderNotch({ x: 400, y: 0, width: 100, height: 37 }, narrow);
  assert.strictEqual(p.x + p.width, 500, 'not past the right edge');
  assert.strictEqual(p.y, 37, 'still at the top');
  const left = g.panelUnderNotch({ x: -50, y: 0, width: 100, height: 37 }, { x: 0, y: 37, width: 1512, height: 945 });
  assert.strictEqual(left.x, 0, 'not past the left edge');
});

test('findDisplay matches the helper\'s screen to the Electron display with the same bounds, a point either way', () => {
  const primary = { id: 1, bounds: SCREEN };
  const external = { id: 2, bounds: { x: 1512, y: -100, width: 2560, height: 1440 } };
  const entry = { screen: SCREEN, notch: NOTCH };
  assert.strictEqual(g.findDisplay(entry, [external, primary]), primary);
  assert.strictEqual(g.findDisplay({ screen: { x: 0.6, y: -0.4, width: 1512.5, height: 981.5 }, notch: NOTCH }, [primary]), primary);
  assert.strictEqual(g.findDisplay({ screen: { ...SCREEN, width: 1514 }, notch: NOTCH }, [primary, external]), null);
  assert.strictEqual(g.findDisplay(entry, []), null);
  assert.strictEqual(g.findDisplay({}, [primary]), null);
  assert.strictEqual(g.findDisplay(null, [primary]), null);
});

test('chooseHome: the notch on a Mac that has one and wants it; floating otherwise', () => {
  const notches = [{ screen: SCREEN, notch: NOTCH }];
  assert.strictEqual(g.chooseHome({ platform: 'darwin', home: 'notch', notches }), 'notch');
  assert.strictEqual(g.chooseHome({ platform: 'darwin', home: 'floating', notches }), 'floating');
  assert.strictEqual(g.chooseHome({ platform: 'darwin', home: 'notch', notches: [] }), 'floating');
  assert.strictEqual(g.chooseHome({ platform: 'win32', home: 'notch', notches }), 'floating');
  assert.strictEqual(g.chooseHome({ platform: 'darwin', home: undefined, notches }), 'floating');
  assert.strictEqual(g.chooseHome({ platform: 'darwin', home: 'notch', notches: undefined }), 'floating');
});
