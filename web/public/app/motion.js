// Shaking the phone makes the buddy dizzy, as shaking it with the mouse does on the Mac (gestures.js does that for a
// drag). The phone says how it moves (DeviceMotionEvent's acceleration, without gravity, in m/s²): a shake is a few big
// jolts close together. Walking, or putting the phone down, stays well under a jolt.

export const JOLT = 15; // m/s²: a hand shaking a phone goes past this; walking stays under 5

/**
 * feed(x, y, z, t) takes one reading (m/s², and the time in ms) and answers true once, when `jolts` jolts came within
 * `withinMs`; then it counts afresh. Readings come about 60 times a second, so readings less than `gapMs` after a jolt
 * are the same jolt.
 */
export function createMotionShake({ jolt = JOLT, jolts = 4, withinMs = 1200, gapMs = 120 } = {}) {
  let times = [];
  return {
    feed(x, y, z, t) {
      if (![x, y, z, t].every(Number.isFinite) || Math.hypot(x, y, z) < jolt) return false;
      if (times.length && t - times[times.length - 1] < gapMs) return false;
      times = [...times.filter((time) => t - time <= withinMs), t];
      if (times.length < jolts) return false;
      times = [];
      return true;
    },
    reset() {
      times = [];
    },
  };
}

/** Whether the browser asks before it tells the phone's motion (iOS 13 and later): then a tap must ask first. */
export function motionNeedsAsking(DeviceMotion) {
  return typeof DeviceMotion?.requestPermission === 'function';
}

/**
 * Asks iOS for the phone's motion (it must come from a tap iOS counts as the person's: a click, not a pointerdown).
 * Answers 'granted' (also when nothing needs asking), 'denied' (the person said no: stop asking), or 'later' (iOS
 * refused the ask itself, e.g. NotAllowedError: ask again at the next tap).
 */
export async function askForMotion(DeviceMotion) {
  if (!motionNeedsAsking(DeviceMotion)) return 'granted';
  try {
    return (await DeviceMotion.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    console.warn('[buddy] motion not allowed yet', err?.name);
    return 'later';
  }
}
