// How the buddy moves: pure functions of time, so they can be tested in Node
// and the page only has to apply them. Times are in seconds; lift is a
// fraction of the model's height; angles are radians.

// How often the page draws. The cost is mostly a fixed price per frame, whatever
// is on it, so the buddy draws as seldom as it can without looking jerky:
//   FPS        30  a mood, a press or a drag, a mood easing in, and around each blink: what has
//                  to look smooth;
//   IDLE_FPS   15  the head following the pointer, until 10 s after it last turned, and the 10 s
//                  after a mood (not a fidget) or a press: slower is fine for a head that is only
//                  turning. Also a drowsy buddy once it has yawned;
//   REST_FPS    6  nothing has happened for 10 s: only the slow float and the occasional
//                  blink are left;
//   SLEEP_FPS   4  asleep: only the slow breathing is left. Sleeping eyes do not blink and a
//                  sleeping head does not follow the pointer.
export const FPS = 30;
export const IDLE_FPS = 15;
export const REST_FPS = 6;
export const SLEEP_FPS = 4;

// A blink is drawn at the full rate from its first frame. At rest frames are
// 1 / REST_FPS apart, so look that far ahead: the frame before a blink starts
// always sees it coming (see blinker.soon). Asleep they are further apart, but
// then the eyes do not blink.
export const BLINK_LOOKAHEAD = 1 / REST_FPS;

const SETTLE_SECONDS = 10; // how long the settling rate lasts, before the rest rate
const YAWN = 1.6; // drowsy starts with a yawn this long, drawn at the full rate

/**
 * Does the buddy need the full rate? A mood, or a press or a drag. A blink is not
 * counted: it is brief, and foreseen by blinker.soon(). Nor is the head turning:
 * following the pointer looks fine at the settling rate. Nor are drowsy, once it has
 * yawned, and asleep: they have slow rates of their own (see fpsFor). `since` is
 * seconds since the mood started; without it, the mood has just started.
 */
export function isActive({ mood, since = 0, pressing }) {
  if (pressing) return true;
  if (mood === 'drowsy') return since < YAWN;
  return mood !== 'idle' && mood !== 'asleep';
}

/**
 * Does this start the settling rate's 10 s again (sinceActive in fpsFor)? As isActive() says,
 * but a fidget does not, unless the buddy is pressed during it: a fidget is drawn at the full
 * rate while it plays, but one every 15 to 25 s would otherwise keep an idle buddy at the
 * settling rate for good, instead of resting.
 */
export function countsAsActive({ mood, since = 0, pressing }) {
  if (pressing) return true;
  return !FIDGETS.includes(mood) && isActive({ mood, since, pressing });
}

/**
 * How many frames a second to draw. `since` is seconds since the mood started; `easing`
 * says the mood is still easing in from the pose before it (blend.js), which is drawn at the
 * full rate whatever the mood, so that it does not ease in steps; `blinkSoon` is
 * blinker.soon(); `sinceLookChange` is seconds since the head last turned; `sinceActive` is
 * seconds since countsAsActive() was last true. Unless pressed, asleep and drowsy keep their
 * own rates whatever the blinker says: their eyes are not the open ones that blink.
 */
