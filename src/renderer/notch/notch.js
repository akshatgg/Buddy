'use strict';
/* global NotchEyes */

/*
 * The notch page: Buddy either side of the camera. Main sends the layout (the notch's size, the sizes of the wings and
 * the look: Buddy's face or two eyes), the mood, what Buddy says, Claude Code's status, whether to pause, and where
 * the pointer is from the window's centre; this page draws the black shape, the eyes, the status and the words, and
 * tells main when the pointer is over the shape and when it is clicked. The face itself is face.js's (window.notchFace):
 * this page places its canvas in the left wing and tells it about the pointer on the shape. The eyes' shapes and
 * timings come from eyes.js.
 *
 * One timer draws the frames: at 30 fps while something moves (a mood, a blink, a look around, the words' wing, the
 * eyes opening wider) and 2 fps when nothing does, waking early for the next thing due; none at all while paused.
 */

const $ = (id) => document.getElementById(id);
const { createEyes, ease, SAY_GROW_MS, SAY_HOLD_MS } = NotchEyes;

const FPS = 30;
const IDLE_FPS = 2;
const EYE_HEIGHT = 14; // points; up to 2 more when the eyes open wider
const EYE_WIDER = 2;
const SHUT_HEIGHT = 2; // a shut eye is a line this thick
const DROOP_DEPTH = 45; // % of the eye's height the outer top drops by, sad
const SAY_IN = 10; // the words start this far inside the wing, beside the eye
const SAY_PAD = 14; // and end this far before the wing's edge
const ICON_ROOM = 24; // with the eyes, the status icon goes before the words, taking this much room
const FACE_INSET = 3; // points between the face and the top and bottom of the shape
const STATUS_FLASH_MS = 4000; // done and failed show this long
const LOVE_HOVER_MS = 1500; // the pointer resting on Buddy this long: love
const Z_SIDE = 6; // the "z" letters start this far right of Buddy's centre

const shape = $('shape');
const wings = { left: $('left'), right: $('right') };
const parts = (el) => ({
  eye: el, ball: el.querySelector('.ball'), arch: el.querySelector('.arch'), curl: el.querySelector('.curl'), heart: el.querySelector('.heart'),
});
const eyeParts = { left: parts($('eye-left')), right: parts($('eye-right')) };
const dot = $('eye-right').querySelector('.dot');
const say = $('say');
const icon = $('icon');
const zz = $('zz');
const face = $('face');
const ruler = $('ruler');

const eyes = createEyes();
const now = () => performance.now();
const NO_LINE = { key: null, text: '', width: 0, icon: false };

let layout = null; // what main sent: notchWidth, notchHeight, reach, drop, wing, wingHover, sayMax, corner, look
let timer = null; // the one pending frame; null while the loop is paused
let paused = false;
let hovering = false;
let loveTimer = null; // the pointer resting on Buddy: love when it fires
let talk = null; // what Buddy says: { text, until }
let work = null; // Claude Code's status: { kind, text, until } (until: Infinity for one that lasts)
let line = NO_LINE; // the words being shown, and the width their wing is growing or shrinking to
let sayWidth = 0; // the words' wing as last drawn
let lastDraw = null; // when the last frame was drawn, for the wing's easing
let box = { left: 0, width: 0, height: 0 }; // the shape as last drawn, for the hover test
let lastWide = 0; // how wide the eyes were last drawn: the wings follow it, with the face too

/** The face is showing (not the eyes): chosen, and drawn at least once (face.js). */
const faceOn = () => layout?.look === 'face' && document.body.classList.contains('face-ready');

/** The width the words take in the wing, after the eye (and the icon before them, with the eyes), up to sayMax. */
function lineWidth(text, withIcon) {
  ruler.textContent = text;
  const words = text ? Math.ceil(ruler.offsetWidth) - SAY_IN + SAY_PAD : 0;
  return Math.min(words + (withIcon ? ICON_ROOM + (text ? 0 : SAY_PAD - SAY_IN) : 0), layout.sayMax);
}

/** What the right wing should say at `t`: what Buddy says while it holds, else the status's words, else nothing. */
function wanted(t) {
  if (talk && t >= talk.until) talk = null;
  if (work && t >= work.until) work = null;
  if (talk) return { text: talk.text, icon: false };
  // Beside the eyes the icon needs room in the wing even with no words (done, failed); beside the face it has the
  // right eye's place.
  if (work && (work.text || !faceOn())) return { text: work.text, icon: !faceOn() };
  return null;
}

