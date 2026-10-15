'use strict';

/**
 * Buddy's ears on the Mac: the .tar.gz of the small Vosk model (shared/voice-model.js) downloaded once into `dir`,
 * kept only when its SHA-256 is the expected one. The ear page reads it through bytes(). The model has no words list,
 * so words() is null; missing() is the spec's list of words it does not know, which the grammar leaves out.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_MODEL } = require('../../shared/voice-model');

function failed(message, cause) {
  const err = new Error(message);
  err.code = 'model_failed';
  if (cause) err.cause = cause;
  return err;
}

function createVoiceModel({ dir, spec = VOICE_MODEL, fetchImpl = fetch }) {
  const file = path.join(dir, `${spec.name}.tar.gz`);
  let state = 'missing';
  let percent = 0;
  let running = null;

  const ready = () => fs.existsSync(file);

  async function download(onProgress) {
    const part = `${file}.part`;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const res = await fetchImpl(spec.tgz.url);
      if (res.ok === false) throw failed(`HTTP ${res.status}`);
      if (!res.body) throw failed('no body');
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let streamError = null;
      out.on('error', (err) => { streamError = err; });
      const total = spec.tgz.bytes || Number(res.headers.get('content-length')) || 0;
      let got = 0;
      try {
        for await (const chunk of res.body) {
          hash.update(chunk);
          if (streamError) throw failed(streamError.message, streamError);
          if (!out.write(chunk)) await new Promise((resolve) => { out.once('drain', resolve); out.once('error', resolve); });
          got += chunk.length;
          percent = total ? Math.min(99, Math.floor((got / total) * 100)) : 0;
          onProgress?.(percent);
        }
      } finally {
        await new Promise((resolve) => { out.once('error', resolve); out.end(resolve); });
      }
      if (streamError) throw failed(streamError.message, streamError);
      if (hash.digest('hex') !== spec.tgz.sha256) throw failed('the model did not match its checksum');
      fs.renameSync(part, file);
      percent = 100;
      onProgress?.(100);
    } finally {
      fs.rmSync(part, { force: true, recursive: true });
    }
  }

  return {
    ready,
    bytes: () => fs.promises.readFile(file),
    words: () => null,
    missing: () => new Set(spec.missing || []),
    state: () => (ready() ? 'ready' : state),
    percent: () => (ready() ? 100 : percent),
    ensure({ onProgress } = {}) {
      if (ready()) return Promise.resolve();
      if (running) return running;
      state = 'getting';
      percent = 0;
      running = download(onProgress)
        .then(() => { state = 'ready'; })
        .catch((err) => {
          state = 'failed';
          throw err.code === 'model_failed' ? err : failed(err.message, err);
        })
        .finally(() => { running = null; });
      return running;
    },
  };
}

module.exports = { createVoiceModel };
