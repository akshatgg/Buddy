'use strict';

/**
 * Draws the tray icons.
 *
 * The Mac's menu bar icon: a round face with two eyes, black on transparent, as a macOS "template" image (macOS
 * recolours it for light and dark menu bars). Writes assets/trayTemplate.png (16 px) and trayTemplate@2x.png (32 px).
 *
 * The Windows icon, for the corner of the taskbar: the robot's face in its own colours, a cream shell with a dark rim
 * around a dark screen with glowing eyes, so that it shows on a dark taskbar and on a light one (Windows does not
 * recolour tray icons). Writes assets/trayWindows.ico with a picture for each scale Windows draws it at (100 % to 300 %).
 *
 *   npm run build:icons
 */

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(body) >>> 0);
  return Buffer.concat([length, body, crc]);
}

/** An RGBA PNG whose pixel at each point is pixelAt(u, v, size) = [r, g, b, a], u and v from 0 to 1. */
function png(size, pixelAt) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // row filter: none
    for (let x = 0; x < size; x++) {
      raw.set(pixelAt((x + 0.5) / size, (y + 0.5) / size, size), y * stride + 1 + x * 4);
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bits per channel
  header[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header),
    chunk('IDAT', zlib.deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An .ico file holding the PNG pictures `images` ([{ size, png }]), as Windows Vista and later read them. */
function ico(images) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // an icon (2 would be a cursor)
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + 16 * images.length;
  const entries = images.map((image) => {
    const entry = Buffer.alloc(16);
    entry[0] = image.size % 256; // width; 0 means 256
    entry[1] = image.size % 256; // height
    entry.writeUInt16LE(1, 4); // colour planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(image.png.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += image.png.length;
    return entry;
  });
  return Buffer.concat([header, ...entries, ...images.map((image) => image.png)]);
}

/** A filled circle with two round eyes cut out, soft-edged by about a pixel: the alpha of the Mac's template icon. */
function face(u, v, size) {
  const edge = (distance) => Math.max(0, Math.min(1, distance * size + 0.5));
  const head = edge(0.44 - Math.hypot(u - 0.5, v - 0.5));
  const eye = (cx) => edge(0.075 - Math.hypot(u - cx, (v - 0.46) * 0.8));
  return Math.round(255 * head * (1 - Math.max(eye(0.36), eye(0.64))));
}

const RIM = [74, 58, 47];
const SHELL = [251, 243, 230];
const SCREEN = [43, 38, 34];
const GLOW = [255, 181, 76]; // the first buddy's accent (assets/buddies/buddies.json)

/** The robot face's colour at the point (u, v), or null outside it. Rim and eyes keep at least a pixel at 16 px. */
function robotAt(u, v, size) {
  const fromCentre = Math.hypot(u - 0.5, v - 0.5);
  if (fromCentre > 0.47) return null;
  const eyeRadius = Math.max(1.1 / size, 0.065);
  if ([0.38, 0.62].some((cx) => Math.hypot(u - cx, v - 0.54) < eyeRadius)) return GLOW;
  if (((u - 0.5) / 0.31) ** 2 + ((v - 0.54) / 0.2) ** 2 < 1) return SCREEN;
  return fromCentre > 0.47 - Math.max(1.2 / size, 0.06) ? RIM : SHELL;
}

/** One pixel of the robot face, smoothed by looking at 4 × 4 points inside it. */
function robot(u, v, size) {
  const n = 4;
  const sum = [0, 0, 0];
  let covered = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const colour = robotAt(u + ((i + 0.5) / n - 0.5) / size, v + ((j + 0.5) / n - 0.5) / size, size);
      if (!colour) continue;
      covered += 1;
      colour.forEach((c, k) => {
        sum[k] += c;
      });
    }
  }
  if (covered === 0) return [0, 0, 0, 0];
  return [...sum.map((c) => Math.round(c / covered)), Math.round((255 * covered) / (n * n))];
}

const template = (u, v, size) => [0, 0, 0, face(u, v, size)];

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trayTemplate.png'), png(16, template));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), png(32, template));
fs.writeFileSync(
  path.join(out, 'trayWindows.ico'),
  ico([16, 20, 24, 32, 40, 48].map((size) => ({ size, png: png(size, robot) }))),
);
console.log('[icons] wrote assets/trayTemplate.png, assets/trayTemplate@2x.png and assets/trayWindows.ico');
