'use strict';

/**
 * The shortcut that opens the panel from any app (⌥Space by default): keys pressed together, registered with the
 * system as an Electron accelerator, or a single key tapped on its own ("Tap:RightOption"), heard through the Mac
 * helper (key-watch.js). Changing it never leaves the user with none: if the new one is taken, the old one is put
 * back. It can also be let go while Buddy is turned off; turning Buddy back on takes the saved shortcut again (main.js
 * reads it from the store).
 */

const { isTap } = require('../renderer/common/shortcut-keys');

function createShortcut({ globalShortcut, keyWatch, onPress }) {
  let current = null; // registered with the system, or heard through the helper, right now

  function take(value) {
    if (!value) return false; // nothing to register (a blank setting)
    if (isTap(value)) return keyWatch.setShortcut(value); // false for one that is not well formed
    try {
      return globalShortcut.register(value, onPress);
    } catch {
      return false; // Electron throws on a malformed accelerator
    }
  }

  function release(value) {
    if (isTap(value)) keyWatch.setShortcut(null);
    else globalShortcut.unregister(value);
  }

  return {
    current: () => current,
    /** Takes `value`. If that fails, the one that was taken stays. */
    register(value) {
      const previous = current;
      if (previous) release(previous);
      if (take(value)) {
        current = value;
        return true;
      }
      if (previous) take(previous);
      return false;
    },
    /** Gives the shortcut back, so other apps can use it (and the helper stops listening for a single key). */
    unregister() {
      if (!current) return;
      release(current);
      current = null;
    },
  };
}

module.exports = { createShortcut };
