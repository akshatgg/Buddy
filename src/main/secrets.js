'use strict';

/**
 * The user's own API keys, one per provider, encrypted with Electron's
 * safeStorage (backed by the macOS Keychain) before they touch the disk. A key
 * is only ever decrypted to call the provider it belongs to.
 */

const fs = require('node:fs');
const { BuddyError } = require('../../shared/errors');
const { writeAtomic } = require('./store');

function createSecrets({ file, safeStorage }) {
  let data = {};
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    // No keys saved yet.
  }

  function save() {
    writeAtomic(file, JSON.stringify(data), 0o600);
  }

  return {
    has: (provider) => typeof data[provider] === 'string',
    get(provider) {
      if (typeof data[provider] !== 'string') return null;
      try {
        return safeStorage.decryptString(Buffer.from(data[provider], 'base64'));
      } catch {
        return null;
      }
    },
    set(provider, key) {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new BuddyError('no_keychain', 'Your Mac keychain is not available, so the key cannot be saved safely.');
      }
      data[provider] = safeStorage.encryptString(key).toString('base64');
      save();
    },
    clear(provider) {
      delete data[provider];
      save();
    },
  };
}

module.exports = { createSecrets };
