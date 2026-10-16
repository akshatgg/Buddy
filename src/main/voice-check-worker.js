'use strict';

/**
 * The voice check's own process (an Electron utilityProcess): sherpa-onnx's speaker embedding extractor over the
 * CAM++ model whose path is argv's last item. It answers { id, embedding } for each { id, pcm } (16 kHz PCM16), or
 * { id, error }. A native crash here ends only this process. Nothing is written or logged.
 */
function makeEmbedder(modelPath, sherpa = require('sherpa-onnx-node')) {
  const ex = new sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1, debug: false, provider: 'cpu' });
  return {
    dim: ex.dim,
    embed(int16) {
      const samples = Float32Array.from(int16, (v) => v / 32768);
      const stream = ex.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples });
      stream.inputFinished();
      if (!ex.isReady(stream)) return null;
      return Array.from(ex.compute(stream, false)); // Electron refuses external buffers
    },
  };
}

if (process.parentPort) {
  const modelPath = process.argv[process.argv.length - 1];
  let embedder = null;
  process.parentPort.on('message', (event) => {
    const { id, pcm } = event.data || {};
    try {
      embedder = embedder || makeEmbedder(modelPath);
    } catch {
      process.parentPort.postMessage({ id, error: 'load' });
      return;
    }
    try {
      process.parentPort.postMessage({ id, embedding: embedder.embed(new Int16Array(pcm)) });
    } catch {
      process.parentPort.postMessage({ id, error: 'embed' });
    }
  });
}

module.exports = { makeEmbedder };