/** Draw one frame at `t`. Returns whether something is still moving, and when the next thing is due if not. */
function draw(t) {
  const dt = lastDraw === null ? 0 : t - lastDraw;
  lastDraw = t;
  const f = eyes.frame(t);
  if (f.done) document.body.dataset.mood = eyes.mood();

  // The words: the wing eases to the width of what is wanted now; the old words stay while it shrinks away.
  const want = wanted(t);
  if (want) {
    const key = `${want.icon ? 'icon:' : ''}${want.text}`;
    if (key !== line.key) {
      line = { key, text: want.text, width: lineWidth(want.text, want.icon), icon: want.icon };
      say.textContent = want.text;
      say.hidden = false;
    }
  } else if (line.key !== null) {
    line = { ...line, key: null, width: 0 };
  }
  sayWidth = ease(sayWidth, line.width, dt);
  if (sayWidth === 0 && !want && !say.hidden) {
    say.hidden = true;
    say.textContent = '';
    line = NO_LINE;
  }
  const easing = sayWidth !== line.width;
  say.style.opacity = Math.min(1, sayWidth / 30);

  const wing = layout.wing + (layout.wingHover - layout.wing) * f.wide;
  const height = layout.notchHeight + f.bounce * layout.drop;
  box = { left: layout.reach - wing, width: 2 * wing + layout.notchWidth + sayWidth, height };
  shape.style.left = `${box.left}px`;
  shape.style.width = `${box.width}px`;
  shape.style.height = `${height}px`;
  wings.left.style.width = `${wing}px`;
  wings.right.style.width = `${wing + sayWidth}px`;

  // The status icon: in the right eye's place beside the face; before the words beside the eyes, and hidden while
  // Buddy says something there.
  const withFace = faceOn();
  const showIcon = Boolean(work) && (withFace || !talk);
  icon.hidden = !showIcon;
  if (showIcon) {
    icon.dataset.kind = work.kind;
    icon.style.left = withFace ? `${wing / 2}px` : `${wing - SAY_IN + ICON_ROOM / 2 - 2}px`;
  }
  const iconBefore = line.icon && showIcon ? ICON_ROOM : 0;
  say.style.left = `${wing - SAY_IN + iconBefore}px`;
  say.style.width = `${Math.max(0, line.width + SAY_IN - SAY_PAD - (line.icon ? ICON_ROOM : 0))}px`;

  // The face's canvas is centred where the left eye is, and the "z" letters rise beside it.
  face.style.left = `${wing / 2 - parseFloat(face.style.width || 0) / 2}px`;
  zz.style.left = `${wing / 2 + Z_SIDE}px`;

  for (const side of ['left', 'right']) {
    const e = f[side];
    const el = eyeParts[side];
    const closed = Math.max(e.arch, e.curl, e.heart);
    el.ball.style.height = `${Math.max(SHUT_HEIGHT, (EYE_HEIGHT + EYE_WIDER * f.wide) * e.open)}px`;
    el.ball.style.opacity = 1 - closed;
    el.arch.style.opacity = e.arch;
    el.curl.style.opacity = e.curl;
    el.heart.style.opacity = e.heart;
    el.heart.style.transform = `scale(${0.6 + 0.4 * e.heart})`;
    // Sad: the outer top of each eye is cut down at a slant; the eye's rotation tilts the rest.
    const droop = e.droop * DROOP_DEPTH;
    el.ball.style.clipPath = e.droop === 0 ? 'none'
      : side === 'left' ? `polygon(0 ${droop}%, 100% 0, 100% 100%, 0 100%)` : `polygon(0 0, 100% ${droop}%, 100% 100%, 0 100%)`;
    el.eye.style.left = `${wing / 2}px`;
    el.eye.style.transform = `translate(${f.look.x}px, ${f.look.y}px) rotate(${e.tilt}deg)`;
  }
  dot.style.opacity = f.dot;
  document.body.classList.toggle('z', f.z);

  // Next due: the end of what Buddy says, or of a status that flashes.
  const due = Math.min(talk ? talk.until - t : Infinity, work ? work.until - t : Infinity);
  // With the face, the hidden eyes' own moves (a blink, thinking) need no frames: only the shape's (the wings
  // widening, the bounce) and the words' do. The face draws itself (face.js).
  const shapeMoves = f.wide !== lastWide || f.bounce > 0;
  lastWide = f.wide;
  const active = withFace ? shapeMoves || easing : f.active || easing;
  return { active, nextIn: withFace ? due : Math.min(f.nextIn, due) };
}

