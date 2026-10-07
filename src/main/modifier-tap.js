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
// The Mac's key code of each modifier key: its name, the flag bit that says that very key is down (bit), the flag that
// says either side of it is down (any: any ⌘, any ⇧ …), and the other side's bit (other).
const MODIFIERS = {
  54: { name: 'RightCommand', bit: 0x10, any: 0x100000, other: 0x08 },
  55: { name: 'LeftCommand', bit: 0x08, any: 0x100000, other: 0x10 },
  56: { name: 'LeftShift', bit: 0x02, any: 0x20000, other: 0x04 },
  58: { name: 'LeftOption', bit: 0x20, any: 0x80000, other: 0x40 },
  59: { name: 'LeftControl', bit: 0x01, any: 0x40000, other: 0x2000 },
  60: { name: 'RightShift', bit: 0x04, any: 0x20000, other: 0x02 },
  61: { name: 'RightOption', bit: 0x40, any: 0x80000, other: 0x20 },
  62: { name: 'RightControl', bit: 0x2000, any: 0x40000, other: 0x01 },
  63: { name: 'Fn', bit: 0x800000, any: 0x800000, other: 0 },
};
// ⌃ ⌥ ⇧ ⌘ of either side. Still held when a tap ends, one of them is a key held from before the helper listened.
// Not fn: macOS also puts the fn flag on the arrow and function keys, so a stray one must never stop every tap
// (fn is still a key of its own, for a tap of fn).
const HELD_KINDS = 0x100000 | 0x20000 | 0x40000 | 0x80000;

/** Is this modifier key down, going by the flags of a change? */
function isDown(key, flags, wasDown) {
  if (flags & key.bit) return true;
  if (!(flags & key.any)) return false;
  if (flags & key.other) return false; // the other side is the one held
  return !wasDown; // a keyboard that does not say which side: each change flips it
}

/**
 * Do the flags of a change say this modifier key is up? Only when they are sure: a keyboard that does not say which
 * side is down leaves a doubt, and the key stays held.
 */
function isUp(key, flags) {
  if (flags & key.bit) return false;
  if (!(flags & key.any)) return true;
  return (flags & key.other) !== 0; // the other side is the one held
}

function createTapDetector({ tapMs = TAP_MS } = {}) {
  let held = new Set(); // the modifier keys down now (their entries of MODIFIERS)
  let pressed = new Set(); // the name of every key pressed since the first one went down
  let since = 0; // when the first one went down
  let spoiled = false; // something else was pressed meanwhile
  let lastCaps = -Infinity; // the last Caps Lock report

  function capsLock(flags, t) {
    // Every report counts, tap or not: a press that something else spoiled is still the same press when it is reported again.
    const again = t - lastCaps < CAPS_REPEAT_MS;
    lastCaps = t;
    if (held.size) {
      spoiled = true;
      return null;
    }
    if (flags & HELD_KINDS || again) return null;
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
    const key = Object.hasOwn(MODIFIERS, event.keyCode) ? MODIFIERS[event.keyCode] : null;
    // Every report has all the flags, so it also says which keys are up. A release that was never heard (macOS switches
    // the key tap off while a password field takes the keys, or when it is slow) must not leave a key held for good:
    // no tap would be heard again. The key this report is about is left to the code below, since its own report says
    // whether it went down or up.
    for (const heldKey of held) {
      if (heldKey !== key && isUp(heldKey, flags)) held.delete(heldKey);
    }
    if (event.keyCode === CAPS_LOCK) return capsLock(flags, t);
    if (!key) return null;
    if (isDown(key, flags, held.has(key))) {
      // A key that is down already does not go down a second time: its release went unheard, and this is a new press of
      // it. Dropped first, so that on its own it starts a tap afresh. (A keyboard that does not say which side is down
      // never gets here for a held key: the report flips it to up.)
      held.delete(key);
      if (!held.size) {
        pressed = new Set();
        since = t;
        spoiled = false;
      }
      held.add(key);
      pressed.add(key.name);
      return null;
    }
    if (!held.has(key)) {
      // Let go, but never seen going down: it was held from before the helper listened.
      if (held.size) spoiled = true;
      return null;
    }
    held.delete(key);
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

module.exports = { createTapDetector, TAP_MS };
