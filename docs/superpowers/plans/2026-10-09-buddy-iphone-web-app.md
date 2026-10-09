# Buddy on iPhone: the web app — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Buddy on iPhone as a web app at `https://buddywrites.vercel.app/app`, added to the Home Screen from Safari: Google sign-in, the real 3D head with its feelings, the chat with Copy/Share and phone-only memory, voice, Claude mode, and Web Push notifications when a Claude Code session finishes or needs the person.

**Architecture:** Plain ES modules in `web/public/app/`, deployed with the server. Pure modules (store, memory, api, chat-core, claude-core, motion, voice, push, auth helpers) are tested with `node --test`; thin DOM modules (head, chat, claude, settings, app) draw them. `tools/sync-web-app.js` copies what the app reuses from the desktop (shared rules, the buddy page's animation modules, the head `.glb` files, three.js) into `web/public/app/{shared,buddies,vendor}/`, wrapping CommonJS as ES modules, and a test fails while the copy is stale. The server gains `POST /api/push`, `pushKey` in `GET /api/config`, a `push/{uid}` Firestore record, and a trigger in `POST /api/remote/mac` that sends a notification when a session goes from working to done or waiting.

**Tech Stack:** HTML/CSS/ES modules (no framework, no bundler), three.js 0.186 (vendored), Firebase Auth web SDK 13.0.0 from gstatic, MediaRecorder + Web Audio, Service Worker + Web Push, Vercel functions (CommonJS, Node 22), `web-push` ^3.6.7, Firestore through firebase-admin, `node:test`, ESLint 10.

## Global Constraints

- Work only in the git worktree `/Users/akshat/projects/buddy-iphone` on branch `iphone`. Never touch `/Users/akshat/projects/buddy` or any other worktree (other sessions work there).
- No `Co-Authored-By` lines and no Claude/AI attribution in any commit message, PR text or file (the owner's rule).
- `npm test` at the worktree root must pass after every task (baseline before Task 1: 1426 tests, 1425 pass, 1 skipped, 0 fail).
- Free, no Apple Developer account: the app is a web page at `https://buddywrites.vercel.app/app`, added with Share → Add to Home Screen; it updates by itself (the next open after a deploy loads the new version).
- All new browser code: plain ES modules, no framework, no bundler; short plain-English comments like the existing files.
- Sign-in: Google through Firebase Auth's web SDK, pinned version, from `https://www.gstatic.com/firebasejs/13.0.0/`, `signInWithRedirect`, `authDomain` = `buddywrites.vercel.app`, project `buddy-7f8c2`; `web/vercel.json` rewrites `/__/auth/:path*` and `/__/firebase/:path*` to `https://buddy-7f8c2.firebaseapp.com/...`. The ID token goes to the server as `Authorization: Bearer`, the same as the Mac.
- Chat: the desktop panel's first step exactly (`action: 'chat'`, `message`, `history` (last 6), `facts`, `userName`, `step: 1`); never a `box`, `image`, `selection` or `appName`. A `box`/`screen` answer shows "I can't see other apps on iPhone. Paste the text here." `doIt`/`send` are ignored; text answers get Copy and Share. No own-key mode on the phone.
- Memory: on the phone only (localStorage), through `shared/memory-rules.js` `cleanFact`, at most 50, Settings lists and deletes facts.
- Voice: MediaRecorder (`audio/mp4` in Safari) → `POST /api/transcribe` `{ audio, mime }`; listening mood while recording.
- Claude mode: `GET /api/remote/phone?session=` every 2 s only while the Claude tab is open and the app is visible; `POST { action: 'stop' }` on leaving; `POST { action: 'send', session, text }`; sessions grouped by computer; full screen view; `/app#claude/<session>` opens a session.
- Notifications: Web Push (iOS 16.4+, Home Screen app only, allowed from a tap). `POST /api/push` `{ action: 'on', subscription }` / `{ action: 'off', endpoint }`; at most 5 subscriptions, newest kept; env vars `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`; `GET /api/config` adds `pushKey` only when set; a session going `working` → `done` / `waiting` sends one push titled with its name, body "Claude Code finished" / "Claude Code needs you", not for the session being watched right now; 404/410 removes that subscription; push failures never fail the Mac's report; tapping opens `/app#claude/<session>`.
- Errors: every network call has a timeout; texts: "No internet.", the server's own error text, "Sign in again." on 401 (after one retry with a fresh token) then sign-in; mic denied: "Allow the microphone in Settings → Safari."; push unavailable: "Add Buddy to your Home Screen first…".
- Do not break the Mac, Windows or Android apps: server changes are additive (`pushKey` only appears when set; `push_off` is a new error code).

## Notes on the spec (facts found in the code, applied in this plan)

1. **Push subscriptions live in `push/{uid}`, not in `remote/{uid}.push`.** `remote.macReport` rebuilds the record as `{ devices, watch, feed, inbox }` (any other field is dropped on the next report), and the record is deleted when the last computer turns sharing off. A separate record with the same transaction pattern (`updatePush`, like `updateRemote`) keeps phones subscribed whatever the Mac does.
2. **The manifest's `start_url` and `scope` are `/app`, not `/app/`.** `web/vercel.json` has `cleanUrls: true` and `trailingSlash: false`, so `/app/` redirects to `/app`, and a scope of `/app/` would not cover the page. The service worker stays at `/app/sw.js` and is allowed the wider `/app` scope with a `Service-Worker-Allowed: /app` header. For the same reason every link in `app/index.html` is absolute (`/app/app.js`): relative links from `/app` resolve to `/`.
3. **Polling is every 2 s** as the spec says; Android's `ClaudeModel.kt` polls every 1.5 s.
4. **Offline computers cannot be greyed:** `remote.phoneLook` returns only computers seen in the last 45 s. The list groups the online ones by computer and says when none is sharing.
5. **Token refresh:** the Firebase SDK renews the ID token itself before it expires; `token()` always gives a fresh one. What is tested instead is `api.js`: a 401 retries once with `token(true)`, and a second 401 signs out.
6. **Celebrate** plays when an answer is copied or shared (the phone's "put it in the app", which is when the Mac celebrates); a normal answer makes the buddy **happy**, as on the Mac.
7. The server's `free_off` text says "Add your own key in Settings", which the phone has not, so the phone shows "Free AI is off right now. Try again later." Every other server error text is shown as it is.
8. Adding the `push_off` error code requires adding it to `SERVER_CODES` in `src/main/cloud.js` (`test/cloud.test.js` keeps that list equal to the server's `STATUS`).
9. The local browser check cannot sign in (`/api` is not served locally, and Google redirects to the production domain), so the chat round trip, Claude list, voice and notifications are checked on the real iPhone after deploy (`docs/manual-checklist-iphone.md`).
10. 🎤 is in the Claude box too (as on Android), not only in the chat.
11. The sync also copies `src/main/sleep.js` (sleep timings), `src/main/feelings.js` (`buddyLevel`), `src/renderer/panel/voice-timing.js` (when listening ends) and `src/renderer/buddy/layout.js` (raycasting, symbol placement), and the buddies' preview images for Settings.
12. A small `tools/serve-web.js` (`npm run serve:web`) serves `web/public` the way Vercel does, for the browser check.
13. The Firebase project has no "Buddy iPhone" web app yet (`firebase apps:list --project buddy-7f8c2` shows "Buddy Android" and "Buddy Mac"); Task 5 creates it.

## File Structure

New, hand-written (`web/public/app/`):

| File | Responsibility |
|---|---|
| `index.html` | The one page: head on top, sign-in, Chat / Claude / Settings panes, tabs; import map for three.js; Home Screen meta tags |
| `app.css` | The site's warm look for a phone; safe-area insets; full-screen mode |
| `manifest.webmanifest` | Home Screen app: standalone, `/app`, icons |
| `package.json` | `{"type": "module"}` so Node's tests import the app's files as ES modules (as `src/renderer/buddy/package.json` does) |
| `sw.js` | Service worker: network-first cache of `/app` files; push → notification; notification tap → `/app#claude/<session>` |
| `config.js` | The "Buddy iPhone" Firebase web config and the pinned SDK URL |
| `store.js` | localStorage behind `get`/`set`, JSON values under `buddy.<key>` |
| `memory.js` | Facts Buddy knows, the Mac's rules |
| `api.js` | `fetch` to `/api/*` with the token, timeouts, error words, 401 retry |
| `auth.js` | Firebase Auth: start, sign in by redirect, sign out, token |
| `chat-core.js` | The chat without the DOM: request body, answers, remember, retry, forget |
| `claude-core.js` | Claude mode without the DOM: list, open, poll every 2 s while in view, stop, send |
| `motion.js` | Shake detector for DeviceMotion |
| `voice.js` | Record, auto-stop, transcribe |
| `push.js` | Web Push on the phone: support check, subscribe, send to server, switch off |
| `head.js` | three.js head (Head node only), moods, blink, fidgets, symbols, petting, pause |
| `dom.js` | `$`, `make`, `button`, `grow` |
| `chat.js` | The Chat tab's drawing, Copy / Share |
| `claude.js` | The Claude tab's drawing, full screen |
| `settings.js` | Buddy choice, memory, notifications switch, account |
| `app.js` | Starts everything, tabs, signed in/out, feelings, deep link |

Made by `tools/sync-web-app.js` (committed, like `web/shared/`): `web/public/app/shared/` (errors, memory-rules, prompts, sleep, feelings, voice-timing as ES modules; blend, moods, gestures, symbols(.css), layout copied), `web/public/app/buddies/` (buddies.json, `.glb` files, previews), `web/public/app/vendor/three/` (three.module.js, three.core.js, GLTFLoader, BufferGeometryUtils, SkeletonUtils, RoomEnvironment, LICENSE).

New elsewhere: `tools/sync-web-app.js`, `tools/serve-web.js`, `web/lib/push.js`, `web/api/push.js`, `docs/manual-checklist-iphone.md`, tests `test/web-app-*.test.mjs`, `test/web-app-sync.test.js`, `test/serve-web.test.js`, `test/server-push.test.js`.

Modified: `package.json` (scripts), `eslint.config.js`, `web/vercel.json`, `web/package.json` (+ lock), `web/lib/handlers.js`, `web/lib/remote.js`, `web/lib/deps.js`, `web/lib/firestore-db.js`, `test/helpers/fake-db.js`, `src/main/cloud.js`, `test/server-runtime.test.js`, `test/server-vercel.test.js`, `test/firestore/firestore-db.test.js`, `web/public/index.html`, `web/public/site.js`, `test/site.test.js`, `web/README.md`.

---

### Task 1: The sync tool and the app's shell

**Files:**
- Create: `tools/sync-web-app.js`, `tools/serve-web.js`, `test/web-app-sync.test.js`, `test/serve-web.test.js`, `test/web-app-files.test.mjs`
- Create: `web/public/app/package.json`, `web/public/app/index.html`, `web/public/app/app.css`, `web/public/app/manifest.webmanifest`, `web/public/app/sw.js`, `web/public/app/app.js`
- Create (generated by the tool): `web/public/app/shared/**`, `web/public/app/buddies/**`, `web/public/app/vendor/**`
- Modify: `package.json` (scripts), `eslint.config.js`, `web/vercel.json` (headers)

**Interfaces:**
- Produces: `tools/sync-web-app.js` exports `{ syncWebApp({ root?, to? }) -> number, buildApp(root?) -> { [path]: Buffer }, listMade(dir?) -> string[], plan(root?), MADE, TO }`. `npm run sync:web-app`. Generated ES modules: `./shared/errors.js` (`BuddyError`), `./shared/memory-rules.js` (`cleanFact`, `MAX_FACTS`, …), `./shared/prompts.js` (`LIMITS`, `CHAT_LIMITS`, `buildPrompt`, `parseChat`, …), `./shared/sleep.js` (`createSleep`, `DROWSY_MS`, `ASLEEP_MS`), `./shared/feelings.js` (`buddyLevel`, `createFeelings`), `./shared/voice-timing.js` (default export `VoiceTiming`), `./shared/{blend,moods,gestures,symbols,layout}.js`, `./shared/symbols.css`.
- Produces: `tools/serve-web.js` exports `{ fileFor(urlPath, root?) -> string|null, headersFor(file, root?) -> object, serve({ port?, root? }) }`. `npm run serve:web` (port 8787).
- Produces: the page's element ids used by every later task: `app`, `stage`, `head` (canvas), `symbols`, `bubble`, `signin`, `signin-button`, `signin-error`, `chat-pane`, `chat-items`, `chat-empty`, `chat-error`, `chat-form`, `chat-mic`, `chat-input`, `chat-send`, `claude-pane`, `claude-pick`, `claude-groups`, `claude-note`, `claude-again`, `claude-session`, `claude-back`, `claude-name`, `claude-status`, `claude-full`, `claude-items`, `claude-problem`, `claude-error`, `claude-form`, `claude-mic`, `claude-input`, `claude-send`, `settings-pane`, `buddy-choice`, `learn`, `facts`, `facts-empty`, `fact-form`, `fact-input`, `fact-error`, `forget-all`, `push-switch`, `push-note`, `account-email`, `signout`, `tabs` (buttons with `data-tab="chat|claude|settings"`).

- [ ] **Step 1: Check the baseline**

Run: `cd /Users/akshat/projects/buddy-iphone && git status && git branch --show-current && ls node_modules/three/package.json`
Expected: clean tree on `iphone`. If `node_modules` is missing, run `ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm ci --no-audit --no-fund` first.

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"`
Expected: `# tests 1426`, `# pass 1425`, `# fail 0`, `# skipped 1`.

- [ ] **Step 2: Write the failing sync test**

Create `test/web-app-sync.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { syncWebApp, buildApp, listMade, TO } = require('../tools/sync-web-app');

test('web/public/app has exactly what it reuses, as it is now (run `npm run sync:web-app` after changing it)', () => {
  const files = buildApp();
  assert.ok(files['shared/memory-rules.js'] && files['vendor/three/build/three.module.js'] && files['buddies/buddies.json'], 'the plan finds its files');
  assert.deepStrictEqual(listMade(TO), Object.keys(files).sort(), 'the same files');
  for (const [file, bytes] of Object.entries(files)) {
    assert.ok(fs.readFileSync(path.join(TO, file)).equals(bytes), `${file} is the same`);
  }
});

test('the Node modules made into ES modules answer as they do in Node', async () => {
  const url = (file) => pathToFileURL(path.join(TO, 'shared', file)).href;
  const rules = await import(url('memory-rules.js'));
  const node = require('../shared/memory-rules');
  for (const fact of ['  Your boss is\nMr. Sharma. ', 'My password is x', 'PIN code 411001', '4111 1111 1111 1111']) {
    assert.strictEqual(rules.cleanFact(fact), node.cleanFact(fact), fact);
  }
  assert.strictEqual(rules.MAX_FACTS, node.MAX_FACTS);
  const prompts = await import(url('prompts.js'));
  assert.deepStrictEqual(prompts.LIMITS, require('../shared/prompts').LIMITS);
  assert.throws(() => prompts.buildPrompt('chat', {}), (err) => err.name === 'BuddyError' && err.code === 'bad_request');
  const sleep = await import(url('sleep.js'));
  assert.deepStrictEqual([sleep.DROWSY_MS, sleep.ASLEEP_MS], [60_000, 120_000]);
  const { default: VoiceTiming } = await import(url('voice-timing.js'));
  assert.strictEqual(VoiceTiming.recordingMime('audio/mp4;codecs=mp4a.40.2'), 'audio/mp4');
  const { buddyLevel } = await import(url('feelings.js'));
  assert.strictEqual(buddyLevel(0.1), 0.5);
});

test('the sync makes only its own folders: stale files in them go, the hand-written files stay', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-app-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'shared'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'shared', 'stale.js'), 'old');
  fs.writeFileSync(path.join(dir, 'app.js'), 'mine');
  syncWebApp({ to: dir });
  assert.ok(!fs.existsSync(path.join(dir, 'shared', 'stale.js')));
  assert.strictEqual(fs.readFileSync(path.join(dir, 'app.js'), 'utf8'), 'mine');
  assert.deepStrictEqual(listMade(dir), Object.keys(buildApp()).sort());
});
```

- [ ] **Step 3: Run it to see it fail**

Run: `node --test test/web-app-sync.test.js`
Expected: FAIL with `Cannot find module '../tools/sync-web-app'`.

- [ ] **Step 4: Write the sync tool**

Create `tools/sync-web-app.js`:

```js
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
```

Create `web/public/app/package.json` (Node reads the app's `.js` files as ES modules, like `src/renderer/buddy/package.json`):

```json
{"type":"module"}
```

Add the two scripts and make `deploy:server` run the new sync. In `package.json`:

Find:

```json
    "sync:android": "node tools/sync-android-shared.js",
```

Replace with:

```json
    "sync:web-app": "node tools/sync-web-app.js",
    "serve:web": "node tools/serve-web.js",
    "sync:android": "node tools/sync-android-shared.js",
```

Find:

```json
"deploy:server": "npm run sync:web && vercel deploy --prod --cwd web"
```

Replace with:

```json
"deploy:server": "npm run sync:web && npm run sync:web-app && vercel deploy --prod --cwd web"
```

- [ ] **Step 5: Run the sync, then the test**

Run: `npm run sync:web-app`
Expected: `web/public/app now has what it reuses (24 files in shared/, buddies/, vendor/)`

Run: `node --test test/web-app-sync.test.js`
Expected: `# pass 3`, `# fail 0`.

- [ ] **Step 6: Write the failing tests for the local server and the shell**

Create `test/serve-web.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fileFor, headersFor } = require('../tools/serve-web');

const PUBLIC = path.join(__dirname, '..', 'web', 'public');

test('the local server finds files as Vercel does: /app is the app, /privacy is privacy.html', () => {
  assert.strictEqual(fileFor('/app'), path.join(PUBLIC, 'app', 'index.html'));
  assert.strictEqual(fileFor('/app/app.js?v=1'), path.join(PUBLIC, 'app', 'app.js'));
  assert.strictEqual(fileFor('/privacy'), path.join(PUBLIC, 'privacy.html'));
  assert.strictEqual(fileFor('/'), path.join(PUBLIC, 'index.html'));
  assert.strictEqual(fileFor('/nope'), null);
  assert.strictEqual(fileFor('/../package.json'), null, 'nothing outside web/public');
  assert.strictEqual(fileFor('/%E0%A4%A'), null, 'a path that is not text');
});

test('the local server sends the types and the service worker header that web/vercel.json sends', () => {
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'sw.js'))['service-worker-allowed'], '/app');
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'app.js'))['content-type'], 'text/javascript; charset=utf-8');
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'manifest.webmanifest'))['content-type'], 'application/manifest+json');
  assert.ok(!('service-worker-allowed' in headersFor(path.join(PUBLIC, 'app', 'app.js'))));
});
```

Create `test/web-app-files.test.mjs`:

```js
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
});
```

Run: `node --test test/serve-web.test.js test/web-app-files.test.mjs`
Expected: FAIL (`Cannot find module '../tools/serve-web'`, and `ENOENT ... web/public/app/index.html`).

- [ ] **Step 7: Write the local server**

Create `tools/serve-web.js`:

```js
'use strict';

/**
 * The website (web/public) on this computer, served the way Vercel serves it, to try Buddy on iPhone in a browser: clean
 * URLs (/app is app/index.html, /privacy is privacy.html), the service worker's scope header, and each file's type.
 * /api is not served here, so the app stays signed out.
 *
 *   npm run serve:web          then open http://localhost:8787/app
 */

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const PUBLIC = path.join(__dirname, '..', 'web', 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.glb': 'model/gltf-binary',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
};

/** The file under `root` that a URL path is, as Vercel's clean URLs find it, or null. */
function fileFor(urlPath, root = PUBLIC) {
  let clean;
  try {
    clean = decodeURIComponent(urlPath.split(/[?#]/)[0]);
  } catch {
    return null;
  }
  const base = path.join(root, clean);
  if (base !== root && !base.startsWith(root + path.sep)) return null;
  for (const candidate of [base, `${base}.html`, path.join(base, 'index.html')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

/** The headers Vercel sends with a file (web/vercel.json): its type, and the service worker's wider scope. */
function headersFor(file, root = PUBLIC) {
  const headers = { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' };
  if (path.relative(root, file) === path.join('app', 'sw.js')) headers['service-worker-allowed'] = '/app';
  return headers;
}

function serve({ port = Number(process.env.PORT) || 8787, root = PUBLIC } = {}) {
  const server = http.createServer((req, res) => {
    const file = fileFor(req.url, root);
    if (!file) {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      res.end('Not found');
      return;
    }
    res.writeHead(200, headersFor(file, root));
    fs.createReadStream(file).pipe(res);
  });
  return server.listen(port, () => console.log(`Buddy's site: http://localhost:${port}  (Buddy on iPhone: /app)`));
}

if (require.main === module) serve();

module.exports = { fileFor, headersFor, serve };
```

- [ ] **Step 8: Write the shell: page, look, manifest, service worker, app.js**

Create `web/public/app/index.html` (all of the app's markup; later tasks only add scripts):

```html
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>Buddy</title>
<meta name="description" content="Buddy on your iPhone: chat in English, Hindi or Hinglish, and watch your Claude Code sessions.">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#FFF5E9">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Buddy">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<link rel="manifest" href="/app/manifest.webmanifest">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32.png">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Baloo+2:wght@700;800&family=Mukta:wght@400;500;600&display=swap">
<link rel="stylesheet" href="/app/app.css">
<link rel="stylesheet" href="/app/shared/symbols.css">
<script type="importmap">
{
  "imports": {
    "three": "/app/vendor/three/build/three.module.js",
    "three/addons/": "/app/vendor/three/examples/jsm/"
  }
}
</script>
<script type="module" src="/app/app.js"></script>
</head>
<body>
<div class="app" id="app" data-signed="unknown">
  <section class="stage" id="stage" aria-label="Your buddy">
    <canvas id="head"></canvas>
    <div id="symbols"></div>
    <p class="bubble" id="bubble" role="status" hidden></p>
  </section>

  <section class="signin" id="signin" hidden>
    <h1>Hi! I'm Buddy.</h1>
    <p>Sign in with the same Google account as on your computer.</p>
    <button class="btn btn--ink" id="signin-button" type="button">Sign in with Google</button>
    <p class="error" id="signin-error" role="alert" hidden></p>
  </section>

  <section class="pane" id="chat-pane" aria-label="Chat" hidden>
    <ol class="items" id="chat-items" aria-live="polite"></ol>
    <p class="empty" id="chat-empty">Ask me anything, in English, Hindi or Hinglish.<br>“boss ko mail likho, kal chutti chahiye”</p>
    <p class="error" id="chat-error" role="alert" hidden></p>
    <form class="box" id="chat-form">
      <button class="icon mic" id="chat-mic" type="button" aria-label="Speak" aria-pressed="false" hidden>🎤</button>
      <textarea id="chat-input" rows="1" placeholder="Ask Buddy…" enterkeyhint="send" aria-label="Your message"></textarea>
      <button class="icon send" id="chat-send" type="submit" aria-label="Send" disabled>↑</button>
    </form>
  </section>

  <section class="pane" id="claude-pane" aria-label="Claude Code" hidden>
    <div class="claude-pick" id="claude-pick">
      <h2>Your Claude Code sessions</h2>
      <div class="groups" id="claude-groups"></div>
      <p class="muted" id="claude-note" hidden></p>
      <button class="btn btn--ghost btn--sm" id="claude-again" type="button">Look again</button>
    </div>
    <div class="claude-session" id="claude-session" hidden>
      <div class="claude-bar">
        <button class="icon" id="claude-back" type="button" aria-label="Back to the sessions">‹</button>
        <span class="grow" id="claude-name"></span>
        <span class="status-chip" id="claude-status"></span>
        <button class="icon" id="claude-full" type="button" aria-label="Full screen">⤢</button>
      </div>
      <ol class="claude-items" id="claude-items" aria-live="polite"></ol>
      <p class="error" id="claude-problem" role="alert" hidden></p>
      <p class="error" id="claude-error" role="alert" hidden></p>
      <form class="box" id="claude-form">
        <button class="icon mic" id="claude-mic" type="button" aria-label="Speak" aria-pressed="false" hidden>🎤</button>
        <textarea id="claude-input" rows="1" enterkeyhint="send" aria-label="Message Claude"></textarea>
        <button class="icon send" id="claude-send" type="submit" aria-label="Send" disabled>↑</button>
      </form>
    </div>
  </section>

  <section class="pane settings" id="settings-pane" aria-label="Settings" hidden>
    <h2>Your buddy</h2>
    <div class="buddies" id="buddy-choice"></div>

    <h2>Memory</h2>
    <label class="switch"><span>Learn about me from chats</span><input type="checkbox" id="learn"></label>
    <ul class="facts" id="facts"></ul>
    <p class="muted" id="facts-empty">Buddy doesn't know anything about you yet.</p>
    <form class="row" id="fact-form">
      <input class="field" id="fact-input" type="text" placeholder="Something Buddy should know" aria-label="Something Buddy should know">
      <button class="btn btn--ghost btn--sm" type="submit">Add</button>
    </form>
    <p class="error" id="fact-error" role="alert" hidden></p>
    <button class="btn btn--ghost btn--sm" id="forget-all" type="button">Forget everything</button>

    <h2>Notifications</h2>
    <label class="switch"><span>Tell me when Claude Code finishes or needs me</span><input type="checkbox" id="push-switch"></label>
    <p class="muted" id="push-note" hidden></p>

    <h2>Account</h2>
    <p class="muted" id="account-email"></p>
    <button class="btn btn--ghost btn--sm" id="signout" type="button">Sign out</button>
  </section>

  <nav class="tabs" id="tabs" aria-label="Buddy" hidden>
    <button type="button" data-tab="chat" aria-pressed="true">Chat</button>
    <button type="button" data-tab="claude" aria-pressed="false">Claude</button>
    <button type="button" data-tab="settings" aria-pressed="false">Settings</button>
  </nav>
</div>
</body>
</html>
```

Create `web/public/app/app.css`:

```css
/* Buddy on iPhone: the website's warm look (web/public/style.css, look A), made for a phone in one hand. The head on
   top, the chat (or Claude Code, or Settings) under it, the tabs at the bottom. The notch and the home bar are left
   clear (the safe-area insets: the page runs under them, as viewport-fit=cover asks). */
:root {
  --cream: #FFF5E9;
  --paper: #FFFFFF;
  --ink: #2A1E17;
  --ink-2: #6B5848;
  --line: #F0DCC5;
  --orange: #FFB54C;
  --orange-tint: #FFE6C2;
  --ok-bg: #EAF7EC;
  --ok-ink: #23663A;
  --bad-bg: #FDE8E1;
  --bad-ink: #B0472A;
  --display: "Baloo 2", "Arial Rounded MT Bold", system-ui, sans-serif;
  --body: "Mukta", system-ui, -apple-system, sans-serif;
  --top: env(safe-area-inset-top, 0px);
  --bottom: env(safe-area-inset-bottom, 0px);
  --left: env(safe-area-inset-left, 0px);
  --right: env(safe-area-inset-right, 0px);
  color-scheme: light;
}

*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; }
body { background: var(--cream); color: var(--ink); font: 400 17px/1.45 var(--body); -webkit-font-smoothing: antialiased; -webkit-tap-highlight-color: transparent; overscroll-behavior: none; }
button, input, textarea { font: inherit; color: inherit; }
button { cursor: pointer; }
[hidden] { display: none !important; }

.app { display: flex; flex-direction: column; height: 100dvh; padding: var(--top) var(--right) 0 var(--left); }

/* the head */
.stage { position: relative; flex: none; height: 32dvh; min-height: 170px; }
.app[data-signed="out"] .stage { height: 50dvh; }
.stage canvas { display: block; width: 100%; height: 100%; touch-action: none; }
.bubble { position: absolute; left: 50%; bottom: 6px; margin: 0; padding: 5px 14px; border-radius: 999px; background: var(--ink); color: var(--cream); font-size: 15px; font-weight: 500; white-space: nowrap; transform: translateX(-50%); }

/* signed out */
.signin { display: grid; gap: 14px; justify-items: center; padding: 0 24px calc(24px + var(--bottom)); text-align: center; }
.signin h1 { margin: 0; font: 800 34px/1.05 var(--display); }
.signin p { margin: 0; max-width: 30ch; color: var(--ink-2); }

/* shared parts */
.pane { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.btn { display: inline-flex; align-items: center; justify-content: center; gap: 8px; padding: 14px 24px; border: 2px solid transparent; border-radius: 999px; font-weight: 600; }
.btn--ink { background: var(--ink); color: var(--cream); }
.btn--ghost { border-color: var(--ink); background: transparent; }
.btn--sm { padding: 8px 16px; font-size: 15px; }
.icon { display: grid; flex: none; place-items: center; width: 44px; height: 44px; padding: 0; border: 0; border-radius: 50%; background: transparent; font-size: 20px; }
.icon:disabled { opacity: .35; }
.send { background: var(--ink); color: var(--cream); font-weight: 700; }
.mic[aria-pressed="true"] { background: var(--orange); }
.muted { margin: 0; color: var(--ink-2); font-size: 15px; }
.error { margin: 0 12px 8px; padding: 8px 12px; border-radius: 12px; background: var(--bad-bg); color: var(--bad-ink); font-size: 15px; }
.box { display: flex; flex: none; align-items: flex-end; gap: 6px; margin: 0 12px 10px; padding: 5px; border-radius: 26px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
/* 17px: iOS zooms in on a box whose text is under 16px */
.box textarea { flex: 1; min-height: 44px; max-height: 30dvh; padding: 10px 8px; border: 0; outline: none; background: transparent; font-size: 17px; resize: none; }

/* the chat */
.items { display: flex; flex: 1; flex-direction: column; gap: 10px; margin: 0; padding: 8px 14px; overflow-y: auto; list-style: none; }
.items:empty { flex: 0; padding: 0; }
.item { max-width: 88%; padding: 9px 13px; border-radius: 18px; overflow-wrap: anywhere; }
.item p { margin: 0; white-space: pre-wrap; }
.item.you { align-self: flex-end; border-bottom-right-radius: 6px; background: var(--ink); color: var(--cream); }
.item.buddy { align-self: flex-start; border-bottom-left-radius: 6px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.item.buddy .text { padding: 8px 10px; border-radius: 12px; background: var(--cream); }
.item.buddy .say + .text { margin-top: 6px; }
.item .notes { margin: 6px 0 0; padding-left: 18px; color: var(--ink-2); font-size: 15px; }
.item.event { align-self: center; max-width: 100%; padding: 2px 8px; color: var(--ink-2); font-size: 14px; text-align: center; }
.item.error { align-self: flex-start; background: var(--bad-bg); color: var(--bad-ink); }
.item.thinking { align-self: flex-start; padding: 2px 4px; color: var(--ink-2); font-size: 15px; }
.buttons { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 8px; }
.item.event .buttons { justify-content: center; margin-top: 2px; }
.chip { padding: 6px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font-size: 15px; font-weight: 600; }
.empty { margin: auto 24px; color: var(--ink-2); text-align: center; }

/* Claude Code */
.claude-pick { display: flex; flex: 1; flex-direction: column; gap: 12px; padding: 0 14px 12px; overflow-y: auto; }
.claude-pick h2, .settings h2 { margin: 6px 0 0; font: 700 22px/1.1 var(--display); }
.claude-pick .btn { align-self: center; }
.groups { display: grid; gap: 14px; }
.group h3 { margin: 0 0 6px; color: var(--ink-2); font-size: 13px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.sessions { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.sessions button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; padding: 12px 14px; border: 0; border-radius: 16px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); text-align: left; }
.sessions .name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.status-chip { flex: none; padding: 1px 10px; border-radius: 999px; background: var(--line); color: var(--ink-2); font-size: 13px; }
.status-chip.working { background: var(--orange-tint); color: var(--ink); }
.status-chip.waiting { background: var(--bad-bg); color: var(--bad-ink); }
.status-chip.done { background: var(--ok-bg); color: var(--ok-ink); }
.claude-session { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.claude-bar { display: flex; flex: none; align-items: center; gap: 6px; padding: 0 6px 4px; border-bottom: 1px solid var(--line); }
.claude-bar .grow { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.claude-items { display: flex; flex: 1; flex-direction: column; gap: 8px; margin: 0; padding: 10px 12px; overflow-y: auto; font-size: 15px; list-style: none; }
.claude-items > li { flex: none; min-width: 0; }
.claude-items p { margin: 0; overflow-wrap: anywhere; white-space: pre-wrap; }
.claude-items .cl-you { align-self: flex-end; max-width: 86%; padding: 7px 11px; border-radius: 14px; border-bottom-right-radius: 5px; background: var(--orange-tint); }
.claude-items .cl-claude { align-self: flex-start; max-width: 96%; padding: 7px 11px; border-radius: 14px; border-bottom-left-radius: 5px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.claude-items .cl-tool, .claude-items .cl-result { font: 13px/1.4 ui-monospace, Menlo, monospace; }
.claude-items .cl-tool::before { content: "⏺ "; color: var(--orange); }
.claude-items .cl-result { margin-top: -3px; padding: 4px 8px; border-left: 2px solid var(--line); color: var(--ink-2); }
.claude-items .cl-result.error { border-left-color: var(--bad-ink); color: var(--bad-ink); }
.claude-items .cl-event, .claude-items .cl-note { align-self: center; color: var(--ink-2); font-size: 13px; text-align: center; }
/* full screen: the head and the tabs make room, and the box keeps clear of the home bar */
.app.full .stage, .app.full .tabs { display: none; }
.app.full .claude-session { padding-bottom: var(--bottom); }

/* settings */
.settings { gap: 10px; padding: 0 14px 16px; overflow-y: auto; }
.buddies { display: flex; gap: 12px; }
.buddies button { display: grid; flex: 1; justify-items: center; gap: 2px; padding: 10px; border: 2px solid var(--line); border-radius: 18px; background: var(--paper); font-weight: 600; }
.buddies button[aria-pressed="true"] { border-color: var(--ink); }
.buddies img { width: 88px; height: 88px; object-fit: contain; }
.switch { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-radius: 16px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.switch input { flex: none; width: 24px; height: 24px; accent-color: var(--ink); }
.facts { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.facts li { display: flex; align-items: center; gap: 8px; padding: 6px 6px 6px 14px; border-radius: 14px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.facts li span { flex: 1; min-width: 0; overflow-wrap: anywhere; }
.row { display: flex; align-items: center; gap: 8px; }
.field { flex: 1; min-width: 0; padding: 9px 14px; border: 1px solid var(--line); border-radius: 999px; background: var(--paper); font-size: 17px; }
.settings > .btn { align-self: flex-start; }
.settings .error { margin: 0; }

/* the tabs */
.tabs { display: flex; flex: none; padding-bottom: var(--bottom); border-top: 1px solid var(--line); background: var(--cream); }
.tabs button { flex: 1; min-height: 52px; border: 0; background: transparent; color: var(--ink-2); font-weight: 600; }
.tabs button[aria-pressed="true"] { color: var(--ink); box-shadow: inset 0 3px 0 var(--orange); }

@media (prefers-reduced-motion: reduce) {
  * { scroll-behavior: auto !important; }
}
```

Create `web/public/app/manifest.webmanifest`:

```json
{
  "name": "Buddy",
  "short_name": "Buddy",
  "description": "Your English buddy, and your Claude Code sessions, on your iPhone.",
  "id": "/app",
  "start_url": "/app",
  "scope": "/app",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#FFF5E9",
  "theme_color": "#FFF5E9",
  "icons": [
    { "src": "/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icon-512.png", "sizes": "512x512", "type": "image/png" }
  ]
}
```

Create `web/public/app/sw.js` (Task 9 adds the notifications part at its end):

```js
// Buddy on iPhone's service worker. The app's own files (and the sign-in SDK) come from the network first, so a deploy
// shows the next time the app opens, and each one fetched is kept, for opening the app with no network. CACHE changes
// only to drop what an older version kept. Everything else (/api, sign-in's /__/auth) goes to the network as usual.

const CACHE = 'buddy-app-1';
const SDK = 'https://www.gstatic.com/firebasejs/';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
    await self.clients.claim();
  })());
});

/** A file worth keeping: a GET of the app's own files under /app, or of the sign-in SDK. */
function kept(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.href.startsWith(SDK)) return true;
  return url.origin === self.location.origin && /^\/app(\/|$)/.test(url.pathname);
}

self.addEventListener('fetch', (event) => {
  if (!kept(event.request)) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    try {
      const response = await fetch(event.request);
      if (response.ok) await cache.put(event.request, response.clone());
      return response;
    } catch (err) {
      const copy = await cache.match(event.request, { ignoreSearch: true });
      if (copy) return copy;
      throw err;
    }
  })());
});
```

Create `web/public/app/app.js` (Task 6 and Task 10 replace it):

```js
// Buddy on iPhone: starts everything. So far, the service worker, which keeps the app's files for opening it without
// the network.

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
}
```

- [ ] **Step 9: Serve the service worker and the manifest as the app needs**

In `web/vercel.json`, add two header rules before the `/api/(.*)` rule:

Find:

```json
    {
      "source": "/api/(.*)",
```

Replace with:

```json
    {
      "source": "/app/sw.js",
      "headers": [
        { "key": "Service-Worker-Allowed", "value": "/app" },
        { "key": "Cache-Control", "value": "no-cache" }
      ]
    },
    {
      "source": "/app/manifest.webmanifest",
      "headers": [
        { "key": "Content-Type", "value": "application/manifest+json" }
      ]
    },
    {
      "source": "/api/(.*)",
```

- [ ] **Step 10: Lint the app's files as ES modules (and skip the generated copies)**

In `eslint.config.js`:

Find:

```js
'web/node_modules/', 'web/.vercel/', 'android/**'] },
```

Replace with:

```js
'web/node_modules/', 'web/.vercel/', 'android/**',
    'web/public/app/shared/', 'web/public/app/vendor/'] }, // Buddy on iPhone's copies, made by tools/sync-web-app.js
