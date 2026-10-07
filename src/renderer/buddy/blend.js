// Easing from one thing to the next, so that nothing the buddy shows jumps: a new mood's pose eases in from the pose
// that was showing when it started, and the voice level eases from one reading to the next. Pure, so they can be
// tested in Node; buddy.js applies them.

/** How long a new mood takes to ease in from the pose that was showing, in seconds. */
export const BLEND = 0.2;

/** 0 up to x = 0, 1 from x = 1, and an S-curve between, as in moods.js. */
function ease(x) {
  const k = Math.min(1, Math.max(0, x));
  return k * k * (3 - 2 * k);
}

/**
 * The pose to draw `since` seconds after the mood changed: `from`, the pose drawn when it changed, easing into `to`,
 * the new mood's pose now, every number on its own. A mood can start anywhere (cut short, woken from drowsy instead of
 * asleep, a new one before the last has eased in), so this is what keeps it from jumping. What is not a number (the
 * symbols' effect, done) is `to`'s at once, so the page draws the eyes' blink weight, a number, rather than eyesClosed.
 * With nothing drawn yet, or from BLEND seconds on, it is `to` itself.
 */
export function blendPose(from, to, since) {
  if (!from || !(since < BLEND)) return to;
  const k = ease(since / BLEND);
  const pose = {};
  for (const [field, value] of Object.entries(to)) {
    const was = from[field];
    pose[field] = typeof value === 'number' && typeof was === 'number' ? was + (value - was) * k : value;
  }
  return pose;
}

// The voice level comes about 10 times a second. Drawn as it comes, the ear rims would glow in steps, so the level
// drawn rises quickly toward each reading and falls back more slowly, the way a sound meter's needle moves.
const RISE = 0.08; // seconds: in this time the level drawn gets 63 % of the way up to a louder reading,
const FALL = 0.2; // and in this, 63 % of the way down to a quieter one

/** The voice level to draw `dt` seconds after it was `level`, while the voice reads `target` (both 0 to 1). */
export function smoothLevel(level, target, dt) {
  const time = dt > 0 ? dt : 0; // a clock that went back (or nothing to go by) changes nothing
  return target + (level - target) * Math.exp(-time / (target > level ? RISE : FALL));
}
