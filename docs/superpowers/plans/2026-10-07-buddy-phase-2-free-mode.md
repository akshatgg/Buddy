# Buddy Phase 2 — Free mode, Google sign-in and the admin window (Mac) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Everyone signs in with Google; the admin (akshatg9636@gmail.com) can make Buddy free for all users with the server's AI key — unlimited or N requests a day, optionally followed by the user's own key — block users, and do all of it from an Admin window inside the Mac app.

**Architecture:** A new Vercel project in `web/` (CommonJS Node functions + `firebase-admin`) holds the admin's switches and the users in Cloud Firestore (`config/free`, `users/{uid}`) and answers free requests with the server's key, using the same prompts and provider adapters as the app (`shared/`, copied into `web/shared/` by `npm run sync:web`). The Electron app gains Google sign-in for desktop apps (PKCE + loopback → Firebase `signInWithIdp`), a server client, a routing layer that picks the free or own-key route from the server's settings, sign-in and free-state UI in Welcome/Settings/panel, and an Admin window shown only to the admin.

**Tech Stack:** Electron 44, plain JavaScript (CommonJS), `node --test`, ESLint 10; Vercel Node 22 functions; `firebase-admin` (Auth token checks + Firestore); Firebase Authentication REST (`accounts:signInWithIdp`, `securetoken`); Google OAuth 2.0 for installed apps; the Firestore emulator (firebase-tools, Java 17) for the database adapter's tests.

**Spec:** `docs/superpowers/specs/2026-10-07-buddy-phase-2-free-mode-design.md` (builds on `2026-10-06-buddy-v1-mac-design.md`).

## Global Constraints

- Everything in Phase 1's constraints still holds: plain JavaScript, CommonJS in main/preload/shared/server, vanilla HTML/CSS/JS renderers, `node --test`, ESLint; no TypeScript, bundler or UI framework.
- Output capped at 1024 tokens per request on both routes (`MAX_TOKENS = 1024`, now exported by `shared/prompts.js`).
- Input limits as in Phase 1: instruction ≤ 1 000 chars, text ≤ 8 000 chars, image ≤ 2 800 000 base64 chars (enforced by `shared/prompts.js` on both routes).
- Firebase project: **`buddy-7f8c2`** (display name "Buddy", Spark plan). Firestore location `asia-south1`.
- Admin: the server's `ADMIN_EMAIL` environment value (**akshatg9636@gmail.com**), compared case-insensitively, and only for tokens with `email_verified`.
- The day a request counts towards is the calendar date in **Asia/Kolkata**, written `YYYY-MM-DD`.
- Firestore holds only `config/free` and `users/{uid}` (`email, name, joined, lastActive, blocked, usedDay, usedCount`). Security rules deny every client read and write; only the server (Admin SDK) touches it.
- Never log or store what users write, their screenshots or the answers. Logs carry status codes, error codes and kinds only.
- AI keys: the admin's live only in the Vercel environment; users' stay on their Mac, encrypted with `safeStorage`.
- Every message a person sees is plain words, ready to show as it is (`BuddyError.message`, or the server's `{ error: { code, message } }`).
- `web/shared/` is generated: change `shared/`, then run `npm run sync:web`. `npm test` fails while the copy is stale.
- Server code (`web/lib`, `web/api`) uses the copy's `BuddyError` (`web/shared/errors.js`), a different class from `shared/errors.js`: a server test whose error must reach `handle()` as a `BuddyError` imports it from `web/shared/errors`.
- `cloud.json` (server URL, Firebase web API key, Google desktop OAuth client id and secret) is never committed; `cloud.example.json` is.
- Commits: one per task at least. **No `Co-Authored-By` line and no mention of Claude as an author** in commits, PRs or files (the user's rule). The Claude AI provider inside the app is product content and stays.
- `npm run test:e2e` briefly opens Buddy's windows on screen and uses only fakes (clipboard, shortcut, login item, account, server); it is safe to run.

## File map

```
shared/prompts.js                 + MAX_TOKENS (1024), used by the app and the server
tools/sync-web-shared.js          copies shared/ → web/shared/ (npm run sync:web)
web/                              the Vercel project (root directory of the deployment)
  package.json                    firebase-admin; Node 22
  vercel.json                     ask gets 60 s; no caching
  public/index.html               a one-line page for the root URL
  firestore.rules                 deny every client read/write
  README.md                       setup and deploy
  shared/                         GENERATED copy of ../shared
  lib/day.js                      dayKey(date) → "YYYY-MM-DD" in Asia/Kolkata
  lib/free-config.js              withDefaults, isFreeOn, applyPatch (the admin's switches)
  lib/handlers.js                 config, ask, adminSettings, adminModels, adminUsers, handle
  lib/firestore-db.js             createFirestoreDb(firestore): the database methods the handlers use
  lib/deps.js                     realDeps(): firebase-admin, providers, keys from the environment
  lib/vercel.js                   toVercel(handler): (req, res) wrapper
  api/config.js                   GET  /api/config
  api/ask.js                      POST /api/ask
  api/admin/settings.js           GET/PUT /api/admin/settings
  api/admin/models.js             GET  /api/admin/models?provider=
  api/admin/users.js              GET/POST /api/admin/users
firebase.json, .firebaserc        rules path, emulator port, default project buddy-7f8c2
cloud.example.json                the shape of cloud.json
src/main/cloud-config.js          loadCloudConfig(), notSetUp()
src/main/google-signin.js         signInWithGoogle(), refreshIdToken(), listenForCode(), makePkce(), authUrl()
src/main/account.js               createAccount(): sign in/out, idToken(), user(), onChange()
src/main/cloud.js                 createCloud(): settings(), last(), forget(), ask(), admin.*, onChange()
src/main/free-state.js            aiSection(free) → { note, showForm }
src/main/ai.js                    routing between the free and own-key routes
src/main/store.js                 + DEFAULTS.cloud (the last free settings)
src/main/ipc/settings.js          account + free state in the snapshot; sign in/out; refresh
src/main/ipc/admin.js             the admin window's calls
src/main/settings-windows.js      + the admin window (its own preload)
src/main/tray.js                  + "Admin…" for the admin
src/main/main.js                  wiring
src/preload/settings.js           + refresh, signIn, signOut
src/preload/admin.js              the admin window's bridge
src/renderer/settings/            Account card, free note on the AI card
src/renderer/onboarding/          Sign-in step first; Connect an AI only when needed
src/renderer/panel/panel.js       Open Settings for the new codes
src/renderer/admin/               index.html, admin.js, admin.css
test/...                          see each task
test/firestore/firestore-db.test.js   emulator test (npm run test:firestore)
```

## Order and parallelism

Task 1 first. Then Tasks 2, 3 and 4 are independent of each other (each in its own worktree branched from the tip after Task 1). Task 5 needs 3 and 4. Task 6 needs 5. Task 7 (go live) needs everything and is done with the owner, because it creates cloud resources and needs their console clicks and AI key.

---

### Task 1: The server's core — switches, day, handlers (no Firebase, no Vercel yet)

**Files:**
- Modify: `shared/prompts.js` (export `MAX_TOKENS`)
- Modify: `test/prompts.test.js` (one test at the end)
- Create: `tools/sync-web-shared.js`
- Create: `web/shared/**` (generated by the tool)
- Create: `web/lib/day.js`, `web/lib/free-config.js`, `web/lib/handlers.js`
- Create: `test/helpers/fake-db.js`
- Create: `test/web-shared.test.js`, `test/server-day.test.js`, `test/server-free-config.test.js`, `test/server-handlers.test.js`
- Modify: `package.json` (script `sync:web`), `eslint.config.js` (ignores), `.gitignore`

**Interfaces:**
- Consumes: `shared/prompts.js` `buildPrompt(action, input) → { system, user, image }` (throws `BuddyError('bad_request', …)`), `parseCheck(text)`; `shared/providers` `PROVIDERS`, `PROVIDER_IDS`; `shared/errors` `BuddyError`.
- Produces:
  - `shared/prompts.js` exports `MAX_TOKENS` (1024).
  - `web/lib/day.js`: `dayKey(date: Date) → 'YYYY-MM-DD'` (Asia/Kolkata).
  - `web/lib/free-config.js`: `withDefaults(stored, hasKey) → config`, `isFreeOn(config, hasKey) → boolean`, `applyPatch(current, patch, hasKey) → config` (throws `bad_request`), `DEFAULT_LIMIT = 30`, `MAX_LIMIT = 10000`. A config is `{ enabled, limitMode: 'unlimited'|'daily', dailyRequests, allowOwnKey, provider, model }`. `hasKey(providerId) → boolean`.
  - `web/lib/handlers.js`: `config`, `ask`, `adminSettings`, `adminModels`, `adminUsers` — each `async (req, deps) → { status, body }` where `req = { method, headers, body, query }`; `handle(handler, req, deps)` turns thrown `BuddyError`s into `{ status, body: { error: { code, message } } }` and anything else into a 500. `deps = { verifyToken, db, providers, adminKeys, adminEmail, now, fetchImpl? }`.
  - The **db interface** (implemented by `test/helpers/fake-db.js` here and `web/lib/firestore-db.js` in Task 2):
    - `getConfig() → object | null`; `setConfig(config) → void`
    - `ensureUser({ uid, email, name, now }) → user` (adds on first call; keeps email/name current)
    - `countRequest({ uid, email, name, day, now, limit /* null = unlimited */ }) → { ok: true, usedCount } | { ok: false, reason: 'blocked' } | { ok: false, reason: 'limit', usedCount }`
    - `refundRequest({ uid, day }) → void`
    - `listUsers({ limit }) → user[]` (most recently active first)
    - `setBlocked(uid, blocked) → user | null`
    - A user is `{ uid, email, name, joined: Date, lastActive: Date | null, blocked, usedDay, usedCount }`.

- [ ] **Step 1: Export the token cap from the shared prompts**

In `shared/prompts.js`, after the line `const LIMITS = { instruction: 1000, text: 8000, imageChars: 2_800_000 };` add:

```js
// The longest answer either route asks for (the app with the user's key, the server with the admin's).
const MAX_TOKENS = 1024;
```

and change the last line to:

```js
module.exports = { ACTIONS, TONES, LIMITS, MAX_TOKENS, buildPrompt, parseCheck };
```

At the end of `test/prompts.test.js` add:

```js
test('answers are capped at 1024 tokens, on the own-key route and the free one alike', () => {
  assert.strictEqual(require('../shared/prompts').MAX_TOKENS, 1024);
});
```

Run: `node --test test/prompts.test.js` — Expected: all pass.

- [ ] **Step 2: Write the failing tests for the copy of shared/ and the day**

Create `test/web-shared.test.js`:

```js
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
```

Create `test/server-day.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { dayKey } = require('../web/lib/day');

test('the day is the date in India, which turns at 18:30 UTC', () => {
  assert.strictEqual(dayKey(new Date('2026-10-06T18:29:59Z')), '2026-10-06');
  assert.strictEqual(dayKey(new Date('2026-10-06T18:30:00Z')), '2026-10-07');
});

test('it is written YYYY-MM-DD', () => {
  assert.strictEqual(dayKey(new Date('2026-01-05T00:00:00Z')), '2026-01-05');
});
```

Run: `node --test test/web-shared.test.js test/server-day.test.js` — Expected: FAIL with `Cannot find module '../tools/sync-web-shared'` and `'../web/lib/day'`.

- [ ] **Step 3: Write the sync tool and the day**

Create `tools/sync-web-shared.js`:

```js
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
```

Create `web/lib/day.js`:

```js
'use strict';

/** The day a free request counts towards: the date in India (Asia/Kolkata), so "resets at midnight" is IST midnight. */

// en-CA writes dates as YYYY-MM-DD.
const FORMAT = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
});

function dayKey(date) {
  return FORMAT.format(date);
}

module.exports = { dayKey };
```

In `package.json` add to `"scripts"` (after `"build:icon"`):

```json
    "sync:web": "node tools/sync-web-shared.js",
```

Run: `npm run sync:web` — Expected: `web/shared now matches shared/ (7 files)` (errors.js, prompts.js and the five files under providers/).

Run: `node --test test/web-shared.test.js test/server-day.test.js` — Expected: PASS.

- [ ] **Step 4: Write the failing tests for the admin's switches**

Create `test/server-free-config.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { withDefaults, isFreeOn, applyPatch, DEFAULT_LIMIT, MAX_LIMIT } = require('../web/lib/free-config');

/** hasKey for a server that has keys for these providers only. */
const keys = (...ids) => (id) => ids.includes(id);
const SAVED = { enabled: true, limitMode: 'daily', dailyRequests: 5, allowOwnKey: true, provider: 'anthropic', model: 'claude-x' };
const refused = (message) => ({ code: 'bad_request', message });

test('nothing saved: free mode off, 30 a day, own keys not allowed, the first provider with a key', () => {
  assert.strictEqual(DEFAULT_LIMIT, 30);
  assert.strictEqual(MAX_LIMIT, 10_000);
  assert.deepStrictEqual(withDefaults(null, keys('groq')), {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'groq', model: 'llama-3.3-70b-versatile',
  });
  assert.strictEqual(withDefaults(undefined, keys()).provider, 'anthropic', 'with no key at all, the first provider');
  assert.strictEqual(withDefaults(undefined, keys()).model, 'claude-haiku-4-5-20251001');
});

test('saved switches read back as saved', () => {
  assert.deepStrictEqual(withDefaults(SAVED, keys('anthropic')), SAVED);
  assert.strictEqual(withDefaults({ ...SAVED, limitMode: 'unlimited' }, keys()).limitMode, 'unlimited');
});

test('a value that is not valid falls back to its default, field by field', () => {
  const odd = { enabled: 'yes', limitMode: 'weekly', dailyRequests: 0, allowOwnKey: 1, provider: 'constructor', model: '  ' };
  assert.deepStrictEqual(withDefaults(odd, keys('openai')), {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'openai', model: 'gpt-4.1-mini',
  });
  assert.strictEqual(withDefaults({ dailyRequests: 2.5 }, keys()).dailyRequests, 30);
  assert.strictEqual(withDefaults({ dailyRequests: 10_001 }, keys()).dailyRequests, 30);
  assert.strictEqual(withDefaults('text', keys()).enabled, false);
});

test('free mode is on only when it is switched on and the server has a key for its provider', () => {
  assert.strictEqual(isFreeOn(SAVED, keys('anthropic')), true);
  assert.strictEqual(isFreeOn(SAVED, keys('openai')), false);
  assert.strictEqual(isFreeOn({ ...SAVED, enabled: false }, keys('anthropic')), false);
});

test('a patch changes only what it names, and leaves the current switches alone', () => {
  const current = { ...SAVED };
  const next = applyPatch(current, { dailyRequests: 50, allowOwnKey: false, ignored: 'x' }, keys('anthropic'));
  assert.deepStrictEqual(next, { ...SAVED, dailyRequests: 50, allowOwnKey: false });
  assert.deepStrictEqual(current, SAVED);
});

test('a new provider brings its own first model, unless a model comes with it', () => {
  assert.strictEqual(applyPatch(SAVED, { provider: 'groq' }, keys('anthropic', 'groq')).model, 'llama-3.3-70b-versatile');
  assert.strictEqual(applyPatch(SAVED, { provider: 'groq', model: 'llama-4' }, keys('anthropic', 'groq')).model, 'llama-4');
  assert.strictEqual(applyPatch(SAVED, { provider: 'anthropic' }, keys('anthropic')).model, 'claude-x', 'the same provider keeps its model');
  assert.strictEqual(applyPatch(SAVED, { model: '  claude-y ' }, keys('anthropic')).model, 'claude-y');
});

test('each field that is not valid is refused in plain words', () => {
  const k = keys('anthropic');
  for (const [patch, message] of [
    ['text', 'Those settings are not valid.'],
    [null, 'Those settings are not valid.'],
    [[], 'Those settings are not valid.'],
    [{ enabled: 'on' }, 'Free mode must be on or off.'],
    [{ limitMode: 'weekly' }, 'Pick Unlimited or a daily limit.'],
    [{ dailyRequests: 0 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: 2.5 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: '30' }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ dailyRequests: 10_001 }, 'The daily limit must be a whole number from 1 to 10000.'],
    [{ allowOwnKey: 'yes' }, '"Also let users add their own key" must be on or off.'],
    [{ provider: 'constructor' }, 'Unknown AI provider.'],
    [{ model: '' }, 'Pick a model.'],
    [{ model: 'm'.repeat(201) }, 'Pick a model.'],
  ]) {
    assert.throws(() => applyPatch(SAVED, patch, k), refused(message), JSON.stringify(patch));
  }
});

test('free mode cannot be on for a provider the server has no key for', () => {
  assert.throws(
    () => applyPatch({ ...SAVED, enabled: false }, { enabled: true, provider: 'openai' }, keys('anthropic')),
    refused("There is no OpenAI key on the server, so free mode can't use it."),
  );
  assert.strictEqual(
    applyPatch(SAVED, { enabled: false, provider: 'openai' }, keys('anthropic')).provider,
    'openai',
    'switched off, any provider may be picked',
  );
});
```

Run: `node --test test/server-free-config.test.js` — Expected: FAIL with `Cannot find module '../web/lib/free-config'`.

- [ ] **Step 5: Write the admin's switches**

Create `web/lib/free-config.js`:

```js
'use strict';

/**
 * The admin's switches for free mode (Firestore config/free): what they are when nothing is saved yet, and
 * whether a change the admin asks for is valid. `hasKey(providerId)` says whether the server has a key for it.
 *
 *   { enabled, limitMode: 'unlimited' | 'daily', dailyRequests, allowOwnKey, provider, model }
 */

const { BuddyError } = require('../shared/errors');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');

const DEFAULT_LIMIT = 30;
const MAX_LIMIT = 10_000;
const MODEL_MAX = 200;

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const isLimit = (n) => Number.isInteger(n) && n >= 1 && n <= MAX_LIMIT;
const bad = (message) => new BuddyError('bad_request', message);

/** The saved switches, with a default for each one that is missing or not valid. */
function withDefaults(stored, hasKey) {
  const s = isPlainObject(stored) ? stored : {};
  const provider = PROVIDER_IDS.includes(s.provider) ? s.provider : (PROVIDER_IDS.find(hasKey) || PROVIDER_IDS[0]);
  const model = typeof s.model === 'string' && s.model.trim() ? s.model : PROVIDERS[provider].fallbackModels[0];
  return {
    enabled: s.enabled === true,
    limitMode: s.limitMode === 'unlimited' ? 'unlimited' : 'daily',
    dailyRequests: isLimit(s.dailyRequests) ? s.dailyRequests : DEFAULT_LIMIT,
    allowOwnKey: s.allowOwnKey === true,
    provider,
    model,
  };
}

/** Free mode is on only when the admin switched it on and the server has a key for the chosen provider. */
function isFreeOn(config, hasKey) {
  return config.enabled && hasKey(config.provider);
}

/** `current` changed as the admin's `patch` asks. Throws a bad_request in plain words for anything not valid. */
function applyPatch(current, patch, hasKey) {
  if (!isPlainObject(patch)) throw bad('Those settings are not valid.');
  const has = (name) => Object.hasOwn(patch, name);
  const next = { ...current };
  if (has('enabled')) {
    if (typeof patch.enabled !== 'boolean') throw bad('Free mode must be on or off.');
    next.enabled = patch.enabled;
  }
  if (has('limitMode')) {
    if (patch.limitMode !== 'unlimited' && patch.limitMode !== 'daily') throw bad('Pick Unlimited or a daily limit.');
    next.limitMode = patch.limitMode;
  }
  if (has('dailyRequests')) {
    if (!isLimit(patch.dailyRequests)) throw bad(`The daily limit must be a whole number from 1 to ${MAX_LIMIT}.`);
    next.dailyRequests = patch.dailyRequests;
  }
  if (has('allowOwnKey')) {
    if (typeof patch.allowOwnKey !== 'boolean') throw bad('"Also let users add their own key" must be on or off.');
    next.allowOwnKey = patch.allowOwnKey;
  }
  if (has('provider')) {
    if (!PROVIDER_IDS.includes(patch.provider)) throw bad('Unknown AI provider.');
    if (patch.provider !== current.provider) {
      next.provider = patch.provider;
      next.model = PROVIDERS[patch.provider].fallbackModels[0]; // the old model belongs to the old provider
    }
  }
  if (has('model')) {
    const model = typeof patch.model === 'string' ? patch.model.trim() : '';
    if (!model || model.length > MODEL_MAX) throw bad('Pick a model.');
    next.model = model;
  }
  if (next.enabled && !hasKey(next.provider)) {
    throw bad(`There is no ${PROVIDERS[next.provider].label} key on the server, so free mode can't use it.`);
  }
  return next;
}

module.exports = { withDefaults, isFreeOn, applyPatch, DEFAULT_LIMIT, MAX_LIMIT };
```

Note: `web/lib/*` requires `../shared/...`, which is the generated copy in `web/shared/` (Step 3 made it).

Run: `node --test test/server-free-config.test.js` — Expected: PASS.

- [ ] **Step 6: Write the in-memory database for tests**

Create `test/helpers/fake-db.js`:

```js
'use strict';

/**
 * An in-memory stand-in for web/lib/firestore-db.js: the same methods, the same answers. The real one is tested
 * against the Firestore emulator (test/firestore/firestore-db.test.js) with the same expectations.
 * `state.calls` records which methods were called, in order.
 */
function fakeDb({ config = null, users = {} } = {}) {
  const state = { config: structuredClone(config), users: structuredClone(users), calls: [] };
  const copy = (uid) => ({ uid, ...structuredClone(state.users[uid]) });
  const fresh = ({ email, name, now }) => ({ email, name, joined: now, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });

  return {
    state,
    async getConfig() {
      state.calls.push('getConfig');
      return structuredClone(state.config);
    },
    async setConfig(config) {
      state.calls.push('setConfig');
      state.config = structuredClone(config);
    },
    async ensureUser({ uid, email, name, now }) {
      state.calls.push('ensureUser');
      if (!state.users[uid]) state.users[uid] = fresh({ email, name, now });
      else Object.assign(state.users[uid], { email, name });
      return copy(uid);
    },
    async countRequest({ uid, email, name, day, now, limit }) {
      state.calls.push('countRequest');
      const user = state.users[uid] || fresh({ email, name, now });
      if (user.blocked) return { ok: false, reason: 'blocked' };
      const used = user.usedDay === day ? user.usedCount : 0;
      if (limit !== null && used >= limit) return { ok: false, reason: 'limit', usedCount: used };
      state.users[uid] = { ...user, email, name, usedDay: day, usedCount: used + 1, lastActive: now };
      return { ok: true, usedCount: used + 1 };
    },
    async refundRequest({ uid, day }) {
      state.calls.push('refundRequest');
      const user = state.users[uid];
      if (user && user.usedDay === day && user.usedCount > 0) user.usedCount -= 1;
    },
    async listUsers({ limit }) {
      state.calls.push('listUsers');
      const time = (u) => (u.lastActive ? u.lastActive.getTime() : -1);
      return Object.keys(state.users).map(copy).sort((a, b) => time(b) - time(a)).slice(0, limit);
    },
    async setBlocked(uid, blocked) {
      state.calls.push('setBlocked');
      if (!state.users[uid]) return null;
      state.users[uid].blocked = blocked;
      return copy(uid);
    },
  };
}

module.exports = { fakeDb };
```

- [ ] **Step 7: Write the failing tests for the handlers**

Create `test/server-handlers.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { PROVIDERS } = require('../shared/providers');
const { config, ask, adminSettings, adminModels, adminUsers, handle } = require('../web/lib/handlers');
const { fakeDb } = require('./helpers/fake-db');

const NOW = new Date('2026-10-07T06:30:00Z'); // noon in India on 2026-10-07
const TODAY = '2026-10-07';
const ADMIN = 'akshatg9636@gmail.com';
const RAHUL = { email: 'rahul@gmail.com', name: 'Rahul' };

/** Free mode on with a daily limit of `n`, on Claude, with any other choices in `extra`. */
const freeDaily = (n, extra = {}) => ({
  enabled: true, limitMode: 'daily', dailyRequests: n, allowOwnKey: false, provider: 'anthropic', model: 'claude-x', ...extra,
});
const userDoc = (extra = {}) => ({ ...RAHUL, joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0, ...extra });
const refusal = (status, code, message) => ({ status, body: { error: { code, message } } });

const TOKENS = {
  user: { uid: 'u1', ...RAHUL, emailVerified: true },
  admin: { uid: 'a1', email: ADMIN, name: 'Akshat', emailVerified: true },
  unverified: { uid: 'u2', email: 'x@gmail.com', name: 'X', emailVerified: false },
};

/**
 * The handlers with fakes: an in-memory database, one fake provider whatever the id, the server's keys in `keys`,
 * and three ID tokens: 'user', 'admin' and 'unverified'. `run(handler, method, { token, body, query })`.
 */
function setup({
  stored = null, users = {}, keys = { anthropic: 'admin-key' }, vision = true, reply = 'An answer', fail = null,
  live = ['m-1', 'm-2'], listFails = false,
} = {}) {
  const db = fakeDb({ config: stored, users });
  const completes = [];
  const lists = [];
  const provider = {
    isVisionModel: () => vision,
    async complete(opts) {
      completes.push(opts);
      if (fail) throw fail;
      return { text: reply, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels(opts) {
      lists.push(opts);
      if (listFails) throw new BuddyError('bad_key', 'Your Claude key was rejected. Check it in Settings.');
      return live;
    },
  };
  const deps = {
    async verifyToken(token) {
      if (!Object.hasOwn(TOKENS, token)) throw new Error('not a token');
      return TOKENS[token];
    },
    db,
    providers: { getProvider: () => provider },
    adminKeys: keys,
    adminEmail: ADMIN,
    now: () => NOW,
  };
  const run = (handler, method, { token = 'user', body, query } = {}) => handle(handler, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    query,
  }, deps);
  return { db, completes, lists, run };
}

// ---- signing in ----

test('every route wants a valid ID token for a verified email', async () => {
  const s = setup();
  for (const handler of [config, ask, adminSettings, adminModels, adminUsers]) {
    const method = handler === ask ? 'POST' : 'GET';
    assert.deepStrictEqual(await s.run(handler, method, { token: null }), refusal(401, 'unauthenticated', 'Sign in to use Buddy.'));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'forged' }),
      refusal(401, 'unauthenticated', 'Your sign-in has expired. Sign in again.'));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'unverified' }),
      refusal(401, 'unauthenticated', 'Sign in with a Google account whose email is verified.'));
  }
  assert.deepStrictEqual(s.db.state.calls, [], 'nothing was read or written');
});

