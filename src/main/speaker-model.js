'use strict';

/**
 * The voice check's model on the Mac: the one .onnx file of SPEAKER_MODEL (shared/my-voice.js) downloaded once into
 * `dir`, kept only when its SHA-256 is the expected one. The file is hashed while it downloads and only then renamed
 * into place, so a half or wrong file is never there. ready() is "the file is there with the right size" (the hash was
 * checked once, at download). One download at a time; any failure is an error with code 'model_failed'.
 */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { SPEAKER_MODEL } = require('../../shared/my-voice');

function failed(message, cause) {
  const err = new Error(message);
  err.code = 'model_failed';
  if (cause) err.cause = cause;
  return err;
}

function createSpeakerModel({ dir, spec = SPEAKER_MODEL, fetchImpl = fetch }) {
  const file = path.join(dir, spec.file);
  let state = 'missing';
  let percent = 0;
  let running = null;

  const ready = () => {
    try {
      return fs.statSync(file).size === spec.bytes;
    } catch {
      return false;
    }
  };

  async function download(onProgress) {
    const part = `${file}.part`;
    fs.mkdirSync(dir, { recursive: true });
    try {
      const res = await fetchImpl(spec.url);
      if (res.ok === false) throw failed(`HTTP ${res.status}`);
      if (!res.body) throw failed('no body');
      const hash = crypto.createHash('sha256');
      const out = fs.createWriteStream(part);
      let streamError = null;
      out.on('error', (err) => { streamError = err; });
      const total = spec.bytes || Number(res.headers.get('content-length')) || 0;
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
      if (hash.digest('hex') !== spec.sha256) throw failed('the model did not match its checksum');
      fs.renameSync(part, file);
      percent = 100;
      onProgress?.(100);
    } finally {
      fs.rmSync(part, { force: true, recursive: true });
    }
  }

  return {
    ready,
    path: () => file,
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

module.exports = { createSpeakerModel };