```

Find:

```js
    // The website's one script: a plain browser script that also hands its helpers to the tests.
    files: ['web/public/**/*.js'],
    languageOptions
```

Replace with:

```js
    // The website's one script: a plain browser script that also hands its helpers to the tests.
    files: ['web/public/**/*.js'],
    ignores: ['web/public/app/**'],
    languageOptions
```

Find:

```js
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, module: 'writable' } },
    rules,
  },
];
```

Replace with:

```js
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, module: 'writable' } },
    rules,
  },
  {
    // Buddy on iPhone: a web app of ES modules in the browser.
    files: ['web/public/app/**/*.js'],
    ignores: ['web/public/app/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules,
  },
  {
    // Its service worker: a plain script.
    files: ['web/public/app/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.serviceworker } },
    rules,
  },
];
```

- [ ] **Step 11: Run the tests**

Run: `node --test test/web-app-sync.test.js test/serve-web.test.js test/web-app-files.test.mjs`
Expected: all pass (`# fail 0`).

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0` (eslint prints nothing before the tests).

- [ ] **Step 12: Look at it**

Run (in the background): `npm run serve:web`
Open `http://localhost:8787/app` in Chrome: a cream page (the stage is empty: no head yet, no sign-in shown, as `data-signed="unknown"`), and DevTools → Application → Service workers shows `/app/sw.js` activated with scope `http://localhost:8787/app`. No errors in the console. Stop the server.

- [ ] **Step 13: Commit**

```bash
git add tools/sync-web-app.js tools/serve-web.js test/web-app-sync.test.js test/serve-web.test.js test/web-app-files.test.mjs web/public/app package.json eslint.config.js web/vercel.json
git commit -m "feat(iphone): the web app's shell, and the sync of what it reuses"
```

---

### Task 2: What the phone keeps, memory, and calls to the server

**Files:**
- Create: `web/public/app/store.js`, `web/public/app/memory.js`, `web/public/app/api.js`
- Test: `test/web-app-memory.test.mjs`, `test/web-app-api.test.mjs`

**Interfaces:**
- Consumes: `./shared/memory-rules.js` (`cleanFact`, `MAX_FACTS`) from Task 1.
- Produces: `store.js`: `localStorageOf(win) -> { get(key) -> string|null, set(key, value) }`, `createStore(storage) -> { read(key, fallback), write(key, value) }` (keys stored as `buddy.<key>`; keys used: `buddy`, `memory`, `learn`).
- Produces: `memory.js`: `createMemory({ store, now?, newId? }) -> { list() -> [{ id, text, at }], facts() -> string[], learning() -> boolean, add(text, { source: 'chat'|'settings' }?) -> { id, text } | null, remove(id) -> boolean, clear(), setLearning(on) }`.
- Produces: `api.js`: `TIMEOUTS = { config: 8000, ask: 60000, transcribe: 45000, remote: 10000, push: 10000 }`, `NO_INTERNET = 'No internet.'`, `TOO_SLOW`, `SERVER_PROBLEM`, `SIGN_IN_AGAIN = 'Sign in again.'`, `class ApiError extends Error { code }`, `createApi({ getToken(force) -> Promise<string|null>, onSignedOut?, fetchImpl?, base? }) -> { get(path, { timeoutMs }?) -> Promise<json>, post(path, body, { timeoutMs }?) -> Promise<json> }`.

- [ ] **Step 1: Write the failing tests**

Create `test/web-app-memory.test.mjs`:

```js
// Buddy on iPhone: what the phone keeps (web/public/app/store.js) and what Buddy remembers there (memory.js).

import test from 'node:test';
import assert from 'node:assert';
import { createStore, localStorageOf } from '../web/public/app/store.js';
import { createMemory } from '../web/public/app/memory.js';

/** A storage like the page's, in a Map: `broken` makes every call throw, as Safari's private tabs once did. */
function fakeStorage(entries = {}, { broken = false } = {}) {
  const map = new Map(Object.entries(entries));
  return {
    map,
    localStorage: {
      getItem: (key) => {
        if (broken) throw new Error('SecurityError');
        return map.has(key) ? map.get(key) : null;
      },
      setItem: (key, value) => {
        if (broken) throw new Error('QuotaExceededError');
        map.set(key, String(value));
      },
    },
  };
}

function setup(entries = {}) {
  const win = fakeStorage(entries);
  const store = createStore(localStorageOf(win));
  let n = 0;
  let t = 1000;
  const memory = createMemory({ store, newId: () => `f${(n += 1)}`, now: () => (t += 1) });
  return { win, store, memory };
}

test('the store keeps JSON under buddy.<key>, and answers the fallback for nothing kept or something broken', () => {
  const { win, store } = setup({ 'buddy.broken': '{nope' });
  assert.strictEqual(store.read('buddy', 'boy-1'), 'boy-1');
  store.write('buddy', 'girl-1');
  assert.strictEqual(win.map.get('buddy.buddy'), '"girl-1"');
  assert.strictEqual(store.read('buddy', 'boy-1'), 'girl-1');
  assert.strictEqual(store.read('broken', 7), 7);
});

test('a browser that keeps nothing never throws: the app works on and forgets', () => {
  const store = createStore(localStorageOf(fakeStorage({}, { broken: true })));
  store.write('buddy', 'girl-1');
  assert.strictEqual(store.read('buddy', 'boy-1'), 'boy-1');
});

test('memory keeps clean facts, oldest first, and sends their words with each chat', () => {
  const { memory } = setup();
  assert.deepStrictEqual(memory.add('  Your boss is\nMr. Sharma.  '), { id: 'f1', text: 'Your boss is Mr. Sharma.' });
  assert.deepStrictEqual(memory.add('You work at Infosys.'), { id: 'f2', text: 'You work at Infosys.' });
  assert.deepStrictEqual(memory.facts(), ['Your boss is Mr. Sharma.', 'You work at Infosys.']);
  assert.deepStrictEqual(memory.list().map((f) => f.at), [1001, 1002]);
});

test('memory never keeps a secret, an empty fact, or one it knows already (in any letter case)', () => {
  const { memory } = setup();
  assert.strictEqual(memory.add('My password is hunter2.'), null);
  assert.strictEqual(memory.add('Card 4111 1111 1111 1111'), null);
  assert.strictEqual(memory.add('   '), null);
  memory.add('You like tea.');
  assert.strictEqual(memory.add('YOU LIKE TEA.'), null);
  assert.deepStrictEqual(memory.facts(), ['You like tea.']);
});

test('memory keeps at most 50 facts: the oldest goes', () => {
  const { memory } = setup();
  for (let i = 0; i < 52; i += 1) memory.add(`Fact number ${i}.`);
  const facts = memory.facts();
  assert.strictEqual(facts.length, 50);
  assert.strictEqual(facts[0], 'Fact number 2.');
  assert.strictEqual(facts[49], 'Fact number 51.');
});

test('with learning off a chat adds nothing, but Settings still can; facts can be forgotten one by one or all', () => {
  const { memory } = setup();
  assert.strictEqual(memory.learning(), true, 'on until switched off');
  memory.setLearning(false);
  assert.strictEqual(memory.learning(), false);
  assert.strictEqual(memory.add('You live in Pune.'), null);
  const typed = memory.add('You live in Pune.', { source: 'settings' });
  assert.ok(typed);
  memory.add('You have a dog.', { source: 'settings' });
  assert.strictEqual(memory.remove(typed.id), true);
  assert.strictEqual(memory.remove(typed.id), false);
  assert.deepStrictEqual(memory.facts(), ['You have a dog.']);
  memory.clear();
  assert.deepStrictEqual(memory.facts(), []);
});

test('memory skips what is broken in the store', () => {
  const { memory } = setup({ 'buddy.memory': JSON.stringify([{ id: 'a', text: 'Kept.', at: 5 }, { id: 2, text: 'x' }, null, 'y', { id: 'b', text: 'No time.' }]) });
  assert.deepStrictEqual(memory.list(), [{ id: 'a', text: 'Kept.', at: 5 }, { id: 'b', text: 'No time.', at: 0 }]);
  const { memory: odd } = setup({ 'buddy.memory': '"not a list"' });
  assert.deepStrictEqual(odd.list(), []);
});
```

Create `test/web-app-api.test.mjs`:

```js
// Buddy on iPhone: calls to Buddy's server (web/public/app/api.js).

import test from 'node:test';
import assert from 'node:assert';
import { createApi, ApiError, NO_INTERNET, TOO_SLOW, SERVER_PROBLEM, SIGN_IN_AGAIN } from '../web/public/app/api.js';

/** A response as fetch gives it: `body` is JSON, or text that is not. */
const reply = (status, body) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
});

/**
 * The api with a fake fetch that answers `replies` in turn (an Error is thrown instead), and tokens 't1', 't2', … (a
 * new one each time one is forced). `calls` are the fetches, `tokens` the getToken calls, `signedOut` how often the
 * person was signed out.
 */
function setup(replies, { token = true } = {}) {
  const calls = [];
  const tokens = [];
  let n = 1;
  let signedOut = 0;
  const api = createApi({
    getToken: async (force) => {
      tokens.push(force);
      if (!token) return null;
      if (force) n += 1;
      return `t${n}`;
    },
    onSignedOut: () => {
      signedOut += 1;
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init });
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
  });
  return { api, calls, tokens, signedOut: () => signedOut };
}

test('a call carries the ID token and a deadline; a POST sends JSON; the answer is the JSON', async () => {
  const s = setup([reply(200, { freeOn: true }), reply(200, { text: 'hi' })]);
  assert.deepStrictEqual(await s.api.get('/api/config', { timeoutMs: 8000 }), { freeOn: true });
  assert.deepStrictEqual(await s.api.post('/api/ask', { action: 'chat', message: 'hi' }), { text: 'hi' });
  const [get, post] = s.calls;
  assert.strictEqual(get.url, '/api/config');
  assert.strictEqual(get.method, 'GET');
  assert.deepStrictEqual(get.headers, { authorization: 'Bearer t1' });
  assert.strictEqual(get.body, undefined);
  assert.ok(get.signal instanceof AbortSignal);
  assert.strictEqual(post.method, 'POST');
  assert.deepStrictEqual(post.headers, { authorization: 'Bearer t1', 'content-type': 'application/json' });
  assert.strictEqual(post.body, '{"action":"chat","message":"hi"}');
  assert.deepStrictEqual(s.tokens, [false, false], 'the token as it is: the sign-in SDK renews it before it expires');
});

test('a token turned down is renewed and the call made once more', async () => {
  const s = setup([reply(401, { error: { code: 'unauthenticated', message: 'x' } }), reply(200, { ok: 1 })]);
  assert.deepStrictEqual(await s.api.get('/api/config'), { ok: 1 });
  assert.deepStrictEqual(s.tokens, [false, true]);
  assert.strictEqual(s.calls[1].headers.authorization, 'Bearer t2');
  assert.strictEqual(s.signedOut(), 0);
});

test('turned down twice, or nobody signed in: "Sign in again." and the person is signed out', async () => {
  const s = setup([reply(401, {}), reply(401, {})]);
  await assert.rejects(s.api.get('/api/config'), { name: 'ApiError', code: 'unauthenticated', message: SIGN_IN_AGAIN });
  assert.strictEqual(s.signedOut(), 1);
  const none = setup([], { token: false });
  await assert.rejects(none.api.post('/api/ask', {}), { code: 'unauthenticated', message: SIGN_IN_AGAIN });
  assert.strictEqual(none.calls.length, 0, 'nothing is sent without a token');
  assert.strictEqual(none.signedOut(), 1);
});

test("the server's refusals keep its code and its words", async () => {
  const s = setup([reply(429, { error: { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." } })]);
  await assert.rejects(s.api.post('/api/ask', {}), (err) => err instanceof ApiError && err.code === 'free_limit' && err.message.startsWith("You've used"));
});

test('anything else is said in plain words: no internet, too slow, or a server problem', async () => {
  const offline = setup([new TypeError('Load failed')]);
  await assert.rejects(offline.api.get('/api/config'), { code: 'network', message: NO_INTERNET });
  const slow = setup([Object.assign(new Error('timed out'), { name: 'TimeoutError' })]);
  await assert.rejects(slow.api.get('/api/config'), { code: 'timeout', message: TOO_SLOW });
  const html = setup([reply(502, '<html>Bad gateway</html>')]);
  await assert.rejects(html.api.get('/api/config'), { code: 'server', message: SERVER_PROBLEM });
  const odd = setup([reply(200, 'null')]);
  await assert.rejects(odd.api.get('/api/config'), { code: 'server', message: SERVER_PROBLEM });
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/web-app-memory.test.mjs test/web-app-api.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/store.js` and `web/public/app/api.js`.

- [ ] **Step 3: Write the modules**

Create `web/public/app/store.js`:

```js
// What the phone keeps for itself, in the browser's localStorage: the buddy picked, the facts Buddy knows (memory.js)
// and a switch or two. `storage` is anything with get(key) and set(key, text), so the tests pass a fake; in the page it
// is localStorageOf(window), which never throws: where the browser keeps nothing, the app forgets it when it closes.

const PREFIX = 'buddy.';

/** The page's localStorage as get and set, which answer null and do nothing when the browser does not allow it. */
export function localStorageOf(win) {
  return {
    get(key) {
      try {
        return win.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        win.localStorage.setItem(key, value);
      } catch {
        // Nothing is kept: the app works on, and forgets it when closed.
      }
    },
  };
}

/** Values kept as JSON under "buddy.<key>". read() answers `fallback` when nothing is kept, or what is kept is broken. */
export function createStore(storage) {
  return {
    read(key, fallback) {
      const text = storage.get(PREFIX + key);
      if (typeof text !== 'string') return fallback;
      try {
        return JSON.parse(text);
      } catch {
        return fallback;
      }
    },
    write(key, value) {
      storage.set(PREFIX + key, JSON.stringify(value));
    },
  };
}
```

Create `web/public/app/memory.js`:

```js
// What Buddy knows about the person, on this phone only: short facts ("Your boss is Mr. Sharma."), kept in the store
// (store.js, `memory`) as [{ id, text, at }] oldest first, and sent with each chat message. The Mac's rules
// (src/main/memory.js): every fact goes through cleanFact (shared/memory-rules.js), so a password or a card number is
// never kept; a fact known already is not kept twice; over 50, the oldest goes; and while "Learn about me from chats"
// is off (`learn`), a chat adds nothing, though what is known is still used.

import { cleanFact, MAX_FACTS } from './shared/memory-rules.js';

/** A fact as it is kept, copied; null for anything broken in the store. */
function readFact(entry) {
  if (!entry || typeof entry.id !== 'string' || typeof entry.text !== 'string') return null;
  return { id: entry.id, text: entry.text, at: Number.isFinite(entry.at) ? entry.at : 0 };
}

export function createMemory({ store, now = Date.now, newId = () => crypto.randomUUID() }) {
  function list() {
    const saved = store.read('memory', []);
    return Array.isArray(saved) ? saved.map(readFact).filter(Boolean) : [];
  }

  const learning = () => store.read('learn', true) !== false;

  return {
    list,
    facts: () => list().map((fact) => fact.text),
    learning,

    /** Keep a fact: { id, text }, or null when the rules refuse it, it is known already, or a chat adds it while learning is off. */
    add(text, { source = 'chat' } = {}) {
      if (source === 'chat' && !learning()) return null;
      const clean = cleanFact(text);
      if (!clean) return null;
      const known = list();
      if (known.some((fact) => fact.text.toLowerCase() === clean.toLowerCase())) return null;
      const fact = { id: newId(), text: clean, at: now() };
      store.write('memory', [...known, fact].slice(-MAX_FACTS));
      return { id: fact.id, text: fact.text };
    },

    /** Forget one fact; false when there was none with that id. */
    remove(id) {
      const known = list();
      const left = known.filter((fact) => fact.id !== id);
      if (left.length === known.length) return false;
      store.write('memory', left);
      return true;
    },

    clear() {
      store.write('memory', []);
    },

    /** "Learn about me from chats". Off, a chat saves nothing new. */
    setLearning(on) {
      store.write('learn', Boolean(on));
    },
  };
}
```

Create `web/public/app/api.js`:

```js
// Buddy's server, from the phone: each call carries the person's ID token, has a deadline, and turns what went wrong
// into words for the person. The server's own refusals ({ error: { code, message } }) keep its words. A 401 means the
// token was turned down: the call is made once more with a new token, and only when that is turned down too is the
// person signed out (as the Mac and Android do).

export const TIMEOUTS = { config: 8_000, ask: 60_000, transcribe: 45_000, remote: 10_000, push: 10_000 };
export const NO_INTERNET = 'No internet.';
export const TOO_SLOW = "Buddy's server took too long to answer. Try again.";
export const SERVER_PROBLEM = "Buddy's server had a problem. Try again.";
export const SIGN_IN_AGAIN = 'Sign in again.';

/** What went wrong with a call: `code` to branch on, `message` for the person. */
export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * getToken(force) answers the person's ID token (a new one when `force`), or null when nobody is signed in;
 * onSignedOut() is called when the server turned the person's sign-in down twice. Answers { get, post }: each answers
 * the server's JSON, or throws an ApiError.
 */
export function createApi({ getToken, onSignedOut = () => {}, fetchImpl = (...args) => fetch(...args), base = '' }) {
  function signedOut() {
    onSignedOut();
    return new ApiError('unauthenticated', SIGN_IN_AGAIN);
  }

  async function call(path, { method, body, timeoutMs = 30_000 }, retried = false) {
    const token = await getToken(retried);
    if (!token) throw signedOut();
    const headers = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    let json;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      json = await res.json().catch((err) => {
        if (err?.name === 'TimeoutError') throw err;
        return null; // not JSON: said below
      });
    } catch (err) {
      throw err?.name === 'TimeoutError' ? new ApiError('timeout', TOO_SLOW) : new ApiError('network', NO_INTERNET);
    }
    if (res.status === 401) {
      if (!retried) return call(path, { method, body, timeoutMs }, true);
      throw signedOut();
    }
    if (res.ok && json && typeof json === 'object') return json;
    const error = json?.error;
    if (error && typeof error.code === 'string' && typeof error.message === 'string') throw new ApiError(error.code, error.message);
    throw new ApiError('server', SERVER_PROBLEM);
  }

  return {
    get: (path, options = {}) => call(path, { ...options, method: 'GET' }),
    post: (path, body, options = {}) => call(path, { ...options, method: 'POST', body }),
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/web-app-memory.test.mjs test/web-app-api.test.mjs`
Expected: `# pass 12`, `# fail 0`.

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app/store.js web/public/app/memory.js web/public/app/api.js test/web-app-memory.test.mjs test/web-app-api.test.mjs
git commit -m "feat(iphone): memory on the phone, and calls to Buddy's server"
```

---

### Task 3: The chat without the page

**Files:**
- Create: `web/public/app/chat-core.js`
- Test: `test/web-app-chat.test.mjs`

**Interfaces:**
- Consumes: `./shared/prompts.js` (`LIMITS`, `CHAT_LIMITS`); in tests, `createMemory`, `createStore` (Task 2), `ApiError` (Task 2).
- Produces: `chat-core.js`: constants `EMPTY`, `TOO_LONG`, `CANT_SEE`, `CANT_SEND`, `NO_ANSWER`, `FREE_OFF`, `FAILED`, `FORGOT`; `historyBefore(items, you)`, `chatRequest({ items, you, facts, userName }) -> body`, `answerItem(reply) -> item`, `canSend({ busy, text }) -> boolean`, `failureText(err) -> string`, `createChat({ ask(body) -> Promise<json>, memory, userName?, onMood?, onChange? }) -> { state: { items, busy }, send(message) -> Promise<{ ok, error? }>, retry(id), forget(id), clear() }`. Items: `{ id, type: 'you'|'buddy'|'event'|'error', say, text, notes, buttons: ('copy'|'share'|'undo'|'retry')[], fact?, you? }`. Moods sent: `thinking`, `happy`, `idle`, `sad`.

- [ ] **Step 1: Write the failing test**

Create `test/web-app-chat.test.mjs`:

```js
// Buddy on iPhone: the chat without the page (web/public/app/chat-core.js).

import test from 'node:test';
import assert from 'node:assert';
import {
  createChat, chatRequest, historyBefore, answerItem, canSend, failureText,
  EMPTY, TOO_LONG, CANT_SEE, CANT_SEND, NO_ANSWER, FREE_OFF, FAILED, FORGOT,
} from '../web/public/app/chat-core.js';
import { ApiError } from '../web/public/app/api.js';
import { createMemory } from '../web/public/app/memory.js';
import { createStore } from '../web/public/app/store.js';

/** parseChat's shape, with `fields` over a written answer. */
const chat = (fields = {}) => ({ chat: { kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...fields } });

/** A chat whose server answers `replies` in turn (an Error is thrown instead). */
function setup(replies = [], { name = 'Akshat' } = {}) {
  const map = new Map();
  let n = 0;
  const memory = createMemory({ store: createStore({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) }), newId: () => `f${(n += 1)}` });
  const asked = [];
  const moods = [];
  let changes = 0;
  const c = createChat({
    ask: async (body) => {
      asked.push(structuredClone(body));
      const next = replies.shift();
      if (next instanceof Error) throw next;
      return next;
    },
    memory,
    userName: () => name,
    onMood: (m) => moods.push(m),
    onChange: () => {
      changes += 1;
    },
  });
  return { c, memory, asked, moods, changes: () => changes };
}

const shown = (c) => c.state.items.map(({ type, say, text, buttons }) => ({ type, say, text, buttons }));

test("a message goes as the Mac panel's first step: message, chat so far, facts, first name, step 1, and nothing from other apps", async () => {
  const s = setup([chat({ kind: 'write', say: 'Here you go!', text: 'Dear Sir, ...' }), chat({ kind: 'write', text: 'Short.' })]);
  s.memory.add('Your boss is Mr. Sharma.', { source: 'settings' });
  assert.deepStrictEqual(await s.c.send('  boss ko mail likho  '), { ok: true });
  await s.c.send('make it shorter');
  assert.deepStrictEqual(s.asked[0], {
    action: 'chat', message: 'boss ko mail likho', history: [], facts: ['Your boss is Mr. Sharma.'], step: 1, userName: 'Akshat',
  });
  assert.deepStrictEqual(s.asked[1].history, [{ from: 'you', text: 'boss ko mail likho' }, { from: 'buddy', text: 'Here you go!\n\nDear Sir, ...' }]);
  for (const body of s.asked) {
    for (const field of ['box', 'image', 'selection', 'appName', 'projects']) assert.ok(!(field in body), `no ${field}`);
  }
});