test('a method a route does not take is refused', async () => {
  const s = setup();
  for (const [handler, method] of [[config, 'POST'], [ask, 'GET'], [adminSettings, 'DELETE'], [adminModels, 'POST'], [adminUsers, 'PUT']]) {
    assert.deepStrictEqual(await s.run(handler, method), refusal(405, 'method_not_allowed', 'Not allowed.'));
  }
});

test('the admin routes are for the admin only', async () => {
  const s = setup();
  for (const [handler, method] of [[adminSettings, 'GET'], [adminSettings, 'PUT'], [adminModels, 'GET'], [adminUsers, 'GET'], [adminUsers, 'POST']]) {
    assert.deepStrictEqual(await s.run(handler, method, { body: { enabled: true } }), refusal(403, 'not_admin', 'Only the admin can do this.'));
  }
  assert.deepStrictEqual(s.db.state.calls, []);
});

// ---- GET /api/config ----

test('config: the first call adds the user, and with nothing saved free mode is off', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(config, 'GET'), {
    status: 200,
    body: { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false },
  });
  assert.deepStrictEqual(s.db.state.users.u1, userDoc());
});

test("config: free mode on, today's count, and own keys allowed", async () => {
  const s = setup({ stored: freeDaily(5, { allowOwnKey: true }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 3, lastActive: NOW }) } });
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 5, usedToday: 3, allowOwnKey: true, blocked: false, isAdmin: false,
  });
});

test("config: yesterday's count is not today's; unlimited has no limit and no own keys", async () => {
  const s = setup({
    stored: freeDaily(5, { limitMode: 'unlimited', allowOwnKey: true }),
    users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 9 }) },
  });
  const { body } = await s.run(config, 'GET');
  assert.deepStrictEqual([body.limitMode, body.limit, body.usedToday, body.allowOwnKey], ['unlimited', null, 0, false]);
});

test('config: switched on with no server key for its provider counts as off', async () => {
  const s = setup({ stored: freeDaily(5), keys: { openai: 'k' } });
  assert.strictEqual((await s.run(config, 'GET')).body.freeOn, false);
});

test('config: says who is blocked and who is the admin', async () => {
  const s = setup({ users: { u1: userDoc({ blocked: true }) } });
  assert.strictEqual((await s.run(config, 'GET')).body.blocked, true);
  assert.strictEqual((await s.run(config, 'GET', { token: 'admin' })).body.isAdmin, true);
});

// ---- POST /api/ask ----

test("ask: counts the request, then answers with the admin's key, the chosen model and the token cap", async () => {
  const s = setup({ stored: freeDaily(5) });
  const r = await s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.deepStrictEqual(r, { status: 200, body: { text: 'An answer', model: 'claude-x' } });
  const [call] = s.completes;
  assert.deepStrictEqual([call.apiKey, call.model, call.user, call.maxTokens], ['admin-key', 'claude-x', 'me go home', 1024]);
  assert.ok(call.signal instanceof AbortSignal, 'the AI gets a deadline');
  assert.deepStrictEqual(s.db.state.users.u1, userDoc({ usedDay: TODAY, usedCount: 1, lastActive: NOW }));
});

test('ask: the daily limit is kept, and nothing is asked of the AI past it', async () => {
  const s = setup({ stored: freeDaily(2) });
  const fix = () => s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.strictEqual((await fix()).status, 200);
  assert.strictEqual((await fix()).status, 200);
  assert.deepStrictEqual(await fix(), refusal(429, 'free_limit', "You've used today's 2 free requests. They come back at midnight."));
  assert.strictEqual(s.completes.length, 2);
  assert.strictEqual(s.db.state.users.u1.usedCount, 2);
});

test('ask: a new day starts again from zero', async () => {
  const s = setup({ stored: freeDaily(2), users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 2 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.deepStrictEqual([s.db.state.users.u1.usedDay, s.db.state.users.u1.usedCount], [TODAY, 1]);
});

test('ask: unlimited still counts, and never refuses', async () => {
  const s = setup({ stored: freeDaily(2, { limitMode: 'unlimited' }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 500 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.strictEqual(s.db.state.users.u1.usedCount, 501);
});

test('ask: a blocked user is refused, and nothing is counted or asked', async () => {
  const s = setup({ stored: freeDaily(5), users: { u1: userDoc({ blocked: true }) } });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), refusal(403, 'blocked', 'Your free access is paused.'));
  assert.strictEqual(s.completes.length, 0);
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
});

test('ask: free mode off, or no server key for its provider, is free_off', async () => {
  const off = refusal(403, 'free_off', 'Free AI is off. Add your own key in Settings.');
  const s1 = setup();
  assert.deepStrictEqual(await s1.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  const s2 = setup({ stored: freeDaily(5), keys: { groq: 'k' } });
  assert.deepStrictEqual(await s2.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  assert.deepStrictEqual([s1.db.state.users, s2.db.state.users], [{}, {}], 'nobody was counted');
});

test('ask: input that is not valid is refused with the same words as in the app, before anything is read', async () => {
  const s = setup({ stored: freeDaily(5) });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'write', instruction: '  ' } }),
    refusal(400, 'bad_request', 'Tell me what to write first.'));
  assert.strictEqual((await s.run(ask, 'POST', { body: 'not an object' })).status, 400);
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x'.repeat(8001) } })).status, 400);
  assert.deepStrictEqual(s.db.state.calls, [], 'not even the settings were read');
});

test('ask: a screenshot for a model that cannot see is refused, and not counted', async () => {
  const s = setup({ stored: freeDaily(5), vision: false });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG' } }),
    refusal(400, 'free_no_vision', "The free AI can't read screenshots right now."));
  assert.deepStrictEqual(s.db.state.users, {});
});

test('ask: when the AI fails the request is given back, and the user hears it in plain words', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ stored: freeDaily(5), fail: new BuddyError('rate_limited', 'Claude is busy right now. Try again in a minute.') });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'my secret text' } }),
    refusal(502, 'upstream', "Buddy couldn't answer. Try again."));
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
  assert.deepStrictEqual(s.db.state.calls.filter((c) => c !== 'getConfig'), ['countRequest', 'refundRequest']);
  const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /\[ask\] anthropic failed: rate_limited/);
  assert.doesNotMatch(logged, /secret/, 'what the user sent is never logged');
});

test('ask: a Check answer comes back read as well', async () => {
  const s = setup({ stored: freeDaily(5), reply: '{"verdict":"good","problems":[],"corrected":null}' });
  const r = await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG', instruction: 'ok?' } });
  assert.deepStrictEqual(r.body.check, { verdict: 'good', problems: [], corrected: null });
});

// ---- the admin's switches ----

test('admin settings: with nothing saved, the defaults, and which providers have a key on the server', async () => {
  const s = setup({ keys: { anthropic: 'k', groq: 'g' } });
  const r = await s.run(adminSettings, 'GET', { token: 'admin' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.config, {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  });
  assert.deepStrictEqual(r.body.providers.map((p) => [p.id, p.label, p.hasKey]), [
    ['anthropic', 'Claude (Anthropic)', true], ['openai', 'OpenAI', false], ['gemini', 'Google Gemini', false], ['groq', 'Groq', true],
  ]);
  assert.deepStrictEqual(r.body.providers[3].fallbackModels, PROVIDERS.groq.fallbackModels);
});

test('admin settings: a change is saved and every user sees it; a refused one changes nothing', async () => {
  const s = setup();
  const saved = await s.run(adminSettings, 'PUT', { token: 'admin', body: { enabled: true, dailyRequests: 10, allowOwnKey: true } });
  assert.strictEqual(saved.status, 200);
  const expected = {
    enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  };
  assert.deepStrictEqual(saved.body.config, expected);
  assert.deepStrictEqual(s.db.state.config, expected);
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 10, usedToday: 0, allowOwnKey: true, blocked: false, isAdmin: false,
  });

  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { dailyRequests: 0 } }),
    refusal(400, 'bad_request', 'The daily limit must be a whole number from 1 to 10000.'));
  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { provider: 'openai' } }),
    refusal(400, 'bad_request', "There is no OpenAI key on the server, so free mode can't use it."));
  assert.deepStrictEqual(s.db.state.config, expected);
});

test("admin models: the live list for the server's key", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query: { provider: 'anthropic' } }),
    { status: 200, body: { models: ['m-1', 'm-2'], live: true } });
  assert.strictEqual(s.lists[0].apiKey, 'admin-key');
});

test('admin models: the usual list when the server has no key, the key lists nothing, or the listing fails', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const usual = PROVIDERS.openai.fallbackModels;
  const list = (options) => setup(options).run(adminModels, 'GET', { token: 'admin', query: { provider: 'openai' } });
  assert.deepStrictEqual((await list({})).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, live: [] })).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, listFails: true })).body, {
    models: usual, live: false, warning: "Couldn't load the model list for the server's OpenAI key. Showing the usual models.",
  });
});

test('admin models: only real providers', async () => {
  const s = setup();
  for (const query of [{ provider: 'constructor' }, {}, undefined]) {
    assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query }), refusal(400, 'bad_request', 'Unknown AI provider.'));
  }
});

// ---- the users list ----

test('admin users: busiest today first, then the most recently active, with dates as ISO text', async () => {
  const at = (iso) => new Date(iso);
  const s = setup({ users: {
    a: userDoc({ email: 'a@x.com', name: 'A', lastActive: at('2026-10-07T05:00:00Z'), usedDay: TODAY, usedCount: 2 }),
    b: userDoc({ email: 'b@x.com', name: 'B', lastActive: at('2026-10-07T01:00:00Z'), usedDay: TODAY, usedCount: 7 }),
    c: userDoc({ email: 'c@x.com', name: 'C', lastActive: at('2026-10-06T12:00:00Z'), usedDay: '2026-10-06', usedCount: 50 }),
    d: userDoc({ email: 'd@x.com', name: 'D' }),
  } });
  const r = await s.run(adminUsers, 'GET', { token: 'admin' });
  assert.deepStrictEqual(r.body.users.map((u) => [u.uid, u.usedToday]), [['b', 7], ['a', 2], ['c', 0], ['d', 0]]);
  assert.deepStrictEqual(r.body.users[0], {
    uid: 'b', email: 'b@x.com', name: 'B', joined: NOW.toISOString(), lastActive: '2026-10-07T01:00:00.000Z', blocked: false, usedToday: 7,
  });
  assert.strictEqual(r.body.users[3].lastActive, null);
});

test('admin users: block and unblock', async () => {
  const s = setup({ users: { u1: userDoc() } });
  const blocked = await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual([blocked.status, blocked.body.user.uid, blocked.body.user.blocked], [200, 'u1', true]);
  assert.strictEqual(s.db.state.users.u1.blocked, true);
  await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: false } });
  assert.strictEqual(s.db.state.users.u1.blocked, false);
});

test('admin users: someone who is not there, or a request that is not valid', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'nobody', blocked: true } }),
    refusal(404, 'not_found', 'That user was not found.'));
  for (const body of [undefined, { uid: 'u1' }, { uid: '', blocked: true }, { uid: 7, blocked: true },
    { uid: 'x'.repeat(129), blocked: true }, { uid: 'u1', blocked: 'yes' }]) {
    assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body }),
      refusal(400, 'bad_request', 'Pick a user to block or unblock.'), JSON.stringify(body));
  }
});

// ---- anything else ----

test('a failure nobody planned for is a 500 in plain words, and it is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const r = await handle(async () => { throw new TypeError('boom'); }, { method: 'GET', headers: {} }, {});
  assert.deepStrictEqual(r, refusal(500, 'server', "Buddy's server had a problem. Try again."));
  assert.strictEqual(error.mock.callCount(), 1);
});
```

Run: `node --test test/server-handlers.test.js` — Expected: FAIL with `Cannot find module '../web/lib/handlers'`.

- [ ] **Step 8: Write the handlers**

Create `web/lib/handlers.js`:

```js
'use strict';

/**
 * Buddy's server, as plain functions. Each takes a request { method, headers, body, query } and its dependencies,
 * and answers { status, body }. The Vercel functions in web/api/ are thin wrappers around these (web/lib/vercel.js),
 * so everything here is tested with fakes (test/server-handlers.test.js).
 *
 * deps = {
 *   verifyToken(idToken) -> { uid, email, emailVerified, name }   throws when the token is not valid
 *   db                       web/lib/firestore-db.js, or a fake with the same methods
 *   providers                shared/providers: getProvider(id) -> { complete, listModels, isVisionModel }
 *   adminKeys                { providerId: key } -- the server's own AI keys
 *   adminEmail               who may use /api/admin/*
 *   now() -> Date
 *   fetchImpl                optional, for the providers
 * }
 */

const { BuddyError } = require('../shared/errors');
const { buildPrompt, parseCheck, MAX_TOKENS } = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const { dayKey } = require('./day');
const { withDefaults, isFreeOn, applyPatch } = require('./free-config');

// The app gives up on an answer after 60 seconds; the server gives up on the AI before that, so the person hears
// "Buddy couldn't answer" and the request is given back.
const ASK_TIMEOUT_MS = 50_000;
const MODELS_TIMEOUT_MS = 15_000;
const USERS_LIMIT = 1000;
const UID_MAX = 128;

const STATUS = {
  bad_request: 400,
  free_no_vision: 400,
  unauthenticated: 401,
  blocked: 403,
  free_off: 403,
  not_admin: 403,
  not_found: 404,
  method_not_allowed: 405,
  free_limit: 429,
  upstream: 502,
};

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const answer = (body) => ({ status: 200, body });
const hasKeyIn = (deps) => (id) => typeof deps.adminKeys?.[id] === 'string' && deps.adminKeys[id] !== '';

function allowMethods(req, ...methods) {
  if (!methods.includes(req.method)) throw new BuddyError('method_not_allowed', 'Not allowed.');
}

/** The signed-in person the request's ID token belongs to. */
async function signedIn(req, deps) {
  const match = /^Bearer (\S+)$/.exec(req.headers?.authorization || '');
  if (!match) throw new BuddyError('unauthenticated', 'Sign in to use Buddy.');
  let who;
  try {
    who = await deps.verifyToken(match[1]);
  } catch {
    throw new BuddyError('unauthenticated', 'Your sign-in has expired. Sign in again.');
  }
  if (!who?.uid || !who.email || who.emailVerified !== true) {
    throw new BuddyError('unauthenticated', 'Sign in with a Google account whose email is verified.');
  }
  return who;
}

const isAdmin = (who, deps) => Boolean(deps.adminEmail) && who.email.toLowerCase() === deps.adminEmail.trim().toLowerCase();

async function signedInAdmin(req, deps) {
  const who = await signedIn(req, deps);
  if (!isAdmin(who, deps)) throw new BuddyError('not_admin', 'Only the admin can do this.');
  return who;
}

/** GET /api/config: what free mode means for this person. Adds them on their first call. */
async function config(req, deps) {
  allowMethods(req, 'GET');
  const who = await signedIn(req, deps);
  const hasKey = hasKeyIn(deps);
  const now = deps.now();
  const [stored, user] = await Promise.all([
    deps.db.getConfig(),
    deps.db.ensureUser({ uid: who.uid, email: who.email, name: who.name || '', now }),
  ]);
  const cfg = withDefaults(stored, hasKey);
  const daily = cfg.limitMode === 'daily';
  return answer({
    freeOn: isFreeOn(cfg, hasKey),
    limitMode: cfg.limitMode,
    limit: daily ? cfg.dailyRequests : null,
    usedToday: user.usedDay === dayKey(now) ? user.usedCount : 0,
    allowOwnKey: daily && cfg.allowOwnKey,
    blocked: user.blocked === true,
    isAdmin: isAdmin(who, deps),
  });
}

/** POST /api/ask: one answer with the admin's key, counted against the person's day before the AI is asked. */
async function ask(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  const prompt = buildPrompt(body.action, body); // input that is not valid is refused before anything is read
  const hasKey = hasKeyIn(deps);
  const cfg = withDefaults(await deps.db.getConfig(), hasKey);
  if (!isFreeOn(cfg, hasKey)) throw new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.');
  const provider = deps.providers.getProvider(cfg.provider);
  if (prompt.image && !provider.isVisionModel(cfg.model)) {
    throw new BuddyError('free_no_vision', "The free AI can't read screenshots right now.");
  }

  const now = deps.now();
  const day = dayKey(now);
  const counted = await deps.db.countRequest({
    uid: who.uid,
    email: who.email,
    name: who.name || '',
    day,
    now,
    limit: cfg.limitMode === 'daily' ? cfg.dailyRequests : null,
  });
  if (!counted.ok && counted.reason === 'blocked') throw new BuddyError('blocked', 'Your free access is paused.');
  if (!counted.ok) {
    throw new BuddyError('free_limit', `You've used today's ${cfg.dailyRequests} free requests. They come back at midnight.`);
  }

  let out;
  try {
    out = await provider.complete({
      apiKey: deps.adminKeys[cfg.provider],
      model: cfg.model,
      ...prompt,
      maxTokens: MAX_TOKENS,
      fetchImpl: deps.fetchImpl,
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the kind of failure is logged, never what the person sent.
    console.warn(`[ask] ${cfg.provider} failed: ${err?.code || err?.name || 'error'}`);
    try {
      await deps.db.refundRequest({ uid: who.uid, day });
    } catch (refundErr) {
      console.error(`[ask] could not give the request back: ${refundErr?.code || refundErr?.name || 'error'}`);
    }
    throw new BuddyError('upstream', "Buddy couldn't answer. Try again.");
  }
  return answer({
    text: out.text,
    model: out.model,
    ...(body.action === 'check' ? { check: parseCheck(out.text) } : {}),
  });
}

function settingsView(cfg, hasKey) {
  return {
    config: cfg,
    providers: PROVIDER_IDS.map((id) => ({
      id, label: PROVIDERS[id].label, hasKey: hasKey(id), fallbackModels: PROVIDERS[id].fallbackModels,
    })),
  };
}

/** GET and PUT /api/admin/settings: the admin's switches, and which providers have a key on the server. */
async function adminSettings(req, deps) {
  allowMethods(req, 'GET', 'PUT');
  await signedInAdmin(req, deps);
  const hasKey = hasKeyIn(deps);
  const current = withDefaults(await deps.db.getConfig(), hasKey);
  if (req.method === 'GET') return answer(settingsView(current, hasKey));
  const next = applyPatch(current, req.body, hasKey);
  await deps.db.setConfig(next);
  return answer(settingsView(next, hasKey));
}

/** GET /api/admin/models?provider=: the models the server's key for that provider can use. */
async function adminModels(req, deps) {
  allowMethods(req, 'GET');
  await signedInAdmin(req, deps);
  const id = req.query?.provider;
  if (!PROVIDER_IDS.includes(id)) throw new BuddyError('bad_request', 'Unknown AI provider.');
  const { fallbackModels, label } = PROVIDERS[id];
  if (!hasKeyIn(deps)(id)) return answer({ models: fallbackModels, live: false });
  let live;
  try {
    live = await deps.providers.getProvider(id).listModels({
      apiKey: deps.adminKeys[id], fetchImpl: deps.fetchImpl, signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`[models] ${id} failed: ${err?.code || err?.name || 'error'}`);
    return answer({
      models: fallbackModels,
      live: false,
      warning: `Couldn't load the model list for the server's ${label} key. Showing the usual models.`,
    });
  }
  return live.length ? answer({ models: live, live: true }) : answer({ models: fallbackModels, live: false });
}

const iso = (date) => (date instanceof Date ? date.toISOString() : null);

function userView(user, today) {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    joined: iso(user.joined),
    lastActive: iso(user.lastActive),
    blocked: user.blocked === true,
    usedToday: user.usedDay === today ? user.usedCount : 0,
  };
}

/** GET /api/admin/users: everyone, busiest today first. POST { uid, blocked }: block or unblock one person. */
async function adminUsers(req, deps) {
  allowMethods(req, 'GET', 'POST');
  await signedInAdmin(req, deps);
  const today = dayKey(deps.now());
  if (req.method === 'GET') {
    const users = (await deps.db.listUsers({ limit: USERS_LIMIT })).map((u) => userView(u, today));
    const time = (text) => (text ? Date.parse(text) : 0);
    users.sort((a, b) => b.usedToday - a.usedToday || time(b.lastActive) - time(a.lastActive));
    return answer({ users });
  }
  const body = isPlainObject(req.body) ? req.body : {};
  if (typeof body.uid !== 'string' || !body.uid || body.uid.length > UID_MAX || typeof body.blocked !== 'boolean') {
    throw new BuddyError('bad_request', 'Pick a user to block or unblock.');
  }
  const user = await deps.db.setBlocked(body.uid, body.blocked);
  if (!user) throw new BuddyError('not_found', 'That user was not found.');
  return answer({ user: userView(user, today) });
}

/** Run a handler: a BuddyError becomes its status and { error: { code, message } }; anything else is a 500. */
async function handle(handler, req, deps) {
  try {
    return await handler(req, deps);
  } catch (err) {
    if (err instanceof BuddyError && Object.hasOwn(STATUS, err.code)) {
      return { status: STATUS[err.code], body: { error: { code: err.code, message: err.message } } };
    }
    console.error(`[api] failed: ${err?.code || err?.name || 'error'}: ${err?.message}`);
    return { status: 500, body: { error: { code: 'server', message: "Buddy's server had a problem. Try again." } } };
  }
}

module.exports = { config, ask, adminSettings, adminModels, adminUsers, handle, STATUS, ASK_TIMEOUT_MS };
```

Run: `node --test test/server-handlers.test.js` — Expected: PASS (all tests).

- [ ] **Step 9: Lint configuration and ignores**

In `eslint.config.js`, change the ignores line to:

```js
  { ignores: ['node_modules/', 'bin/', 'dist/', 'release/', 'assets/', 'art/', 'test/e2e/out/', '.*/**', 'web/node_modules/', 'web/.vercel/'] },
```

Append to `.gitignore`:

```
.vercel/
cloud.json
*-debug.log
```

Run: `npm test` — Expected: lint clean, every test passes (257 before this task, plus the new ones).

- [ ] **Step 10: Commit**

```bash
git add shared/prompts.js test/prompts.test.js tools/sync-web-shared.js web/shared web/lib test/helpers/fake-db.js \
  test/web-shared.test.js test/server-day.test.js test/server-free-config.test.js test/server-handlers.test.js \
  package.json eslint.config.js .gitignore
git commit -m "feat(server): free mode's switches, the daily count and the API handlers, tested with fakes"
```

---

### Task 2: The server on Firestore and Vercel

**Files:**
- Create: `web/package.json`, `web/package-lock.json` (from `npm install`)
- Create: `web/lib/firestore-db.js`, `web/lib/deps.js`, `web/lib/vercel.js`
- Create: `web/api/config.js`, `web/api/ask.js`, `web/api/admin/settings.js`, `web/api/admin/models.js`, `web/api/admin/users.js`
- Create: `web/vercel.json`, `web/public/index.html`, `web/firestore.rules`, `web/README.md`
- Create: `firebase.json`, `.firebaserc`
- Create: `test/server-vercel.test.js`, `test/firestore/firestore-db.test.js`
- Modify: `package.json` (scripts `test:firestore`, `deploy:server`)

**Interfaces:**
- Consumes (Task 1): `handle`, `config`, `ask`, `adminSettings`, `adminModels`, `adminUsers` from `web/lib/handlers.js`; the db interface (see Task 1).
- Produces: `createFirestoreDb(firestore)` (the db interface over a firebase-admin Firestore); `realDeps(env?)`, `adminKeysFrom(env)`; `toVercel(handler, makeDeps?) → async (req, res)`; the five routes; `npm run test:firestore`; `npm run deploy:server`.

- [ ] **Step 1: The server's package**

Create `web/package.json`:

```json
{
  "name": "buddy-server",
  "private": true,
  "version": "0.1.0",
  "description": "Buddy's server: free mode, the admin's switches and the users list (Vercel functions + Firestore).",
  "license": "UNLICENSED",
  "engines": {
    "node": "22.x"
  }
}
```

Run: `cd web && npm install firebase-admin@latest && cd ..` — Expected: `web/node_modules/firebase-admin` exists and `web/package.json` gains `"dependencies": { "firebase-admin": "^<version>" }`. Check the modular entry points load:

Run: `node -e "const r=require('node:module').createRequire(require('node:path').resolve('web/package.json')); for (const m of ['firebase-admin/app','firebase-admin/auth','firebase-admin/firestore']) r(m); console.log('ok')"` — Expected: `ok`.

- [ ] **Step 2: Write the failing tests for the Vercel wrapper and the keys**

Create `test/server-vercel.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
// The server's own copy: web/lib/handlers.js turns only ITS BuddyError (web/shared/errors.js) into a status.
const { BuddyError } = require('../web/shared/errors');
const { toVercel } = require('../web/lib/vercel');
const { adminKeysFrom } = require('../web/lib/deps');

/** Just enough of Vercel's response object. */
function fakeRes() {
  const res = { statusCode: null, headers: {}, body: undefined };
  res.setHeader = (name, value) => { res.headers[name.toLowerCase()] = value; };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('a handler answers through Vercel with its status, its JSON and no caching', async () => {
  const seen = [];
  const fn = toVercel(async (req, deps) => { seen.push([req, deps]); return { status: 201, body: { hi: 1 } }; }, () => 'DEPS');
  const res = fakeRes();
  await fn({ method: 'POST', headers: { authorization: 'Bearer t' }, body: { a: 1 }, query: { q: '1' } }, res);
  assert.deepStrictEqual([res.statusCode, res.body, res.headers['cache-control']], [201, { hi: 1 }, 'no-store']);
  assert.deepStrictEqual(seen, [[{ method: 'POST', headers: { authorization: 'Bearer t' }, body: { a: 1 }, query: { q: '1' } }, 'DEPS']]);
});

test('a body that is not valid JSON reaches the handler as no body', async () => {
  let got = 'unset';
  const fn = toVercel(async (req) => { got = req.body; return { status: 200, body: {} }; }, () => ({}));
  const req = { method: 'POST', headers: {}, query: {} };
  Object.defineProperty(req, 'body', { get() { throw new SyntaxError('Invalid JSON'); } });
  await fn(req, fakeRes());
  assert.strictEqual(got, undefined);
});

test("a handler's refusal keeps its status; a server that cannot start answers 500 in plain words", async (t) => {
  t.mock.method(console, 'error', () => {});
  const refused = toVercel(async () => { throw new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.'); }, () => ({}));
  const res = fakeRes();
  await refused({ method: 'GET', headers: {} }, res);
  assert.deepStrictEqual([res.statusCode, res.body], [403, { error: { code: 'free_off', message: 'Free AI is off. Add your own key in Settings.' } }]);

  const broken = toVercel(async () => ({ status: 200, body: {} }), () => { throw new Error('FIREBASE_SERVICE_ACCOUNT is not set'); });
  const res2 = fakeRes();
  await broken({ method: 'GET', headers: {} }, res2);
  assert.deepStrictEqual([res2.statusCode, res2.body], [500, { error: { code: 'server', message: "Buddy's server had a problem. Try again." } }]);
});

test('the server keys come from the environment, trimmed, and only the ones that are set', () => {
  assert.deepStrictEqual(adminKeysFrom({ ANTHROPIC_API_KEY: ' sk-a \n', OPENAI_API_KEY: '', GROQ_API_KEY: 'gsk' }), { anthropic: 'sk-a', groq: 'gsk' });
  assert.deepStrictEqual(adminKeysFrom({}), {});
});

test('every API route is a function', () => {
  for (const file of ['config', 'ask', 'admin/settings', 'admin/models', 'admin/users']) {
    assert.strictEqual(typeof require(`../web/api/${file}`), 'function', file);
  }
});
```

Run: `node --test test/server-vercel.test.js` — Expected: FAIL with `Cannot find module '../web/lib/vercel'`.

- [ ] **Step 3: The Firestore adapter, the real dependencies and the Vercel wrapper**

Create `web/lib/firestore-db.js`:

```js
'use strict';

/**
 * Buddy's data in Cloud Firestore, behind the methods the handlers use (web/lib/handlers.js). `firestore` is a
 * Firestore instance from firebase-admin. Dates go in as JS Dates (Firestore keeps them as timestamps) and come
 * back out as JS Dates.
 *
 *   config/free     the admin's switches
 *   users/{uid}     email, name, joined, lastActive, blocked, usedDay, usedCount
 */

function createFirestoreDb(firestore) {
  const configDoc = firestore.collection('config').doc('free');
  const users = firestore.collection('users');

  const toDate = (value) => (value && typeof value.toDate === 'function' ? value.toDate() : null);
  const fresh = ({ email, name, now }) => ({ email, name, joined: now, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });

  function fromData(uid, d) {
    return {
      uid,
      email: typeof d.email === 'string' ? d.email : '',
      name: typeof d.name === 'string' ? d.name : '',
      joined: toDate(d.joined),
      lastActive: toDate(d.lastActive),
      blocked: d.blocked === true,
      usedDay: typeof d.usedDay === 'string' ? d.usedDay : '',
      usedCount: Number.isInteger(d.usedCount) ? d.usedCount : 0,
    };
  }

  return {
    async getConfig() {
      const snap = await configDoc.get();
      return snap.exists ? snap.data() : null;
    },

    async setConfig(config) {
      await configDoc.set(config);
    },

    /** The person, added on their first call; their email and name follow their Google account. */
    async ensureUser({ uid, email, name, now }) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          const doc = fresh({ email, name, now });
          tx.set(ref, doc);
          return { uid, ...doc };
        }
        const d = snap.data();
        if (d.email !== email || d.name !== name) tx.update(ref, { email, name });
        return { ...fromData(uid, d), email, name };
      });
    },

    /**
     * Count one free request on `day`, in a transaction, so that requests made at the same moment cannot slip past
     * the limit. `limit` is null for unlimited.
     */
    async countRequest({ uid, email, name, day, now, limit }) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : fresh({ email, name, now });
        if (d.blocked === true) return { ok: false, reason: 'blocked' };
        const used = d.usedDay === day && Number.isInteger(d.usedCount) ? d.usedCount : 0;
        if (limit !== null && used >= limit) return { ok: false, reason: 'limit', usedCount: used };
        const change = { email, name, usedDay: day, usedCount: used + 1, lastActive: now };
        if (snap.exists) tx.update(ref, change);
        else tx.set(ref, { ...d, ...change });
        return { ok: true, usedCount: used + 1 };
      });
    },

    /** Give back a request the AI could not answer, if it still counts towards `day`. */
    async refundRequest({ uid, day }) {
      const ref = users.doc(uid);
      await firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return;
        const d = snap.data();
        if (d.usedDay === day && Number.isInteger(d.usedCount) && d.usedCount > 0) tx.update(ref, { usedCount: d.usedCount - 1 });
      });
    },

    /** Up to `limit` people, the most recently active first (those who never asked anything last). */
    async listUsers({ limit }) {
      const snap = await users.orderBy('lastActive', 'desc').limit(limit).get();
      return snap.docs.map((doc) => fromData(doc.id, doc.data()));
    },

    /** Block or unblock a person; null when there is nobody with that uid. */
    async setBlocked(uid, blocked) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.update(ref, { blocked });
        return { ...fromData(uid, snap.data()), blocked };
      });
    },
  };
}

