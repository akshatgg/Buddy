'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { makeEmbedder } = require('../src/main/voice-check-worker');

test('makeEmbedder: floats from PCM16, external buffers off, null when not ready', () => {
  const seen = {};
  const fake = {
    SpeakerEmbeddingExtractor: class {
      constructor(cfg) { seen.cfg = cfg; this.dim = 3; }
      createStream() { return { acceptWaveform: (w) => { seen.wave = w; }, inputFinished: () => { seen.done = true; } }; }
      isReady() { return seen.ready; }
      compute(_s, external) { seen.external = external; return Float32Array.from([1, 2, 3]); }
    },
  };
  const e = makeEmbedder('/m.onnx', fake);
  assert.deepStrictEqual(seen.cfg, { model: '/m.onnx', numThreads: 1, debug: false, provider: 'cpu' });
  seen.ready = false;
  assert.strictEqual(e.embed(Int16Array.from([16384])), null);
  seen.ready = true;
  assert.deepStrictEqual(e.embed(Int16Array.from([16384, -32768])), [1, 2, 3]);
  assert.deepStrictEqual(Array.from(seen.wave.samples), [0.5, -1]);
  assert.strictEqual(seen.wave.sampleRate, 16000);
  assert.strictEqual(seen.external, false);
});
