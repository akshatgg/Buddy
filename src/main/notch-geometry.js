'use strict';

/**
 * Where Buddy goes when it lives in the notch. Pure functions on rectangles ({ x, y, width, height } in screen
 * points, the origin at the primary screen's top-left), so they can be tested without Electron.
 */

const { PANEL, clampToArea } = require('./geometry');

const WING = 44; // the black wing on each side of the notch, where an eye is
const WING_HOVER = 56; // the wing while the pointer is over it
const SAY_MAX = 260; // the longest a say text gets, beside the right eye
const CORNER = 12; // the rounded bottom corners of the shape
const REACH = WING_HOVER + SAY_MAX; // how far the window reaches past the notch on each side
const DROP = 8; // room under the notch for the celebrate bounce

/** The notch window: a fixed size, so it never resizes; the page draws the smaller black shape inside it, centred. */
function notchWindowBounds(notch) {
  return { x: notch.x - REACH, y: notch.y, width: notch.width + 2 * REACH, height: notch.height + DROP };
}

/** The chat panel under the notch: centred on it, its top at the work area's top, kept inside the work area. */
function panelUnderNotch(notch, area, size = PANEL) {
  const x = Math.round(notch.x + notch.width / 2 - size.width / 2);
  return clampToArea({ x, y: area.y, ...size }, area, 0);
}

const near = (a, b) => Math.abs(a - b) <= 1;

/** The Electron display whose bounds are the helper entry's screen (within a point), or null. */
function findDisplay(entry, displays) {
  const s = entry?.screen;
  if (!s) return null;
  return displays.find((d) => near(d.bounds.x, s.x) && near(d.bounds.y, s.y)
    && near(d.bounds.width, s.width) && near(d.bounds.height, s.height)) || null;
}

/** 'notch' on a Mac that has one and wants it (Settings → Buddy → Where Buddy lives), else 'floating'. */
function chooseHome({ platform, home, notches }) {
  return platform === 'darwin' && home === 'notch' && Array.isArray(notches) && notches.length > 0 ? 'notch' : 'floating';
}

module.exports = {
  REACH, DROP, WING, WING_HOVER, SAY_MAX, CORNER,
  notchWindowBounds, panelUnderNotch, findDisplay, chooseHome,
};