test('an answer with text gets Copy and Share; the buddy thinks, then is happy', async () => {
  const s = setup([chat({ kind: 'fix', say: 'Fixed!', text: 'I am going.', notes: ['"go" should be "going".'] })]);
  await s.c.send('i am go');
  assert.deepStrictEqual(shown(s.c), [
    { type: 'you', say: '', text: 'i am go', buttons: [] },
    { type: 'buddy', say: 'Fixed!', text: 'I am going.', buttons: ['copy', 'share'] },
  ]);
  assert.deepStrictEqual(s.c.state.items[1].notes, ['"go" should be "going".']);
  assert.deepStrictEqual(s.moods, ['thinking', 'happy']);
  assert.strictEqual(s.c.state.busy, false);
});

test('an answer that wants the text box or the screen, or to send, says what the phone cannot do', () => {
  assert.strictEqual(answerItem(chat({ kind: 'box' }).chat).say, CANT_SEE);
  assert.strictEqual(answerItem(chat({ kind: 'screen' }).chat).say, CANT_SEE);
  assert.deepStrictEqual(answerItem(chat({ kind: 'send', say: 'Sending!' }).chat), { type: 'buddy', say: CANT_SEND, text: '', notes: [], buttons: [] });
  assert.strictEqual(answerItem(chat({ kind: 'answer' }).chat).say, NO_ANSWER);
  assert.deepStrictEqual(answerItem(chat({ kind: 'answer', text: 'Kal = tomorrow.' }).chat).buttons, ['copy', 'share']);
  assert.deepStrictEqual(answerItem(chat({ kind: 'code', say: 'On it!', text: 'Fix the bug.' }).chat).text, 'Fix the bug.');
});

test('a box answer leaves the buddy idle, not happy', async () => {
  const s = setup([chat({ kind: 'box' })]);
  await s.c.send('fix my English');
  assert.deepStrictEqual(s.moods, ['thinking', 'idle']);
  assert.strictEqual(s.c.state.items[1].say, CANT_SEE);
});

test('facts the answer remembers are kept, each shown with Undo, which forgets it', async () => {
  const s = setup([chat({ kind: 'answer', text: 'Noted.', remember: ['You work at Infosys.', 'My password is x'] })]);
  await s.c.send('I work at Infosys');
  assert.deepStrictEqual(s.memory.facts(), ['You work at Infosys.'], 'a secret is never kept');
  const event = s.c.state.items.find((i) => i.type === 'event');
  assert.deepStrictEqual([event.text, event.buttons], ['📝 Remembered: You work at Infosys.', ['undo']]);
  s.c.forget(event.id);
  assert.deepStrictEqual(s.memory.facts(), []);
  assert.deepStrictEqual([event.text, event.buttons], [FORGOT, []]);
});

test('learning off: nothing is remembered from a chat', async () => {
  const s = setup([chat({ kind: 'answer', text: 'Ok.', remember: ['You live in Pune.'] })]);
  s.memory.setLearning(false);
  await s.c.send('I live in Pune');
  assert.deepStrictEqual(s.memory.facts(), []);
  assert.ok(!s.c.state.items.some((i) => i.type === 'event'));
});

test('an empty or too long message is not sent, and the box keeps it', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.c.send('   '), { ok: false, error: EMPTY });
  assert.deepStrictEqual(await s.c.send('x'.repeat(1001)), { ok: false, error: TOO_LONG });
  assert.strictEqual(s.asked.length, 0);
  assert.strictEqual(s.c.state.items.length, 0);
  assert.strictEqual(canSend({ busy: false, text: ' hi ' }), true);
  assert.strictEqual(canSend({ busy: true, text: 'hi' }), false);
  assert.strictEqual(canSend({ busy: false, text: '  ' }), false);
});

test('one message at a time', async () => {
  let release;
  const s = setup([new Promise((resolve) => { release = resolve; })]);
  const first = s.c.send('one');
  assert.strictEqual(s.c.state.busy, true);
  assert.deepStrictEqual(await s.c.send('two'), { ok: false, error: '' });
  release(chat({ text: 'One.' }));
  await first;
  assert.strictEqual(s.asked.length, 1);
});

test('a failure shows in the chat with Try again, the buddy is sad, and Try again asks once more', async () => {
  const s = setup([new ApiError('network', 'No internet.'), chat({ kind: 'answer', text: 'Hi!' })]);
  await s.c.send('hello');
  assert.deepStrictEqual(shown(s.c)[1], { type: 'error', say: '', text: 'No internet.', buttons: ['retry'] });
  assert.deepStrictEqual(s.moods, ['thinking', 'sad']);
  await s.c.retry(s.c.state.items[1].id);
  assert.deepStrictEqual(shown(s.c).map((i) => i.type), ['you', 'buddy']);
  assert.strictEqual(s.asked[1].message, 'hello');
  assert.deepStrictEqual(s.asked[1].history, [], 'the message is not its own history');
});

test("the server's words for free mode's limits are shown; free off and unknown failures get the phone's own", () => {
  assert.strictEqual(failureText(new ApiError('free_limit', "You've used today's 30 free requests.")), "You've used today's 30 free requests.");
  assert.strictEqual(failureText(new ApiError('free_off', 'Free AI is off. Add your own key in Settings.')), FREE_OFF);
  assert.strictEqual(failureText(new Error('boom')), FAILED);
  assert.strictEqual(failureText(null), FAILED);
});

test('no Try again for a message the server refused, or a sign-in that ended', async () => {
  const s = setup([new ApiError('bad_request', 'That is too long.'), new ApiError('unauthenticated', 'Sign in again.')]);
  await s.c.send('a');
  await s.c.send('b');
  assert.deepStrictEqual(s.c.state.items.filter((i) => i.type === 'error').map((i) => i.buttons), [[], []]);
});

test('an answer for a chat that was cleared is dropped', async () => {
  let release;
  const s = setup([new Promise((resolve) => { release = resolve; })]);
  const sent = s.c.send('hi');
  s.c.clear();
  release(chat({ text: 'Late.' }));
  await sent;
  assert.deepStrictEqual(s.c.state.items, []);
  assert.strictEqual(s.c.state.busy, false);
});

