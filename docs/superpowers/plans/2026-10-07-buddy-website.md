# Buddy website Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A public download site for Buddy in look A ("Warm & friendly"), served from the `buddy-server` Vercel project.

**Architecture:** Static files in `web/public/` (HTML, one stylesheet, one optional script, images). The script only adds the release version/size, switches the Windows tile on when a Windows installer is released, and shows a note on Windows and phones. A node test checks every local link and image.

**Tech Stack:** HTML, CSS, plain browser JavaScript, `node --test`, ESLint, `sips` + `cwebp` for images, headless Chrome for `og.png`.

## Global Constraints

- Site address: `https://buddywrites.vercel.app` (canonical, Open Graph, sitemap).
- Release asset names: Mac `Buddy-arm64.dmg`, Windows `Buddy-Setup-x64.exe`, from `https://github.com/akshatgg/Buddy/releases/latest/download/<name>`. (The build that produces these names belongs to the release-pipeline plan.)
- Look A tokens: cream `#FFF5E9`, paper `#FFFFFF`, ink `#2A1E17`, ink-2 `#6B5848`, line `#F0DCC5`, orange `#FFB54C`, pink `#FF8FB1`; fonts Baloo 2 (display) + Mukta (body) from Google Fonts.
- Plain JavaScript, no bundler, no framework. ESLint must pass.
- Copy: plain, short English; facts only (no feature that the app lacks without "Coming soon").
- No Co-Authored-By line and no mention of Claude as an author in commits or files. ("Claude" as one of the AI providers stays.)
- Requirements line: Apple chip (M1 or newer), macOS 14 or later.

## File map

