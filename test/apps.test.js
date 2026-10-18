'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApps, appDirs, ownBundle, findApp, createSpotlight } = require('../src/main/apps');
const { aliasFor } = require('../shared/app-aliases');

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

test('the Mac keeps apps in four places, Finder\'s among them', () => {
  assert.deepStrictEqual(appDirs('/Users/a'), ['/Applications', '/System/Applications', '/Users/a/Applications', '/System/Library/CoreServices']);
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

const LIST = [
  { name: 'Visual Studio Code', path: '/Applications/Visual Studio Code.app' },
  { name: 'Google Chrome', path: '/Applications/Google Chrome.app' },
  { name: 'System Settings', path: '/System/Applications/System Settings.app' },
  { name: 'YouTube', path: '/a/YouTube.app' },
  { name: 'YouTube Music', path: '/a/YouTube Music.app' },
  { name: 'Finder', path: '/System/Library/CoreServices/Finder.app' },
];

test('aliases: the names people say for apps', () => {
  assert.strictEqual(aliasFor('VS Code'), 'Visual Studio Code');
  assert.strictEqual(aliasFor('vscode'), 'Visual Studio Code');
  assert.strictEqual(aliasFor('  Settings '), 'System Settings');
  assert.strictEqual(aliasFor('files'), 'Finder');
  assert.strictEqual(aliasFor('Safari'), null);
});

test('findApp: an alias first, then the name picker; its lines when not one app', () => {
  assert.strictEqual(findApp(LIST, 'vs code').app.name, 'Visual Studio Code');
  assert.strictEqual(findApp(LIST, 'chrome').app.name, 'Google Chrome');
  assert.strictEqual(findApp(LIST, 'settings').app.name, 'System Settings');
  assert.strictEqual(findApp(LIST, 'finder').app.name, 'Finder');
  assert.strictEqual(findApp(LIST, 'youtube').app.name, 'YouTube');
  assert.deepStrictEqual(findApp(LIST, 'you'), { kind: 'choose', line: 'Which one: YouTube or YouTube Music?' });
  assert.deepStrictEqual(findApp(LIST, 'Photoshop'), { kind: 'none', line: "I couldn't find Photoshop on this Mac." });
});

test('apps from Spotlight join the folders\' apps, once each', () => {
  const a = folder(['Safari.app']);
  const apps = createApps({ dirs: [a], openPath: async () => '', spotlight: () => ['/Volumes/X/Figma.app', path.join(a, 'Safari.app')] });
  assert.deepStrictEqual(apps.list().map((x) => x.name).sort(), ['Figma', 'Safari']);
  assert.strictEqual(apps.find('figma').app.path, '/Volumes/X/Figma.app');
});

test('Spotlight\'s list: empty until mdfind answers, then kept for 10 minutes', async () => {
  let t = 0;
  let calls = 0;
  const execFile = (file, args, options, cb) => { calls += 1; cb(null, '/Applications/A.app\n/Applications/B.app\n\n'); };
  const spotlight = createSpotlight({ execFile, now: () => t });
  assert.deepStrictEqual(spotlight(), []);
  await new Promise((resolve) => { setImmediate(resolve); });
  assert.deepStrictEqual(spotlight(), ['/Applications/A.app', '/Applications/B.app']);
  t += 5 * 60_000;
  spotlight();
  assert.strictEqual(calls, 1);
  t += 6 * 60_000;
  spotlight();
  assert.strictEqual(calls, 2);
});
