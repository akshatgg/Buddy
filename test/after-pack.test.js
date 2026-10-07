'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const asar = require('@electron/asar');
const afterPack = require('../build/afterPack');

const { missingFromAsar, cloudConfigProblem, REQUIRED_IN_ASAR } = afterPack;

// A cloud.json the app accepts, and what the build says about one it would not.
const CLOUD = {
  serverUrl: 'https://buddy-server.vercel.app',
  firebaseApiKey: 'AIza-key',
  googleClientId: 'id.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-secret',
};
const NOT_VALID =
  'cloud.json in the app is not valid: it needs serverUrl (https), firebaseApiKey, googleClientId and ' +
  'googleClientSecret (see cloud.example.json).';

/**
 * An app.asar holding `files` (names relative to the app folder), made in a temp folder. Each file holds the text in
 * `contents` under its name, or "x".
 */
async function makeAsar(t, files, contents = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-asar-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const app = path.join(dir, 'app');
  for (const name of files) {
    fs.mkdirSync(path.dirname(path.join(app, name)), { recursive: true });
    fs.writeFileSync(path.join(app, name), contents[name] ?? 'x');
  }
  const archive = path.join(dir, 'app.asar');
  await asar.createPackage(app, archive);
  return archive;
}

/**
 * What electron-builder hands afterPack for a mac build whose Buddy.app carries `archive` as its app.asar. With no
 * identity named, the build is taken to have a certificate (electron-builder signs after the hook), so the hook stops
 * after its checks and never calls codesign.
 */
function contextFor(t, archive) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-pack-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const resources = path.join(dir, 'Buddy.app', 'Contents', 'Resources');
  fs.mkdirSync(resources, { recursive: true });
  fs.copyFileSync(archive, path.join(resources, 'app.asar'));
  return {
    electronPlatformName: 'darwin',
    appOutDir: dir,
    packager: { appInfo: { productFilename: 'Buddy', id: 'com.akshatgg.buddy' }, platformSpecificBuildOptions: {} },
  };
}

test('the three.js loader and environment, and cloud.json, are what the installed app needs', () => {
  assert.deepStrictEqual(REQUIRED_IN_ASAR, [
    'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
    'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
    'cloud.json',
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
  assert.deepStrictEqual(missingFromAsar(onlyLoader), REQUIRED_IN_ASAR.slice(1));
});

test('only the exact path counts, not a longer name or the same name somewhere else', async (t) => {
  const archive = await makeAsar(t, [
    'node_modules/three/examples/jsm/loaders/GLTFLoader.js.map',
    'node_modules/three/examples/jsm/loaders/OBJLoader.js',
    'src/node_modules/three/examples/jsm/environments/RoomEnvironment.js',
    'cloud.json.bak',
    'src/cloud.json',
  ]);
  assert.deepStrictEqual(missingFromAsar(archive), REQUIRED_IN_ASAR);
});

test('a packed cloud.json that the app accepts is no problem', async (t) => {
  const archive = await makeAsar(t, ['cloud.json'], { 'cloud.json': JSON.stringify(CLOUD) });
  assert.strictEqual(cloudConfigProblem(archive), null);
});

test('a packed cloud.json that the app would refuse is a problem, in the words the build fails with', async (t) => {
  const refused = [
    '{ not json',
    '[]',
    JSON.stringify({ ...CLOUD, googleClientSecret: ' ' }),
    JSON.stringify({ ...CLOUD, serverUrl: 'http://buddy-server.vercel.app' }),
    fs.readFileSync(path.join(__dirname, '..', 'cloud.example.json'), 'utf8'), // copied and never filled in
  ];
  for (const text of refused) {
    const archive = await makeAsar(t, ['cloud.json'], { 'cloud.json': text });
    assert.strictEqual(cloudConfigProblem(archive), NOT_VALID, text);
  }
});

test('an asar with no cloud.json has no problem to report here: the presence check is what names it', async (t) => {
  const archive = await makeAsar(t, ['package.json']);
  assert.strictEqual(cloudConfigProblem(archive), null);
  assert.deepStrictEqual(missingFromAsar(archive, ['cloud.json']), ['cloud.json']);
});

test('the build fails when cloud.json is not packed, and says to copy cloud.example.json', async (t) => {
  t.mock.method(console, 'log', () => {});
  const archive = await makeAsar(t, REQUIRED_IN_ASAR.filter((name) => name !== 'cloud.json'));
  await assert.rejects(afterPack.default(contextFor(t, archive)), {
    message: /^app\.asar is missing cloud\.json\. .*copy cloud\.example\.json to cloud\.json and fill it in/,
  });
});

test('the build fails when the packed cloud.json is not one the app accepts', async (t) => {
  t.mock.method(console, 'log', () => {});
  const archive = await makeAsar(t, REQUIRED_IN_ASAR, { 'cloud.json': JSON.stringify({ ...CLOUD, firebaseApiKey: '' }) });
  await assert.rejects(afterPack.default(contextFor(t, archive)), { message: NOT_VALID });
});

test('the build goes on when everything is packed and cloud.json is valid', async (t) => {
  const log = t.mock.method(console, 'log', () => {});
  const archive = await makeAsar(t, REQUIRED_IN_ASAR, { 'cloud.json': JSON.stringify(CLOUD) });
  await afterPack.default(contextFor(t, archive));
  assert.deepStrictEqual(log.mock.calls.map((call) => call.arguments[0]), [
    '  • app.asar holds the three.js loader and environment, and cloud.json',
    '  • cloud.json is in app.asar and valid',
  ]);
});
