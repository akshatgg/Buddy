'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTapDetector, TAP_MS } = require('../src/main/modifier-tap');

// The Mac's flags: one bit for each kind of modifier, and one for each side of it.
const CMD = 0x100000;
const SHIFT = 0x20000;
const CTRL = 0x40000;
const OPT = 0x80000;
const FN = 0x800000;
const CAPS = 0x10000;
const L_CMD = 0x08;
const R_CMD = 0x10;
const L_SHIFT = 0x02;
const R_SHIFT = 0x04;
const L_CTRL = 0x01;
const R_CTRL = 0x2000;
const L_OPT = 0x20;
const R_OPT = 0x40;
const ALWAYS = 0x100; // macOS sets this one on every event

/** A change of the modifier keys as the helper reports it: the key, the flags after the change, and when. */
const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags: flags | ALWAYS, t });
const OTHER = { kind: 'other' }; // a key or a click while a modifier is held

/** Every tap a new detector hears in `events`. */
function taps(events) {
  const detector = createTapDetector();
  return events.map((event) => detector.feed(event)).filter(Boolean);
}

test('each modifier key tapped on its own is a tap of that key', () => {
  const keys = [
    [55, CMD | L_CMD, 'LeftCommand'], [54, CMD | R_CMD, 'RightCommand'],
    [56, SHIFT | L_SHIFT, 'LeftShift'], [60, SHIFT | R_SHIFT, 'RightShift'],
    [59, CTRL | L_CTRL, 'LeftControl'], [62, CTRL | R_CTRL, 'RightControl'],
    [58, OPT | L_OPT, 'LeftOption'], [61, OPT | R_OPT, 'RightOption'],
    [63, FN, 'Fn'],
  ];
  for (const [keyCode, down, name] of keys) {
    assert.deepStrictEqual(taps([change(keyCode, down, 1000), change(keyCode, 0, 1100)]), [`Tap:${name}`], name);
  }
});

test('keys tapped together are one tap, named in their order, whichever goes first', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000),
    change(56, CMD | L_CMD | SHIFT | L_SHIFT, 1050),
    change(55, SHIFT | L_SHIFT, 1150),
    change(56, 0, 1200),
  ]), ['Tap:LeftShift+LeftCommand']);
});

test('a tap is over within half a second', () => {
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1000 + TAP_MS)]), ['Tap:RightOption'], 'just in time');
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1001 + TAP_MS)]), [], 'held too long');
});

test('a key or a click while it is held is no tap: ⌘C, ⌘-click, ⇧ and a letter', () => {
  assert.deepStrictEqual(taps([change(55, CMD | L_CMD, 1000), OTHER, change(55, 0, 1100)]), []);
  assert.deepStrictEqual(taps([change(56, SHIFT | L_SHIFT, 1000), OTHER, OTHER, change(56, 0, 1200)]), []);
});

test('a spoiled tap does not spoil the next one, and keys pressed with no modifier held change nothing', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000), OTHER, change(55, 0, 1100), // ⌘C
    OTHER, OTHER, // typing
    change(55, CMD | L_CMD, 2000), change(55, 0, 2100), // ⌘ tapped
  ]), ['Tap:LeftCommand']);
});

test('the left and the right key are told apart, even while the other one is held', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000),
    change(54, CMD | L_CMD | R_CMD, 1050),
    change(54, CMD | L_CMD, 1100),
    change(55, 0, 1150),
  ]), ['Tap:LeftCommand+RightCommand']);
  assert.deepStrictEqual(taps([change(54, CMD | R_CMD, 1000), change(54, 0, 1100)]), ['Tap:RightCommand']);
});

test('a keyboard that does not say which side is down still taps: each change of a key flips it', () => {
  assert.deepStrictEqual(taps([change(55, CMD, 1000), change(55, 0, 1100)]), ['Tap:LeftCommand']);
  assert.deepStrictEqual(taps([
    change(55, CMD, 1000), change(54, CMD, 1050), change(54, CMD, 1100), change(55, 0, 1150),
  ]), ['Tap:LeftCommand+RightCommand']);
});

test('a modifier held from before the helper listened spoils the tap', () => {
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT | CMD | L_CMD, 1000), change(61, CMD | L_CMD, 1100)]), [], '⌘ still held at the end');
  assert.deepStrictEqual(taps([
    change(61, OPT | R_OPT | CMD | L_CMD, 1000),
    change(55, OPT | R_OPT, 1050), // ⌘ let go: it was never seen going down
    change(61, 0, 1100),
  ]), [], '⌘ let go meanwhile');
});

test('a key let go that was never seen going down is no tap, and the next tap is heard', () => {
  assert.deepStrictEqual(taps([change(55, 0, 1000), change(55, CMD | L_CMD, 2000), change(55, 0, 2100)]), ['Tap:LeftCommand']);
});

test('fn is a key like the others, and a key while it is held (an arrow) spoils it', () => {
  assert.deepStrictEqual(taps([change(63, FN, 1000), change(63, 0, 1080)]), ['Tap:Fn']);
  assert.deepStrictEqual(taps([change(63, FN, 1000), OTHER, change(63, 0, 1080)]), []);
});

test('each press of Caps Lock on its own is a tap; a second report of the same press is not', () => {
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, 0, 3000)]), ['Tap:CapsLock', 'Tap:CapsLock'], 'on, then off');
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, CAPS, 1200)]), ['Tap:CapsLock'], 'reported twice');
});

test("Caps Lock with a modifier held is no tap, and it spoils that modifier's tap", () => {
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000), change(57, SHIFT | L_SHIFT | CAPS, 1050), change(56, CAPS, 1100),
  ]), []);
  assert.deepStrictEqual(taps([change(57, SHIFT | CAPS, 1000)]), [], '⇧ held from before');
});

test('reset() forgets a tap on its way', () => {
  const detector = createTapDetector();
  assert.strictEqual(detector.feed(change(55, CMD | L_CMD, 1000)), null);
  detector.reset();
  assert.strictEqual(detector.feed(change(55, 0, 1100)), null);
  assert.strictEqual(detector.feed(change(55, CMD | L_CMD, 2000)), null);
  assert.strictEqual(detector.feed(change(55, 0, 2100)), 'Tap:LeftCommand');
});

test('other key codes and other reports are ignored', () => {
  assert.deepStrictEqual(taps([
    change(0, CMD | L_CMD, 1000), { kind: 'mystery' }, {}, change(55, CMD | L_CMD, 2000), change(55, 0, 2100),
  ]), ['Tap:LeftCommand']);
});