export function fpsFor({ mood, since = 0, pressing, easing, sinceLookChange, blinkSoon, sinceActive }) {
  if (easing) return FPS;
  if (!pressing && mood === 'asleep') return SLEEP_FPS;
  if (!pressing && mood === 'drowsy') return since < YAWN ? FPS : IDLE_FPS;
  if (blinkSoon || isActive({ mood, since, pressing })) return FPS;
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
const mix = (from, to, k) => from + (to - from) * k;

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

// The eye shapes a pose can ask for, 0 to 1. Each reshapes both eyes, as the blink does.
const EYE_SHAPES = ['smile', 'heart', 'swirl', 'sad', 'half', 'sleep'];

/**
 * How shut the eyes are, 0 (open) to 1 (shut): fully shut when the pose closes them, else
 * the blinker's value, but only on the plain open eyes. Every other shape (the happy "∩",
 * hearts, swirls, sad, half shut, asleep) reshapes the same eye as the blink, and on top of
 * each other they tear it, so those eyes never blink.
 */
export function blinkWeight(pose, blink) {
  if (pose.eyesClosed) return 1;
  return EYE_SHAPES.some((shape) => pose[shape] > 0) ? 0 : blink;
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

// A pose, here at rest. The angles add to the model's own: headTilt rolls the head,
// headPitch tips it forward (down), headYaw turns it; armL and armR raise the arms out
// from the sides. smile, mouthO and the eye shapes are 0 to 1, and eyesClosed shuts the
// eyes outright (see blinkWeight). glow and ears multiply the glow of the eyes and of the
// ear rims; look is how far the head follows the pointer, 0 to 1; float scales the idle
// float. effect names the symbols to show over the buddy, or is null.
//
// At 1 the ear rims already glow near the top of the page's tone curve (buddy.js): more glow
// mostly makes them paler, and less dims them a lot. Measured on screen: 0.5 looks almost as
// 1 does, 0.2 is a darker amber, and from 4 up they get hardly brighter, only whiter.
const REST = Object.freeze({
  lift: 0, scaleX: 1, scaleY: 1, headTilt: 0, headPitch: 0, headYaw: 0, armL: 0, armR: 0, smile: 0, mouthO: 0,
  eyesClosed: false, eyeL: 0, eyeR: 0, heart: 0, swirl: 0, sad: 0, half: 0, sleep: 0, glow: 1, ears: 1, look: 1,
  float: 1, effect: null, done: false,
});

// The curves the feelings are made of. A feeling starts from the rest pose (or from where
// the mood before it leaves off) and a timed one ends exactly in it, so nothing snaps when
// one mood gives way to the next.

/** 0 up to x = 0, 1 from x = 1, and an S-curve between: it leaves 0 and arrives at 1 gently. */
function ease(x) {
  const k = clamp(x, 0, 1);
  return k * k * (3 - 2 * k);
}

/**
 * Up from 0 to 1 and back down to 0, an S-curve each way. `rising` and `falling` are how far along the way up and
 * the way down it is, from 0 (not started) to 1 (done), as ease takes it.
 */
function upThenDown(rising, falling) {
  return Math.min(ease(rising), 1 - ease(falling));
}

/** Up from 0 to 1 over the first `rise` seconds, and back to 0 over the last `fall` seconds of `length`. */
function fadeInOut(since, length, rise, fall) {
  return upThenDown(since / rise, (since - length + fall) / fall);
}

/** A swell from `start` to `end`: 0 at both, 1 halfway, and gentle at both ends (a sine squared). */
function hump(since, start, end) {
  if (since <= start || since >= end) return 0;
  return Math.sin((Math.PI * (since - start)) / (end - start)) ** 2;
}

/** Off the ground from `up` to `down` on a thrown ball's arc: 0, 1 halfway, and 0 again. */
function arc(since, up, down) {
  const k = (since - up) / (down - up);
  return k > 0 && k < 1 ? 4 * k * (1 - k) : 0;
}

/** A quick shake from `start` to `end`, `hz` times a second, dying away to nothing at `end`. */
function shake(since, start, end, hz) {
  if (since <= start || since >= end) return 0;
  return Math.sin(2 * Math.PI * hz * (since - start)) * (1 - ease((since - start) / (end - start)));
}

/** The body squashed by `k` (0.05: 5 % shorter; below 0: taller), and wider by half as much with it. */
function bodyScale(k) {
  return { scaleY: 1 - k, scaleX: 1 + k / 2 };
}

// Drowsy gives way to asleep, and asleep to wake. Each starts where the one before it
// leaves the head, the glow and the float, so the hand-overs do not jump.
const DROWSY_PITCH = 0.08;
const DROWSY_FLOAT = 0.6;
const SLEEP_PITCH = 0.22;
const SLEEP_GLOW = 0.5; // the eyes, asleep
const SLEEP_EARS = 0.2; // the ear rims, asleep: at half they would hardly look dimmer (see REST)
const SLEEP_FLOAT = 0.5;

// sad: droopy eyes, the head and the arms down, and one sigh: a small breath in, then the
// body sinks to 97 % around 1 s and comes back by 1.5 s. The eyes come over 0.4 s and go
// over the last 0.3 s; the head and the arms are a little slower.
const SAD = 2.5;
function sad(since) {
  const down = fadeInOut(since, SAD, 0.6, 0.5);
  const sink = 0.03 * hump(since, 0.5, 1.5) - 0.012 * hump(since, 0.1, 0.7);
  return {
    ...REST, sad: fadeInOut(since, SAD, 0.4, 0.3), headPitch: 0.18 * down, armL: -0.1 * down, armR: -0.1 * down,
    ...bodyScale(sink), effect: 'drop', done: since >= SAD,
  };
}

// drowsy: first the yawn. The mouth opens wide by 0.5 s, stays and is shut again by 1.55 s;
// the head tips back and the body stretches with it, and the arms go out a little. The lids
// come down to half, then the eyes squeeze shut from 0.2 to 1.4 s and open only halfway.
// Then the half-shut eyes, the head a little down and a slower float, until it falls asleep
// or is used.
function drowsy(since) {
  const yawn = upThenDown(since / 0.5, (since - 1.05) / 0.5);
  const arms = 0.5 * upThenDown((since - 0.1) / 0.5, (since - 1) / 0.5);
  const shut = since >= 0.2 && since < 1.4;
  return {
    ...REST,
    mouthO: yawn, armL: arms, armR: arms, scaleY: 1 + 0.03 * yawn, scaleX: 1 - 0.015 * yawn,
    headPitch: -0.08 * yawn + DROWSY_PITCH * ease((since - 1) / 0.6),
    eyesClosed: shut, half: shut ? 0 : ease(since / 0.2),
    float: mix(1, DROWSY_FLOAT, ease(since / YAWN)),
  };
}

// asleep: the sleeping "◡" eyes, the head down, slow breathing (a breath every 4 s), the
// glow of the eyes at half and the ear rims dim, the head no longer following the pointer,
// and less float. It starts as drowsy leaves off: the half-shut eyes close into the sleeping
// ones over 0.6 s, and the rest settles over 2.5 s, slowly, because only SLEEP_FPS frames a
// second show it.
function asleep(since) {
  const closing = ease(since / 0.6);
  const settled = ease(since / 2.5);
  return {
    ...REST,
    half: 1 - closing, sleep: closing,
    headPitch: mix(DROWSY_PITCH, SLEEP_PITCH, settled),
    scaleY: 1 + 0.02 * Math.sin((2 * Math.PI * since) / 4),
    glow: mix(1, SLEEP_GLOW, settled), ears: mix(1, SLEEP_EARS, settled), look: 1 - settled,
    float: mix(DROWSY_FLOAT, SLEEP_FLOAT, settled),
    effect: 'z',
  };
}

// wake: the eyes stay shut for 0.25 s, then open through half open, so they do not pop. Both
// arms stretch up, the body tall and the head back: up by 0.53 s, held a moment, and down by
// 0.85 s. Then a little shake of the head that dies away by the end. It starts where asleep
// leaves off (the head down, the glow at half, not following the pointer, less float) and is
// back from all of it by the end.
const WAKE = 1.2;
function wake(since) {
  const stretch = upThenDown((since - 0.25) / 0.28, (since - 0.59) / 0.26);
  const shut = since < 0.25;
  return {
    ...REST,
    eyesClosed: shut, half: shut ? 0 : 1 - ease((since - 0.25) / 0.15),
    armL: 2.4 * stretch, armR: 2.4 * stretch, scaleY: 1 + 0.06 * stretch, scaleX: 1 - 0.025 * stretch,
    headPitch: SLEEP_PITCH * (1 - ease(since / 0.5)) - 0.08 * stretch,
    headYaw: 0.12 * shake(since, 0.85, WAKE, 4),
    glow: mix(SLEEP_GLOW, 1, ease((since - 0.15) / 0.35)), ears: mix(SLEEP_EARS, 1, ease(since / 0.5)),
    look: ease((since - 0.3) / 0.8), float: mix(SLEEP_FLOAT, 1, ease(since / WAKE)),
    done: since >= WAKE,
  };
}

// love: heart eyes and a gentle sway of the head, while small hearts rise.
const LOVE = 2;
function love(since) {
  return {
    ...REST,
    heart: fadeInOut(since, LOVE, 0.2, 0.25),
    headTilt: 0.1 * Math.sin(4 * since) * fadeInOut(since, LOVE, 0.3, 0.5),
    effect: 'hearts', done: since >= LOVE,
  };
}

// dizzy: swirl eyes and a dazed "o" mouth. It comes after a shaken drag, so the mouth starts
// open as wobble left it. The head circles, 9 radians a second, until 1.6 s; then it shakes
// it off while the swirls fade. Stars circle above.
const DIZZY = 2;
function dizzy(since) {
  const circling = upThenDown(since / 0.3, (since - 1.25) / 0.35);
  return {
    ...REST,
    swirl: fadeInOut(since, DIZZY, 0.2, 0.3),
    headTilt: 0.12 * circling * Math.sin(9 * since), headPitch: 0.08 * circling * Math.cos(9 * since),
    headYaw: 0.15 * shake(since, 1.6, DIZZY, 4),
    mouthO: mix(0.5, 0.3, ease(since / 0.4)) * (1 - ease((since - 1.6) / 0.4)),
    effect: 'stars', done: since >= DIZZY,
  };
}

// celebrate: a jump with happy eyes and both arms up. A quick crouch, off the ground from
// 0.12 to 0.6 s and 0.15 of its height up (stretched a little in the air), the arms up by
// the top of the jump, a squash on landing, then the arms come down. Sparkles.
const CELEBRATE = 1.6;
function celebrate(since) {
  const air = arc(since, 0.12, 0.6);
  const squash = 0.05 * hump(since, 0, 0.16) + 0.08 * hump(since, 0.6, 0.95) - 0.04 * air;
  const arms = 2.1 * upThenDown(since / 0.3, (since - 0.7) / 0.9);
  return {
    ...REST,
    lift: 0.15 * air, ...bodyScale(squash),
    smile: fadeInOut(since, CELEBRATE, 0.15, 0.25), armL: arms, armR: arms,
    effect: 'sparkles', done: since >= CELEBRATE,
  };
}

// listening: the head tilted as if leaning in, the eyes a little up, and the ear rims dim
// while it is quiet and bright with the voice (`level`, 0 to 1): QUIET_EARS in silence, and
// VOICE_EARS more at a voice of 1 (see REST: higher, they only get paler). They start at
// rest and dim as it leans in. The head follows the pointer only halfway, so the lean stays.
// Until the microphone stops.
const QUIET_EARS = 0.3;
const VOICE_EARS = 4;
function listening(since, level) {
  const leaning = ease(since / 0.4);
  const voice = clamp(level, 0, 1) || 0; // a level that is not a number counts as silence
  return {
    ...REST,
    headTilt: 0.14 * leaning, headPitch: -0.04 * leaning, eyeL: 0.15 * leaning, eyeR: 0.15 * leaning,
    ears: mix(1, QUIET_EARS + VOICE_EARS * voice, leaning), look: 1 - 0.5 * leaning,
  };
}

// The fidgets: small things a bored buddy does now and then (see createFidgeter).

// look: a glance to one side, a pause, a glance to the other side, a pause, and back,
// each glance easing in and out; meanwhile the head does not follow the pointer.
const LOOK = 2;
function lookAround(since) {
  const glances = ease(since / 0.45) - 2 * ease((since - 0.75) / 0.5) + ease((since - 1.5) / 0.5);
  return { ...REST, headYaw: 0.35 * glances, look: 1 - fadeInOut(since, LOOK, 0.3, 0.3), done: since >= LOOK };
}

// swing: the arms swing in turn, one going up as the other comes down, 1.3 times a second,
// dying away; the head sways a little with them. An arm comes in at most 0.1 from where it
// rests, as sad's do, so it stays clear of the body.
const SWING = 1.5;
function swing(since) {
  const strength = ease(since / 0.35) * (1 - ease((since - 0.35) / 1.15));
  const beat = Math.sin(2 * Math.PI * 1.3 * since);
  return {
    ...REST,
    armL: strength * (0.35 + 0.45 * beat), armR: strength * (0.35 - 0.45 * beat), headTilt: -0.04 * strength * beat,
    done: since >= SWING,
  };
}

// hum: happy eyes and a gentle sway, once a second, while notes rise.
const HUM = 2;
function hum(since) {
  return {
    ...REST,
    smile: fadeInOut(since, HUM, 0.2, 0.25),
    headTilt: 0.08 * Math.sin(2 * Math.PI * since) * fadeInOut(since, HUM, 0.3, 0.4),
    effect: 'notes', done: since >= HUM,
  };
}

// hop: a quick crouch, one small hop (off the ground from 0.15 to 0.5 s, 0.06 of its height
// up) and a squash on landing.
const HOP = 0.8;
function hop(since) {
  const air = arc(since, 0.15, 0.5);
  const squash = 0.05 * hump(since, 0, 0.2) + 0.06 * hump(since, 0.5, 0.75) - 0.03 * air;
  return { ...REST, lift: 0.06 * air, ...bodyScale(squash), done: since >= HOP };
}

/**
 * The pose for a mood, `since` seconds after it started. `level` is how loud the voice
 * is while listening, 0 to 1. `done` means: go back to idle.
 */
export function moodPose(name, since, { level = 0 } = {}) {
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
    case 'wobble':
      return { ...REST, headTilt: 0.15 * Math.sin(since * 18), mouthO: 0.5 };
    case 'sad':
    case 'sleepy': // the app sends this for "no internet": the sad pose now
      return sad(since);
    case 'drowsy':
      return drowsy(since);
    case 'asleep':
      return asleep(since);
    case 'wake':
      return wake(since);
    case 'love':
      return love(since);
    case 'dizzy':
      return dizzy(since);
    case 'celebrate':
      return celebrate(since);
    case 'listening':
      return listening(since, level);
    case 'look':
      return lookAround(since);
    case 'swing':
      return swing(since);
    case 'hum':
      return hum(since);
    case 'hop':
      return hop(since);
    case 'idle':
      return REST;
    default:
      // A name this page does not know (a newer app's mood, or a typo): back to idle at once,
      // rather than drawing the rest pose at the full rate for as long as it lasts.
      return { ...REST, done: true };
  }
}

// Bored fidgets: while the buddy is awake and idle, one small action every 15-25 s.
export const FIDGETS = ['look', 'swing', 'hum', 'hop'];

/**
 * When to fidget. reset(t) starts the wait again from t: the next fidget is due 15-25 s
 * later. take(t) returns null until then; from then on, the name of a fidget, and the
 * next wait starts from t. Until the first reset, the wait runs from time 0, when the page's
 * clock starts.
 */
export function createFidgeter(random = Math.random) {
  let next;
  const reset = (t) => {
    next = t + 15 + random() * 10;
  };
  reset(0);
  return {
    reset,
    take(t) {
      if (t < next) return null;
      const name = FIDGETS[Math.floor(random() * FIDGETS.length)];
      reset(t);
      return name;
    },
  };
}
