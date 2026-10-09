'use strict';
/* global module */
/* exported NotchEyes */

/**
 * The notch page's eyes: what shape each eye has at a moment, for the mood main sent and the pointer's place, and
 * how the words beside the notch come and go. The page loads this as a script and draws what it says; the unit tests
 * require it. So it must stay free of the DOM. All times are in milliseconds (performance.now()).
 *
 * createEyes({ random, wander }) → { setMood(name, t), mood(), setLook(dx, dy), setHover(on), setWander(on), frame(t) }
 * frame(t) → { left, right, bounce, dot, wide, look, z, active, nextIn, done }:
 *   left, right: { open, arch, curl, heart, droop, tilt }: how open the eye is (0 shut, 1 open), how far it is the
 *     happy arch (∩), the sleeping smile (‿) or a heart (♥), how far its outer top droops, and its tilt in degrees;
 *   bounce: the celebrate bounce, 0 (resting) to 1 (the top of a bounce);
 *   dot: the thinking dot under the right eye, 0 (off) to 1;
 *   wide: how much wider the eyes are, hovered, listening or just woken, 0 to 1;
 *   look: { x, y } where the eyes look, in points (up to LOOK_MAX_X across and LOOK_MAX up or down);
 *   z: asleep, in its first Z_FOR_MS: the page shows "z" letters drifting up;
 *   active: something is moving, so the page draws at the full rate; nextIn: when it is not, the milliseconds until
 *     the next thing to draw (the next blink or look around), so the page can sleep until then;
 *   done: a timed mood (happy, celebrate, sad, wave, wake, love) just ended and the eyes are idle again.
 * Idle and left alone the eyes look around now and then (a glance each way, a look up, a double blink): FIDGETS.
 * ease(width, target, dt) → the width of the words' wing, dt ms later, as it grows or shrinks toward `target`.
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
  const LOOK_MAX = 2; // points, up or down
  const LOOK_MAX_X = 3; // points, across: the wing has more room that way
  const LOOK_SCALE = 1 / 200; // points of look per point of pointer distance
  const LOOK_EPSILON = 0.05; // a smaller change of the look is not worth drawing
  const YAWN_MS = 1600; // drowsy starts with a yawn: the eyes squeeze nearly shut and open half
  const WAKE_MS = 900; // woken: the eyes pop open wide, then settle
  const LOVE_MS = 1600; // hearts
  const Z_FOR_MS = 5 * 60 * 1000; // the "z" letters, only in the first 5 minutes of sleep (as the floating buddy's)
  const FIDGET_MIN_MS = 15_000; // idle and left alone, the eyes look around every 15 to 25 s
  const FIDGET_SPAN_MS = 10_000;
  const GLANCE_MS = 1500; // a look to one side, then the other
  const LOOK_UP_MS = 1200;
  const DOUBLE_BLINK_MS = 500;
  const FIDGETS = { glance: GLANCE_MS, up: LOOK_UP_MS, double: DOUBLE_BLINK_MS };
  const SAY_GROW_MS = 220;
  const SAY_HOLD_MS = 2600;
  const SAY_SHRINK_MS = 220;
  const EASE_MS = 70; // the words' wing eases toward its width with this time constant: most of the way in 220 ms
  const EASE_SNAP = 0.5; // points: nearer than this, it is there

  const TIMED = { happy: HAPPY_MS, celebrate: CELEBRATE_MS, sad: SAD_MS, wave: WINK_MS, wake: WAKE_MS, love: LOVE_MS };
  const KNOWN = ['idle', 'thinking', 'happy', 'celebrate', 'sad', 'sleepy', 'drowsy', 'asleep', 'wake', 'wave', 'listening', 'love'];
  const SLOW_BLINK = ['thinking', 'sleepy', 'drowsy'];
  const CLOSED = ['happy', 'celebrate', 'asleep', 'wave', 'love']; // moods that shape the eyes themselves: no blink on top
  const WIDE = ['listening'];

  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const easeOut = (k) => 1 - (1 - k) ** 3;

  const eye = () => ({ open: 1, arch: 0, curl: 0, heart: 0, droop: 0, tilt: 0 });

  /** The shape of the eyes for a mood, `elapsed` ms into it, before the blink. */
  function shape(mood, elapsed) {
    const left = eye();
    const right = eye();
    const ramp = clamp(elapsed / RAMP_MS, 0, 1);
    let bounce = 0;
    let dot = 0;
    let wide = 0; // wider eyes of the mood's own (woken)
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
      case 'drowsy': {
        // Half shut, after a yawn: the eyes squeeze nearly shut and open again, half.
        const yawn = elapsed < YAWN_MS ? Math.sin((Math.PI * elapsed) / YAWN_MS) : 0;
        left.open = right.open = (1 - 0.5 * clamp(elapsed / (YAWN_MS / 2), 0, 1)) * (1 - 0.85 * yawn);
        break;
      }
      case 'wake':
        wide = 1 - clamp(elapsed / WAKE_MS, 0, 1);
        break;
      case 'love':
        left.heart = right.heart = ramp;
        left.open = right.open = 1 - ramp;
        bounce = 0.35 * Math.abs(Math.sin((Math.PI * 2 * elapsed) / LOVE_MS));
        break;
      case 'asleep':
        left.curl = right.curl = ramp;
        left.open = right.open = 1 - ramp;
        break;
      default: // idle, listening
        break;
    }
    return { left, right, bounce, dot, wide, look };
  }

  /** A look-around `elapsed` ms in: where the eyes look, and a second blink's shut (double). */
  function fidgetShape(name, elapsed) {
    const k = clamp(elapsed / FIDGETS[name], 0, 1);
    const swing = Math.sin(Math.PI * k); // out and back
    switch (name) {
      case 'glance': // to one side over the first half, the other over the second
        return { look: { x: -LOOK_MAX_X * Math.sin(2 * Math.PI * k), y: 0 }, shut: 0 };
      case 'up':
        return { look: { x: LOOK_MAX_X * 0.5 * swing, y: -LOOK_MAX * swing }, shut: 0 };
      default: { // double: two quick blinks
        const half = (k * 2) % 1;
        return { look: null, shut: half < BLINK_SHUT ? half / BLINK_SHUT : 1 - (half - BLINK_SHUT) / (1 - BLINK_SHUT) };
      }
    }
  }

  /** `random` times the blinks, `wander` the look-arounds (tests pass their own). */
  function createEyes({ random = Math.random, wander = random } = {}) {
    let mood = 'idle';
    let since = 0;
    let look = { x: 0, y: 0 };
    let hovering = false;
    let next = null; // when the next blink starts; null until the first frame
    let wide = { from: 0, to: 0, since: -Infinity }; // the eyes opening wider, or back
    let fidget = null; // { name, since } while the eyes look around
    let nextFidget = null; // when they next do; null until the first frame, and again after anything happens
    let wandering = true; // look-arounds on (off while the face shows instead of the eyes)

    const wideTarget = () => (hovering || WIDE.includes(mood) ? 1 : 0);
    const fidgetWait = () => FIDGET_MIN_MS + wander() * FIDGET_SPAN_MS;

    /** A look-around, when one is due: only idle, not hovered. Anything else puts the next one off. */
    function fidgetAt(t) {
      if (mood !== 'idle' || hovering || !wandering) {
        fidget = null;
        nextFidget = null;
        return null;
      }
      if (nextFidget === null) nextFidget = t + fidgetWait();
      if (fidget && t - fidget.since >= FIDGETS[fidget.name]) {
        fidget = null;
        nextFidget = t + fidgetWait();
      }
      if (!fidget && t >= nextFidget) {
        const names = Object.keys(FIDGETS);
        const name = names[Math.floor(wander() * names.length) % names.length];
        // From when it was due (the page wakes for it), unless that is past: then from now, whole.
        fidget = { name, since: t - nextFidget < FIDGETS[name] ? nextFidget : t };
      }
      return fidget ? fidgetShape(fidget.name, t - fidget.since) : null;
    }

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
        const next = KNOWN.includes(name) ? name : 'idle';
        // The same lasting mood again (thinking while Claude Code works, say) goes on as it was.
        if (next === mood && !(next in TIMED)) return;
        mood = next;
        since = t;
      },
      mood: () => mood,
      /** The pointer's place from the window's centre, in points. True when the eyes turn by enough to draw. */
      setLook(dx, dy) {
        const x = clamp(dx * LOOK_SCALE, -LOOK_MAX_X, LOOK_MAX_X);
        const y = clamp(dy * LOOK_SCALE, -LOOK_MAX, LOOK_MAX);
        const changed = Math.abs(x - look.x) > LOOK_EPSILON || Math.abs(y - look.y) > LOOK_EPSILON;
        if (changed) look = { x, y };
        return changed;
      },
      setHover(on) {
        hovering = on;
      },
      /** Whether the eyes look around on their own: not while they are not shown. */
      setWander(on) {
        wandering = Boolean(on);
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
        const f = fidgetAt(t);
        if (!CLOSED.includes(mood)) {
          const shut = Math.max(b.shut, f?.shut ?? 0);
          s.left.open *= 1 - shut;
          s.right.open *= 1 - shut;
        }
        if (wide.to !== wideTarget()) {
          wide = { from: wideValue(t), to: wideTarget(), since: t };
        }
        const widening = t - wide.since < WIDE_MS;
        // The other ramps are in timed moods, active anyway; drowsy's yawn is the one more.
        const closing = (mood === 'asleep' && elapsed < RAMP_MS) || (mood === 'drowsy' && elapsed < YAWN_MS);
        const active = mood in TIMED || mood === 'thinking' || closing || b.shut > 0 || widening || f !== null;
        const due = nextFidget === null ? Infinity : nextFidget - t;
        return {
          left: s.left,
          right: s.right,
          bounce: s.bounce,
          dot: s.dot,
          wide: Math.max(wideValue(t), s.wide),
          look: s.look ?? f?.look ?? look,
          z: mood === 'asleep' && elapsed < Z_FOR_MS,
          active,
          nextIn: active ? 0 : Math.min(b.nextIn, due),
          done,
        };
      },
    };

    function wideValue(t) {
      const k = clamp((t - wide.since) / WIDE_MS, 0, 1);
      return wide.from + (wide.to - wide.from) * easeOut(k);
    }
  }

  /**
   * The width of the words' wing `dt` ms after it was `width`, on its way to `target`: most of the way in SAY_GROW_MS,
   * and there once within EASE_SNAP. What is said holds SAY_HOLD_MS once out (the page times it).
   */
  function ease(width, target, dt) {
    const next = width + (target - width) * (1 - Math.exp(-Math.max(0, dt) / EASE_MS));
    return Math.abs(target - next) < EASE_SNAP ? target : next;
  }

  return {
    createEyes, ease,
    BLINK_MS, BLINK_SLOW_MS, BLINK_MIN_MS, BLINK_SPAN_MS, HAPPY_MS, CELEBRATE_MS, SAD_MS, WINK_MS, RAMP_MS, WIDE_MS,
    LOOK_MAX, LOOK_MAX_X, YAWN_MS, WAKE_MS, LOVE_MS, Z_FOR_MS, FIDGET_MIN_MS, FIDGET_SPAN_MS, FIDGETS,
    SAY_GROW_MS, SAY_HOLD_MS, SAY_SHRINK_MS,
  };
})();

if (typeof module !== 'undefined') module.exports = NotchEyes;