test('the chat so far is the last 6 messages, the buddy\'s line and text together; a reply without its reading is a written one', async () => {
  const items = [];
  for (let i = 0; i < 5; i += 1) items.push({ type: 'you', text: `q${i}` }, { type: 'buddy', say: `s${i}`, text: '' }, { type: 'event', text: 'x' });
  const you = { type: 'you', text: 'now' };
  items.push(you);
  const history = historyBefore(items, you);
  assert.strictEqual(history.length, 6);
  assert.deepStrictEqual(history.at(-1), { from: 'buddy', text: 's4' });
  assert.deepStrictEqual(chatRequest({ items: [you], you, facts: [], userName: '  ' }), { action: 'chat', message: 'now', history: [], facts: [], step: 1 });

  const s = setup([{ text: 'Plain words.' }]);
  await s.c.send('hi');
  assert.deepStrictEqual(shown(s.c)[1], { type: 'buddy', say: '', text: 'Plain words.', buttons: ['copy', 'share'] });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-chat.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/chat-core.js`.

- [ ] **Step 3: Write the module**

Create `web/public/app/chat-core.js`:

```js
// The chat on the phone, without the page: what goes to Buddy's server for each message, and what its answer adds to
// the chat. The request is the Mac panel's first step (src/main/actions.js): the message, the chat so far, what Buddy
// knows about the person and their first name, with step 1. The phone has no other app to read or type into, so it
// never sends a text box or a screenshot: an answer that asks for one says so, and an answer with text gets Copy and
// Share instead of Insert. chat.js draws the chat.
//
// An item: { id, type: 'you' | 'buddy' | 'event' | 'error', say, text, notes, buttons }, and `fact` on a fact that was
// remembered (Undo forgets it), `you` on an error (the message that Try again sends again).

import { LIMITS, CHAT_LIMITS } from './shared/prompts.js';

export const EMPTY = 'Tell me what to do first.';
export const TOO_LONG = `That message is too long (over ${LIMITS.instruction} characters). Try a shorter one.`;
export const CANT_SEE = "I can't see other apps on iPhone. Paste the text here.";
export const CANT_SEND = "I can't send it from your iPhone. Copy it, then send it there.";
export const NO_ANSWER = "I couldn't answer that. Try again.";
export const FREE_OFF = 'Free AI is off right now. Try again later.';
export const FAILED = 'Something went wrong. Try again.';
export const FORGOT = 'Okay, I forgot that.';

// The buttons of an answer with text. chat.js leaves Share out where the browser has no share sheet.
const TEXT_BUTTONS = ['copy', 'share'];
// Errors that asking again cannot fix: the message itself, or the sign-in (the app shows sign-in for that).
const NO_RETRY = ['bad_request', 'unauthenticated'];

/** The chat so far for the AI: the messages before `you`, the buddy's as its line and its text together (the Mac's). */
export function historyBefore(items, you) {
  const at = items.indexOf(you);
  return (at === -1 ? items : items.slice(0, at))
    .filter((item) => item.type === 'you' || item.type === 'buddy')
    .map((item) => ({ from: item.type, text: item.type === 'you' ? item.text : [item.say, item.text].filter(Boolean).join('\n\n') }))
    .filter((message) => message.text)
    .slice(-CHAT_LIMITS.history);
}

/** The body of POST /api/ask for the message `you`: the chat's first step, text only. */
export function chatRequest({ items, you, facts, userName }) {
  const body = { action: 'chat', message: you.text, history: historyBefore(items, you), facts, step: 1 };
  const name = String(userName || '').trim();
  if (name) body.userName = name;
  return body;
}

/** What an answer (shared/prompts.js parseChat's shape) shows in the chat. */
export function answerItem(reply) {
  const item = (say, text = '', notes = []) => ({ type: 'buddy', say, text, notes, buttons: text ? TEXT_BUTTONS : [] });
  if (reply.kind === 'box' || reply.kind === 'screen') return item(CANT_SEE);
  if (reply.kind === 'send') return item(CANT_SEND);
  if (!reply.say && !reply.text && !reply.notes.length) return item(NO_ANSWER);
  return item(reply.say, reply.text, reply.notes);
}

/** A send can go: no answer is on its way, and the box has words in it. */
export function canSend({ busy, text }) {
  return !busy && String(text ?? '').trim() !== '';
}

/** The words for a failed answer: the server's (free mode's limits, a block), or plain ones. */
export function failureText(err) {
  if (err?.code === 'free_off') return FREE_OFF; // the server's words send the person to an own key, which the phone has not
  return typeof err?.code === 'string' && typeof err.message === 'string' && err.message ? err.message : FAILED;
}

/**
 * One chat. ask(body) is POST /api/ask; memory is memory.js; userName() the person's first name; onMood(name) tells
 * the buddy (thinking, happy, sad, idle); onChange() after every change. `state` is { items, busy }.
 */
export function createChat({ ask, memory, userName = () => '', onMood = () => {}, onChange = () => {} }) {
  const state = { items: [], busy: false };
  let nextId = 1;
  let chatId = 0; // one more for each new chat: an answer for an earlier one is dropped

  function add(item) {
    const full = { id: nextId, say: '', text: '', notes: [], buttons: [], ...item };
    nextId += 1;
    state.items.push(full);
    return full;
  }

  /** Ask about `you`, and show what comes back. */
  async function answer(you) {
    const mine = chatId;
    state.busy = true;
    onMood('thinking');
    onChange();
    try {
      const out = await ask(chatRequest({ items: state.items, you, facts: memory.facts(), userName: userName() }));
      if (mine !== chatId) return;
      const reply = out?.chat || { kind: 'write', say: '', text: String(out?.text || ''), notes: [], remember: [] };
      for (const fact of reply.remember || []) {
        const saved = memory.add(fact);
        if (saved) add({ type: 'event', text: `📝 Remembered: ${saved.text}`, buttons: ['undo'], fact: saved.id });
      }
      const item = add(answerItem(reply));
      onMood(item.say === CANT_SEE || item.say === CANT_SEND ? 'idle' : 'happy');
    } catch (err) {
      if (mine !== chatId) return;
      onMood('sad');
      add({ type: 'error', text: failureText(err), buttons: NO_RETRY.includes(err?.code) ? [] : ['retry'], you: you.id });
    } finally {
      if (mine === chatId) {
        state.busy = false;
        onChange();
      }
    }
  }

  return {
    state,

    /** The person's message. Answers { ok: true } once it is answered, or { ok: false, error } when it was not sent. */
    async send(message) {
      if (state.busy) return { ok: false, error: '' };
      const text = String(message ?? '').trim();
      if (!text) return { ok: false, error: EMPTY };
      if (text.length > LIMITS.instruction) return { ok: false, error: TOO_LONG };
      await answer(add({ type: 'you', text }));
      return { ok: true };
    },

    /** "Try again" on an error: the error goes, and its message is asked about again. */
    async retry(id) {
      const error = state.items.find((item) => item.id === id && item.type === 'error');
      const you = error && state.items.find((item) => item.id === error.you);
      if (!you || state.busy) return;
      state.items.splice(state.items.indexOf(error), 1);
      await answer(you);
    },

    /** "Undo" on a fact Buddy remembered: forgotten again. */
    forget(id) {
      const item = state.items.find((i) => i.id === id && i.fact);
      if (!item) return;
      memory.remove(item.fact);
      Object.assign(item, { text: FORGOT, buttons: [], fact: undefined });
      onChange();
    },

    /** A new, empty chat (signing out). An answer still on its way is dropped. */
    clear() {
      chatId += 1;
      state.items = [];
      state.busy = false;
      onChange();
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/web-app-chat.test.mjs`
Expected: `# pass 13`, `# fail 0`.

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app/chat-core.js test/web-app-chat.test.mjs
git commit -m "feat(iphone): the chat's request and answers, as the Mac panel's first step"
```

---

### Task 4: Claude mode without the page

**Files:**
- Create: `web/public/app/claude-core.js`
- Test: `test/web-app-claude.test.mjs`

**Interfaces:**
- Consumes: in tests, `ApiError` (Task 2).
- Produces: `claude-core.js`: `POLL_MS = 2000`, `STATUS`, `OFFLINE`, `NONE`, `NO_TALK`, `GONE`; `readLook(json) -> { online, sessions: [{ id, name, status, canTalk, device }], feed: { session, items: [{ id, kind, text, error }] } | null }`; `byDevice(sessions) -> [{ device, sessions }]`; `createClaude({ look(sessionId|null) -> Promise<readLook shape>, send(sessionId, text), stop(), later?, cancelLater?, pollMs?, onChange? }) -> { state, enter(openId?), leave(), shown(), hidden(), list(), open(id), send(text) -> Promise<{ ok, error? }> }`. `state` = `{ on, looking, online, sessions, listError, session, items, problem, sending, boxError }`.

- [ ] **Step 1: Write the failing test**

Create `test/web-app-claude.test.mjs`:

```js
// Buddy on iPhone: Claude mode without the page (web/public/app/claude-core.js).

import test from 'node:test';
import assert from 'node:assert';
import { createClaude, readLook, byDevice, POLL_MS, GONE } from '../web/public/app/claude-core.js';
import { ApiError } from '../web/public/app/api.js';

const S1 = { id: 'aaaa-1111', name: 'shop', status: 'working', canTalk: true, device: 'MacBook Air' };
const S2 = { id: 'bbbb-2222', name: 'blog', status: 'done', canTalk: false, device: 'Office PC' };
const ITEMS = [{ id: 1, kind: 'you', text: 'fix it', error: false }, { id: 2, kind: 'claude', text: 'Done.', error: false }];
const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * Claude mode with fake calls: `looks` answers each look in turn (a function of the session asked for, or an Error to
 * throw), and fake timers: tick() runs the timers that are due, as if POLL_MS went by.
 */
function setup(looks) {
  const asked = [];
  const sent = [];
  let stops = 0;
  const timers = new Map();
  let nextTimer = 1;
  const claude = createClaude({
    look: async (session) => {
      asked.push(session);
      const next = looks.shift();
      if (next === undefined) throw new Error('no more looks planned');
      const r = typeof next === 'function' ? next(session) : next;
      if (r instanceof Error) throw r;
      return r;
    },
    send: async (session, text) => {
      sent.push({ session, text });
      if (text === 'fail') throw new ApiError('mac_offline', 'None of your computers is sharing right now.');
    },
    stop: async () => {
      stops += 1;
    },
    later: (fn, ms) => {
      assert.strictEqual(ms, POLL_MS);
      const id = nextTimer;
      nextTimer += 1;
      timers.set(id, fn);
      return id;
    },
    cancelLater: (id) => timers.delete(id),
  });
  return {
    claude,
    asked,
    sent,
    stops: () => stops,
    pending: () => timers.size,
    async tick() {
      const due = [...timers.values()];
      timers.clear();
      for (const fn of due) fn();
      await settle();
    },
  };
}

const online = (sessions, feed = null) => ({ online: true, sessions, feed });

test('entering lists the sessions; picking one looks at it every 2 s and shows its items once its computer sends them', async () => {
  const s = setup([online([S1, S2]), online([S1, S2]), online([S1, S2], { session: S1, items: ITEMS })]);
  s.claude.enter();
  assert.strictEqual(s.claude.state.looking, true);
  await settle();
  assert.deepStrictEqual([s.claude.state.on, s.claude.state.online, s.claude.state.sessions], [true, true, [S1, S2]]);
  s.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual(s.asked, [null, S1.id]);
  assert.strictEqual(s.claude.state.session, S1);
  assert.strictEqual(s.claude.state.items, null, 'nothing from the computer yet');
  assert.strictEqual(s.pending(), 1, 'the next look waits');
  await s.tick();
  assert.deepStrictEqual(s.claude.state.items, ITEMS);
});

test('the session ended: back to the list, saying so; the computer stopped sharing: the list says it is offline', async () => {
  const s = setup([online([S1]), new ApiError('not_found', GONE), online([S2])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  await settle();
  assert.deepStrictEqual([s.claude.state.session, s.claude.state.sessions, s.claude.state.listError], [null, [S2], GONE]);

  const off = setup([online([S1]), { online: false, sessions: [], feed: null }]);
  off.claude.enter();
  await settle();
  off.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual([off.claude.state.session, off.claude.state.online], [null, false]);
  assert.strictEqual(off.pending(), 0, 'no more looks');
  assert.strictEqual(off.stops(), 1);
});

test('a look that fails says why and looks again', async () => {
  const s = setup([online([S1]), new ApiError('network', 'No internet.'), online([S1], { session: S1, items: ITEMS })]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  assert.strictEqual(s.claude.state.problem, 'No internet.');
  await s.tick();
  assert.strictEqual(s.claude.state.problem, null);
  assert.deepStrictEqual(s.claude.state.items, ITEMS);
});

test('out of view the looks stop and the computer is told; in view again they start again', async () => {
  const s = setup([online([S1]), online([S1]), online([S1])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  s.claude.hidden();
  await settle();
  assert.strictEqual(s.pending(), 0);
  assert.strictEqual(s.stops(), 1);
  s.claude.shown();
  await settle();
  assert.deepStrictEqual(s.asked, [null, S1.id, S1.id]);
});

test('back to the list stops the computer; signing out drops what is on its way', async () => {
  let release;
  const s = setup([online([S1]), online([S1]), online([S1]), () => new Promise((resolve) => { release = resolve; })]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  s.claude.list();
  await settle();
  assert.strictEqual(s.stops(), 1);
  assert.strictEqual(s.claude.state.session, null);
  s.claude.list();
  s.claude.leave();
  release(online([S1, S2]));
  await settle();
  assert.strictEqual(s.claude.state.on, false);
  assert.deepStrictEqual(s.claude.state.sessions, [], 'the late answer is dropped');
});

test("a notification's link opens its session once the list comes, or says it is gone", async () => {
  const s = setup([online([S1, S2]), online([S1, S2])]);
  s.claude.enter(S2.id);
  await settle();
  await settle();
  assert.strictEqual(s.claude.state.session?.id, S2.id);
  const gone = setup([online([S1])]);
  gone.claude.enter('zzzz-9999');
  await settle();
  assert.deepStrictEqual([gone.claude.state.session, gone.claude.state.listError], [null, GONE]);
});

test('words go to the session shown; when they cannot, the box hears why', async () => {
  const s = setup([online([S1]), online([S1])]);
  s.claude.enter();
  await settle();
  assert.deepStrictEqual(await s.claude.send('run tests'), { ok: false, error: '' }, 'no session shown yet');
  s.claude.open(S1.id);
  await settle();
  assert.deepStrictEqual(await s.claude.send('  run the tests  '), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: 'run the tests' }]);
  assert.deepStrictEqual(await s.claude.send('fail'), { ok: false, error: 'None of your computers is sharing right now.' });
  assert.strictEqual(s.claude.state.boxError, 'None of your computers is sharing right now.');
  assert.deepStrictEqual(await s.claude.send('   '), { ok: false, error: '' });
});

test('a look is read the way the Android app reads it: odd parts left out, each id once', () => {
  assert.deepStrictEqual(readLook({
    online: true,
    sessions: [S1, { id: '../x' }, { id: 'cccc', name: ' ', status: 7 }, S1, null],
    feed: { id: S1.id, name: 'shop', status: 'working', canTalk: true, device: 'MacBook Air', items: [...ITEMS, { id: 2, kind: 'claude', text: 'again' }, { id: 3, kind: 'html', text: 'x' }, { id: 'a', text: 'x' }] },
  }), {
    online: true,
    sessions: [S1, { id: 'cccc', name: 'Claude Code', status: 'idle', canTalk: false, device: null }],
    feed: { session: S1, items: [...ITEMS, { id: 3, kind: 'event', text: 'x', error: false }] },
  });
  assert.deepStrictEqual(readLook(null), { online: false, sessions: [], feed: null });
});

test('sessions are grouped by computer, in the order the computers come', () => {
  const S3 = { ...S1, id: 'cccc-3333', name: 'api' };
  assert.deepStrictEqual(byDevice([S1, S2, S3]), [{ device: 'MacBook Air', sessions: [S1, S3] }, { device: 'Office PC', sessions: [S2] }]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-claude.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/claude-core.js`.

- [ ] **Step 3: Write the module**

Create `web/public/app/claude-core.js`:

```js
// Claude mode on the phone, without the page: the Claude Code sessions running on the person's computers, reached
// through Buddy's server (GET and POST /api/remote/phone, web/lib/remote.js), and one of them shown live. It does what
// the Android app's ClaudeModel.kt does: the session shown is looked at every 2 s, and only while it is in view (the
// Claude tab open and the app on screen); the computer sends its items only while it is looked at, and is told to stop
// (`stop`) when the person goes back to the list, leaves the tab or the app, or signs out. claude.js draws it.

export const POLL_MS = 2_000;
// A session's status, in the Mac panel's words (src/renderer/panel/panel.js).
export const STATUS = { working: 'working…', waiting: 'waiting for you', done: 'done', failed: 'hit a problem', idle: 'idle' };
export const OFFLINE = 'None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on.';
export const NONE = 'No Claude Code session is running on your computers.';
export const NO_TALK = "Buddy can't type into this terminal on that computer, so what you send there may not arrive.";
export const GONE = 'That session is not running any more. Pick another one.';
const FAILED = 'Something went wrong. Try again.';
// The ids the server takes (web/lib/remote.js): one that cannot be one is left out, so it is never asked for.
const SESSION_ID = /^[\w-]{1,100}$/;
const KINDS = ['you', 'claude', 'tool', 'result', 'event'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function readSession(j) {
  if (!j || typeof j.id !== 'string' || !SESSION_ID.test(j.id)) return null;
  return { id: j.id, name: text(j.name) || 'Claude Code', status: text(j.status) || 'idle', canTalk: j.canTalk === true, device: text(j.device) || null };
}

// A kind the phone does not know shows as a note, as on the Mac.
function readItem(j) {
  if (!j || !Number.isInteger(j.id) || typeof j.text !== 'string') return null;
  return { id: j.id, kind: KINDS.includes(j.kind) ? j.kind : 'event', text: j.text, error: j.error === true };
}

/** Only the first of each id: the lists are drawn by id. */
const firstOfEach = (list) => list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);

/**
 * One look (GET /api/remote/phone): { online, sessions, feed: { session, items } | null }, as Remote.kt reads it:
 * anything missing or odd is left out, so a strange answer shows less rather than breaking the tab.
 */
export function readLook(j) {
  const sessions = firstOfEach((Array.isArray(j?.sessions) ? j.sessions : []).map(readSession).filter(Boolean));
  const session = readSession(j?.feed);
  const feed = session ? { session, items: firstOfEach((Array.isArray(j.feed.items) ? j.feed.items : []).map(readItem).filter(Boolean)) } : null;
  return { online: j?.online === true, sessions, feed };
}

/** The sessions by computer, the computers in the order they first come: [{ device, sessions }]. */
export function byDevice(sessions) {
  const groups = [];
  for (const session of sessions) {
    let group = groups.find((g) => g.device === session.device);
    if (!group) {
      group = { device: session.device, sessions: [] };
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
}

const messageOf = (err) => (typeof err?.message === 'string' && err.message && typeof err.code === 'string' ? err.message : FAILED);

const fresh = () => ({
  on: false, // in Claude mode: the tab was opened, signed in
  looking: false, // the sessions are being asked for
  online: null, // whether a computer shares (null: not known)
  sessions: [],
  listError: null, // why the list is not there, or a note over it (the session shown ended)
  session: null, // the session shown, or null while the list is
  items: null, // its items, null until its computer has sent them
  problem: null, // why the last look at it failed
  sending: false,
  boxError: null, // why the last words were not sent
});

/**
 * look(sessionId | null) answers readLook's shape; send(sessionId, text) and stop() are the POSTs. later and
 * cancelLater are the timers (setTimeout, clearTimeout); onChange(state) after every change.
 */
export function createClaude({ look, send, stop, later = setTimeout, cancelLater = clearTimeout, pollMs = POLL_MS, onChange = () => {} }) {
  let state = fresh();
  let generation = 0; // one more each time Claude mode ends: what was on its way for an earlier one is dropped
  let listing = null; // the list being asked for now: a token, or null
  let polling = null; // the looks at the session shown: { timer }, or null
  let inView = true;
  let wanted = null; // a session to open once the list comes (a notification's link)

  function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
  }

  function stopWatching() {
    // Nothing to tell the person when this fails: the server stops the watch by itself when the phone stops looking.
    Promise.resolve().then(stop).catch(() => {});
  }

  function stopPolling() {
    if (!polling) return;
    cancelLater(polling.timer);
    polling = null;
  }

  /** The session shown is left: the looks stop, and so does its computer. */
  function leaveSession() {
    const watched = polling !== null || state.session !== null;
    stopPolling();
    if (watched) stopWatching();
  }

  /** "Look again", and "‹" from a session. `note` is said over the list (why the session shown went away). */
  function list(note = null) {
    leaveSession();
    const me = {};
    const mine = generation;
    listing = me;
    set({ session: null, items: null, problem: null, looking: true, listError: note });
    look(null).then((r) => {
      if (listing !== me || mine !== generation) return;
      listing = null;
      set({ looking: false, online: r.online, sessions: r.sessions, listError: note });
      if (wanted) {
        const id = wanted;
        wanted = null;
        if (r.sessions.some((s) => s.id === id)) open(id);
        else set({ listError: GONE });
      }
    }, (err) => {
      if (listing !== me || mine !== generation) return;
      listing = null;
      set({ looking: false, online: null, sessions: [], listError: note ?? messageOf(err) });
    });
  }

  /** Look at the session shown now, then every pollMs, while it is in view. */
  function poll() {
    const id = state.session?.id;
    if (!id || !inView || polling) return;
    const me = { timer: null };
    polling = me;
    const again = () => {
      if (polling === me) me.timer = later(step, pollMs);
    };
    async function step() {
      let r;
      try {
        r = await look(id);
      } catch (err) {
        if (polling !== me) return;
        if (err?.code === 'not_found') {
          // The session ended on its computer: back to the list, saying so.
          polling = null;
          list(err.message || GONE);
          return;
        }
        set({ problem: messageOf(err) });
        again();
        return;
      }
      if (polling !== me) return;
      if (!r.online) {
        // The computer stopped sharing: the list says so.
        polling = null;
        stopWatching();
        set({ session: null, items: null, problem: null, online: false, sessions: r.sessions, listError: null });
        return;
      }
      const feed = r.feed && r.feed.session.id === id ? r.feed : null;
      set(feed ? { session: feed.session, items: feed.items, problem: null } : { problem: null });
      again();
    }
    step();
  }

  /** A session picked from the list: it shows, and is looked at every pollMs. */
  function open(id) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session || !state.on || state.session) return;
    listing = null;
    set({ session, items: null, problem: null, looking: false, listError: null });
    poll();
  }

  return {
    get state() {
      return state;
    },

    /** Into Claude mode, on the list; with `openId` (a notification's link), that session opens once it is listed. */
    enter(openId = null) {
      if (openId) wanted = openId;
      if (state.on && !openId) return;
      inView = true;
      if (!state.on) set({ on: true });
      list();
    },

    /** Out of Claude mode (signed out): its work stops, and its computer's. */
    leave() {
      generation += 1;
      listing = null;
      wanted = null;
      leaveSession();
      state = fresh();
      onChange(state);
    },

    /** In view again: the session shown is looked at again, or the sessions asked for anew. */
    shown() {
      inView = true;
      if (!state.on) return;
      if (state.session) poll();
      else list();
    },

    /** Out of view (another tab, the app hidden): the phone stops looking, and the computer stops sending. */
    hidden() {
      inView = false;
      if (polling) {
        stopPolling();
        stopWatching();
      }
    },

    list: () => list(),
    open,

    /** Words to the session's terminal. Answers { ok: true }, or { ok: false, error } (the box gives them back). */
    async send(words) {
      const session = state.session;
      const typed = String(words ?? '').trim();
      if (!session || state.sending || !typed) return { ok: false, error: '' };
      const mine = generation;
      set({ sending: true, boxError: null });
      try {
        await send(session.id, typed);
        if (mine === generation) set({ sending: false });
        return { ok: true };
      } catch (err) {
        const error = messageOf(err);
        if (mine === generation) set({ sending: false, boxError: error });
        return { ok: false, error };
      }
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/web-app-claude.test.mjs`
Expected: `# pass 9`, `# fail 0`.

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app/claude-core.js test/web-app-claude.test.mjs
git commit -m "feat(iphone): Claude mode's looks and words, as on Android, every 2 s while in view"
```

---
### Task 5: Sign-in: the "Buddy iPhone" Firebase app, auth.js, and /__/auth on Buddy's domain

**Files:**
- Create: `web/public/app/config.js`, `web/public/app/auth.js`
- Modify: `web/vercel.json` (rewrites)
- Test: `test/web-app-auth.test.mjs`

**Interfaces:**
- Produces: `config.js`: `FIREBASE = { apiKey, authDomain: 'buddywrites.vercel.app', projectId: 'buddy-7f8c2', appId, messagingSenderId }`, `FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/13.0.0'`.
- Produces: `auth.js`: `SIGN_IN_FAILED`, `SIGN_IN_OFFLINE`, `firstNameOf(displayName) -> string`, `signInMessage(err) -> string` ('' when the person only went back), `personOf(user) -> { uid, email, name, firstName } | null`, `startAuth({ onUser(person|null), onError?(message), load? }) -> Promise<{ signIn() -> Promise, signOut() -> Promise, token(force?) -> Promise<string|null> }>`.

- [ ] **Step 1: Write the failing test**

Create `test/web-app-auth.test.mjs`:

```js
// Buddy on iPhone: signing in (web/public/app/auth.js and config.js), and what the server's vercel.json does for it.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import { startAuth, firstNameOf, signInMessage, personOf, SIGN_IN_FAILED, SIGN_IN_OFFLINE } from '../web/public/app/auth.js';
import { FIREBASE, FIREBASE_SDK } from '../web/public/app/config.js';

const vercel = JSON.parse(fs.readFileSync(new URL('../web/vercel.json', import.meta.url), 'utf8'));

test("the config is the real \"Buddy iPhone\" web app's, with Buddy's own domain for sign-in", () => {
  assert.strictEqual(FIREBASE.projectId, 'buddy-7f8c2');
  assert.strictEqual(FIREBASE.authDomain, 'buddywrites.vercel.app');
  assert.match(FIREBASE.apiKey, /^AIza[\w-]{35}$/);
  assert.match(FIREBASE.appId, /^1:128703624181:web:[0-9a-f]+$/);
  assert.notStrictEqual(FIREBASE.appId, '1:128703624181:web:9adb3ae202fab7ec5766bc', 'its own app, not "Buddy Mac"');
  assert.match(FIREBASE_SDK, /^https:\/\/www\.gstatic\.com\/firebasejs\/\d+\.\d+\.\d+$/, 'a pinned version');
});

test("sign-in's pages on Buddy's domain are Firebase's: /__/auth and /__/firebase go on to the project", () => {
  assert.deepStrictEqual(vercel.rewrites.filter((r) => r.source.startsWith('/__/')), [
    { source: '/__/auth/:path*', destination: 'https://buddy-7f8c2.firebaseapp.com/__/auth/:path*' },
    { source: '/__/firebase/:path*', destination: 'https://buddy-7f8c2.firebaseapp.com/__/firebase/:path*' },
  ]);
});

/** A fake Firebase SDK: what startAuth asked of it, and a way to sign someone in. */
function fakeSdk({ redirectError = null } = {}) {
  const seen = { loaded: [], init: null, redirects: [], signedOut: 0, tokens: [] };
  let listener = null;
  const auth = { currentUser: null };
  const user = { uid: 'u1', email: 'a@gmail.com', displayName: 'Akshat Gupta', getIdToken: async (force) => { seen.tokens.push(force); return force ? 'new' : 'tok'; } };
  class GoogleAuthProvider {
    setCustomParameters(params) {
      this.params = params;
    }
  }
  const modules = {
    [`${FIREBASE_SDK}/firebase-app.js`]: { initializeApp: (config) => ({ config }) },
    [`${FIREBASE_SDK}/firebase-auth.js`]: {
      indexedDBLocalPersistence: 'idb',
      browserLocalPersistence: 'local',
      browserPopupRedirectResolver: 'resolver',
      initializeAuth: (app, options) => {
        seen.init = { app, options };
        return auth;
      },
      getRedirectResult: async () => {
        if (redirectError) throw redirectError;
        return null;
      },
      onAuthStateChanged: (a, fn) => {
        assert.strictEqual(a, auth);
        listener = fn;
      },
      GoogleAuthProvider,
      signInWithRedirect: async (a, provider) => seen.redirects.push(provider.params),
      signOut: async () => {
        seen.signedOut += 1;
      },
    },
  };
  const load = async (url) => {
    seen.loaded.push(url);
    return modules[url];
  };
  const signIn = () => {
    auth.currentUser = user;
    listener(user);
  };
  return { seen, load, signIn };
}

test('auth starts the SDK with the config, keeps the person signed in, and says who they are', async () => {
  const sdk = fakeSdk();
  const people = [];
  const auth = await startAuth({ onUser: (p) => people.push(p), load: sdk.load });
  assert.deepStrictEqual(sdk.seen.loaded, [`${FIREBASE_SDK}/firebase-app.js`, `${FIREBASE_SDK}/firebase-auth.js`]);
  assert.deepStrictEqual(sdk.seen.init, { app: { config: FIREBASE }, options: { persistence: ['idb', 'local'], popupRedirectResolver: 'resolver' } });
  assert.strictEqual(await auth.token(), null, 'nobody yet');
  sdk.signIn();
  assert.deepStrictEqual(people, [{ uid: 'u1', email: 'a@gmail.com', name: 'Akshat Gupta', firstName: 'Akshat' }]);
  assert.strictEqual(await auth.token(), 'tok');
  assert.strictEqual(await auth.token(true), 'new');
  assert.deepStrictEqual(sdk.seen.tokens, [false, true]);
});

test('sign-in goes to Google by redirect, asking which account; sign-out signs out', async () => {
  const sdk = fakeSdk();
  const auth = await startAuth({ onUser: () => {}, load: sdk.load });
  await auth.signIn();
  assert.deepStrictEqual(sdk.seen.redirects, [{ prompt: 'select_account' }]);
  await auth.signOut();
  assert.strictEqual(sdk.seen.signedOut, 1);
});

test('coming back from Google with a failure says so, in plain words; going back says nothing', async () => {
  const errors = [];
  await startAuth({ onUser: () => {}, onError: (m) => errors.push(m), load: fakeSdk({ redirectError: { code: 'auth/internal-error' } }).load });
  await startAuth({ onUser: () => {}, onError: (m) => errors.push(m), load: fakeSdk({ redirectError: { code: 'auth/redirect-cancelled-by-user' } }).load });
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepStrictEqual(errors, [SIGN_IN_FAILED]);
  assert.strictEqual(signInMessage({ code: 'auth/network-request-failed' }), SIGN_IN_OFFLINE);
  assert.strictEqual(signInMessage(null), SIGN_IN_FAILED);
});

test('first names and people', () => {
  assert.strictEqual(firstNameOf('  Akshat   Gupta '), 'Akshat');
  assert.strictEqual(firstNameOf(null), '');
  assert.strictEqual(personOf(null), null);
  assert.deepStrictEqual(personOf({ uid: 'u', email: null, displayName: null }), { uid: 'u', email: '', name: '', firstName: '' });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-auth.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/auth.js`.

- [ ] **Step 3: Register the "Buddy iPhone" web app in Firebase (once)**

Run: `firebase apps:list --project buddy-7f8c2`
Expected: a table. If a WEB app named **Buddy iPhone** is listed, use its App ID and skip the create command. Otherwise (today it lists only "Buddy Android" and "Buddy Mac"):

Run: `firebase apps:create WEB "Buddy iPhone" --project buddy-7f8c2`
Expected: `🎉🎉🎉 Your Firebase WEB App is ready! 🎉🎉🎉` and an `App ID` of the form `1:128703624181:web:<hex>`.

Run: `firebase apps:sdkconfig WEB <that App ID> --project buddy-7f8c2`
Expected: a JSON config with `projectId: "buddy-7f8c2"`, `appId`, `apiKey` (starts with `AIza`), `authDomain: "buddy-7f8c2.firebaseapp.com"`, `messagingSenderId: "128703624181"`.

- [ ] **Step 4: Write the config and auth.js**

Create `web/public/app/config.js`. Put in the `apiKey` and `appId` printed by `apps:sdkconfig` (the two `'…'` values below are what the command printed, copied exactly; the test checks their shape and that the appId is not Buddy Mac's). Keep `authDomain` as `buddywrites.vercel.app`, not the printed `firebaseapp.com` one:

```js
// Buddy on iPhone's Firebase web app, "Buddy iPhone" in project buddy-7f8c2 (made with `firebase apps:create`; its
// values come from `firebase apps:sdkconfig`). They are public by design: they only name the project. Buddy's server
// checks every ID token itself. authDomain is Buddy's own domain, not firebaseapp.com, so that sign-in by redirect
// works in a Home Screen app on iOS: web/vercel.json passes /__/auth/ on to Firebase.

export const FIREBASE = {
  apiKey: 'AIza…the apiKey from apps:sdkconfig…',
  authDomain: 'buddywrites.vercel.app',
  projectId: 'buddy-7f8c2',
  appId: '1:128703624181:web:…the appId from apps:sdkconfig…',
  messagingSenderId: '128703624181',
};

// The Firebase JS SDK from Google's CDN, at a pinned version (change it on purpose, and try sign-in again after).
export const FIREBASE_SDK = 'https://www.gstatic.com/firebasejs/13.0.0';
```

Create `web/public/app/auth.js`:

```js
// Signing in on the phone: Google, through Firebase Auth's web SDK, with the same account as on the Mac and Android, so
// free mode's limits and Claude mode are the same everywhere. The SDK comes from Google's CDN (config.js) and is loaded
// when the app starts, not with the page, so the head still shows without the network. Sign-in goes by redirect, the
// way that works in a Home Screen app on iOS, and comes back through /__/auth on Buddy's own domain (config.js). The
// SDK keeps the person signed in and renews their ID token itself before it expires (it lasts an hour): token() answers
// a fresh one, and token(true) a new one, for a token Buddy's server turned down (api.js).

import { FIREBASE, FIREBASE_SDK } from './config.js';

export const SIGN_IN_FAILED = "Sign-in didn't work. Try again.";
export const SIGN_IN_OFFLINE = 'No internet. Connect, then sign in.';
// Closing Google's page is not a failure: nothing is said.
const CANCELLED = ['auth/redirect-cancelled-by-user', 'auth/popup-closed-by-user', 'auth/user-cancelled'];

/** The person's first name, for the chat: the first word of their Google name. */
export function firstNameOf(displayName) {
  return String(displayName || '').trim().split(/\s+/)[0] || '';
}

/** What to say when sign-in failed, from the SDK's error code; '' when the person only went back. */
export function signInMessage(err) {
  const code = err?.code || '';
  if (CANCELLED.includes(code)) return '';
  return code === 'auth/network-request-failed' ? SIGN_IN_OFFLINE : SIGN_IN_FAILED;
}

/** Who is signed in, as the app uses it, or null. */
export function personOf(user) {
  if (!user) return null;
  return { uid: user.uid, email: user.email || '', name: user.displayName || '', firstName: firstNameOf(user.displayName) };
}

/**
 * Start Firebase Auth. onUser(person | null) is called once the SDK knows who is signed in, and at each sign-in and
 * sign-out; onError(message) when coming back from Google failed. `load` imports a module by its URL (a fake in the
 * tests). Answers { signIn, signOut, token }.
 */
export async function startAuth({ onUser, onError = () => {}, load = (url) => import(url) }) {
  const [app, sdk] = await Promise.all([load(`${FIREBASE_SDK}/firebase-app.js`), load(`${FIREBASE_SDK}/firebase-auth.js`)]);
  const auth = sdk.initializeAuth(app.initializeApp(FIREBASE), {
    persistence: [sdk.indexedDBLocalPersistence, sdk.browserLocalPersistence],
    popupRedirectResolver: sdk.browserPopupRedirectResolver,
  });
  sdk.getRedirectResult(auth).catch((err) => {
    const message = signInMessage(err);
    if (message) onError(message);
  });
  sdk.onAuthStateChanged(auth, (user) => onUser(personOf(user)));
  return {
    /** Off to Google's page; the app comes back signed in (onUser). */
    signIn() {
      const provider = new sdk.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      return sdk.signInWithRedirect(auth, provider);
    },
    signOut: () => sdk.signOut(auth),
    token: (force = false) => (auth.currentUser ? auth.currentUser.getIdToken(force) : Promise.resolve(null)),
  };
}
```

- [ ] **Step 5: Pass sign-in's pages on to Firebase**

In `web/vercel.json`, add `rewrites` before `functions`:

Find:

```json
  "functions": {
```

Replace with:

```json
  "rewrites": [
    { "source": "/__/auth/:path*", "destination": "https://buddy-7f8c2.firebaseapp.com/__/auth/:path*" },
    { "source": "/__/firebase/:path*", "destination": "https://buddy-7f8c2.firebaseapp.com/__/firebase/:path*" }
  ],
  "functions": {
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/web-app-auth.test.mjs`
Expected: `# pass 6`, `# fail 0`. (If the config test fails, the two values were not copied from `apps:sdkconfig`.)

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add web/public/app/config.js web/public/app/auth.js web/vercel.json test/web-app-auth.test.mjs
git commit -m "feat(iphone): Google sign-in by redirect, through Buddy's own domain"
```

---

### Task 6: The head: three.js, moods, petting, a shake, sleep

**Files:**
- Create: `web/public/app/motion.js`, `web/public/app/head.js`
- Modify: `web/public/app/app.js` (replace the whole file)
- Test: `test/web-app-motion.test.mjs`

**Interfaces:**
- Consumes: `./shared/moods.js`, `./shared/blend.js`, `./shared/layout.js`, `./shared/gestures.js`, `./shared/symbols.js`, `./shared/sleep.js` (Task 1); `three` and `three/addons/...` through the page's import map; `createStore`, `localStorageOf` (Task 2).
- Produces: `motion.js`: `JOLT = 15`, `createMotionShake({ jolt?, jolts?, withinMs?, gapMs? }?) -> { feed(x, y, z, t) -> boolean, reset() }`, `motionNeedsAsking(DeviceMotionEvent) -> boolean`, `askForMotion(DeviceMotionEvent) -> Promise<'granted'|'denied'|'later'>` (asks iOS; 'later' when iOS refuses the ask itself).
- Produces: `head.js`: `createHead({ canvas, symbolsRoot, onTouch? }) -> { load({ url, accent }) -> Promise, mood(name), micOn(on), level(value 0..1), pause(on) }`; sets `window.__buddyMood` and `window.__buddyFrames` (for the browser check). Throws when WebGL is not there.

- [ ] **Step 1: Write the failing test**

Create `test/web-app-motion.test.mjs`:

```js
// Buddy on iPhone: a shake of the phone (web/public/app/motion.js).

import test from 'node:test';
import assert from 'node:assert';
import { createMotionShake, motionNeedsAsking, askForMotion, JOLT } from '../web/public/app/motion.js';

test('four jolts within 1.2 s are a shake, once; then it counts afresh', () => {
  const shake = createMotionShake();
  assert.deepStrictEqual([0, 200, 400].map((t) => shake.feed(JOLT + 5, 0, 0, t)), [false, false, false]);
  assert.strictEqual(shake.feed(0, -(JOLT + 5), 0, 600), true);
  assert.strictEqual(shake.feed(JOLT + 5, 0, 0, 800), false, 'a new count');
});

test('small moves, jolts too far apart, and readings of the same jolt are not a shake', () => {
  const shake = createMotionShake();
  for (let t = 0; t < 2000; t += 16) assert.strictEqual(shake.feed(3, 4, 2, t), false, 'walking');
  const slow = createMotionShake();
  assert.ok([0, 500, 1000, 1500, 2000].every((t) => !slow.feed(JOLT + 1, 0, 0, t)), 'one jolt every half second');
  const same = createMotionShake();
  assert.ok([0, 16, 32, 48, 64].every((t) => !same.feed(JOLT + 1, 0, 0, t)), 'one jolt read five times');
  assert.strictEqual(createMotionShake().feed(null, 1, 1, 0), false, 'no reading');
});

test('reset forgets the jolts so far', () => {
  const shake = createMotionShake();
  [0, 200, 400].forEach((t) => shake.feed(JOLT + 1, 0, 0, t));
  shake.reset();
  assert.strictEqual(shake.feed(JOLT + 1, 0, 0, 600), false);
});

test('iOS asks before it tells the motion; other browsers do not', () => {
  assert.strictEqual(motionNeedsAsking({ requestPermission: async () => 'granted' }), true);
  assert.strictEqual(motionNeedsAsking(function DeviceMotionEvent() {}), false);
  assert.strictEqual(motionNeedsAsking(undefined), false);
});

test('askForMotion: nothing to ask is granted; the answer is passed on; a refused ask is "later"', async () => {
  assert.strictEqual(await askForMotion({}), 'granted', 'no requestPermission');
  assert.strictEqual(await askForMotion(undefined), 'granted', 'no DeviceMotionEvent');
  assert.strictEqual(await askForMotion({ requestPermission: async () => 'granted' }), 'granted');
  assert.strictEqual(await askForMotion({ requestPermission: async () => 'denied' }), 'denied');
  const warn = console.warn;
  console.warn = () => {};
  try {
    const refused = Promise.reject(Object.assign(new Error('no tap'), { name: 'NotAllowedError' }));
    assert.strictEqual(await askForMotion({ requestPermission: () => refused }), 'later', 'not from a tap iOS accepts');
  } finally {
    console.warn = warn;
  }
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-motion.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/motion.js`.

- [ ] **Step 3: Write motion.js**

Create `web/public/app/motion.js`:

```js
// Shaking the phone makes the buddy dizzy, as shaking it with the mouse does on the Mac (gestures.js does that for a
// drag). The phone says how it moves (DeviceMotionEvent's acceleration, without gravity, in m/s²): a shake is a few big
// jolts close together. Walking, or putting the phone down, stays well under a jolt.

export const JOLT = 15; // m/s²: a hand shaking a phone goes past this; walking stays under 5

/**
 * feed(x, y, z, t) takes one reading (m/s², and the time in ms) and answers true once, when `jolts` jolts came within
 * `withinMs`; then it counts afresh. Readings come about 60 times a second, so readings less than `gapMs` after a jolt
 * are the same jolt.
 */
export function createMotionShake({ jolt = JOLT, jolts = 4, withinMs = 1200, gapMs = 120 } = {}) {
  let times = [];
  return {
    feed(x, y, z, t) {
      if (![x, y, z, t].every(Number.isFinite) || Math.hypot(x, y, z) < jolt) return false;
      if (times.length && t - times[times.length - 1] < gapMs) return false;
      times = [...times.filter((time) => t - time <= withinMs), t];
      if (times.length < jolts) return false;
      times = [];
      return true;
    },
    reset() {
      times = [];
    },
  };
}

/** Whether the browser asks before it tells the phone's motion (iOS 13 and later): then a tap must ask first. */
export function motionNeedsAsking(DeviceMotion) {
  return typeof DeviceMotion?.requestPermission === 'function';
}

/**
 * Asks iOS for the phone's motion (it must come from a tap iOS counts as the person's: a click, not a pointerdown).
 * Answers 'granted' (also when nothing needs asking), 'denied' (the person said no: stop asking), or 'later' (iOS
 * refused the ask itself, e.g. NotAllowedError: ask again at the next tap).
 */
export async function askForMotion(DeviceMotion) {
  if (!motionNeedsAsking(DeviceMotion)) return 'granted';
  try {
    return (await DeviceMotion.requestPermission()) === 'granted' ? 'granted' : 'denied';
  } catch (err) {
    console.warn('[buddy] motion not allowed yet', err?.name);
    return 'later';
  }
}
```

Run: `node --test test/web-app-motion.test.mjs`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 4: Write head.js**

Create `web/public/app/head.js` (it follows `src/renderer/buddy/buddy.js`; three.js cannot run under `node --test`, so it is checked in the browser in Step 6 and Task 12):

```js
// The buddy's head on the phone, drawn with three.js as the Mac draws the whole buddy (src/renderer/buddy/buddy.js),
// from the same .glb files (copied to /app/buddies/). Only the Head node and what hangs from it is drawn, as on
// Android: the phone shows no body. The moods, the blink, the fidgets of a bored buddy and the symbols over the head
// are the Mac's own modules (shared/). A finger stroking the head back and forth is petting (gestures.js). It draws
// only as often as moods.js says, and not at all while paused (the app is hidden), to save the battery.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import {
  BLINK_LOOKAHEAD, EYE_SHAPES, fpsFor, countsAsActive, wakeDelay, floatOffset, createBlinker, createFidgeter,
  blinkWeight, moodPose, restingMood, moodForMic, isRepeat,
} from './shared/moods.js';
import { BLEND, blendPose, smoothLevel } from './shared/blend.js';
import { fromWindow, headMark } from './shared/layout.js';
import { createPetDetector } from './shared/gestures.js';
import { createSymbols } from './shared/symbols.js';

// Room around the head, as a fraction of its size on each side, so a tilt or a squash is not cut off; and above it, as
// a fraction of its height, for the float and the happy bounce (Android's HeadRenderer.kt leaves the same).
const MARGIN = 0.12;
const LIFT_MARGIN = 0.12;
const MAX_PIXEL_RATIO = 2; // sharp on any iPhone, with less than half the pixels of 3×
// What the app shows until it ends it: the buddy at work, or listening. Petting does not cut these short.
const LASTING = new Set(['thinking', 'listening']);

const isUnder = (object, parent) => {
  for (let o = object; o; o = o.parent) if (o === parent) return true;
  return false;
};

/** The glowing materials under `object` (none without one), each with the glow it came with. */
function glowing(object) {
  const parts = [];
  object?.traverse((o) => {
    if (!o.isMesh) return;
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) {
      if (material.emissive && material.emissive.getHex() !== 0) parts.push({ material, base: material.emissiveIntensity });
    }
  });
  return parts;
}

/** Free the GPU memory of a model that is done with. (The buddy files have no skins or textures.) */
function disposeModel(object) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    o.geometry.dispose();
    for (const material of Array.isArray(o.material) ? o.material : [o.material]) material.dispose();
  });
}

/** The parts of the model the head needs (the character contract's Head and Face), or null after saying what is missing. */
function buildRig(gltf) {
  const head = gltf.scene.getObjectByName('Head');
  const face = gltf.scene.getObjectByName('Face');
  if (!head || !face) {
    console.error('[buddy] the model has no Head or no Face');
    return null;
  }
  // Only the head and what hangs from it: the body and the arms are not drawn.
  gltf.scene.traverse((o) => {
    if (o.isMesh && !isUnder(o, head)) o.visible = false;
  });
  const faces = [];
  face.traverse((o) => {
    if (o.isMesh && o.morphTargetDictionary) faces.push(o);
  });
  return {
    scene: gltf.scene, head, faces,
    glows: glowing(face), ears: glowing(gltf.scene.getObjectByName('EarRims')),
    base: { y: head.position.y, rotation: head.rotation.clone(), scale: head.scale.clone() },
    box: null, // the head's bounding box at rest, once loaded: what the camera frames, and where the symbols go
    height: 1,
  };
}

/**
 * The head in `canvas`, its symbols in `symbolsRoot` (over the canvas). onTouch() hears every touch on the head.
 * Answers { load, mood, micOn, level, pause }.
 */
export function createHead({ canvas, symbolsRoot, onTouch = () => {} }) {
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.setClearColor(0x000000, 0);
  // Khronos PBR Neutral keeps the model's colours, as on the Mac.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(28, 1, 0.1, 100);
  // The Mac's soft studio room for the glossy plastic and glass to reflect, made again after a lost GPU context.
  function buildEnvironment() {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    scene.environment?.dispose(); // the lighting from before the lost context
    scene.environment = pmrem.fromScene(room, 0.04).texture;
    scene.environmentRotation.x = -0.3;
    room.dispose();
    pmrem.dispose();
  }
  buildEnvironment();
  canvas.addEventListener('webglcontextrestored', buildEnvironment);
  scene.add(new THREE.HemisphereLight(0xfff3e6, 0xd9cbbd, 0.5));
  const keyLight = new THREE.DirectionalLight(0xffeedd, 1.2);
  keyLight.position.set(1.5, 2.5, 4);
  scene.add(keyLight);

  const raycaster = new THREE.Raycaster();
  const blinker = createBlinker();
  const fidgeter = createFidgeter();
  const pet = createPetDetector();
  const symbols = createSymbols(symbolsRoot);
  const now = () => performance.now() / 1000;

  let rig = null;
  let mood = { name: 'idle', since: now() };
  let shown = null; // the pose drawn last: a new mood eases in from it (blend.js)
  let blend = null; // { from, since } while a new mood eases in
  let lastActive = now();
  let press = false; // a finger is on the head
  let micOn = false;
  const voice = { reading: 0, level: 0, at: now() };
  let timer = null; // the one pending frame; null while paused
  let lastTick = -Infinity;
  let paused = false;
  let size = { width: 1, height: 1 };

  window.__buddyMood = mood.name; // for the browser check, as on the Mac
  window.__buddyFrames = 0;

  /** The camera frames the head at rest with room to move; the symbols go over its top. */
  function frame() {
    if (!rig) return;
    camera.aspect = size.width / size.height;
    const dims = rig.box.getSize(new THREE.Vector3());
    const centre = rig.box.getCenter(new THREE.Vector3());
    centre.y += (dims.y * LIFT_MARGIN) / 2;
    const fit = Math.max(dims.y * (1 + LIFT_MARGIN + 2 * MARGIN), (dims.x * (1 + 2 * MARGIN)) / camera.aspect);
    const distance = fit / 2 / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) + dims.z / 2;
    camera.position.set(centre.x, centre.y, centre.z + distance);
    camera.lookAt(centre);
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    symbols.place(headMark(rig.box, camera, size.width, size.height));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    size = { width: Math.max(1, rect.width), height: Math.max(1, rect.height) };
    renderer.setSize(size.width, size.height, false);
    frame();
    wake(); // a new size clears the canvas: draw it again now
  }

  function setMorph(name, value) {
    for (const mesh of rig.faces) {
      const i = mesh.morphTargetDictionary[name];
      if (i !== undefined) mesh.morphTargetInfluences[i] = value;
    }
  }

  function setGlow(parts, k) {
    for (const { material, base } of parts) material.emissiveIntensity = base * k;
  }

  /** The mood's symbols (none while paused: the "z" letters would come back for nobody). */
  function startSymbols(name, since = 0) {
    const { effect } = moodPose(name, 0);
    if (effect && !paused) symbols.play(effect, { since });
    else symbols.stop();
  }

  /** Load a buddy: `url` of its .glb, `accent` its glow for the symbols. The old one stays until the new one is there. */
  async function load({ url, accent }) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`the buddy did not load: ${res.status}`);
    const buffer = await res.arrayBuffer();
    const gltf = await new Promise((resolve, reject) => new GLTFLoader().parse(buffer, '', resolve, reject));
    const next = buildRig(gltf);
    if (!next) return;
    if (rig) {
      scene.remove(rig.scene);
      disposeModel(rig.scene);
    }
    scene.add(next.scene);
    next.scene.updateMatrixWorld(true);
    next.box = new THREE.Box3().setFromObject(next.head);
    next.height = next.box.max.y - next.box.min.y;
    rig = next;
    if (typeof accent === 'string') symbolsRoot.style.setProperty('--glow', accent);
    frame();
    mood = { ...mood, since: now() };
    startSymbols(mood.name);
    wake();
  }

  const asShown = (name) => (name === 'idle' ? restingMood(micOn) : name);

  function setMood(name, t) {
    const next = asShown(name);
    blend = shown ? { from: shown, since: t } : null;
    if (next !== mood.name) voice.reading = 0;
    mood = { name: next, since: t };
    window.__buddyMood = next;
    fidgeter.reset(t);
    startSymbols(next);
  }

  /** A mood from the app or a touch: start it and draw it at once. The same lasting mood again is not started over. */
  function changeMood(name) {
    if (isRepeat(mood.name, asShown(name))) return;
    setMood(name, now());
    wake();
  }

  /** A mood that is over goes back to rest; a buddy at rest that nobody touches fidgets now and then (bored). */
  function settle(t) {
    if (moodPose(mood.name, t - mood.since).done) setMood('idle', t);
    if (press) {
      fidgeter.reset(t);
    } else if (mood.name === 'idle') {
      const fidget = fidgeter.take(t);
      if (fidget) setMood(fidget, t);
    }
  }

  function poseNow(t) {
    const pose = moodPose(mood.name, t - mood.since, { level: voice.level });
    return { ...pose, blink: blinkWeight(pose, blinker.value(t)) };
  }

  function render(t) {
    voice.level = smoothLevel(voice.level, voice.reading, t - voice.at);
    voice.at = t;
    const pose = blend ? blendPose(blend.from, poseNow(t), t - blend.since) : poseNow(t);
    if (blend && t - blend.since >= BLEND) blend = null;
    shown = pose;
    const { head, base } = rig;
    head.position.y = base.y + (floatOffset(t) * pose.float + pose.lift) * rig.height;
    head.scale.set(base.scale.x * pose.scaleX, base.scale.y * pose.scaleY, base.scale.z * pose.scaleX);
    head.rotation.set(base.rotation.x + pose.headPitch, base.rotation.y + pose.headYaw, base.rotation.z + pose.headTilt);
    setMorph('blink', pose.blink);
    setMorph('mouthO', pose.mouthO);
    setMorph('eyeLUp', pose.eyeL);
    setMorph('eyeRUp', pose.eyeR);
    for (const shape of EYE_SHAPES) setMorph(shape, pose[shape]);
    setGlow(rig.glows, pose.glow);
    setGlow(rig.ears, pose.ears);
    renderer.render(scene, camera);
    window.__buddyFrames += 1;
  }

  /** One timer: the next frame comes when moods.js says one is due, so a resting head costs little. */
  function tick() {
    const t = now();
    lastTick = t;
    if (rig) settle(t);
    const state = { mood: mood.name, since: t - mood.since, pressing: press };
    if (countsAsActive(state)) lastActive = t;
    const fps = fpsFor({
      ...state,
      easing: blend !== null && t - blend.since < BLEND,
      sinceLookChange: Infinity, // the phone's head does not follow a pointer
      blinkSoon: blinker.soon(t, BLINK_LOOKAHEAD),
      sinceActive: t - lastActive,
    });
    timer = setTimeout(tick, 1000 / fps);
    if (rig) render(t);
  }

  function wake() {
    if (timer === null) return;
    clearTimeout(timer);
    timer = setTimeout(tick, wakeDelay(now() - lastTick) * 1000);
  }

  /** Whether the point (clientX, clientY) is on the head. */
  function onHead(clientX, clientY) {
    if (!rig) return false;
    const rect = canvas.getBoundingClientRect();
    raycaster.setFromCamera(fromWindow(clientX - rect.left, clientY - rect.top, rect.width, rect.height), camera);
    return raycaster.intersectObject(rig.head, true).length > 0;
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!onHead(e.clientX, e.clientY)) return;
    press = true;
    pet.reset();
    try {
      canvas.setPointerCapture(e.pointerId);
    } catch {
      // followed on the canvas all the same
    }
    onTouch();
    wake();
  });
  canvas.addEventListener('pointermove', (e) => {
    // Petting: a finger stroked back and forth over the head (gestures.js). A stroke that goes on while the buddy
    // already loves it is not a new one, and it does not cut short what the app is showing.
    if (press && pet.feed(e.clientX, e.timeStamp) && mood.name !== 'love' && !LASTING.has(mood.name)) changeMood('love');
  });
  const endPress = () => {
    press = false;
    pet.reset();
  };
  for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) canvas.addEventListener(type, endPress);
  new ResizeObserver(resize).observe(canvas);

  tick();

  return {
    load,
    mood: changeMood,

    /** The microphone came on or went off: a buddy at rest listens while it is on (moods.js). */
    micOn(on) {
      micOn = Boolean(on);
      const next = moodForMic(mood.name, micOn);
      if (next) changeMood(next);
    },

    /** How loud the person is while the buddy listens (0 to 1, shared/feelings.js buddyLevel). */
    level(value) {
      if (mood.name === 'listening') voice.reading = Number.isFinite(value) ? Math.min(1, Math.max(0, value)) : 0;
    },

    /** Stop drawing while the app is hidden; on again, the mood showing gets its symbols back, as old as it is. */
    pause(on) {
      if (Boolean(on) === paused) return;
      paused = Boolean(on);
      if (paused) {
        clearTimeout(timer);
        timer = null;
        symbols.stop();
      } else {
        fidgeter.reset(now());
        if (timer === null) tick();
        startSymbols(mood.name, Math.max(0, now() - mood.since));
      }
    },
  };
}
```

- [ ] **Step 5: Show the head**

Replace `web/public/app/app.js` with:

```js
// Buddy on iPhone: starts everything. So far, the head (the buddy picked, asleep when left alone, petting, a shake of
// the phone) and the service worker, which keeps the app's files for opening it without the network.

import { createStore, localStorageOf } from './store.js';
import { createHead } from './head.js';
import { createMotionShake, askForMotion } from './motion.js';
import { createSleep } from './shared/sleep.js';

const store = createStore(localStorageOf(window));

let head = null;
try {
  head = createHead({ canvas: document.getElementById('head'), symbolsRoot: document.getElementById('symbols'), onTouch: touched });
} catch (err) {
  console.error('[buddy] the head could not start', err); // no WebGL: the app works on without it
  document.getElementById('head').hidden = true;
}
// Drowsy after a minute left alone and asleep after two, as on the Mac (src/main/sleep.js).
const sleep = createSleep({ onMood: (name) => head?.mood(name) });

const shake = createMotionShake();
let motionAnswered = false; // granted or denied: stop asking
let motionListening = false;

/** The head was touched: a use. */
function touched() {
  sleep.poke();
}

/** A tap on the head asks iOS for the phone's motion, for shaking. iOS takes a click for that, not a pointerdown; if it
 * refuses ('later') the next tap asks again. */
document.getElementById('head').addEventListener('click', async () => {
  if (motionAnswered) return;
  const answer = await askForMotion(window.DeviceMotionEvent);
  if (answer === 'later') return;
  motionAnswered = true;
  if (answer === 'granted') listenForShakes();
});

function listenForShakes() {
  if (motionListening) return;
  motionListening = true;
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    if (a && shake.feed(a.x, a.y, a.z, e.timeStamp)) {
      sleep.poke();
      head?.mood('dizzy');
    }
  });
}

async function loadBuddy() {
  const buddies = await (await fetch('/app/buddies/buddies.json')).json();
  const picked = buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0];
  if (picked && head) await head.load({ url: `/app/buddies/${picked.file}`, accent: picked.accent });
}

document.addEventListener('visibilitychange', () => head?.pause(document.hidden));

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
}

loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
```

- [ ] **Step 6: Run the tests, and look at the head**

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0` (eslint passes on head.js and app.js).

Run (in the background): `npm run serve:web`. Open `http://localhost:8787/app` in Chrome with DevTools' device toolbar at iPhone 14 size (390 × 844): Aarav's head (the cream head with the orange sprout and ear rims) floats and blinks in the top third of the page; nothing else shows yet. In the console: `window.__buddyFrames` grows, `window.__buddyMood` is `'idle'`, and there are no errors. Drag a finger (mouse with touch emulation) left and right over the head three times: hearts, `__buddyMood` is `'love'`. Stop the server.

- [ ] **Step 7: Commit**

```bash
git add web/public/app/motion.js web/public/app/head.js web/public/app/app.js test/web-app-motion.test.mjs
git commit -m "feat(iphone): the 3D head with the Mac's moods, petting, a shake and sleep"
```

---

### Task 7: Voice

**Files:**
- Create: `web/public/app/voice.js`
- Test: `test/web-app-voice.test.mjs`

**Interfaces:**
- Consumes: `./shared/voice-timing.js` (default `VoiceTiming`: `createVoiceTiming`, `levelOf`, `recordingMime`), `./shared/feelings.js` (`buddyLevel`) from Task 1; in tests `ApiError` (Task 2).
- Produces: `voice.js`: `MIC_DENIED = 'Allow the microphone in Settings → Safari.'`, `NO_MIC`, `NOT_HEARD`, `VOICE_OFF`, `NOT_WRITTEN`, `MAX_BYTES`, `pickType(isSupported) -> string`, `toBase64(Uint8Array) -> string`, `voiceFailure(err) -> string`, `createVoice({ transcribe(audio, mime) -> Promise<string>, onState?('idle'|'listening'|'writing'), onLevel?(0..1), onWords?(text), onError?(message), env? }) -> { state, start() -> Promise, stop(), cancel() }`.

- [ ] **Step 1: Write the failing test**

Create `test/web-app-voice.test.mjs`:

```js
// Buddy on iPhone: speaking to Buddy (web/public/app/voice.js), with the browser's parts stood in for.

import test from 'node:test';
import assert from 'node:assert';
import { createVoice, pickType, toBase64, voiceFailure, MIC_DENIED, NO_MIC, NOT_HEARD, VOICE_OFF, NOT_WRITTEN } from '../web/public/app/voice.js';
import { ApiError } from '../web/public/app/api.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

/**
 * A browser with a microphone that hears `level` (the samples' value), a recorder that records `mimeType`, a clock
 * the test moves (tick(ms) runs the timers that are due), and `denied` for a microphone the person said no to.
 */
function fakeBrowser({ level = 0.3, mimeType = 'audio/mp4', denied = false, supports = ['audio/mp4'], recorderBreaks = false, slow = false } = {}) {
  let now = 0;
  let timers = [];
  const mic = { level };
  const seen = { tracksStopped: 0, closed: 0, resumed: 0, recorderStarted: null, asked: 0 };
  const pending = [];
  class Recorder extends EventTarget {
    static isTypeSupported(type) {
      return supports.includes(type);
    }
    constructor(stream, options) {
      super();
      if (recorderBreaks) throw new Error('no recorder');
      this.options = options;
      this.mimeType = mimeType;
      this.state = 'inactive';
    }
    start(slice) {
      seen.recorderStarted = { slice, options: this.options };
      this.state = 'recording';
    }
    stop() {
      this.state = 'inactive';
      const data = new Event('dataavailable');
      data.data = new Blob([new Uint8Array([1, 2, 3])], { type: mimeType });
      this.dispatchEvent(data);
      this.dispatchEvent(new Event('stop'));
    }
  }
  class AudioCtx {
    async resume() {
      seen.resumed += 1;
    }
    createAnalyser() {
      return { fftSize: 0, getFloatTimeDomainData: (samples) => samples.fill(mic.level) };
    }
    createMediaStreamSource() {
      return { connect() {} };
    }
    async close() {
      seen.closed += 1;
    }
  }
  const env = {
    Blob,
    MediaRecorder: Recorder,
    AudioContext: AudioCtx,
    performance: { now: () => now },
    setTimeout: (fn, ms) => {
      timers.push({ fn, at: now + ms });
      return fn;
    },
    clearTimeout: (fn) => {
      timers = timers.filter((t) => t.fn !== fn);
    },
    navigator: {
      mediaDevices: {
        getUserMedia: async () => {
          seen.asked += 1;
          if (slow) await new Promise((resolve) => pending.push(resolve)); // the phone is still asking
          if (denied) throw Object.assign(new Error('no'), { name: 'NotAllowedError' });
          return { getTracks: () => [{ stop: () => { seen.tracksStopped += 1; } }] };
        },
      },
    },
  };
  return {
    env,
    seen,
    /** The phone answers the questions it was asked. */
    answer() {
      while (pending.length) pending.shift()();
    },
    /** From now on the microphone hears this. */
    hear(value) {
      mic.level = value;
    },
    async tick(ms) {
      now += ms;
      const due = timers.filter((t) => t.at <= now);
      timers = timers.filter((t) => t.at > now);
      for (const t of due) t.fn();
      await settle();
    },
  };
}

function setup(browser, { words = 'kal chutti chahiye', fail = null } = {}) {
  const seen = { states: [], levels: [], words: [], errors: [], sent: [] };
  const voice = createVoice({
    transcribe: async (audio, mime) => {
      seen.sent.push({ audio, mime });
      if (fail) throw fail;
      return words;
    },
    onState: (s) => seen.states.push(s),
    onLevel: (l) => seen.levels.push(l),
    onWords: (w) => seen.words.push(w),
    onError: (e) => seen.errors.push(e),
    env: browser.env,
  });
  return { voice, seen };
}

test('🎤 listens, in audio/mp4 on Safari; tapped again, the words are written down and put in the box', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  assert.strictEqual(voice.state, 'listening');
  assert.deepStrictEqual(browser.seen.recorderStarted, { slice: 250, options: { mimeType: 'audio/mp4' } });
  for (let i = 0; i < 5; i += 1) await browser.tick(100); // half a second of voice
  assert.ok(seen.levels.length >= 5 && seen.levels.every((l) => l > 0.5), 'the buddy hears a loud voice');
  voice.stop();
  await settle();
  await settle();
  assert.deepStrictEqual(seen.sent, [{ audio: 'AQID', mime: 'audio/mp4' }]);
  assert.deepStrictEqual(seen.words, ['kal chutti chahiye']);
  assert.deepStrictEqual(seen.states, ['listening', 'writing', 'idle']);
  assert.strictEqual(browser.seen.tracksStopped, 1, 'the microphone is let go');
});

test('listening ends by itself after a quiet once something was said', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  for (let i = 0; i < 5; i += 1) await browser.tick(100); // half a second of voice
  browser.hear(0);
  for (let i = 0; i < 16; i += 1) await browser.tick(100); // then 1.6 s of quiet
  await settle();
  assert.deepStrictEqual(seen.words, ['kal chutti chahiye']);
  assert.strictEqual(voice.state, 'idle');
});

test('nothing said: nothing is sent, and the person hears so', async () => {
  const browser = fakeBrowser({ level: 0 });
  const { voice, seen } = setup(browser);
  await voice.start();
  for (let i = 0; i < 81; i += 1) await browser.tick(100); // 8 s of quiet
  await settle();
  assert.deepStrictEqual(seen.sent, []);
  assert.deepStrictEqual(seen.errors, [NOT_HEARD]);
  assert.strictEqual(voice.state, 'idle');
});

test('a microphone the person said no to, or none at all, is said plainly', async () => {
  const denied = setup(fakeBrowser({ denied: true }));
  await denied.voice.start();
  assert.deepStrictEqual(denied.seen.errors, [MIC_DENIED]);
  assert.strictEqual(denied.voice.state, 'idle');
  const none = setup({ env: { navigator: {} } });
  await none.voice.start();
  assert.deepStrictEqual(none.seen.errors, [NO_MIC]);
});

test('cancel drops the recording: nothing is sent', async () => {
  const browser = fakeBrowser();
  const { voice, seen } = setup(browser);
  await voice.start();
  await browser.tick(100);
  voice.cancel();
  await settle();
  assert.strictEqual(voice.state, 'idle');
  assert.deepStrictEqual(seen.sent, []);
  assert.strictEqual(browser.seen.tracksStopped, 1);
});

test("the server's refusals in its words; voice off and anything else in the phone's", async () => {
  assert.strictEqual(voiceFailure(new ApiError('voice_busy', 'Voice is busy right now.')), 'Voice is busy right now.');
  assert.strictEqual(voiceFailure(new ApiError('voice_off', "Voice isn't set up yet.")), VOICE_OFF);
  assert.strictEqual(voiceFailure(new Error('x')), NOT_WRITTEN);
});

test('the kind of recording, and base64', () => {
  assert.strictEqual(pickType((t) => t === 'audio/mp4'), 'audio/mp4');
  assert.strictEqual(pickType((t) => t.startsWith('audio/webm')), 'audio/webm;codecs=opus');
  assert.strictEqual(pickType(() => { throw new Error('old Safari'); }), '');
  assert.strictEqual(toBase64(new Uint8Array([104, 105])), 'aGk=');
  const big = new Uint8Array(100_000).fill(65);
  assert.strictEqual(Buffer.from(toBase64(big), 'base64').length, 100_000);
});

test('a recorder that cannot be made lets the microphone go, and the next tap works', async () => {
  const broken = fakeBrowser({ recorderBreaks: true });
  const { voice, seen } = setup(broken);
  await voice.start();
  assert.strictEqual(broken.seen.tracksStopped, 1, 'the microphone is let go');
  assert.strictEqual(voice.state, 'idle');
  assert.deepStrictEqual(seen.errors, [NO_MIC]);
  broken.env.MediaRecorder = fakeBrowser().env.MediaRecorder; // now it can
  await voice.start();
  assert.strictEqual(voice.state, 'listening');
});

test('the sound is woken (iOS may start it asleep)', async () => {
  const browser = fakeBrowser();
  const { voice } = setup(browser);
  await voice.start();
  assert.strictEqual(browser.seen.resumed, 1);
});

test('cancel and a new tap while the phone is still asking: only the new one listens', async () => {
  const browser = fakeBrowser({ slow: true });
  const { voice } = setup(browser);
  const first = voice.start();
  voice.cancel();
  const second = voice.start();
  browser.answer();
  await Promise.all([first, second]);
  assert.strictEqual(voice.state, 'listening');
  assert.strictEqual(browser.seen.tracksStopped, 1, "the first tap's microphone is let go");
  assert.strictEqual(browser.seen.asked, 2);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-voice.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/voice.js`.

- [ ] **Step 3: Write the module**

Create `web/public/app/voice.js`:

```js
// Speaking to Buddy on the phone: 🎤 records (MediaRecorder; Safari records audio/mp4), Buddy's server writes down what
// was said (POST /api/transcribe, Whisper with the server's Groq key), and the words go into the box to send. Listening
// ends by itself as on the Mac (shared/voice-timing.js): after a short quiet once something was said, after 8 s of
// nothing, at 60 s, or at 2 MB; or when 🎤 is tapped again. While it listens the buddy listens too, its ear rims glowing
// with the voice (onLevel, as shared/feelings.js makes it).

import VoiceTiming from './shared/voice-timing.js';
import { buddyLevel } from './shared/feelings.js';

export const MIC_DENIED = 'Allow the microphone in Settings → Safari.';
export const NO_MIC = "Your phone can't record here.";
export const NOT_HEARD = "I didn't hear anything. Tap 🎤 and speak.";
export const VOICE_OFF = "Voice isn't set up yet.";
export const NOT_WRITTEN = "I couldn't write down what you said. Try again.";
export const MAX_BYTES = 2_000_000; // about 2 MB: the most Buddy's server takes
const LEVEL_EVERY_MS = 100; // how often the loudness is looked at
const SLICE_MS = 250; // the recorder hands over what it has this often, so the size is known as it grows
// What the phone records in, best first: Safari's, then Chromium's (both are kinds Buddy's server takes).
const TYPES = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm'];

/** The first kind of recording this browser can make (isSupported is MediaRecorder.isTypeSupported), or '' for its own. */
export function pickType(isSupported) {
  return TYPES.find((type) => {
    try {
      return isSupported(type);
    } catch {
      return false;
    }
  }) || '';
}

/** Bytes as base64, a piece at a time (a long recording is too big to spread into one call). */
export function toBase64(bytes) {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

/** The words for a recording that could not be written down. */
export function voiceFailure(err) {
  if (err?.code === 'voice_off') return VOICE_OFF;
  return typeof err?.code === 'string' && err.message ? err.message : NOT_WRITTEN;
}

/**
 * transcribe(audio, mime) answers the words (POST /api/transcribe). onState(state) hears 'idle', 'listening' and
 * 'writing'; onLevel(level) the voice for the buddy (0 to 1); onWords(text) what was said; onError(message) what went
 * wrong. The browser's parts come in as `env` so the tests can stand in for them.
 */
export function createVoice({ transcribe, onState = () => {}, onLevel = () => {}, onWords = () => {}, onError = () => {}, env = globalThis }) {
  let state = 'idle';
  let began = 0; // counts the taps that started listening
  let rec = null; // the recording under way: { stream, recorder, chunks, size, ctx, timer, timing, began }

  function set(next) {
    state = next;
    onState(next);
  }

  /** Stop the microphone and its timer; answers the recording's chunks once the recorder has handed over the last. */
  function release() {
    const r = rec;
    rec = null;
    env.clearTimeout(r.timer);
    const stopped = new Promise((resolve) => {
      if (r.recorder.state === 'inactive') resolve();
      else r.recorder.addEventListener('stop', () => resolve(), { once: true });
    });
    if (r.recorder.state !== 'inactive') r.recorder.stop();
    for (const track of r.stream.getTracks()) track.stop();
    r.ctx.close().catch(() => {});
    return stopped.then(() => r);
  }

  /** Listening is over: what was said is written down, if anything was. */
  async function finish() {
    if (!rec) return;
    set('writing');
    const r = await release();
    onLevel(0);
    try {
      if (!r.timing.heardVoice()) {
        onError(NOT_HEARD);
        return;
      }
      const blob = new env.Blob(r.chunks, { type: r.recorder.mimeType });
      const audio = toBase64(new Uint8Array(await blob.arrayBuffer()));
      const words = String(await transcribe(audio, VoiceTiming.recordingMime(r.recorder.mimeType)) || '').trim();
      if (words) onWords(words);
      else onError(NOT_HEARD);
    } catch (err) {
      onError(voiceFailure(err));
    } finally {
      set('idle');
    }
  }

  function look() {
    if (!rec) return;
    rec.analyser.getFloatTimeDomainData(rec.samples);
    const rms = VoiceTiming.levelOf(rec.samples);
    onLevel(buddyLevel(rms));
    let end = rec.timing.feed(rms, env.performance.now() - rec.began);
    if (end === 'listen' && rec.size >= MAX_BYTES) end = 'too-long';
    if (end === 'listen') rec.timer = env.setTimeout(look, LEVEL_EVERY_MS);
    else finish();
  }

  return {
    get state() {
      return state;
    },

    /** Start listening. Called from a tap: iOS lets the microphone and the sound start only then. */
    async start() {
      if (state !== 'idle') return;
      const Recorder = env.MediaRecorder;
      const AudioCtx = env.AudioContext || env.webkitAudioContext;
      if (!env.navigator?.mediaDevices?.getUserMedia || !Recorder || !AudioCtx) {
        onError(NO_MIC);
        return;
      }
      set('listening');
      const turn = ++began; // a cancel and a new tap while the phone is still asking must not both go on
      let stream;
      try {
        stream = await env.navigator.mediaDevices.getUserMedia({ audio: true });
      } catch (err) {
        if (turn !== began) return;
        set('idle');
        onError(err?.name === 'NotAllowedError' ? MIC_DENIED : NO_MIC);
        return;
      }
      if (state !== 'listening' || turn !== began) {
        for (const track of stream.getTracks()) track.stop(); // cancelled while the phone was asking
        return;
      }
      let ctx;
      try {
        const type = pickType((t) => Recorder.isTypeSupported(t));
        const recorder = new Recorder(stream, type ? { mimeType: type } : {});
        ctx = new AudioCtx();
        ctx.resume?.().catch(() => {}); // made after an await, iOS may start it asleep, and the level would read silence
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 1024;
        ctx.createMediaStreamSource(stream).connect(analyser);
        rec = {
          stream, recorder, ctx, analyser, chunks: [], size: 0, timer: null,
          samples: new Float32Array(analyser.fftSize), timing: VoiceTiming.createVoiceTiming(), began: env.performance.now(),
        };
        const mine = rec;
        recorder.addEventListener('dataavailable', (e) => {
          if (!e.data?.size) return;
          mine.chunks.push(e.data);
          mine.size += e.data.size;
        });
        recorder.start(SLICE_MS);
        rec.timer = env.setTimeout(look, LEVEL_EVERY_MS);
      } catch {
        // the microphone must not stay on (iOS keeps its light lit) when the recorder or the sound cannot be made
        rec = null;
        for (const track of stream.getTracks()) track.stop();
        ctx?.close().catch(() => {});
        set('idle');
        onError(NO_MIC);
      }
    },

    /** 🎤 tapped again: listening ends, and what was said is written down. */
    stop() {
      if (state === 'listening' && rec) finish();
    },

    /** Drop the listening without sending it (another tab, the app hidden, signed out). */
    cancel() {
      if (state !== 'listening') return;
      if (rec) release();
      onLevel(0);
      set('idle');
    },
  };
}
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/web-app-voice.test.mjs`
Expected: `# pass 10`, `# fail 0`.

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app/voice.js test/web-app-voice.test.mjs
git commit -m "feat(iphone): voice: record, stop by itself, and write it down on the server"
```

---

### Task 8: The server: POST /api/push, pushKey, and a notification when a session finishes

**Files:**
- Create: `web/lib/push.js`, `web/api/push.js`
- Modify: `web/lib/remote.js`, `web/lib/handlers.js`, `web/lib/deps.js`, `web/lib/firestore-db.js`, `test/helpers/fake-db.js`, `src/main/cloud.js`, `test/server-runtime.test.js`, `test/server-vercel.test.js`, `test/firestore/firestore-db.test.js`, `web/package.json`, `web/package-lock.json`
- Test: `test/server-push.test.js`

**Interfaces:**
- Produces: `web/lib/push.js`: `MAX_SUBS = 5`, `ENDPOINT_MAX = 1000`, `checkSubscription(value) -> { endpoint, keys: { p256dh, auth } }` (throws `BuddyError('bad_request')`), `subsOf(doc) -> [{ endpoint, keys, at }]`, `addSub(doc, sub, now) -> { next, result: { on: true } }`, `removeEndpoints(doc, endpoints) -> { next, result: { on: false } }`, `message(session) -> { title, body, session, tag }`.
- Produces: `remote.justFinished(doc, body, now) -> [{ id, name, status }]`.
- Produces: handlers `pushRoute` (`POST /api/push`), `STATUS.push_off = 503`, `config` adds `pushKey` when `deps.push` is set, `remoteMac` sends notifications. `deps.push = { publicKey, send(subscription, payload) } | null`; `deps.db.getPush(uid) -> doc | null`, `deps.db.updatePush(uid, change) -> result`.
- Produces: `web/lib/deps.js` `pushFrom(env, load?) -> deps.push`.
- Push payload (read by `sw.js` in Task 9): JSON `{ title, body, session, tag }`.

- [ ] **Step 1: Write the failing test**

Create `test/server-push.test.js`:

```js
'use strict';

// Notifications on the phone: the subscriptions (web/lib/push.js, POST /api/push), the trigger in a computer's report
// (remote.justFinished, remoteMac) and Web Push's setup (web/lib/deps.js pushFrom).

const test = require('node:test');
const assert = require('node:assert');
const { config, remoteMac, pushRoute, handle } = require('../web/lib/handlers');
const remote = require('../web/lib/remote');
const pushRules = require('../web/lib/push');
const { pushFrom } = require('../web/lib/deps');
const { fakeDb } = require('./helpers/fake-db');

const T = 1_800_000_000_000;
const MAC = { id: 'mac-11111111', name: "Akshat's MacBook Air" };
const S1 = { id: 'aaaa-1111', name: 'shop', status: 'working', canTalk: true };
const S2 = { id: 'bbbb-2222', name: 'blog', status: 'working', canTalk: true };
const APPLE = 'https://web.push.apple.com/QGuQyavXutnMHabc';
const GOOGLE = 'https://fcm.googleapis.com/fcm/send/dpH5lCsTSSM:APA91bHq';
const KEYS = { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' };
const sub = (endpoint = APPLE) => ({ endpoint, keys: KEYS });
const TOKENS = { a: { uid: 'u1', email: 'a@gmail.com', name: 'A', emailVerified: true } };

/**
 * The handlers with fakes. `push` is Web Push (null: no VAPID keys); its send records each notification, and answers
 * the status in `refuse[endpoint]` (a push service's refusal) or throws `fail`.
 */
function setup({ remotes = {}, pushes = {}, push = true, refuse = {}, fail = null, at = T } = {}) {
  const db = fakeDb({ remotes, pushes });
  const sent = [];
  const deps = {
    db,
    now: () => new Date(at),
    verifyToken: async (token) => {
      if (!TOKENS[token]) throw Object.assign(new Error('bad'), { code: 'auth/argument-error' });
      return TOKENS[token];
    },
    push: push ? {
      publicKey: 'BPublicKey',
      async send(subscription, payload) {
        sent.push({ endpoint: subscription.endpoint, keys: subscription.keys, payload: JSON.parse(payload) });
        if (fail) throw fail;
        if (refuse[subscription.endpoint]) throw Object.assign(new Error('Received unexpected response code'), { name: 'WebPushError', statusCode: refuse[subscription.endpoint] });
      },
    } : null,
  };
  const run = (handler, method, { token = 'a', body } = {}) => handle(handler, { method, headers: token ? { authorization: `Bearer ${token}` } : {}, body }, deps);
  const report = (sessions, extra = {}) => run(remoteMac, 'POST', { body: { device: MAC, sessions, ...extra } });
  return { db, sent, deps, run, report, setAt: (t) => { deps.now = () => new Date(t); } };
}

const record = (sessions, extra = {}) => ({ devices: { [MAC.id]: { name: MAC.name, seenAt: T - 3000, sessions } }, watch: null, feed: null, inbox: [], ...extra });

// ---- the rules ----

test('a session that was working and now is done or waiting has just finished; anything else has not', () => {
  const doc = record([S1, S2, { ...S1, id: 'cccc-3333', status: 'idle' }]);
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }, { ...S2, status: 'waiting' }, { ...S1, id: 'cccc-3333', status: 'done' }] };
  assert.deepStrictEqual(remote.justFinished(doc, body, T), [
    { id: S1.id, name: 'shop', status: 'done' },
    { id: S2.id, name: 'blog', status: 'waiting' },
  ]);
  assert.deepStrictEqual(remote.justFinished(doc, { device: MAC, sessions: [S1, { ...S2, status: 'failed' }] }, T), [], 'still working, or failed');
  assert.deepStrictEqual(remote.justFinished(null, body, T), [], "a computer's first report");
  assert.deepStrictEqual(remote.justFinished(doc, { device: MAC, off: true }, T), [], 'sharing turned off');
  assert.deepStrictEqual(remote.justFinished(doc, { device: { id: 'pc-222222222', name: 'PC' }, sessions: body.sessions }, T), [], "another computer's");
});

