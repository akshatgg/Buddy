'use strict';

/** Whether the Mac's screen is locked, and a wait for it to be unlocked (a send waits for the person to unlock). */
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

  return { locked, unlocked };
}

module.exports = { createLock };
