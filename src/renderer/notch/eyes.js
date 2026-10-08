'use strict';
/* global module */
/* exported NotchEyes */

/**
 * The notch page's eyes: what shape each eye has at a moment, for the mood main sent and the pointer's place, and
 * the timing of what Buddy says beside the notch. The page loads this as a script and draws what it says; the unit
 * tests require it. So it must stay free of the DOM. All times are in milliseconds (performance.now()).
 *
 * createEyes({ random }) → { setMood(name, t), setLook(dx, dy), setHover(on), frame(t) }
 * frame(t) → { left, right, bounce, dot, wide, look, active, nextIn, done }:
 *   left, right: { open, arch, curl, droop, tilt }: how open the eye is (0 shut, 1 open), how far it is the happy
 *     arch (∩) or the sleeping smile (‿), how far its outer top droops, and its tilt in degrees (clockwise);
 *   bounce: the celebrate bounce, 0 (resting) to 1 (the top of a bounce);
 *   dot: the thinking dot under the right eye, 0 (off) to 1;
 *   wide: how much wider the eyes are, hovered or listening, 0 to 1;
 *   look: { x, y } where the eyes look, in points (up to LOOK_MAX either way);
 *   active: something is moving, so the page draws at the full rate; nextIn: when it is not, the milliseconds until
 *     the next thing to draw (the next blink), so the page can sleep until then;
 *   done: a timed mood (happy, celebrate, sad, wave) just ended and the eyes are idle again.
 * saying(width, elapsedMs) → { grow, hold, done, width }: the text's wing grows over SAY_GROW_MS, holds SAY_HOLD_MS,
 *   shrinks over SAY_SHRINK_MS; `width` is how much of `width` shows now.
 */