test("a computer last seen long ago (offline, then back) has no late news: only a recent report counts", () => {
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }] };
  const old = (seenAt) => ({ ...record([S1]), devices: { [MAC.id]: { name: MAC.name, seenAt, sessions: [S1] } } });
  assert.deepStrictEqual(remote.justFinished(old(T - remote.ONLINE_MS + 1), body, T).map((s) => s.id), [S1.id]);
  assert.deepStrictEqual(remote.justFinished(old(T - remote.ONLINE_MS), body, T), []);
  assert.deepStrictEqual(remote.justFinished(old(T - 2 * 60 * 60_000), body, T), []);
});

test('the session being watched right now is left out: the person sees it already', () => {
  const watched = record([S1, S2], { watch: { sessionId: S1.id, at: T - 1000 } });
  const body = { device: MAC, sessions: [{ ...S1, status: 'done' }, { ...S2, status: 'done' }] };
  assert.deepStrictEqual(remote.justFinished(watched, body, T).map((s) => s.id), [S2.id]);
  assert.deepStrictEqual(remote.justFinished(watched, body, T + remote.WATCH_MS).map((s) => s.id), [S1.id, S2.id], 'a watch that lapsed');
});

test('a subscription is checked: a push service of Apple, Google, Mozilla or Microsoft, over https, with its keys', () => {
  assert.deepStrictEqual(pushRules.checkSubscription({ ...sub(), expirationTime: null }), sub());
  for (const endpoint of [GOOGLE, 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://wns2-par02p.notify.windows.com/w/?token=x']) {
    assert.strictEqual(pushRules.checkSubscription(sub(endpoint)).endpoint, endpoint);
  }
  const refused = [
    null, 'x', {}, sub('http://web.push.apple.com/x'), sub('https://evil.example.com/x'), sub('https://web.push.apple.com.evil.io/x'),
    sub(`https://web.push.apple.com/${'x'.repeat(1000)}`), { endpoint: APPLE }, { endpoint: APPLE, keys: { p256dh: 'short', auth: KEYS.auth } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: 'has spaces in it' } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh.slice(0, 40), auth: KEYS.auth } }, // not 65 bytes
    { endpoint: APPLE, keys: { p256dh: `${KEYS.p256dh}AAAA`, auth: KEYS.auth } },
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: 'tBHItJI5svbpez7K' } }, // not 16 bytes
    { endpoint: APPLE, keys: { p256dh: KEYS.p256dh, auth: `${KEYS.auth}AAAA` } },
    // addresses the two URL parsers read differently (web-push sends to url.parse's hostname), or with more than a host
    ...[
      'https://169.254.169.254;.push.apple.com/latest', 'https://evil.com;.push.apple.com/', 'https://evil.com{.push.apple.com/',
      "https://evil.com'.push.apple.com/", 'https://evil.com".push.apple.com/', 'https://evil.com`.push.apple.com/',
      'https://evil.com%E3%80%82push.apple.com/', ' https://web.push.apple.com/x', 'https://web.push.apple.com:22/x',
      'https://user@web.push.apple.com/x', 'https://web.push.apple.com', 'https://web.push.apple.com/x y',
    ].map((endpoint) => sub(endpoint)),
  ];
  for (const value of refused) assert.throws(() => pushRules.checkSubscription(value), { code: 'bad_request' }, JSON.stringify(value)?.slice(0, 60));
});