module.exports = { createFirestoreDb };
```

Create `web/lib/deps.js`:

```js
'use strict';

/**
 * The handlers' real dependencies: Firebase (ID token checks and Firestore) through firebase-admin, the AI
 * providers, and the server's own keys. All from the Vercel environment:
 *
 *   FIREBASE_SERVICE_ACCOUNT    the service account's JSON key
 *   ADMIN_EMAIL                 who may use /api/admin/*
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY   any of them
 *
 * Made once per warm instance. firebase-admin is loaded only here, so the tests never need it.
 */

const { createFirestoreDb } = require('./firestore-db');

const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' };

/** The server's AI keys: { providerId: key } for each one that is set. */
function adminKeysFrom(env) {
  const keys = {};
  for (const [id, name] of Object.entries(KEY_ENV)) {
    const key = typeof env[name] === 'string' ? env[name].trim() : '';
    if (key) keys[id] = key;
  }
  return keys;
}

let deps = null;

function realDeps(env = process.env) {
  if (deps) return deps;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const auth = getAuth(app);
  deps = {
    async verifyToken(idToken) {
      const t = await auth.verifyIdToken(idToken);
      return { uid: t.uid, email: t.email || '', emailVerified: t.email_verified === true, name: t.name || '' };
    },
    db: createFirestoreDb(getFirestore(app)),
    providers: require('../shared/providers'),
    adminKeys: adminKeysFrom(env),
    adminEmail: env.ADMIN_EMAIL || '',
    now: () => new Date(),
  };
  return deps;
}

module.exports = { realDeps, adminKeysFrom };
```

Create `web/lib/vercel.js`:

```js
'use strict';

/** A handler (web/lib/handlers.js) as a Vercel function: (req, res) with Vercel's helpers. */

const { handle } = require('./handlers');

const SERVER_PROBLEM = { error: { code: 'server', message: "Buddy's server had a problem. Try again." } };

function toVercel(handler, makeDeps = () => require('./deps').realDeps()) {
  return async function vercelFunction(req, res) {
    let body;
    try {
      body = req.body; // Vercel parses a JSON body when it is first read, and throws for JSON that is not valid
    } catch {
      body = undefined;
    }
    let out;
    try {
      out = await handle(handler, { method: req.method, headers: req.headers, body, query: req.query }, makeDeps());
    } catch (err) {
      console.error(`[api] could not start: ${err?.message}`);
      out = { status: 500, body: SERVER_PROBLEM };
    }
    res.setHeader('Cache-Control', 'no-store');
    res.status(out.status).json(out.body);
  };
}

module.exports = { toVercel };
```

- [ ] **Step 4: The routes**

Create `web/api/config.js`:

```js
'use strict';

// GET /api/config: what free mode means for the signed-in person (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { config } = require('../lib/handlers');

module.exports = toVercel(config);
```

Create `web/api/ask.js`:

```js
'use strict';

// POST /api/ask: one free answer with the admin's key (web/lib/handlers.js).
const { toVercel } = require('../lib/vercel');
const { ask } = require('../lib/handlers');

module.exports = toVercel(ask);
```

Create `web/api/admin/settings.js`:

```js
'use strict';

// GET and PUT /api/admin/settings: the admin's switches (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminSettings } = require('../../lib/handlers');

module.exports = toVercel(adminSettings);
```

Create `web/api/admin/models.js`:

```js
'use strict';

// GET /api/admin/models?provider=: the models the server's key can use (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminModels } = require('../../lib/handlers');

module.exports = toVercel(adminModels);
```

Create `web/api/admin/users.js`:

```js
'use strict';

// GET /api/admin/users: the users list. POST: block or unblock one (web/lib/handlers.js).
const { toVercel } = require('../../lib/vercel');
const { adminUsers } = require('../../lib/handlers');

module.exports = toVercel(adminUsers);
```

Run: `node --test test/server-vercel.test.js` — Expected: PASS.

- [ ] **Step 5: Vercel and Firebase configuration**

Create `web/vercel.json`:

```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "outputDirectory": "public",
  "functions": {
    "api/ask.js": { "maxDuration": 60 }
  },
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "no-referrer" }
      ]
    }
  ]
}
```

Create `web/public/index.html`:

```html
<!doctype html>
<meta charset="utf-8">
<title>Buddy</title>
<p>Buddy's server. The Buddy app talks to it; there is nothing to see here.</p>
```

Create `web/firestore.rules`:

```
rules_version = '2';

// Only Buddy's server reads and writes this database, with the Admin SDK, which these rules do not apply to.
// Apps and browsers get nothing.
service cloud.firestore {
  match /databases/{database}/documents {
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

Create `firebase.json` (repo root):

```json
{
  "firestore": {
    "rules": "web/firestore.rules"
  },
  "emulators": {
    "firestore": { "host": "127.0.0.1", "port": 8085 },
    "ui": { "enabled": false },
    "singleProjectMode": true
  }
}
```

Create `.firebaserc` (repo root):

```json
{
  "projects": {
    "default": "buddy-7f8c2"
  }
}
```

In `package.json` add to `"scripts"`:

```json
    "test:firestore": "firebase emulators:exec --only firestore --project demo-buddy \"node --test 'test/firestore/*.test.js'\"",
    "deploy:server": "npm run sync:web && vercel deploy --prod --cwd web",
```

- [ ] **Step 6: Write the emulator test for the Firestore adapter**

Create `test/firestore/firestore-db.test.js`:

```js
'use strict';

// Runs against the Firestore emulator: `npm run test:firestore` starts it (firebase emulators:exec) and sets
// FIRESTORE_EMULATOR_HOST. The same expectations as the in-memory fake in test/helpers/fake-db.js.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createRequire } = require('node:module');
const { createFirestoreDb } = require('../../web/lib/firestore-db');

const webRequire = createRequire(path.join(__dirname, '..', '..', 'web', 'package.json'));
const { initializeApp, deleteApp } = webRequire('firebase-admin/app');
const { getFirestore } = webRequire('firebase-admin/firestore');

const PROJECT = 'demo-buddy';
assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'run this with `npm run test:firestore`, which starts the emulator');

const app = initializeApp({ projectId: PROJECT });
const db = createFirestoreDb(getFirestore(app));

const NOW = new Date('2026-10-07T06:30:00.000Z');
const LATER = new Date('2026-10-07T07:00:00.000Z');
const TODAY = '2026-10-07';
const count = (extra = {}) => db.countRequest({ uid: 'u1', email: 'a@x.com', name: 'A', day: TODAY, now: NOW, limit: null, ...extra });

test.beforeEach(async () => {
  // The emulator's own way to wipe a project's data.
  const url = `http://${process.env.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`;
  const res = await fetch(url, { method: 'DELETE' });
  assert.ok(res.ok, 'the emulator cleared its data');
});

test.after(() => deleteApp(app));

test('no config yet reads as null; a saved one reads back as saved', async () => {
  assert.strictEqual(await db.getConfig(), null);
  const cfg = { enabled: true, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'm' };
  await db.setConfig(cfg);
  assert.deepStrictEqual(await db.getConfig(), cfg);
});

test('ensureUser adds a person once and follows their email and name', async () => {
  const first = await db.ensureUser({ uid: 'u1', email: 'a@x.com', name: 'A', now: NOW });
  assert.deepStrictEqual(first, { uid: 'u1', email: 'a@x.com', name: 'A', joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });
  const again = await db.ensureUser({ uid: 'u1', email: 'b@x.com', name: 'B', now: LATER });
  assert.deepStrictEqual(again, { ...first, email: 'b@x.com', name: 'B' }, 'joined stays the first day');
  const [stored] = await db.listUsers({ limit: 10 });
  assert.deepStrictEqual([stored.email, stored.name], ['b@x.com', 'B']);
});

test('countRequest counts up to the limit, and a new day starts again from zero', async () => {
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: true, usedCount: 1 }, 'the first request adds the person too');
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: true, usedCount: 2 });
  assert.deepStrictEqual(await count({ limit: 2 }), { ok: false, reason: 'limit', usedCount: 2 });
  assert.deepStrictEqual(await count({ limit: 2, day: '2026-10-08' }), { ok: true, usedCount: 1 });
  assert.deepStrictEqual(await count({ day: '2026-10-08' }), { ok: true, usedCount: 2 }, 'unlimited still counts');
  const [u] = await db.listUsers({ limit: 10 });
  assert.deepStrictEqual([u.usedDay, u.usedCount, u.lastActive], ['2026-10-08', 2, NOW]);
});

test('requests made at the same moment cannot slip past the limit', async () => {
  const results = await Promise.all(Array.from({ length: 4 }, () => count({ limit: 2 })));
  assert.strictEqual(results.filter((r) => r.ok).length, 2);
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 2);
});

test('refundRequest gives back one request of the same day only', async () => {
  await count();
  await count();
  await db.refundRequest({ uid: 'u1', day: TODAY });
  await db.refundRequest({ uid: 'u1', day: '2026-10-06' });
  await db.refundRequest({ uid: 'nobody', day: TODAY });
  const [u] = await db.listUsers({ limit: 10 });
  assert.strictEqual(u.usedCount, 1);
});

test('a blocked person is not counted; setBlocked answers the person, or null for nobody', async () => {
  await db.ensureUser({ uid: 'u1', email: 'a@x.com', name: 'A', now: NOW });
  assert.strictEqual((await db.setBlocked('u1', true)).blocked, true);
  assert.deepStrictEqual(await count(), { ok: false, reason: 'blocked' });
  assert.strictEqual((await db.setBlocked('u1', false)).blocked, false);
  assert.strictEqual(await db.setBlocked('nobody', true), null);
});

test('listUsers: the most recently active first, those who never asked last, up to the limit', async () => {
  await db.ensureUser({ uid: 'never', email: 'n@x.com', name: 'N', now: NOW });
  await db.countRequest({ uid: 'early', email: 'e@x.com', name: 'E', day: TODAY, now: NOW, limit: null });
  await db.countRequest({ uid: 'late', email: 'l@x.com', name: 'L', day: TODAY, now: LATER, limit: null });
  assert.deepStrictEqual((await db.listUsers({ limit: 10 })).map((u) => u.uid), ['late', 'early', 'never']);
  assert.deepStrictEqual((await db.listUsers({ limit: 2 })).map((u) => u.uid), ['late', 'early']);
});
```

Run: `npm run test:firestore` — Expected: the emulator starts (the first run downloads it), all 7 tests PASS, the emulator stops. If the concurrent-requests test fails with an `ABORTED`/contention error rather than a wrong count, run it twice more; if it is flaky, pass `{ maxAttempts: 10 }` as the second argument of `runTransaction` in `countRequest` and say so in the report.

- [ ] **Step 7: Check that Vercel builds the functions**

Run: `cd web && vercel build --yes 2>&1 | tail -20; cd ..` — Expected: the build succeeds and `web/.vercel/output/functions/api/` holds `config.func`, `ask.func` and `admin/{settings,models,users}.func`. If `vercel build` asks to link a project first, skip this step (Task 7 links and deploys) and say so in the report. `web/.vercel/` is ignored by git.

- [ ] **Step 8: The server's README**

Create `web/README.md`:

````markdown
# Buddy's server

Vercel functions that give Buddy its free mode: the admin's switches and the users live in Cloud Firestore
(project `buddy-7f8c2`), and free answers use the server's own AI key. Design:
`docs/superpowers/specs/2026-10-07-buddy-phase-2-free-mode-design.md`.

| Route | Who | What |
|---|---|---|
| `GET /api/config` | signed in | what free mode means for this person |
| `POST /api/ask` | signed in | one free answer |
| `GET, PUT /api/admin/settings` | admin | the switches |
| `GET /api/admin/models?provider=` | admin | the models the server's key can use |
| `GET, POST /api/admin/users` | admin | the users list; block or unblock |

`web/shared/` is a copy of the app's `shared/` (prompts, providers, errors). Change `shared/`, then run
`npm run sync:web` at the repository root; `npm test` fails while the copy is stale.

## Environment (Vercel → Settings → Environment Variables, Production)

- `FIREBASE_SERVICE_ACCOUNT` — the JSON key of the project's `firebase-adminsdk` service account
- `ADMIN_EMAIL` — `akshatg9636@gmail.com`
- any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` — the admin's AI keys

## Tests

    npm test                  # the handlers with fakes (from the repository root)
    npm run test:firestore    # the Firestore adapter against the emulator (needs Java)

## Deploy

    npm run deploy:server     # from the repository root: sync web/shared, then vercel deploy --prod

The database rules (`web/firestore.rules`, deny everything to clients) are deployed with
`firebase deploy --only firestore:rules`.
````

- [ ] **Step 9: Run everything and commit**

Run: `npm test` — Expected: lint clean, all tests pass.

```bash
git add web/package.json web/package-lock.json web/lib/firestore-db.js web/lib/deps.js web/lib/vercel.js web/api \
  web/vercel.json web/public web/firestore.rules web/README.md firebase.json .firebaserc \
  test/server-vercel.test.js test/firestore package.json
git commit -m "feat(server): Firestore storage, the Vercel routes, and the database rules"
```

---
### Task 3: Sign-in with Google, and the account (app)

**Files:**
- Create: `cloud.example.json`
- Create: `src/main/cloud-config.js`, `src/main/google-signin.js`, `src/main/account.js`
- Create: `test/cloud-config.test.js`, `test/google-signin.test.js`, `test/account.test.js`

**Interfaces:**
- Consumes: `shared/errors` `BuddyError`; `src/main/store.js` `writeAtomic(file, text, mode)`.
- Produces:
  - `src/main/cloud-config.js`: `loadCloudConfig(file?) → { serverUrl, firebaseApiKey, googleClientId, googleClientSecret } | null`; `notSetUp() → BuddyError('not_set_up', "This copy of Buddy isn't set up for sign-in.")`; `FIELDS`; `FILE` (the repo/app root `cloud.json`).
  - `src/main/google-signin.js`: `signInWithGoogle({ config, openBrowser, fetchImpl?, waitMs?, signal? }) → { idToken, refreshToken, expiresIn, uid, email, name }`; `refreshIdToken({ refreshToken, config, fetchImpl? }) → { idToken, refreshToken, expiresIn }` (throws `signed_out` when Firebase no longer takes the refresh token); `listenForCode`, `makePkce`, `authUrl` (exported for tests).
  - `src/main/account.js`: `createAccount({ file, safeStorage, config, openBrowser, fetchImpl?, now?, signInWithGoogle?, refreshIdToken? })` → `{ isSignedIn(), user() → { uid, email, name } | null, signIn() → user, signOut(), idToken({ force }?) → string, onChange(fn) }`; `RENEW_EARLY_MS` (5 minutes). Errors: `signed_out`, `not_set_up`, `no_keychain`, `sign_in_cancelled`, `sign_in_failed`, `sign_in_timeout`, `network`, `timeout`, `auth_failed`.

- [ ] **Step 1: The example of cloud.json**

Create `cloud.example.json`:

```json
{
  "serverUrl": "https://buddy-server.vercel.app",
  "firebaseApiKey": "AIza... (Firebase console: Project settings, General, Web API key)",
  "googleClientId": "....apps.googleusercontent.com (Google Cloud console: Credentials, OAuth client of type Desktop app)",
  "googleClientSecret": "GOCSPX-... (the same OAuth client)"
}
```

(`cloud.json` itself is in `.gitignore` since Task 1.)

- [ ] **Step 2: Write the failing tests for cloud.json**

Create `test/cloud-config.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadCloudConfig, notSetUp, FIELDS } = require('../src/main/cloud-config');

const GOOD = {
  serverUrl: 'https://buddy-server.vercel.app/',
  firebaseApiKey: ' AIza-key ',
  googleClientId: 'id.apps.googleusercontent.com',
  googleClientSecret: 'GOCSPX-secret',
};

/** A cloud.json holding `data` (text as it is, anything else as JSON; nothing at all for undefined) in a temp folder. */
function write(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-cloud-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'cloud.json');
  if (data !== undefined) fs.writeFileSync(file, typeof data === 'string' ? data : JSON.stringify(data));
  return file;
}

test('reads the four values, trimmed, with the server as a bare origin', (t) => {
  assert.deepStrictEqual(FIELDS, ['serverUrl', 'firebaseApiKey', 'googleClientId', 'googleClientSecret']);
  assert.deepStrictEqual(loadCloudConfig(write(t, GOOD)), {
    serverUrl: 'https://buddy-server.vercel.app',
    firebaseApiKey: 'AIza-key',
    googleClientId: 'id.apps.googleusercontent.com',
    googleClientSecret: 'GOCSPX-secret',
  });
});

test('no file, a damaged one, or one with a value missing: not set up', (t) => {
  assert.strictEqual(loadCloudConfig(write(t)), null);
  assert.strictEqual(loadCloudConfig(write(t, '{ not json')), null);
  assert.strictEqual(loadCloudConfig(write(t, '[]')), null);
  for (const name of FIELDS) {
    assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, [name]: '  ' })), null, name);
  }
});

test('the server must be https, except on this Mac, for trying the server locally', (t) => {
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://buddy.example.com' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'not a url' })), null);
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://localhost:3000' })).serverUrl, 'http://localhost:3000');
  assert.strictEqual(loadCloudConfig(write(t, { ...GOOD, serverUrl: 'http://127.0.0.1:3000/x' })).serverUrl, 'http://127.0.0.1:3000');
});

test('without it, Buddy says this copy is not set up for sign-in', () => {
  const err = notSetUp();
  assert.strictEqual(err.code, 'not_set_up');
  assert.strictEqual(err.message, "This copy of Buddy isn't set up for sign-in.");
});
```

Run: `node --test test/cloud-config.test.js` — Expected: FAIL with `Cannot find module '../src/main/cloud-config'`.

- [ ] **Step 3: Write cloud-config.js**

Create `src/main/cloud-config.js`:

```js
'use strict';

/**
 * Where Buddy's server is, and what Google sign-in needs: cloud.json at the app's root. It is not in git
 * (cloud.example.json shows its shape); the build packs it into the app. Without it Buddy cannot sign in.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../shared/errors');

const FILE = path.join(__dirname, '..', '..', 'cloud.json');
const FIELDS = ['serverUrl', 'firebaseApiKey', 'googleClientId', 'googleClientSecret'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** The four values, or null when the file is missing, damaged or incomplete, or the server is not https. */
function loadCloudConfig(file = FILE) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!FIELDS.every((name) => typeof data[name] === 'string' && data[name].trim())) return null;
  let url;
  try {
    url = new URL(data.serverUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))) return null;
  return {
    serverUrl: url.origin,
    firebaseApiKey: data.firebaseApiKey.trim(),
    googleClientId: data.googleClientId.trim(),
    googleClientSecret: data.googleClientSecret.trim(),
  };
}

const notSetUp = () => new BuddyError('not_set_up', "This copy of Buddy isn't set up for sign-in.");

module.exports = { loadCloudConfig, notSetUp, FIELDS, FILE };
```

Run: `node --test test/cloud-config.test.js` — Expected: PASS.

- [ ] **Step 4: Write the failing tests for Google sign-in**

