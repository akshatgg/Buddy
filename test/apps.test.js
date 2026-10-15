'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApps, appDirs, ownBundle } = require('../src/main/apps');

function folder(tree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-apps-'));
  for (const rel of tree) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return root;
}

test('apps are the .app folders in each place, and one folder down, by name without ".app"', () => {
  const a = folder(['Safari.app/Contents', 'Utilities/Terminal.app', 'Utilities/Deep/Nope.app', '.Hidden.app', 'Notes.txt']);
  const b = folder(['Chrome Apps.localized/YouTube.app']);
  const apps = createApps({ dirs: [a, b, path.join(a, 'missing')], openPath: async () => '' });
  assert.deepStrictEqual(apps.list().map((x) => x.name).sort(), ['Safari', 'Terminal', 'YouTube']);
  assert.strictEqual(apps.list().find((x) => x.name === 'Terminal').path, path.join(a, 'Utilities', 'Terminal.app'));
});

test('open hands the path to the system and gives back its answer', async () => {
  const opened = [];
  const apps = createApps({ dirs: [], openPath: async (p) => { opened.push(p); return p.includes('Bad') ? 'gone' : ''; } });
  assert.strictEqual(await apps.open('/Applications/Safari.app'), '');
  assert.strictEqual(await apps.open('/Applications/Bad.app'), 'gone');
  assert.deepStrictEqual(opened, ['/Applications/Safari.app', '/Applications/Bad.app']);
});

test('the Mac keeps apps in three places', () => {
  assert.deepStrictEqual(appDirs('/Users/a'), ['/Applications', '/System/Applications', '/Users/a/Applications']);
});

test('Buddy is not one of the apps: its own bundle is left out, wherever it runs from', () => {
  const a = folder(['Buddy.app/Contents', 'Safari.app', 'Utilities/Terminal.app']);
  const apps = createApps({ dirs: [a], openPath: async () => '', own: 'Buddy.app' });
  assert.deepStrictEqual(apps.list().map((x) => x.name).sort(), ['Safari', 'Terminal']);
  const all = createApps({ dirs: [a], openPath: async () => '' });
  assert.deepStrictEqual(all.list().map((x) => x.name).sort(), ['Buddy', 'Safari', 'Terminal'], 'no own bundle given: all of them');
});

test("Buddy's own bundle is the outermost .app its program runs in", () => {
  assert.strictEqual(ownBundle('/Applications/Buddy.app/Contents/MacOS/Buddy'), 'Buddy.app');
  assert.strictEqual(ownBundle('/private/var/folders/x/AppTranslocation/ABC/d/Buddy.app/Contents/MacOS/Buddy'), 'Buddy.app');
  assert.strictEqual(ownBundle('/Applications/Buddy.app/Contents/Frameworks/Buddy Helper.app/Contents/MacOS/Buddy Helper'), 'Buddy.app');
  assert.strictEqual(ownBundle('C:\\Program Files\\Buddy\\Buddy.exe'), null);
  assert.strictEqual(ownBundle(''), null);
});
