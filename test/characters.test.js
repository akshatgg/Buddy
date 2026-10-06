'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { readGlbJson } = require('./helpers/glb');
const { loadCharacters, BUDDIES_DIR } = require('../src/main/characters');

const characters = loadCharacters();

test('the manifest lists a boy and a girl, with names, models and previews', () => {
  assert.ok(characters.list.some((c) => c.gender === 'boy'));
  assert.ok(characters.list.some((c) => c.gender === 'girl'));
  for (const c of characters.list) {
    assert.match(c.id, /^[a-z]+-\d+$/);
    assert.ok(c.defaultName);
    assert.ok(fs.existsSync(path.join(BUDDIES_DIR, c.file)), `${c.file} exists`);
    assert.ok(fs.existsSync(path.join(BUDDIES_DIR, c.preview)), `${c.preview} exists`);
  }
});

for (const c of characters.list) {
  test(`${c.id}.glb follows the character contract`, () => {
    const bytes = characters.modelBytes(c.id);
    assert.ok(bytes.length < 1024 * 1024, 'under 1 MB');
    const gltf = readGlbJson(bytes);
    const names = gltf.nodes.map((n) => n.name);
    for (const name of ['Root', 'Head', 'ArmL', 'ArmR', 'Face']) assert.ok(names.includes(name), `has node ${name}`);
    const face = gltf.meshes[gltf.nodes.find((n) => n.name === 'Face').mesh];
    assert.deepStrictEqual(face.extras.targetNames, ['blink', 'smile', 'mouthO', 'eyeLUp', 'eyeRUp']);
    assert.ok((face.weights || [0, 0, 0]).every((w) => w === 0), 'every morph target starts at rest');
  });
}

test('get falls back to the first character for an unknown id', () => {
  assert.strictEqual(characters.get('nobody').id, characters.list[0].id);
});
