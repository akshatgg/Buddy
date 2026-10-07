'use strict';

/**
 * Talks to the native helper in bin/: buddy-helper on the Mac (src/native/BuddyHelper.swift,
 * in Swift) and buddy-helper.exe on Windows (src/native/windows, in C#). It does what
 * Electron can't: copy the user's selection, paste an answer back into the app they were
 * in, and screenshot that app's window. Both speak the same protocol.
 *
 * One JSON object per line each way. Requests carry an id and replies echo it.
 * Lines without an id are events: `frontApp` says which app the user is in,
 * kept here as `lastApp`, because by the time the panel opens Buddy itself may
 * be in front. `keys` reports the modifier keys while Buddy has asked for them
 * (a single-key shortcut, src/main/key-watch.js), and `started` is said each
 * time a helper starts.
 */

const { spawn } = require('node:child_process');
const { EventEmitter } = require('node:events');
const readline = require('node:readline');
const { BuddyError } = require('../../shared/errors');

// Reading the selection and pasting wait on the person's app (and, on Windows, for them to let go of the shortcut's keys).
const DEFAULT_TIMEOUTS = { screenshot: 10_000, captureSelection: 10_000, paste: 10_000, press: 10_000, default: 5_000 };
const MAX_RESTART_MS = 30_000;

class Helper extends EventEmitter {
  constructor({ binPath, ownerPid = process.pid, spawnImpl = spawn, restartMs = 1000, timeouts = DEFAULT_TIMEOUTS }) {
    super();
    this.binPath = binPath;
    this.ownerPid = ownerPid;
    this.spawnImpl = spawnImpl;
    this.restartMs = restartMs;
    this.nextRestartMs = restartMs;
    this.timeouts = timeouts;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.lastApp = null;
    this.stopped = false;
    this.restartTimer = null;
  }

  start() {
    this.stopped = false;
    const child = this.spawnImpl(this.binPath, ['--owner-pid', String(this.ownerPid)], {
      stdio: ['pipe', 'pipe', 'inherit'],
      windowsHide: true, // on Windows: no console window for it, ever
    });
    this.child = child;
    readline.createInterface({ input: child.stdout }).on('line', (line) => this.onLine(line));
    // A write after the helper died raises EPIPE here; the 'exit' handler does the cleanup.
    child.stdin.on('error', () => {});
    child.on('error', (err) => {
      console.error('[buddy] helper failed:', err.message);
      this.onExit(child); // a spawn failure emits 'error' but never 'exit'
    });
    child.on('exit', () => this.onExit(child));
    // A new helper knows nothing of what the last one was asked to do: key-watch.js tells it again.
    this.emit('started');
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.restartTimer);
    if (this.child) {
      this.child.stdin.end();
      this.child.kill();
    }
  }

  call(cmd, args = {}) {
    if (!this.child || !this.child.stdin.writable) {
      return Promise.reject(new BuddyError('helper_down', "Buddy's helper is not running."));
    }
    const id = this.nextId++;
    const child = this.child;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new BuddyError('timeout', "Buddy's helper took too long."));
        // The helper works one call at a time: one stuck on an app that hangs would keep every later call waiting.
        // It is stopped, and onExit() starts a fresh one.
        if (child === this.child) child.kill();
      }, this.timeouts[cmd] || this.timeouts.default);
      this.pending.set(id, { resolve, reject, timer });
      this.child.stdin.write(`${JSON.stringify({ id, cmd, args })}\n`);
    });
  }

  onLine(line) {
    let msg;
    try {
      msg = JSON.parse(line);
    } catch {
      return;
    }
    if (msg.event) {
      if (msg.event === 'frontApp') this.lastApp = { pid: msg.pid, bundleId: msg.bundleId, name: msg.name };
      this.emit(msg.event, msg);
      return;
    }
    const waiting = this.pending.get(msg.id);
    if (!waiting) return;
    this.nextRestartMs = this.restartMs; // it answered a call, so it works
    this.pending.delete(msg.id);
    clearTimeout(waiting.timer);
    if (msg.ok) waiting.resolve(msg.result || {});
    else waiting.reject(new BuddyError(msg.error?.code || 'failed', msg.error?.message || "Buddy's helper failed."));
  }

  onExit(child) {
    if (child !== this.child) return;
    this.child = null;
    for (const [id, waiting] of this.pending) {
      clearTimeout(waiting.timer);
      waiting.reject(new BuddyError('helper_exit', "Buddy's helper stopped. Try again."));
      this.pending.delete(id);
    }
    if (this.stopped) return;
    this.restartTimer = setTimeout(() => this.start(), this.nextRestartMs);
    this.nextRestartMs = Math.min(this.nextRestartMs * 2, MAX_RESTART_MS);
  }
}

module.exports = { Helper, DEFAULT_TIMEOUTS };