| File | Job |
|---|---|
| `web/public/index.html` | home page (replaces the one-line placeholder) |
| `web/public/privacy.html` | privacy page |
| `web/public/style.css` | both pages |
| `web/public/site.js` | enhancements; exports pure helpers for tests |
| `web/public/img/aarav.webp`, `anaya.webp`, `icon.webp` | images |
| `web/public/favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `og.png` | icons, link preview |
| `web/public/site.webmanifest`, `robots.txt`, `sitemap.xml` | metadata |
| `web/vercel.json` | `cleanUrls`, cache headers |
| `test/site.test.js` | links/images/alt/placeholders + site.js helpers |
| `eslint.config.js` | `web/public/*.js` as a browser script |
| `tools/make-site-images.sh`, `tools/og-card.html` | regenerate images and og.png |

---

### Task 1: The site test, images and the home page

**Files:** Create `test/site.test.js`, `tools/make-site-images.sh`, `web/public/img/*`, `web/public/favicon-32.png`, `apple-touch-icon.png`, `icon-192.png`, `icon-512.png`, `web/public/style.css`; replace `web/public/index.html`.

**Interfaces:** Produces the element hooks site.js uses: `[data-mac-download]` (every Mac download link), `[data-mac-meta]` (empty `<small>` for version/size), `[data-win-tile]` (Windows tile), `[data-device-note]` (hidden `<p>` under the hero buttons).

- [ ] **Step 1: Write the failing test** `test/site.test.js`:

```js
'use strict';

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
```

- [ ] **Step 2: Run it, expect FAIL** — `node --test test/site.test.js` → "every Mac download button…" fails (the placeholder page has none).

- [ ] **Step 3: Images.** `tools/make-site-images.sh` (bash, `set -euo pipefail`, run from the repo root): `sips -Z 720` the two previews from `assets/buddies/previews/` and `cwebp -q 82 -alpha_q 90` them to `web/public/img/aarav.webp` and `anaya.webp`; `build/icon.png` → `img/icon.webp` (256), `favicon-32.png` (32), `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` with `sips -Z`. Run it.

- [ ] **Step 4: The page.** `web/public/index.html` and `web/public/style.css` = sample A (scratchpad `looks/look-a.html`, the version shown to the owner) split into HTML + CSS, with these changes:
  - `<head>`: `lang="en"`, title "Buddy — your English buddy on every screen", meta description, canonical `https://buddywrites.vercel.app/`, Open Graph + Twitter tags (`og.png`), icons, manifest, `theme-color #FFF5E9`, Google Fonts `preconnect` + stylesheet, `<link rel="stylesheet" href="/style.css">`, `<script src="/site.js" defer></script>`.
  - images: `/img/icon.webp`, `/img/aarav.webp`, `/img/anaya.webp` with `width`/`height`, `decoding="async"`, `loading="lazy"` below the fold.
  - both Mac buttons: `href="https://github.com/akshatgg/Buddy/releases/latest/download/Buddy-arm64.dmg" data-mac-download`; the tile's file line becomes `<small>Buddy-arm64.dmg <span data-mac-meta></span></small>`.
  - Windows tile gets `data-win-tile`; under the hero buttons `<p class="device-note" data-device-note hidden></p>`.
  - privacy band gets a link "Read the privacy page" → `/privacy`; footer nav: Download, FAQ, Privacy (`/privacy`), GitHub (`https://github.com/akshatgg/Buddy`).
  - FAQ "Is Buddy free?": "Yes, Buddy is free to download. Free answers come with a daily limit. When they're used up or switched off, you can use your own AI key from Claude, OpenAI, Gemini or Groq in Settings."
  - drop the inline `style="padding-top:0"`: use a `.sec--tight` class.
  - CSS keeps the sample's tokens and breakpoints; adds `.device-note`, `.btn[aria-disabled]`, `.skip` link, and `.sec--tight`.

- [ ] **Step 5: Run the test, expect PASS** — `node --test test/site.test.js`.

- [ ] **Step 6: Commit** — `git add test/site.test.js tools/make-site-images.sh web/public && git commit -m "feat(site): the home page, in Buddy's warm look"`.

### Task 2: site.js

**Files:** Create `web/public/site.js`; modify `eslint.config.js`, `test/site.test.js`.

**Interfaces:** Consumes the hooks from Task 1. Produces `module.exports = { releaseFacts, deviceNote, formatSize }` under Node only.

- [ ] **Step 1: Failing tests** (append to `test/site.test.js`):

```js
const site = require('../web/public/site.js');

test('releaseFacts finds both installers and their sizes', () => {
  const facts = site.releaseFacts({
    tag_name: 'v1.2.0',
    assets: [
      { name: 'Buddy-arm64.dmg', size: 125_829_120, browser_download_url: 'https://x/mac' },
      { name: 'Buddy-Setup-x64.exe', size: 94_371_840, browser_download_url: 'https://x/win' },
    ],
  });
  assert.deepStrictEqual(facts, { version: '1.2.0', mac: { size: '120 MB' }, win: { size: '90 MB' } });
});

test('releaseFacts says when an installer is missing', () => {
  assert.deepStrictEqual(site.releaseFacts({ tag_name: 'v0.1.0', assets: [] }), { version: '0.1.0', mac: null, win: null });
  assert.strictEqual(site.releaseFacts(null), null);
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
```

- [ ] **Step 2: Run, expect FAIL** — "Cannot find module '../web/public/site.js'".

- [ ] **Step 3: Implement** `web/public/site.js`:

```js
/* Buddy's site: everything here is extra. Without it the page reads and every download link works. */
(function (root) {
  'use strict';

  var MAC = 'Buddy-arm64.dmg';
  var WIN = 'Buddy-Setup-x64.exe';
  var RELEASES = 'https://github.com/akshatgg/Buddy/releases';

  function formatSize(bytes) {
    return bytes > 0 ? Math.round(bytes / 1048576) + ' MB' : '';
  }

  /** What the newest release offers: { version, mac: { size } | null, win: { size } | null }, or null. */
  function releaseFacts(release) {
    if (!release || !Array.isArray(release.assets)) return null;
    function find(name) {
      var a = release.assets.find(function (x) { return x && x.name === name; });
      return a ? { size: formatSize(a.size) } : null;
    }
    return { version: String(release.tag_name || '').replace(/^v/, ''), mac: find(MAC), win: find(WIN) };
  }

  /** A line for visitors whose device Buddy does not run on yet, or ''. */
  function deviceNote(ua) {
    if (/iPhone|iPad|iPod|Android/i.test(ua)) return 'Buddy is for Mac right now. iPhone and Android are coming soon.';
    if (/Windows/i.test(ua)) return 'Buddy for Windows is coming soon. Right now it runs on Mac.';
    return '';
  }

  if (typeof module === 'object' && module.exports) {
    module.exports = { releaseFacts: releaseFacts, deviceNote: deviceNote, formatSize: formatSize };
    return;
  }

  var doc = root.document;
  function each(sel, fn) { Array.prototype.forEach.call(doc.querySelectorAll(sel), fn); }

  function showWindows(size) {
    each('[data-win-tile]', function (tile) {
      var tag = tile.querySelector('.tag');
      var a = doc.createElement('a');
      a.className = 'btn btn--ink';
      a.href = RELEASES + '/latest/download/' + WIN;
      a.textContent = 'Download for Windows';
      if (tag) tag.replaceWith(a); else tile.appendChild(a);
      var small = doc.createElement('small');
      small.textContent = WIN + (size ? ' · ' + size : '');
      tile.appendChild(small);
    });
  }

  var note = deviceNote(root.navigator.userAgent || '');
  each('[data-device-note]', function (p) { if (note) { p.textContent = note; p.hidden = false; } });

  if (!root.fetch) return;
  root.fetch('https://api.github.com/repos/akshatgg/Buddy/releases/latest', { headers: { Accept: 'application/vnd.github+json' } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (release) {
      var facts = releaseFacts(release);
      if (!facts) return;
      if (facts.mac) {
        each('[data-mac-meta]', function (el) { el.textContent = '· Version ' + facts.version + ' · ' + facts.mac.size; });
      } else {
        each('[data-mac-download]', function (a) { a.href = RELEASES; });
      }
      if (facts.win) {
        showWindows(facts.win.size);
        if (/Windows/i.test(root.navigator.userAgent || '')) each('[data-device-note]', function (p) { p.hidden = true; });
      }
    })
    .catch(function () { /* offline or rate-limited: the plain links still work */ });
})(this);
```

- [ ] **Step 4: ESLint** — add to `eslint.config.js` before the closing `]`:

```js
  {
    // The website's one script: a plain browser script that also exports its helpers to the tests.
    files: ['web/public/**/*.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, module: 'writable' } },
    rules,
  },
```

and add `'web/public/**'` to the CommonJS block's `ignores` so it is linted only as a browser script.

- [ ] **Step 5: Run** `npm test` → all pass.
- [ ] **Step 6: Commit** — `feat(site): show the release version, offer Windows when it ships, and a note on phones`.

### Task 3: The privacy page

**Files:** Create `web/public/privacy.html` (same header/footer and stylesheet; a `.prose` column ≤ 68ch).

Content (spec §5): What Buddy keeps (Google name and email; when you joined and were last active; how many free answers you used today; whether the account is blocked — in Cloud Firestore, Google Cloud). What Buddy never keeps (what you write, screenshots, answers, your AI key — stays on your computer, encrypted). Where your text goes (to the AI that writes the answer: the one free answers use, or the one whose key you added; only to get the answer). Permissions on your Mac (Accessibility to copy and paste; Screen Recording only for Check screen). Deleting your data (email akshatg9636@gmail.com; the account record is deleted). Updated 7 October 2026.

- [ ] Write the page; `node --test test/site.test.js` passes (privacy.html is picked up automatically); commit `feat(site): a privacy page in plain words`.

### Task 4: Link preview, metadata, Vercel config

**Files:** Create `tools/og-card.html`, `web/public/og.png`, `site.webmanifest`, `robots.txt`, `sitemap.xml`; modify `web/vercel.json`, `README.md`, `web/README.md`.

- [ ] `tools/og-card.html`: 1200×630 card in look A (cream, headline "Your English buddy, on every screen.", both buddies, "Free for Mac"); render with `"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" --headless=new --hide-scrollbars --window-size=1200,630 --screenshot=web/public/og.png tools/og-card.html`; add the command to `tools/make-site-images.sh`.
- [ ] `site.webmanifest` (name Buddy, icons 192/512, `theme_color`/`background_color` `#FFF5E9`, `display: browser`); `robots.txt` (allow all, `Disallow: /api/`, sitemap line); `sitemap.xml` (`/` and `/privacy`).
- [ ] `web/vercel.json`: add `"cleanUrls": true`, `"trailingSlash": false`; headers: images and fonts `Cache-Control: public, max-age=86400, stale-while-revalidate=604800`; `/site.webmanifest` content type `application/manifest+json`; `/api/(.*)` `X-Robots-Tag: noindex`. Keep the existing two headers on `/(.*)`.
- [ ] README: a "Website" section (where it lives, `tools/make-site-images.sh`, deploy with `npm run deploy:server`); `web/README.md`: one line that `public/` is the website.
- [ ] `npm test` passes; commit `feat(site): link preview, icons, sitemap and caching`.

### Task 5: Check it

- [ ] Overflow check at 1280, 820, 390, 360 px for `/` and `/privacy` (iframe harness, scrollWidth == width).
- [ ] Screenshots at 1280 and 390; fix what they show.
- [ ] Serve `web/public` on `127.0.0.1` and show the owner.
- [ ] `npm test` passes; commit any fixes.
