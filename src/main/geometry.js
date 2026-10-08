'use strict';

/**
 * Where Buddy's windows go. Pure functions on rectangles ({ x, y, width,
 * height } in screen points), so they can be tested without Electron.
 */

const SIZES = { small: 48, medium: 64, large: 88 };
const MARGIN = 8;
const PANEL = { width: 360, height: 480 };
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

const panelBounds = (buddy, area) => besideBuddy(buddy, area, PANEL, false);
const bubbleBounds = (buddy, area) => besideBuddy(buddy, area, BUBBLE, true);

/** A new size, keeping the bottom-centre point where it was. */
function resizeAround(b, size, area) {
  const cx = b.x + b.width / 2;
  const bottom = b.y + b.height;
  return clampToArea({ x: Math.round(cx - size.width / 2), y: Math.round(bottom - size.height), ...size }, area);
}

module.exports = {
  SIZES, MARGIN, PANEL, BUBBLE,
  buddyWindowSize, buddyBox, windowAtBox, clampToArea, defaultBounds, snapToEdge, panelBounds, bubbleBounds, resizeAround,
};