test('a phone switching on is kept in place of the same one; at most 5, the newest; switching off forgets it', () => {
  let doc = null;
  doc = pushRules.addSub(doc, sub(APPLE), T).next;
  doc = pushRules.addSub(doc, sub(GOOGLE), T + 1).next;
  doc = pushRules.addSub(doc, sub(APPLE), T + 2).next;
  assert.deepStrictEqual(doc.subs.map((s) => [s.endpoint, s.at]), [[GOOGLE, T + 1], [APPLE, T + 2]]);
  for (let i = 0; i < 6; i += 1) doc = pushRules.addSub(doc, sub(`${APPLE}${i}`), T + 10 + i).next;
  assert.strictEqual(doc.subs.length, 5);
  assert.strictEqual(doc.subs[4].endpoint, `${APPLE}5`);
  assert.deepStrictEqual(pushRules.removeEndpoints(doc, ['https://web.push.apple.com/none']), { next: undefined, result: { on: false } });
  const fewer = pushRules.removeEndpoints(doc, [`${APPLE}5`]).next;
  assert.strictEqual(fewer.subs.length, 4);
  assert.deepStrictEqual(pushRules.removeEndpoints({ subs: [{ ...sub(), at: 1 }] }, [APPLE]), { next: null, result: { on: false } }, 'the last one: the record goes');
  assert.deepStrictEqual(pushRules.subsOf({ subs: [sub(), { endpoint: 'https://evil.example.com/x', keys: KEYS }, { endpoint: 'https://evil.com;.push.apple.com/', keys: KEYS }, null] }), [{ ...sub(), at: 0 }]);
});

test('what a notification says', () => {
  assert.deepStrictEqual(pushRules.message({ id: S1.id, name: 'shop', status: 'done' }),
    { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` });
  assert.strictEqual(pushRules.message({ id: S1.id, name: 'shop', status: 'waiting' }).body, 'Claude Code needs you');
});

// ---- POST /api/push ----

test('POST /api/push keeps and forgets the phone', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub() } }), { status: 200, body: { on: true } });
  assert.deepStrictEqual(s.db.state.pushes.u1, { subs: [{ ...sub(), at: T }] });
  assert.deepStrictEqual(await s.run(pushRoute, 'POST', { body: { action: 'off', endpoint: APPLE } }), { status: 200, body: { on: false } });
  assert.strictEqual(s.db.state.pushes.u1, undefined);
});

test('POST /api/push refuses what it should', async () => {
  const s = setup();
  assert.strictEqual((await s.run(pushRoute, 'POST', { token: null, body: { action: 'on', subscription: sub() } })).status, 401);
  assert.strictEqual((await s.run(pushRoute, 'GET')).status, 405);
  assert.deepStrictEqual((await s.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub('https://evil.example.com/x') } })).body.error,
    { code: 'bad_request', message: "Notifications couldn't be switched on. Try again." });
  assert.strictEqual((await s.run(pushRoute, 'POST', { body: { action: 'off' } })).status, 400);
  assert.strictEqual((await s.run(pushRoute, 'POST', { body: { action: 'dance' } })).status, 400);
  assert.deepStrictEqual(s.db.state.pushes, {});
  const off = setup({ push: false });
  assert.deepStrictEqual(await off.run(pushRoute, 'POST', { body: { action: 'on', subscription: sub() } }),
    { status: 503, body: { error: { code: 'push_off', message: "Notifications aren't set up yet." } } });
});

test('GET /api/config gives the public key when notifications are set up, and no key when they are not', async () => {
  assert.strictEqual((await setup().run(config, 'GET')).body.pushKey, 'BPublicKey');
  assert.ok(!('pushKey' in (await setup({ push: false }).run(config, 'GET')).body));
});

// ---- the trigger ----

test('a session that finishes on the computer is told to each phone, once', async () => {
  const s = setup({ remotes: { u1: record([S1, S2]) }, pushes: { u1: { subs: [{ ...sub(APPLE), at: 1 }, { ...sub(GOOGLE), at: 2 }] } } });
  const r = await s.report([{ ...S1, status: 'done' }, S2]);
  assert.deepStrictEqual(r, { status: 200, body: { watch: null, inbox: [] } });
  assert.deepStrictEqual(s.sent, [
    { endpoint: APPLE, keys: KEYS, payload: { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` } },
    { endpoint: GOOGLE, keys: KEYS, payload: { title: 'shop', body: 'Claude Code finished', session: S1.id, tag: `claude-${S1.id}` } },
  ]);
  s.setAt(T + 3000);
  await s.report([{ ...S1, status: 'done' }, { ...S2, status: 'waiting' }]);
  assert.deepStrictEqual(s.sent.slice(2).map((n) => [n.payload.title, n.payload.body]), [['blog', 'Claude Code needs you'], ['blog', 'Claude Code needs you']]);
});

test('an ordinary report reads nothing more, and sends nothing', async () => {
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } } });
  await s.report([S1]);
  await s.report([{ ...S1, status: 'idle' }]);
  assert.deepStrictEqual(s.sent, []);
  assert.ok(!s.db.state.calls.includes('getPush'));
});

test('nobody switched notifications on, or the server has no keys: nothing is sent', async () => {
  const none = setup({ remotes: { u1: record([S1]) } });
  await none.report([{ ...S1, status: 'done' }]);
  assert.deepStrictEqual(none.sent, []);
  const off = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } }, push: false });
  assert.strictEqual((await off.report([{ ...S1, status: 'done' }])).status, 200);
  assert.ok(!off.db.state.calls.includes('getPush'));
});

test('a phone the push service says is gone is forgotten; any other refusal keeps it, and only its status is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(APPLE), at: 1 }, { ...sub(GOOGLE), at: 2 }] } }, refuse: { [APPLE]: 410, [GOOGLE]: 500 } });
  assert.strictEqual((await s.report([{ ...S1, status: 'done' }])).status, 200);
  assert.deepStrictEqual(s.db.state.pushes.u1.subs.map((x) => x.endpoint), [GOOGLE]);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] not sent: 500']);
});

test("Web Push failing never fails the computer's report", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } }, fail: new TypeError('fetch failed') });
  assert.deepStrictEqual(await s.report([{ ...S1, status: 'done' }]), { status: 200, body: { watch: null, inbox: [] } });
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] not sent: TypeError']);

  const broken = setup({ remotes: { u1: record([S1]) } });
  broken.db.getPush = async () => {
    throw Object.assign(new Error('unavailable'), { code: 14 });
  };
  assert.strictEqual((await broken.report([{ ...S1, status: 'done' }])).status, 200);
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments.join(' ')), ['[push] could not notify: 14']);
});

test("a push service that never answers holds the computer's report up only so long", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ remotes: { u1: record([S1]) }, pushes: { u1: { subs: [{ ...sub(), at: 1 }] } } });
  s.deps.push.send = () => new Promise(() => {});
  s.deps.notifyMs = 50;
  const started = Date.now();
  assert.deepStrictEqual(await s.report([{ ...S1, status: 'done' }]), { status: 200, body: { watch: null, inbox: [] } });
  assert.ok(Date.now() - started < 1000, `answered in ${Date.now() - started} ms`);
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[push] took too long']);
});

// ---- Web Push's setup ----

test('Web Push is on only with all three VAPID values, and sends with them, an hour to live and a short wait', async () => {
  const env = { VAPID_PUBLIC_KEY: ' BPub ', VAPID_PRIVATE_KEY: 'priv', VAPID_SUBJECT: 'mailto:akshatg9636@gmail.com' };
  let loads = 0;
  const calls = [];
  const load = () => {
    loads += 1;
    return { sendNotification: async (...args) => calls.push(args) };
  };
  assert.strictEqual(pushFrom({}, load), null);
  assert.strictEqual(pushFrom({ ...env, VAPID_PRIVATE_KEY: '' }, load), null);
  assert.strictEqual(loads, 0, 'web-push is not even loaded');
  const push = pushFrom(env, load);
  assert.strictEqual(push.publicKey, 'BPub');
  await push.send(sub(), '{"title":"x"}');
  assert.deepStrictEqual(calls, [[sub(), '{"title":"x"}', {
    vapidDetails: { subject: 'mailto:akshatg9636@gmail.com', publicKey: 'BPub', privateKey: 'priv' }, TTL: 3600, urgency: 'high', timeout: 5000,
  }]]);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/server-push.test.js`
Expected: FAIL with `Cannot find module '../web/lib/push'`.

- [ ] **Step 3: Add web-push to the server**

Run: `npm view web-push version`
Expected: `3.6.7` (or a newer 3.x; then use that number below).

Run: `cd web && npm install web-push@^3.6.7 --no-audit --no-fund && cd ..`
Expected: `web/package.json` now lists `"web-push": "^3.6.7"` next to `firebase-admin`, and `web/package-lock.json` changed. (This also installs `web/node_modules`, so `test/server-runtime.test.js` stops being skipped.)

- [ ] **Step 4: Write the subscriptions' rules**

Create `web/lib/push.js`:

```js
'use strict';

/**
 * Notifications on the person's phones (Web Push): the browsers' subscriptions, kept in Firestore as push/{uid} =
 * { subs: [{ endpoint, keys: { p256dh, auth }, at }] }, at most MAX_SUBS of them (the newest kept), and what a
 * notification says. Plain functions over the record, as in remote.js: a change answers { next, result }, where `next`
 * is the record to keep (null: delete it, undefined: leave it as it is) and `result` what the caller is told.
 *
 * A subscription's endpoint is the push service's address that the server posts each notification to. Only the push
 * services of Apple, Google, Mozilla and Microsoft are taken, so the server never posts to an address someone made up.
 * The address is checked as it is written, letter by letter (ENDPOINT): web-push reads its host with Node's old
 * url.parse, which can read an odd address differently from new URL(), so anything odd is refused before either looks.
 */

const { BuddyError } = require('../shared/errors');

const MAX_SUBS = 5;
const ENDPOINT_MAX = 1000;
const KEY = /^[\w-]{8,200}={0,2}$/; // the browser's keys for the subscription, in base64url
const P256DH_BYTES = 65; // the browser's public key: a P-256 point
const AUTH_BYTES = 16; // the browser's secret for the subscription
// https://, a push service's host (letters, digits, dots and dashes only: no user, no port), then / and a plain path
const ENDPOINT = /^https:\/\/(?:(?:[a-z0-9-]+\.)*(?:push\.apple\.com|push\.services\.mozilla\.com|notify\.windows\.com)|fcm\.googleapis\.com)\/[\w\-.~:/?#!$&()*+,;=%]*$/i;
const NOT_A_SUBSCRIPTION = "Notifications couldn't be switched on. Try again.";
const SAYS = { done: 'Claude Code finished', waiting: 'Claude Code needs you' };

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** A push service's address, or null for anything else. */
function checkEndpoint(value) {
  if (typeof value !== 'string' || value.length > ENDPOINT_MAX || !ENDPOINT.test(value)) return null;
  try {
    return require('node:url').parse(value).hostname === new URL(value).hostname ? value : null; // both read one host
  } catch {
    return null;
  }
}

const bytes = (key) => Buffer.from(key, 'base64url').length;
const checkKey = (key, size) => typeof key === 'string' && KEY.test(key) && bytes(key) === size;
const checkKeys = (keys) => isObject(keys) && checkKey(keys.p256dh, P256DH_BYTES) && checkKey(keys.auth, AUTH_BYTES);

/** A browser's subscription (PushSubscription.toJSON()), checked: { endpoint, keys: { p256dh, auth } }. */
function checkSubscription(value) {
  const endpoint = checkEndpoint(value?.endpoint);
  if (!isObject(value) || !endpoint || !checkKeys(value.keys)) throw new BuddyError('bad_request', NOT_A_SUBSCRIPTION);
  return { endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

/** The subscriptions in a record, as web-push sends to them; anything broken is left out. */
function subsOf(doc) {
  return (Array.isArray(doc?.subs) ? doc.subs : [])
    .filter((s) => isObject(s) && checkEndpoint(s.endpoint) && checkKeys(s.keys))
    .map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, at: Number.isFinite(s.at) ? s.at : 0 }));
}

/** A phone switched notifications on: its subscription is kept (in place of the same one), the newest MAX_SUBS. */
function addSub(doc, sub, now) {
  const others = subsOf(doc).filter((s) => s.endpoint !== sub.endpoint);
  return { next: { subs: [...others, { ...sub, at: now }].slice(-MAX_SUBS) }, result: { on: true } };
}

/** Subscriptions forgotten: switched off on the phone, or gone from the push service (404, 410). */
function removeEndpoints(doc, endpoints) {
  const subs = subsOf(doc);
  const left = subs.filter((s) => !endpoints.includes(s.endpoint));
  if (left.length === subs.length) return { next: undefined, result: { on: false } };
  return { next: left.length ? { subs: left } : null, result: { on: false } };
}

/** The notification for a session that stopped working (remote.justFinished): its name, and what happened. */
function message(session) {
  return { title: session.name, body: SAYS[session.status] || SAYS.done, session: session.id, tag: `claude-${session.id}` };
}

module.exports = { MAX_SUBS, ENDPOINT_MAX, checkSubscription, subsOf, addSub, removeEndpoints, message };
```

- [ ] **Step 5: Find the sessions that just finished**

In `web/lib/remote.js`, add `justFinished` before `checkDeviceId`:

Find:

```js
/** A device id from a request
```

Replace with:

```js
/**
 * The sessions of a computer's report that just stopped working: working in its last report, done or waiting in this
 * one. Each is { id, name, status }, for a notification on the person's phones (web/lib/push.js). The session a watcher
 * is looking at right now is left out: the person sees it already. A computer's first report, one turning sharing
 * off, or one back after it was offline (its last report older than ONLINE_MS: that news is old) has none.
 */
function justFinished(doc, body, now) {
  if (body.off === true) return [];
  const before = devicesOf(doc)[checkDevice(body.device).id];
  if (!before || !(now - before.seenAt < ONLINE_MS)) return [];
  const watched = watching(doc, now);
  const wasWorking = (id) => before.sessions.some((s) => s.id === id && s.status === 'working');
  return cleanSessions(body.sessions)
    .filter((s) => (s.status === 'done' || s.status === 'waiting') && s.id !== watched && wasWorking(s.id))
    .map(({ id, name, status }) => ({ id, name, status }));
}

/** A device id from a request
```

and export it:

Find:

```js
cleanSessions, cleanItems, macReport, phoneLook, phoneSend, phoneStop, checkText, checkSessionId, checkDeviceId,
```

Replace with:

```js
cleanSessions, cleanItems, macReport, justFinished, phoneLook, phoneSend, phoneStop, checkText, checkSessionId, checkDeviceId,
```

- [ ] **Step 6: The handlers**

In `web/lib/handlers.js`, describe the new dependency:

Find:

```js
 *   fetchImpl                optional, for the providers and for Groq's Whisper (web/lib/transcribe.js)
 * }
```

Replace with:

```js
 *   fetchImpl                optional, for the providers and for Groq's Whisper (web/lib/transcribe.js)
 *   push                     { publicKey, send(subscription, payload) } for Web Push with the server's VAPID keys, or
 *                            null when they are not set (web/lib/deps.js); send rejects with the push service's
 *                            `statusCode` when it turns a notification down
 * }
```

Require the rules:

Find:

```js
const remote = require('./remote');
```

Replace with:

```js
const remote = require('./remote');
const pushRules = require('./push');
```

Bound how long a report waits for its notifications:

Find:

```js
const MODELS_TIMEOUT_MS = 15_000;
```

Replace with:

```js
const MODELS_TIMEOUT_MS = 15_000;
const NOTIFY_MS = 4_000; // the most a computer's report waits for its notifications (notifyInTime)
```

Add the error code:

Find:

```js
  voice_off: 503, // no Groq key on the server
};
```

Replace with:

```js
  voice_off: 503, // no Groq key on the server
  push_off: 503, // no VAPID keys on the server: notifications are not set up
};
```

Give the public key in `config`:

Find:

```js
    voiceOn: hasKey('groq'), // voice needs only the server's Groq key, whatever free mode is set to
  });
```

Replace with:

```js
    voiceOn: hasKey('groq'), // voice needs only the server's Groq key, whatever free mode is set to
    ...(deps.push ? { pushKey: deps.push.publicKey } : {}), // notifications on the phone (POST /api/push)
  });
```

Replace `remoteMac` with `notify`, `notifyInTime` and the new `remoteMac`:

Find:

```js
/**
 * POST /api/remote/mac { device, sessions, feed?, done?, off? }: one of the person's computers shares its Claude Code
 * sessions (Claude mode from anywhere, web/lib/remote.js). Answers { watch, inbox }: its session being watched, and the
 * words sent to its sessions. Nothing in it is logged.
 */
async function remoteMac(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  return answer(await deps.db.updateRemote(who.uid, (doc) => remote.macReport(doc, body, deps.now().getTime())));
}
```

Replace with:

```js
/**
 * Tell the person's phones that these sessions stopped working (remote.justFinished): one notification per session on
 * each phone that switched them on. A subscription the push service says is gone (404, 410) is forgotten. Nothing
 * here can fail the computer's report: a failure is logged by its kind, or the push service's status, only.
 */
async function notify(uid, finished, deps) {
  try {
    const subs = pushRules.subsOf(await deps.db.getPush(uid));
    const gone = new Set();
    await Promise.all(finished.flatMap((session) => subs.map(async (sub) => {
      try {
        await deps.push.send({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(pushRules.message(session)));
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) gone.add(sub.endpoint);
        else console.warn(`[push] not sent: ${err?.statusCode || kindOf(err)}`);
      }
    })));
    if (gone.size) await deps.db.updatePush(uid, (doc) => pushRules.removeEndpoints(doc, [...gone]));
  } catch (err) {
    console.error(`[push] could not notify: ${kindOf(err)}`);
  }
}

/**
 * notify, but never for longer than NOTIFY_MS (deps.notifyMs in the tests): the computer's report waits for it, and
 * must not wait on a push service or Firestore that is slow. What is still going on then is left to finish, or not.
 */
async function notifyInTime(uid, finished, deps) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(true), deps.notifyMs ?? NOTIFY_MS);
  });
  const tooLong = await Promise.race([notify(uid, finished, deps).then(() => false), late]);
  clearTimeout(timer);
  if (tooLong) console.warn('[push] took too long');
}

/**
 * POST /api/remote/mac { device, sessions, feed?, done?, off? }: one of the person's computers shares its Claude Code
 * sessions (Claude mode from anywhere, web/lib/remote.js). Answers { watch, inbox }: its session being watched, and the
 * words sent to its sessions. A session that stopped working (done, or waiting for the person) is told to their phones
 * (notify). Nothing in it is logged.
 */
async function remoteMac(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  const now = deps.now().getTime();
  let finished = [];
  const result = await deps.db.updateRemote(who.uid, (doc) => {
    const out = remote.macReport(doc, body, now); // checks the report first
    finished = remote.justFinished(doc, body, now); // the transaction may run this again: the last run counts
    return out;
  });
  if (finished.length && deps.push) await notifyInTime(who.uid, finished, deps);
  return answer(result);
}
```

Add `pushRoute` before `settingsView`:

Find:

```js
function settingsView(cfg, hasKey) {
```

Replace with:

```js
/**
 * POST /api/push: notifications on the person's phone. { action: 'on', subscription } keeps the browser's subscription
 * (PushSubscription.toJSON()); { action: 'off', endpoint } forgets it. Answers { on }.
 */
async function pushRoute(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  if (body.action === 'on') {
    if (!deps.push) throw new BuddyError('push_off', "Notifications aren't set up yet.");
    const sub = pushRules.checkSubscription(body.subscription);
    const now = deps.now().getTime();
    return answer(await deps.db.updatePush(who.uid, (doc) => pushRules.addSub(doc, sub, now)));
  }
  if (body.action === 'off') {
    if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > pushRules.ENDPOINT_MAX) {
      throw new BuddyError('bad_request', 'Not a notifications request.');
    }
    return answer(await deps.db.updatePush(who.uid, (doc) => pushRules.removeEndpoints(doc, [body.endpoint])));
  }
  throw new BuddyError('bad_request', 'Not a notifications request.');
}

