'use strict';

/**
 * Where Buddy's windows go. Pure functions on rectangles ({ x, y, width,
 * height } in screen points), so they can be tested without Electron.
 */

const SIZES = { small: 48, medium: 64, large: 88 };
const MARGIN = 8;
const PANEL = { width: 360, height: 480 }; // the panel as it first opens
const PANEL_MIN = { width: 320, height: 380 }; // the smallest the person can make it
const PANEL_BIG = { width: 560, height: 760 }; // the header's ⤢: as big as this, or as the screen allows
const BUBBLE = { width: 230, height: 54 };
const ROOM_ABOVE = 0.6; // room above the buddy for its symbols (src/renderer/buddy/symbols.js), times its size

/**
 * The buddy window: the buddy's own box, 1.5 × its size wide and 1.75 × tall (room around the character for floating
 * and turning), with room above it for the symbols that show how it feels.
 */
function buddyWindowSize(size) {
  const s = SIZES[size] || SIZES.medium;
  return { width: Math.round(s * 1.5), height: Math.round(s * 1.75) + Math.round(s * ROOM_ABOVE) };
}

/**
 * The buddy's own box in its window: the bottom of it, 1.75 tall for 1.5 wide. It is what the window was before it
 * grew upward, so the panel and the bubble go beside it as they always did, and the buddy page frames the character
 * in the same box (src/renderer/buddy/layout.js; a test checks they agree).
 */
function buddyBox(win) {
  const height = Math.min(win.height, Math.round((win.width * 7) / 6));
  return { x: win.x, y: win.y + win.height - height, width: win.width, height };
}

/** The window of `size` whose box has its top-left corner at `corner`: where a saved position puts the buddy. */
function windowAtBox(corner, size) {
  const box = buddyBox({ x: 0, y: 0, ...size });
  return { x: corner.x, y: corner.y - box.y, ...size };
}

function clamp(v, lo, hi) {
  return Math.min(Math.max(v, lo), Math.max(lo, hi));
}

function clampToArea(b, area, margin = MARGIN) {
  return {
    ...b,
    x: clamp(b.x, area.x + margin, area.x + area.width - b.width - margin),
    y: clamp(b.y, area.y + margin, area.y + area.height - b.height - margin),
  };
}

/** Bottom-right corner of the work area: where a new buddy first appears. */
function defaultBounds(area, size, margin = MARGIN) {
  return {
    x: area.x + area.width - size.width - margin,
    y: area.y + area.height - size.height - margin,
    ...size,
  };
}

/** Glide to the nearer left or right edge, staying inside the work area. */
function snapToEdge(b, area, margin = MARGIN) {
  const left = b.x + b.width / 2 < area.x + area.width / 2;
  const x = left ? area.x + margin : area.x + area.width - b.width - margin;
  return clampToArea({ ...b, x }, area, margin);
}

/** A box beside the buddy, on the side away from the screen edge it sits on. */
function besideBuddy(buddy, area, box, alignTop) {
  const onRightHalf = buddy.x + buddy.width / 2 > area.x + area.width / 2;
  const x = onRightHalf ? buddy.x - box.width - MARGIN : buddy.x + buddy.width + MARGIN;
  const y = alignTop ? buddy.y : buddy.y + buddy.height / 2 - box.height / 2;
  return clampToArea({ x: Math.round(x), y: Math.round(y), ...box }, area);
}

/** The panel's size the person chose (PANEL when none), no smaller than PANEL_MIN and no bigger than the work area. */
function panelSize(size, area, margin = MARGIN) {
  const fit = (value, fallback, lo, hi) => clamp(Number.isFinite(value) ? Math.round(value) : fallback, lo, hi);
  return {
    width: fit(size?.width, PANEL.width, PANEL_MIN.width, area.width - 2 * margin),
    height: fit(size?.height, PANEL.height, PANEL_MIN.height, area.height - 2 * margin),
  };
}

const panelBounds = (buddy, area, size = PANEL) => besideBuddy(buddy, area, panelSize(size, area), false);

/**
 * Where the panel's resize grip goes: on its outer side, away from the buddy ('left' when the panel is on the buddy's
 * left), so that the edge beside the buddy stays put; 'both' under the notch, where the panel grows from its middle.
 */
function panelGrip(at) {
  if (at.kind === 'below') return 'both';
  return at.buddy.x + at.buddy.width / 2 > at.area.x + at.area.width / 2 ? 'left' : 'right';
}

/**
 * The panel's size after the grip was dragged by (dx, dy) from a panel of size `start`. Beside the buddy it stays
 * centred on it, so it grows twice the drag in height; under the notch it hangs from the top and is centred on the
 * notch, so it grows twice the drag in width.
 */
function resizedPanel(start, dx, dy, grip, area) {
  const width = start.width + (grip === 'left' ? -dx : grip === 'right' ? dx : 2 * dx);
  const height = start.height + (grip === 'both' ? dy : 2 * dy);
  return panelSize({ width, height }, area);
}
const bubbleBounds = (buddy, area) => besideBuddy(buddy, area, BUBBLE, true);

/** A new size, keeping the bottom-centre point where it was. */
function resizeAround(b, size, area) {
  const cx = b.x + b.width / 2;
  const bottom = b.y + b.height;
  return clampToArea({ x: Math.round(cx - size.width / 2), y: Math.round(bottom - size.height), ...size }, area);
}

module.exports = {
  SIZES, MARGIN, PANEL, PANEL_MIN, PANEL_BIG, BUBBLE,
  buddyWindowSize, buddyBox, windowAtBox, clampToArea, defaultBounds, snapToEdge, panelBounds, bubbleBounds, resizeAround,
  panelSize, panelGrip, resizedPanel,
};