function tick() {
  const { active, nextIn } = draw(now());
  const wait = active ? 1000 / FPS : Math.min(1000 / IDLE_FPS, Math.max(1000 / FPS, nextIn));
  timer = setTimeout(tick, wait);
}

function startLoop() {
  if (timer === null && layout && !paused) {
    lastDraw = null; // no easing across a pause
    tick();
  }
}

function stopLoop() {
  clearTimeout(timer);
  timer = null;
}

/** Something has just happened: draw it now rather than at the end of a slow idle frame. Does nothing while paused. */
function wake() {
  if (timer === null) return;
  clearTimeout(timer);
  timer = setTimeout(tick, 0);
}

function overShape(x, y) {
  return x >= box.left && x < box.left + box.width && y >= 0 && y < box.height;
}

/** The pointer resting on Buddy a while, with nothing else going on: love (hearts, or the face's heart eyes). */
function love() {
  loveTimer = null;
  if (!hovering || paused || eyes.mood() !== 'idle') return;
  eyes.setMood('love', now());
  document.body.dataset.mood = 'love';
  window.notchFace?.love();
  wake();
}

function setHover(over) {
  if (over === hovering) return;
  hovering = over;
  window.notch.hover(over);
  eyes.setHover(over);
  window.notchFace?.hover(over);
  clearTimeout(loveTimer);
  loveTimer = over ? setTimeout(love, LOVE_HOVER_MS) : null;
  wake();
}

window.addEventListener('mousemove', (e) => {
  if (layout) setHover(overShape(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => setHover(false));
// A click on Clawd (Claude Code's status) opens Claude mode; anywhere else on the shape, the panel as usual.
shape.addEventListener('click', (e) => {
  if (work && !icon.hidden && e.target.closest('#icon')) window.notch.claude();
  else window.notch.click();
});

window.notch.onLayout((next) => {
  layout = next;
  document.body.dataset.look = layout.look === 'eyes' ? 'eyes' : 'face';
  eyes.setWander(layout.look === 'eyes'); // the eyes look around only when they are what shows
  shape.style.setProperty('--corner', `${layout.corner}px`);
  $('notch').style.width = `${layout.notchWidth}px`;
  const size = layout.notchHeight - 2 * FACE_INSET;
  Object.assign(face.style, { top: `${FACE_INSET}px`, width: `${size}px`, height: `${size}px` });
  line = { ...line, key: null }; // measured again: the new look may put the icon elsewhere
  shape.hidden = false;
  draw(now());
  window.__notchReady = true;
  startLoop();
});

window.notch.onMood((name) => {
  eyes.setMood(name, now());
  document.body.dataset.mood = eyes.mood();
  wake();
});

window.notch.onSay((text) => {
  const words = String(text ?? '').replace(/\s+/g, ' ').trim();
  // Nothing to say: words that are out go back in now. A new text replaces the old one, growing on from where it is.
  talk = words ? { text: words, until: now() + SAY_GROW_MS + SAY_HOLD_MS } : null;
  wake();
});

window.notch.onStatus((next) => {
  if (!next) {
    work = null;
  } else {
    const flash = next.kind === 'done' || next.kind === 'failed';
    work = { kind: next.kind, text: String(next.text ?? ''), until: flash ? now() + STATUS_FLASH_MS : Infinity };
  }
  wake();
});

window.notch.onCursor(({ dx, dy }) => {
  if (eyes.setLook(dx, dy)) wake();
});

window.notch.onPause((on) => {
  paused = on;
  if (on) setHover(false); // hidden: the pointer is not on it any more
  if (on) stopLoop();
  else startLoop();
});

// face.js says when the face shows or stops showing: the status icon and the words move with it.
window.addEventListener('notch-face', () => {
  line = { ...line, key: null };
  wake();
});
