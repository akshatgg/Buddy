'use strict';

/**
 * Where Buddy's windows go. Pure functions on rectangles ({ x, y, width,
 * height } in screen points), so they can be tested without Electron.
 */

const SIZES = { small: 48, medium: 64, large: 88 };
const MARGIN = 8;
const PANEL = { width: 360, height: 480 };
const BUBBLE = { width: 230, height: 54 };

/** The buddy window: room around the character for floating and turning. */
function buddyWindowSize(size) {
  const s = SIZES[size] || SIZES.medium;
  return { width: Math.round(s * 1.5), height: Math.round(s * 1.75) };
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
  buddyWindowSize, clampToArea, defaultBounds, snapToEdge, panelBounds, bubbleBounds, resizeAround,
};