Create `test/google-signin.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const { signInWithGoogle, refreshIdToken, listenForCode, makePkce, authUrl } = require('../src/main/google-signin');

const CONFIG = { serverUrl: 'https://s.example', firebaseApiKey: 'fb-key', googleClientId: 'client-id', googleClientSecret: 'client-secret' };
const GOOGLE_TOKEN = 'https://oauth2.googleapis.com/token';
const FIREBASE_IDP = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const FIREBASE_REFRESH = 'https://securetoken.googleapis.com/v1/token';
const FIREBASE_ANSWER = { idToken: 'fb-id', refreshToken: 'fb-refresh', expiresIn: '3600', localId: 'uid-1', email: 'rahul@gmail.com', displayName: 'Rahul' };

/** A fetch for Google's endpoints: `routes` maps origin + path to { status, body }, or to a function of (url, init). */
function googleFetch(routes) {
  async function fetchImpl(url, init = {}) {
    const u = new URL(url);
    const route = routes[`${u.origin}${u.pathname}`];
    if (!route) throw new TypeError('fetch failed');
    const { status = 200, body } = typeof route === 'function' ? route(u, init) : route;
    return { ok: status >= 200 && status < 300, status, json: async () => body };
  }
  return fetchImpl;
}

/** What the person's browser does once they have picked their account: Google sends it back to Buddy's port. */
function browserThatSignsIn(seen = {}) {
  return async (url) => {
    const u = new URL(url);
    seen.challenge = u.searchParams.get('code_challenge');
    seen.redirect = u.searchParams.get('redirect_uri');
    const back = new URL(seen.redirect);
    back.search = new URLSearchParams({ state: u.searchParams.get('state'), code: 'the-code' }).toString();
    setImmediate(() => fetch(back).then((r) => r.text()));
  };
}

test('PKCE: a fresh verifier each time, and the challenge is its SHA-256', () => {
  const a = makePkce();
  const b = makePkce();
  assert.notStrictEqual(a.verifier, b.verifier);
  assert.match(a.verifier, /^[A-Za-z0-9_-]{43}$/);
  assert.strictEqual(a.challenge, crypto.createHash('sha256').update(a.verifier).digest('base64url'));
});

test("Google's page is asked for the person's email and name, with the challenge and the state", () => {
  const u = new URL(authUrl({ clientId: 'client-id', redirectUri: 'http://127.0.0.1:5000', challenge: 'ch', state: 'st' }));
  assert.strictEqual(`${u.origin}${u.pathname}`, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.deepStrictEqual(Object.fromEntries(u.searchParams), {
    client_id: 'client-id',
    redirect_uri: 'http://127.0.0.1:5000',
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: 'ch',
    code_challenge_method: 'S256',
    state: 'st',
    prompt: 'select_account',
  });
});

test('the listener takes the code for its own state only, then closes', async () => {
  const listening = await listenForCode({ state: 'st' });
  assert.match(listening.redirectUri, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.strictEqual((await fetch(`${listening.redirectUri}/?state=other&code=nope`)).status, 404);
  assert.strictEqual((await fetch(`${listening.redirectUri}/favicon.ico`)).status, 404);
  const page = await fetch(`${listening.redirectUri}/?state=st&code=the-code`);
  assert.strictEqual(page.status, 200);
  assert.match(await page.text(), /You're signed in to Buddy/);
  assert.strictEqual(await listening.code, 'the-code');
  await assert.rejects(fetch(`${listening.redirectUri}/?state=st&code=again`), 'nothing listens any more');
});

test("cancelling on Google's page, waiting too long, aborting or stopping ends the wait", async () => {
  const cancelled = await listenForCode({ state: 'st' });
  const page = await fetch(`${cancelled.redirectUri}/?state=st&error=access_denied`);
  assert.match(await page.text(), /Sign-in did not finish/);
  await assert.rejects(cancelled.code, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });

  const slow = await listenForCode({ state: 'st', waitMs: 20 });
  await assert.rejects(slow.code, { code: 'sign_in_timeout', message: 'Sign-in took too long. Try again.' });

  const controller = new AbortController();
  const aborted = await listenForCode({ state: 'st', signal: controller.signal });
  controller.abort();
  await assert.rejects(aborted.code, { code: 'sign_in_cancelled' });

  const stopped = await listenForCode({ state: 'st' });
  stopped.stop();
  await assert.rejects(stopped.code, { code: 'sign_in_cancelled' });
});

test('the whole sign-in: the browser, the code, Google, then Firebase', async () => {
  const seen = {};
  const fetchImpl = googleFetch({
    [GOOGLE_TOKEN]: (u, init) => {
      seen.tokenType = init.headers['content-type'];
      seen.form = Object.fromEntries(new URLSearchParams(init.body));
      return { body: { id_token: 'google-id', access_token: 'a' } };
    },
    [FIREBASE_IDP]: (u, init) => {
      seen.idp = { key: u.searchParams.get('key'), body: JSON.parse(init.body) };
      return { body: FIREBASE_ANSWER };
    },
  });
  const result = await signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(seen), fetchImpl });
  assert.deepStrictEqual(result, {
    idToken: 'fb-id', refreshToken: 'fb-refresh', expiresIn: 3600, uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul',
  });
  assert.strictEqual(seen.tokenType, 'application/x-www-form-urlencoded');
  const { code_verifier: verifier, redirect_uri: redirect, ...rest } = seen.form;
  assert.deepStrictEqual(rest, { code: 'the-code', client_id: 'client-id', client_secret: 'client-secret', grant_type: 'authorization_code' });
  assert.strictEqual(redirect, seen.redirect);
  assert.strictEqual(crypto.createHash('sha256').update(verifier).digest('base64url'), seen.challenge, 'the verifier matches the challenge');
  assert.deepStrictEqual(seen.idp, {
    key: 'fb-key',
    body: { postBody: 'id_token=google-id&providerId=google.com', requestUri: 'http://localhost', returnSecureToken: true, returnIdpCredential: true },
  });
});

test('Google or Firebase turning the sign-in down, or no internet, ends it in plain words', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const refused = googleFetch({ [GOOGLE_TOKEN]: { status: 400, body: { error: 'invalid_grant' } } });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: refused }),
    { code: 'sign_in_failed', message: "Google didn't sign you in. Try again." });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: googleFetch({}) }),
    { code: 'network', message: "Couldn't reach Google. Check your internet." });
  const noFirebase = googleFetch({
    [GOOGLE_TOKEN]: { body: { id_token: 'g' } },
    [FIREBASE_IDP]: { status: 400, body: { error: { message: 'INVALID_IDP_RESPONSE' } } },
  });
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl: noFirebase }), { code: 'sign_in_failed' });
});

test('a browser that cannot be opened ends the sign-in, and the port is let go', async () => {
  let redirect = null;
  const openBrowser = async (url) => {
    redirect = new URL(url).searchParams.get('redirect_uri');
    throw new Error('no browser');
  };
  await assert.rejects(signInWithGoogle({ config: CONFIG, openBrowser, fetchImpl: googleFetch({}) }),
    { code: 'sign_in_failed', message: "Couldn't open your browser to sign in." });
  await assert.rejects(fetch(`${redirect}/?state=x&code=y`), 'nothing listens any more');
});

test('refresh: a new ID token, and the refresh token Firebase may have rotated', async () => {
  let seen = null;
  const fetchImpl = googleFetch({
    [FIREBASE_REFRESH]: (u, init) => {
      seen = { key: u.searchParams.get('key'), ...Object.fromEntries(new URLSearchParams(init.body)) };
      return { body: { id_token: 'new-id', refresh_token: 'new-refresh', expires_in: '3600', user_id: 'uid-1' } };
    },
  });
  assert.deepStrictEqual(await refreshIdToken({ refreshToken: 'old-refresh', config: CONFIG, fetchImpl }),
    { idToken: 'new-id', refreshToken: 'new-refresh', expiresIn: 3600 });
  assert.deepStrictEqual(seen, { key: 'fb-key', grant_type: 'refresh_token', refresh_token: 'old-refresh' });
});

test('refresh: a refresh token Firebase no longer takes means signed out; other failures do not', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const answer = (status, message) => googleFetch({ [FIREBASE_REFRESH]: { status, body: { error: { code: status, message } } } });
  for (const reason of ['INVALID_REFRESH_TOKEN', 'TOKEN_EXPIRED', 'USER_DISABLED', 'USER_NOT_FOUND']) {
    await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: answer(400, reason) }),
      { code: 'signed_out', message: 'Sign in to use Buddy.' }, reason);
  }
  await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: answer(503, 'UNAVAILABLE') }),
    { code: 'auth_failed', message: "Couldn't check your sign-in. Try again." });
  await assert.rejects(refreshIdToken({ refreshToken: 'r', config: CONFIG, fetchImpl: googleFetch({}) }), { code: 'network' });
});
```

Run: `node --test test/google-signin.test.js` — Expected: FAIL with `Cannot find module '../src/main/google-signin'`.

- [ ] **Step 5: Write google-signin.js**

Create `src/main/google-signin.js`:

```js
'use strict';

/**
 * Sign in with Google the way Google asks desktop apps to (OAuth 2.0 for installed apps): Buddy listens once on
 * 127.0.0.1, opens Google's sign-in page in the person's browser, and gets the answer back on that port
 * (authorization code + PKCE). The Google ID token then signs in to Firebase Authentication, which gives Buddy the
 * ID token its server checks, and a refresh token to renew it with.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const { BuddyError } = require('../../shared/errors');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';
const WAIT_MS = 5 * 60_000; // how long Buddy waits for the person to finish on Google's page
const CALL_TIMEOUT_MS = 30_000;

// Answers of the refresh endpoint that mean the sign-in is over: the person has to sign in again.
const SIGNED_OUT_REASONS = /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN|PROJECT_NUMBER_MISMATCH/;

const failed = () => new BuddyError('sign_in_failed', "Google didn't sign you in. Try again.");
const cancelled = () => new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.');
const signedOut = () => new BuddyError('signed_out', 'Sign in to use Buddy.');
const authFailed = () => new BuddyError('auth_failed', "Couldn't check your sign-in. Try again.");

const page = (title, text) => '<!doctype html><meta charset="utf-8">'
  + `<title>${title}</title><body style="font:16px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:72px 24px">`
  + `<h1 style="font-size:24px">${title}</h1><p>${text}</p></body>`;
const DONE_PAGE = page("You're signed in to Buddy", 'You can close this tab and go back to Buddy.');
const FAILED_PAGE = page('Sign-in did not finish', 'Go back to Buddy and try again.');

/** A PKCE pair: the verifier Buddy keeps, and the challenge that goes to Google. */
function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

/**
 * Listen once on 127.0.0.1, on a port the system picks, for Google's answer to the sign-in with this `state`.
 * Resolves { redirectUri, code, stop } as soon as it listens: `code` is a promise of the authorization code, which
 * rejects when the person cancels on Google's page, after `waitMs`, when `signal` aborts, or on stop(). Anything
 * else that reaches the port gets a 404, and the wait goes on.
 */
function listenForCode({ state, waitMs = WAIT_MS, signal }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let settle = () => {};
    const code = new Promise((ok, fail) => {
      settle = (err, value) => (err ? fail(err) : ok(value));
    });
    code.catch(() => {}); // the caller awaits it later; an early failure is not "unhandled" meanwhile

    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://127.0.0.1');
      if (done || url.pathname !== '/' || url.searchParams.get('state') !== state) {
        res.writeHead(404, { 'content-type': 'text/plain', connection: 'close' }).end('Not found');
        return; // a favicon request or a stray visitor: keep waiting for Google
      }
      const got = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(got ? DONE_PAGE : FAILED_PAGE);
      finish(got ? null : cancelled(), got);
    });
    const timer = setTimeout(() => finish(new BuddyError('sign_in_timeout', 'Sign-in took too long. Try again.')), waitMs);
    const onAbort = () => finish(cancelled());

    function finish(err, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      server.close();
      settle(err, value);
    }

    server.once('error', () => {
      finish(failed());
      reject(new BuddyError('sign_in_failed', "Couldn't start signing in. Try again."));
    });
    server.listen(0, '127.0.0.1', () => {
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
      resolve({ redirectUri: `http://127.0.0.1:${server.address().port}`, code, stop: () => finish(cancelled()) });
    });
  });
}

/** POST to Google or Firebase; answers the JSON. No connection is `network`; any other failure is `onFail(reason)`. */
async function post({ fetchImpl, url, form, json, onFail }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form).toString() : JSON.stringify(json),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new BuddyError('timeout', 'Google took too long to answer. Try again.');
    throw new BuddyError('network', "Couldn't reach Google. Check your internet.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: judged by the status below
  }
  if (!res.ok) {
    // The log gets where and the status, never a token.
    console.warn(`[buddy] sign-in: ${new URL(url).hostname} answered ${res.status}`);
    throw onFail(String(body?.error?.message || body?.error || ''));
  }
  return body && typeof body === 'object' ? body : {};
}

async function exchangeCode({ code, verifier, redirectUri, config, fetchImpl }) {
  const body = await post({
    fetchImpl,
    url: TOKEN_URL,
    onFail: failed,
    form: {
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
  });
  if (typeof body.id_token !== 'string' || !body.id_token) throw failed();
  return body.id_token;
}

async function firebaseSignIn({ googleIdToken, config, fetchImpl }) {
  const body = await post({
    fetchImpl,
    url: `${IDP_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`,
    onFail: failed,
    json: {
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    },
  });
  if (!body.idToken || !body.refreshToken || !body.localId) throw failed();
  return {
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresIn: Number(body.expiresIn) || 3600,
    uid: body.localId,
    email: body.email || '',
    name: body.displayName || body.fullName || '',
  };
}

/**
 * The whole sign-in. `openBrowser(url)` opens Google's page (shell.openExternal in the app); `signal` cancels it.
 * Resolves { idToken, refreshToken, expiresIn, uid, email, name }.
 */
async function signInWithGoogle({ config, openBrowser, fetchImpl = fetch, waitMs, signal }) {
  const { verifier, challenge } = makePkce();
  const state = crypto.randomBytes(16).toString('base64url');
  const listening = await listenForCode({ state, waitMs, signal });
  try {
    await openBrowser(authUrl({ clientId: config.googleClientId, redirectUri: listening.redirectUri, challenge, state }));
  } catch {
    listening.stop();
    throw new BuddyError('sign_in_failed', "Couldn't open your browser to sign in.");
  }
  const code = await listening.code;
  const googleIdToken = await exchangeCode({ code, verifier, redirectUri: listening.redirectUri, config, fetchImpl });
  return firebaseSignIn({ googleIdToken, config, fetchImpl });
}

/** A new ID token for a refresh token. One Firebase no longer takes means the person is signed out. */
async function refreshIdToken({ refreshToken, config, fetchImpl = fetch }) {
  const body = await post({
    fetchImpl,
    url: `${REFRESH_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`,
    form: { grant_type: 'refresh_token', refresh_token: refreshToken },
    onFail: (reason) => (SIGNED_OUT_REASONS.test(reason) ? signedOut() : authFailed()),
  });
  if (!body.id_token || !body.refresh_token) throw authFailed();
  return { idToken: body.id_token, refreshToken: body.refresh_token, expiresIn: Number(body.expires_in) || 3600 };
}

module.exports = { signInWithGoogle, refreshIdToken, listenForCode, makePkce, authUrl };
```

Run: `node --test test/google-signin.test.js` — Expected: PASS.

- [ ] **Step 6: Write the failing tests for the account**

Create `test/account.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BuddyError } = require('../shared/errors');
const { createAccount, RENEW_EARLY_MS } = require('../src/main/account');

