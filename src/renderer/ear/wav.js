'use strict';
/* global module */
/* exported Wav */

/** A mono 16-bit WAV of the samples, as the server's /api/transcribe takes it (audio/wav). Free of the DOM. */
const Wav = (() => {
  function of(int16, rate = 16000) {
    const bytes = int16.length * 2;
    const out = new Uint8Array(44 + bytes);
    const v = new DataView(out.buffer);
    const text = (at, s) => { for (let i = 0; i < s.length; i++) v.setUint8(at + i, s.charCodeAt(i)); };
    text(0, 'RIFF'); v.setUint32(4, 36 + bytes, true); text(8, 'WAVE');
    text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
    text(36, 'data'); v.setUint32(40, bytes, true);
    for (let i = 0; i < int16.length; i++) v.setInt16(44 + i * 2, int16[i], true);
    return out;
  }

  function base64(int16) {
    const bytes = of(int16);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(binary);
  }

  return { of, base64 };
})();

if (typeof module !== 'undefined') module.exports = Wav;
