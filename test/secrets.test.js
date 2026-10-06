'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createSecrets } = require('../src/main/secrets');

// Stands in for Electron's safeStorage: "encrypts" by reversing the text.
const fakeSafeStorage = {
  isEncryptionAvailable: () => true,
  encryptString: (s) => Buffer.from([...s].reverse().join(''), 'utf8'),
  decryptString: (b) => [...b.toString('utf8')].reverse().join(''),
};

/** A keys file path inside a fresh temporary folder, which is removed when the test ends. */
function tmpFile(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return path.join(dir, 'keys.json');
}

test('keys are stored encrypted and read back', (t) => {
  const file = tmpFile(t);
  const secrets = createSecrets({ file, safeStorage: fakeSafeStorage });
  assert.strictEqual(secrets.has('openai'), false);
  secrets.set('openai', 'sk-secret');
  assert.strictEqual(secrets.has('openai'), true);
  assert.strictEqual(createSecrets({ file, safeStorage: fakeSafeStorage }).get('openai'), 'sk-secret');
  assert.ok(!fs.readFileSync(file, 'utf8').includes('sk-secret'), 'the key is not in the file as plain text');
});

test('clear removes a key', (t) => {
  const secrets = createSecrets({ file: tmpFile(t), safeStorage: fakeSafeStorage });
  secrets.set('groq', 'g');
  secrets.clear('groq');
  assert.strictEqual(secrets.get('groq'), null);
});

test('refuses to save when the keychain is not available', (t) => {
  const secrets = createSecrets({
    file: tmpFile(t),
    safeStorage: { ...fakeSafeStorage, isEncryptionAvailable: () => false },
  });
  assert.throws(() => secrets.set('openai', 'k'), { code: 'no_keychain' });
});

test('a key that cannot be decrypted reads as missing', (t) => {
  const file = tmpFile(t);
  createSecrets({ file, safeStorage: fakeSafeStorage }).set('gemini', 'k');
  const broken = createSecrets({
    file,
    safeStorage: { ...fakeSafeStorage, decryptString: () => { throw new Error('bad'); } },
  });
  assert.strictEqual(broken.get('gemini'), null);
});