const CONFIG = { serverUrl: 'https://s.example', firebaseApiKey: 'k', googleClientId: 'c', googleClientSecret: 's' };
const HOUR = 3600;
const SIGNED_IN = { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: HOUR, uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' };

/** safeStorage as Electron's, with "enc:" in place of real encryption. */
function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`),
    decryptString(buffer) {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return text.slice(4);
    },
  };
}

/**
 * createAccount on `file` (a new temp folder's account.json when none is given), with a clock the test moves
 * (clock.t, in ms) and fakes for Google: `signInWith(options)` and `refreshWith(options, n)` decide the answers.
 */
function setup(t, { file, config = CONFIG, safeStorage = fakeSafeStorage(), signInWith, refreshWith } = {}) {
  let accountFile = file;
  if (!accountFile) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-account-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    accountFile = path.join(dir, 'account.json');
  }
  const clock = { t: 1_000_000 };
  const signIns = [];
  const refreshes = [];
  let changes = 0;
  const account = createAccount({
    file: accountFile,
    safeStorage,
    config,
    openBrowser: async () => {},
    now: () => clock.t,
    async signInWithGoogle(options) {
      signIns.push(options);
      return signInWith ? signInWith(options) : SIGNED_IN;
    },
    async refreshIdToken(options) {
      refreshes.push(options);
      return refreshWith
        ? refreshWith(options, refreshes.length)
        : { idToken: `id-r${refreshes.length}`, refreshToken: options.refreshToken, expiresIn: HOUR };
    },
  });
  account.onChange(() => { changes += 1; });
  return { account, file: accountFile, clock, signIns, refreshes, changes: () => changes };
}

test('signed out at first: no user, and no token for the server', async (t) => {
  const s = setup(t);
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(s.account.user(), null);
  await assert.rejects(s.account.idToken(), { code: 'signed_out', message: 'Sign in to use Buddy.' });
});

test('signing in keeps the account, with the refresh token encrypted, and says so', async (t) => {
  const s = setup(t);
  assert.deepStrictEqual(await s.account.signIn(), { uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' });
  assert.strictEqual(s.account.isSignedIn(), true);
  assert.strictEqual(s.changes(), 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(s.file, 'utf8')), {
    uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul', refreshToken: Buffer.from('enc:refresh-1').toString('base64'),
  });
  assert.strictEqual(fs.statSync(s.file).mode & 0o777, 0o600);
  assert.strictEqual(await s.account.idToken(), 'id-1', 'the fresh token, with no refresh');
  assert.strictEqual(s.refreshes.length, 0);
  assert.strictEqual(s.signIns[0].config, CONFIG);
  assert.ok(s.signIns[0].signal instanceof AbortSignal);
});

test('the token is renewed five minutes before it runs out, and not before', async (t) => {
  const s = setup(t);
  await s.account.signIn();
  s.clock.t += HOUR * 1000 - RENEW_EARLY_MS - 1;
  assert.strictEqual(await s.account.idToken(), 'id-1');
  s.clock.t += 2;
  assert.strictEqual(await s.account.idToken(), 'id-r1');
  assert.strictEqual(s.refreshes[0].refreshToken, 'refresh-1');
  assert.strictEqual(RENEW_EARLY_MS, 5 * 60_000);
});

test('after a restart the person is still signed in, and the first token is renewed from the kept one', async (t) => {
  const first = setup(t);
  await first.account.signIn();
  const again = setup(t, { file: first.file });
  assert.deepStrictEqual(again.account.user(), { uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' });
  assert.strictEqual(await again.account.idToken(), 'id-r1');
  assert.strictEqual(again.refreshes[0].refreshToken, 'refresh-1');
});

test('a rotated refresh token is kept; two calls at once share one renewal; force renews a fresh token', async (t) => {
  const s = setup(t, { refreshWith: (options, n) => ({ idToken: `id-r${n}`, refreshToken: `refresh-r${n}`, expiresIn: HOUR }) });
  await s.account.signIn();
  const both = await Promise.all([s.account.idToken({ force: true }), s.account.idToken({ force: true })]);
  assert.deepStrictEqual(both, ['id-r1', 'id-r1']);
  assert.strictEqual(s.refreshes.length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(s.file, 'utf8')).refreshToken, Buffer.from('enc:refresh-r1').toString('base64'));
  assert.strictEqual(await s.account.idToken({ force: true }), 'id-r2');
  assert.strictEqual(s.refreshes[1].refreshToken, 'refresh-r1');
});

test('a refresh token Firebase no longer takes signs the person out', async (t) => {
  const s = setup(t, { refreshWith: () => { throw new BuddyError('signed_out', 'Sign in to use Buddy.'); } });
  await s.account.signIn();
  await assert.rejects(s.account.idToken({ force: true }), { code: 'signed_out' });
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
  assert.strictEqual(s.changes(), 2, 'signed in, then out');
});

test('no internet while renewing keeps the person signed in', async (t) => {
  const s = setup(t, { refreshWith: () => { throw new BuddyError('network', "Couldn't reach Google. Check your internet."); } });
  await s.account.signIn();
  await assert.rejects(s.account.idToken({ force: true }), { code: 'network' });
  assert.strictEqual(s.account.isSignedIn(), true);
  assert.ok(fs.existsSync(s.file));
});

test('a kept token the keychain can no longer read means signing in again', async (t) => {
  const first = setup(t);
  await first.account.signIn();
  const stored = JSON.parse(fs.readFileSync(first.file, 'utf8'));
  fs.writeFileSync(first.file, JSON.stringify({ ...stored, refreshToken: Buffer.from('garbage').toString('base64') }));
  const again = setup(t, { file: first.file });
  await assert.rejects(again.account.idToken(), { code: 'signed_out' });
  assert.strictEqual(again.account.isSignedIn(), false);
  assert.strictEqual(again.refreshes.length, 0);
});

test('a damaged or incomplete account file is no account', (t) => {
  const s = setup(t);
  for (const text of ['{ nope', '[]', JSON.stringify({ uid: 'u', email: 'e', name: 'n' }), JSON.stringify({ uid: '', email: 'e', name: 'n', refreshToken: 'r' })]) {
    fs.writeFileSync(s.file, text);
    assert.strictEqual(setup(t, { file: s.file }).account.isSignedIn(), false, text);
  }
});

test('signing out forgets the account and says so; signing out again changes nothing', async (t) => {
  const s = setup(t);
  await s.account.signIn();
  s.account.signOut();
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
  assert.strictEqual(s.changes(), 2);
  s.account.signOut();
  assert.strictEqual(s.changes(), 2);
});

test('signing out while a token is being renewed: the renewed token is thrown away', async (t) => {
  let release = null;
  const s = setup(t, {
    refreshWith: () => new Promise((resolve) => {
      release = () => resolve({ idToken: 'late', refreshToken: 'late-refresh', expiresIn: HOUR });
    }),
  });
  await s.account.signIn();
  const pending = s.account.idToken({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  s.account.signOut();
  release();
  await assert.rejects(pending, { code: 'signed_out' });
  assert.strictEqual(fs.existsSync(s.file), false, 'the late refresh token was not kept');
});

test('pressing Sign in again cancels the sign-in that is still waiting', async (t) => {
  const waiting = [];
  const s = setup(t, {
    signInWith: (options) => new Promise((resolve, reject) => {
      waiting.push(resolve);
      options.signal.addEventListener('abort', () => reject(new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.')));
    }),
  });
  const first = s.account.signIn();
  const second = s.account.signIn();
  await assert.rejects(first, { code: 'sign_in_cancelled' });
  assert.strictEqual(s.signIns[0].signal.aborted, true);
  waiting[1]({ idToken: 'id-2', refreshToken: 'refresh-2', expiresIn: HOUR, uid: 'uid-2', email: 'b@x.com', name: 'B' });
  assert.deepStrictEqual(await second, { uid: 'uid-2', email: 'b@x.com', name: 'B' });
});

test('no keychain: signing in fails, and nothing is kept', async (t) => {
  const s = setup(t, { safeStorage: fakeSafeStorage({ available: false }) });
  await assert.rejects(s.account.signIn(), { code: 'no_keychain', message: 'Your Mac keychain is not available, so Buddy cannot keep you signed in.' });
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
});

test('a copy of Buddy with no cloud.json cannot sign in', async (t) => {
  const s = setup(t, { config: null });
  await assert.rejects(s.account.signIn(), { code: 'not_set_up', message: "This copy of Buddy isn't set up for sign-in." });
  assert.strictEqual(s.signIns.length, 0);
});
```

Run: `node --test test/account.test.js` — Expected: FAIL with `Cannot find module '../src/main/account'`.

- [ ] **Step 7: Write account.js**

Create `src/main/account.js`:

```js
'use strict';

/**
 * Who is signed in to Buddy. The Firebase refresh token is kept in account.json, encrypted with safeStorage (the
 * Mac keychain), with the person's uid, email and name. ID tokens stay in memory and are renewed a few minutes
 * before they run out. A refresh token Firebase no longer takes signs the person out.
 */

const fs = require('node:fs');
const { BuddyError } = require('../../shared/errors');
const { writeAtomic } = require('./store');
const google = require('./google-signin');
const { notSetUp } = require('./cloud-config');

const RENEW_EARLY_MS = 5 * 60_000;

const signedOut = () => new BuddyError('signed_out', 'Sign in to use Buddy.');

function createAccount({
  file, safeStorage, config, openBrowser,
  fetchImpl = fetch,
  now = Date.now,
  signInWithGoogle = google.signInWithGoogle,
  refreshIdToken = google.refreshIdToken,
}) {
  let saved = read(); // { uid, email, name, refreshToken: encrypted, base64 }, or null when signed out
  let token = null; // { idToken, expiresAt } for `saved`
  let renewing = null; // the renewal in progress, shared by everyone who asks meanwhile
  let signingIn = null; // the AbortController of the sign-in that is waiting for the browser
  const listeners = [];

  function read() {
    try {
      const d = JSON.parse(fs.readFileSync(file, 'utf8'));
      const complete = d && ['uid', 'email', 'name', 'refreshToken'].every((k) => typeof d[k] === 'string') && d.uid && d.refreshToken;
      return complete ? d : null;
    } catch {
      return null;
    }
  }

  function changed() {
    for (const fn of listeners) fn();
  }

  function keep(user, refreshToken) {
    if (!safeStorage.isEncryptionAvailable()) {
      throw new BuddyError('no_keychain', 'Your Mac keychain is not available, so Buddy cannot keep you signed in.');
    }
    const next = {
      uid: user.uid,
      email: user.email,
      name: user.name,
      refreshToken: safeStorage.encryptString(refreshToken).toString('base64'),
    };
    writeAtomic(file, JSON.stringify(next), 0o600);
    saved = next;
  }

  function forget() {
    saved = null;
    token = null;
    fs.rmSync(file, { force: true });
  }

  function user() {
    return saved ? { uid: saved.uid, email: saved.email, name: saved.name } : null;
  }

  /** Sign in with Google in the browser. Starting again cancels a sign-in that is still waiting. */
  async function signIn() {
    if (!config) throw notSetUp();
    signingIn?.abort();
    const mine = new AbortController();
    signingIn = mine;
    try {
      const r = await signInWithGoogle({ config, openBrowser, fetchImpl, signal: mine.signal });
      if (mine.signal.aborted) throw new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.');
      keep(r, r.refreshToken);
      token = { idToken: r.idToken, expiresAt: now() + r.expiresIn * 1000 };
      changed();
      return user();
    } finally {
      if (signingIn === mine) signingIn = null;
    }
  }

  function signOut() {
    signingIn?.abort();
    const was = saved !== null;
    forget();
    if (was) changed();
  }

  async function renew() {
    const who = saved;
    let refreshToken = null;
    try {
      refreshToken = safeStorage.decryptString(Buffer.from(who.refreshToken, 'base64'));
    } catch {
      // The keychain no longer has what it was encrypted with (a new Mac, a reset keychain): sign in again.
    }
    if (!refreshToken) {
      forget();
      changed();
      throw signedOut();
    }
    let r;
    try {
      r = await refreshIdToken({ refreshToken, config, fetchImpl });
    } catch (err) {
      if (err.code === 'signed_out' && saved === who) {
        forget();
        changed();
      }
      throw err;
    }
    if (saved !== who) throw signedOut(); // signed out (or in as someone else) meanwhile: this token is not theirs
    if (r.refreshToken !== refreshToken) keep(who, r.refreshToken);
    token = { idToken: r.idToken, expiresAt: now() + r.expiresIn * 1000 };
    return r.idToken;
  }

  /** An ID token for Buddy's server; renewed when it runs out within five minutes, or always with `force`. */
  async function idToken({ force = false } = {}) {
    if (!saved) throw signedOut();
    if (!config) throw notSetUp();
    if (!force && token && token.expiresAt - RENEW_EARLY_MS > now()) return token.idToken;
    if (!renewing) {
      renewing = renew().finally(() => {
        renewing = null;
      });
    }
    return renewing;
  }

  return {
    isSignedIn: () => saved !== null,
    user,
    signIn,
    signOut,
    idToken,
    /** `fn()` is called whenever someone signs in or out. */
    onChange: (fn) => {
      listeners.push(fn);
    },
  };
}

module.exports = { createAccount, RENEW_EARLY_MS };
```

Run: `node --test test/account.test.js` — Expected: PASS.

- [ ] **Step 8: Run everything and commit**

Run: `npm test` — Expected: lint clean, all pass.

```bash
git add cloud.example.json src/main/cloud-config.js src/main/google-signin.js src/main/account.js \
  test/cloud-config.test.js test/google-signin.test.js test/account.test.js
git commit -m "feat: sign in with Google (PKCE and a loopback port) and keep the account in the keychain"
```

---

### Task 4: The server client, the free state, and choosing the route

**Files:**
- Create: `src/main/cloud.js`, `src/main/free-state.js`
- Modify: `src/main/ai.js` (whole file below), `src/main/store.js` (one default)
- Create: `test/cloud.test.js`, `test/free-state.test.js`
- Modify: `test/ai.test.js` (setup, imports, new tests)

**Interfaces:**
- Consumes: `account.idToken({ force })`, `account.signOut()`, `account.isSignedIn()` (Task 3's interface; fakes here); `notSetUp()` from `src/main/cloud-config.js` (Task 3 — if this task runs in parallel with Task 3, create `src/main/cloud-config.js` exactly as in Task 3 Step 3, and the merge takes either copy); `MAX_TOKENS` from `shared/prompts.js` (Task 1).
- Produces:
  - `src/main/cloud.js`: `createCloud({ config, account, store, fetchImpl?, now? })` → `{ settings({ force }?) → free | null, last() → free | null, forget(), ask(action, input, { signal }?) → { text, model, check? }, admin: { settings(), save(patch), models(provider), users(), block(uid, blocked) }, onChange(fn) }`; `readSettings(json)`; `FRESH_MS` (60 000). `free` is `{ freeOn, limitMode, limit, usedToday, allowOwnKey, blocked, isAdmin }`, kept in the store under `cloud`.
  - `src/main/free-state.js`: `aiSection(free | null) → { note, showForm }`.
  - `src/main/ai.js`: `createAi({ store, secrets, cloud, account, providers?, fetchImpl? })` → `{ ask, listModels, modelFor }` (same exports `MAX_TOKENS`, `AI_TIMEOUT_MS`). New error codes from `ask`: `signed_out`, `blocked`, `need_key`, `network` (server never reached and no own key), plus whatever the server sends.
  - `src/main/store.js`: `DEFAULTS.cloud = null`.

- [ ] **Step 1: Write the failing tests for the server client**

Create `test/cloud.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createCloud, readSettings, FRESH_MS } = require('../src/main/cloud');

const CONFIG = { serverUrl: 'https://buddy.example', firebaseApiKey: 'k', googleClientId: 'c', googleClientSecret: 's' };
const SETTINGS = { freeOn: true, limitMode: 'daily', limit: 30, usedToday: 2, allowOwnKey: false, blocked: false, isAdmin: false };
const ok = (body) => ({ status: 200, body });

/**
 * createCloud with fakes. `answers` are what the server gives, in turn: { status, body } (no body: not JSON), or an
 * Error the fetch throws; with none left the fetch fails like no internet. The account hands out 'token', or
 * 'fresh-token' when asked to renew. `kept` is what the store holds from an earlier run.
 */
function setup({ answers = [], kept = null, config = CONFIG } = {}) {
  const requests = [];
  const tokens = [];
  const clock = { t: 5_000_000 };
  const data = { cloud: kept };
  let signedOut = 0;
  let changes = 0;
  const store = { get: (key) => data[key], set: (patch) => Object.assign(data, patch) };
  const account = {
    async idToken({ force }) {
      tokens.push(force);
      return force ? 'fresh-token' : 'token';
    },
    signOut: () => { signedOut += 1; },
  };
  async function fetchImpl(url, init) {
    requests.push({ url, method: init.method, headers: init.headers, body: init.body === undefined ? undefined : JSON.parse(init.body), signal: init.signal });
    const next = answers.shift();
    if (!next) throw new TypeError('fetch failed');
    if (next instanceof Error) throw next;
    return {
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: async () => {
        if (next.body === undefined) throw new SyntaxError('Unexpected end of JSON input');
        return next.body;
      },
    };
  }
  const cloud = createCloud({ config, account, store, fetchImpl, now: () => clock.t });
  cloud.onChange(() => { changes += 1; });
  return { cloud, requests, tokens, clock, data, signedOut: () => signedOut, changes: () => changes };
}

test('settings: fetched with the ID token, kept in the store in a tidy shape, and announced', async () => {
  const s = setup({ answers: [ok({ ...SETTINGS, extra: 'x', limit: 30.5, usedToday: 'two' })] });
  const got = await s.cloud.settings();
  assert.deepStrictEqual(got, { ...SETTINGS, limit: null, usedToday: 0 });
  assert.deepStrictEqual(s.data.cloud, got);
  assert.deepStrictEqual([s.requests[0].url, s.requests[0].method], ['https://buddy.example/api/config', 'GET']);
  assert.deepStrictEqual(s.requests[0].headers, { authorization: 'Bearer token' });
  assert.strictEqual(s.changes(), 1);
});

test('readSettings: anything missing or odd reads as off', () => {
  const off = { freeOn: false, limitMode: 'daily', limit: null, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };
  assert.deepStrictEqual(readSettings(null), off);
  assert.deepStrictEqual(readSettings({ freeOn: 'yes', limitMode: 'unlimited', isAdmin: 1 }), { ...off, limitMode: 'unlimited' });
});

test('settings: fetched at most once a minute, unless forced', async () => {
  const s = setup({ answers: [ok(SETTINGS), ok({ ...SETTINGS, usedToday: 3 }), ok({ ...SETTINGS, usedToday: 4 })] });
  await s.cloud.settings();
  s.clock.t += FRESH_MS - 1;
  assert.strictEqual((await s.cloud.settings()).usedToday, 2, 'the kept ones');
  assert.strictEqual((await s.cloud.settings({ force: true })).usedToday, 3);
  s.clock.t += FRESH_MS;
  assert.strictEqual((await s.cloud.settings()).usedToday, 4);
  assert.strictEqual(FRESH_MS, 60_000);
});

test('settings: when the server cannot be reached, the last known ones (from an earlier run too), or null', async () => {
  assert.deepStrictEqual(await setup({ kept: SETTINGS }).cloud.settings(), SETTINGS);
  assert.strictEqual(await setup().cloud.settings(), null);
  assert.deepStrictEqual(await setup({ answers: [{ status: 500 }], kept: SETTINGS }).cloud.settings(), SETTINGS,
    'a server that falls over is like no server');
});

test('a token the server turns down is renewed once; turned down again, the person is signed out', async () => {
  const s = setup({ answers: [{ status: 401, body: {} }, ok(SETTINGS)] });
  assert.deepStrictEqual(await s.cloud.settings(), SETTINGS);
  assert.deepStrictEqual(s.tokens, [false, true]);
  assert.strictEqual(s.requests[1].headers.authorization, 'Bearer fresh-token');

  const twice = setup({ answers: [
    { status: 401, body: {} },
    { status: 401, body: { error: { code: 'unauthenticated', message: 'Sign in with a Google account whose email is verified.' } } },
  ] });
  await assert.rejects(twice.cloud.settings(), { code: 'signed_out', message: 'Sign in with a Google account whose email is verified.' });
  assert.strictEqual(twice.signedOut(), 1);
});

test("the server's refusals come through in its own words; anything else in Buddy's", async () => {
  const s = setup({ answers: [
    { status: 429, body: { error: { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." } } },
    { status: 502, body: 'not an error object' },
    { status: 200 },
  ] });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'free_limit', message: "You've used today's 30 free requests. They come back at midnight." });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'server', message: "Buddy's server had a problem. Try again." });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'server' }, 'an answer that is not JSON');
});

test('ask: posts the action with only the inputs it has, under the deadline it is given', async () => {
  const check = { verdict: 'good', problems: [], corrected: null };
  const s = setup({ answers: [ok({ text: 'Fixed', model: 'claude-x', check })] });
  const signal = AbortSignal.timeout(60_000);
  assert.deepStrictEqual(await s.cloud.ask('check', { image: 'IMG', instruction: 'ok?', text: undefined }, { signal }),
    { text: 'Fixed', model: 'claude-x', check });
  const [req] = s.requests;
  assert.deepStrictEqual([req.url, req.method, req.body], ['https://buddy.example/api/ask', 'POST', { action: 'check', image: 'IMG', instruction: 'ok?' }]);
  assert.strictEqual(req.headers['content-type'], 'application/json');
  assert.strictEqual(req.signal, signal);
});

test('no internet, a server that takes too long, and a cancelled request', async () => {
  await assert.rejects(setup().cloud.ask('fix', { text: 'x' }), { code: 'network', message: "Couldn't reach Buddy's server. Check your internet." });
  const slow = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
  await assert.rejects(setup({ answers: [slow] }).cloud.ask('fix', { text: 'x' }),
    { code: 'timeout', message: "Buddy's server took too long to answer. Try again." });
  const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
  await assert.rejects(setup({ answers: [abort] }).cloud.ask('fix', { text: 'x' }), { name: 'AbortError' });
});

test('forget empties the kept settings and says so', () => {
  const s = setup({ kept: SETTINGS });
  s.cloud.forget();
  assert.strictEqual(s.cloud.last(), null);
  assert.strictEqual(s.data.cloud, null);
  assert.strictEqual(s.changes(), 1);
});

test("the admin's calls", async () => {
  const s = setup({ answers: [ok({ config: {}, providers: [] }), ok({ config: {} }), ok({ models: [] }), ok({ users: [] }), ok({ user: {} })] });
  await s.cloud.admin.settings();
  await s.cloud.admin.save({ enabled: true });
  await s.cloud.admin.models('a b');
  await s.cloud.admin.users();
  await s.cloud.admin.block('u1', true);
  assert.deepStrictEqual(s.requests.map((r) => [r.method, r.url.replace('https://buddy.example', ''), r.body]), [
    ['GET', '/api/admin/settings', undefined],
    ['PUT', '/api/admin/settings', { enabled: true }],
    ['GET', '/api/admin/models?provider=a%20b', undefined],
    ['GET', '/api/admin/users', undefined],
    ['POST', '/api/admin/users', { uid: 'u1', blocked: true }],
  ]);
});

test('a copy of Buddy with no cloud.json calls nothing', async () => {
  const s = setup({ config: null, kept: SETTINGS });
  await assert.rejects(s.cloud.ask('fix', { text: 'x' }), { code: 'not_set_up' });
  await assert.rejects(s.cloud.settings(), { code: 'not_set_up' }, 'not a reason to fall back to the kept settings');
  assert.deepStrictEqual([s.requests, s.tokens], [[], []]);
});
```

Run: `node --test test/cloud.test.js` — Expected: FAIL with `Cannot find module '../src/main/cloud'`.

- [ ] **Step 2: Write cloud.js**

Create `src/main/cloud.js`:

```js
'use strict';

/**
 * Buddy's server (web/): this person's free-mode settings (GET /api/config), free answers (POST /api/ask) and the
 * admin's calls (/api/admin/*). Every call carries the signed-in person's ID token; one the server turns down is
 * renewed and the call made once more. The last settings are kept in the store (`cloud`), so Buddy still knows
 * them after a restart without internet.
 */

const { BuddyError } = require('../../shared/errors');
const { notSetUp } = require('./cloud-config');

const FRESH_MS = 60_000; // settings fetched less than this long ago are not fetched again
const CALL_TIMEOUT_MS = 30_000; // for calls that bring no deadline of their own
const UNREACHABLE = ['network', 'timeout', 'server']; // the server cannot be used now: fall back to what is kept

const serverProblem = () => new BuddyError('server', "Buddy's server had a problem. Try again.");
const tookTooLong = () => new BuddyError('timeout', "Buddy's server took too long to answer. Try again.");

/** The settings as the app keeps them, from the server's answer: anything missing or odd reads as off. */
function readSettings(j) {
  return {
    freeOn: j?.freeOn === true,
    limitMode: j?.limitMode === 'unlimited' ? 'unlimited' : 'daily',
    limit: Number.isInteger(j?.limit) ? j.limit : null,
    usedToday: Number.isInteger(j?.usedToday) ? j.usedToday : 0,
    allowOwnKey: j?.allowOwnKey === true,
    blocked: j?.blocked === true,
    isAdmin: j?.isAdmin === true,
  };
}

function createCloud({ config, account, store, fetchImpl = fetch, now = Date.now }) {
  let fetchedAt = 0; // when the settings were last fetched in this run of the app
  const listeners = [];
  const changed = () => {
    for (const fn of listeners) fn();
  };

  async function call(path, { method = 'GET', body, signal } = {}, retried = false) {
    if (!config) throw notSetUp();
    const idToken = await account.idToken({ force: retried });
    const headers = { authorization: `Bearer ${idToken}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    try {
      res = await fetchImpl(`${config.serverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: signal || AbortSignal.timeout(CALL_TIMEOUT_MS),
      });
    } catch (err) {
      if (err?.name === 'AbortError') throw err;
      if (err?.name === 'TimeoutError') throw tookTooLong();
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    let j = null;
    try {
      j = await res.json();
    } catch (err) {
      if (err?.name === 'TimeoutError') throw tookTooLong(); // the deadline covers reading the answer too
      // not JSON: judged by the status below
    }
    if (res.status === 401) {
      if (!retried) return call(path, { method, body, signal }, true); // a token the server no longer takes: renew it once
      account.signOut();
      throw new BuddyError('signed_out', typeof j?.error?.message === 'string' ? j.error.message : 'Sign in to use Buddy.');
    }
    if (!res.ok) {
      const e = j?.error;
      if (e && typeof e.code === 'string' && typeof e.message === 'string') throw new BuddyError(e.code, e.message);
      throw serverProblem();
    }
    if (!j || typeof j !== 'object') throw serverProblem();
    return j;
  }

  const last = () => store.get('cloud') || null;

  /** Fetch the settings now, keep them, and say they changed. */
  async function refresh() {
    const settings = readSettings(await call('/api/config'));
    store.set({ cloud: settings });
    fetchedAt = now();
    changed();
    return settings;
  }

  /**
   * This person's free-mode settings: fetched again when the ones fetched in this run are a minute old (or with
   * `force`); the last known ones while the server cannot be reached (null if it never was).
   */
  async function settings({ force = false } = {}) {
    if (!force && fetchedAt && now() - fetchedAt < FRESH_MS) return last();
    try {
      return await refresh();
    } catch (err) {
      if (UNREACHABLE.includes(err.code)) return last();
      throw err;
    }
  }

  /** Forget the settings: on sign-out, so the next person does not inherit them (or the admin's menu). */
  function forget() {
    store.set({ cloud: null });
    fetchedAt = 0;
    changed();
  }

  /** One free answer from the server: { text, model, check? }. */
  async function ask(action, input = {}, { signal } = {}) {
    const body = { action };
    for (const name of ['instruction', 'tone', 'text', 'image']) if (input[name] !== undefined) body[name] = input[name];
    const j = await call('/api/ask', { method: 'POST', body, signal });
    if (typeof j.text !== 'string') throw serverProblem();
    return { text: j.text, model: typeof j.model === 'string' ? j.model : '', ...(j.check ? { check: j.check } : {}) };
  }

  const admin = {
    settings: () => call('/api/admin/settings'),
    save: (patch) => call('/api/admin/settings', { method: 'PUT', body: patch }),
    models: (provider) => call(`/api/admin/models?provider=${encodeURIComponent(provider)}`),
    users: () => call('/api/admin/users'),
    block: (uid, blocked) => call('/api/admin/users', { method: 'POST', body: { uid, blocked } }),
  };

  return {
    settings,
    last,
    forget,
    ask,
    admin,
    /** `fn()` is called whenever the kept settings change. */
    onChange: (fn) => {
      listeners.push(fn);
    },
  };
}

module.exports = { createCloud, readSettings, FRESH_MS };
```

Run: `node --test test/cloud.test.js` — Expected: PASS.

- [ ] **Step 3: Write the failing tests for the free state**

Create `test/free-state.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { aiSection } = require('../src/main/free-state');

const free = (extra) => ({ freeOn: true, limitMode: 'daily', limit: 30, usedToday: 4, allowOwnKey: false, blocked: false, isAdmin: false, ...extra });

test('not known yet, or free mode off: the key form, as in Phase 1', () => {
  assert.deepStrictEqual(aiSection(null), { note: '', showForm: true });
  assert.deepStrictEqual(aiSection(free({ freeOn: false })), { note: '', showForm: true });
});

test('free and unlimited: no key needed', () => {
  assert.deepStrictEqual(aiSection(free({ limitMode: 'unlimited', limit: null })), { note: 'Free AI is on. No key needed.', showForm: false });
});

test('a daily limit: how many a day, and how many are used today', () => {
  assert.deepStrictEqual(aiSection(free()), { note: 'You get 30 free requests a day. Used today: 4.', showForm: false });
  assert.strictEqual(aiSection(free({ usedToday: 31 })).note, 'You get 30 free requests a day. Used today: 30.');
});

test('a daily limit with own keys allowed: the form too', () => {
  assert.deepStrictEqual(aiSection(free({ allowOwnKey: true })), {
    note: 'You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.',
    showForm: true,
  });
});

test('blocked: paused, with the form only where own keys are allowed', () => {
  assert.deepStrictEqual(aiSection(free({ blocked: true })), { note: 'Your free access is paused.', showForm: false });
  assert.deepStrictEqual(aiSection(free({ blocked: true, allowOwnKey: true })),
    { note: 'Your free access is paused. You can still use your own key.', showForm: true });
});
```

Run: `node --test test/free-state.test.js` — Expected: FAIL with `Cannot find module '../src/main/free-state'`.

- [ ] **Step 4: Write free-state.js**

Create `src/main/free-state.js`:

```js
'use strict';

/**
 * What the AI part of Settings and the Welcome window shows for this person's free-mode settings (spec §2, "What
 * the AI section shows"): a line about free mode, and whether the provider / key / model form is shown.
 */

function aiSection(free) {
  if (!free || !free.freeOn) return { note: '', showForm: true };
  if (free.blocked) {
    return free.allowOwnKey
      ? { note: 'Your free access is paused. You can still use your own key.', showForm: true }
      : { note: 'Your free access is paused.', showForm: false };
  }
  if (free.limitMode === 'unlimited') return { note: 'Free AI is on. No key needed.', showForm: false };
  const today = `You get ${free.limit} free requests a day. Used today: ${Math.min(free.usedToday, free.limit)}.`;
  if (free.allowOwnKey) {
    return { note: `${today} Add your own key to keep going after your free requests run out.`, showForm: true };
  }
  return { note: today, showForm: false };
}

module.exports = { aiSection };
```

Run: `node --test test/free-state.test.js` — Expected: PASS.

- [ ] **Step 5: Write the failing routing tests**

In `test/ai.test.js`:

1. Below the existing `require` of `../src/main/ai`, add:

```js
const { BuddyError } = require('../shared/errors');
```

2. Replace the whole `setup` function with:

```js
const FREE_OFF = { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };
const FREE_ON = { ...FREE_OFF, freeOn: true };

/**
 * createAi with fakes. `calls` records the own-key provider's calls, `cloudCalls` the server's. `free` is what the
 * server's settings say (null: never reached); `fresh` what they say when fetched again with force; `freeAsk`
 * decides the server's answer.
 */
function setup({ key = 'k-1', model, vision = true, answer = 'Fixed text', live = ['m-live'], signedIn = true, free = FREE_OFF, fresh, freeAsk } = {}) {
  const calls = [];
  const cloudCalls = [];
  const provider = {
    fallbackModels: ['m-default', 'm-other'],
    isVisionModel: () => vision,
    async complete(opts) {
      calls.push(opts);
      return { text: answer, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels(opts) {
      calls.push({ listModels: opts });
      return live;
    },
  };
  const cloud = {
    async settings(options = {}) {
      cloudCalls.push(['settings', options]);
      return options.force && fresh !== undefined ? fresh : free;
    },
    async ask(action, input, options) {
      cloudCalls.push(['cloudAsk', action, input, options]);
      return freeAsk ? freeAsk() : { text: 'Free answer', model: 'free-model' };
    },
  };
  const settings = { provider: 'openai', models: model ? { openai: model } : {} };
  const ai = createAi({
    store: { get: (k) => settings[k] },
    secrets: { get: (p) => (p === 'openai' ? key : null), has: (p) => p === 'openai' && key !== null },
    providers: { getProvider: () => provider },
    account: { isSignedIn: () => signedIn },
    cloud,
  });
  return { ai, calls, cloudCalls };
}
```

3. Append these tests at the end of the file:

```js
// ---- which route (Phase 2) ----

test('signed out: nothing is asked of anyone', async () => {
  const { ai, calls, cloudCalls } = setup({ signedIn: false });
  await assert.rejects(ai.ask('fix', { text: 'x' }), { code: 'signed_out', message: 'Sign in to use Buddy.' });
  assert.deepStrictEqual([calls, cloudCalls], [[], []]);
});

test("free mode on: Buddy's server answers, with the deadline it is given", async () => {
  const { ai, calls, cloudCalls } = setup({ free: FREE_ON });
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  assert.deepStrictEqual(await ai.ask('fix', { text: 'me go' }, { signal }), { text: 'Free answer', model: 'free-model' });
  assert.deepStrictEqual(cloudCalls.at(-1), ['cloudAsk', 'fix', { text: 'me go' }, { signal }]);
  assert.strictEqual(calls.length, 0, 'the own key is not used');
});

test('free mode on: input that is not valid is refused here, before the server is asked', async () => {
  const { ai, cloudCalls } = setup({ free: FREE_ON });
  await assert.rejects(ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  assert.ok(!cloudCalls.some(([name]) => name === 'cloudAsk'));
});

test('the server never reached: the own key when there is one, else no internet', async () => {
  assert.strictEqual((await setup({ free: null }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: null, key: null }).ai.ask('fix', { text: 'x' }),
    { code: 'network', message: "Couldn't reach Buddy's server. Check your internet." });
});

test('blocked: the own key where the admin allows it, else paused', async () => {
  assert.strictEqual((await setup({ free: { ...FREE_ON, blocked: true, allowOwnKey: true } }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: { ...FREE_ON, blocked: true } }).ai.ask('fix', { text: 'x' }),
    { code: 'blocked', message: 'Your free access is paused.' });
  await assert.rejects(setup({ free: { ...FREE_ON, blocked: true, allowOwnKey: true }, key: null }).ai.ask('fix', { text: 'x' }), { code: 'blocked' });
});

const LIMIT = new BuddyError('free_limit', "You've used today's 30 free requests. They come back at midnight.");

test("today's free requests used up: the own key where allowed, after fetching the settings again", async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  assert.strictEqual((await s.ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  assert.ok(s.cloudCalls.some(([name, options]) => name === 'settings' && options.force === true));
});

test("today's free requests used up, own keys allowed but none saved: say where to add one", async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, key: null, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), {
    code: 'need_key',
    message: "You've used today's 30 free requests. Add your own key in Settings to keep going, or wait until midnight.",
  });
});

test("today's free requests used up, own keys not allowed: the server's words, and a saved key stays unused", async () => {
  const s = setup({ free: FREE_ON, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), LIMIT);
  assert.strictEqual(s.calls.length, 0);
});

test('free mode turned off meanwhile: the own key, once the settings say so', async () => {
  const off = new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.');
  assert.strictEqual((await setup({ free: FREE_ON, fresh: FREE_OFF, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: FREE_ON, fresh: FREE_OFF, key: null, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' }), { code: 'no_key' });
  await assert.rejects(setup({ free: FREE_ON, fresh: FREE_ON, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' }), off);
});

test('other failures of the free route are passed on as they are, with no second fetch', async () => {
  const down = new BuddyError('upstream', "Buddy couldn't answer. Try again.");
  const s = setup({ free: FREE_ON, freeAsk: () => { throw down; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), down);
  assert.ok(!s.cloudCalls.some(([name, options]) => name === 'settings' && options.force));
});
```

Run: `node --test test/ai.test.js` — Expected: the old tests PASS (the old `createAi` ignores `account` and `cloud`), and the new routing tests FAIL (for example, `signed out` answers instead of refusing).

- [ ] **Step 6: Write the routing**

Replace the whole of `src/main/ai.js` with:

```js
'use strict';

/**
 * Answers one panel action, by one of two routes (Phase 2 spec §5, "Routing"):
 *   free -- Buddy's server answers with the admin's key (src/main/cloud.js);
 *   own  -- the user's own key, straight to the provider they picked (Phase 1).
 * Which one comes from the server's free-mode settings for this person. Nobody uses either without signing in.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const providerRegistry = require('../../shared/providers');

const { MAX_TOKENS } = prompts;
// How long a person waits for the AI (an answer, or a check of their key) before it is given up on.
const AI_TIMEOUT_MS = 60_000;

// What the server says when it will not answer for free; the settings are fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

function createAi({ store, secrets, cloud, account, providers = providerRegistry, fetchImpl }) {
  function modelFor(providerId) {
    const provider = providers.getProvider(providerId);
    return store.get('models')?.[providerId] || provider.fallbackModels[0];
  }

  const hasOwnKey = () => secrets.has(store.get('provider'));

  /** The user's own key, straight to their provider: Phase 1's route. */
  async function askOwn(action, input, { signal } = {}) {
    const providerId = store.get('provider');
    const provider = providers.getProvider(providerId);
    const apiKey = secrets.get(providerId);
    if (!apiKey) throw new BuddyError('no_key', 'Add your API key in Settings first.');
    const prompt = prompts.buildPrompt(action, input);
    const model = modelFor(providerId);
    if (prompt.image && !provider.isVisionModel(model)) {
      throw new BuddyError('no_vision', "This model can't read screenshots. Pick another in Settings.");
    }
    const out = await provider.complete({ apiKey, model, ...prompt, maxTokens: MAX_TOKENS, fetchImpl, signal });
    return action === 'check' ? { ...out, check: prompts.parseCheck(out.text) } : out;
  }

  /** The server would not answer for free: carry on with the user's own key where the admin allows it. */
  async function afterRefusal(err, before, action, input, options) {
    const now = (await cloud.settings({ force: true }).catch(() => null)) || before;
    if (err.code === 'free_off') {
      if (!now.freeOn) return askOwn(action, input, options);
      throw err;
    }
    if (now.allowOwnKey && hasOwnKey()) return askOwn(action, input, options);
    if (err.code === 'free_limit' && now.allowOwnKey) {
      const limit = now.limit ?? before.limit;
      const used = limit ? `today's ${limit} free requests` : "today's free requests";
      throw new BuddyError('need_key', `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`);
    }
    throw err;
  }

  async function ask(action, input, options = {}) {
    if (!account.isSignedIn()) throw new BuddyError('signed_out', 'Sign in to use Buddy.');
    const free = await cloud.settings();
    if (!free) {
      // The server has never been reached: the user's own key, when there is one.
      if (hasOwnKey()) return askOwn(action, input, options);
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    if (!free.freeOn) return askOwn(action, input, options);
    if (free.blocked) {
      if (free.allowOwnKey && hasOwnKey()) return askOwn(action, input, options);
      throw new BuddyError('blocked', 'Your free access is paused.');
    }
    prompts.buildPrompt(action, input); // input that is not valid is refused here, without a call to the server
    try {
      return await cloud.ask(action, input, options);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err.code)) throw err;
      return afterRefusal(err, free, action, input, options);
    }
  }

  /** Models for a provider: the live list for the saved key, else the fallback list. */
  async function listModels(providerId, { signal } = {}) {
    const provider = providers.getProvider(providerId);
    const apiKey = secrets.get(providerId);
    if (!apiKey) return provider.fallbackModels;
    const live = await provider.listModels({ apiKey, fetchImpl, signal });
    return live.length ? live : provider.fallbackModels;
  }

  return { ask, listModels, modelFor };
}

