'use strict';

/**
 * The global shortcut that opens the panel from any app (⌥Space by default).
 * Changing it never leaves the user with none: if the new one is taken, the
 * old one is put back. It can also be let go while Buddy is turned off; turning
 * Buddy back on registers the saved shortcut again (main.js reads it from the store).
 */

function createShortcut({ globalShortcut, onPress }) {
  let current = null; // registered with the system right now

  function tryRegister(accelerator) {
    if (!accelerator) return false; // nothing to register (a blank setting)
    try {
      return globalShortcut.register(accelerator, onPress);
    } catch {
      return false; // Electron throws on a malformed accelerator
    }
  }

  return {
    current: () => current,
    /** Registers `accelerator`. If that fails, the one that was registered stays. */
    register(accelerator) {
      const previous = current;
      if (previous) globalShortcut.unregister(previous);
      if (tryRegister(accelerator)) {
        current = accelerator;
        return true;
      }
      if (previous) tryRegister(previous);
      return false;
    },
    /** Gives the shortcut back to the system, so other apps can use it. */
    unregister() {
      if (!current) return;
      globalShortcut.unregister(current);
      current = null;
    },
  };
}

module.exports = { createShortcut };