function settingsView(cfg, hasKey) {
```

Export it:

Find:

```js
module.exports = { config, ask, transcribe, remoteMac, remotePhone, adminSettings,
```

Replace with:

```js
module.exports = { config, ask, transcribe, remoteMac, remotePhone, pushRoute, adminSettings,
```

The desktop app's list of the server's codes must stay equal to `STATUS` (`test/cloud.test.js`). In `src/main/cloud.js`:

Find:

```js
  'method_not_allowed', 'free_limit', 'upstream', 'server', 'voice_off', 'voice_busy', 'mac_offline',
```

Replace with:

```js
  'method_not_allowed', 'free_limit', 'upstream', 'server', 'voice_off', 'voice_busy', 'mac_offline', 'push_off',
```

Create `web/api/push.js`:

```js
'use strict';

// POST /api/push: notifications on the person's phone, switched on or off (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { pushRoute } = require('../lib/handlers');

module.exports = toVercel(pushRoute);
```

- [ ] **Step 7: Web Push's setup from the environment**

In `web/lib/deps.js`:

Find:

```js
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY   any of them
 *
```

Replace with:

```js
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY   any of them
 *   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT   Web Push's keys (npx web-push generate-vapid-keys) and a
 *                               mailto: address for the push services: all three, or notifications are off
 *
```

Find:

```js
 * Made once per warm instance. firebase-admin is loaded only here, so the tests never need it.
```

Replace with:

```js
 * Made once per warm instance. firebase-admin and web-push are loaded only here, so the tests never need them.
```

Find:

```js
const KEY_ENV = {
```

Replace with:

```js
const PUSH_TTL_S = 60 * 60; // a notification the phone cannot get within an hour is dropped: it is old news by then
const PUSH_TIMEOUT_MS = 5_000; // the computer's report waits for its notifications: not for long

const KEY_ENV = {
```

Find:

```js
let deps = null;
```

Replace with:

```js
/**
 * Web Push with the server's VAPID keys: { publicKey, send(subscription, payload) }, or null when the three are not all
 * set. `load` gives the web-push module (a fake in the tests).
 */
function pushFrom(env, load = () => require('web-push')) {
  const [publicKey, privateKey, subject] = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT']
    .map((name) => (typeof env[name] === 'string' ? env[name].trim() : ''));
  if (!publicKey || !privateKey || !subject) return null;
  const webpush = load();
  const vapidDetails = { subject, publicKey, privateKey };
  return {
    publicKey,
    send: (subscription, payload) => webpush.sendNotification(subscription, payload, {
      vapidDetails, TTL: PUSH_TTL_S, urgency: 'high', timeout: PUSH_TIMEOUT_MS,
    }),
  };
}

let deps = null;
```

Find:

```js
    adminEmail: env.ADMIN_EMAIL || '',
    now: () => new Date(),
```

Replace with:

```js
    adminEmail: env.ADMIN_EMAIL || '',
    push: pushFrom(env),
    now: () => new Date(),
```

Find:

```js
module.exports = { realDeps, adminKeysFrom, credentialFrom, whoFrom };
```

Replace with:

```js
module.exports = { realDeps, adminKeysFrom, credentialFrom, whoFrom, pushFrom };
```

- [ ] **Step 8: The push record in Firestore, and in the fake**

In `web/lib/firestore-db.js`:

Find:

```js
 *   remote/{uid}    Claude mode on the phone: the sessions the person's computer shares (web/lib/remote.js)
 */
```

Replace with:

```js
 *   remote/{uid}    Claude mode on the phone: the sessions the person's computer shares (web/lib/remote.js)
 *   push/{uid}      the person's phones that get notifications: their Web Push subscriptions (web/lib/push.js)
 */
```

Find:

```js
  const remotes = firestore.collection('remote');
```

Replace with:

```js
  const remotes = firestore.collection('remote');
  const pushes = firestore.collection('push');
```

Find:

```js
  function fromData(uid, d) {
```

Replace with:

```js
  /**
   * A record changed in a transaction: `change(doc)` is given the record (null when there is none) and answers
   * { next, result }; `next` is written (null deletes it, undefined leaves it). Answers `result`.
   */
  function update(ref, change) {
    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const { next, result } = change(snap.exists ? snap.data() : null);
      if (next === null) tx.delete(ref);
      else if (next !== undefined) tx.set(ref, next);
      return result;
    });
  }

  function fromData(uid, d) {
```

Find:

```js
    /**
     * Claude mode's record of a person (remote/{uid}), changed in a transaction: `change(doc)` is given the record
     * (null when there is none) and answers { next, result }; `next` is written (null deletes it, undefined leaves it).
     * Answers `result`.
     */
    async updateRemote(uid, change) {
      const ref = remotes.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const { next, result } = change(snap.exists ? snap.data() : null);
        if (next === null) tx.delete(ref);
        else if (next !== undefined) tx.set(ref, next);
        return result;
      });
    },
```

Replace with:

```js
    /** Claude mode's record of a person (remote/{uid}), changed in a transaction (update). */
    async updateRemote(uid, change) {
      return update(remotes.doc(uid), change);
    },

    /** The person's notifications record (push/{uid}), or null. */
    async getPush(uid) {
      const snap = await pushes.doc(uid).get();
      return snap.exists ? snap.data() : null;
    },

    /** The person's notifications record, changed in a transaction (update). */
    async updatePush(uid, change) {
      return update(pushes.doc(uid), change);
    },
```

In `test/helpers/fake-db.js`:

Find:

```js
function fakeDb({ config = null, users = {}, remotes = {} } = {}) {
  const state = { config: structuredClone(config), users: structuredClone(users), remotes: structuredClone(remotes), calls: [] };
```

Replace with:

```js
function fakeDb({ config = null, users = {}, remotes = {}, pushes = {} } = {}) {
  const state = {
    config: structuredClone(config), users: structuredClone(users), remotes: structuredClone(remotes), pushes: structuredClone(pushes), calls: [],
  };
```

Find:

```js
    async setBlocked(uid, blocked) {
```

Replace with:

```js
    async getPush(uid) {
      state.calls.push('getPush');
      return Object.hasOwn(state.pushes, uid) ? structuredClone(state.pushes[uid]) : null;
    },
    async updatePush(uid, change) {
      state.calls.push('updatePush');
      const { next, result } = change(Object.hasOwn(state.pushes, uid) ? structuredClone(state.pushes[uid]) : null);
      if (next === null) delete state.pushes[uid];
      else if (next !== undefined) state.pushes[uid] = structuredClone(next);
      return structuredClone(result);
    },
    async setBlocked(uid, blocked) {
```

Add the emulator test to `test/firestore/firestore-db.test.js` (after the last test):

Find:

```js
  assert.deepStrictEqual(await db.updateRemote('u1', (doc) => ({ next: undefined, result: doc })), null, 'deleted');
});
```

Replace with:

```js
  assert.deepStrictEqual(await db.updateRemote('u1', (doc) => ({ next: undefined, result: doc })), null, 'deleted');
});

test("the notifications record: written, read back the same, and deleted with its last phone", async () => {
  const pushRules = require('../../web/lib/push');
  const SUB = {
    endpoint: 'https://web.push.apple.com/QGuQyavXutnMHabc',
    keys: { p256dh: 'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', auth: 'tBHItJI5svbpez7KI4CCXg' },
  };
  assert.strictEqual(await db.getPush('u1'), null);
  assert.deepStrictEqual(await db.updatePush('u1', (doc) => pushRules.addSub(doc, SUB, 1000)), { on: true });
  assert.deepStrictEqual(await db.getPush('u1'), { subs: [{ ...SUB, at: 1000 }] });
  assert.deepStrictEqual(await db.updatePush('u1', (doc) => pushRules.removeEndpoints(doc, ['https://web.push.apple.com/other'])), { on: false });
  assert.deepStrictEqual(await db.getPush('u1'), { subs: [{ ...SUB, at: 1000 }] }, 'left alone');
  await db.updatePush('u1', (doc) => pushRules.removeEndpoints(doc, [SUB.endpoint]));
  assert.strictEqual(await db.getPush('u1'), null, 'deleted');
});
```

Make the runtime check load web-push too, and the route check know every route. In `test/server-runtime.test.js`:

Find:

```js
require('firebase-admin/firestore'); require('./lib/deps');
```

Replace with:

```js
require('firebase-admin/firestore'); require('web-push'); require('./lib/deps');
```

In `test/server-vercel.test.js`:

Find:

```js
  for (const file of ['config', 'ask', 'admin/settings', 'admin/models', 'admin/users']) {
```

Replace with:

```js
  for (const file of ['config', 'ask', 'transcribe', 'remote/mac', 'remote/phone', 'push', 'admin/settings', 'admin/models', 'admin/users']) {
```

- [ ] **Step 9: Run the tests**

Run: `node --test test/server-push.test.js test/server-remote.test.js test/server-handlers.test.js test/server-vercel.test.js test/server-runtime.test.js test/cloud.test.js`
Expected: all pass (`# fail 0`, `# skipped 0`).

Run: `npm run test:firestore 2>&1 | grep -E "^# (pass|fail)"`
Expected: `# pass 12`, `# fail 0` (needs the Firebase CLI and Java 21; if it cannot start the emulator here, say so in the task report and go on).

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"`
Expected: `# fail 0`, `# skipped 0`.

- [ ] **Step 10: Commit**

```bash
git add web/lib/push.js web/api/push.js web/lib/remote.js web/lib/handlers.js web/lib/deps.js web/lib/firestore-db.js test/helpers/fake-db.js src/main/cloud.js test/server-push.test.js test/server-runtime.test.js test/server-vercel.test.js test/firestore/firestore-db.test.js web/package.json web/package-lock.json
git commit -m "feat(server): notifications on the phone when a Claude Code session finishes or needs you"
```

---

### Task 9: Notifications on the phone

**Files:**
- Create: `web/public/app/push.js`
- Modify: `web/public/app/sw.js` (add the notifications part at the end)
- Test: `test/web-app-push.test.mjs`

**Interfaces:**
- Consumes: `TIMEOUTS` (Task 2); `POST /api/push` and `pushKey` (Task 8); the push payload `{ title, body, session, tag }` (Task 8).
- Produces: `push.js`: `NOT_INSTALLED`, `NOT_SUPPORTED`, `DENIED`, `NOT_SET_UP`, `FAILED`, `pushSupport({ standalone, apple, hasServiceWorker, hasPushManager, hasNotification }) -> 'ok'|'not-installed'|'not-supported'`, `supportHere(win?)`, `keyBytes(base64url) -> Uint8Array`, `createPush({ api, pushKey() -> string|null, ready?, permission?, requestPermission? }) -> { isOn() -> Promise<boolean>, on() -> Promise<{ ok, error? }>, off() -> Promise<{ ok, error? }> }`.
- Produces: `sw.js` posts `{ type: 'open', url: '/app#claude/<session>' }` to an open app window when a notification is tapped (app.js listens in Task 10).

- [ ] **Step 1: Write the failing test**

Create `test/web-app-push.test.mjs`:

```js
// Buddy on iPhone: notifications, the phone's side (web/public/app/push.js).

import test from 'node:test';
import assert from 'node:assert';
import { createPush, pushSupport, keyBytes, NOT_INSTALLED, NOT_SET_UP, DENIED, FAILED } from '../web/public/app/push.js';
import { ApiError } from '../web/public/app/api.js';

const KEY = 'BOrM2YbXqOM7l2B3eHnO1Xe0p7sYk9yYAH6yI1wqKp2c5c7mQb7Hk9pRZJ2l0u1c1oG3vYq9WmGxQpPj8nRrS0E';
const SUB = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: 'BPkey', auth: 'authkey' } };

/** A phone with a service worker and Notification, which answers `answer` when asked; `failPost` makes the server fail. */
function setup({ key = KEY, answer = 'granted', failPost = null, subscribed = false } = {}) {
  const seen = { posts: [], subscribes: [], unsubscribes: 0, asked: 0 };
  let current = subscribed ? fakeSub() : null;
  function fakeSub() {
    return {
      endpoint: SUB.endpoint,
      toJSON: () => SUB,
      unsubscribe: async () => {
        seen.unsubscribes += 1;
        current = null;
        return true;
      },
    };
  }
  let permission = subscribed ? 'granted' : 'default';
  const push = createPush({
    api: {
      post: async (path, body, options) => {
        seen.posts.push({ path, body, options });
        if (failPost) throw failPost;
        return { on: body.action === 'on' };
      },
    },
    pushKey: () => key,
    ready: async () => ({
      pushManager: {
        getSubscription: async () => current,
        subscribe: async (options) => {
          seen.subscribes.push(options);
          current = fakeSub();
          return current;
        },
      },
    }),
    permission: () => permission,
    requestPermission: async () => {
      seen.asked += 1;
      permission = answer;
      return answer;
    },
  });
  return { push, seen };
}

test('switching on asks, subscribes with the server key, and gives the subscription to the server', async () => {
  const { push, seen } = setup();
  assert.strictEqual(await push.isOn(), false);
  assert.deepStrictEqual(await push.on(), { ok: true });
  assert.strictEqual(seen.asked, 1);
  assert.strictEqual(seen.subscribes.length, 1);
  assert.strictEqual(seen.subscribes[0].userVisibleOnly, true);
  assert.deepStrictEqual(seen.subscribes[0].applicationServerKey, keyBytes(KEY));
  assert.deepStrictEqual(seen.posts, [{ path: '/api/push', body: { action: 'on', subscription: SUB }, options: { timeoutMs: 10_000 } }]);
  assert.strictEqual(await push.isOn(), true);
});

test('not allowed, or no key on the server: nothing is subscribed', async () => {
  const no = setup({ answer: 'denied' });
  assert.deepStrictEqual(await no.push.on(), { ok: false, error: DENIED });
  assert.strictEqual(no.seen.subscribes.length, 0);
  const off = setup({ key: null });
  assert.deepStrictEqual(await off.push.on(), { ok: false, error: NOT_SET_UP });
  assert.strictEqual(off.seen.asked, 0, 'not even asked');
});

test('the server failing undoes the subscription, and says why', async () => {
  const { push, seen } = setup({ failPost: new ApiError('network', 'No internet.') });
  assert.deepStrictEqual(await push.on(), { ok: false, error: 'No internet.' });
  assert.strictEqual(seen.unsubscribes, 1);
  assert.strictEqual(await push.isOn(), false);
});

test('switching off tells the server first, then unsubscribes; an old subscription is replaced when switching on', async () => {
  const { push, seen } = setup({ subscribed: true });
  assert.deepStrictEqual(await push.off(), { ok: true });
  assert.deepStrictEqual(seen.posts[0].body, { action: 'off', endpoint: SUB.endpoint });
  assert.strictEqual(seen.unsubscribes, 1);
  assert.deepStrictEqual(await push.off(), { ok: true }, 'already off');
  assert.strictEqual(seen.posts.length, 1);

  const again = setup({ subscribed: true });
  await again.push.on();
  assert.strictEqual(again.seen.unsubscribes, 1, 'the old one went first');
  assert.strictEqual(again.seen.subscribes.length, 1);
});

test('only the Home Screen app on an iPhone gets notifications', () => {
  const all = { hasServiceWorker: true, hasPushManager: true, hasNotification: true };
  assert.strictEqual(pushSupport({ ...all, standalone: true, apple: true }), 'ok');
  assert.strictEqual(pushSupport({ standalone: false, apple: true, hasServiceWorker: true }), 'not-installed');
  assert.strictEqual(pushSupport({ standalone: true, apple: true, hasServiceWorker: true }), 'not-supported', 'iOS before 16.4');
  assert.strictEqual(pushSupport({ standalone: false, apple: false }), 'not-supported');
  assert.ok(NOT_INSTALLED.includes('Add to Home Screen'));
  assert.ok(FAILED);
});

test('the key is read from base64url', () => {
  assert.deepStrictEqual([...keyBytes('AQID_-8')], [1, 2, 3, 255, 239]);
  assert.strictEqual(keyBytes(KEY).length, 65);
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/web-app-push.test.mjs`
Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `web/public/app/push.js`.

- [ ] **Step 3: Write push.js, and the service worker's notifications**

Create `web/public/app/push.js`:

```js
// Notifications on the phone: "Claude Code finished" and "Claude Code needs you", even while Buddy is closed. iOS
// (16.4 and later) gives Web Push only to a web app opened from the Home Screen, and only once the person allows it
// from a tap. The browser makes a subscription (an address at Apple's push service) with the server's public key
// (pushKey, from GET /api/config); Buddy's server keeps it (POST /api/push) and posts there when a session on the
// person's computer stops working (web/lib/handlers.js). sw.js shows the notification.

import { TIMEOUTS } from './api.js';

export const NOT_INSTALLED = 'Add Buddy to your Home Screen first: tap Share, then Add to Home Screen, and open Buddy from there.';
export const NOT_SUPPORTED = 'Notifications need iOS 16.4 or later.';
export const DENIED = 'Notifications are off for Buddy. Turn them on in the Settings app → Notifications → Buddy.';
export const NOT_SET_UP = "Notifications aren't set up yet.";
export const FAILED = "Notifications couldn't be switched on. Try again.";

/**
 * Whether this browser can have notifications: 'ok'; 'not-installed' (an iPhone's Safari, not the Home Screen app,
 * which is the only one iOS gives them to); or 'not-supported'.
 */
export function pushSupport({ standalone, apple, hasServiceWorker, hasPushManager, hasNotification }) {
  if (hasServiceWorker && hasPushManager && hasNotification) return 'ok';
  return apple && !standalone ? 'not-installed' : 'not-supported';
}

/** pushSupport's facts about this page's browser. */
export function supportHere(win = globalThis) {
  return pushSupport({
    standalone: win.navigator?.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true,
    apple: /iPhone|iPad|iPod/.test(win.navigator?.userAgent || ''),
    hasServiceWorker: Boolean(win.navigator?.serviceWorker),
    hasPushManager: 'PushManager' in win,
    hasNotification: 'Notification' in win,
  });
}

/** The server's public key (base64url, as web-push makes it) as the bytes the browser wants. */
export function keyBytes(key) {
  const base64 = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * api is api.js's; pushKey() the server's public key (null when notifications are not set up on the server); ready()
 * answers the service worker's registration; permission() and requestPermission() are the Notification API's.
 */
export function createPush({
  api,
  pushKey,
  ready = () => navigator.serviceWorker.ready,
  permission = () => Notification.permission,
  requestPermission = () => Notification.requestPermission(),
}) {
  const subscription = async () => (await ready()).pushManager.getSubscription();

  return {
    /** Whether this phone gets notifications now. */
    async isOn() {
      return permission() === 'granted' && Boolean(await subscription());
    },

    /** Switch on, from a tap. Answers { ok: true }, or { ok: false, error }. */
    async on() {
      const key = pushKey();
      if (!key) return { ok: false, error: NOT_SET_UP };
      if ((await requestPermission()) !== 'granted') return { ok: false, error: DENIED };
      const registration = await ready();
      let sub;
      try {
        // A subscription made with another key (the server's keys were changed) cannot be used: a new one is made.
        const old = await registration.pushManager.getSubscription();
        if (old) await old.unsubscribe();
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      } catch {
        return { ok: false, error: FAILED };
      }
      try {
        await api.post('/api/push', { action: 'on', subscription: sub.toJSON() }, { timeoutMs: TIMEOUTS.push });
      } catch (err) {
        await sub.unsubscribe().catch(() => {});
        return { ok: false, error: err?.message || FAILED };
      }
      return { ok: true };
    },

    /** Switch off: the server forgets this phone, then the browser does. */
    async off() {
      const sub = await subscription().catch(() => null);
      if (!sub) return { ok: true };
      try {
        await api.post('/api/push', { action: 'off', endpoint: sub.endpoint }, { timeoutMs: TIMEOUTS.push });
      } catch (err) {
        return { ok: false, error: err?.message || FAILED };
      }
      await sub.unsubscribe().catch(() => {});
      return { ok: true };
    },
  };
}
```

Add to the end of `web/public/app/sw.js`:

```js
// ---- notifications ----
// Buddy's server sends { title, body, session, tag } (web/lib/push.js message). Each one is shown; tapping it opens the
// app on that session (/app#claude/<session>), in the app's window if it is open.

self.addEventListener('push', (event) => {
  let data;
  try {
    data = (event.data ? event.data.json() : null) ?? {};
  } catch {
    data = {}; // not JSON: a notification with Buddy's name only
  }
  const title = typeof data.title === 'string' && data.title ? data.title : 'Buddy';
  const session = typeof data.session === 'string' && /^[\w-]{1,100}$/.test(data.session) ? data.session : '';
  event.waitUntil(self.registration.showNotification(title, {
    body: typeof data.body === 'string' ? data.body : '',
    tag: typeof data.tag === 'string' ? data.tag : 'buddy',
    icon: '/icon-192.png',
    data: { url: session ? `/app#claude/${session}` : '/app' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/app';
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const open = windows.find((client) => new URL(client.url).pathname.startsWith('/app'));
    if (!open) return self.clients.openWindow(url);
    open.postMessage({ type: 'open', url });
    return open.focus();
  })());
});
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/web-app-push.test.mjs test/web-app-files.test.mjs`
Expected: all pass.

Run: `npm test 2>&1 | grep -E "^# (fail)"`
Expected: `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add web/public/app/push.js web/public/app/sw.js test/web-app-push.test.mjs
git commit -m "feat(iphone): switch notifications on and off, and show them from the service worker"
```

---
### Task 10: The app's screens, wired together

**Files:**
- Create: `web/public/app/dom.js`, `web/public/app/chat.js`, `web/public/app/claude.js`, `web/public/app/settings.js`
- Modify: `web/public/app/app.js` (replace the whole file)

**Interfaces:**
- Consumes: everything above: `createStore`/`localStorageOf`, `createMemory`, `createApi`/`TIMEOUTS` (Task 2); `createChat`/`canSend` (Task 3); `createClaude`/`readLook`/`byDevice`/`STATUS`/`OFFLINE`/`NONE`/`NO_TALK` (Task 4); `startAuth`/`signInMessage`/`SIGN_IN_OFFLINE` (Task 5); `createHead`, `createMotionShake`/`motionNeedsAsking` (Task 6); `createVoice` (Task 7); `createPush`/`supportHere`/`NOT_INSTALLED`/`NOT_SUPPORTED` (Task 9); `createSleep` (`./shared/sleep.js`); the element ids from Task 1.
- Produces: `dom.js`: `$(id)`, `make(tag, className?, text?)`, `button(className, text, onClick)`, `grow(textarea)`.
- Produces: `chat.js`: `startChatView({ chat, buddyName(), say(text), onCelebrate(), onMic(), share?, copy? }) -> { draw(), showError(message), setVoice(on), voiceState(state), addWords(text) }`.
- Produces: `claude.js`: `startClaudeView({ api, onMic(), onFull(on) }) -> { show(openId?), hidden(), away(), leave(), setVoice(on), voiceState(state), addWords(text), showError(message) }`.
- Produces: `settings.js`: `startSettings({ store, memory, buddies(), onBuddy(id), account(), onSignOut(), push, support() }) -> { draw() }`.

There is no unit test for these DOM files (the logic they draw is tested in Tasks 2–9); they are linted by `npm test` and checked in a browser in Step 7 and Task 12.

- [ ] **Step 1: The small DOM helpers**

Create `web/public/app/dom.js`:

```js
// Two small helpers for the parts of the app that draw (chat.js, claude.js, settings.js).

/** The element with this id. */
export const $ = (id) => document.getElementById(id);

/** A new element, with a class and text if given. */
export function make(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** A button that does `onClick`. */
export function button(className, text, onClick) {
  const b = make('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A box that grows with its text, up to its CSS max-height. */
export function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
```

- [ ] **Step 2: The Chat tab**

Create `web/public/app/chat.js`:

```js
// The Chat tab: the messages and Buddy's answers, the box with 🎤 and send, and each answer's Copy and Share (the phone
// cannot put text into other apps, so the person pastes it there themselves). What happens is chat-core.js's; this
// file draws it and passes on the taps.

import { canSend } from './chat-core.js';
import { $, make, button, grow } from './dom.js';

const LABELS = { copy: 'Copy', share: 'Share', undo: 'Undo', retry: 'Try again' };
const COPY_FAILED = "I couldn't copy it. Press and hold the text to copy it instead.";
const SHARE_FAILED = "I couldn't open Share. Use Copy instead.";
const PLACEHOLDERS = { idle: 'Ask Buddy…', listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };

/**
 * chat is chat-core.js's. buddyName() for "… is thinking"; say(text) shows a short line under the head; onCelebrate()
 * when an answer was copied or shared (the phone's "put it in the app"); onMic() when 🎤 is tapped. Answers
 * { draw, showError, setVoice, voiceState, addWords }.
 */
export function startChatView({
  chat, buddyName, say, onCelebrate, onMic,
  share = navigator.share ? (data) => navigator.share(data) : null,
  copy = (text) => navigator.clipboard.writeText(text),
}) {
  const list = $('chat-items');
  const input = $('chat-input');
  const send = $('chat-send');
  const mic = $('chat-mic');
  const errorLine = $('chat-error');

  function showError(message) {
    errorLine.textContent = message;
    errorLine.hidden = !message;
  }

  function updateSend() {
    send.disabled = !canSend({ busy: chat.state.busy, text: input.value });
  }

  async function press(item, name) {
    showError('');
    if (name === 'copy') {
      try {
        await copy(item.text);
        say('Copied');
        onCelebrate();
      } catch {
        showError(COPY_FAILED);
      }
    } else if (name === 'share') {
      try {
        await share({ text: item.text });
        onCelebrate();
      } catch (err) {
        if (err?.name !== 'AbortError') showError(SHARE_FAILED); // AbortError: the person closed the share sheet
      }
    } else if (name === 'undo') {
      chat.forget(item.id);
    } else if (name === 'retry') {
      chat.retry(item.id);
    }
  }

  function drawItem(item) {
    const li = make('li', `item ${item.type}`);
    if (item.say) li.append(make('p', 'say', item.say));
    if (item.text) li.append(make('p', item.type === 'buddy' ? 'text' : '', item.text));
    if (item.notes.length) {
      const notes = make('ul', 'notes');
      notes.append(...item.notes.map((note) => make('li', '', note)));
      li.append(notes);
    }
    const names = item.buttons.filter((name) => name !== 'share' || share);
    if (names.length) {
      const row = make('div', 'buttons');
      row.append(...names.map((name) => button('chip', LABELS[name], () => press(item, name))));
      li.append(row);
    }
    return li;
  }

  function draw() {
    const { items, busy } = chat.state;
    const rows = items.map(drawItem);
    if (busy) rows.push(make('li', 'item thinking', `${buddyName()} is thinking…`));
    list.replaceChildren(...rows);
    $('chat-empty').hidden = items.length > 0;
    updateSend();
    list.scrollTop = list.scrollHeight;
  }

  async function sendTyped() {
    const text = input.value;
    if (!canSend({ busy: chat.state.busy, text })) return;
    showError('');
    input.value = '';
    grow(input);
    const r = await chat.send(text);
    if (!r.ok && r.error) {
      if (!input.value) input.value = text; // refused before it went: the words come back to make shorter
      grow(input);
      showError(r.error);
    }
    updateSend();
  }

  $('chat-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendTyped();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendTyped();
    }
  });
  input.addEventListener('input', () => {
    grow(input);
    updateSend();
  });
  mic.addEventListener('click', () => onMic());

  return {
    draw,
    showError,

    /** Voice is on for this person (the server has a Groq key): 🎤 shows. */
    setVoice(on) {
      mic.hidden = !on;
    },

    /** What the voice is doing: 'idle', 'listening' or 'writing'. */
    voiceState(state) {
      mic.setAttribute('aria-pressed', String(state === 'listening'));
      mic.disabled = state === 'writing';
      input.placeholder = PLACEHOLDERS[state] || PLACEHOLDERS.idle;
    },

    /** Words that were said: into the box after what is there, to send when the person wants. */
    addWords(text) {
      const typed = input.value.trimEnd();
      input.value = typed ? `${typed} ${text}` : text;
      grow(input);
      updateSend();
      input.focus();
    },
  };
}
```

- [ ] **Step 3: The Claude tab**

Create `web/public/app/claude.js`:

```js
// The Claude tab: Claude Code on the person's computers, as on the Android phone. The sessions they share, by
// computer; one picked shows live, with a box that types into its terminal, and ⤢ shows it full screen. What happens
// is claude-core.js's (it looks every 2 s, only while the tab is open and the app is in view); this file draws it.

import { createClaude, readLook, byDevice, STATUS, OFFLINE, NONE, NO_TALK } from './claude-core.js';
import { TIMEOUTS } from './api.js';
import { $, make, button, grow } from './dom.js';

const PLACEHOLDERS = { listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };

/**
 * api is api.js's; onMic() when 🎤 is tapped; onFull(on) when full screen goes on or off. Answers { show, hidden, away,
 * leave, setVoice, voiceState, addWords, showError }.
 */
export function startClaudeView({ api, onMic, onFull }) {
  const remote = (body) => api.post('/api/remote/phone', body, { timeoutMs: TIMEOUTS.remote });
  const core = createClaude({
    look: async (session) => readLook(await api.get(`/api/remote/phone${session ? `?session=${encodeURIComponent(session)}` : ''}`, { timeoutMs: TIMEOUTS.remote })),
    send: (session, text) => remote({ action: 'send', session, text }),
    stop: () => remote({ action: 'stop' }),
    onChange: () => draw(),
  });
  const input = $('claude-input');
  const list = $('claude-items');
  let full = false;
  let shownId = null; // the session drawn last, and its newest item: the list scrolls down for new items only
  let newest = 0;
  let voice = 'idle';

  function setLine(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }

  function setFull(on) {
    full = on;
    $('claude-full').textContent = on ? '⤡' : '⤢';
    $('claude-full').setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
    onFull(on);
  }

  function drawList(s) {
    $('claude-groups').replaceChildren(...byDevice(s.sessions).map(({ device, sessions }) => {
      const group = make('section', 'group');
      const rows = make('ul', 'sessions');
      rows.append(...sessions.map((session) => {
        const li = make('li');
        const pick = button('', '', () => core.open(session.id));
        pick.append(make('span', 'name', session.name), make('span', `status-chip ${session.status}`, STATUS[session.status] || session.status));
        li.append(pick);
        return li;
      }));
      group.append(make('h3', '', device || 'Your computer'), rows);
      return group;
    }));
    let note = s.listError;
    if (!note && s.looking) note = 'Looking…';
    else if (!note && s.online === false) note = OFFLINE;
    else if (!note && s.online && !s.sessions.length) note = NONE;
    setLine('claude-note', note);
  }

  function drawSession(s) {
    const { session } = s;
    $('claude-name').textContent = session.device ? `${session.name} · on ${session.device}` : session.name;
    $('claude-status').className = `status-chip ${session.status}`;
    $('claude-status').textContent = STATUS[session.status] || session.status;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const items = s.items || [];
    const rows = items.map((item) => {
      const li = make('li', `cl-${item.kind}${item.error ? ' error' : ''}`);
      li.append(make('p', '', item.text));
      return li;
    });
    if (s.items === null) rows.push(make('li', 'cl-note', `Waiting for ${session.device || 'your computer'}…`));
    if (!session.canTalk) rows.push(make('li', 'cl-note', NO_TALK));
    list.replaceChildren(...rows);
    const last = items.length ? items[items.length - 1].id : 0;
    if (shownId !== session.id || (atBottom && last !== newest)) list.scrollTop = list.scrollHeight;
    shownId = session.id;
    newest = last;
    setLine('claude-problem', s.problem);
    setLine('claude-error', s.boxError);
    if (voice === 'idle') input.placeholder = `Message Claude in ${session.name}…`;
  }

  function updateSend() {
    const s = core.state;
    $('claude-send').disabled = !(s.session && !s.sending && input.value.trim());
  }

  function draw() {
    const s = core.state;
    $('claude-pick').hidden = Boolean(s.session);
    $('claude-session').hidden = !s.session;
    if (s.session) {
      drawSession(s);
    } else {
      shownId = null;
      if (full) setFull(false);
      drawList(s);
    }
    updateSend();
  }

  async function sendTyped() {
    const text = input.value;
    if (!text.trim()) return;
    input.value = '';
    grow(input);
    updateSend();
    const r = await core.send(text);
    if (!r.ok && r.error && !input.value) {
      input.value = text; // not sent: the words come back
      grow(input);
    }
    updateSend();
  }

  $('claude-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendTyped();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendTyped();
    }
  });
  input.addEventListener('input', () => {
    grow(input);
    updateSend();
  });
  $('claude-full').addEventListener('click', () => setFull(!full));
  $('claude-back').addEventListener('click', () => core.list());
  $('claude-again').addEventListener('click', () => core.list());
  $('claude-mic').addEventListener('click', () => onMic());

  return {
    /** The tab opened (with `openId`, a notification's session): in Claude mode, or in view again. */
    show(openId = null) {
      if (openId || !core.state.on) core.enter(openId);
      else core.shown();
    },
    /** The app went out of view: the looks stop. */
    hidden: () => core.hidden(),
    /** Another tab: the looks stop, and full screen ends. */
    away() {
      core.hidden();
      if (full) setFull(false);
    },
    /** Signed out: Claude mode ends. */
    leave() {
      if (full) setFull(false);
      core.leave();
    },
    setVoice(on) {
      $('claude-mic').hidden = !on;
    },
    voiceState(state) {
      voice = state;
      $('claude-mic').setAttribute('aria-pressed', String(state === 'listening'));
      $('claude-mic').disabled = state === 'writing';
      input.placeholder = PLACEHOLDERS[state] || (core.state.session ? `Message Claude in ${core.state.session.name}…` : '');
    },
    addWords(text) {
      const typed = input.value.trimEnd();
      input.value = typed ? `${typed} ${text}` : text;
      grow(input);
      updateSend();
    },
    showError: (message) => setLine('claude-error', message),
  };
}
```

- [ ] **Step 4: Settings**

Create `web/public/app/settings.js`:

```js
// The Settings tab: which buddy, what Buddy remembers about the person (memory.js) and whether it learns from chats,
// notifications for Claude Code (push.js), and the account. Each part draws itself again when it changes; draw() draws it all when the tab opens.

import { $, make, button } from './dom.js';
import { NOT_INSTALLED, NOT_SUPPORTED } from './push.js';

const NOT_KEPT = "I didn't keep that. It may be known already, too long, or something secret like a password.";

/**
 * store is store.js's; memory is memory.js's; buddies() the list in buddies.json; onBuddy(id) when another buddy is
 * picked; account() the person signed in; onSignOut() for Sign out; push is push.js's, and support() says whether this
 * browser can have notifications (push.js supportHere). Answers { draw }.
 */
export function startSettings({ store, memory, buddies, onBuddy, account, onSignOut, push, support }) {
  function drawBuddies() {
    const all = buddies();
    const picked = all.find((b) => b.id === store.read('buddy', null)) || all[0];
    $('buddy-choice').replaceChildren(...all.map((b) => {
      const choice = button('', '', () => {
        onBuddy(b.id);
        drawBuddies();
      });
      choice.setAttribute('aria-pressed', String(b === picked));
      const img = make('img');
      img.src = `/app/buddies/${b.preview}`;
      img.alt = '';
      img.width = 88;
      img.height = 88;
      choice.append(img, make('span', '', b.defaultName));
      return choice;
    }));
  }

  function drawMemory() {
    const facts = memory.list();
    $('learn').checked = memory.learning();
    $('facts').replaceChildren(...facts.map((fact) => {
      const li = make('li');
      const forget = button('chip', 'Forget', () => {
        memory.remove(fact.id);
        drawMemory();
      });
      forget.setAttribute('aria-label', `Forget: ${fact.text}`);
      li.append(make('span', '', fact.text), forget);
      return li;
    }));
    $('facts-empty').hidden = facts.length > 0;
    $('forget-all').hidden = facts.length === 0;
  }

  function showFactError(message) {
    $('fact-error').textContent = message;
    $('fact-error').hidden = !message;
  }

  function showPushNote(message) {
    $('push-note').textContent = message;
    $('push-note').hidden = !message;
  }

  async function drawPush() {
    const toggle = $('push-switch');
    const can = support();
    toggle.disabled = can !== 'ok';
    if (can !== 'ok') {
      toggle.checked = false;
      showPushNote(can === 'not-installed' ? NOT_INSTALLED : NOT_SUPPORTED);
      return;
    }
    showPushNote('');
    toggle.checked = await push.isOn().catch(() => false);
  }

  $('push-switch').addEventListener('change', async (e) => {
    const toggle = e.target;
    toggle.disabled = true;
    const r = toggle.checked ? await push.on() : await push.off();
    toggle.disabled = false;
    if (!r.ok) toggle.checked = !toggle.checked;
    showPushNote(r.ok ? '' : r.error);
  });
  $('learn').addEventListener('change', (e) => memory.setLearning(e.target.checked));
  $('fact-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('fact-input').value;
    if (!text.trim()) return;
    if (memory.add(text, { source: 'settings' })) {
      $('fact-input').value = '';
      showFactError('');
      drawMemory();
    } else {
      showFactError(NOT_KEPT);
    }
  });
  $('forget-all').addEventListener('click', () => {
    if (!window.confirm('Forget everything Buddy knows about you?')) return;
    memory.clear();
    drawMemory();
  });
  $('signout').addEventListener('click', () => onSignOut());

  return {
    draw() {
      drawBuddies();
      drawMemory();
      drawPush();
      showFactError('');
      const who = account();
      $('account-email').textContent = who ? `Signed in as ${who.email}` : '';
    },
  };
}
```

- [ ] **Step 5: app.js starts everything**

Replace `web/public/app/app.js` with:

```js
// Buddy on iPhone: starts everything. Signed out, the head and the sign-in button; signed in, three tabs under the
// head: Chat, Claude (Claude Code on the person's computers) and Settings. Each part is its own file; this one hands
// them what they need from each other, and tells the buddy what happens (its feelings, as src/main/feelings.js does on
// the Mac).

