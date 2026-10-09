// Where the buddy sits in its window. The window is the buddy's own box, 1.5 × its size wide and 1.75 × tall (room to
// float and turn), with room above it for the symbols: src/main/geometry.js makes it so, and a test checks that the
// two agree. The camera frames the character in the box as it always has, and the room above shows the same view
// carried on upward, so the buddy keeps its size and its place, and an arm raised high or the top of a jump is drawn
// there instead of being cut off.

import { Vector2, Vector3 } from 'three';

/** The height of the buddy's own box, the bottom of a window `width` × `height` CSS pixels: 1.75 tall for 1.5 wide. */
export function boxHeight(width, height) {
  return Math.min(height, Math.round((width * 7) / 6));
}

/**
 * Set the camera up for a window `width` × `height`: it sees what it would in a window that is only the box (the
 * box's shape), and the window shows that view with the room above it carried on upward.
 */
export function fitCamera(camera, width, height) {
  const box = boxHeight(width, height);
  camera.aspect = width / box;
  // The box's view, seen through a window that starts `height - box` pixels above it. This updates the projection.
  camera.setViewOffset(width, box, 0, box - height, width, height);
}

/** Where `point`, in the scene, shows in the window, in CSS pixels from its top-left corner. */
export function toWindow(point, camera, width, height) {
  const p = point.clone().project(camera);
  return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
}

/** The point (x, y) of the window, in CSS pixels, as the raycaster takes it (from -1 to 1 each way, y up). */
export function fromWindow(x, y, width, height) {
  return new Vector2((x / width) * 2 - 1, 1 - (y / height) * 2);
}

/**
 * Where the symbols go (symbols.js place()): the top centre of the head's bounding box `head`, the sprout or the bow
 * included, and the head's width, its ear cups included, in the window's CSS pixels.
 */
export function headMark(head, camera, width, height) {
  const centre = head.getCenter(new Vector3());
  const top = toWindow(new Vector3(centre.x, head.max.y, centre.z), camera, width, height);
  const left = toWindow(new Vector3(head.min.x, centre.y, centre.z), camera, width, height);
  const right = toWindow(new Vector3(head.max.x, centre.y, centre.z), camera, width, height);
  return { x: top.x, y: top.y, size: right.x - left.x };
}
