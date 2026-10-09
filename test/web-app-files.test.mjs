// Buddy on iPhone (web/public/app): the page's links and imports point at files that are there, the Home Screen app is
// set up as iOS wants it, and Vercel serves the service worker with the scope it needs.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC = fileURLToPath(new URL('../web/public/', import.meta.url));
const APP = path.join(PUBLIC, 'app');
const html = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(APP, 'manifest.webmanifest'), 'utf8'));
const vercel = JSON.parse(fs.readFileSync(new URL('../web/vercel.json', import.meta.url), 'utf8'));

/** The file a site path is ("/app" is app/index.html), or null when there is none. */
function siteFile(ref) {
  const clean = ref.replace(/[?#].*$/, '').replace(/^\//, '');
  for (const candidate of [clean, path.join(clean, 'index.html')]) {
    const file = path.join(PUBLIC, candidate);
    if (fs.existsSync(file) && fs.statSync(file).isFile()) return file;
  }
  return null;
}

test('every local src and href of the page, and every import map target, is a file of the site', () => {
  const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]).filter((ref) => !/^https?:/.test(ref));
  assert.ok(refs.includes('/app/app.js'));
  for (const ref of refs) {
    assert.ok(ref.startsWith('/'), `${ref}: the page is served at /app (no trailing slash), so its links start with /`);
    assert.ok(siteFile(ref), `${ref} is not in web/public`);
  }
  const map = JSON.parse(/<script type="importmap">([\s\S]*?)<\/script>/.exec(html)[1]);
  assert.ok(siteFile(map.imports.three), map.imports.three);
  assert.ok(siteFile(`${map.imports['three/addons/']}loaders/GLTFLoader.js`), 'the loader');
});

test("every import in the app's own modules points at a file that is there", () => {
  const own = fs.readdirSync(APP).filter((f) => f.endsWith('.js'));
  for (const file of own) {
    const source = fs.readFileSync(path.join(APP, file), 'utf8');
    for (const [, ref] of source.matchAll(/(?:from|import\()\s*'(\.[^']+)'/g)) {
      assert.ok(fs.existsSync(path.join(APP, ref)), `${file} imports ${ref}, which is not there`);
    }
  }
});

test("every element the app's own modules look up by id ($('…')) is in the page", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const file of fs.readdirSync(APP).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(APP, file), 'utf8');
    for (const [, id] of source.matchAll(/\$\('([\w-]+)'\)/g)) assert.ok(ids.has(id), `${file} looks up #${id}, which is not in index.html`);
  }
});

test('the page is a Home Screen app: standalone, its own scope, Buddy\'s icons, and the notch left clear', () => {
  assert.strictEqual(manifest.display, 'standalone');
  assert.strictEqual(manifest.start_url, '/app');
  assert.strictEqual(manifest.scope, '/app');
  for (const icon of manifest.icons) assert.ok(siteFile(icon.src), icon.src);
  assert.match(html, /<meta name="viewport" content="[^"]*viewport-fit=cover/);
  assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/apple-touch-icon.png">/);
  assert.match(html, /<link rel="manifest" href="\/app\/manifest.webmanifest">/);
  const css = fs.readFileSync(path.join(APP, 'app.css'), 'utf8');
  assert.match(css, /env\(safe-area-inset-top/);
  assert.match(css, /env\(safe-area-inset-bottom/);
});

test('Vercel lets the service worker look after /app, and serves the manifest as one', () => {
  const headersOf = (source) => Object.fromEntries((vercel.headers.find((h) => h.source === source)?.headers || []).map((h) => [h.key, h.value]));
  assert.strictEqual(headersOf('/app/sw.js')['Service-Worker-Allowed'], '/app');
  assert.strictEqual(headersOf('/app/sw.js')['Cache-Control'], 'no-cache');
  assert.strictEqual(headersOf('/app/manifest.webmanifest')['Content-Type'], 'application/manifest+json');
});

test('the service worker keeps only the app\'s own files, from the network first', () => {
  const sw = fs.readFileSync(path.join(APP, 'sw.js'), 'utf8');
  assert.match(sw, /const CACHE = 'buddy-app-\d+';/);
  assert.match(sw, /await fetch\(event\.request\)/, 'network first');
  assert.match(sw, /\/\^\\\/app\(\\\/\|\$\)\//, 'only /app');
  assert.match(sw, /if \(response\.ok\) cache\.put\(event\.request, response\.clone\(\)\)\.catch\(\(\) => \{\}\);/,
    'keeping a copy neither holds up nor throws away a good answer from the network');
});
