'use strict';

/**
 * Draws the menu bar icon: a round face with two eyes, black on transparent,
 * as a macOS "template" image (macOS recolours it for light and dark menu
 * bars). Writes assets/trayTemplate.png (16 px) and trayTemplate@2x.png (32 px).
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

/** A black RGBA PNG whose alpha at each pixel is alphaAt(u, v, size), u and v from 0 to 1. */
function png(size, alphaAt) {
  const stride = size * 4 + 1;
  const raw = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0; // row filter: none
    for (let x = 0; x < size; x++) {
      raw[y * stride + 1 + x * 4 + 3] = alphaAt((x + 0.5) / size, (y + 0.5) / size, size);
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

/** A filled circle with two round eyes cut out, soft-edged by about a pixel. */
function face(u, v, size) {
  const edge = (distance) => Math.max(0, Math.min(1, distance * size + 0.5));
  const head = edge(0.44 - Math.hypot(u - 0.5, v - 0.5));
  const eye = (cx) => edge(0.075 - Math.hypot(u - cx, (v - 0.46) * 0.8));
  return Math.round(255 * head * (1 - Math.max(eye(0.36), eye(0.64))));
}

const out = path.join(__dirname, '..', 'assets');
fs.mkdirSync(out, { recursive: true });
fs.writeFileSync(path.join(out, 'trayTemplate.png'), png(16, face));
fs.writeFileSync(path.join(out, 'trayTemplate@2x.png'), png(32, face));
console.log('[icons] wrote assets/trayTemplate.png and assets/trayTemplate@2x.png');
