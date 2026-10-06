'use strict';

/** The JSON chunk of a .glb (binary glTF): the scene description without the mesh bytes. */
function readGlbJson(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB file');
  const length = buf.readUInt32LE(12);
  if (buf.readUInt32LE(16) !== 0x4e4f534a) throw new Error('first chunk is not JSON');
  return JSON.parse(buf.subarray(20, 20 + length).toString('utf8'));
}

module.exports = { readGlbJson };