module.exports = { createAi, MAX_TOKENS, AI_TIMEOUT_MS };
```

In `src/main/store.js`, add to `DEFAULTS` (after `lastDisplayId: null,`):

```js
  cloud: null, // this person's free-mode settings as the server last gave them (src/main/cloud.js)
```

Run: `node --test test/ai.test.js test/cloud.test.js test/free-state.test.js test/store.test.js` — Expected: PASS.

- [ ] **Step 7: Run everything and commit**

Run: `npm test` — Expected: lint clean, all pass. (`src/main/main.js` still calls `createAi({ store, secrets })`; it is wired in Task 5, and nothing runs `ask` in the unit tests through main.js.)

```bash
git add src/main/cloud.js src/main/free-state.js src/main/ai.js src/main/store.js \
  test/cloud.test.js test/free-state.test.js test/ai.test.js
git commit -m "feat: the server client, and each request takes the free route or the user's own key"
```

---
### Task 5: Sign-in and free mode in Settings, the Welcome window and the panel, wired into the app

**Files:**
- Modify: `src/main/ipc/settings.js`, `test/settings-ipc.test.js`
- Modify: `src/preload/settings.js`
- Modify: `src/renderer/settings/index.html`, `src/renderer/settings/settings.js` (whole files below)
- Modify: `src/renderer/onboarding/index.html`, `src/renderer/onboarding/onboarding.js` (whole files below)
- Modify: `src/renderer/panel/panel.js` (the Settings errors)
- Modify: `src/main/main.js` (whole file below)
- Modify: `test/e2e/smoke.js`; Create: `test/e2e/checks/70-account.js`

**Interfaces:**
- Consumes: Task 3 `loadCloudConfig()`, `createAccount(...)` (`isSignedIn`, `user`, `signIn`, `signOut`, `onChange`); Task 4 `createCloud(...)` (`settings`, `last`, `forget`, `onChange`), `aiSection(free)`, `createAi({ store, secrets, cloud, account })`.
- Produces:
  - IPC (Settings and Welcome windows): `settings:get`/`settings:set`/… now answer a snapshot with `account: { signedIn, email?, name? }`, `canSignIn: boolean`, `ai: { note, showForm }` (and `settings` without `cloud`); new channels `account:sign-in`, `account:sign-out`, `settings:refresh`; `onboarding:finish` refuses `signed_out` ("Sign in with Google first.").
  - Preload `window.buddy.refresh()`, `signIn()`, `signOut()`.
  - `start(options)` accepts `options.account`, `options.cloud`, `options.cloudConfig` (for the e2e test) and returns `account` and `cloud` in its context.

- [ ] **Step 1: Write the failing Settings IPC tests**

In `test/settings-ipc.test.js`:

1. Replace the `setup` function's first line

```js
function setup({ stored = {}, registered = 'Alt+Space', taken = [], keychain = true, buddyOn = false, realShortcut } = {}) {
```

with

```js
function setup({
  stored = {}, registered = 'Alt+Space', taken = [], keychain = true, buddyOn = false, realShortcut,
  signedIn = true, free = null, signInFails = null, cloudFails = null,
} = {}) {
```

and add to the comment above `setup`: `` `signedIn` is whether someone is signed in; `free` is the server's free-mode settings as the app last got them; `signInFails` and `cloudFails` make signing in or fetching those settings fail. ``

2. In `setup`, right after `const handlers = {};`, add:

```js
  let signed = signedIn;
  const account = {
    isSignedIn: () => signed,
    user: () => (signed ? { uid: 'u1', email: 'rahul@gmail.com', name: 'Rahul' } : null),
    async signIn() {
      calls.push(['signIn']);
      if (signInFails) throw signInFails;
      signed = true;
      return { uid: 'u1', email: 'rahul@gmail.com', name: 'Rahul' };
    },
    signOut() {
      calls.push(['signOut']);
      signed = false;
    },
  };
  const cloud = {
    last: () => free,
    async settings(options) {
      calls.push(['cloudSettings', options]);
      if (cloudFails) throw cloudFails;
      return free;
    },
  };
```

3. In the `registerSettingsIpc({ ... })` call inside `setup`, after `onFinishOnboarding: () => calls.push(['finished']),` add:

```js
    account,
    cloud,
    canSignIn: true,
```

4. Append these tests at the end of the file:

```js
// ---- signing in and free mode (Phase 2) ----

const UNLIMITED = { freeOn: true, limitMode: 'unlimited', limit: null, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };

test('settings:get: who is signed in, whether this copy can sign in, and what the AI section shows', async () => {
  const s = setup({ free: UNLIMITED, stored: { cloud: UNLIMITED } });
  const r = await s.call('settings:get');
  assert.deepStrictEqual(r.account, { signedIn: true, email: 'rahul@gmail.com', name: 'Rahul' });
  assert.strictEqual(r.canSignIn, true);
  assert.deepStrictEqual(r.ai, { note: 'Free AI is on. No key needed.', showForm: false });
  assert.ok(!('cloud' in r.settings), 'the kept server settings are not page settings');

  const out = await setup({ signedIn: false, free: UNLIMITED }).call('settings:get');
  assert.deepStrictEqual(out.account, { signedIn: false });
  assert.deepStrictEqual(out.ai, { note: '', showForm: true }, 'signed out, no free settings apply');
});

test('account:sign-in signs in, fetches the free settings, and answers the new state', async () => {
  const s = setup({ signedIn: false });
  const r = await s.call('account:sign-in');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.account, { signedIn: true, email: 'rahul@gmail.com', name: 'Rahul' });
  assert.deepStrictEqual(s.calls.filter(([name]) => ['signIn', 'cloudSettings'].includes(name)), [['signIn'], ['cloudSettings', { force: true }]]);
});

test('account:sign-in that fails says why, and fetches nothing', async () => {
  const s = setup({ signedIn: false, signInFails: new BuddyError('sign_in_failed', "Google didn't sign you in. Try again.") });
  assert.deepStrictEqual(await s.call('account:sign-in'), refused('sign_in_failed', "Google didn't sign you in. Try again."));
  assert.ok(!s.calls.some(([name]) => name === 'cloudSettings'));
});

test('account:sign-in still answers when the free settings cannot be fetched', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({ signedIn: false, cloudFails: new BuddyError('server', "Buddy's server had a problem. Try again.") });
  const r = await s.call('account:sign-in');
  assert.deepStrictEqual([r.ok, r.account.signedIn], [true, true]);
});

test('account:sign-out signs out and answers the signed-out state', async () => {
  const s = setup();
  const r = await s.call('account:sign-out');
  assert.deepStrictEqual([r.ok, r.account], [true, { signedIn: false }]);
  assert.ok(s.calls.some(([name]) => name === 'signOut'));
});

test('settings:refresh fetches the free settings for someone signed in, and never fails the page', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup();
  assert.strictEqual((await s.call('settings:refresh')).ok, true);
  assert.deepStrictEqual(s.calls.filter(([name]) => name === 'cloudSettings'), [['cloudSettings', { force: true }]]);

  const out = setup({ signedIn: false });
  await out.call('settings:refresh');
  assert.ok(!out.calls.some(([name]) => name === 'cloudSettings'), 'nobody to fetch them for');

  const failing = setup({ cloudFails: new BuddyError('server', "Buddy's server had a problem. Try again.") });
  assert.strictEqual((await failing.call('settings:refresh')).ok, true);
});

test('onboarding:finish wants someone signed in, and finishes nothing otherwise', async () => {
  const s = setup({ signedIn: false });
  assert.deepStrictEqual(await s.callFromWelcome('onboarding:finish', { buddyId: 'girl-1', buddyName: 'Pixie' }),
    refused('signed_out', 'Sign in with Google first.'));
  assert.strictEqual(s.store.get('onboarded'), false);
  assert.ok(!s.calls.some(([name]) => name === 'finished'));
});
```

Run: `node --test test/settings-ipc.test.js` — Expected: the new tests FAIL (`r.account` is undefined; `account:sign-in` is not a handler, so `handlers[channel]` is not a function); the older ones still pass.

- [ ] **Step 2: Account and free state in the Settings IPC**

In `src/main/ipc/settings.js`:

1. After `const { guarded } = require('./result');` add:

```js
const { aiSection } = require('../free-state');
```

2. Change the signature to:

```js
function registerSettingsIpc({
  ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, onFinishOnboarding, shell,
  account, cloud, canSignIn,
}) {
```

3. Replace `snapshot()` with:

```js
  function snapshot() {
    const settings = store.all();
    delete settings.positions;
    delete settings.lastDisplayId;
    delete settings.cloud; // the server's free-mode settings: the page gets what they mean, in `ai`
    const user = account.user();
    return {
      settings,
      buddyOn: power.isOn(),
      characters: characters.list,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        keyUrl: PROVIDERS[id].keyUrl,
        fallbackModels: PROVIDERS[id].fallbackModels,
        hasKey: secrets.has(id),
      })),
      account: user ? { signedIn: true, email: user.email, name: user.name } : { signedIn: false },
      canSignIn,
      ai: aiSection(user ? cloud.last() : null), // free-mode settings apply only to someone signed in
    };
  }
```

4. After the `settings:open-url` handler add:

```js
  /** Fetch this person's free-mode settings again. A failure is only logged: the page shows the last known ones. */
  async function refreshFree() {
    try {
      await cloud.settings({ force: true });
    } catch (err) {
      console.warn('[buddy] could not fetch the free settings:', err.code || err.name);
    }
  }

  handle('account:sign-in', async () => {
    await account.signIn();
    await refreshFree();
    return snapshot();
  });

  handle('account:sign-out', () => {
    account.signOut();
    return snapshot();
  });

  handle('settings:refresh', async () => {
    if (account.isSignedIn()) await refreshFree();
    return snapshot();
  });
```

5. In the `onboarding:finish` handler, right after the line that throws `'Those choices are not valid.'`, add:

```js
    if (!account.isSignedIn()) throw new BuddyError('signed_out', 'Sign in with Google first.');
```

Run: `node --test test/settings-ipc.test.js` — Expected: PASS.

- [ ] **Step 3: The preload**

Replace `src/preload/settings.js` with:

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  get: () => ipcRenderer.invoke('settings:get'),
  refresh: () => ipcRenderer.invoke('settings:refresh'),
  set: (patch) => ipcRenderer.invoke('settings:set', patch),
  saveKey: (provider, key) => ipcRenderer.invoke('settings:save-key', provider, key),
  clearKey: (provider) => ipcRenderer.invoke('settings:clear-key', provider),
  models: (provider) => ipcRenderer.invoke('settings:models', provider),
  setBuddyOn: (on) => ipcRenderer.invoke('settings:buddy-on', on),
  signIn: () => ipcRenderer.invoke('account:sign-in'),
  signOut: () => ipcRenderer.invoke('account:sign-out'),
  permissions: () => ipcRenderer.invoke('permissions:get'),
  requestPermission: (which) => ipcRenderer.invoke('permissions:request', which),
  openPermissionSettings: (which) => ipcRenderer.invoke('permissions:open', which),
  openUrl: (url) => ipcRenderer.invoke('settings:open-url', url),
  finishOnboarding: (choice) => ipcRenderer.invoke('onboarding:finish', choice),
});
```

- [ ] **Step 4: The Settings page**

Replace `src/renderer/settings/index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'">
  <title>Buddy Settings</title>
  <link rel="stylesheet" href="../common/base.css">
</head>
<body>
<main>
  <section class="card">
    <h2>Account</h2>
    <p id="account-line"></p>
    <div class="row">
      <button id="sign-in" class="primary" type="button" hidden>Sign in with Google</button>
      <button id="sign-out" type="button" hidden>Sign out</button>
    </div>
    <p id="account-status" class="muted"></p>
  </section>

  <section class="card">
    <h2>Your buddy</h2>
    <div id="buddies" class="buddies"></div>
    <p id="buddy-status" class="muted"></p>
    <label for="name">Name</label>
    <input id="name" type="text" maxlength="24">
    <p id="name-status" class="muted"></p>
    <label for="size">Size</label>
    <select id="size">
      <option value="small">Small</option>
      <option value="medium">Medium</option>
      <option value="large">Large</option>
    </select>
    <p id="size-status" class="muted"></p>
  </section>

  <section class="card">
    <h2>Shortcut</h2>
    <p class="muted">Press it in any app to open your buddy. For example: Alt+Space or CommandOrControl+Shift+B</p>
    <div class="row">
      <input id="shortcut" type="text">
      <button id="shortcut-save" type="button">Save</button>
    </div>
    <p id="shortcut-status" class="muted"></p>
  </section>

  <section class="card">
    <h2>AI</h2>
    <p id="ai-note" class="muted" hidden></p>
    <div id="ai"></div>
  </section>

  <section class="card">
    <h2>Permissions</h2>
    <div class="row">
      <span class="grow">Accessibility (read and paste your text)</span>
      <span id="perm-accessibility" class="muted"></span>
      <button id="perm-accessibility-btn" type="button">Allow</button>
    </div>
    <div class="row">
      <span class="grow">Screen Recording (Check screen)</span>
      <span id="perm-screenRecording" class="muted"></span>
      <button id="perm-screenRecording-btn" type="button">Allow</button>
    </div>
    <p id="perm-status" class="muted"></p>
  </section>

  <section class="card">
    <h2>Always on</h2>
    <p id="power-status" class="muted"></p>
    <button id="power" type="button"></button>
  </section>
</main>
<script src="../common/buddy-grid.js"></script>
<script src="../common/ai-form.js"></script>
<script src="settings.js"></script>
</body>
</html>
```

Replace `src/renderer/settings/settings.js` with:

```js
'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
let snap = null;
let gridBuilt = false;

function showStatus(id, text, kind) {
  $(id).textContent = text;
  $(id).className = kind;
}

/** Shown in place of the page when its settings cannot be loaded. */
function showLoadError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('main').replaceChildren(p);
}

/** Who is signed in, and the button that changes it. */
function renderAccount() {
  const { account, canSignIn } = snap;
  let line = 'Sign in with Google to use your buddy.';
  if (account.signedIn) line = account.name ? `Signed in as ${account.name} (${account.email})` : `Signed in as ${account.email}`;
  else if (!canSignIn) line = "This copy of Buddy isn't set up for sign-in.";
  $('account-line').textContent = line;
  $('sign-in').hidden = account.signedIn || !canSignIn;
  $('sign-out').hidden = !account.signedIn;
}

/** What free mode means for this person, and whether they need the key form. */
function renderAi() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
  $('ai').hidden = !snap.ai.showForm;
}

function render() {
  renderAccount();
  renderAi();
  if (gridBuilt) {
    // Only move the check: rebuilding the radio buttons would drop the keyboard focus that is on one of them.
    for (const radio of $('buddies').querySelectorAll('input')) radio.checked = radio.value === snap.settings.buddyId;
  } else {
    renderBuddyGrid($('buddies'), snap.characters, snap.settings.buddyId, (c) => save({ buddyId: c.id }, 'buddy-status'));
    gridBuilt = true;
  }
  $('name').value = snap.settings.buddyName;
  $('size').value = snap.settings.size;
  $('shortcut').value = snap.settings.shortcut;
  $('power').textContent = snap.buddyOn ? 'Turn off buddy' : 'Turn on buddy';
  showStatus(
    'power-status',
    snap.buddyOn ? 'Your buddy is on, and comes back every time your Mac starts.' : 'Your buddy is off.',
    'muted',
  );
}

/** Save a change and say next to its field how it went. Then show what is saved, so a refused change puts the field back. */
async function save(patch, statusId) {
  const r = await window.buddy.set(patch);
  showStatus(statusId, r.ok ? 'Saved ✓' : r.error.message, r.ok ? 'good' : 'error');
  if (r.ok) snap = r;
  render();
}

async function renderPermissions() {
  const r = await window.buddy.permissions();
  for (const which of ['accessibility', 'screenRecording']) {
    const granted = Boolean(r.ok && r[which]);
    $(`perm-${which}`).textContent = granted ? 'Allowed ✓' : 'Not allowed';
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

$('sign-in').addEventListener('click', async () => {
  showStatus('account-status', 'Finish signing in in your browser…', 'muted');
  const r = await window.buddy.signIn();
  if (r.ok) {
    snap = r;
    render();
    showStatus('account-status', 'Signed in ✓', 'good');
  } else if (r.error.code !== 'sign_in_cancelled') {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    showStatus('account-status', r.error.message, 'error');
  }
});
$('sign-out').addEventListener('click', async () => {
  const r = await window.buddy.signOut();
  if (!r.ok) {
    showStatus('account-status', r.error.message, 'error');
    return;
  }
  snap = r;
  render();
  showStatus('account-status', 'Signed out.', 'muted');
});
$('name').addEventListener('change', () => save({ buddyName: $('name').value }, 'name-status'));
$('size').addEventListener('change', () => save({ size: $('size').value }, 'size-status'));
$('shortcut-save').addEventListener('click', () => save({ shortcut: $('shortcut').value.trim() }, 'shortcut-status'));
$('power').addEventListener('click', async () => {
  const r = await window.buddy.setBuddyOn(!snap.buddyOn);
  if (r.ok) {
    snap = r;
    render();
  } else {
    showStatus('power-status', r.error.message, 'error');
  }
});
for (const which of ['accessibility', 'screenRecording']) {
  $(`perm-${which}-btn`).addEventListener('click', async () => {
    const asked = await window.buddy.requestPermission(which);
    const opened = await window.buddy.openPermissionSettings(which);
    const failed = [asked, opened].find((r) => !r.ok);
    showStatus('perm-status', failed ? failed.error.message : '', failed ? 'error' : 'muted');
  });
}
// Coming back from System Settings: show what changed.
window.addEventListener('focus', renderPermissions);

(async () => {
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
  // The admin may have changed free mode since the app last asked.
  const fresh = await window.buddy.refresh();
  if (fresh.ok) {
    snap = fresh;
    render();
  }
})();
```

- [ ] **Step 5: The Welcome window**

Replace `src/renderer/onboarding/index.html` with:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'">
  <title>Welcome to Buddy</title>
  <link rel="stylesheet" href="../common/base.css">
</head>
<body>
<main>
  <section id="step-signin">
    <h1>Hi! Sign in to start</h1>
    <p>Sign in with your Google account. Buddy only learns your name and your email address.</p>
    <div class="row">
      <button id="sign-in" class="primary" type="button">Sign in with Google</button>
    </div>
    <p id="signin-status" class="muted"></p>
  </section>

  <section id="step-pick" hidden>
    <h1>Pick your buddy</h1>
    <p class="muted">You can change this any time in Settings.</p>
    <div id="buddies" class="buddies"></div>
    <label for="name">Give your buddy a name</label>
    <input id="name" type="text" maxlength="24">
  </section>

  <section id="step-accessibility" hidden>
    <h1>Let your buddy type for you</h1>
    <p>To read the text you select and paste answers into Gmail, WhatsApp and other apps, your Mac needs to allow <strong>Accessibility</strong> for Buddy.</p>
    <p>Click the button, then switch Buddy on in the list that opens.</p>
    <div class="row">
      <button id="acc-open" class="primary" type="button">Open System Settings</button>
      <button id="acc-check" type="button">Check again</button>
    </div>
    <p id="acc-status" class="muted"></p>
  </section>

  <section id="step-screen" hidden>
    <h1>Let your buddy see your screen</h1>
    <p>For <strong>Check screen</strong>, your buddy takes a screenshot of the window you are in. Allow <strong>Screen Recording</strong> for Buddy. You can skip this and allow it later.</p>
    <div class="row">
      <button id="scr-open" class="primary" type="button">Open System Settings</button>
      <button id="scr-check" type="button">Check again</button>
    </div>
    <p id="scr-status" class="muted"></p>
  </section>

  <section id="step-ai" hidden>
    <h1>Connect an AI</h1>
    <p>Your buddy uses an AI to write. Pick one and paste your API key. You can also do this later in Settings.</p>
    <p id="ai-note" class="muted" hidden></p>
    <div id="ai"></div>
  </section>

  <p id="finish-status" class="error" hidden></p>

  <footer class="row">
    <button id="back" type="button">Back</button>
    <span class="spacer"></span>
    <button id="next" class="primary" type="button">Next</button>
  </footer>
</main>
<script src="../common/buddy-grid.js"></script>
<script src="../common/ai-form.js"></script>
<script src="onboarding.js"></script>
</body>
</html>
```

Replace `src/renderer/onboarding/onboarding.js` with:

```js
'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
const ALL_STEPS = ['signin', 'pick', 'accessibility', 'screen', 'ai'];
let steps = ALL_STEPS; // without 'ai' when free mode covers this person (snap.ai.showForm is false)
let step = 0;
let snap = null;
let chosen = null;

function showStatus(id, text, kind) {
  $(id).textContent = text;
  $(id).className = kind;
}

/** Shown in place of the page when its settings cannot be loaded. */
function showLoadError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('main').replaceChildren(p);
}

async function checkPermissions() {
  const r = await window.buddy.permissions();
  if (!r.ok) {
    showStatus('acc-status', r.error.message, 'error');
    showStatus('scr-status', r.error.message, 'error');
    return;
  }
  const show = (id, granted) => showStatus(id, granted ? 'Allowed ✓' : 'Not allowed yet', granted ? 'good' : 'muted');
  show('acc-status', Boolean(r.accessibility));
  show('scr-status', Boolean(r.screenRecording));
}

/** The steps for this person: Connect an AI only when they may need a key of their own. */
function setSteps() {
  steps = ALL_STEPS.filter((name) => name !== 'ai' || snap.ai.showForm);
  step = Math.min(step, steps.length - 1);
}

function go(n) {
  step = n;
  for (const name of ALL_STEPS) $(`step-${name}`).hidden = name !== steps[n];
  $('back').hidden = n === 0;
  $('next').textContent = n === steps.length - 1 ? 'Start my buddy' : 'Next';
  // Nobody goes past the first step without signing in.
  $('next').disabled = steps[n] === 'signin' && !snap?.account.signedIn;
  if (steps[n] === 'accessibility' || steps[n] === 'screen') checkPermissions();
}

function renderSignIn() {
  const { account, canSignIn } = snap;
  $('sign-in').hidden = account.signedIn;
  $('sign-in').disabled = !canSignIn;
  if (account.signedIn) showStatus('signin-status', `Signed in as ${account.email} ✓`, 'good');
  else if (!canSignIn) showStatus('signin-status', "This copy of Buddy isn't set up for sign-in.", 'error');
}