import { createStore, localStorageOf } from './store.js';
import { createApi, TIMEOUTS } from './api.js';
import { startAuth, signInMessage, SIGN_IN_OFFLINE } from './auth.js';
import { createMemory } from './memory.js';
import { createChat } from './chat-core.js';
import { startChatView } from './chat.js';
import { startSettings } from './settings.js';
import { createHead } from './head.js';
import { createMotionShake, askForMotion } from './motion.js';
import { createVoice } from './voice.js';
import { startClaudeView } from './claude.js';
import { createPush, supportHere } from './push.js';
import { createSleep } from './shared/sleep.js';
import { $ } from './dom.js';

const app = $('app');
const store = createStore(localStorageOf(window));
const memory = createMemory({ store });
const TABS = ['chat', 'claude', 'settings'];
const BUBBLE_MS = 2500;
const LINK = /^#claude\/([\w-]{1,100})$/; // a notification's session: /app#claude/<session id>

let person = null; // who is signed in: { uid, email, name, firstName }, or null
let config = null; // GET /api/config for them: voiceOn, pushKey, …
let tab = 'chat';
let buddies = []; // buddies.json
let bubbleTimer = null;

/** A short line under the head for a moment ("Copied"). */
function say(text) {
  $('bubble').textContent = text;
  $('bubble').hidden = false;
  clearTimeout(bubbleTimer);
  bubbleTimer = setTimeout(() => {
    $('bubble').hidden = true;
  }, BUBBLE_MS);
}

// ---- sign-in and Buddy's server ----

let auth = null;
let authReady;
const authStarted = new Promise((resolve) => {
  authReady = resolve;
});
const api = createApi({
  getToken: async (force) => {
    const a = await authStarted;
    return a ? a.token(force) : null;
  },
  onSignedOut: () => auth?.signOut(),
});

function showSignInError(message) {
  $('signin-error').textContent = message;
  $('signin-error').hidden = !message;
}

// ---- the head and its feelings ----

let head = null;
try {
  head = createHead({ canvas: $('head'), symbolsRoot: $('symbols'), onTouch: touched });
} catch (err) {
  console.error('[buddy] the head could not start', err); // no WebGL: the app works on without it
  $('head').hidden = true;
}
// Drowsy after a minute left alone and asleep after two, as on the Mac (src/main/sleep.js).
const sleep = createSleep({ onMood: (name) => head?.mood(name) });

/** A mood from the app: a use, which wakes a sleeping buddy first; thinking holds the sleep countdown while it lasts. */
function feel(name) {
  sleep.poke();
  sleep.hold('busy', name === 'thinking');
  head?.mood(name);
}

const shake = createMotionShake();
let motionAnswered = false; // granted or denied: stop asking
let motionListening = false;

/** The head was touched: a use. */
function touched() {
  sleep.poke();
}

/** A tap on the head asks iOS for the phone's motion, for shaking. iOS takes a click for that, not a pointerdown; if it
 * refuses ('later') the next tap asks again. */
document.getElementById('head').addEventListener('click', async () => {
  if (motionAnswered) return;
  const answer = await askForMotion(window.DeviceMotionEvent);
  if (answer === 'later') return;
  motionAnswered = true;
  if (answer === 'granted') listenForShakes();
});

function listenForShakes() {
  if (motionListening) return;
  motionListening = true;
  window.addEventListener('devicemotion', (e) => {
    const a = e.acceleration;
    if (a && shake.feed(a.x, a.y, a.z, e.timeStamp)) feel('dizzy');
  });
}

async function loadBuddy() {
  if (!buddies.length) {
    try {
      buddies = await (await fetch('/app/buddies/buddies.json')).json();
    } catch {
      buddies = [];
    }
  }
  const picked = buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0];
  if (picked && head) await head.load({ url: `/app/buddies/${picked.file}`, accent: picked.accent });
}

const buddyName = () => (buddies.find((b) => b.id === store.read('buddy', null)) || buddies[0])?.defaultName || 'Buddy';

// ---- the chat ----

const chat = createChat({
  ask: (body) => api.post('/api/ask', body, { timeoutMs: TIMEOUTS.ask }),
  memory,
  userName: () => person?.firstName || '',
  onMood: feel,
  onChange: () => chatView.draw(),
});
const chatView = startChatView({ chat, buddyName, say, onCelebrate: () => feel('celebrate'), onMic: toggleVoice });

// ---- voice ----

const voice = createVoice({
  transcribe: async (audio, mime) => (await api.post('/api/transcribe', { audio, mime }, { timeoutMs: TIMEOUTS.transcribe })).text,
  onState: (state) => {
    sleep.hold('voice', state === 'listening');
    head?.micOn(state === 'listening');
    chatView.voiceState(state);
    claudeView.voiceState(state);
  },
  onLevel: (level) => head?.level(level),
  onWords: (text) => (tab === 'claude' ? claudeView : chatView).addWords(text),
  onError: (message) => (tab === 'claude' ? claudeView : chatView).showError(message),
});

function toggleVoice() {
  if (voice.state === 'idle') voice.start();
  else voice.stop();
}

// ---- Claude mode ----

const claudeView = startClaudeView({ api, onMic: toggleVoice, onFull: (on) => app.classList.toggle('full', on) });

// ---- notifications and settings ----

const push = createPush({ api, pushKey: () => config?.pushKey || null });

async function signOut() {
  await push.off(); // this phone stops getting the person's notifications
  await auth?.signOut();
}

const settings = startSettings({
  store,
  memory,
  buddies: () => buddies,
  onBuddy: (id) => {
    store.write('buddy', id);
    loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
  },
  account: () => person,
  onSignOut: signOut,
  push,
  support: () => supportHere(window),
});

// ---- the tabs ----

function showTab(next, { open = null } = {}) {
  if (!TABS.includes(next)) return;
  if (tab === 'claude' && next !== 'claude') claudeView.away();
  if (next !== tab) voice.cancel();
  tab = next;
  for (const b of document.querySelectorAll('#tabs button')) b.setAttribute('aria-pressed', String(b.dataset.tab === next));
  $('chat-pane').hidden = next !== 'chat';
  $('claude-pane').hidden = next !== 'claude';
  $('settings-pane').hidden = next !== 'settings';
  sleep.poke();
  if (next === 'claude') claudeView.show(open);
  if (next === 'settings') settings.draw();
}

for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => showTab(b.dataset.tab));

/** A notification's link (/app#claude/<session>): the Claude tab, on that session. Used once. */
function followLink() {
  const match = LINK.exec(window.location.hash);
  if (!match || !person) return;
  window.history.replaceState(null, '', '/app');
  showTab('claude', { open: match[1] });
}
window.addEventListener('hashchange', followLink);

// ---- signed in and out ----

function showSignedOut() {
  person = null;
  config = null;
  app.dataset.signed = 'out';
  $('signin').hidden = false;
  $('tabs').hidden = true;
  for (const id of ['chat-pane', 'claude-pane', 'settings-pane']) $(id).hidden = true;
  voice.cancel();
  claudeView.leave();
  chat.clear();
}

async function showSignedIn(who) {
  person = who;
  app.dataset.signed = 'in';
  showSignInError('');
  $('signin').hidden = true;
  $('tabs').hidden = false;
  showTab(tab);
  followLink();
  config = await api.get('/api/config', { timeoutMs: TIMEOUTS.config }).catch(() => null);
  if (person !== who) return; // signed out meanwhile
  chatView.setVoice(config?.voiceOn === true);
  claudeView.setVoice(config?.voiceOn === true);
}

$('signin-button').addEventListener('click', () => {
  if (!auth) {
    showSignInError(SIGN_IN_OFFLINE);
    return;
  }
  showSignInError('');
  auth.signIn().catch((err) => showSignInError(signInMessage(err)));
});

startAuth({ onUser: (who) => (who ? showSignedIn(who) : showSignedOut()), onError: showSignInError })
  .then((a) => {
    auth = a;
    authReady(a);
  })
  .catch((err) => {
    console.error('[buddy] sign-in could not start', err);
    authReady(null);
    showSignedOut();
    showSignInError(SIGN_IN_OFFLINE);
  });

// ---- the page ----

document.addEventListener('visibilitychange', () => {
  head?.pause(document.hidden);
  if (document.hidden) {
    voice.cancel();
    claudeView.hidden();
  } else if (tab === 'claude' && person) {
    claudeView.show();
  }
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/app/sw.js', { scope: '/app' }).catch((err) => console.warn('[buddy] no offline copy', err));
  // A tapped notification, while the app was open: sw.js says which session to show.
  navigator.serviceWorker.addEventListener('message', (e) => {
    if (e.data?.type === 'open' && typeof e.data.url === 'string') window.location.hash = new URL(e.data.url, window.location.href).hash;
  });
}

loadBuddy().catch((err) => console.error('[buddy] the buddy did not load', err));
```

- [ ] **Step 6: Run the tests**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail)"`
Expected: `# fail 0` (eslint passes on every app file; `test/web-app-files.test.mjs` finds every import).

- [ ] **Step 7: Look at it signed out**

Run (in the background): `npm run serve:web`. Open `http://localhost:8787/app` in Chrome at 390 × 844 (device toolbar, iPhone): within a few seconds the head is drawn in the top half, under it "Hi! I'm Buddy.", "Sign in with the same Google account as on your computer." and the dark "Sign in with Google" button; no tabs. The console has no errors (the Firebase SDK loads from gstatic; nobody is signed in on localhost). Stop the server.

- [ ] **Step 8: Commit**

```bash
git add web/public/app/dom.js web/public/app/chat.js web/public/app/claude.js web/public/app/settings.js web/public/app/app.js
git commit -m "feat(iphone): the Chat, Claude and Settings tabs, signed in and out"
```

---

### Task 11: The website's iPhone link, the iPhone checklist, and the server's README

**Files:**
- Modify: `web/public/index.html`, `web/public/site.js`, `test/site.test.js`, `web/README.md`
- Create: `docs/manual-checklist-iphone.md`

**Interfaces:**
- Consumes: the app at `/app` (Tasks 1–10).
- Produces: the site's iPhone tile links to `/app` with the Add to Home Screen step; `site.js` leads the hero with "Open Buddy for iPhone" on an iPhone and `deviceNote` says how to keep it.

- [ ] **Step 1: Write the failing site tests**

In `test/site.test.js`, the iPhone tile is no longer "Coming soon":

Find:

```js
  for (const name of ['Mac', 'Windows', 'Android']) {
```

Replace with:

```js
  for (const name of ['Mac', 'Windows', 'Android', 'iPhone']) {
```

and it opens the app, and the iPhone note says how to keep it:

Find:

```js
test('deviceNote speaks only to iPhones', () => {
  assert.match(site.deviceNote('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), /iPhone is coming soon/);
```

Replace with:

```js
test('the iPhone tile opens Buddy for iPhone, with the Add to Home Screen step', () => {
  const tile = read('index.html').split('<h3>').find((part) => part.startsWith('iPhone</h3>')).split('</div>')[0];
  assert.match(tile, /href="\/app"/);
  assert.match(tile, /Add to Home Screen/);
});

test('deviceNote speaks only to iPhones', () => {
  assert.match(site.deviceNote('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)'), /Add to Home Screen/);
```

Run: `node --test test/site.test.js`
Expected: FAIL: `the iPhone tile` matches /Coming soon/, the iPhone tile has no `href="/app"`, and `deviceNote` does not match /Add to Home Screen/.

- [ ] **Step 2: The page**

In `web/public/index.html`:

Find:

```html
Free for Mac, Windows and Android.">
<link rel="canonical"
```

Replace with:

```html
Free for Mac, Windows, Android and iPhone.">
<link rel="canonical"
```

Find:

```html
Buddy writes, fixes and checks your English in any app. Free for Mac, Windows and Android.">
```

Replace with:

```html
Buddy writes, fixes and checks your English in any app. Free for Mac, Windows, Android and iPhone.">
```

Find:

```html
  "operatingSystem": "macOS 14 or later, Windows 10 or 11, Android 8.0 or newer",
```

Replace with:

```html
  "operatingSystem": "macOS 14 or later, Windows 10 or 11, Android 8.0 or newer, iOS 16.4 or later (in Safari)",
```

Find:

```html
<span class="chip"><span class="dot"></span>Free for Mac, Windows and Android</span>
```

Replace with:

```html
<span class="chip"><span class="dot"></span>Free for Mac, Windows, Android and iPhone</span>
```

The iPhone tile:

Find:

```html
          <h3>iPhone</h3><p>As a keyboard</p><span class="tag">Coming soon</span>
```

Replace with:

```html
          <h3>iPhone</h3><p>In Safari · iOS 16.4 or later</p>
          <a class="btn btn--ink" href="/app" data-iphone-open>Open Buddy for iPhone</a>
          <small>Then tap Share → Add to Home Screen</small>
```

The steps under the tiles:

Find:

```html
        <p><b>On Android:</b> open the downloaded file.
```

Replace with:

```html
        <p><b>On iPhone:</b> open <b>buddywrites.vercel.app/app</b> in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>. Open Buddy from its new icon and sign in with Google. Nothing to install from a file.</p>
        <p><b>On Android:</b> open the downloaded file.
```

- [ ] **Step 3: site.js**

In `web/public/site.js`:

Find:

```js
   release, leads with the right button on Windows and Android, and tells iPhone visitors where Buddy runs. */
```

Replace with:

```js
   release, leads with the right button on Windows, Android and iPhone, and tells iPhone visitors how to keep it. */
```

Find:

```js
  /** A line for visitors whose device has no Buddy yet, or ''. */
  function deviceNote(ua) {
    if (/iPhone|iPad|iPod/i.test(ua)) return 'Buddy for iPhone is coming soon. Right now it runs on Mac, Windows and Android.';
    return '';
  }
```

Replace with:

```js
  /** A line for visitors whose device needs a word on how to get Buddy, or ''. */
  function deviceNote(ua) {
    if (/iPhone|iPad|iPod/i.test(ua)) return 'On iPhone, Buddy runs in Safari: open it, then tap Share → Add to Home Screen to keep it.';
    return '';
  }
```

Find:

```js
  var onAndroid = /Android/i.test(ua);
```

Replace with:

```js
  var onAndroid = /Android/i.test(ua);
  var onIphone = /iPhone|iPad|iPod/i.test(ua);
```

Find:

```js
  // releases page) with that platform's other buttons: kind is "win" or "android".
```

Replace with:

```js
  // releases page) with that platform's other buttons: kind is "win", "android" or "iphone".
```

Find:

```js
  note(deviceNote(ua));
```

Replace with:

```js
  if (onIphone) leadWith('iphone', '/app', 'Open Buddy for iPhone', 'In Safari, on iOS 16.4 or later.');
  note(deviceNote(ua));
```

- [ ] **Step 4: Run the site tests**

Run: `node --test test/site.test.js`
Expected: `# pass 18`, `# fail 0`.

- [ ] **Step 5: The checklist and the README**

Create `docs/manual-checklist-iphone.md`:

```markdown
# Manual checklist: iPhone

What only a real iPhone can check. Buddy on iPhone is a web app at https://buddywrites.vercel.app/app, deployed with
the server (`npm run deploy:server`). Use an iPhone on iOS 16.4 or later, Safari, and the same Google account as on
the Mac. The Claude mode and notification items need Buddy open on the Mac with Settings → Claude Code → "Show my
sessions on my other devices" on.

## Once, before the first try (the owner)

These are set up once; the app's code cannot do them.

1. **Google sign-in comes back to Buddy's domain.** Google Cloud console (https://console.cloud.google.com), project
   `buddy-7f8c2` → APIs & Services → Credentials → under "OAuth 2.0 Client IDs", open **"Web client (auto created by
   Google Service)"** → Authorized redirect URIs → **Add URI** → `https://buddywrites.vercel.app/__/auth/handler` →
   Save. (Leave the `https://buddy-7f8c2.firebaseapp.com/__/auth/handler` that is there already.) It can take a few
   minutes to work.
2. **Firebase allows Buddy's domain.** Firebase console (https://console.firebase.google.com) → project `buddy-7f8c2`
   → Authentication → Settings → Authorized domains: `buddywrites.vercel.app` must be in the list. If it is not:
   **Add domain** → `buddywrites.vercel.app` → Add.
3. **Notification keys on the server.** In `web/` (after `npm ci` there): `npx web-push generate-vapid-keys`. It prints
   a Public Key and a Private Key. Then, from the repository root (run `vercel link --cwd web` first if `web/.vercel`
   is not there, and pick the project behind buddywrites.vercel.app):

       vercel env add VAPID_PUBLIC_KEY production --cwd web     # paste the Public Key
       vercel env add VAPID_PRIVATE_KEY production --cwd web    # paste the Private Key (mark it Sensitive if asked)
       vercel env add VAPID_SUBJECT production --cwd web        # mailto:akshatg9636@gmail.com

   Then `npm run deploy:server`: a change to the environment takes effect with the next deploy. Keep the keys: new
   keys mean every phone has to switch notifications off and on again.
4. If sign-in still fails after 1 and 2: Google Cloud console → APIs & Services → Credentials → API keys → the key in
   `web/public/app/config.js` (`apiKey`). If it has "Application restrictions" set to websites, add
   `https://buddywrites.vercel.app/*`.

## Add to Home Screen
- [ ] Open https://buddywrites.vercel.app on the iPhone: the hero button says "Open Buddy for iPhone", and the iPhone
      tile under "Get Buddy" has the Add to Home Screen step.
- [ ] Tap it: Safari opens /app with the head and "Sign in with Google".
- [ ] Share → Add to Home Screen → Add: Buddy's icon is on the Home Screen, named Buddy.
- [ ] Open Buddy from the icon: full screen, no Safari bars; the notch and the home bar do not cover anything.

## Sign in
- [ ] Tap "Sign in with Google": Google's page opens, pick the account, and Buddy comes back signed in on the Chat tab
      (not in Safari, not on a blank page).
- [ ] Close Buddy fully (swipe it away) and open it again: still signed in.
- [ ] Settings → Account shows "Signed in as <your email>". Sign out: back to "Sign in with Google".

## The head and its feelings
- [ ] The head is your buddy (Settings → Your buddy changes it to the other one at once, and it stays after a restart).
- [ ] It floats and blinks; left alone it fidgets now and then (looks around, hums, hops).
- [ ] The first tap on the head asks for "Motion & Orientation" access: Allow. Shake the phone: the buddy is dizzy.
- [ ] Stroke the head left and right with a finger: hearts, the buddy loves it.
- [ ] Leave it alone for 2 minutes: drowsy at one minute, asleep at two, with "z"s. Tap it: it wakes.

## Chat
- [ ] `boss ko mail likho kal chutti chahiye` → send: your message on the right, "Aarav is thinking…", the head thinks,
      then an email with Copy and Share; the head is happy.
- [ ] Copy: "Copied" under the head, the head celebrates, and the mail pastes in Mail or WhatsApp.
- [ ] Share: the iOS share sheet opens with the text; close it and nothing goes wrong.
- [ ] `make it shorter`: a shorter version of the same mail.
- [ ] `fix my English`: "I can't see other apps on iPhone. Paste the text here." (and today's free count does not go up).
- [ ] `I work at Infosys, remember that`: "📝 Remembered: …" with Undo; Settings → Memory lists it; Forget removes it.
- [ ] Settings → Memory: add "My password is 1234": not kept, with the reason.
- [ ] Airplane mode, send: a red line "No internet." with Try again, and the head is sad. Back online, Try again: the answer.
- [ ] With today's free requests used up (Admin window on the Mac: limit 1), a second message shows the server's words.

## Voice
- [ ] 🎤 shows in the box (the server has its Groq key). Tap it: the phone asks for the microphone once: Allow.
- [ ] Say `kal mujhe chutti chahiye`: the head listens, its ear rims glow with your voice; stop talking and the words
      appear in the box by themselves. Tap send.
- [ ] Tap 🎤 and say nothing: after about 8 s, "I didn't hear anything. Tap 🎤 and speak."
- [ ] Say no to the microphone (Settings → Safari → Microphone → Deny, or the prompt): "Allow the microphone in
      Settings → Safari."

## Claude mode
- [ ] Start a Claude Code session in a terminal on the Mac. Claude tab: the session is listed under the Mac's name,
      with its status.
- [ ] Tap it: its lines show and new ones come in within a few seconds. Type `run the tests` and send: it is typed into
      the terminal on the Mac.
- [ ] ⤢: full screen (no head, no tabs); ⤡ back. ‹ goes back to the list.
- [ ] Go to the Chat tab, or close Buddy: the Mac stops sending (its Claude view shows nobody watching within 30 s).
- [ ] Turn sharing off on the Mac: the Claude tab says none of your computers is sharing.

## Notifications
- [ ] Settings → Notifications: turn the switch on; iOS asks: Allow. The switch stays on.
- [ ] In Safari (not the Home Screen app), Settings says "Add Buddy to your Home Screen first…" and the switch is off.
- [ ] Close Buddy. Give Claude Code a job on the Mac and wait for it to finish: "Claude Code finished" arrives on the
      lock screen, titled with the session's name.
- [ ] A session that asks for permission: "Claude Code needs you".
- [ ] Tap a notification: Buddy opens on the Claude tab, on that session.
- [ ] While you watch a session in Buddy, its own finishing sends no notification.
- [ ] Turn the switch off: no more notifications.

## Updates
- [ ] Deploy a small change (`npm run deploy:server`). Close Buddy fully and open it again: the change is there.
- [ ] Airplane mode, open Buddy: it still opens (with the head), and says "No internet." when you send.
```

In `web/README.md`:

Find:

```markdown
`public/` is the download website (https://buddywrites.vercel.app); it is deployed with the functions.
```

Replace with:

```markdown
`public/` is the download website (https://buddywrites.vercel.app); it is deployed with the functions. `public/app/`
is Buddy on iPhone, a web app at https://buddywrites.vercel.app/app that people add to their Home Screen (design:
`docs/superpowers/specs/2026-10-09-buddy-iphone-web-app-design.md`, checks: `docs/manual-checklist-iphone.md`). It uses
the same routes and the same sign-in as the Mac, with Firebase Auth's web SDK; `/__/auth/*` and `/__/firebase/*` are
passed on to Firebase (`vercel.json`) so that sign-in by redirect works in a Home Screen app.
```

Find:

```markdown
| `POST /api/ask` | signed in | one free answer |
```

Replace with:

```markdown
| `POST /api/ask` | signed in | one free answer |
| `POST /api/transcribe` | signed in | what was said in a recording (voice), with the server's Groq key |
| `POST /api/remote/mac` | signed in | a computer shares its Claude Code sessions; a session that finishes is told to the person's phones |
| `GET, POST /api/remote/phone` | signed in | a phone (or another computer) watches a session and sends it words |
| `POST /api/push` | signed in | notifications on the phone: keep or forget its Web Push subscription |
```

Find:

```markdown
`web/shared/` is a copy of the app's `shared/` (prompts, providers, errors). Change `shared/`, then run
`npm run sync:web` at the repository root; `npm test` fails while the copy is stale.
```

Replace with:

```markdown
`web/shared/` is a copy of the app's `shared/` (prompts, providers, errors). Change `shared/`, then run
`npm run sync:web` at the repository root; `npm test` fails while the copy is stale.

`public/app/shared/`, `public/app/buddies/` and `public/app/vendor/` are copies too, for Buddy on iPhone: the parts of
`shared/`, `src/` and `assets/buddies/` it reuses, and three.js. Change those, then run `npm run sync:web-app`; `npm
test` fails while they are stale. `npm run serve:web` serves `public/` on http://localhost:8787 the way Vercel does, to
try the app in a browser (signed out: `/api` is not served there).
```

Find:

```markdown
- any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` — the admin's AI keys
```

Replace with:

```markdown
- any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` — the admin's AI keys
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push for the phone's notifications: the keys from
  `npx web-push generate-vapid-keys` (in `web/`), and `mailto:akshatg9636@gmail.com`. Without all three, notifications
  are off (`/api/push` answers `push_off`).
```

Find:

```markdown
    npm run deploy:server     # from the repository root: sync web/shared, then vercel deploy --prod
```

Replace with:

```markdown
    npm run deploy:server     # from the repository root: sync web/shared and public/app, then vercel deploy --prod
```

Find:

```markdown
- `[api] failed: <kind>` — anything else that went wrong in a route (a Firestore error, say), answered 500.
```

Replace with:

```markdown
- `[api] failed: <kind>` — anything else that went wrong in a route (a Firestore error, say), answered 500.
- `[push] not sent: <status>` — a push service turned a notification down (other than 404 or 410, which forget that
  phone). The computer's report was answered as usual.
- `[push] could not notify: <kind>` — the notifications for a report could not be sent at all (a Firestore error,
  say). The computer's report was answered as usual.
```

- [ ] **Step 6: Run the tests**

Run: `npm test 2>&1 | grep -E "^# (tests|pass|fail|skipped)"`
Expected: `# fail 0`.

- [ ] **Step 7: Commit**

```bash
git add web/public/index.html web/public/site.js test/site.test.js docs/manual-checklist-iphone.md web/README.md
git commit -m "docs: Buddy on iPhone on the website, its checklist, and the server's routes"
```

---

### Task 12: Browser check at iPhone size

**Files:** none changed (fix and commit only if the check finds a problem).

**Interfaces:**
- Consumes: the whole app (Tasks 1–11), `npm run serve:web` (Task 1), `window.__buddyFrames` / `window.__buddyMood` (Task 6).

Use the Chrome DevTools MCP tools (load them with ToolSearch: `select:mcp__chrome-devtools__new_page,mcp__chrome-devtools__emulate,mcp__chrome-devtools__navigate_page,mcp__chrome-devtools__evaluate_script,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__list_console_messages`).

- [ ] **Step 1: Serve the site**

Run in the background: `npm run serve:web`
Expected: `Buddy's site: http://localhost:8787  (Buddy on iPhone: /app)`

- [ ] **Step 2: Open the app as an iPhone**

`new_page` with `http://localhost:8787/app`, then `emulate` with viewport `390x844x3,mobile,touch` and user agent `Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1`, then `navigate_page` with `type: "reload"` and `ignoreCache: true`.

- [ ] **Step 3: The signed-out state renders and the head draws**

`evaluate_script`:

```js
async () => {
  await new Promise((r) => setTimeout(r, 3000));
  const reg = await navigator.serviceWorker.getRegistration('/app');
  return {
    signed: document.getElementById('app').dataset.signed,
    signInShown: !document.getElementById('signin').hidden,
    tabsHidden: document.getElementById('tabs').hidden,
    frames: window.__buddyFrames,
    mood: window.__buddyMood,
    worker: reg ? reg.scope : null,
  };
}
```

Expected: `{ signed: "out", signInShown: true, tabsHidden: true, frames: <more than 10>, mood: "idle", worker: "http://localhost:8787/app" }`.

- [ ] **Step 4: Screenshot and console**

`take_screenshot`: Expected: the cream page, the 3D head (eyes on its dark face screen, the sprout or bow on top) in the top half, "Hi! I'm Buddy.", the line about the Google account, and the dark "Sign in with Google" pill; nothing cut off at 390 px wide.

`list_console_messages`: Expected: no errors and no warnings from the app (`<no console messages found>`).

- [ ] **Step 5: The signed-in layout (drawn by hand, since sign-in needs the real domain)**

`evaluate_script`:

```js
() => {
  const $ = (id) => document.getElementById(id);
  $('app').dataset.signed = 'in';
  $('signin').hidden = true;
  $('tabs').hidden = false;
  $('chat-pane').hidden = false;
  $('chat-mic').hidden = false;
  $('chat-items').innerHTML = '<li class="item you"><p>boss ko mail likho, kal chutti chahiye</p></li>'
    + '<li class="item event">📝 Remembered: Your boss is Mr. Sharma.<div class="buttons"><button class="chip">Undo</button></div></li>'
    + '<li class="item buddy"><p class="say">Here you go!</p><p class="text">Dear Mr. Sharma,\nI would like to take leave tomorrow.</p>'
    + '<div class="buttons"><button class="chip">Copy</button><button class="chip">Share</button></div></li>';
  $('chat-empty').hidden = true;
  return true;
}
```

`take_screenshot`: Expected: the head smaller on top, your message on the right in a dark bubble, the "Remembered" line with Undo in the middle, Buddy's answer on the left with the mail in a cream box and Copy / Share, the box with 🎤, "Ask Buddy…" and ↑ above the tabs Chat (underlined in orange) / Claude / Settings.

Reload the page afterwards (`navigate_page` `type: "reload"`), so nothing hand-drawn is left.

- [ ] **Step 6: Stop the server and report**

Stop the background `npm run serve:web`. If anything above did not match, fix it in the task where the file was made, run `npm test`, and commit with a `fix(iphone): …` message (no attribution lines). Otherwise there is nothing to commit.

---

## After the plan (the owner, once the PR is merged)

1. Google Cloud console: add `https://buddywrites.vercel.app/__/auth/handler` to the "Web client (auto created by Google Service)" redirect URIs; Firebase console: `buddywrites.vercel.app` in Authentication → Settings → Authorized domains (`docs/manual-checklist-iphone.md`, "Once, before the first try").
2. `cd web && npx web-push generate-vapid-keys`, then `vercel env add VAPID_PUBLIC_KEY production --cwd web`, the same for `VAPID_PRIVATE_KEY` and `VAPID_SUBJECT` (`mailto:akshatg9636@gmail.com`).
3. `npm run deploy:server`, then go through `docs/manual-checklist-iphone.md` on the iPhone.
