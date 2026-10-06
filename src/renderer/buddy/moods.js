// How the buddy moves: pure functions of time, so they can be tested in Node
// and the page only has to apply them. Times are in seconds; lift is a
// fraction of the model's height; angles are radians.

// How often the page draws. The cost is mostly a fixed price per frame, whatever
// is on it, so the buddy draws as seldom as it can without looking jerky:
//   FPS       30  a mood, a press or a drag, and around each blink: what has to look smooth;
//   IDLE_FPS  15  the head following the pointer, until 10 s after it last turned, and the 10 s
//                 after a mood or a press: slower is fine for a head that is only turning;
//   REST_FPS   6  nothing has happened for 10 s: only the slow float and the occasional
//                 blink are left.
export const FPS = 30;
export const IDLE_FPS = 15;
export const REST_FPS = 6;

// A blink is drawn at the full rate from its first frame. At rest frames are
// 1 / REST_FPS apart, so look that far ahead: the frame before a blink starts
// always sees it coming (see blinker.soon).
export const BLINK_LOOKAHEAD = 1 / REST_FPS;

const SETTLE_SECONDS = 10; // how long the settling rate lasts, before the rest rate

/**
 * Does the buddy need the full rate? A mood, or a press or a drag. A blink is not
 * counted: it is brief, and foreseen by blinker.soon(). Nor is the head turning:
 * following the pointer looks fine at the settling rate.
 */
export function isActive({ mood, pressing }) {
  return mood !== 'idle' || pressing;
}

/**
 * How many frames a second to draw. `blinkSoon` is blinker.soon(); `sinceLookChange`
 * is seconds since the head last turned; `sinceActive` is seconds since isActive()
 * was last true.
 */
export function fpsFor({ mood, pressing, sinceLookChange, blinkSoon, sinceActive }) {
  if (blinkSoon || isActive({ mood, pressing })) return FPS;
  return sinceLookChange < SETTLE_SECONDS || sinceActive < SETTLE_SECONDS ? IDLE_FPS : REST_FPS;
}

/**
 * Seconds to wait before drawing when something has just happened (a mood, a
 * press, a head turn), so that a frame already scheduled for later at the idle
 * or rest rate is not waited out. Draws at once, unless the last frame was less
 * than one full-rate frame ago: the page never draws faster than FPS.
 */
export function wakeDelay(sinceLastFrame) {
  return Math.max(0, 1 / FPS - sinceLastFrame);
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

// Thinking: each eye is a glowing line (the blink shape) sweeping up and down the screen
// SWEEP_HZ times a second, the right line SWEEP_LAG radians behind the left, so together
// they read as one line sweeping across, like a scanner. eyeL and eyeR run from -1 (down)
// to 1 (up).
export const SWEEP_HZ = 1.2;
export const SWEEP_LAG = 0.6;

const REST = Object.freeze({
  lift: 0, scaleX: 1, scaleY: 1, headTilt: 0, armL: 0, armR: 0, smile: 0, mouthO: 0, eyesClosed: false,
  eyeL: 0, eyeR: 0, done: false,
});

/** The pose for a mood, `since` seconds after it started. `done` means: go back to idle. */
export function moodPose(name, since) {
  switch (name) {
    case 'thinking': {
      const sweep = 2 * Math.PI * SWEEP_HZ * since;
      return {
        ...REST, headTilt: 0.18 + 0.04 * Math.sin(since * 2), armR: 0.6,
        eyesClosed: true, eyeL: Math.sin(sweep), eyeR: Math.sin(sweep - SWEEP_LAG),
      };
    }
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
