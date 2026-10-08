'use strict';

/**
 * Buddy's settings: one small JSON file in the app's data folder. Writes go to
 * a temporary file first and are renamed into place, so a crash mid-write
 * never leaves a half-written file behind.
 */

const fs = require('node:fs');
const path = require('node:path');
const { defaultShortcut } = require('./platform');

const DEFAULTS = Object.freeze({
  onboarded: false,
  buddyOn: false,
  buddyId: 'boy-1',
  buddyName: '',
  size: 'medium',
  shortcut: defaultShortcut,
  provider: 'anthropic',
  models: {},
  positions: {},
  lastDisplayId: null,
  cloud: null, // this person's free-mode settings as the server last gave them (src/main/cloud.js)
  checkForUpdates: true, // look for a newer Buddy on GitHub at launch and every hour (src/main/updates.js)
  lastUpdateCheck: 0, // when that last worked, in ms
  lastRunVersion: null, // the version that ran last, so the first launch after an update is known
  memory: [], // what Buddy knows about the person, as [{ id, text, at }] oldest first (src/main/memory.js)
  learnFromChats: true, // Settings → Memory's "Learn about me from chats": off, a chat saves nothing new
  listenOnOpen: true, // Settings → General's "Listen when the panel opens": off, the panel listens only after 🎤
  home: 'notch', // Settings → Buddy's "Where Buddy lives": 'notch' (on a Mac with one) or 'floating' (src/main/home.js)
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
