'use strict';

/**
 * The buddy's sleep. Left alone it gets drowsy after a minute and falls asleep after two; a use wakes it and starts the
 * count again. Some things hold the count while they last (the panel is open, the pointer is on the buddy): then nothing
 * counts down. This only counts, and says which mood comes of it: onMood hears 'drowsy', 'asleep' and 'wake'. What counts
 * as a use, and what those moods look like, is for whoever calls it and for the buddy page.
 */

const DROWSY_MS = 60_000;
const ASLEEP_MS = 120_000;

function createSleep({ onMood, later = setTimeout, cancelLater = clearTimeout, drowsyMs = DROWSY_MS, asleepMs = ASLEEP_MS }) {
  let current = 'awake'; // 'awake', 'drowsy' or 'asleep'
  const holds = new Set(); // the reasons the countdown is held for
  let timers = []; // the countdown's two timers, while it runs

  /** Drowsy or asleep, when the time comes. Never back from asleep to drowsy, whatever the two times are. */
  function fall(to) {
    if (current === 'asleep') return;
    current = to;
    onMood(to);
  }

  /** Count down from now, unless something holds. Both times are counted from this moment. */
  function restart() {
    timers.forEach((timer) => cancelLater(timer));
    timers = [];
    if (holds.size) return;
    timers = [later(() => fall('drowsy'), drowsyMs), later(() => fall('asleep'), asleepMs)];
  }

  function poke() {
    const wakes = current !== 'awake';
    current = 'awake';
    restart(); // before telling anyone, so that whatever they do finds the countdown already running
    if (wakes) onMood('wake');
  }

  restart();

  return {
    /** The buddy was used: wake it if it sleeps, and count down again from now. */
    poke,
    /**
     * `reason` holds the countdown (on) or lets go of it (off). Holding is a use too. While any reason holds there is no
     * countdown; when the last lets go it starts again from then. A reason that holds twice holds once.
     */
    hold(reason, on) {
      if (on) {
        holds.add(reason);
        poke();
      } else if (holds.delete(reason) && !holds.size) {
        restart();
      }
    },
    state: () => current,
  };
}

module.exports = { createSleep, DROWSY_MS, ASLEEP_MS };
