'use strict';

/**
 * The global shortcut that opens the panel from any app (⌥Space by default).
 * Changing it never leaves the user with none: if the new one is taken, the
 * old one is put back.
 */

function createShortcut({ globalShortcut, onPress }) {
  let current = null;

  function tryRegister(accelerator) {
    try {
      return globalShortcut.register(accelerator, onPress);
    } catch {
      return false; // Electron throws on a malformed accelerator
    }
  }

  return {
    current: () => current,
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
  };
}

module.exports = { createShortcut };
