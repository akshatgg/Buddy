'use strict';

/**
 * The server (web/) is deployed on its own, so it carries a copy of shared/ in web/shared/. This makes that copy:
 * every file of shared/ (hidden files such as .DS_Store left out), and nothing else. `npm test` fails while the
 * copy is out of date (test/web-shared.test.js).
 *
 *   npm run sync:web
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const FROM = path.join(ROOT, 'shared');
const TO = path.join(ROOT, 'web', 'shared');

/** Every file under `dir` that is not hidden, as paths relative to it, sorted. */
function listFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

function syncWebShared({ from = FROM, to = TO } = {}) {
  fs.rmSync(to, { recursive: true, force: true });
  for (const file of listFiles(from)) {
    fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
    fs.copyFileSync(path.join(from, file), path.join(to, file));
  }
}

if (require.main === module) {
  syncWebShared();
  console.log(`web/shared now matches shared/ (${listFiles(TO).length} files)`);
}

module.exports = { syncWebShared, listFiles, FROM, TO };
