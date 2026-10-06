'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Helper, DEFAULT_TIMEOUTS } = require('../src/main/helper');

/** Stands in for child_process.spawn: each child records what it was sent. */
function fakeSpawn() {
  const children = [];
  function spawnImpl(bin, args, options) {
    const child = new EventEmitter();
    Object.assign(child, { bin, args, options, stdin: new PassThrough(), stdout: new PassThrough(), written: [] });
    child.stdin.on('data', (d) => {
      for (const line of d.toString().trim().split('\n')) child.written.push(JSON.parse(line));
    });
    child.kill = () => child.emit('exit', 0);
    child.reply = (obj) => child.stdout.write(`${JSON.stringify(obj)}\n`);
    children.push(child);
    return child;
  }
  spawnImpl.children = children;
  return spawnImpl;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function started(options = {}) {
  const spawnImpl = fakeSpawn();
  const helper = new Helper({ binPath: '/x/buddy-helper', spawnImpl, ...options });
  helper.start();
  return { helper, spawnImpl, child: spawnImpl.children[0] };
}

test('starts the helper with the owner pid', () => {
  const { child } = started({ ownerPid: 42 });
  assert.strictEqual(child.bin, '/x/buddy-helper');
  assert.deepStrictEqual(child.args, ['--owner-pid', '42']);
});

test('call sends one JSON line and resolves with the reply', async () => {
  const { helper, child } = started();
  const pending = helper.call('captureSelection', { pid: 7, selectAll: false });
  await tick();
  assert.deepStrictEqual(child.written[0], { id: 1, cmd: 'captureSelection', args: { pid: 7, selectAll: false } });
  child.reply({ id: 1, ok: true, result: { text: 'hello' } });
  assert.deepStrictEqual(await pending, { text: 'hello' });
});

test('an error reply rejects with its code and message', async () => {
  const { helper, child } = started();
  const pending = helper.call('captureSelection', { pid: 7 });
  child.reply({ id: 1, ok: false, error: { code: 'secure_field', message: "I don't read password fields." } });
  await assert.rejects(pending, { code: 'secure_field', message: "I don't read password fields." });
});

test('frontApp events update lastApp', async () => {
  const { helper, child } = started();
  assert.strictEqual(helper.lastApp, null);
  child.reply({ event: 'frontApp', pid: 9, bundleId: 'com.google.Chrome', name: 'Google Chrome' });
  await tick();
  assert.deepStrictEqual(helper.lastApp, { pid: 9, bundleId: 'com.google.Chrome', name: 'Google Chrome' });
});

test('if the helper dies, waiting calls fail and it is restarted', async () => {
  const { helper, spawnImpl, child } = started({ restartMs: 5 });
  const pending = helper.call('ping');
  child.emit('exit', 1);
  await assert.rejects(pending, { code: 'helper_exit' });
  await sleep(30);
  assert.strictEqual(spawnImpl.children.length, 2);
  helper.stop();
});

test('stop does not restart it', async () => {
  const { helper, spawnImpl } = started({ restartMs: 5 });
  helper.stop();
  await sleep(30);
  assert.strictEqual(spawnImpl.children.length, 1);
});

test('a call with no helper running fails straight away', async () => {
  const helper = new Helper({ binPath: 'b', spawnImpl: fakeSpawn() });
  await assert.rejects(helper.call('ping'), { code: 'helper_down' });
});

test('a call that gets no answer times out', async () => {
  const { helper } = started({ timeouts: { default: 10 } });
  await assert.rejects(helper.call('ping'), { code: 'timeout' });
  helper.stop();
});

test('a write error on the helper pipe does not throw', () => {
  const { helper, child } = started();
  assert.doesNotThrow(() => child.stdin.emit('error', new Error('EPIPE')));
  helper.stop();
});

test('if the helper cannot be spawned, waiting calls fail and it is retried', async () => {
  const { helper, spawnImpl, child } = started({ restartMs: 5 });
  const pending = helper.call('ping');
  child.emit('error', new Error('spawn ENOENT'));
  await assert.rejects(pending, { code: 'helper_exit' });
  await sleep(30);
  assert.strictEqual(spawnImpl.children.length, 2);
  helper.stop();
});

test('a helper that keeps crashing is restarted more slowly each time', async () => {
  const { helper, spawnImpl, child } = started({ restartMs: 5 });
  child.reply({ event: 'frontApp', pid: 1, bundleId: 'a', name: 'A' });
  await tick();
  child.emit('exit', 1);
  await sleep(20);
  spawnImpl.children[1].reply({ event: 'frontApp', pid: 1, bundleId: 'a', name: 'A' });
  await tick();
  spawnImpl.children[1].emit('exit', 1);
  assert.strictEqual(helper.nextRestartMs, 20);
  helper.stop();
});

test('the helper starts without a console window of its own (Windows would open one for it)', () => {
  const { helper, child } = started();
  assert.strictEqual(child.options.windowsHide, true);
  helper.stop();
});

test('its failures are told in words that fit the Mac and Windows alike', async () => {
  const idle = new Helper({ binPath: 'b', spawnImpl: fakeSpawn() });
  await assert.rejects(idle.call('ping'), { code: 'helper_down', message: "Buddy's helper is not running." });

  const slow = started({ timeouts: { default: 10 } });
  await assert.rejects(slow.helper.call('ping'), { code: 'timeout', message: "Buddy's helper took too long." });
  slow.helper.stop();

  const { helper, child } = started();
  const failing = helper.call('ping');
  child.reply({ id: 1, ok: false });
  await assert.rejects(failing, { code: 'failed', message: "Buddy's helper failed." });
  const waiting = helper.call('ping');
  helper.stop();
  await assert.rejects(waiting, { code: 'helper_exit', message: "Buddy's helper stopped. Try again." });
});

test('a helper that does not answer in time is stopped and started afresh: a hung app must not leave every later call waiting', async () => {
  const { helper, spawnImpl } = started({ timeouts: { ping: 10, default: 1000 }, restartMs: 5 });
  const waiting = helper.call('frontmost');
  await assert.rejects(helper.call('ping'), { code: 'timeout' });
  await assert.rejects(waiting, { code: 'helper_exit' }, 'the calls queued behind it fail with it');
  await sleep(30);
  assert.strictEqual(spawnImpl.children.length, 2, 'and a new helper is started');
  helper.stop();
});

test('reading the selection and pasting wait on the person\'s app, so they get 10 seconds; other calls get 5', () => {
  assert.deepStrictEqual(DEFAULT_TIMEOUTS, { screenshot: 10_000, captureSelection: 10_000, paste: 10_000, default: 5_000 });
});
