'use strict';

// The website in web/public: its local links and images, and the helpers in site.js.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'web', 'public');
const PAGES = ['index.html', 'privacy.html'].filter((p) => fs.existsSync(path.join(PUBLIC, p)));
const read = (p) => fs.readFileSync(path.join(PUBLIC, p), 'utf8');
const MAC_URL = 'https://github.com/akshatgg/Buddy/releases/latest/download/Buddy-arm64.dmg';

test('the home page exists', () => {
  assert.ok(PAGES.includes('index.html'));
});

for (const page of PAGES) {
  const html = read(page);

  test(`${page}: every local src and href points to a file that exists`, () => {
    const refs = [...html.matchAll(/\s(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    for (const ref of refs) {
      if (/^(https?:|mailto:|#)/.test(ref)) continue;
      const clean = ref.replace(/[?#].*$/, '').replace(/^\//, '');
      const file = clean === '' ? 'index.html' : clean;
      const exists = fs.existsSync(path.join(PUBLIC, file)) || fs.existsSync(path.join(PUBLIC, `${file}.html`));
      assert.ok(exists, `${page} links to ${ref}, which is not in web/public`);
    }
  });

  test(`${page}: every image has an alt`, () => {
    for (const img of html.match(/<img\b[^>]*>/g) || []) assert.match(img, /\salt="/, img);
  });

  test(`${page}: no {{placeholders}} are left`, () => {
    assert.doesNotMatch(html, /\{\{/);
  });
}

test('every Mac download button points at the newest release', () => {
  const html = read('index.html');
  const links = [...html.matchAll(/<a\b[^>]*data-mac-download[^>]*>/g)].map((m) => m[0]);
  assert.ok(links.length >= 2, 'the hero and the download section each have one');
  for (const a of links) assert.ok(a.includes(`href="${MAC_URL}"`), a);
});

const site = require('../web/public/site.js');

test('releaseFacts finds both installers and their sizes', () => {
  const facts = site.releaseFacts({
    tag_name: 'v1.2.0',
    assets: [
      { name: 'Buddy-arm64.dmg', size: 125_829_120 },
      { name: 'Buddy-Setup-x64.exe', size: 94_371_840 },
    ],
  });
  assert.deepStrictEqual(facts, { version: '1.2.0', mac: { size: '120 MB' }, win: { size: '90 MB' } });
});

test('releaseFacts says when an installer is missing', () => {
  assert.deepStrictEqual(site.releaseFacts({ tag_name: 'v0.1.0', assets: [] }), { version: '0.1.0', mac: null, win: null });
  assert.strictEqual(site.releaseFacts(null), null);
  assert.strictEqual(site.releaseFacts({ message: 'Not Found' }), null);
});

test('deviceNote speaks to Windows and phones, and to nobody else', () => {
  assert.match(site.deviceNote('Mozilla/5.0 (Windows NT 10.0; Win64; x64)'), /Windows/);
  assert.match(site.deviceNote('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), /iPhone and Android/);
  assert.match(site.deviceNote('Mozilla/5.0 (Linux; Android 15; Pixel 9)'), /iPhone and Android/);
  assert.strictEqual(site.deviceNote('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)'), '');
});

test('formatSize rounds to whole megabytes', () => {
  assert.strictEqual(site.formatSize(125_829_120), '120 MB');
  assert.strictEqual(site.formatSize(0), '');
});