function renderAiNote() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
}

async function allow(which, statusId) {
  const asked = await window.buddy.requestPermission(which);
  const opened = await window.buddy.openPermissionSettings(which);
  const failed = [asked, opened].find((r) => !r.ok);
  if (failed) showStatus(statusId, failed.error.message, 'error');
}

function pick(character) {
  const box = $('name');
  const previous = snap.characters.find((c) => c.id === chosen);
  // Follow the buddy's own name until the user types one of their own.
  if (!box.value.trim() || box.value === previous?.defaultName) box.value = character.defaultName;
  chosen = character.id;
}

$('sign-in').addEventListener('click', async () => {
  showStatus('signin-status', 'Finish signing in in your browser…', 'muted');
  const r = await window.buddy.signIn();
  if (!r.ok) {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    if (r.error.code !== 'sign_in_cancelled') showStatus('signin-status', r.error.message, 'error');
    return;
  }
  snap = r;
  setSteps();
  renderSignIn();
  renderAiNote();
  go(step);
});
$('acc-open').addEventListener('click', () => allow('accessibility', 'acc-status'));
$('scr-open').addEventListener('click', () => allow('screenRecording', 'scr-status'));
$('acc-check').addEventListener('click', checkPermissions);
$('scr-check').addEventListener('click', checkPermissions);
window.addEventListener('focus', () => {
  if (steps[step] === 'accessibility' || steps[step] === 'screen') checkPermissions();
});
$('back').addEventListener('click', () => go(step - 1));
$('next').addEventListener('click', async () => {
  if (step < steps.length - 1) {
    go(step + 1);
    return;
  }
  $('next').disabled = true;
  $('finish-status').hidden = true;
  const r = await window.buddy.finishOnboarding({ buddyId: chosen, buddyName: $('name').value });
  if (r.ok) return; // the window closes now, so the button stays off
  $('finish-status').textContent = r.error.message;
  $('finish-status').hidden = false;
  $('next').disabled = false;
});

(async () => {
  go(0); // first, so Back is hidden and Next is off on the first step from the start
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  setSteps();
  renderSignIn();
  renderAiNote();
  go(step);
  chosen = snap.settings.buddyId;
  renderBuddyGrid($('buddies'), snap.characters, chosen, pick);
  $('name').value = snap.characters.find((c) => c.id === chosen)?.defaultName || '';
  await mountAiForm($('ai'));
})();
```

- [ ] **Step 6: The panel sends the new errors to Settings**

In `src/renderer/panel/panel.js`, replace the comment and the `SETTINGS_ERRORS` line with:

```js
// Errors whose fix is in Settings: no key yet, a key that was refused, an account out of credit, a model that cannot
// be used (not there for this key, or it cannot read screenshots: "Pick another in Settings"); and signed out,
// today's free requests used up with own keys allowed but none saved, free mode turned off, and a copy of Buddy that
// cannot sign in. They come with an "Open Settings" button. (The code is the one the main process sent along with the
// message.)
const SETTINGS_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'signed_out', 'need_key', 'free_off', 'not_set_up'];
```

- [ ] **Step 7: Wire it into the app**

Replace `src/main/main.js` with:

```js
'use strict';

/**
 * Buddy's main process. start() builds everything and hands back the pieces,
 * so the end-to-end test (test/e2e/smoke.js) can drive the real app with fakes
 * in place of the parts that touch the system.
 */

const path = require('node:path');
const { app, clipboard, globalShortcut: systemShortcut, ipcMain, powerMonitor, safeStorage, screen, shell } = require('electron');
const { createStore } = require('./store');
const { createSecrets } = require('./secrets');
const { loadCloudConfig } = require('./cloud-config');
const { createAccount } = require('./account');
const { createCloud } = require('./cloud');
const { createAi } = require('./ai');
const { Helper } = require('./helper');
const { loadCharacters } = require('./characters');
const { createBuddyWindow } = require('./buddy-window');
const { createBubbleWindow } = require('./bubble-window');
const { createPanelWindow } = require('./panel-window');
const { createSettingsWindows } = require('./settings-windows');
const { installAppMenu } = require('./app-menu');
const { createActions } = require('./actions');
const { createTray } = require('./tray');
const { createPower, loginItemsFor } = require('./power');
const { createShortcut } = require('./shortcut');
const { registerBuddyIpc } = require('./ipc/buddy');
const { registerPanelIpc } = require('./ipc/panel');
const { registerSettingsIpc } = require('./ipc/settings');

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'buddy-helper')
    : path.join(__dirname, '..', '..', 'bin', 'buddy-helper');
}

async function start(options = {}) {
  if (options.singleInstance !== false && !app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  await app.whenReady();
  if (app.dock) app.dock.hide();
  app.on('window-all-closed', () => {}); // a menu bar app: closing windows must not quit it

  const userData = app.getPath('userData');
  const store = createStore({ file: path.join(userData, 'settings.json') });
  const secrets = createSecrets({ file: path.join(userData, 'keys.json'), safeStorage });
  // The end-to-end test passes its own account and server, so that it never signs in to Google or calls the real
  // server, and its own cloud.json values, so that it does not depend on this Mac's.
  const cloudConfig = options.cloudConfig === undefined ? loadCloudConfig() : options.cloudConfig;
  const account = options.account || createAccount({
    file: path.join(userData, 'account.json'),
    safeStorage,
    config: cloudConfig,
    openBrowser: (url) => shell.openExternal(url),
  });
  const cloud = options.cloud || createCloud({ config: cloudConfig, account, store });
  const ai = createAi({ store, secrets, cloud, account });
  const helper = options.helper || new Helper({ binPath: helperPath() });
  helper.start();
  // The end-to-end test passes its own, so that it never grabs the person's real shortcut.
  const globalShortcut = options.globalShortcut || systemShortcut;

  const characters = loadCharacters();
  let tray = null;
  const buddy = createBuddyWindow({
    store,
    screen,
    animate: options.animate !== false,
    onGiveUp: () => tray?.refresh(), // the page crashed again and again, and the window is gone: the menu must say so
  });
  const bubble = createBubbleWindow();
  const panel = createPanelWindow();
  const windows = createSettingsWindows({ app });
  const openSettings = () => windows.open('settings');
  installAppMenu({ windows }); // Edit keys in the text boxes, Cmd+W for Settings and Welcome, and no Cmd+Q

  const actions = createActions({
    helper,
    ai,
    // The end-to-end test passes its own, so that it never reads or overwrites the person's real clipboard.
    clipboard: options.clipboard || clipboard,
    store,
    ui: {
      showPanel: (state) => panel.show(state, buddy.bounds(), buddy.display().workArea),
      hidePanel: () => panel.hide(),
      isPanelVisible: () => panel.isVisible(),
      panelJustClosed: () => panel.justClosed(),
      bubble: (text) => bubble.say(text, buddy.bounds(), buddy.display().workArea),
      mood: (name) => buddy.mood(name),
    },
  });
  const onCall = () => {
    // The shortcut is let go while Buddy is off. This is the second guard, for a press that was already on its way.
    if (!power.isOn()) return;
    actions.toggle().catch((err) => console.error('[buddy] could not open the panel', err));
  };

  // The shortcut is taken only while Buddy is on: it opens the panel, and the panel reads the person's selection.
  const shortcut = createShortcut({ globalShortcut, onPress: onCall });
  function takeShortcut() {
    const accelerator = store.get('shortcut');
    if (!shortcut.register(accelerator)) console.warn(`[buddy] could not register the shortcut ${accelerator}`);
  }

  const power = createPower({
    store,
    // None in a development run, which would register Electron.app; the end-to-end test passes its own.
    loginItems: options.loginItems || loginItemsFor(app),
    onChange(on) {
      if (on) {
        takeShortcut();
        buddy.show();
        buddy.mood('wave');
      } else {
        shortcut.unregister();
        panel.hide();
        buddy.hide();
      }
      tray.refresh();
    },
  });

  tray = createTray({
    getState: () => ({ buddyOn: power.isOn(), visible: buddy.isVisible() }),
    handlers: {
      setVisible(visible) {
        if (visible) buddy.show();
        else buddy.hide();
        tray.refresh();
      },
      openSettings,
      setBuddyOn: (on) => power.setOn(on),
      quit: () => app.quit(),
    },
  });

  // Signing out forgets this person's free-mode settings, so that the next person does not inherit them.
  account.onChange(() => {
    if (!account.isSignedIn()) cloud.forget();
    tray.refresh();
  });
  cloud.onChange(() => tray.refresh());

  registerBuddyIpc({ ipcMain, buddy, characters, store, onClick: onCall });
  registerPanelIpc({ ipcMain, panel, actions, openSettings });
  registerSettingsIpc({
    ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut,
    account, cloud, canSignIn: Boolean(cloudConfig),
    onFinishOnboarding() {
      windows.close('onboarding');
      buddy.reloadModel();
      power.setOn(true);
    },
  });

  app.on('second-instance', openSettings);
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    helper.stop();
  });

  powerMonitor.on('lock-screen', () => buddy.pause(true));
  powerMonitor.on('unlock-screen', () => {
    if (buddy.isVisible()) buddy.pause(false);
  });
  screen.on('display-removed', () => buddy.reclamp());
  screen.on('display-metrics-changed', () => buddy.reclamp());

  // This person's free-mode settings, fetched once at launch, so that Settings and the menu are up to date.
  if (account.isSignedIn()) {
    cloud.settings({ force: true }).catch((err) => console.warn('[buddy] could not fetch the free settings:', err.code || err.name));
  }

  if (store.get('onboarded')) {
    power.syncAtLaunch();
    if (power.isOn()) {
      takeShortcut();
      buddy.show();
      buddy.mood('wave');
    }
    // Nobody can use Buddy signed out: Settings has the Sign in button.
    if (!account.isSignedIn()) openSettings();
  } else {
    windows.open('onboarding');
  }
  tray.refresh();

  return { store, secrets, account, cloud, ai, helper, characters, buddy, bubble, panel, windows, actions, power, tray, shortcut };
}

module.exports = { start };
```

- [ ] **Step 8: The end-to-end test's account and server**

In `test/e2e/smoke.js`:

1. After `const path = require('node:path');` add:

```js
const { BuddyError } = require('../../shared/errors');
```

2. After the `globalShortcut` fake (the object ending with `unregisterAll() { … },\n};`) add:

```js
// Nor may it sign in to Google or call Buddy's server: the app gets this account and this server. A check changes
// cloud.free to see the app follow the admin's switches, and signs out and in again.
const account = {
  signedIn: true,
  listeners: [],
  isSignedIn() {
    return this.signedIn;
  },
  user() {
    return this.signedIn ? { uid: 'e2e-user', email: 'e2e@example.com', name: 'E2E Tester' } : null;
  },
  async signIn() {
    this.signedIn = true;
    for (const fn of this.listeners) fn();
    return this.user();
  },
  signOut() {
    this.signedIn = false;
    for (const fn of this.listeners) fn();
  },
  async idToken() {
    if (!this.signedIn) throw new BuddyError('signed_out', 'Sign in to use Buddy.');
    return 'e2e-token';
  },
  onChange(fn) {
    this.listeners.push(fn);
  },
};

const cloud = {
  free: { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false },
  asks: [],
  listeners: [],
  last() {
    return account.signedIn ? this.free : null;
  },
  async settings() {
    return this.last();
  },
  forget() {
    for (const fn of this.listeners) fn();
  },
  async ask(action, input) {
    this.asks.push({ action, input });
    return { text: 'A free answer', model: 'free-model' };
  },
  onChange(fn) {
    this.listeners.push(fn);
  },
};

// cloud.json's values: the account and the server above are what use them, so they only make Buddy "set up".
const cloudConfig = { serverUrl: 'https://e2e.invalid', firebaseApiKey: 'e2e', googleClientId: 'e2e', googleClientSecret: 'e2e' };
```

3. In the `start({ ... })` call add `account, cloud, cloudConfig,` after `globalShortcut,`.

- [ ] **Step 9: The end-to-end check for sign-in and free mode**

Create `test/e2e/checks/70-account.js`:

```js
'use strict';

// Phase 2 in the real app, with the fake account and server from smoke.js (ctx.account, ctx.cloud): Settings shows who
// is signed in and what free mode means for them; the panel uses the free route when free mode is on and sends a
// signed-out person to Settings; and the Welcome cannot be finished signed out.
module.exports = async function accountCheck(ctx, { assert, waitFor }) {
  const free = { ...ctx.cloud.free };
  const settings = ctx.windows.open('settings');
  const page = (script) => settings.webContents.executeJavaScript(script);
  const loaded = () => page("document.getElementById('account-line').textContent !== ''").catch(() => false);
  /** Load Settings again (it reads the free settings as it opens), and wait for the new page, not the old one. */
  async function reload() {
    await page('window.__old = true');
    settings.webContents.reload();
    await waitFor(async () => (await page('!window.__old').catch(() => false)) && loaded(), 'Settings to load again');
  }
  const aiCard = () => page(`({
    note: document.getElementById('ai-note').hidden ? null : document.getElementById('ai-note').textContent,
    form: !document.getElementById('ai').hidden,
  })`);
  const accountButtons = () => page("[document.getElementById('sign-in').hidden, document.getElementById('sign-out').hidden]");

  try {
    await waitFor(loaded, 'the Settings window to load');
    assert.strictEqual(await page("document.getElementById('account-line').textContent"), 'Signed in as E2E Tester (e2e@example.com)');
    assert.deepStrictEqual(await accountButtons(), [true, false], 'Sign out is offered');

    // The AI card follows the admin's switches.
    assert.deepStrictEqual(await aiCard(), { note: null, form: true }, 'free mode off: the key form');
    for (const [change, expected] of [
      [{ freeOn: true, limitMode: 'unlimited', limit: null }, { note: 'Free AI is on. No key needed.', form: false }],
      [{ freeOn: true, usedToday: 4 }, { note: 'You get 30 free requests a day. Used today: 4.', form: false }],
      [{ freeOn: true, usedToday: 4, allowOwnKey: true }, {
        note: 'You get 30 free requests a day. Used today: 4. Add your own key to keep going after your free requests run out.',
        form: true,
      }],
    ]) {
      ctx.cloud.free = { ...free, ...change };
      await reload();
      assert.deepStrictEqual(await aiCard(), expected, JSON.stringify(change));
    }

    // With free mode on, the panel's answer comes from the server.
    ctx.cloud.free = { ...free, freeOn: true, limitMode: 'unlimited', limit: null };
    await ctx.actions.toggle();
    const panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
    const ran = await panel.webContents.executeJavaScript("window.buddy.run('write', { instruction: 'mail to my boss', tone: 'formal' })");
    assert.deepStrictEqual(ran, { ok: true, result: { text: 'A free answer', model: 'free-model' } });
    assert.deepStrictEqual(ctx.cloud.asks.at(-1), { action: 'write', input: { instruction: 'mail to my boss', tone: 'formal' } });

    // Signed out: Settings offers Sign in, and the panel sends the person there.
    ctx.account.signOut();
    await reload();
    assert.deepStrictEqual(await accountButtons(), [false, true], 'Sign in is offered');
    assert.deepStrictEqual(await aiCard(), { note: null, form: true }, 'signed out: no free settings apply');
    await panel.webContents.executeJavaScript(
      "document.getElementById('write-text').value = 'mail to my boss'; document.getElementById('write-go').click();",
    );
    await waitFor(() => panel.webContents.executeJavaScript("!document.getElementById('error').hidden"), 'the error to show');
    assert.deepStrictEqual(
      await panel.webContents.executeJavaScript("[document.getElementById('error').textContent, !document.getElementById('error-settings').hidden]"),
      ['Sign in to use Buddy.', true],
    );
    ctx.panel.hide();

    // Signing in from Settings.
    await page("document.getElementById('sign-in').click()");
    await waitFor(() => page("document.getElementById('sign-out').hidden === false"), 'Settings to show the person signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
  } finally {
    ctx.cloud.free = free;
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.panel.hide();
    ctx.windows.close('settings');
    await waitFor(() => settings.isDestroyed(), 'the Settings window to close');
  }

  // The Welcome cannot be finished signed out; its Sign in button signs the person in and lets them go on.
  ctx.account.signOut();
  const welcome = ctx.windows.open('onboarding');
  const w = (script) => welcome.webContents.executeJavaScript(script);
  try {
    await waitFor(() => w("document.getElementById('next')?.disabled === true").catch(() => false), 'the Welcome window, with Next off');
    assert.deepStrictEqual(await w('window.buddy.finishOnboarding({})'),
      { ok: false, error: { code: 'signed_out', message: 'Sign in with Google first.' } });
    await w("document.getElementById('sign-in').click()");
    await waitFor(() => w("document.getElementById('next').disabled === false"), 'Next to come on once signed in');
    assert.strictEqual(ctx.account.isSignedIn(), true);
  } finally {
    if (!ctx.account.isSignedIn()) await ctx.account.signIn();
    ctx.windows.close('onboarding');
    await waitFor(() => welcome.isDestroyed(), 'the Welcome window to close');
  }
};
```

- [ ] **Step 10: Run everything**

Run: `npm test` — Expected: lint clean, all unit tests pass.

Run: `npm run test:e2e` — Expected: every check prints `ok - …`, including `ok - 70-account.js`, then `e2e: all checks passed`. (It opens Buddy's windows on screen for a few seconds, with fakes only.)

- [ ] **Step 11: Commit**

```bash
git add src/main/ipc/settings.js test/settings-ipc.test.js src/preload/settings.js src/renderer/settings src/renderer/onboarding \
  src/renderer/panel/panel.js src/main/main.js test/e2e/smoke.js test/e2e/checks/70-account.js
git commit -m "feat: sign in first, and Settings, the Welcome and the panel follow the admin's free mode"
```

---
### Task 6: The Admin window

**Files:**
- Modify: `src/main/settings-windows.js`, `test/settings-windows.test.js`
- Create: `src/preload/admin.js`
- Create: `src/main/ipc/admin.js`, `test/admin-ipc.test.js`
- Modify: `src/main/ipc/settings.js` (its windows only), `test/settings-ipc.test.js` (the fake `owns`, one test)
- Modify: `src/main/tray.js`, `test/tray.test.js`
- Modify: `src/main/app-menu.js` (comments only)
- Modify: `src/main/main.js`
- Create: `src/renderer/admin/index.html`, `src/renderer/admin/admin.js`, `src/renderer/admin/admin.css`
- Modify: `test/e2e/smoke.js`; Create: `test/e2e/checks/75-admin.js`

**Interfaces:**
- Consumes: Task 4 `cloud.admin.settings() → { config, providers }`, `cloud.admin.save(patch) → { config, providers }`, `cloud.admin.models(provider) → { models, live, warning? }`, `cloud.admin.users() → { users }`, `cloud.admin.block(uid, blocked) → { user }`, `cloud.settings({ force })`, `cloud.last().isAdmin`; Task 5's `start()` context.
- Produces: window kind `'admin'` (its own preload `src/preload/admin.js`); IPC `admin:settings`, `admin:save`, `admin:models`, `admin:users`, `admin:block` (admin window only); `buildMenuTemplate({ buddyOn, visible, isAdmin }, handlers)` with `handlers.openAdmin`; `start()` context gains `trayState()`.

- [ ] **Step 1: Write the failing tests for the window, the menu and the IPC**

In `test/settings-windows.test.js`, append:

```js
test('the admin window opens its own page, with its own preload, sandboxed', () => {
  const { windows, created } = setup();
  windows.open('admin');
  const [admin] = created;
  assert.strictEqual(admin.options.title, 'Buddy Admin');
  assert.strictEqual(admin.file, path.join(SRC, 'renderer', 'admin', 'index.html'));
  assert.strictEqual(admin.options.webPreferences.preload, path.join(SRC, 'preload', 'admin.js'));
  assert.strictEqual(admin.options.webPreferences.sandbox, true);
  assert.strictEqual(admin.options.webPreferences.contextIsolation, true);
  assert.strictEqual(windows.owns(admin.webContents, 'admin'), true);
  assert.strictEqual(windows.owns(admin.webContents, 'settings'), false);
});
```

In `test/tray.test.js`, add `openAdmin: () => calls.push(['openAdmin']),` to the object `handlers()` returns (after `openSettings`), and append:

```js
test('the admin gets an Admin… item, above Settings…', () => {
  const h = handlers();
  const t = buildMenuTemplate({ buddyOn: true, visible: true, isAdmin: true }, h);
  assert.deepStrictEqual(labels(t), ['Hide buddy', 'Admin…', 'Settings…', 'Turn off buddy', 'Quit Buddy']);
  t.find((item) => item.label === 'Admin…').click();
  assert.deepStrictEqual(h.calls, [['openAdmin']]);
});
```

Create `test/admin-ipc.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerAdminIpc } = require('../src/main/ipc/admin');

const ADMIN_PAGE = 'the admin page';

/** registerAdminIpc with a fake server: `calls` records what reached it; `fails` makes every admin call fail. */
function setup({ fails = null } = {}) {
  const handlers = {};
  const calls = [];
  const answer = (name, value) => async (...args) => {
    calls.push([name, ...args]);
    if (fails) throw fails;
    return value;
  };
  const cloud = {
    admin: {
      settings: answer('settings', { config: { enabled: false }, providers: [] }),
      save: answer('save', { config: { enabled: true }, providers: [] }),
      models: answer('models', { models: ['m'], live: true }),
      users: answer('users', { users: [] }),
      block: answer('block', { user: { uid: 'u1', blocked: true } }),
    },
    async settings(options) {
      calls.push(['refresh', options]);
      return null;
    },
  };
  registerAdminIpc({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    windows: { owns: (webContents, kind) => kind === 'admin' && webContents === ADMIN_PAGE },
    cloud,
  });
  const call = (channel, ...args) => handlers[channel]({ sender: ADMIN_PAGE }, ...args);
  return { handlers, calls, call };
}

test('only the admin window may use these calls', async () => {
  const s = setup();
  assert.deepStrictEqual(Object.keys(s.handlers).sort(), ['admin:block', 'admin:models', 'admin:save', 'admin:settings', 'admin:users']);
  for (const channel of Object.keys(s.handlers)) {
    assert.deepStrictEqual(await s.handlers[channel]({ sender: 'the Settings page' }, 'u1', true),
      { ok: false, error: { code: 'not_allowed', message: 'Not allowed.' } }, channel);
  }
  assert.deepStrictEqual(s.calls, []);
});

test('each call goes to the server, and its answer comes back', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('admin:settings'), { ok: true, config: { enabled: false }, providers: [] });
  assert.deepStrictEqual(await s.call('admin:models', 'groq'), { ok: true, models: ['m'], live: true });
  assert.deepStrictEqual(await s.call('admin:users'), { ok: true, users: [] });
  assert.deepStrictEqual(await s.call('admin:block', 'u1', true), { ok: true, user: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual(s.calls, [['settings'], ['models', 'groq'], ['users'], ['block', 'u1', true]]);
});

test("saving sends the switches, and the admin's own app follows them at once", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('admin:save', { enabled: true }), { ok: true, config: { enabled: true }, providers: [] });
  assert.deepStrictEqual(s.calls, [['save', { enabled: true }], ['refresh', { force: true }]]);
});

test('arguments that are not valid are refused before the server is asked', async () => {
  const s = setup();
  for (const [channel, args, message] of [
    ['admin:save', ['text'], 'Those settings are not valid.'],
    ['admin:save', [null], 'Those settings are not valid.'],
    ['admin:models', ['constructor'], 'Unknown AI provider.'],
    ['admin:block', ['', true], 'Pick a user to block or unblock.'],
    ['admin:block', ['u1', 'yes'], 'Pick a user to block or unblock.'],
    ['admin:block', [7, true], 'Pick a user to block or unblock.'],
  ]) {
    assert.deepStrictEqual(await s.call(channel, ...args), { ok: false, error: { code: 'bad_request', message } }, `${channel} ${JSON.stringify(args)}`);
  }
  assert.deepStrictEqual(s.calls, []);
});

test("the server's refusal reaches the page in its own words", async () => {
  const s = setup({ fails: new BuddyError('not_admin', 'Only the admin can do this.') });
  assert.deepStrictEqual(await s.call('admin:users'), { ok: false, error: { code: 'not_admin', message: 'Only the admin can do this.' } });
});
```

In `test/settings-ipc.test.js`:

1. After `const WELCOME_PAGE = 'welcome';` add `const ADMIN_PAGE = 'admin';`.
2. Replace the fake `windows` in `setup` with:

```js
    windows: {
      // 'ours' is the Settings window's page, 'welcome' the Welcome window's and 'admin' the Admin window's.
      // owns(page, kind) asks about one kind; with no kind, about any of them.
      owns: (webContents, kind) => (kind === undefined
        ? [SETTINGS_PAGE, WELCOME_PAGE, ADMIN_PAGE].includes(webContents)
        : webContents === { settings: SETTINGS_PAGE, onboarding: WELCOME_PAGE, admin: ADMIN_PAGE }[kind]),
    },
```

3. Append:

```js
test('the Admin window cannot use the Settings channels', async () => {
  const s = setup();
  for (const channel of Object.keys(s.handlers)) {
    assert.deepStrictEqual(await s.handlers[channel]({ sender: ADMIN_PAGE }), refused('not_allowed', 'Not allowed.'), channel);
  }
  assert.deepStrictEqual(s.calls, []);
});
```

Run: `node --test test/settings-windows.test.js test/tray.test.js test/admin-ipc.test.js test/settings-ipc.test.js` — Expected: FAIL: no admin kind (title undefined), no Admin… item, `Cannot find module '../src/main/ipc/admin'`, and the Settings channels answer the Admin page.

- [ ] **Step 2: The window kind, the menu item, the IPC**

In `src/main/settings-windows.js`:

1. Change the first comment to `/** The Settings, Welcome and Admin windows: ordinary windows, at most one of each. */`.
2. Replace `KINDS` with:

```js
const KINDS = {
  settings: { title: 'Buddy Settings', width: 520, height: 720, preload: 'settings.js' },
  onboarding: { title: 'Welcome to Buddy', width: 520, height: 620, preload: 'settings.js' },
  admin: { title: 'Buddy Admin', width: 680, height: 780, preload: 'admin.js' },
};
```

3. Replace `const { title, width, height } = KINDS[kind];` with `const { title, width, height, preload } = KINDS[kind];` and the `preload:` line with:

```js
          preload: path.join(__dirname, '..', 'preload', preload),
