// The small symbols that show how the buddy feels: "z" letters while it sleeps, hearts
// when it is petted, stars circling when it is dizzy, sparkles when it celebrates, notes
// when it hums and a sweat drop when it is sad. They are page elements over the canvas,
// moved by CSS (symbols.css) so they stay smooth while the buddy itself draws only a few
// frames a second. particlesFor() says what to show and is pure, for the tests;
// createSymbols() puts it on the page.

export const EFFECTS = ['z', 'hearts', 'stars', 'sparkles', 'notes', 'drop'];

const particle = (kind, delay, x, y, scale) => Object.freeze({ kind, delay, x, y, scale });

// The stars' ring around the top of the head, in head widths: its centre's height, its
// half-width and half-height, and how long one turn takes (seconds). The orbit keyframes
// and the stars' duration in symbols.css trace the same ring; a test checks that they do.
export const RING = Object.freeze({ y: -0.05, a: 0.42, b: 0.09, turn: 1.2 });

/**
 * Star i of n, evenly round the ring from a twelfth of a turn past its right end (the
 * orbit's start), so they start front right, front left and at the back, above the
 * sprout or the bow. That is also where they stay when motion is reduced.
 */
function star(i, n) {
  const turn = 1 / 12 + i / n;
  const angle = 2 * Math.PI * turn;
  const round = (v) => Math.round(v * 1000) / 1000;
  // A negative delay starts the star part of the way round, as a CSS animation-delay does.
  return particle('star', round(-turn * RING.turn), round(RING.a * Math.cos(angle)),
    round(RING.y + RING.b * Math.sin(angle)), 1);
}

// The "z" letters of a sleeping buddy do not loop. A running animation keeps the window
// drawing at the display's rate (60 to 120 frames a second) while the buddy itself needs 4,
// and asleep lasts as long as nobody uses the buddy, hours perhaps. So the letters rise in
// one burst, end and are removed, and then nothing animates until a timer (createSymbols)
// starts the next burst. In seconds:
/** One letter, from fading in to gone: the animation-duration of .buddy-symbol--z in symbols.css (a test checks they match). */
export const Z_LETTER = 2.5;
/** From the start of one burst to the start of the next. */
export const Z_CYCLE = 12;

// Where each particle starts, from the head's top centre in head widths (+x right,
// +y down); how many seconds after the effect starts it does (the stars repeat on
// their own, and the "z" letters come back in bursts); and its size against the base
// size. How it moves from there is in symbols.css. The buddy window leaves about 0.75
// head widths either side of the head's centre and 0.8 above its top, so everything
// starts well inside that.
const PARTICLES = new Map([
  // A staircase of letters, each bigger, one after another ("z z Z"), 1.2 s apart in a
  // burst (Z_BURST). They start right of the middle, above the sprout and the bow, a step
  // apart, and each drifts only part of a step, so they never run into each other.
  ['z', [
    particle('z', 0, 0.12, -0.08, 0.8),
    particle('z', 1.2, 0.28, -0.28, 1),
    particle('z', 2.4, 0.44, -0.48, 1.2),
  ]],
  // Over the head and to either side of it, one after another, while love lasts (2 s).
  ['hearts', [
    particle('heart', 0, -0.34, -0.02, 1),
    particle('heart', 0.3, 0.36, -0.12, 1.15),
    particle('heart', 0.6, 0.02, -0.32, 0.85),
  ]],
  ['stars', [star(0, 3), star(1, 3), star(2, 3)]],
  // All around the head, almost at once, as the buddy jumps (celebrate lasts 1.6 s).
  ['sparkles', [
    particle('sparkle', 0.05, -0.38, -0.16, 1.15),
    particle('sparkle', 0.15, -0.48, 0.28, 0.8),
    particle('sparkle', 0.2, -0.12, -0.38, 0.75),
    particle('sparkle', 0, 0.2, -0.32, 1),
    particle('sparkle', 0.1, 0.46, -0.1, 0.85),
    particle('sparkle', 0.25, 0.48, 0.3, 1),
  ]],
  // One each side of the head, off its top corners, while it hums (2 s).
  ['notes', [particle('note', 0, 0.42, 0.12, 1), particle('note', 0.55, -0.44, 0.2, 0.85)]],
  // On the upper left of the head, clear of the sprout and the bow, while it is sad (2.5 s).
  ['drop', [particle('drop', 0.3, -0.37, 0.2, 1.2)]],
]);

/** How long a burst of "z" letters lasts: the last letter starts at its delay and takes Z_LETTER. */
export const Z_BURST = Math.max(...PARTICLES.get('z').map((p) => p.delay)) + Z_LETTER;
/** What is left of the cycle after a burst, with nothing animating: at least 7 s (a test checks). */
export const Z_REST = Z_CYCLE - Z_BURST;

// The effects that come back after a rest: seconds from the start of one burst to the next.
const CYCLES = new Map([['z', Z_CYCLE]]);

/** The particles for an effect, fresh each call; none for an unknown one. */
export function particlesFor(effect) {
  return (PARTICLES.get(effect) || []).map((p) => ({ ...p }));
}

const SVG = 'http://www.w3.org/2000/svg';