const NotchEyes = (() => {
  const BLINK_MS = 120; // a blink: shut, then open again
  const BLINK_SLOW_MS = 240; // a slow one, thinking or sleepy
  const BLINK_MIN_MS = 3000; // blinks are 3 to 6 s apart
  const BLINK_SPAN_MS = 3000;
  const BLINK_SHUT = 0.42; // the part of a blink spent closing; the rest opens
  const HAPPY_MS = 1200;
  const CELEBRATE_MS = 1200;
  const BOUNCES = 2; // within CELEBRATE_MS
  const SAD_MS = 2500;
  const SAD_TILT = 12; // degrees
  const WINK_MS = 300;
  const RAMP_MS = 120; // a mood's shape eases in over this
  const WIDE_MS = 180; // the eyes open wider (hover, listening) over this
  const DOT_MS = 1200; // one pulse of the thinking dot
  const LOOK_MAX = 2; // points
  const LOOK_SCALE = 1 / 200; // points of look per point of pointer distance
  const LOOK_EPSILON = 0.05; // a smaller change of the look is not worth drawing
  const SAY_GROW_MS = 220;
  const SAY_HOLD_MS = 2600;
  const SAY_SHRINK_MS = 220;

  const TIMED = { happy: HAPPY_MS, celebrate: CELEBRATE_MS, sad: SAD_MS, wave: WINK_MS };
  const KNOWN = ['idle', 'thinking', 'happy', 'celebrate', 'sad', 'sleepy', 'asleep', 'wave', 'listening'];
  const SLOW_BLINK = ['thinking', 'sleepy'];
  const CLOSED = ['happy', 'celebrate', 'asleep', 'wave']; // moods that shape the eyes themselves: no blink on top
  const WIDE = ['listening'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = (k) => 1 - (1 - k) ** 3;
  const easeIn = (k) => k ** 3;

  const eye = () => ({ open: 1, arch: 0, curl: 0, droop: 0, tilt: 0 });

  /** The shape of the eyes for a mood, `elapsed` ms into it, before the blink. */
  function shape(mood, elapsed) {
    const left = eye();
    const right = eye();
    const ramp = clamp(elapsed / RAMP_MS, 0, 1);
    let bounce = 0;
    let dot = 0;
    let look = null; // a look of the mood's own, over the pointer's
    switch (mood) {
      case 'happy':
      case 'celebrate':
        left.arch = right.arch = ramp;
        left.open = right.open = 1 - ramp;
        if (mood === 'celebrate') bounce = Math.abs(Math.sin((Math.PI * BOUNCES * elapsed) / CELEBRATE_MS));
        break;
      case 'sad':
        left.droop = right.droop = ramp;
        left.tilt = SAD_TILT * ramp;
        right.tilt = -SAD_TILT * ramp;
        break;
      case 'wave':
        right.open = 1 - Math.sin((Math.PI * clamp(elapsed / WINK_MS, 0, 1)));
        break;
      case 'thinking':
        look = { x: -LOOK_MAX, y: -LOOK_MAX };
        dot = (1 - Math.cos((2 * Math.PI * elapsed) / DOT_MS)) / 2;
        break;
      case 'sleepy':
        left.open = right.open = 0.5;
        break;
      case 'asleep':
        left.curl = right.curl = ramp;
        left.open = right.open = 1 - ramp;
        break;
      default: // idle, listening
        break;
    }
    return { left, right, bounce, dot, look };
  }

  function createEyes({ random = Math.random } = {}) {
    let mood = 'idle';
    let since = 0;
    let look = { x: 0, y: 0 };
    let hovering = false;
    let next = null; // when the next blink starts; null until the first frame
    let wide = { from: 0, to: 0, since: -Infinity }; // the eyes opening wider, or back

    const wideTarget = () => (hovering || WIDE.includes(mood) ? 1 : 0);

    /** How shut the blink is now, 0 (not blinking) to 1, keeping the blink clock; `nextIn` ms until the next one. */
    function blink(t, slow) {
      if (next === null) next = t + BLINK_MIN_MS + random() * BLINK_SPAN_MS;
      if (t < next) return { shut: 0, nextIn: next - t };
      const length = slow ? BLINK_SLOW_MS : BLINK_MS;
      const k = (t - next) / length;
      if (k >= 1) {
        next = t + BLINK_MIN_MS + random() * BLINK_SPAN_MS;
        return { shut: 0, nextIn: next - t };
      }
      const shut = k < BLINK_SHUT ? k / BLINK_SHUT : 1 - (k - BLINK_SHUT) / (1 - BLINK_SHUT);
      return { shut, nextIn: 0 };
    }

    return {
      /** The mood main sent, at `t`. One this page does not know looks like idle. */
      setMood(name, t) {
        mood = KNOWN.includes(name) ? name : 'idle';
        since = t;
      },
      /** The pointer's place from the window's centre, in points. True when the eyes turn by enough to draw. */
      setLook(dx, dy) {
        const x = clamp(dx * LOOK_SCALE, -LOOK_MAX, LOOK_MAX);
        const y = clamp(dy * LOOK_SCALE, -LOOK_MAX, LOOK_MAX);
        const changed = Math.abs(x - look.x) > LOOK_EPSILON || Math.abs(y - look.y) > LOOK_EPSILON;
        if (changed) look = { x, y };
        return changed;
      },
      setHover(on) {
        hovering = on;
      },
      frame(t) {
        let done = false;
        let elapsed = t - since;
        if (mood in TIMED && elapsed >= TIMED[mood]) {
          mood = 'idle';
          since = t;
          elapsed = 0;
          done = true;
        }
        const s = shape(mood, elapsed);
        const b = blink(t, SLOW_BLINK.includes(mood));
        if (!CLOSED.includes(mood)) {
          s.left.open *= 1 - b.shut;
          s.right.open *= 1 - b.shut;
        }
        if (wide.to !== wideTarget()) {
          wide = { from: wideValue(t), to: wideTarget(), since: t };
        }
        const widening = t - wide.since < WIDE_MS;
        const active = mood in TIMED || mood === 'thinking' || b.shut > 0 || widening;
        return {
          left: s.left,
          right: s.right,
          bounce: s.bounce,
          dot: s.dot,
          wide: wideValue(t),
          look: s.look ?? look,
          active,
          nextIn: active ? 0 : b.nextIn,
          done,
        };
      },
    };

    function wideValue(t) {
      const k = clamp((t - wide.since) / WIDE_MS, 0, 1);
      return wide.from + (wide.to - wide.from) * easeOut(k);
    }
  }

  /** The wing of what Buddy says, `elapsed` ms after the text came: how far out it is, 0 to 1, and its width now. */
  function saying(width, elapsed) {
    let grow;
    let hold = false;
    let done = false;
    if (elapsed < SAY_GROW_MS) {
      grow = easeOut(clamp(elapsed / SAY_GROW_MS, 0, 1));
    } else if (elapsed < SAY_GROW_MS + SAY_HOLD_MS) {
      grow = 1;
      hold = true;
    } else if (elapsed < SAY_GROW_MS + SAY_HOLD_MS + SAY_SHRINK_MS) {
      grow = 1 - easeIn((elapsed - SAY_GROW_MS - SAY_HOLD_MS) / SAY_SHRINK_MS);
    } else {
      grow = 0;
      done = true;
    }
    return { grow, hold, done, width: width * grow };
  }

  return {
    createEyes, saying,
    BLINK_MS, BLINK_SLOW_MS, BLINK_MIN_MS, BLINK_SPAN_MS, HAPPY_MS, CELEBRATE_MS, SAD_MS, WINK_MS, RAMP_MS, WIDE_MS,
    LOOK_MAX, SAY_GROW_MS, SAY_HOLD_MS, SAY_SHRINK_MS,
  };
})();

if (typeof module !== 'undefined') module.exports = NotchEyes;
