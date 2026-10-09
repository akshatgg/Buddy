// Clawd with the buddy while Claude Code works: Claude Code's little orange pixel critter walks back and forth, and the
// buddy's face stays its own and watches it. Where it walks is the admin's choice (Admin → Claude Code, the server's
// clawdLook), one of LOOKS: on top of the buddy's head beside its sprout, the buddy looking up at it ('head'), or along
// the bottom of its face screen under the eyes, the buddy looking down at it ('face'). Clawd reacts as it does in the notch: it walks while Claude works, stops in the middle
// and waves when Claude needs the person, and when the work ends it hops with happy eyes (done) or droops (failed) for
// a moment, then goes. Pure: buddy.js (and the phone's Clawd.kt) draw what this says.

// The critter on a 12 × 8 grid ('X' is orange): the frames it moves through. The eyes are drawn on top (EYES).
const BODY = [
  '..XXXXXXXX..',
  '..XXXXXXXX..',
  'XXXXXXXXXXXX',
  'XXXXXXXXXXXX',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
];
const WAVE_BODY = [
  '..XXXXXXXXXX',
  '..XXXXXXXXXX',
  'XXXXXXXXXX..',
  'XXXXXXXXXX..',
  '..XXXXXXXX..',
  '..XXXXXXXX..',
];
const LEGS = {
  stand: ['..X.X..X.X..', '..X.X..X.X..'],
  walkA: ['..X.X..X.X..', '..X....X....'],
  walkB: ['..X.X..X.X..', '....X....X..'],
};

export const COLUMNS = 12;
export const ROWS = 8;
export const FRAMES = {
  stand: [...BODY, ...LEGS.stand],
  walkA: [...BODY, ...LEGS.walkA],
  walkB: [...BODY, ...LEGS.walkB],
  wave: [...WAVE_BODY, ...LEGS.stand],
};

// How each frame's eyes are drawn, in grid cells: open (two dark squares), happy (> <) or sad (two low dashes).
export const EYES = { open: 'open', happy: 'happy', sad: 'sad' };

export const STEP = 0.25; // seconds a step takes, walking
export const WAVE = 0.35; // seconds an arm stays up or down, waving
export const MOMENT = 3; // seconds done or failed shows before Clawd goes
const HOP = 0.45; // the happy hop, seconds
export const PACE = 0.9; // radians a second of the walk back and forth: there and back in about 7 s

/**
 * Where Clawd walks, in the head's own space (the face's is the same: the Face node sits at the Head's origin), the
 * same in every buddy (art/build_buddies.py), and how the buddy watches it there. `width` is Clawd's, `y` the middle of
 * its walk (its centre; on the head its feet stand on the shell at 1.02), `z` just in front of the head, `walk` how far
 * either side of the middle it goes; `turn` the radians the head turns at most following it, `tip` the radians it tips
 * (back is less), `look` the eyes' look (the eyeLUp and eyeRUp morphs: up is more). Both stay within the head's own
 * frame, so neither the Mac's camera nor the phone's needs room made for Clawd.
 */
export const LOOKS = Object.freeze({
  head: Object.freeze({ width: 0.3, y: 1.02 + 0.1, z: 0.42, walk: 0.34, turn: 0.18, tip: -0.08, look: 0.6 }),
  face: Object.freeze({ width: 0.21, y: 0.3, z: 0.535, walk: 0.2, turn: 0.22, tip: 0, look: -0.45 }),
});
export const DEFAULT_LOOK = 'head';

/** The look named `name`, or the default one for anything else. */
export function lookOf(name) {
  return Object.hasOwn(LOOKS, name) ? LOOKS[name] : LOOKS[DEFAULT_LOOK];
}

/**
 * What Clawd shows `since` seconds into a status (kind: working, needsYou, done or failed): the frame, its eyes, how
 * far it is lifted (in grid cells), where it is along its walk (`x`, -1 at the left end to 1 at the right) and which
 * way it faces (`facing`, 1 right, -1 left), and whether it shows at all. Any other kind, or a moment that is over,
 * shows nothing. `walk` is the seconds the walk has gone on, for where along it Clawd is (it is the page's clock, so
 * that a new status does not jump Clawd back to the middle); without it, `since`.
 */
export function clawdPose(kind, since, walk = since) {
  const t = Math.max(0, since);
  const still = { x: 0, facing: 1 };
  switch (kind) {
    case 'working': {
      const step = Math.floor(t / STEP) % 2;
      return {
        visible: true, frame: step ? 'walkB' : 'walkA', eyes: EYES.open, lift: step ? 0.5 : 0,
        x: Math.sin(PACE * walk), facing: Math.cos(PACE * walk) >= 0 ? 1 : -1,
      };
    }
    case 'needsYou':
      return { visible: true, frame: Math.floor(t / WAVE) % 2 ? 'wave' : 'stand', eyes: EYES.open, lift: 0, ...still };
    case 'done':
      if (t >= MOMENT) break;
      return { visible: true, frame: 'stand', eyes: EYES.happy, lift: t < 2 * HOP ? Math.abs(Math.sin((Math.PI * t) / HOP)) * 1.5 : 0, ...still };
    case 'failed':
      if (t >= MOMENT) break;
      return { visible: true, frame: 'stand', eyes: EYES.sad, lift: -0.5, ...still };
    default:
      break;
  }
  return { visible: false, frame: 'stand', eyes: EYES.open, lift: 0, ...still };
}

/**
 * How the buddy watches Clawd at `pose` in `look` (one of LOOKS): its head's turn toward it and tip (radians), its eyes'
 * look (morph weight), and how much it still follows the pointer (0 while it watches Clawd, 1 otherwise).
 */
export function watching(pose, look = LOOKS[DEFAULT_LOOK]) {
  return pose.visible ? { yaw: look.turn * pose.x, pitch: look.tip, look: look.look, follow: 0 } : { yaw: 0, pitch: 0, look: 0, follow: 1 };
}

/** Whether Clawd still moves at `since` (the page then draws at a rate that shows it). */
export function clawdMoving(kind, since) {
  return clawdPose(kind, since).visible;
}
