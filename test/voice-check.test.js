'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createVoiceCheck } = require('../src/main/voice-check');

function rig(extra = {}) {
  const kids = [];
  const fork = (p, args) => {
    const k = Object.assign(new EventEmitter(), { sent: [], args, killed: 0, postMessage: (m) => k.sent.push(m), kill: () => { k.killed += 1; k.emit('exit'); } });
    kids.push(k);
    return k;
  };
  return { kids, check: createVoiceCheck({ fork, modelPath: () => '/m.onnx', ...extra }) };
}

test('embed sends the PCM and answers the embedding', async () => {
  const { kids, check } = rig();
  const got = check.embed(Int16Array.from([1, 2]));
  assert.strictEqual(kids.length, 1);
  assert.deepStrictEqual(kids[0].args, ['/m.onnx']);
  const { id, pcm } = kids[0].sent[0];
  assert.deepStrictEqual(Array.from(new Int16Array(pcm)), [1, 2]);
  kids[0].emit('message', { id, embedding: [0.1, 0.2] });
  assert.deepStrictEqual(await got, [0.1, 0.2]);
  check.close();
});

test('only the clip itself is sent, even from a view into a bigger buffer', async () => {
  const { kids, check } = rig();
  const big = Int16Array.from([9, 9, 1, 2, 9]);
  const got = check.embed(big.subarray(2, 4));
  assert.deepStrictEqual(Array.from(new Int16Array(kids[0].sent[0].pcm)), [1, 2]);
  kids[0].emit('message', { id: kids[0].sent[0].id, embedding: [1] });
  await got;
  check.close();
});

test('an error answer is null', async () => {
  const { kids, check } = rig();
  const got = check.embed(Int16Array.from([1]));
  kids[0].emit('message', { id: kids[0].sent[0].id, error: 'embed' });
  assert.strictEqual(await got, null);
  check.close();
});

test('no answer within timeoutMs is null, and a late answer changes nothing', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { kids, check } = rig({ timeoutMs: 3000 });
  const first = check.embed(Int16Array.from([1]));
  const firstId = kids[0].sent[0].id;
  t.mock.timers.tick(3000);
  assert.strictEqual(await first, null);
  const second = check.embed(Int16Array.from([1]));
  kids[0].emit('message', { id: firstId, embedding: [5] }); // late: ignored
  const secondId = kids[0].sent[1].id;
  assert.notStrictEqual(firstId, secondId);
  kids[0].emit('message', { id: secondId, embedding: [7] });
  assert.deepStrictEqual(await second, [7]);
  check.close();
});

test('the child exiting while waiting is null, and the next embed forks a new child', async () => {
  const { kids, check } = rig();
  const got = check.embed(Int16Array.from([1]));
  kids[0].emit('exit');
  assert.strictEqual(await got, null);
  const again = check.embed(Int16Array.from([1]));
  assert.strictEqual(kids.length, 2);
  kids[1].emit('message', { id: kids[1].sent[0].id, embedding: [3] });
  assert.deepStrictEqual(await again, [3]);
  check.close();
});

test('idleMs after the last answer the child is killed; a call starts it again', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { kids, check } = rig({ idleMs: 600000 });
  const got = check.embed(Int16Array.from([1]));
  kids[0].emit('message', { id: kids[0].sent[0].id, embedding: [1] });
  await got;
  t.mock.timers.tick(599999);
  assert.strictEqual(kids[0].killed, 0);
  t.mock.timers.tick(1);
  assert.strictEqual(kids[0].killed, 1);
  check.embed(Int16Array.from([1]));
  assert.strictEqual(kids.length, 2);
  check.close();
});

test('a missing model is null and nothing is forked', async () => {
  const kids = [];
  const check = createVoiceCheck({ fork: () => { kids.push(1); }, modelPath: () => null });
  assert.strictEqual(await check.embed(Int16Array.from([1])), null);
  check.warm();
  assert.strictEqual(kids.length, 0);
});

test('warm() starts the child once; close() kills it and ends what waits', async () => {
  const { kids, check } = rig();
  check.warm();
  check.warm();
  assert.strictEqual(kids.length, 1);
  const got = check.embed(Int16Array.from([1]));
  assert.strictEqual(kids.length, 1);
  check.close();
  assert.strictEqual(kids[0].killed, 1);
  assert.strictEqual(await got, null);
});

test('a fork that throws is null, not a rejection', async () => {
  const check = createVoiceCheck({ fork: () => { throw new Error('no'); }, modelPath: () => '/m' });
  assert.strictEqual(await check.embed(Int16Array.from([1])), null);
});
