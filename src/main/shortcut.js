'use strict';

/**
 * The global shortcut that opens the panel from any app (⌥Space by default).
 * Changing it never leaves the user with none: if the new one is taken, the
 * old one is put back. It can also be let go while Buddy is turned off, and the
 * same one is taken again when Buddy is turned back on.
 */

function createShortcut({ globalShortcut, onPress }) {
  let current = null; // registered with the system right now
  let remembered = null; // the last one registered, which unregister() lets go of but keeps in mind

  function tryRegister(accelerator) {
    if (!accelerator) return false; // nothing to register: nothing was remembered yet
    try {
      return globalShortcut.register(accelerator, onPress);
    } catch {
      return false; // Electron throws on a malformed accelerator
    }
  }

  return {
    current: () => current,
    /** Registers `accelerator`; with none given, the one that unregister() let go of. */
    register(accelerator = remembered) {
      const previous = current;
      if (previous) globalShortcut.unregister(previous);
      if (tryRegister(accelerator)) {
        current = accelerator;
        remembered = accelerator;
        return true;
      }
      if (previous) tryRegister(previous);
      return false;
    },
    /** Gives the shortcut back to the system, so other apps can use it. register() with no argument takes it again. */
    unregister() {
      if (!current) return;
      globalShortcut.unregister(current);
      current = null;
    },
  };
}

module.exports = { createShortcut };
