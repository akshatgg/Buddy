'use strict';

/** Whether the Mac's screen is locked, a wait for it to be unlocked (a send waits for the person to unlock), and a call each time it locks (a running job stops). */
function createLock({ powerMonitor, setTimer = setTimeout, clearTimer = clearTimeout }) {
  function locked() {
    try {
      return powerMonitor.getSystemIdleState(1) === 'locked';
    } catch {
      return false; // not known: not locked
    }
  }

  /** Resolves true when it is (or becomes) unlocked within `ms`, false when it stays locked that long. */
  function unlocked(ms) {
    if (!locked()) return Promise.resolve(true);
    return new Promise((resolve) => {
      let timer = null;
      const finish = (value) => {
        powerMonitor.removeListener('unlock-screen', onUnlock);
        clearTimer(timer);
        resolve(value);
      };
      const onUnlock = () => finish(true);
      powerMonitor.on('unlock-screen', onUnlock);
      timer = setTimer(() => finish(false), ms);
    });
  }

  /** Calls `fn` each time the screen locks (a computer-agent job stops at once); answers the function that stops that. */
  function onLocked(fn) {
    powerMonitor.on('lock-screen', fn);
    return () => powerMonitor.removeListener('lock-screen', fn);
  }

  return { locked, unlocked, onLocked };
}

module.exports = { createLock };