```

4. Change the `owns` doc comment to: `/** Is this page one of these windows' own? With a `kind` ('settings', 'onboarding' or 'admin'), only that kind counts. */`

Create `src/preload/admin.js`:

```js
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('buddy', {
  settings: () => ipcRenderer.invoke('admin:settings'),
  save: (patch) => ipcRenderer.invoke('admin:save', patch),
  models: (provider) => ipcRenderer.invoke('admin:models', provider),
  users: () => ipcRenderer.invoke('admin:users'),
  block: (uid, blocked) => ipcRenderer.invoke('admin:block', uid, blocked),
});
```

Create `src/main/ipc/admin.js`:

```js
'use strict';

/**
 * IPC for the Admin window. Every call goes to Buddy's server, which decides whether the signed-in person is the
 * admin and refuses everyone else; the app only uses the server's answer to show the "Admin…" menu item.
 */

const { BuddyError } = require('../../../shared/errors');
const { PROVIDER_IDS } = require('../../../shared/providers');
const { guarded } = require('./result');

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

function registerAdminIpc({ ipcMain, windows, cloud }) {
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents, 'admin'));

  handle('admin:settings', () => cloud.admin.settings());

  handle('admin:save', async (patch) => {
    if (!isPlainObject(patch)) throw new BuddyError('bad_request', 'Those settings are not valid.');
    const saved = await cloud.admin.save(patch);
    // The admin's own app follows the new switches at once; every other app does on its next check.
    cloud.settings({ force: true }).catch(() => {});
    return saved;
  });

  handle('admin:models', (provider) => {
    if (!PROVIDER_IDS.includes(provider)) throw new BuddyError('bad_request', 'Unknown AI provider.');
    return cloud.admin.models(provider);
  });

  handle('admin:users', () => cloud.admin.users());

  handle('admin:block', (uid, blocked) => {
    if (typeof uid !== 'string' || !uid || typeof blocked !== 'boolean') {
      throw new BuddyError('bad_request', 'Pick a user to block or unblock.');
    }
    return cloud.admin.block(uid, blocked);
  });
}

module.exports = { registerAdminIpc };
```

In `src/main/ipc/settings.js`, replace

```js
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents));
```

with

```js
  // The Settings and Welcome windows only: the Admin window has calls of its own (ipc/admin.js).
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents, 'settings') || windows.owns(webContents, 'onboarding'));
```

In `src/main/tray.js`, replace `buildMenuTemplate` with:

```js
function buildMenuTemplate({ buddyOn, visible, isAdmin = false }, handlers) {
  return [
    { label: visible ? 'Hide buddy' : 'Show buddy', enabled: buddyOn, click: () => handlers.setVisible(!visible) },
    // Only for the admin; the server refuses the admin's calls to anyone else whatever the menu shows.
    ...(isAdmin ? [{ label: 'Admin…', click: () => handlers.openAdmin() }] : []),
    { label: 'Settings…', click: () => handlers.openSettings() },
    { type: 'separator' },
    { label: buddyOn ? 'Turn off buddy' : 'Turn on buddy', click: () => handlers.setBuddyOn(!buddyOn) },
    { type: 'separator' },
    { label: 'Quit Buddy', click: () => handlers.quit() },
  ];
}
```

In `src/main/app-menu.js`, change the comment line ` *   - Cmd+W, which closes the focused Settings or Welcome window and nothing else;` to ` *   - Cmd+W, which closes the focused Settings, Welcome or Admin window and nothing else;`, and the doc comment of `installAppMenu` to `` /** `windows` is the Settings, Welcome and Admin windows (settings-windows.js); Menu can be passed in so that tests need no Electron. */ ``.

Run: `node --test test/settings-windows.test.js test/tray.test.js test/admin-ipc.test.js test/settings-ipc.test.js test/app-menu.test.js` — Expected: PASS.

- [ ] **Step 3: The Admin page**

Create `src/renderer/admin/index.html`:

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self'; style-src 'self'; script-src 'self'">
  <title>Buddy Admin</title>
  <link rel="stylesheet" href="../common/base.css">
  <link rel="stylesheet" href="admin.css">
</head>
<body>
<main>
  <p id="load-error" class="error" hidden></p>

  <section id="free-card" class="card">
    <h2>Free AI</h2>
    <p class="muted">These switches apply to every Buddy app and every user, the next time they open Buddy.</p>
    <p id="no-keys" class="error" hidden>No AI key is set on the server yet, so free mode can't be turned on.</p>

    <label class="check"><input id="enabled" type="checkbox"> Free mode: everyone uses your AI key</label>

    <label class="check"><input type="radio" name="limitMode" value="unlimited"> Unlimited</label>
    <label class="check"><input type="radio" name="limitMode" value="daily"> Daily limit</label>
    <div id="daily-row" class="row indent">
      <input id="daily" type="number" min="1" max="10000" step="1">
      <span class="muted grow">free requests per user per day</span>
    </div>
    <label id="own-row" class="check indent"><input id="own" type="checkbox"> Also let users add their own key (used after their free requests run out)</label>

    <label for="provider">AI provider</label>
    <select id="provider"></select>
    <label for="model">Model</label>
    <div class="row">
      <select id="model"></select>
      <button id="models-refresh" type="button">Refresh</button>
    </div>
    <p id="models-note" class="muted"></p>

    <div class="row">
      <button id="save" class="primary" type="button">Save</button>
      <span id="save-status" class="muted"></span>
    </div>
  </section>

  <section id="users-card" class="card">
    <div class="row">
      <h2 class="grow">Users</h2>
      <button id="users-refresh" type="button">Refresh</button>
    </div>
    <p id="users-status" class="muted"></p>
    <table>
      <thead><tr><th>Name</th><th>Email</th><th class="num">Today</th><th>Last active</th><th></th></tr></thead>
      <tbody id="users"></tbody>
    </table>
  </section>
</main>
<script src="admin.js"></script>
</body>
</html>
```

Create `src/renderer/admin/admin.css`:

```css
label.check { display: flex; align-items: center; gap: 8px; margin: 8px 0; font-weight: normal; }
.indent { margin-left: 26px; }
input[type="number"] {
  font: inherit; width: 110px; flex: none; padding: 7px 9px; border-radius: 8px;
  border: 1px solid var(--line); background: var(--card); color: var(--fg);
}
table { width: 100%; border-collapse: collapse; margin-top: 8px; }
th, td { text-align: left; padding: 6px 4px; border-bottom: 1px solid var(--line); vertical-align: middle; }
th { font-weight: 600; color: var(--muted); }
.num { text-align: right; }
tr.blocked td { color: var(--muted); }
td button { padding: 3px 10px; }
```

Create `src/renderer/admin/admin.js`:

```js
'use strict';

const $ = (id) => document.getElementById(id);
let view = null; // { config, providers }, as the server last answered

function status(id, text, kind = 'muted') {
  $(id).textContent = text;
  $(id).className = kind;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** The daily box and "own key" belong to a daily limit only. */
function syncForm() {
  const daily = document.querySelector('input[name="limitMode"]:checked')?.value === 'daily';
  $('daily-row').hidden = !daily;
  $('own-row').hidden = !daily;
}

/** `models` in the model list, with `chosen` selected (and kept in the list even when the server no longer lists it). */
function fillModels(models, chosen) {
  const list = models.includes(chosen) ? models : [chosen, ...models];
  $('model').replaceChildren(...list.map((m) => el('option', { value: m, textContent: m, selected: m === chosen })));
}

async function loadModels(provider, chosen) {
  const known = view.providers.find((p) => p.id === provider);
  fillModels(known ? known.fallbackModels : [], chosen);
  status('models-note', 'Loading the models…');
  const r = await window.buddy.models(provider);
  if ($('provider').value !== provider) return; // the admin picked another provider meanwhile
  if (!r.ok) {
    status('models-note', r.error.message, 'error');
    return;
  }
  fillModels(r.models, $('model').value || chosen);
  if (r.warning) status('models-note', r.warning, 'error');
  else status('models-note', r.live ? '' : 'The usual models for this provider.');
}

function render() {
  const { config, providers } = view;
  const withKey = providers.filter((p) => p.hasKey);
  $('no-keys').hidden = withKey.length > 0;
  $('enabled').checked = config.enabled;
  $('enabled').disabled = withKey.length === 0 && !config.enabled;
  for (const radio of document.querySelectorAll('input[name="limitMode"]')) radio.checked = radio.value === config.limitMode;
  $('daily').value = String(config.dailyRequests);
  $('own').checked = config.allowOwnKey;
  // Only providers with a key on the server can be picked, plus the saved one, so that the list shows what is saved.
  const choices = providers.filter((p) => p.hasKey || p.id === config.provider);
  $('provider').replaceChildren(...choices.map((p) => el('option', {
    value: p.id,
    textContent: p.hasKey ? p.label : `${p.label} (no key on the server)`,
    selected: p.id === config.provider,
  })));
  syncForm();
  loadModels(config.provider, config.model);
}

function readForm() {
  return {
    enabled: $('enabled').checked,
    limitMode: document.querySelector('input[name="limitMode"]:checked')?.value || 'daily',
    dailyRequests: Number($('daily').value),
    allowOwnKey: $('own').checked,
    provider: $('provider').value,
    model: $('model').value,
  };
}

function when(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

function renderUsers(users) {
  status('users-status', users.length === 1 ? '1 user' : `${users.length} users`);
  $('users').replaceChildren(...users.map((user) => {
    const button = el('button', { type: 'button', textContent: user.blocked ? 'Unblock' : 'Block' });
    button.addEventListener('click', () => setBlocked(user, button));
    return el('tr', { className: user.blocked ? 'blocked' : '' }, [
      el('td', { textContent: user.name || '—' }),
      el('td', { textContent: user.email }),
      el('td', { className: 'num', textContent: String(user.usedToday) }),
      el('td', { textContent: when(user.lastActive) }),
      el('td', {}, [button]),
    ]);
  }));
}

async function loadUsers() {
  status('users-status', 'Loading…');
  const r = await window.buddy.users();
  if (!r.ok) {
    status('users-status', r.error.message, 'error');
    return;
  }
  renderUsers(r.users);
}

async function setBlocked(user, button) {
  button.disabled = true;
  const r = await window.buddy.block(user.uid, !user.blocked);
  if (!r.ok) {
    button.disabled = false;
    status('users-status', r.error.message, 'error');
    return;
  }
  await loadUsers();
}

for (const radio of document.querySelectorAll('input[name="limitMode"]')) radio.addEventListener('change', syncForm);
$('provider').addEventListener('change', () => {
  const p = view.providers.find((x) => x.id === $('provider').value);
  loadModels(p.id, p.fallbackModels[0]);
});
$('models-refresh').addEventListener('click', () => loadModels($('provider').value, $('model').value));
$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  status('save-status', 'Saving…');
  const r = await window.buddy.save(readForm());
  $('save').disabled = false;
  if (!r.ok) {
    status('save-status', r.error.message, 'error');
    return;
  }
  view = r;
  render();
  status('save-status', 'Saved ✓ Every Buddy app uses it from now on.', 'good');
});
$('users-refresh').addEventListener('click', loadUsers);

(async () => {
  const r = await window.buddy.settings();
  if (!r.ok) {
    $('load-error').textContent = r.error.message;
    $('load-error').hidden = false;
    $('free-card').hidden = true;
    $('users-card').hidden = true;
    return;
  }
  view = r;
  render();
  await loadUsers();
})();
```

- [ ] **Step 4: Wire it into the app**

In `src/main/main.js`:

1. After `const { registerSettingsIpc } = require('./ipc/settings');` add `const { registerAdminIpc } = require('./ipc/admin');`.
2. Replace the `tray = createTray({ … });` statement with:

```js
  // "Admin…" is in the menu for the admin only: the server says who that is (and refuses the admin's calls to
  // anyone else, whatever the menu shows).
  const trayState = () => ({
    buddyOn: power.isOn(),
    visible: buddy.isVisible(),
    isAdmin: account.isSignedIn() && cloud.last()?.isAdmin === true,
  });
  tray = createTray({
    getState: trayState,
    handlers: {
      setVisible(visible) {
        if (visible) buddy.show();
        else buddy.hide();
        tray.refresh();
      },
      openSettings,
      openAdmin: () => windows.open('admin'),
      setBuddyOn: (on) => power.setOn(on),
      quit: () => app.quit(),
    },
  });
```

3. Replace the `account.onChange(…)` statement with:

```js
  // Signing out forgets this person's free-mode settings, so that the next person does not inherit them, and closes
  // the Admin window.
  account.onChange(() => {
    if (!account.isSignedIn()) {
      cloud.forget();
      windows.close('admin');
    }
    tray.refresh();
  });
```

4. After the `registerSettingsIpc({ … });` statement add `registerAdminIpc({ ipcMain, windows, cloud });`.
5. In the `return { … }` add `trayState` after `tray`.
6. Change the comment after `installAppMenu({ windows });` to `// Edit keys in the text boxes, Cmd+W for Settings, Welcome and Admin, and no Cmd+Q`.

- [ ] **Step 5: The end-to-end check for the Admin window**

In `test/e2e/smoke.js`:

1. After the `BuddyError` require add `const { PROVIDERS, PROVIDER_IDS } = require('../../shared/providers');`.
2. In the `cloud` fake, after `asks: [],` add:

```js
  adminConfig: { enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'claude-haiku-4-5-20251001' },
  adminUsers: [{
    uid: 'u1', email: 'rahul@example.com', name: 'Rahul', joined: '2026-10-01T10:00:00.000Z',
    lastActive: '2026-10-07T06:00:00.000Z', blocked: false, usedToday: 3,
  }],
  admin: {
    async settings() {
      return {
        config: cloud.adminConfig,
        providers: PROVIDER_IDS.map((id) => ({
          id, label: PROVIDERS[id].label, hasKey: id === 'anthropic', fallbackModels: PROVIDERS[id].fallbackModels,
        })),
      };
    },
    async save(patch) {
      if (patch.dailyRequests === 0) throw new BuddyError('bad_request', 'The daily limit must be a whole number from 1 to 10000.');
      cloud.adminConfig = { ...cloud.adminConfig, ...patch };
      return cloud.admin.settings();
    },
    async models() {
      return { models: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5'], live: true };
    },
    async users() {
      return { users: cloud.adminUsers };
    },
    async block(uid, blocked) {
      const user = cloud.adminUsers.find((u) => u.uid === uid);
      user.blocked = blocked;
      return { user };
    },
  },
```

Create `test/e2e/checks/75-admin.js`:

```js
'use strict';

// The Admin window with the fake server from smoke.js: the menu offers it only to the admin; it shows the switches
// and the users; Save sends the switches and shows a refusal in plain words; Block blocks; signing out closes it.
module.exports = async function adminCheck(ctx, { assert, waitFor }) {
  const free = { ...ctx.cloud.free };
  assert.strictEqual(ctx.trayState().isAdmin, false, 'no Admin… for someone who is not the admin');
  ctx.cloud.free = { ...free, isAdmin: true };
  assert.strictEqual(ctx.trayState().isAdmin, true, 'Admin… for the admin');

  const win = ctx.windows.open('admin');
  const page = (script) => win.webContents.executeJavaScript(script);
  try {
    await waitFor(() => page("document.getElementById('users').children.length === 1").catch(() => false), 'the Admin window to show the users');
    assert.strictEqual(await page("document.getElementById('enabled').checked"), false);
    assert.strictEqual(await page("document.getElementById('provider').value"), 'anthropic');
    assert.strictEqual(await page("document.getElementById('users').textContent.includes('rahul@example.com')"), true);

    await page(`
      document.getElementById('enabled').checked = true;
      document.querySelector('input[name="limitMode"][value="daily"]').checked = true;
      document.getElementById('daily').value = '10';
      document.getElementById('own').checked = true;
      document.getElementById('save').click();
    `);
    await waitFor(() => page("document.getElementById('save-status').textContent.startsWith('Saved')"), 'the switches to be saved');
    assert.deepStrictEqual({ ...ctx.cloud.adminConfig }, {
      enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
    });

    await page("document.getElementById('daily').value = '0'; document.getElementById('save').click();");
    await waitFor(() => page("document.getElementById('save-status').className === 'error'"), 'the refusal');
    assert.strictEqual(await page("document.getElementById('save-status').textContent"), 'The daily limit must be a whole number from 1 to 10000.');

    await page("document.querySelector('#users button').click()");
    await waitFor(() => page("document.querySelector('#users button').textContent === 'Unblock'"), 'the user to show as blocked');
    assert.strictEqual(ctx.cloud.adminUsers[0].blocked, true);
  } finally {
    ctx.windows.close('admin');
    await waitFor(() => win.isDestroyed(), 'the Admin window to close');
  }

  // Signing out closes the Admin window.
  const again = ctx.windows.open('admin');
  await waitFor(() => again.webContents.executeJavaScript("document.getElementById('users') !== null").catch(() => false),
    'the Admin window to load again');
  ctx.account.signOut();
  await waitFor(() => again.isDestroyed(), 'signing out to close the Admin window');
  await ctx.account.signIn();
  ctx.cloud.free = free;
  ctx.cloud.adminUsers[0].blocked = false;
};
```

- [ ] **Step 6: Run everything and commit**

Run: `npm test` — Expected: lint clean, all pass.

Run: `npm run test:e2e` — Expected: every check `ok`, including `ok - 75-admin.js`; `e2e: all checks passed`.

```bash
git add src/main/settings-windows.js test/settings-windows.test.js src/preload/admin.js src/main/ipc/admin.js test/admin-ipc.test.js \
  src/main/ipc/settings.js test/settings-ipc.test.js src/main/tray.js test/tray.test.js src/main/app-menu.js src/main/main.js \
  src/renderer/admin test/e2e/smoke.js test/e2e/checks/75-admin.js
git commit -m "feat: the Admin window: free mode's switches and the users list, for the admin only"
```

---

### Task 7: Go live (with the owner)

Done by the controller together with the owner, not by a subagent: it creates cloud resources in the owner's
accounts (ask before each), needs two console clicks only the owner can make, and the owner's AI key. Work on
the `phase-2-free` branch after Tasks 1–6 are merged into it.

**Files:**
- Create (not in git): `cloud.json`
- Modify: `electron-builder.config.js` (pack `cloud.json`), `build/afterPack.js`, `test/after-pack.test.js`
- Modify: `README.md`, `docs/manual-checklist.md`

- [ ] **Step 1: The database and its rules** (ask the owner first)

```bash
firebase firestore:databases:create "(default)" --location=asia-south1 --project buddy-7f8c2
firebase deploy --only firestore:rules --project buddy-7f8c2
```

Expected: the database is created; `✔ firestore: released rules web/firestore.rules to cloud.firestore`.

- [ ] **Step 2: The web API key**

```bash
firebase apps:create WEB "Buddy Mac" --project buddy-7f8c2
firebase apps:sdkconfig WEB <the App ID printed above> --project buddy-7f8c2
```

Expected: the config shows `apiKey: "AIza…"` — this is `firebaseApiKey`.

- [ ] **Step 3: The owner's console clicks** (already asked of the owner)

1. Firebase console → Security → Authentication → Get started → Sign-in method → Google → Enable → support email → Save.
2. https://console.cloud.google.com/apis/credentials?project=buddy-7f8c2 → Create credentials → OAuth client ID → Desktop app, name `Buddy Mac` → copy the Client ID and Client secret.

- [ ] **Step 4: The server's environment** (ask the owner first)

```bash
SA=$(gcloud iam service-accounts list --project buddy-7f8c2 --account akshatg9636@gmail.com \
  --filter="email~^firebase-adminsdk" --format="value(email)")
KEYDIR=$(mktemp -d)
KEY="$KEYDIR/sa.json"
gcloud iam service-accounts keys create "$KEY" --iam-account "$SA" --project buddy-7f8c2 --account akshatg9636@gmail.com
vercel project add buddy-server
cd web && vercel link --yes --project buddy-server && cd ..
vercel env add FIREBASE_SERVICE_ACCOUNT production --cwd web < "$KEY"
printf 'akshatg9636@gmail.com' | vercel env add ADMIN_EMAIL production --cwd web
rm -rf "$KEYDIR"
```

Then the owner adds their AI key themselves (it never passes through this conversation), for example:
`! vercel env add ANTHROPIC_API_KEY production --cwd web`

- [ ] **Step 5: Deploy and check**

```bash
npm run deploy:server
curl -s -o /dev/stderr -w '%{http_code}\n' https://<production domain>/api/config
```

Expected: `{"error":{"code":"unauthenticated","message":"Sign in to use Buddy."}}` and `401`. If Vercel answers with
its own login page instead (deployment protection), turn protection off for production in the project's settings.

- [ ] **Step 6: cloud.json**

Write `cloud.json` at the repository root from the values of Steps 2, 3 and 5 (shape: `cloud.example.json`).

- [ ] **Step 7: Pack cloud.json into the app (test first)**

In `test/after-pack.test.js`, change the first test's expected list to:

```js
  assert.deepStrictEqual(REQUIRED_IN_ASAR, [
    'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
    'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
    'cloud.json',
  ]);
```

rename that test to `'the three.js loader and environment, and cloud.json, are what the installed app needs'`, and in
the test `'an asar without them names each one that is missing'` change the `onlyLoader` assertion to:

```js
  assert.deepStrictEqual(missingFromAsar(onlyLoader), REQUIRED_IN_ASAR.slice(1));
```

Run: `node --test test/after-pack.test.js` — Expected: FAIL (the list has no `cloud.json`).

In `build/afterPack.js`, replace the comment above `REQUIRED_IN_ASAR` and the constant with:

```js
// What the installed app cannot do without, checked in app.asar: what the buddy page imports from three.js's examples
// through its import map (src/renderer/buddy/index.html) -- electron-builder leaves an `examples` folder out of
// node_modules on its own, and the file set in electron-builder.config.js puts these back -- and cloud.json, without
// which nobody can sign in (it is not in git: copy cloud.example.json and fill it in).
const REQUIRED_IN_ASAR = [
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
  'cloud.json',
];
```

and replace the error thrown when files are missing with:

```js
    throw new Error(
      `app.asar is missing ${missing.join(' and ')}. Without three.js's loader and environment the installed Buddy ` +
      "shows no robot (the file set for three.js's examples in electron-builder.config.js brings them in); without " +
      'cloud.json nobody can sign in (copy cloud.example.json to cloud.json and fill it in).'
    );
```

and the log line after it with `console.log('  • app.asar holds the three.js loader and environment, and cloud.json');`.

In `electron-builder.config.js`, add `'cloud.json',` to `files` right after `'package.json',`.

Run: `npm test` — Expected: PASS.

- [ ] **Step 8: Build, install and check with the owner**

Run: `npm run dist:mac`, install `release/mac-arm64/Buddy.app` (README "Install on your Mac"), and go through the new
"Phase 2" section of `docs/manual-checklist.md` (Step 9) with the owner.

- [ ] **Step 9: Docs**

Add to `docs/manual-checklist.md`:

```markdown
## Phase 2: sign-in and free mode
Run with the installed Buddy.app built with a real `cloud.json`, against the deployed server.
- [ ] First launch: the Welcome starts with "Sign in with Google"; Next stays off until you are signed in; the browser tab says "You're signed in to Buddy".
- [ ] Press Sign in, close the Google tab, press Sign in again: a new Google page opens and signing in there works.
- [ ] Settings → Account shows your name and email. Sign out → the panel says "Sign in to use Buddy." with Open Settings. Sign in again works.
- [ ] Restart the Mac: still signed in.
- [ ] Signed in as akshatg9636@gmail.com, the menu bar has "Admin…"; signed in with another Google account, it does not.
- [ ] Admin → Free mode on, Unlimited, Save. Reopen Settings: the AI card says "Free AI is on. No key needed." With no key saved, Write → Insert in Gmail works.
- [ ] Admin → Daily limit 2, Save. The third Write says "You've used today's 2 free requests. They come back at midnight."
- [ ] Admin → also let users add their own key. With a key saved, the third Write still answers; with none, it says to add one, with Open Settings.
- [ ] Admin → Users lists you, and "Today" counts up. Block → Write says "Your free access is paused."; Unblock → it works again.
- [ ] Admin → Free mode off, Save. Settings shows the key form again, and a key saved earlier is still there.
- [ ] Check screen with free mode on works (the free model can read screenshots).
- [ ] Wi-Fi off with free mode on: Write says "Couldn't reach Buddy's server. Check your internet." and the buddy looks sleepy.
- [ ] Firestore console: users/{uid} holds only email, name, joined, lastActive, blocked, usedDay and usedCount — no text.
```

Add a section to `README.md` after "Install on your Mac":

```markdown
## Sign-in and free mode

Everyone signs in with Google. The admin (akshatg9636@gmail.com) gets **Admin…** in the menu bar, to make Buddy
free for everyone with the server's AI key — unlimited or a number of requests a day — and to block people.

The server is in `web/` (Vercel + Firestore, project `buddy-7f8c2`); see `web/README.md`. The app finds it, and signs
in, with `cloud.json` at the repository root. It is not in git: copy `cloud.example.json` and fill it in. A build
without it fails (`build/afterPack.js`).

    npm run sync:web         # after changing shared/: the server keeps a copy in web/shared
    npm run test:firestore   # the server's database code against the Firestore emulator (needs Java)
    npm run deploy:server    # deploy the server
```

```bash
git add electron-builder.config.js build/afterPack.js test/after-pack.test.js README.md docs/manual-checklist.md
git commit -m "build: pack cloud.json into the app; docs for sign-in and free mode"
```
