'use strict';

/**
 * Buddy's voice check from the main process: asks the voice check worker (voice-check-worker.js, an Electron
 * utilityProcess) for the embedding of a clip. The worker is started on the first embed() or warm(), killed after
 * `idleMs` with no call (it holds about 100 MB), and started again when needed -- also after it crashed. embed() never
 * rejects: a timeout (`timeoutMs`, MY_VOICE.checkMs), an error answer, an exit while waiting or a missing model all
 * give null, which the caller takes as "not the owner". A late answer for a call that already timed out is ignored.
 * Nothing is logged, and no clip or embedding is kept.
 *
 * `fork(workerPath, args)` returns { postMessage(msg), on('message' | 'exit', fn), kill() }; main passes
 * utilityProcess.fork. `modelPath()` is the model file, or null when it is not there.
 */

const path = require('node:path');
const { MY_VOICE } = require('../../shared/my-voice');

const WORKER = path.join(__dirname, 'voice-check-worker.js');

function createVoiceCheck({ fork, modelPath, timeoutMs = MY_VOICE.checkMs, idleMs = 600000 }) {
  let child = null;
  let nextId = 1;
  let idleTimer = null;
  const waiting = new Map(); // id -> { resolve, timer }

  function settle(id, value) {
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    clearTimeout(w.timer);
    w.resolve(value);
  }

  function stop() {
    clearTimeout(idleTimer);
    idleTimer = null;
    const old = child;
    child = null;
    for (const id of [...waiting.keys()]) settle(id, null);
    if (old) {
      try { old.kill(); } catch { /* already gone */ }
    }
  }

  function touch() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(stop, idleMs);
    idleTimer.unref?.();
  }

  function start() {
    if (child) return child;
    const model = modelPath();
    if (!model) return null;
    const kid = fork(WORKER, [model]);
    child = kid;
    kid.on('message', (m) => {
      if (child !== kid || !m) return;
      touch();
      settle(m.id, !m.error && Array.isArray(m.embedding) ? m.embedding : null);
    });
    kid.on('exit', () => {
      if (child !== kid) return;
      child = null;
      clearTimeout(idleTimer);
      idleTimer = null;
      for (const id of [...waiting.keys()]) settle(id, null);
    });
    touch();
    return kid;
  }

  return {
    embed(int16) {
      let kid;
      try {
        kid = start();
      } catch {
        return Promise.resolve(null);
      }
      if (!kid) return Promise.resolve(null);
      return new Promise((resolve) => {
        const id = nextId++;
        const timer = setTimeout(() => settle(id, null), timeoutMs);
        waiting.set(id, { resolve, timer });
        touch();
        try {
          const pcm = int16.buffer.slice(int16.byteOffset, int16.byteOffset + int16.byteLength);
          kid.postMessage({ id, pcm });
        } catch {
          settle(id, null);
        }
      });
    },
    warm() {
      try { start(); } catch { /* the first embed tries again */ }
    },
    close: stop,
  };
}

module.exports = { createVoiceCheck };
