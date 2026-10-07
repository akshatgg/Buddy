'use strict';

/**
 * Hears a single-key shortcut ("Tap:RightOption"). The Mac helper reports the modifier keys only while Buddy needs
 * them: while such a shortcut is Buddy's, and while Settings records a new one. The reports go through a tap detector
 * (modifier-tap.js): a tap of the shortcut opens the panel, and while Settings records, every tap goes to Settings
 * instead. A helper that restarts is told again; one that cannot listen (Buddy has no Accessibility yet) is asked again
 * every 10 seconds, so that the shortcut starts working once the permission is given.
 */

const { tapKeys, tapValue } = require('../renderer/common/shortcut-keys');
const { createTapDetector } = require('./modifier-tap');

const RETRY_MS = 10_000;

function createKeyWatch({ helper, onPress, later = setTimeout, cancelLater = clearTimeout, retryMs = RETRY_MS }) {
  const detector = createTapDetector();
  let shortcut = null; // the tap that opens the panel, or null
  let recorder = null; // while Settings records a shortcut: where the taps go
  let listening = false; // the helper was told to listen, and said yes
  let telling = null; // the helper is being told; this settles once it has been
  let again = false; // what the helper should do changed while it was being told
  let retry = null; // the timer that asks again after the helper could not listen

  const wanted = () => Boolean(shortcut || recorder);

  async function tell() {
    do {
      again = false;
      const want = wanted();
      if (want === listening) continue;
      try {
        await helper.call('watchKeys', { on: want });
        listening = want;
      } catch (err) {
        listening = false; // it could not listen, or could not be told to stop: either way it is not listening for Buddy
        if (want) {
          console.warn('[buddy] could not listen for the shortcut key:', err.code);
          askAgainLater();
        }
      }
    } while (again);
  }

  /** Have the helper listen, or not, as Buddy now needs. Asked again while it is being told, it is told again after. */
  function sync() {
    if (!wanted() && retry !== null) {
      cancelLater(retry);
      retry = null;
    }
    if (telling) {
      again = true;
      return telling;
    }
    telling = tell().finally(() => {
      telling = null;
    });
    return telling;
  }

  function askAgainLater() {
    if (retry !== null) return;
    retry = later(() => {
      retry = null;
      sync();
    }, retryMs);
  }

  helper.on('keys', (event) => {
    const tap = detector.feed(event);
    if (!tap) return;
    if (recorder) recorder(tap);
    else if (tap === shortcut) onPress();
  });
  // A new helper does not listen, whatever the last one was told.
  helper.on('started', () => {
    listening = false;
    detector.reset();
    sync();
  });

  return {
    /** Make `value` ("Tap:…") the shortcut, or none with null. False, changing nothing, when it is not a well-formed one. */
    setShortcut(value) {
      if (value === null) {
        shortcut = null;
      } else {
        const keys = tapKeys(value);
        if (!keys) return false;
        shortcut = tapValue(keys);
      }
      detector.reset();
      sync();
      return true;
    },
    /** While Settings records a shortcut: every tap goes to onTap, and none opens the panel. */
    startRecording(onTap) {
      recorder = onTap;
      detector.reset();
      sync();
    },
    stopRecording() {
      if (!recorder) return;
      recorder = null;
      detector.reset();
      sync();
    },
  };
}

module.exports = { createKeyWatch, RETRY_MS };
