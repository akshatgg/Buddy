'use strict';
/* global NotchEyes */

/*
 * The notch page: Buddy's eyes either side of the camera. Main sends the layout (the notch's size and the sizes
 * of the wings), the mood, what Buddy says, whether to pause, and where the pointer is from the window's centre;
 * this page draws the black shape, the eyes and the text, and tells main when the pointer is over the shape and
 * when it is clicked. The shapes and timings come from eyes.js; this file puts them on the screen.
 *
 * One timer draws the frames: at 30 fps while something moves (a mood, a blink, the text's wing, the eyes opening
 * wider) and 2 fps when nothing does, waking early for the next blink; none at all while paused.
 */

const $ = (id) => document.getElementById(id);
const { createEyes, saying, SAY_GROW_MS } = NotchEyes;

const FPS = 30;
const IDLE_FPS = 2;
const EYE_HEIGHT = 14; // points; up to 2 more when the eyes open wider
const EYE_WIDER = 2;
const SHUT_HEIGHT = 2; // a shut eye is a line this thick
const DROOP_DEPTH = 45; // % of the eye's height the outer top drops by, sad
const SAY_IN = 10; // the text starts this far inside the wing, beside the eye
const SAY_PAD = 14; // and ends this far before the wing's edge

const shape = $('shape');
const wings = { left: $('left'), right: $('right') };
const eyeEls = {
  left: { eye: $('eye-left'), ball: $('eye-left').querySelector('.ball'), arch: $('eye-left').querySelector('.arch'), curl: $('eye-left').querySelector('.curl') },
  right: { eye: $('eye-right'), ball: $('eye-right').querySelector('.ball'), arch: $('eye-right').querySelector('.arch'), curl: $('eye-right').querySelector('.curl') },
};
const dot = $('eye-right').querySelector('.dot');
const say = $('say');
const ruler = $('ruler');

const eyes = createEyes();
const now = () => performance.now();

let layout = null; // what main sent: notchWidth, notchHeight, reach, drop, wing, wingHover, sayMax, corner
let timer = null; // the one pending frame; null while the loop is paused
let paused = false;
let hovering = false;
let talk = null; // { since, from, to }: the text's wing, growing from `from` to `to` points since `since`
let sayWidth = 0; // the text's wing as last drawn, so a new text grows on from there
let box = { left: 0, width: 0, height: 0 }; // the shape as last drawn, for the hover test

/** Draw one frame at `t`. Returns whether something is still moving, and when the next thing is due if not. */
function draw(t) {
  const f = eyes.frame(t);
  let s = talk ? saying(talk.to, t - talk.since) : null;
  if (s?.done) {
    talk = null;
    s = null;
    say.hidden = true;
    say.textContent = '';
  }
  if (s) {
    const growing = t - talk.since < SAY_GROW_MS;
    sayWidth = growing || s.hold ? talk.from + (talk.to - talk.from) * s.grow : s.width;
    say.style.opacity = s.grow;
  } else {
    sayWidth = 0;
  }

  const wing = layout.wing + (layout.wingHover - layout.wing) * f.wide;
  const height = layout.notchHeight + f.bounce * layout.drop;
  box = { left: layout.reach - wing, width: 2 * wing + layout.notchWidth + sayWidth, height };
  shape.style.left = `${box.left}px`;
  shape.style.width = `${box.width}px`;
  shape.style.height = `${height}px`;
  wings.left.style.width = `${wing}px`;
  wings.right.style.width = `${wing + sayWidth}px`;
  say.style.left = `${wing - SAY_IN}px`;

  for (const side of ['left', 'right']) {
    const e = f[side];
    const el = eyeEls[side];
    const closed = Math.max(e.arch, e.curl);
    el.ball.style.height = `${Math.max(SHUT_HEIGHT, (EYE_HEIGHT + EYE_WIDER * f.wide) * e.open)}px`;
    el.ball.style.opacity = 1 - closed;
    el.arch.style.opacity = e.arch;
    el.curl.style.opacity = e.curl;
    // Sad: the outer top of each eye is cut down at a slant; the eye's rotation tilts the rest.
    const droop = e.droop * DROOP_DEPTH;
    el.ball.style.clipPath = e.droop === 0 ? 'none'
      : side === 'left' ? `polygon(0 ${droop}%, 100% 0, 100% 100%, 0 100%)` : `polygon(0 0, 100% ${droop}%, 100% 100%, 0 100%)`;
    el.eye.style.left = `${wing / 2}px`;
    el.eye.style.transform = `translate(${f.look.x}px, ${f.look.y}px) rotate(${e.tilt}deg)`;
  }
  dot.style.opacity = f.dot;

  const active = f.active || s !== null;
  return { active, nextIn: f.nextIn };
}

function tick() {
  const { active, nextIn } = draw(now());
  const wait = active ? 1000 / FPS : Math.min(1000 / IDLE_FPS, Math.max(1000 / FPS, nextIn));
  timer = setTimeout(tick, wait);
}

function startLoop() {
  if (timer === null && layout && !paused) tick();
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

function setHover(over) {
  if (over === hovering) return;
  hovering = over;
  window.notch.hover(over);
  eyes.setHover(over);
  wake();
}

window.addEventListener('mousemove', (e) => {
  if (layout) setHover(overShape(e.clientX, e.clientY));
});
document.addEventListener('mouseleave', () => setHover(false));
shape.addEventListener('click', () => window.notch.click());

window.notch.onLayout((next) => {
  layout = next;
  shape.style.setProperty('--corner', `${layout.corner}px`);
  $('notch').style.width = `${layout.notchWidth}px`;
  shape.hidden = false;
  draw(now());
  window.__notchReady = true;
  startLoop();
});

window.notch.onMood((name) => {
  document.body.dataset.mood = name;
  eyes.setMood(name, now());
  wake();
});

window.notch.onSay((text) => {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (!line) {
    // Nothing to say: a text that is out goes back in now.
    if (talk) talk.since = Math.min(talk.since, now() - SAY_GROW_MS - NotchEyes.SAY_HOLD_MS);
    wake();
    return;
  }
  if (!layout) return;
  ruler.textContent = line;
  // The wing grows by the text's width, less what overlaps the wing and plus the room after it, up to sayMax.
  const to = Math.min(Math.ceil(ruler.offsetWidth) - SAY_IN + SAY_PAD, layout.sayMax);
  say.textContent = line;
  say.style.width = `${to + SAY_IN - SAY_PAD}px`;
  say.hidden = false;
  // A new text replaces the old one and starts over: the wing grows on from wherever it is now.
  talk = { since: now(), from: sayWidth, to };
  wake();
});

window.notch.onCursor(({ dx, dy }) => {
  if (eyes.setLook(dx, dy)) wake();
});

window.notch.onPause((on) => {
  paused = on;
  if (on) stopLoop();
  else startLoop();
});
