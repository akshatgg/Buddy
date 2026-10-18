'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createLock } = require('../src/main/lock');

function monitor(state) {
  const m = new EventEmitter();
  m.state = state;
  m.getSystemIdleState = () => {
    if (m.state instanceof Error) throw m.state;
    return m.state;
  };
  return m;
}

test('unlocked: resolves true at once', async () => {
  const lock = createLock({ powerMonitor: monitor('active') });
  assert.strictEqual(lock.locked(), false);
  assert.strictEqual(await lock.unlocked(1000), true);
});

test('locked, then unlocked: true', async () => {
  const m = monitor('locked');
  const lock = createLock({ powerMonitor: m });
  assert.strictEqual(lock.locked(), true);
  const p = lock.unlocked(60000);
  m.emit('unlock-screen');
  assert.strictEqual(await p, true);
  assert.strictEqual(m.listenerCount('unlock-screen'), 0);
});

test('locked for the whole wait: false, and the listener is removed', async () => {
  const m = monitor('locked');
  let fire;
  const timers = [];
  const lock = createLock({ powerMonitor: m, setTimer: (fn) => { fire = fn; timers.push(fn); return timers.length; }, clearTimer: () => {} });
  const p = lock.unlocked(60000);
  assert.strictEqual(m.listenerCount('unlock-screen'), 1);
  fire();
  assert.strictEqual(await p, false);
  assert.strictEqual(m.listenerCount('unlock-screen'), 0);
});

test('a power monitor that throws is not locked', async () => {
  const lock = createLock({ powerMonitor: monitor(new Error('no')) });
  assert.strictEqual(lock.locked(), false);
  assert.strictEqual(await lock.unlocked(10), true);
});

test('onLocked: called each time the screen locks, until it is stopped', () => {
  const m = monitor('active');
  const lock = createLock({ powerMonitor: m });
  let calls = 0;
  const off = lock.onLocked(() => { calls += 1; });
  m.emit('lock-screen');
  m.emit('lock-screen');
  off();
  m.emit('lock-screen');
  assert.strictEqual(calls, 2);
  assert.strictEqual(m.listenerCount('lock-screen'), 0);
});
