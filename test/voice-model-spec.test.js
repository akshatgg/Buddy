'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_MODEL } = require('../shared/voice-model');

test('the model is a Buddy release asset, fixed by its SHA-256 and size', () => {
  assert.strictEqual(VOICE_MODEL.name, 'vosk-model-small-en-in-0.4');
  for (const file of [VOICE_MODEL.zip, VOICE_MODEL.tgz]) {
    assert.match(file.url, /^https:\/\/github\.com\/akshatgg\/Buddy\/releases\/download\/voice-model-1\//);
    assert.match(file.sha256, /^[0-9a-f]{64}$/, 'the SHA-256 printed by tools/pack-voice-model.js');
    assert.ok(Number.isInteger(file.bytes) && file.bytes > 20e6 && file.bytes < 80e6);
  }
});

test('the words the model lacks are a list of strings', () => {
  assert.ok(Array.isArray(VOICE_MODEL.missing));
  assert.ok(VOICE_MODEL.missing.every((w) => typeof w === 'string' && w));
  assert.ok(VOICE_MODEL.missing.includes('nahi'));
});

test('Android reads the same model from shared.json', () => {
  const shared = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'shared.json'), 'utf8'));
  assert.deepStrictEqual(shared.voiceModel, VOICE_MODEL);
});
