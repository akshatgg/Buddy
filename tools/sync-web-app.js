'use strict';

/**
 * Buddy on iPhone (web/public/app/) is a web page, so it carries copies of what it reuses from the rest of Buddy:
 *
 *   shared/    shared/'s errors, memory rules and prompts, the Mac's sleep countdown and feelings (src/main/), and the
 *              panel's voice timing: Node modules and a page script, each made into an ES module here; and the buddy
 *              page's own ES modules (src/renderer/buddy/), copied as they are
 *   buddies/   the buddies (assets/buddies/): buddies.json, and each one's .glb and preview
 *   vendor/    three.js from node_modules, with the loader and the studio room the head needs
 *
 * This makes those three folders, and nothing else in web/public/app/. `npm test` fails while they are out of date
 * (test/web-app-sync.test.js).
 *
 *   npm run sync:web-app
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const TO = path.join(ROOT, 'web', 'public', 'app');
const MADE = ['shared', 'buddies', 'vendor']; // the folders this makes; everything else in web/public/app is written by hand

const THREE = 'node_modules/three';
const BUDDY_MODULES = ['blend.js', 'moods.js', 'gestures.js', 'symbols.js', 'symbols.css', 'layout.js'];
const THREE_FILES = [
  'build/three.module.js', 'build/three.core.js', 'LICENSE',
  'examples/jsm/loaders/GLTFLoader.js', 'examples/jsm/utils/BufferGeometryUtils.js', 'examples/jsm/utils/SkeletonUtils.js',
  'examples/jsm/environments/RoomEnvironment.js',
];

/**
 * What goes where: [to, { from, as, name }]. `as` is how: 'copy' (as it is), 'commonjs' (a Node module, made into an
 * ES module with the same exports) or 'script' (a page script: its one global, `name`, becomes the default export).
 */
function plan(root = ROOT) {
  const files = [
    ['shared/errors.js', { from: 'shared/errors.js', as: 'commonjs' }],
    ['shared/memory-rules.js', { from: 'shared/memory-rules.js', as: 'commonjs' }],
    ['shared/prompts.js', { from: 'shared/prompts.js', as: 'commonjs' }],
    ['shared/sleep.js', { from: 'src/main/sleep.js', as: 'commonjs' }],
    ['shared/feelings.js', { from: 'src/main/feelings.js', as: 'commonjs' }],
    ['shared/voice-timing.js', { from: 'src/renderer/panel/voice-timing.js', as: 'script', name: 'VoiceTiming' }],
    ...BUDDY_MODULES.map((file) => [`shared/${file}`, { from: `src/renderer/buddy/${file}`, as: 'copy' }]),
    ['buddies/buddies.json', { from: 'assets/buddies/buddies.json', as: 'copy' }],
  ];
  const buddies = JSON.parse(fs.readFileSync(path.join(root, 'assets', 'buddies', 'buddies.json'), 'utf8'));
  for (const buddy of buddies) {
    for (const file of [buddy.file, buddy.preview]) files.push([`buddies/${file}`, { from: `assets/buddies/${file}`, as: 'copy' }]);
  }
  for (const file of THREE_FILES) files.push([`vendor/three/${file}`, { from: `${THREE}/${file}`, as: 'copy' }]);
  return files;
}

const note = (from) => `// Made by tools/sync-web-app.js from ${from}. Do not edit: run \`npm run sync:web-app\`.\n`;

/**
 * A Node module as an ES module: its code runs as it is, inside a function that is given `module` and `require` (which
 * knows only the module's own files, imported next to it), and what it exports is exported by name.
 */
function fromCommonJs(source, from, root) {
  const deps = [...new Set([...source.matchAll(/require\('(\.\/[\w-]+)'\)/g)].map((m) => m[1]))];
  const names = Object.keys(require(path.join(root, from)));
  return [
    note(from).trimEnd(),
    ...deps.map((dep, i) => `import * as dep${i} from '${dep}.js';`),
    'const module = { exports: {} };',
    `const require = (name) => ({ ${deps.map((dep, i) => `'${dep}': dep${i}`).join(', ')} })[name];`,
    '(function () {',
    source.trimEnd(),
    '})();',
    `export const { ${names.join(', ')} } = module.exports;`,
    '',
  ].join('\n');
}

/** A page script as an ES module: its one global is the default export. */
function fromScript(source, from, name) {
  return `${note(from)}${source.trimEnd()}\nexport default ${name};\n`;
}

/** Every file to make, by its path in web/public/app: { [path]: Buffer }. */
function buildApp(root = ROOT) {
  const out = {};
  for (const [to, { from, as, name }] of plan(root)) {
    const bytes = fs.readFileSync(path.join(root, from));
    if (as === 'copy') out[to] = bytes;
    else if (as === 'commonjs') out[to] = Buffer.from(fromCommonJs(bytes.toString('utf8'), from, root));
    else out[to] = Buffer.from(fromScript(bytes.toString('utf8'), from, name));
  }
  return out;
}

/** Every file in the made folders under `dir`, as paths relative to it (with /), sorted. */
function listMade(dir = TO) {
  return MADE.flatMap((folder) => {
    const at = path.join(dir, folder);
    if (!fs.existsSync(at)) return [];
    return fs.readdirSync(at, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
      .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
  }).sort();
}

function syncWebApp({ root = ROOT, to = TO } = {}) {
  const files = buildApp(root);
  for (const folder of MADE) fs.rmSync(path.join(to, folder), { recursive: true, force: true });
  for (const [file, bytes] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(to, file)), { recursive: true });
    fs.writeFileSync(path.join(to, file), bytes);
  }
  return Object.keys(files).length;
}

if (require.main === module) {
  const count = syncWebApp();
  console.log(`web/public/app now has what it reuses (${count} files in ${MADE.join('/, ')}/)`);
}

module.exports = { syncWebApp, buildApp, listMade, plan, MADE, TO };