// The shapes, drawn in a 24 × 24 box. A "shine" is a light spot in the colour of the eyes'
// bright centres, so a shape looks glossy and lit like them. The star's corners are rounded
// by a stroke (symbols.css).
const SHAPES = {
  heart: [
    ['M12 20.6C11.3 20.1 3 14.8 3 8.9 3 6.1 5.1 4 7.7 4c1.9 0 3.4 1.1 4.3 2.7C12.9 5.1 14.4 4 16.3 4 18.9 4 21 6.1 21 8.9 21 14.8 12.7 20.1 12 20.6Z'],
    ['M5.79 9.65A2.1 1.3 -40 1 0 9.01 6.95A2.1 1.3 -40 1 0 5.79 9.65Z', 'shine'],
  ],
  // Centred on the box's centre, so it spins in place.
  star: [['M12 3L14.53 8.52L20.56 9.22L16.09 13.33L17.29 19.28L12 16.3L6.71 19.28L7.91 13.33L3.44 9.22L9.47 8.52Z']],
  // No shine: at a few pixels a light centre reads as a hole.
  sparkle: [['M12 1.5Q13.7 10.3 22.5 12 13.7 13.7 12 22.5 10.3 13.7 1.5 12 10.3 10.3 12 1.5Z']],
  note: [
    ['M4.29 19.93A4.5 3.3 -24 1 0 12.51 16.27A4.5 3.3 -24 1 0 4.29 19.93Z'],
    ['M10.8 17V3.6h2.4c.3 2.9 5.9 3.6 5.9 8.6 0 1.6-.6 3-1.5 3.9.4-1 .5-1.9.3-2.8-.5-2.4-2.6-3.6-4.7-3.9V17Z'],
  ],
  drop: [
    ['M12 2.5C12 2.5 5.6 9.9 5.6 14.9 5.6 18.5 8.5 21.4 12 21.4S18.4 18.5 18.4 14.9C18.4 9.9 12 2.5 12 2.5Z'],
    ['M7.86 14.9A1.3 2.3 18 1 0 10.34 15.7A1.3 2.3 18 1 0 7.86 14.9Z', 'shine'],
  ],
};

function drawing(doc, kind) {
  const svg = doc.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  if (kind === 'z') {
    // A letter in a rounded bold font, centred on the middle of its height (symbols.css).
    const letter = doc.createElementNS(SVG, 'text');
    letter.setAttribute('x', '12');
    letter.setAttribute('y', '12');
    letter.textContent = 'z';
    svg.append(letter);
  }
  for (const [d, className] of SHAPES[kind] || []) {
    const path = doc.createElementNS(SVG, 'path');
    path.setAttribute('d', d);
    if (className) path.setAttribute('class', className);
    svg.append(path);
  }
  return svg;
}

/** One particle's element: where it starts and how big it is, as CSS variables for symbols.css. */
function particleElement(doc, { kind, delay, x, y, scale }) {
  const el = doc.createElement('span');
  el.className = `buddy-symbol buddy-symbol--${kind}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.setProperty('--x', String(x));
  el.style.setProperty('--y', String(y));
  el.style.setProperty('--k', String(scale));
  el.style.animationDelay = `${delay}s`;
  el.append(drawing(doc, kind));
  return el;
}

/**
 * Symbols in `root`, a container over the canvas, in `color` (the buddy's accent, any CSS
 * colour). place() gives the head's top centre and its width, in CSS pixels; play()
 * replaces whatever is showing with an effect's particles (an unknown effect or null just
 * clears); stop() removes everything. The stars loop until replaced or stopped; the "z"
 * letters play a burst, rest with nothing on the page, and come back, until replaced or
 * stopped; the others play once and remove themselves.
 */
export function createSymbols(root, { color } = {}) {
  const doc = root.ownerDocument;
  const showing = new Set();
  // The timer for the next burst, while an effect that rests between bursts is playing. It is the
  // root's window's timer, looked up each time, so a test in the real page can stand in for it.
  let timer;
  root.classList.add('buddy-symbols');
  if (color) root.style.setProperty('--glow', color);

  function stop() {
    if (timer !== undefined) doc.defaultView.clearTimeout(timer);
    timer = undefined;
    for (const el of showing) el.remove();
    showing.clear();
  }

  function play(effect) {
    // This also takes away letters whose burst never ended: a hidden page runs no animations.
    stop();
    const elements = particlesFor(effect).map((p) => {
      const el = particleElement(doc, p);
      // Its own animation, not a child's (the stars pop in with one of their own).
      // A looping animation never ends, so those stay until replaced or stopped.
      el.addEventListener('animationend', (e) => {
        if (e.target !== el) return;
        el.remove();
        showing.delete(el);
      });
      showing.add(el);
      return el;
    });
    root.append(...elements);
    // An effect that rests between bursts is played again when its cycle is over, by one timer at a time.
    const cycle = CYCLES.get(effect);
    if (cycle) timer = doc.defaultView.setTimeout(() => play(effect), cycle * 1000);
  }

  return {
    place({ x, y, size }) {
      root.style.setProperty('--head-x', `${x}px`);
      root.style.setProperty('--head-y', `${y}px`);
      root.style.setProperty('--head-w', `${size}px`);
    },
    play,
    stop,
  };
}
