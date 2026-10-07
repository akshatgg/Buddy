'use strict';

/**
 * Hears a single-key shortcut: modifier keys tapped on their own. The Mac helper reports each change of the modifier
 * keys ({ kind: 'flags', keyCode, flags, t }) and, while one is held, that some other key or a mouse button went down
 * ({ kind: 'other' }), never which. A tap is keys that go down and all come back up within half a second, with nothing
 * else pressed meanwhile and no other modifier still held at the end; it is named as Settings saves it
 * ("Tap:RightOption"). Caps Lock is different: macOS reports it once per press, so each press alone is a tap.
 */

const { tapValue } = require('../renderer/common/shortcut-keys');

const TAP_MS = 500; // from the first key down to the last one up
const CAPS_LOCK = 57;
const CAPS_REPEAT_MS = 400; // a second report of the same Caps Lock press
// The Mac's key code of each modifier key: its name, the flag bit that says that very key is down, the flag of its
// kind (any ⌘, any ⇧ …), and the other side's bit.
const MODIFIERS = {
  54: { name: 'RightCommand', bit: 0x10, kind: 0x100000, other: 0x08 },
  55: { name: 'LeftCommand', bit: 0x08, kind: 0x100000, other: 0x10 },
  56: { name: 'LeftShift', bit: 0x02, kind: 0x20000, other: 0x04 },
  58: { name: 'LeftOption', bit: 0x20, kind: 0x80000, other: 0x40 },
  59: { name: 'LeftControl', bit: 0x01, kind: 0x40000, other: 0x2000 },
  60: { name: 'RightShift', bit: 0x04, kind: 0x20000, other: 0x02 },
  61: { name: 'RightOption', bit: 0x40, kind: 0x80000, other: 0x20 },
  62: { name: 'RightControl', bit: 0x2000, kind: 0x40000, other: 0x01 },
  63: { name: 'Fn', bit: 0x800000, kind: 0x800000, other: 0 },
};
// ⌃ ⌥ ⇧ ⌘ of either side. Still held when a tap ends, one of them is a key held from before the helper listened.
const HELD_KINDS = 0x100000 | 0x20000 | 0x40000 | 0x80000;

/** Is this modifier key down, going by the flags of a change? */
function isDown(key, flags, wasDown) {
  if (flags & key.bit) return true;
  if (!(flags & key.kind)) return false;
  if (flags & key.other) return false; // the other side is the one held
  return !wasDown; // a keyboard that does not say which side: each change flips it
}

function createTapDetector({ tapMs = TAP_MS } = {}) {
  let held = new Set(); // the modifier keys down now
  let pressed = new Set(); // every key pressed since the first one went down
  let since = 0; // when the first one went down
  let spoiled = false; // something else was pressed meanwhile
  let lastCaps = -Infinity; // the last Caps Lock tap

  function capsLock(flags, t) {
    if (held.size) {
      spoiled = true;
      return null;
    }
    if (flags & HELD_KINDS || t - lastCaps < CAPS_REPEAT_MS) return null;
    lastCaps = t;
    return tapValue(['CapsLock']);
  }

  /** One report from the helper. Answers the shortcut it completes ("Tap:…"), or null. */
  function feed(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.kind === 'other') {
      if (held.size) spoiled = true;
      return null;
    }
    if (event.kind !== 'flags') return null;
    const flags = Number(event.flags) || 0;
    const t = Number(event.t) || 0;
    if (event.keyCode === CAPS_LOCK) return capsLock(flags, t);
    const key = Object.hasOwn(MODIFIERS, event.keyCode) ? MODIFIERS[event.keyCode] : null;
    if (!key) return null;
    if (isDown(key, flags, held.has(key.name))) {
      if (!held.size) {
        pressed = new Set();
        since = t;
        spoiled = false;
      }
      held.add(key.name);
      pressed.add(key.name);
      return null;
    }
    if (!held.has(key.name)) {
      // Let go, but never seen going down: it was held from before the helper listened.
      if (held.size) spoiled = true;
      return null;
    }
    held.delete(key.name);
    if (held.size) return null;
    const tapped = !spoiled && t - since <= tapMs && !(flags & HELD_KINDS);
    const keys = [...pressed];
    pressed = new Set();
    return tapped ? tapValue(keys) : null;
  }

  /** Forget a tap on its way (the shortcut changed, or a new helper started). */
  function reset() {
    held = new Set();
    pressed = new Set();
    spoiled = false;
  }

  return { feed, reset };
}

module.exports = { createTapDetector, TAP_MS, MODIFIERS };
