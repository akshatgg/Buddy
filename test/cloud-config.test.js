'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCloudConfig, parseCloudConfig, notSetUp, FIELDS } = require('../src/main/cloud-config');

const GOOD = {
  serverUrl: 'https://buddy-server.vercel.app/',
  firebaseApiKey: ' AIza-key ',
  googleClientId: 'id.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-secret',
};

/** A cloud.json holding `data` (text as it is, anything else as JSON; nothing at all for undefined) in a temp folder. */
function write(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-cloud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cloud.json');
  if (data !== undefined) fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

test('reads the four values, trimmed, with the server as a bare origin', (t) => {
  assert.deepStrictEqual(FIELDS, ['serverUrl', 'firebaseApiKey', 'googleClientId', 'googleClientSecret']);
  assert.deepStrictEqual(loadCloudConfig(write(t, GOOD)), {
    serverUrl: 'https://buddy-server.vercel.app',
    firebaseApiKey: 'AIza-key',
    googleClientId: 'id.apps.googleusercontent.com',
    googleClientSecret: 'GOCSPX-secret',
  });
});

test('no file, a damaged one, or one with a value missing: not set up', (t) => {
  assert.strictEqual(loadCloudConfig(write(t)), null);
  assert.strictEqual(loadCloudConfig(write(t, '{ not json')), null);
  assert.strictEqual(loadCloudConfig(write(t, '[]')), null);
  for (const name of FIELDS) {
    assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, [name]: '  ' })), null, name);
  }
});

test('a file that cannot be read (a folder where cloud.json should be) is not set up either', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-cloud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.strictEqual(loadCloudConfig(dir), null);
});

test('the server must be https, except on this Mac, for trying the server locally', (t) => {
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://buddy.example.com' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'not a url' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://localhost:3000' })).serverUrl, 'http://localhost:3000');
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://127.0.0.1:3000/x' })).serverUrl, 'http://127.0.0.1:3000');
});

// parseCloudConfig is what loadCloudConfig applies to the file's text, and what the build applies to the cloud.json
// it finds in the packed app (build/afterPack.js): the same rules, on text.
test('parseCloudConfig reads the four values from text, trimmed, with the server as a bare origin', () => {
  assert.deepStrictEqual(parseCloudConfig(JSON.stringify(GOOD)), {
    serverUrl: 'https://buddy-server.vercel.app',
    firebaseApiKey: 'AIza-key',
    googleClientId: 'id.apps.googleusercontent.com',
    googleClientSecret: 'GOCSPX-secret',
  });
});

test('parseCloudConfig: text that is not JSON, or not an object, is not a config', () => {
  for (const text of ['', '{ not json', '[]', 'null', '"cloud"', '42']) {
    assert.strictEqual(parseCloudConfig(text), null, JSON.stringify(text));
  }
});

test('parseCloudConfig: a value that is blank, missing or not text is not a config', () => {
  for (const name of FIELDS) {
    assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, [name]: '  ' })), null, `${name} blank`);
    assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, [name]: 7 })), null, `${name} a number`);
    const without = { ...GOOD };
    delete without[name];
    assert.strictEqual(parseCloudConfig(JSON.stringify(without)), null, `${name} missing`);
  }
});

// A real value is one word. cloud.example.json's placeholders are not: the three secrets each carry a note in
// parentheses (its serverUrl is an address already), so a copy that was not filled in is refused, and so is a real
// value with a note left after it.
const EXAMPLE = path.join(__dirname, '..', 'cloud.example.json');

test('parseCloudConfig: an unedited cloud.example.json is not a config, nor is one with any placeholder left in', () => {
  const text = fs.readFileSync(EXAMPLE, 'utf8');
  assert.strictEqual(parseCloudConfig(text), null);
  const example = JSON.parse(text);
  const placeholders = FIELDS.filter((name) => /\s/.test(example[name].trim()));
  assert.deepStrictEqual(placeholders, ['firebaseApiKey', 'googleClientId', 'googleClientSecret'], "the example's notes");
  for (const name of placeholders) {
    assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, [name]: example[name] })), null, name);
  }
});

test('parseCloudConfig: a value with whitespace inside it is not a config', () => {
  // For the server, an address that URL parsing alone lets through: it encodes a space and drops a tab or newline.
  const heads = { ...GOOD, serverUrl: 'https://buddy-server.vercel.app/a' };
  for (const name of FIELDS) {
    for (const space of [' ', '\t', '\n']) {
      const value = `${heads[name].trim()}${space}b`;
      assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, [name]: value })), null, `${name}: ${JSON.stringify(value)}`);
    }
  }
});

test('parseCloudConfig: whitespace around a value is trimmed, not refused', () => {
  const padded = Object.fromEntries(FIELDS.map((name) => [name, `\t ${GOOD[name].trim()}\n `]));
  assert.deepStrictEqual(parseCloudConfig(JSON.stringify(padded)), {
    serverUrl: 'https://buddy-server.vercel.app',
    firebaseApiKey: 'AIza-key',
    googleClientId: 'id.apps.googleusercontent.com',
    googleClientSecret: 'GOCSPX-secret',
  });
});

test('parseCloudConfig: the server must be https, or http on this Mac', () => {
  assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, serverUrl: 'http://buddy.example.com' })), null);
  assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, serverUrl: 'not a url' })), null);
  assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, serverUrl: 'http://localhost:3000' })).serverUrl, 'http://localhost:3000');
  assert.strictEqual(parseCloudConfig(JSON.stringify({ ...GOOD, serverUrl: 'http://127.0.0.1:3000/x' })).serverUrl, 'http://127.0.0.1:3000');
});

test('without it, Buddy says this copy is not set up for sign-in', () => {
  const err = notSetUp();
  assert.strictEqual(err.code, 'not_set_up');
  assert.strictEqual(err.message, "This copy of Buddy isn't set up for sign-in.");
});
