// How the buddy moves: pure functions of time, so they can be tested in Node
// and the page only has to apply them. Times are in seconds; lift is a
// fraction of the model's height; angles are radians.

// How often the page draws. The cost is mostly a fixed price per frame, whatever
// is on it, so the buddy draws as seldom as it can without looking jerky:
//   FPS       30  while something is happening (a mood, a press, the head turning
//                 to follow the pointer) and around each blink, so those are smooth;
//   IDLE_FPS  15  for the 10 s after that, so it settles gently;
//   REST_FPS   6  once nothing has happened for a while: only the slow float and
//                 the occasional blink are left.
export const FPS = 30;
export const IDLE_FPS = 15;
export const REST_FPS = 6;

const LOOK_SECONDS = 1; // the head turning counts as something happening for this long
const SETTLE_SECONDS = 10; // how long the settling rate lasts before the rest rate

/**
 * Is the buddy doing something that needs the full rate? A mood, a press or a
 * drag, or the head turning (`sinceLookChange`, seconds since it last did).
 * A blink does not count: it is brief, and foreseen by blinker.soon().
 */
export function isActive({ mood, pressing, sinceLookChange }) {
  return mood !== 'idle' || pressing || sinceLookChange < LOOK_SECONDS;
}

/**
 * How many frames a second to draw. `blinkSoon` is blinker.soon(); `sinceActive`
 * is seconds since isActive() was last true.
 */
export function fpsFor({ mood, pressing, sinceLookChange, blinkSoon, sinceActive }) {
  if (blinkSoon || isActive({ mood, pressing, sinceLookChange })) return FPS;
  return sinceActive < SETTLE_SECONDS ? IDLE_FPS : REST_FPS;
}

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/** The slow up-and-down float. */
export function floatOffset(t, amplitude = 0.035, period = 3) {
  return amplitude * Math.sin((2 * Math.PI * t) / period);
}

const BLINK_LENGTH = 0.16; // shut over 70 ms, open over 90 ms

/**
 * Blinks every 3-6 s: shut over 70 ms, open over 90 ms. value(t) is 0 (open) to 1
 * (shut), and is the only thing that schedules the next blink. soon(t, within) says
 * whether a blink is under way at t or starts within `within` seconds, so the page
 * can draw it at full rate; asking never changes when the next blink is.
 */
export function createBlinker(random = Math.random) {
  let next = 2 + random() * 3;
  return {
    value(t) {
      if (t < next) return 0;
      const k = t - next;
      if (k >= BLINK_LENGTH) {
        next = t + 3 + random() * 3;
        return 0;
      }
      return k < 0.07 ? k / 0.07 : 1 - (k - 0.07) / 0.09;
    },
    soon(t, within) {
      return t >= next - within && t < next + BLINK_LENGTH;
    },
  };
}

/** Turn the head toward the pointer, dx/dy in screen points from the buddy's centre. */
export function lookAt(dx, dy) {
  return { yaw: clamp(dx / 600, -0.45, 0.45), pitch: clamp(dy / 500, -0.2, 0.25) };
}

const REST = Object.freeze({
  lift: 0, scaleX: 1, scaleY: 1, headTilt: 0, armL: 0, armR: 0, smile: 0, mouthO: 0, eyesClosed: false, done: false,
});

/** The pose for a mood, `since` seconds after it started. `done` means: go back to idle. */
export function moodPose(name, since) {
  switch (name) {
    case 'thinking':
      return { ...REST, headTilt: 0.18 + 0.04 * Math.sin(since * 2), armR: 0.6, mouthO: 0.3 };
    case 'happy': {
      const length = 1.2;
      const fade = 1 - Math.min(since / length, 1);
      const bounce = Math.abs(Math.sin(since * Math.PI * 2.5)) * fade;
      return {
        ...REST,
        lift: 0.08 * bounce, scaleY: 1 + 0.05 * bounce, scaleX: 1 - 0.03 * bounce,
        smile: 1, armL: 0.8 * fade, armR: 0.8 * fade, done: since >= length,
      };
    }
    case 'wave': {
      const length = 1.8;
      const raised = clamp(Math.min(since / 0.25, (length - since) / 0.25), 0, 1);
      return { ...REST, armL: raised * (2.2 + 0.35 * Math.sin(since * 14)), smile: 0.8, done: since >= length };
    }
    case 'sleepy':
      return { ...REST, eyesClosed: true, scaleY: 1 + 0.02 * Math.sin(since * 1.6), headTilt: 0.12 };
    case 'wobble':
      return { ...REST, headTilt: 0.15 * Math.sin(since * 18), mouthO: 0.5 };
    default:
      return REST;
  }
}
