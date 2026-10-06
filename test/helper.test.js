'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { Helper } = require('../src/main/helper');

/** Stands in for child_process.spawn: each child records what it was sent. */
function fakeSpawn() {
  const children = [];
  function spawnImpl(bin, args) {
    const child = new EventEmitter();
    Object.assign(child, { bin, args, stdin: new PassThrough(), stdout: new PassThrough(), written: [] });
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
