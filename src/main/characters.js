'use strict';

/** The characters made by art/build_buddies.py: their list, and each one's .glb. */

const fs = require('node:fs');
const path = require('node:path');

const BUDDIES_DIR = path.join(__dirname, '..', '..', 'assets', 'buddies');

function loadCharacters(dir = BUDDIES_DIR) {
  const list = JSON.parse(fs.readFileSync(path.join(dir, 'buddies.json'), 'utf8'));
  const get = (id) => list.find((c) => c.id === id) || list[0];
  return {
    list,
    get,
    modelBytes: (id) => fs.readFileSync(path.join(dir, get(id).file)),
  };
}

module.exports = { loadCharacters, BUDDIES_DIR };
