'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCloudConfig, notSetUp, FIELDS } = require('../src/main/cloud-config');

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

test('the server must be https, except on this Mac, for trying the server locally', (t) => {
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://buddy.example.com' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'not a url' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://localhost:3000' })).serverUrl, 'http://localhost:3000');
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://127.0.0.1:3000/x' })).serverUrl, 'http://127.0.0.1:3000');
});

test('without it, Buddy says this copy is not set up for sign-in', () => {
  const err = notSetUp();
  assert.strictEqual(err.code, 'not_set_up');
  assert.strictEqual(err.message, "This copy of Buddy isn't set up for sign-in.");
});
