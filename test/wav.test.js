'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Wav = require('../src/renderer/ear/wav');

test('a wav is the RIFF header then the samples, little endian', () => {
  const wav = Wav.of(Int16Array.from([1, -2, 300]));
  assert.strictEqual(wav.length, 44 + 6);
  const text = (from, n) => String.fromCharCode(...wav.slice(from, from + n));
  assert.strictEqual(text(0, 4), 'RIFF');
  assert.strictEqual(text(8, 4), 'WAVE');
  assert.strictEqual(text(36, 4), 'data');
  const v = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  assert.strictEqual(v.getUint32(4, true), 36 + 6);
  assert.strictEqual(v.getUint16(22, true), 1);
  assert.strictEqual(v.getUint32(24, true), 16000);
  assert.strictEqual(v.getUint16(34, true), 16);
  assert.strictEqual(v.getUint32(40, true), 6);
  assert.deepStrictEqual([v.getInt16(44, true), v.getInt16(46, true), v.getInt16(48, true)], [1, -2, 300]);
});

test('base64 is the same bytes', () => {
  const samples = Int16Array.from([5, -5, 1000]);
  assert.deepStrictEqual(Buffer.from(Wav.base64(samples), 'base64'), Buffer.from(Wav.of(samples)));
});
