'use strict';

/**
 * What the rest of the app tells the buddy about how it is used, for its feelings
 * (docs/superpowers/specs/2026-10-08-buddy-feelings-design.md). Every mood the app sends is a use: it wakes a sleeping
 * buddy and starts its sleep countdown (sleep.js) again. While the panel is open the countdown is held, and the buddy
 * does not fidget. While the panel listens the countdown is held too, the buddy listens, and its ear rims glow with the
 * voice. The countdown's own moods (drowsy, asleep, wake) go straight to the buddy: they are not uses.
 */

// How loud a normal voice is: the RMS of the microphone's samples, as the panel measures it (a voice is mostly 0.05 to
// 0.4). The buddy's ear glow is made for a normal voice at 0.5 (moods.js), so this is where the level is 0.5.
const NORMAL_VOICE = 0.1;
// How long a buddy still listening waits, once the panel has stopped, before it goes back to idle. ↩ while listening
// stops the listening and sends the message at once: thinking comes well within this, and the buddy goes straight to it.
const LISTEN_END_MS = 150;

/**
 * How loud the panel says the voice is (RMS, 0 to 1), as the buddy shows it (0 to 1): a normal voice is 0.5, twice as
 * loud 0.75, and so on, ever nearer to 1, so a loud voice still rises and falls instead of staying at the top. A quiet
 * room stays near 0. Anything that is not a number is silence.
 */
function buddyLevel(rms) {
  if (typeof rms !== 'number' || Number.isNaN(rms)) return 0;
  return 1 - 0.5 ** (Math.max(0, rms) / NORMAL_VOICE);
}

/**
 * `buddy` is the buddy window (buddy-window.js) and `sleep` its countdown (sleep.js). `busy()` says whether Buddy is
 * still waiting for the answer to a message (actions.js): a listening that stops then goes back to thinking.
 */
function createFeelings({ buddy, sleep, busy = () => false, later = setTimeout, cancelLater = clearTimeout }) {
  let listening = false;
  let last = null; // the mood sent last
  let ending = null; // the timer that takes a buddy still listening back to idle, while it waits

  /**
   * A mood from the app. It is a use, which the countdown hears first: when that wakes the buddy, the wake comes before
   * the mood, so the mood is what shows.
   */
  function mood(name) {
    if (ending !== null) {
      cancelLater(ending); // what the app shows now takes the place of that idle
      ending = null;
    }
    last = name;
    sleep.poke();
    buddy.mood(name);
  }

  return {
    mood,
    /** The panel opened (true) or closed. */
    panel(open) {
      sleep.hold('panel', open);
      buddy.panelOpen(open);
    },
    /**
     * The panel listens (true) or has stopped. Main also says it stopped whenever it hides the panel, listening or not,
     * so only a change counts: the panel stepping aside while Buddy thinks does not cut the thinking short. When it
     * stops, a buddy still listening goes back to thinking if Buddy is waiting for an answer, or to idle a moment later;
     * a mood the app sent meanwhile (an answer, an error) plays out.
     */
    listening(on) {
      if (Boolean(on) === listening) return;
      listening = Boolean(on);
      sleep.hold('voice', listening);
      if (listening) {
        mood('listening');
      } else if (last === 'listening') {
        if (busy()) {
          mood('thinking');
        } else {
          ending = later(() => {
            ending = null;
            mood('idle');
          }, LISTEN_END_MS);
        }
      }
    },
    /** How loud the person speaks (RMS, from the panel), about 10 times a second while it listens. */
    voiceLevel(rms) {
      buddy.voiceLevel(buddyLevel(rms));
    },
  };
}

module.exports = { createFeelings, buddyLevel, NORMAL_VOICE, LISTEN_END_MS };
