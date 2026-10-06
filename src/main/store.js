'use strict';

/**
 * Buddy's settings: one small JSON file in the app's data folder. Writes go to
 * a temporary file first and are renamed into place, so a crash mid-write
 * never leaves a half-written file behind.
 */

const fs = require('node:fs');
const path = require('node:path');

const DEFAULTS = Object.freeze({
  onboarded: false,
  buddyOn: false,
  buddyId: 'boy-1',
  buddyName: '',
  size: 'medium',
  shortcut: 'Alt+Space',
  provider: 'anthropic',
  models: {},
  positions: {},
  lastDisplayId: null,
  cloud: null, // this person's free-mode settings as the server last gave them (src/main/cloud.js)
});

function writeAtomic(file, text, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text, mode ? { mode } : undefined);
  fs.renameSync(tmp, file);
}

function createStore({ file }) {
  let data = structuredClone(DEFAULTS);
  try {
    data = { ...data, ...JSON.parse(fs.readFileSync(file, 'utf8')) };
  } catch {
    // First run, or an unreadable file: start from the defaults.
  }

  return {
    get: (key) => data[key],
    all: () => structuredClone(data),
    set(patch) {
      data = { ...data, ...patch };
      writeAtomic(file, JSON.stringify(data, null, 2));
      return structuredClone(data);
    },
  };
}

module.exports = { createStore, DEFAULTS, writeAtomic };
