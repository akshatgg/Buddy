// Clawd in the buddy's eye: while a Claude Code session runs, Claude Code's little orange pixel critter takes the place
// of the buddy's right eye (as the viewer sees it) on its face screen, and the left eye stays the buddy's own. It
// reacts as it does in the notch: it walks while Claude works, waves when Claude needs the person, and when the work
// is done it is happy (done) or droops (failed) for a moment, then the eye comes back. Pure: buddy.js draws what this
// says, as a texture on a small plane over the eye.

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
export const MOMENT = 3; // seconds done or failed shows before the eye comes back
const HOP = 0.45; // the happy hop, seconds

/**
 * What Clawd shows `since` seconds into a status (kind: working, needsYou, done or failed): the frame, its eyes, how
 * far it is lifted (0 to 1, of a grid cell) and whether it shows at all. Any other kind, or a moment that is over,
 * shows nothing: the buddy's own eye is back.
 */
export function clawdPose(kind, since) {
  const t = Math.max(0, since);
  switch (kind) {
    case 'working': {
      const step = Math.floor(t / STEP) % 2;
      return { visible: true, frame: step ? 'walkB' : 'walkA', eyes: EYES.open, lift: step ? 0.5 : 0 };
    }
    case 'needsYou':
      return { visible: true, frame: Math.floor(t / WAVE) % 2 ? 'wave' : 'stand', eyes: EYES.open, lift: 0 };
    case 'done':
      if (t >= MOMENT) break;
      return { visible: true, frame: 'stand', eyes: EYES.happy, lift: t < 2 * HOP ? Math.abs(Math.sin((Math.PI * t) / HOP)) * 1.5 : 0 };
    case 'failed':
      if (t >= MOMENT) break;
      return { visible: true, frame: 'stand', eyes: EYES.sad, lift: -0.5 };
    default:
      break;
  }
  return { visible: false, frame: 'stand', eyes: EYES.open, lift: 0 };
}

/** Whether Clawd still moves at `since` (the page then draws at a rate that shows it). */
export function clawdMoving(kind, since) {
  return clawdPose(kind, since).visible;
}
