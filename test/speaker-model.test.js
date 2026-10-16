'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSpeakerModel } = require('../src/main/speaker-model');

const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const SPEC = { file: 'm.onnx', url: 'https://x/m.onnx', sha256: sha('abc'), bytes: 3 };

function setup(t, { body = Buffer.from('abc'), status = 200, spec = SPEC, chunks = 1 } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sm-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(url);
    const size = Math.max(1, Math.ceil(body.length / chunks));
    const stream = new ReadableStream({
      start(c) {
        for (let i = 0; i < body.length; i += size) c.enqueue(new Uint8Array(body.subarray(i, i + size)));
        c.close();
      },
    });
    return new Response(status === 200 ? stream : null, { status });
  };
  return { dir, calls, model: createSpeakerModel({ dir, spec, fetchImpl }) };
}

test('a body with the spec hash is kept at path(); ready; progress ends at 100', async (t) => {
  const { dir, model } = setup(t, { chunks: 3 });
  assert.strictEqual(model.ready(), false);
  const seen = [];
  await model.ensure({ onProgress: (p) => seen.push(p) });
  assert.strictEqual(model.path(), path.join(dir, 'm.onnx'));
  assert.strictEqual(model.ready(), true);
  assert.strictEqual(model.state(), 'ready');
  assert.strictEqual(seen.at(-1), 100);
  assert.deepStrictEqual(fs.readdirSync(dir), ['m.onnx']);
});

test('a wrong body leaves no file and no .part, and rejects with model_failed', async (t) => {
  const { dir, model } = setup(t, { body: Buffer.from('xyz') });
  await assert.rejects(model.ensure({}), (e) => e.code === 'model_failed');
  assert.strictEqual(model.ready(), false);
  assert.strictEqual(model.state(), 'failed');
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});

test('HTTP 404 rejects with model_failed', async (t) => {
  const { model } = setup(t, { status: 404 });
  await assert.rejects(model.ensure({}), (e) => e.code === 'model_failed');
  assert.strictEqual(model.ready(), false);
});

test('two ensure() at once download once', async (t) => {
  const { model, calls } = setup(t);
  await Promise.all([model.ensure({}), model.ensure({})]);
  assert.strictEqual(calls.length, 1);
  await model.ensure({});
  assert.strictEqual(calls.length, 1, 'ready: nothing to fetch');
});

test('a file of the wrong size is not ready', (t) => {
  const { dir, model } = setup(t);
  fs.writeFileSync(path.join(dir, 'm.onnx'), 'abcd');
  assert.strictEqual(model.ready(), false);
  fs.writeFileSync(path.join(dir, 'm.onnx'), 'abc');
  assert.strictEqual(model.ready(), true);
});

test('remove() deletes the file so the model is downloaded again', async (t) => {
  const { dir, model } = setup(t);
  await model.ensure({});
  model.remove();
  assert.strictEqual(model.ready(), false);
  assert.deepStrictEqual(fs.readdirSync(dir), []);
});
