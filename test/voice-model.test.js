'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createVoiceModel } = require('../src/main/voice-model');

const BODY = Buffer.from('pretend this is a model'.repeat(100));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function setup(t, { body = BODY, sha256 = sha(BODY), chunks = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-vm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const spec = { name: 'm1', tgz: { url: 'https://example.test/m1.tar.gz', sha256, bytes: body.length } };
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const size = Math.ceil(body.length / chunks);
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < body.length; i += size) c.enqueue(new Uint8Array(body.subarray(i, i + size)));
        c.close();
      },
    });
    return new Response(stream, { status: 200 });
  };
  return { dir, spec, calls, model: createVoiceModel({ dir, spec, fetchImpl }) };
}

test('ensure() downloads, checks the hash, keeps <name>.tar.gz; words are never known', async (t) => {
  const { dir, model } = setup(t);
  assert.strictEqual(model.ready(), false);
  assert.strictEqual(model.state(), 'missing');
  await model.ensure({});
  assert.strictEqual(model.ready(), true);
  assert.strictEqual(model.state(), 'ready');
  assert.strictEqual(model.percent(), 100);
  assert.deepStrictEqual(fs.readdirSync(dir), ['m1.tar.gz']);
  assert.deepStrictEqual(await model.bytes(), BODY);
  assert.strictEqual(model.words(), null);
});

test('another hash: rejects with model_failed, nothing ready, no .part left', async (t) => {
  const { dir, model } = setup(t, { sha256: 'a'.repeat(64) });
  await assert.rejects(model.ensure({}), (e) => e.code === 'model_failed');
  assert.strictEqual(model.ready(), false);
  assert.strictEqual(model.state(), 'failed');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('a failing download is model_failed too', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-vm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const model = createVoiceModel({ dir, spec: { name: 'm', tgz: { url: 'x', sha256: 'a', bytes: 1 } }, fetchImpl: async () => { throw new Error('offline'); } });
  await assert.rejects(model.ensure({}), (e) => e.code === 'model_failed');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('two ensure() at once fetch once', async (t) => {
  const { model, calls } = setup(t);
  await Promise.all([model.ensure({}), model.ensure({})]);
  assert.strictEqual(calls.length, 1);
  await model.ensure({});
  assert.strictEqual(calls.length, 1, 'ready: nothing to fetch');
});

test('percent() follows the bytes', async (t) => {
  const { model } = setup(t, { chunks: 4 });
  const seen = [];
  await model.ensure({ onProgress: (p) => seen.push(p) });
  assert.ok(seen.length >= 4);
  assert.deepStrictEqual(seen, [...seen].sort((a, b) => a - b));
  assert.strictEqual(seen.at(-1), 100);
});
