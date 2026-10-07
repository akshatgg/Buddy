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
const CAPS_REPEAT_MS = 400; // a second report of one Caps Lock press: the detector's own number, so it is written here too

/** A change of the modifier keys as the helper reports it: the key, the flags after the change, and when. */
const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags: flags | ALWAYS, t });
const OTHER = { kind: 'other' }; // a key or a click while a modifier is held

/** Every tap a new detector (made with `options`) hears in `events`. */
function taps(events, options) {
  const detector = createTapDetector(options);
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

test('how long a tap may take can be set', () => {
  const quick = { tapMs: 200 };
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1200)], quick), ['Tap:RightOption'], 'just in time');
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1201)], quick), [], 'a millisecond too long');
});

test('Caps Lock being on does not stop a modifier key from being tapped', () => {
  assert.deepStrictEqual(taps([change(55, CAPS | CMD | L_CMD, 1000), change(55, CAPS, 1100)]), ['Tap:LeftCommand']);
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

// macOS switches the helper's key tap off while a password field takes the keys, so a key can be let go unheard.
// Every report has all the flags, and they say which keys are up.
test('a key whose release was never heard does not stop the next tap', () => {
  assert.deepStrictEqual(taps([
    change(59, CTRL | L_CTRL, 1000), // ⌃ goes down, and its release is never heard
    change(61, OPT | R_OPT, 9000), // the flags show no ⌃ any more
    change(61, 0, 9080),
  ]), ['Tap:RightOption']);
});

// The key goes down, its release is lost, and the next time it goes down is the next report about it. A keyboard that says
// which side is down never reports a second "down" for a key that is down, so this one is a press after a lost release.
test('a key whose release was never heard, pressed again on its own, is a tap', () => {
  assert.deepStrictEqual(taps([
    change(61, OPT | R_OPT, 1000), // goes down, and its release is never heard
    change(61, OPT | R_OPT, 9000), // goes down again
    change(61, 0, 9080),
  ]), ['Tap:RightOption']);
});

test('a key whose release was never heard does not spoil Caps Lock either', () => {
  assert.deepStrictEqual(taps([change(55, CMD | L_CMD, 1000), change(57, CAPS, 9000)]), ['Tap:CapsLock']);
});

test('a key that really is still held keeps blocking the tap', () => {
  assert.deepStrictEqual(taps([
    change(59, CTRL | L_CTRL, 1000),
    change(61, CTRL | L_CTRL | OPT | R_OPT, 9000), // ⌃ is still in the flags
    change(61, CTRL | L_CTRL, 9080),
  ]), []);
  // fn is the one key the end of a tap does not look at, so only a held fn shows that it is kept
  assert.deepStrictEqual(taps([change(63, FN, 1000), change(61, FN | OPT | R_OPT, 1050), change(61, FN, 1100)]), [], 'fn');
});

test('with the sides told, a left key whose release was never heard is let go when only the right one is down', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000), // Left ⌘ goes down, and its release is never heard
    change(54, CMD | R_CMD, 9000), // ⌘ is still in the flags, but it is the right one
    change(54, 0, 9080),
  ]), ['Tap:RightCommand']);
});

test('fn is a key like the others, and a key while it is held (an arrow) spoils it', () => {
  assert.deepStrictEqual(taps([change(63, FN, 1000), change(63, 0, 1080)]), ['Tap:Fn']);
  assert.deepStrictEqual(taps([change(63, FN, 1000), OTHER, change(63, 0, 1080)]), []);
});

test('a stray fn flag, which macOS puts on the arrow and function keys, does not stop the tap of another key', () => {
  assert.deepStrictEqual(taps([change(55, FN | CMD | L_CMD, 1000), change(55, FN, 1100)]), ['Tap:LeftCommand']);
});

test('each press of Caps Lock on its own is a tap; a second report of the same press is not', () => {
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, 0, 3000)]), ['Tap:CapsLock', 'Tap:CapsLock'], 'on, then off');
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, CAPS, 1200)]), ['Tap:CapsLock'], 'reported twice');
});

test('a second report of Caps Lock within 400 ms is the same press; 400 ms later it is a new one', () => {
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, CAPS, 1000 + CAPS_REPEAT_MS - 1)]), ['Tap:CapsLock'], 'the same press');
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, 0, 1000 + CAPS_REPEAT_MS)]), ['Tap:CapsLock', 'Tap:CapsLock'], 'a new press');
});

test("Caps Lock with a modifier held is no tap, and it spoils that modifier's tap", () => {
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000), change(57, SHIFT | L_SHIFT | CAPS, 1050), change(56, CAPS, 1100),
  ]), []);
  assert.deepStrictEqual(taps([change(57, SHIFT | CAPS, 1000)]), [], '⇧ held from before');
});

// Some keyboards report a Caps Lock press twice. A press that ⇧ spoiled is still that press when it is reported again,
// even if ⇧ has been let go by then.
test('a Caps Lock press spoiled by a held modifier is not a tap when it is reported a second time', () => {
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000),
    change(57, SHIFT | L_SHIFT | CAPS, 1050), // Caps Lock with ⇧ held: no tap
    change(56, CAPS, 1100), // ⇧ let go
    change(57, CAPS, 1200), // the same press, reported again
  ]), [], '⇧ let go between the two reports');
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000),
    change(57, SHIFT | L_SHIFT | CAPS, 1050),
    change(57, CAPS, 1200), // reported again, and the flags already show ⇧ up
    change(56, CAPS, 1250), // its own report comes after
  ]), [], 'whichever report of ⇧ going up comes first');
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000),
    change(57, SHIFT | L_SHIFT | CAPS, 1050),
    change(57, SHIFT | L_SHIFT | CAPS, 1200), // reported again, with ⇧ still down
    change(56, CAPS, 1250),
  ]), [], 'and with ⇧ down for both reports');
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000),
    change(57, SHIFT | L_SHIFT | CAPS, 1050),
    change(56, CAPS, 1100),
    change(57, CAPS, 1050 + CAPS_REPEAT_MS), // a new press, 400 ms after the last report
  ]), ['Tap:CapsLock']);
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
