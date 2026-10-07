'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { syncWebShared, listFiles, FROM, TO } = require('../tools/sync-web-shared');

test('web/shared is an exact copy of shared/ (run `npm run sync:web` after changing shared/)', () => {
  const files = listFiles(FROM);
  assert.ok(files.includes('prompts.js'), 'shared/ is where it should be');
  assert.deepStrictEqual(listFiles(TO), files, 'the same files');
  for (const file of files) {
    assert.ok(fs.readFileSync(path.join(TO, file)).equals(fs.readFileSync(path.join(FROM, file))), `${file} is the same`);
  }
});

test('the sync copies every file, leaves out hidden ones, and removes files that are gone', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-sync-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const from = path.join(dir, 'from');
  const to = path.join(dir, 'to');
  fs.mkdirSync(path.join(from, 'sub'), { recursive: true });
  fs.writeFileSync(path.join(from, 'a.js'), 'a');
  fs.writeFileSync(path.join(from, 'sub', 'b.js'), 'b');
  fs.writeFileSync(path.join(from, '.DS_Store'), 'x');
  fs.mkdirSync(to);
  fs.writeFileSync(path.join(to, 'stale.js'), 'old');
  syncWebShared({ from, to });
  assert.deepStrictEqual(listFiles(to), ['a.js', path.join('sub', 'b.js')]);
  assert.strictEqual(fs.readFileSync(path.join(to, 'sub', 'b.js'), 'utf8'), 'b');
});
