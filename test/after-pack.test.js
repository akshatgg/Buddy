'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const { missingFromAsar, REQUIRED_IN_ASAR } = require('../build/afterPack');

/** An app.asar holding `files` (names relative to the app folder, each with some text), made in a temp folder. */
async function makeAsar(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-asar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app');
  for (const name of files) {
    fs.mkdirSync(path.dirname(path.join(app, name)), { recursive: true });
    fs.writeFileSync(path.join(app, name), 'x');
  }
  const archive = path.join(dir, 'app.asar');
  await asar.createPackage(app, archive);
  return archive;
}

test('the glTF loader and the room environment are what the buddy page needs from three.js', () => {
  assert.deepStrictEqual(REQUIRED_IN_ASAR, [
    'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
    'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
  ]);
});

test('an asar that holds them has nothing missing', async (t) => {
  const archive = await makeAsar(t, ['package.json', ...REQUIRED_IN_ASAR, 'node_modules/three/build/three.module.js']);
  assert.deepStrictEqual(missingFromAsar(archive), []);
});

test('an asar without them names each one that is missing', async (t) => {
  const none = await makeAsar(t, ['package.json', 'node_modules/three/build/three.module.js']);
  assert.deepStrictEqual(missingFromAsar(none), REQUIRED_IN_ASAR);

  const onlyLoader = await makeAsar(t, [REQUIRED_IN_ASAR[0]]);
  assert.deepStrictEqual(missingFromAsar(onlyLoader), [REQUIRED_IN_ASAR[1]]);
});

test('only the exact path counts, not a longer name or the same name somewhere else', async (t) => {
  const archive = await makeAsar(t, [
    'node_modules/three/examples/jsm/loaders/GLTFLoader.js.map',
    'node_modules/three/examples/jsm/loaders/OBJLoader.js',
    'src/node_modules/three/examples/jsm/environments/RoomEnvironment.js',
  ]);
  assert.deepStrictEqual(missingFromAsar(archive), REQUIRED_IN_ASAR);
});
