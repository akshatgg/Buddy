# Buddy on iPhone: Own AI Key and Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the iPhone web app (`web/public/app/`) a Settings → AI section where a person saves their own AI key (used by the chat when free mode is off, paused or used up, exactly as the Mac routes it), and a Settings → Admin section that does what the Mac's Admin window does, for the admin only.

**Architecture:** `tools/sync-web-app.js` copies the shared AI providers and the Mac's free-mode words into `web/public/app/shared/` as ES modules. A pure `route.js` ports the Mac's routing (`src/main/ai.js` `ask` / `afterRefusal`) and builds the chat's `ask(body)`; `own-ai.js` keeps the key in `localStorage` (store key `ai`) and calls the provider straight from the page (Anthropic gets its browser-access header). `ai-settings.js` draws Settings → AI; `admin-core.js` (pure) and `admin.js` draw Settings → Admin through the existing `/api/admin/*` routes with `api.js` (which gains `put`). No server change.

**Tech Stack:** Plain browser ES modules (no framework, no bundler), `node --test` with `node:assert`, ESLint (`npm test` runs both), the shared CommonJS modules in `shared/` and `src/main/` copied as ES modules.

**Spec:** `docs/superpowers/specs/2026-10-09-iphone-own-key-and-admin-design.md`

## Global Constraints

- Work only in the git worktree `/Users/akshat/projects/buddy-iphone-2` on branch `iphone-key-admin`. Never touch `/Users/akshat/projects/buddy` or any other worktree (other sessions work there).
- No `Co-Authored-By` lines and no Claude/AI attribution in any commit message, PR text or file (the owner's rule).
- `npm test` at the worktree root must pass after every task (baseline before Task 1: 1579 tests, 1579 pass, 0 fail).
- Spec: `docs/superpowers/specs/2026-10-09-iphone-own-key-and-admin-design.md`. No server change (web/lib, web/api untouched).
- All new browser code: plain ES modules in `web/public/app/`, no framework, no bundler; short plain-English comments like the existing files.
- Files in `web/public/app/shared/`, `buddies/`, `vendor/` are made only by `tools/sync-web-app.js` (`npm run sync:web-app`); never hand-edit them.
- Own key: stored only on the phone (`store.js`, key `ai`: `{ provider, keys: { [id]: key }, models: { [id]: model } }`), never sent to Buddy's server, kept on sign out, cleared by Remove. Providers from `shared/providers` (anthropic, openai, gemini, groq; no Claude Code). Requests to `https://api.anthropic.com/` carry `anthropic-dangerous-direct-browser-access: true`; no other host gets it. Prompt via `shared/prompts.js` `buildPrompt('chat', …)`, `parseChat`, `MAX_TOKENS`; 60 s deadline.
- Routing = the spec's table (port of `src/main/ai.js` `ask` / `afterRefusal`), error texts verbatim: "Free AI is off. Add your own key in Settings.", "Your free access is paused.", "You've used today's N free requests. Add your own key in Settings to keep going, or wait until midnight.", "No internet.".
- Admin section only when `/api/config` `isAdmin: true`; same words and behaviour as `src/renderer/admin/` through `/api/admin/settings` (GET/PUT), `/api/admin/models?provider=`, `/api/admin/users` (GET/POST `{ uid, blocked }`), with `api.js` (token, timeouts, errors). After an admin save, `/api/config` is fetched again.
- Do not break the Mac, Windows or Android apps.

---

## Files

| File | What it does | Task |
|---|---|---|
| `tools/sync-web-app.js` | also copies `shared/providers/*.js` and `src/main/free-state.js`; its CommonJS conversion learns `require('../x')` | 1 |
| `web/public/app/shared/free-state.js`, `shared/providers/*.js` | made by the sync tool, never by hand | 1 |
| `web/public/app/route.js` | pure: which way a message goes (the spec's table and refusal rules), `createAsk` | 2 |
| `web/public/app/own-ai.js` | the own key's store (`ai`), Anthropic's header, ask the provider, list models | 2 |
| `web/public/app/ai-settings.js` | draws Settings → AI | 3 |
| `web/public/app/chat-core.js` | `failureText` shows every code's own words (`FREE_OFF` goes) | 3 |
| `web/public/app/admin-core.js` | pure admin form logic and the Mac's words | 4 |
| `web/public/app/admin.js` | draws Settings → Admin | 4 |
| `web/public/app/api.js` | gains `put` | 4 |
| `web/public/app/app.js`, `index.html`, `app.css` | wire it in | 3, 4 |
| `web/README.md`, `README.md`, `docs/manual-checklist-iphone.md` | docs | 5 |

Facts the tasks rely on (checked against the code):

- `npm test` = `eslint . && node --test "test/*.test.js" "test/*.test.mjs"`. ESLint ignores `web/public/app/shared/` and `web/public/app/vendor/`; `web/public/app/**/*.js` is linted as browser ES modules.
- `web/public/app/package.json` is `{"type":"module"}`, so the `.mjs` tests import the app's modules (and its `shared/` copies) directly.
- `test/web-app-files.test.mjs` requires every local `src`/`href` in `index.html` to start with `/`, so a link whose URL is set by script has no `href` in the page.
- The server's admin shapes (`web/lib/handlers.js`): `settingsView` = `{ config, providers: [{ id, label, hasKey, fallbackModels }], voiceOn }`; `adminModels` = `{ models, live, warning? }`; `adminUsers` GET = `{ users }` (sorted busiest first), POST `{ uid, blocked }` = `{ user }`. Errors come back as `{ error: { code, message } }`, which `api.js` turns into `ApiError(code, message)`.
- `/api/config` = `{ freeOn, limitMode, limit, usedToday, allowOwnKey, blocked, isAdmin, voiceOn, clawdLook, pushKey? }`.
- Test counts: 1579 before Task 1; 1580 after Task 1; 1593 after Task 2; 1596 after Task 3; 1602 after Tasks 4 and 5.


### Task 1: The sync tool copies the AI providers and the free-mode words

**Files:**
- Modify: `tools/sync-web-app.js` (header comment, `PROVIDER_MODULES`, `plan()`, `fromCommonJs` dependency regex)
- Modify: `test/web-app-sync.test.js` (new assertions and one new test)
- Create (by `npm run sync:web-app`, never by hand): `web/public/app/shared/free-state.js`, `web/public/app/shared/providers/{index,http,anthropic,openai-compatible,gemini}.js`

**Interfaces:**
- Consumes: nothing new.
- Produces (ES modules in `web/public/app/shared/`): `free-state.js` exports `aiSection(free) -> { note, showForm }`; `providers/index.js` exports `PROVIDERS` (`{ anthropic, openai, gemini, groq }`, each with `id, label, keyUrl, keyPrefixes, fallbackModels, isVisionModel, complete({ apiKey, model, system, user, image, maxTokens, fetchImpl, signal }), listModels({ apiKey, fetchImpl, signal })`), `PROVIDER_IDS` (`['anthropic', 'openai', 'gemini', 'groq']`), `getProvider(id)` (throws `BuddyError('bad_request')` for an unknown id), `providerForKey(key) -> id | null`. Provider failures are `BuddyError`s from `shared/errors.js` (the same class `own-ai.js` imports).

The CommonJS conversion in `fromCommonJs` only finds `require('./x')`. The providers also use `require('../errors')` (they live in `shared/providers/`), so the regex learns `../`. The import it writes (`../errors.js`) is relative to the made file, which sits in `web/public/app/shared/providers/`, so it lands on `web/public/app/shared/errors.js`, the copy that is already made. `listMade` already walks sub-folders (`recursive: true`), so the staleness test covers the new folder.

- [ ] **Step 1: Edit `test/web-app-sync.test.js`.** At the end of the second test, replace:

```js
  const { buddyLevel } = await import(url('feelings.js'));
  assert.strictEqual(buddyLevel(0.1), 0.5);
});
```

with:

```js
  const { buddyLevel } = await import(url('feelings.js'));
  assert.strictEqual(buddyLevel(0.1), 0.5);
  const { aiSection } = await import(url('free-state.js'));
  const free = { freeOn: true, limitMode: 'daily', limit: 30, usedToday: 4, allowOwnKey: true, blocked: false };
  assert.deepStrictEqual(aiSection(free), require('../src/main/free-state').aiSection(free));
});

test('the AI providers, made into ES modules, are the same four, and talk to the provider as in Node', async () => {
  const providers = await import(pathToFileURL(path.join(TO, 'shared', 'providers', 'index.js')).href);
  const node = require('../shared/providers');
  assert.deepStrictEqual(providers.PROVIDER_IDS, node.PROVIDER_IDS);
  const facts = (p) => ({ label: p.label, keyUrl: p.keyUrl, keyPrefixes: p.keyPrefixes, fallbackModels: p.fallbackModels });
  for (const id of node.PROVIDER_IDS) assert.deepStrictEqual(facts(providers.getProvider(id)), facts(node.PROVIDERS[id]), id);
  assert.strictEqual(providers.providerForKey('sk-ant-x'), 'anthropic');
  assert.strictEqual(providers.providerForKey('gsk_x'), 'groq');
  assert.throws(() => providers.getProvider('constructor'), (err) => err.name === 'BuddyError' && err.code === 'bad_request');
  // A refused key is the shared errors' BuddyError, in the shared words (http.js, through '../errors').
  const fetchImpl = async () => ({ ok: false, status: 401, text: async () => '{}' });
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(
      providers.getProvider('groq').complete({ apiKey: 'k', model: 'm', system: 's', user: 'u', maxTokens: 10, fetchImpl }),
      (err) => err.name === 'BuddyError' && err.code === 'bad_key' && err.message === 'Your Groq key was rejected. Check it in Settings.',
    );
  } finally {
    console.warn = warn;
  }
});
```

- [ ] **Step 2: Run the new tests: they fail**

```bash
node --test test/web-app-sync.test.js
```

Expected: FAIL: 2 tests fail with `ERR_MODULE_NOT_FOUND` (`.../web/public/app/shared/free-state.js`, `.../shared/providers/index.js`); the other 2 pass.

- [ ] **Step 3: Edit `tools/sync-web-app.js`.** The header comment. Replace:

```js
 *   shared/    shared/'s errors, memory rules and prompts, the Mac's sleep countdown and feelings (src/main/), and the
 *              panel's voice timing: Node modules and a page script, each made into an ES module here; and the buddy
 *              page's own ES modules (src/renderer/buddy/), copied as they are
```

with:

```js
 *   shared/    shared/'s errors, memory rules, prompts and AI providers (shared/providers/), the Mac's sleep countdown,
 *              feelings and free-mode words (src/main/), and the panel's voice timing: Node modules and a page script,
 *              each made into an ES module here; and the buddy page's own ES modules (src/renderer/buddy/), copied as
 *              they are
```

- [ ] **Step 4: Edit `tools/sync-web-app.js`.** The provider files. Replace:

```js
const THREE = 'node_modules/three';
```

with:

```js
const THREE = 'node_modules/three';
const PROVIDER_MODULES = ['index.js', 'http.js', 'anthropic.js', 'openai-compatible.js', 'gemini.js'];
```

- [ ] **Step 5: Edit `tools/sync-web-app.js`.** In `plan()`, replace:

```js
    ['shared/feelings.js', { from: 'src/main/feelings.js', as: 'commonjs' }],
```

with:

```js
    ['shared/feelings.js', { from: 'src/main/feelings.js', as: 'commonjs' }],
    ['shared/free-state.js', { from: 'src/main/free-state.js', as: 'commonjs' }],
    ...PROVIDER_MODULES.map((file) => [`shared/providers/${file}`, { from: `shared/providers/${file}`, as: 'commonjs' }]),
```

- [ ] **Step 6: Edit `tools/sync-web-app.js`.** `fromCommonJs` learns `../`. Replace:

```js
/**
 * A Node module as an ES module: its code runs as it is, inside a function that is given `module` and `require` (which
 * knows only the module's own files, imported next to it), and what it exports is exported by name.
 */
function fromCommonJs(source, from, root) {
  const deps = [...new Set([...source.matchAll(/require\('(\.\/[\w-]+)'\)/g)].map((m) => m[1]))];
```

with:

```js
/**
 * A Node module as an ES module: its code runs as it is, inside a function that is given `module` and `require` (which
 * knows only the module's own files, imported from where they are made: './x' next to it, '../x' one folder up), and
 * what it exports is exported by name.
 */
function fromCommonJs(source, from, root) {
  const deps = [...new Set([...source.matchAll(/require\('(\.\.?\/[\w-]+)'\)/g)].map((m) => m[1]))];
```

- [ ] **Step 7: Run the sync**

```bash
npm run sync:web-app
```

Expected: `web/public/app now has what it reuses (30 files in shared/, buddies/, vendor/)`. `web/public/app/shared/providers/anthropic.js` starts with `import * as dep0 from '../errors.js';` and `import * as dep1 from './http.js';`.

- [ ] **Step 8: Run the tests: they pass**

```bash
node --test test/web-app-sync.test.js
```

Expected: PASS: 4 tests, 0 fail.

- [ ] **Step 9: Run the whole suite (eslint and every test)**

```bash
npm test
```

Expected: PASS: 1580 tests, 0 fail (eslint ignores `web/public/app/shared/`).

- [ ] **Step 10: Commit**

```bash
git add tools/sync-web-app.js test/web-app-sync.test.js web/public/app/shared/free-state.js web/public/app/shared/providers
git commit -m "feat(iphone): copy the AI providers and free-mode words into the web app"
```

---

### Task 2: Which way a message goes (route.js) and the own key (own-ai.js)

**Files:**
- Create: `web/public/app/route.js` (pure: the spec's table, the refusal rules, `createAsk`)
- Create: `web/public/app/own-ai.js` (the `ai` store, the Anthropic header fetch, ask the provider, list models)
- Test: `test/web-app-route.test.mjs`, `test/web-app-own-ai.test.mjs`

**Interfaces:**
- Consumes: Task 1's `shared/providers/index.js` (`PROVIDER_IDS`, `getProvider`, `providerForKey`), `shared/errors.js` (`BuddyError`), `shared/prompts.js` (`buildPrompt`, `parseChat`, `MAX_TOKENS`); `api.js` (`ApiError`, `NO_INTERNET`); `store.js` (`createStore(...).read(key, fallback)` / `.write(key, value)`).
- Produces, `route.js`: `ADD_KEY`, `PAUSED`, `needKeyText(limit) -> string`, `routeFor(free, hasKey) -> { use: 'own' | 'server' } | { error: ApiError }`, `afterRefusal(err, { before, fresh, hasKey }) -> { use: 'own' } | { error }`, `createAsk({ config: async () => free|null, freshConfig: async () => free|null, hasKey: () => bool, askOwn: async (body) => out, askServer: async (body) => out }) -> async ask(body)`.
- Produces, `own-ai.js`: `AI_TIMEOUT_MS` (60000), `BROWSER_ACCESS` (`'anthropic-dangerous-direct-browser-access'`), `PASTE_FIRST`, `NOT_A_KEY`, `NO_KEY`, `withBrowserAccess(fetchImpl) -> fetchImpl`, `createOwnAi({ store, fetchImpl?, timeoutMs? })` answering `{ provider(): id, hasKey(): bool, keyEnd(id?): string, model(id?): string, pick(id), saveKey(id, key): ownerId, removeKey(id?), setModel(id, name), listModels(id?): Promise<string[]>, ask(body): Promise<{ text, model, usage, chat }> }`.

route.js ports `src/main/ai.js` `ask` / `afterRefusal` for the chat only. Differences from the Mac, all from the spec: free mode off with no key is "Free AI is off. Add your own key in Settings." (the Mac says "Add your API key in Settings first."), and never reached with no key is "No internet." (the phone's word for it). The routes answer `{ use }` or `{ error }` so they stay pure; `createAsk` throws the error. The errors are `ApiError`s, so `chat-core.js` `failureText` shows their words.

- [ ] **Step 1: Create `test/web-app-route.test.mjs`**

```js
// Buddy on iPhone: which way a chat message is answered (web/public/app/route.js), the Mac's src/main/ai.js choice.

import test from 'node:test';
import assert from 'node:assert';
import { routeFor, afterRefusal, createAsk, needKeyText, ADD_KEY, PAUSED } from '../web/public/app/route.js';
import { ApiError, NO_INTERNET } from '../web/public/app/api.js';

/** GET /api/config's answer: free mode on, 30 a day, 0 used, `fields` over it. */
const cfg = (fields = {}) => ({ freeOn: true, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, ...fields });
const errorOf = (r) => r.error && { code: r.error.code, message: r.error.message };

test('before asking: every row of the table', () => {
  assert.deepStrictEqual(routeFor(null, true), { use: 'own' }, 'config never fetched, key: own key');
  assert.deepStrictEqual(errorOf(routeFor(null, false)), { code: 'network', message: NO_INTERNET });
  assert.deepStrictEqual(routeFor(cfg({ freeOn: false }), true), { use: 'own' });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ freeOn: false }), false)), { code: 'free_off', message: ADD_KEY });
  assert.deepStrictEqual(routeFor(cfg({ blocked: true, allowOwnKey: true }), true), { use: 'own' });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ blocked: true, allowOwnKey: true }), false)), { code: 'blocked', message: PAUSED });
  assert.deepStrictEqual(errorOf(routeFor(cfg({ blocked: true }), true)), { code: 'blocked', message: PAUSED }, 'no own key allowed');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30, allowOwnKey: true }), true), { use: 'own' }, 'used up: own key at once');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30, allowOwnKey: true }), false), { use: 'server' }, 'the server says how many');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 30 }), true), { use: 'server' }, 'own key not allowed');
  assert.deepStrictEqual(routeFor(cfg({ usedToday: 3, allowOwnKey: true }), true), { use: 'server' }, 'free first');
  assert.deepStrictEqual(routeFor(cfg({ limitMode: 'unlimited', limit: null }), true), { use: 'server' });
});

test('after a refusal: free_off goes to the own key only when free mode is now off', () => {
  const offErr = new ApiError('free_off', ADD_KEY);
  assert.deepStrictEqual(afterRefusal(offErr, { before: cfg(), fresh: cfg({ freeOn: false }), hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(errorOf(afterRefusal(offErr, { before: cfg(), fresh: cfg({ freeOn: false }), hasKey: false })), { code: 'free_off', message: ADD_KEY });
  assert.strictEqual(afterRefusal(offErr, { before: cfg(), fresh: cfg(), hasKey: true }).error, offErr, 'on again: the server\'s words');
  // The config could not be fetched again: the one from before decides.
  assert.deepStrictEqual(afterRefusal(offErr, { before: cfg({ freeOn: false }), fresh: null, hasKey: true }), { use: 'own' });
});

test('after a refusal: used up or blocked, the own key where the admin allows it, else the words that say so', () => {
  const limitErr = new ApiError('free_limit', "You've used today's 30 free requests. They come back at midnight.");
  const blockedErr = new ApiError('blocked', PAUSED);
  const allowed = cfg({ allowOwnKey: true, usedToday: 30 });
  assert.deepStrictEqual(afterRefusal(limitErr, { before: cfg(), fresh: allowed, hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(afterRefusal(blockedErr, { before: cfg(), fresh: cfg({ allowOwnKey: true, blocked: true }), hasKey: true }), { use: 'own' });
  assert.deepStrictEqual(errorOf(afterRefusal(limitErr, { before: cfg(), fresh: allowed, hasKey: false })), {
    code: 'need_key',
    message: "You've used today's 30 free requests. Add your own key in Settings to keep going, or wait until midnight.",
  });
  assert.strictEqual(afterRefusal(limitErr, { before: cfg(), fresh: cfg(), hasKey: true }).error, limitErr, 'not allowed: the server\'s words');
  assert.strictEqual(afterRefusal(blockedErr, { before: cfg(), fresh: cfg({ allowOwnKey: true }), hasKey: false }).error, blockedErr);
  assert.strictEqual(needKeyText(null), "You've used today's free requests. Add your own key in Settings to keep going, or wait until midnight.");
});

/** createAsk with fakes: `server` answers or throws, `fresh` is the config fetched again. */
function setup({ config = cfg(), fresh = null, hasKey = true, server = { chat: { say: 'server' } } } = {}) {
  const calls = [];
  const ask = createAsk({
    config: async () => config,
    freshConfig: async () => {
      calls.push('fresh');
      if (fresh instanceof Error) throw fresh;
      return fresh;
    },
    hasKey: () => hasKey,
    askOwn: async (body) => {
      calls.push(['own', body.message]);
      return { chat: { say: 'own' } };
    },
    askServer: async (body) => {
      calls.push(['server', body.message]);
      if (server instanceof Error) throw server;
      return server;
    },
  });
  return { ask, calls };
}

test('a message goes the way the table says, and a refusal is followed by a fresh config', async () => {
  let s = setup();
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'server' } });
  assert.deepStrictEqual(s.calls, [['server', 'hi']]);

  s = setup({ config: cfg({ freeOn: false }) });
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'own' } });
  assert.deepStrictEqual(s.calls, [['own', 'hi']]);

  s = setup({ server: new ApiError('free_off', ADD_KEY), fresh: cfg({ freeOn: false }) });
  assert.deepStrictEqual(await s.ask({ message: 'hi' }), { chat: { say: 'own' } });
  assert.deepStrictEqual(s.calls, [['server', 'hi'], 'fresh', ['own', 'hi']]);

  s = setup({ server: new ApiError('free_limit', 'used up'), fresh: new Error('offline'), config: cfg({ allowOwnKey: true }), hasKey: false });
  await assert.rejects(s.ask({ message: 'hi' }), (err) => err instanceof ApiError && err.code === 'need_key');
});

test('an error that is not a free-mode refusal is the server\'s, and no config is fetched for it', async () => {
  const upstream = new ApiError('upstream', "Buddy couldn't answer. Try again.");
  const s = setup({ server: upstream });
  await assert.rejects(s.ask({ message: 'hi' }), (err) => err === upstream);
  assert.deepStrictEqual(s.calls, [['server', 'hi']]);
  const none = setup({ config: null, hasKey: false });
  await assert.rejects(none.ask({ message: 'hi' }), (err) => err.code === 'network' && err.message === NO_INTERNET);
  assert.deepStrictEqual(none.calls, []);
});
```

- [ ] **Step 2: Create `test/web-app-own-ai.test.mjs`**

```js
// Buddy on iPhone: the person's own AI key (web/public/app/own-ai.js), kept on the phone and used straight from it.

import test from 'node:test';
import assert from 'node:assert';
import { createOwnAi, withBrowserAccess, BROWSER_ACCESS, PASTE_FIRST, NOT_A_KEY, NO_KEY } from '../web/public/app/own-ai.js';
import { createStore } from '../web/public/app/store.js';
import { MAX_TOKENS } from '../web/public/app/shared/prompts.js';

/** A response as fetch gives it, with JSON `body`. */
const reply = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body, text: async () => JSON.stringify(body) });

/** An own AI over a fake localStorage (`map`), whose fetch answers `replies` in turn; `calls` are the fetches. */
function setup(replies = [], kept = null) {
  const map = new Map();
  if (kept) map.set('buddy.ai', JSON.stringify(kept));
  const store = createStore({ get: (k) => map.get(k) ?? null, set: (k, v) => map.set(k, v) });
  const calls = [];
  const own = createOwnAi({
    store,
    fetchImpl: async (url, init) => {
      calls.push({ url, ...init, body: init.body && JSON.parse(init.body) });
      return replies.shift();
    },
  });
  return { own, calls, kept: () => JSON.parse(map.get('buddy.ai') ?? 'null') };
}

test('nothing kept: Claude is picked, with no key and its first model', () => {
  const { own } = setup();
  assert.strictEqual(own.provider(), 'anthropic');
  assert.strictEqual(own.hasKey(), false);
  assert.strictEqual(own.keyEnd(), '');
  assert.strictEqual(own.model(), 'claude-haiku-4-5-20251001');
});

test('what is kept that is not right is left out: an unknown AI, keys that are not text', () => {
  const { own } = setup([], { provider: 'constructor', keys: { anthropic: 42, groq: 'gsk_abcd1234' }, models: [] });
  assert.strictEqual(own.provider(), 'anthropic');
  assert.strictEqual(own.hasKey(), false);
  assert.strictEqual(own.keyEnd('groq'), '1234');
});

test('a key is kept under ai, trimmed, for the AI it starts like, which is then picked', () => {
  const s = setup();
  assert.strictEqual(s.own.saveKey('anthropic', '  gsk_secret9876 '), 'groq');
  assert.deepStrictEqual(s.kept(), { provider: 'groq', keys: { groq: 'gsk_secret9876' }, models: {} });
  assert.strictEqual(s.own.hasKey(), true);
  assert.strictEqual(s.own.keyEnd(), '9876');
  assert.strictEqual(s.own.saveKey('openai', 'my-own-key'), 'openai', 'a key like none of them is for the AI asked for');
  assert.throws(() => s.own.saveKey('openai', '   '), { code: 'bad_request', message: PASTE_FIRST });
  assert.throws(() => s.own.saveKey('openai', 'two words'), { code: 'bad_key', message: NOT_A_KEY });
  assert.throws(() => s.own.saveKey('nope', 'sk-1'), { code: 'bad_request' });
});

test('Remove forgets the key and its model; picking an AI and a model is kept', () => {
  const s = setup();
  s.own.saveKey('openai', 'sk-proj-1234');
  s.own.setModel('openai', 'gpt-4.1');
  assert.strictEqual(s.own.model(), 'gpt-4.1');
  s.own.pick('gemini');
  assert.strictEqual(s.own.provider(), 'gemini');
  assert.strictEqual(s.own.hasKey(), false);
  s.own.removeKey('openai');
  assert.deepStrictEqual(s.kept(), { provider: 'gemini', keys: {}, models: {} });
  assert.throws(() => s.own.pick('claude-code'), { code: 'bad_request' });
});

test("Anthropic's browser header goes to api.anthropic.com only", async () => {
  const seen = [];
  const send = withBrowserAccess(async (url, init) => seen.push([url, init.headers]));
  await send('https://api.anthropic.com/v1/messages', { headers: { 'x-api-key': 'k' } });
  await send('https://api.openai.com/v1/models', { headers: { Authorization: 'Bearer k' } });
  await send('https://api.anthropic.com.evil.example/v1', { headers: {} });
  assert.deepStrictEqual(seen, [
    ['https://api.anthropic.com/v1/messages', { 'x-api-key': 'k', [BROWSER_ACCESS]: 'true' }],
    ['https://api.openai.com/v1/models', { Authorization: 'Bearer k' }],
    ['https://api.anthropic.com.evil.example/v1', {}],
  ]);
});

test("a message goes to the AI picked as the Mac's chat prompt, and its answer is read as the server's is", async () => {
  const answer = JSON.stringify({ kind: 'write', say: 'Here you go!', text: 'Dear Sir,', notes: [], remember: ['Works at Infosys'] });
  const s = setup([reply(200, { content: [{ type: 'text', text: answer }], model: 'claude-haiku-4-5-20251001' })]);
  s.own.saveKey('anthropic', 'sk-ant-key1');
  const out = await s.own.ask({ action: 'chat', message: 'boss ko mail likho', history: [], facts: ['Boss: Mr. Sharma'], step: 1, userName: 'Akshat' });
  assert.strictEqual(s.calls.length, 1);
  const call = s.calls[0];
  assert.strictEqual(call.url, 'https://api.anthropic.com/v1/messages');
  assert.strictEqual(call.headers['x-api-key'], 'sk-ant-key1');
  assert.strictEqual(call.headers[BROWSER_ACCESS], 'true');
  assert.ok(call.signal instanceof AbortSignal, 'a deadline');
  assert.strictEqual(call.body.model, 'claude-haiku-4-5-20251001');
  assert.strictEqual(call.body.max_tokens, MAX_TOKENS);
  assert.match(call.body.system, /You are Buddy, a friendly helper/);
  assert.match(call.body.messages[0].content, /Their first name: Akshat/);
  assert.match(call.body.messages[0].content, /- Boss: Mr\. Sharma/);
  assert.match(call.body.messages[0].content, /Their message:\n"""\nboss ko mail likho\n"""/);
  assert.deepStrictEqual(out.chat, {
    kind: 'write', say: 'Here you go!', text: 'Dear Sir,', notes: [], doIt: false, send: false, remember: ['Works at Infosys'], again: false,
  });
});

test("the provider's own words come through: a refused key, and no key at all", async () => {
  const s = setup([reply(401, { error: { type: 'authentication_error' } })]);
  await assert.rejects(s.own.ask({ message: 'hi' }), { code: 'no_key', message: NO_KEY });
  s.own.saveKey('openai', 'sk-bad');
  const warn = console.warn;
  console.warn = () => {};
  try {
    await assert.rejects(s.own.ask({ message: 'hi' }), { code: 'bad_key', message: 'Your OpenAI key was rejected. Check it in Settings.' });
  } finally {
    console.warn = warn;
  }
  assert.strictEqual(s.calls[0].headers[BROWSER_ACCESS], undefined, 'no Anthropic header for OpenAI');
});

test('the models: the live list with a saved key, else the usual ones', async () => {
  const s = setup([reply(200, { data: [{ id: 'llama-3.3-70b-versatile' }, { id: 'whisper-large-v3' }] }), reply(200, { data: [] })]);
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct']);
  assert.strictEqual(s.calls.length, 0, 'no key: nothing asked');
  s.own.saveKey('groq', 'gsk_1');
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile']);
  assert.deepStrictEqual(await s.own.listModels('groq'), ['llama-3.3-70b-versatile', 'meta-llama/llama-4-scout-17b-16e-instruct'], 'an empty list');
});
```

- [ ] **Step 3: Run the new tests: they fail**

```bash
node --test test/web-app-route.test.mjs test/web-app-own-ai.test.mjs
```

Expected: FAIL: both files fail to load with `ERR_MODULE_NOT_FOUND` (`web/public/app/route.js`, `web/public/app/own-ai.js`).

- [ ] **Step 4: Create `web/public/app/route.js`**

```js
// Which way a chat message is answered: by Buddy's server (free mode, the admin's key) or by the person's own key,
// straight from the phone (own-ai.js). The Mac's choice (src/main/ai.js ask and afterRefusal), for the chat only: it
// goes by GET /api/config (`free`) and whether a key is saved for the AI picked in Settings → AI.

import { ApiError, NO_INTERNET } from './api.js';

export const ADD_KEY = 'Free AI is off. Add your own key in Settings.';
export const PAUSED = 'Your free access is paused.';
// What the server says when it will not answer for free; the config is fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

const OWN = Object.freeze({ use: 'own' });
const SERVER = Object.freeze({ use: 'server' });
const refuse = (code, message) => ({ error: new ApiError(code, message) });

/** Today's free requests are used up: the words that send the person to their own key. */
export function needKeyText(limit) {
  const used = limit ? `today's ${limit} free requests` : "today's free requests";
  return `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`;
}

/**
 * Before asking: { use: 'own' }, { use: 'server' } or { error }. `free` is GET /api/config's answer, or null when it
 * could never be had; `hasKey` whether a key is saved for the AI picked.
 */
export function routeFor(free, hasKey) {
  if (!free) return hasKey ? OWN : refuse('network', NO_INTERNET);
  if (!free.freeOn) return hasKey ? OWN : refuse('free_off', ADD_KEY);
  if (free.blocked) return free.allowOwnKey && hasKey ? OWN : refuse('blocked', PAUSED);
  // Used up, and the admin lets this person go on with their own key: the server would only refuse.
  const usedUp = free.limitMode === 'daily' && free.limit !== null && free.usedToday >= free.limit;
  if (usedUp && free.allowOwnKey && hasKey) return OWN;
  return SERVER;
}

/**
 * The server refused with `err` (free_off, free_limit or blocked): { use: 'own' } or { error }. `fresh` is the config
 * fetched again (null when it could not be), `before` the one the message went with.
 */
export function afterRefusal(err, { before, fresh, hasKey }) {
  const now = fresh || before;
  if (err.code === 'free_off') {
    if (now.freeOn) return { error: err };
    return hasKey ? OWN : refuse('free_off', ADD_KEY);
  }
  if (now.allowOwnKey && hasKey) return OWN;
  if (err.code === 'free_limit' && now.allowOwnKey) return refuse('need_key', needKeyText(now.limit ?? before.limit));
  return { error: err };
}

/**
 * The chat's ask(body): config() answers the config (waiting for one on its way), freshConfig() fetches it again
 * (null when it cannot), hasKey() says whether a key is saved, askOwn(body) asks with it and askServer(body) is
 * POST /api/ask. Each answers { chat, … } as the server does.
 */
export function createAsk({ config, freshConfig, hasKey, askOwn, askServer }) {
  return async function ask(body) {
    const before = await config();
    const own = hasKey();
    const first = routeFor(before, own);
    if (first.error) throw first.error;
    if (first.use === 'own') return askOwn(body);
    try {
      return await askServer(body);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err?.code)) throw err;
      const fresh = await freshConfig().catch(() => null);
      const next = afterRefusal(err, { before, fresh, hasKey: own });
      if (next.error) throw next.error;
      return askOwn(body);
    }
  };
}
```

- [ ] **Step 5: Create `web/public/app/own-ai.js`**

```js
// The person's own AI key, on this phone only: kept with store.js under 'ai' as { provider, keys: { [id]: key },
// models: { [id]: model } }, never sent to Buddy's server, kept on sign out (as on the Mac, the key belongs to the
// device), and forgotten by Remove. A message goes straight from the page to the provider, with the shared providers
// and prompts, as the Mac's own-key route does (src/main/ai.js askOwn).

import { PROVIDER_IDS, getProvider, providerForKey } from './shared/providers/index.js';
import { buildPrompt, parseChat, MAX_TOKENS } from './shared/prompts.js';
import { BuddyError } from './shared/errors.js';

export const AI_TIMEOUT_MS = 60_000; // as long as POST /api/ask is given (api.js TIMEOUTS.ask)
export const BROWSER_ACCESS = 'anthropic-dangerous-direct-browser-access';
const ANTHROPIC = 'https://api.anthropic.com/';
// A key is one run of printable characters, as on the Mac (src/main/ipc/settings.js).
const KEY_SHAPE = /^[\x21-\x7e]+$/;
export const PASTE_FIRST = 'Paste your key first.';
export const NOT_A_KEY = "That doesn't look like an API key. Copy only the key and paste it again.";
export const NO_KEY = 'Add your API key in Settings first.';

/**
 * fetch, with the header Anthropic wants before it answers a web page, on calls to api.anthropic.com only. OpenAI,
 * Gemini and Groq answer a web page as they are, and get no extra header.
 */
export function withBrowserAccess(fetchImpl) {
  return (url, init = {}) => {
    if (!String(url).startsWith(ANTHROPIC)) return fetchImpl(url, init);
    return fetchImpl(url, { ...init, headers: { ...init.headers, [BROWSER_ACCESS]: 'true' } });
  };
}

const isObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

/** store is store.js's. Answers the own key's settings and its calls. */
export function createOwnAi({ store, fetchImpl = (...args) => fetch(...args), timeoutMs = AI_TIMEOUT_MS }) {
  const send = withBrowserAccess(fetchImpl);

  /** What is kept, with the AI picked always one of the four, and only text kept as keys and models. */
  function read() {
    const kept = store.read('ai', null);
    const textOf = (map) => (isObject(map)
      ? Object.fromEntries(PROVIDER_IDS.filter((id) => typeof map[id] === 'string' && map[id]).map((id) => [id, map[id]]))
      : {});
    return {
      provider: PROVIDER_IDS.includes(kept?.provider) ? kept.provider : PROVIDER_IDS[0],
      keys: textOf(kept?.keys),
      models: textOf(kept?.models),
    };
  }

  const write = (next) => store.write('ai', next);
  const picked = () => read().provider;

  /** The model for `id`: the one picked, else the provider's first. */
  function model(id = picked()) {
    return read().models[id] || getProvider(id).fallbackModels[0];
  }

  return {
    /** The AI picked: 'anthropic', 'openai', 'gemini' or 'groq'. */
    provider: picked,

    /** A key is saved for the AI picked. */
    hasKey: () => Boolean(read().keys[picked()]),

    /** The last 4 characters of the key saved for `id`, or '' when none is: a saved key is never shown again. */
    keyEnd: (id = picked()) => (read().keys[id] || '').slice(-4),

    model,

    pick(id) {
      getProvider(id); // an unknown name is refused
      write({ ...read(), provider: id });
    },

    /**
     * Keep `key` for the AI `id`, or for the one it belongs to by how it starts (providerForKey), which is then picked.
     * Answers that AI's id. Throws a BuddyError for no key, or one that is not a key.
     */
    saveKey(id, key) {
      getProvider(id);
      const apiKey = typeof key === 'string' ? key.trim() : '';
      if (!apiKey) throw new BuddyError('bad_request', PASTE_FIRST);
      if (!KEY_SHAPE.test(apiKey)) throw new BuddyError('bad_key', NOT_A_KEY);
      const owner = providerForKey(apiKey) ?? id;
      const now = read();
      write({ ...now, provider: owner, keys: { ...now.keys, [owner]: apiKey } });
      return owner;
    },

    /** Remove: the key for `id` is forgotten, and the model picked with it. */
    removeKey(id = picked()) {
      const now = read();
      delete now.keys[id];
      delete now.models[id];
      write(now);
    },

    setModel(id, name) {
      getProvider(id);
      const now = read();
      write({ ...now, models: { ...now.models, [id]: name } });
    },

    /** The models for `id`: its live list with the saved key, else (no key, or an empty list) its usual ones. */
    async listModels(id = picked()) {
      const provider = getProvider(id);
      const apiKey = read().keys[id];
      if (!apiKey) return provider.fallbackModels;
      const live = await provider.listModels({ apiKey, fetchImpl: send, signal: AbortSignal.timeout(timeoutMs) });
      return live.length ? live : provider.fallbackModels;
    },

    /** One chat message (chat-core.js chatRequest's body), answered by the AI picked: { text, model, usage, chat }. */
    async ask(body) {
      const id = picked();
      const apiKey = read().keys[id];
      if (!apiKey) throw new BuddyError('no_key', NO_KEY);
      const prompt = buildPrompt('chat', body);
      const out = await getProvider(id).complete({
        apiKey, model: model(id), ...prompt, maxTokens: MAX_TOKENS, fetchImpl: send, signal: AbortSignal.timeout(timeoutMs),
      });
      return { ...out, chat: parseChat(out.text) };
    },
  };
}
```

- [ ] **Step 6: Run the tests: they pass**

```bash
node --test test/web-app-route.test.mjs test/web-app-own-ai.test.mjs
```

Expected: PASS: 13 tests, 0 fail.

- [ ] **Step 7: Run the whole suite (eslint and every test)**

```bash
npm test
```

Expected: PASS: 1593 tests, 0 fail (eslint clean).

- [ ] **Step 8: Commit**

```bash
git add web/public/app/route.js web/public/app/own-ai.js test/web-app-route.test.mjs test/web-app-own-ai.test.mjs
git commit -m "feat(iphone): choose free or own key for a message, and ask the AI with the own key"
```

---

### Task 3: Own key in the chat, and Settings → AI

**Files:**
- Create: `web/public/app/ai-settings.js` (draws Settings → AI; exports pure `keyLine`, `modelList`)
- Modify: `web/public/app/chat-core.js` (`FREE_OFF` goes; `failureText` shows every code's own words; `createChat` comment)
- Modify: `web/public/app/app.js` (own key, `createAsk`, `loadConfig` answers and keeps a good config, `currentConfig`, AI settings drawn)
- Modify: `web/public/app/index.html` (the AI section between "Your buddy" and "Memory")
- Modify: `web/public/app/app.css` (`select`, `.part`, `.label`, `select.field`, `p.row`, `.row .grow`, `.good`)
- Test: `test/web-app-chat.test.mjs` (failureText), `test/web-app-files.test.mjs` (every `$('id')` is in the page), `test/web-app-ai-settings.test.mjs`

**Interfaces:**
- Consumes: Task 1's `shared/free-state.js` `aiSection`, `shared/providers/index.js` `PROVIDERS`, `PROVIDER_IDS`; Task 2's `createAsk` and `createOwnAi` (signatures above).
- Produces: `ai-settings.js` `startAiSettings({ own, config: () => free|null }) -> { draw() }`, `keyLine(end, switchedTo?) -> string`, `modelList(models, chosen) -> string[]`, `NO_KEY_YET`. In `app.js`: `loadConfig(who) -> Promise<free|null>` (answers what came; a failed fetch keeps the config there was), `currentConfig() -> Promise<free|null>`, and `const aiSettings`, `const own`. Task 4 adds to `loadConfig` and `showTab`. The CSS classes `.part`, `.label`, `.row .grow`, `.good` are reused by Task 4.

`FREE_OFF` ("Free AI is off right now. Try again later.") is removed: the spec keeps it only "when the person can't add a key (never: with free mode off, the AI section always shows the form)", so it is dead. `free_off` now shows the server's own words, which are route.js's `ADD_KEY`.

A failed `/api/config` refetch (after a refusal, or after an admin save in Task 4) must not wipe a good config, so `loadConfig` keeps the old one and answers `null` (route.js then decides with the config from before, as the Mac does). At sign-in the config is already `null` (`showSignedOut` clears it).

- [ ] **Step 1: Edit `test/web-app-chat.test.mjs`.** The import. Replace:

```js
  EMPTY, TOO_LONG, CANT_SEE, CANT_SEND, NO_ANSWER, FREE_OFF, FAILED, FORGOT,
```

with:

```js
  EMPTY, TOO_LONG, CANT_SEE, CANT_SEND, NO_ANSWER, FAILED, FORGOT,
```

- [ ] **Step 2: Edit `test/web-app-chat.test.mjs`.** Then the failureText test. Replace:

```js
test("the server's words for free mode's limits are shown; free off and unknown failures get the phone's own", () => {
  assert.strictEqual(failureText(new ApiError('free_limit', "You've used today's 30 free requests.")), "You've used today's 30 free requests.");
  assert.strictEqual(failureText(new ApiError('free_off', 'Free AI is off. Add your own key in Settings.')), FREE_OFF);
```

with:

```js
test("the server's and the AI's words are shown as they are; unknown failures get the phone's own", () => {
  assert.strictEqual(failureText(new ApiError('free_limit', "You've used today's 30 free requests.")), "You've used today's 30 free requests.");
  assert.strictEqual(failureText(new ApiError('free_off', 'Free AI is off. Add your own key in Settings.')), 'Free AI is off. Add your own key in Settings.');
  const refused = Object.assign(new Error('Your Claude key was rejected. Check it in Settings.'), { name: 'BuddyError', code: 'bad_key' });
  assert.strictEqual(failureText(refused), 'Your Claude key was rejected. Check it in Settings.');
```

- [ ] **Step 3: Edit `test/web-app-files.test.mjs`.** Add a test before the Home Screen one. Replace:

```js
test('the page is a Home Screen app
```

with:

```js
test("every element the app's own modules look up by id ($('…')) is in the page", () => {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
  for (const file of fs.readdirSync(APP).filter((f) => f.endsWith('.js'))) {
    const source = fs.readFileSync(path.join(APP, file), 'utf8');
    for (const [, id] of source.matchAll(/\$\('([\w-]+)'\)/g)) assert.ok(ids.has(id), `${file} looks up #${id}, which is not in index.html`);
  }
});

test('the page is a Home Screen app
```

- [ ] **Step 4: Create `test/web-app-ai-settings.test.mjs`**

```js
// Buddy on iPhone: Settings → AI's words and model list (web/public/app/ai-settings.js).

import test from 'node:test';
import assert from 'node:assert';
import { keyLine, modelList, NO_KEY_YET } from '../web/public/app/ai-settings.js';

test('a saved key shows only its last 4 characters, and the AI it was switched to', () => {
  assert.strictEqual(keyLine(''), NO_KEY_YET);
  assert.strictEqual(keyLine('9876'), 'Key saved ✓ (ends in 9876)');
  assert.strictEqual(keyLine('9876', 'Groq'), 'That key is for Groq, so I switched to Groq. Key saved ✓ (ends in 9876)');
});

test('the model in use is always in the list, first when the list does not have it', () => {
  assert.deepStrictEqual(modelList(['a', 'b'], 'b'), ['a', 'b']);
  assert.deepStrictEqual(modelList(['a', 'b'], 'old'), ['old', 'a', 'b']);
});
```

- [ ] **Step 5: Run the new tests: they fail**

```bash
node --test test/web-app-chat.test.mjs test/web-app-files.test.mjs test/web-app-ai-settings.test.mjs
```

Expected: FAIL: in `web-app-chat.test.mjs` the failureText test fails (expected the server's words, got "Free AI is off right now. Try again later."); `web-app-ai-settings.test.mjs` fails with `ERR_MODULE_NOT_FOUND`. The new files test passes (today every `$('id')` is in the page).

- [ ] **Step 6: Edit `web/public/app/chat-core.js`.** Delete this line:

```js
export const FREE_OFF = 'Free AI is off right now. Try again later.';
```

with nothing (delete it).

- [ ] **Step 7: Edit `web/public/app/chat-core.js`.** Replace:

```js
/** The words for a failed answer: the server's (free mode's limits, a block), or plain ones. */
export function failureText(err) {
  if (err?.code === 'free_off') return FREE_OFF; // the server's words send the person to an own key, which the phone has not
  return
```

with:

```js
/**
 * The words for a failed answer: the server's (free mode's limits, a block), route.js's, or the AI provider's (a key
 * that was refused), as they are; else plain ones.
 */
export function failureText(err) {
  return
```

- [ ] **Step 8: Edit `web/public/app/chat-core.js`.** Replace:

```js
/**
 * One chat. ask(body) is POST /api/ask; memory is memory.js; userName() the person's first name; onMood(name) tells
 * the buddy (thinking, happy, sad, idle); onChange() after every change. `state` is { items, busy }.
 */
```

with:

```js
/**
 * One chat. ask(body) answers a message: route.js's createAsk (Buddy's server, or the person's own key). memory is
 * memory.js; userName() the person's first name; onMood(name) tells the buddy (thinking, happy, sad, idle); onChange()
 * after every change. `state` is { items, busy }.
 */
```

- [ ] **Step 9: Create `web/public/app/ai-settings.js`**

```js
// Settings → AI: the line about free mode (the Mac's words, shared/free-state.js), and, when the person may use one,
// their own AI key: which AI, the key (kept on this phone only, never shown again once saved) and the model. What is
// kept, and the calls to the AI, are own-ai.js's; this file draws them.

import { aiSection } from './shared/free-state.js';
import { PROVIDERS, PROVIDER_IDS } from './shared/providers/index.js';
import { $, make } from './dom.js';

export const NO_KEY_YET = 'No key yet.';
const FAILED = 'Something went wrong. Try again.';

/** The line beside the key: saved (with its last 4 characters) or not, and the AI it was switched to, if it was. */
export function keyLine(end, switchedTo = '') {
  const switched = switchedTo ? `That key is for ${switchedTo}, so I switched to ${switchedTo}. ` : '';
  return end ? `${switched}Key saved ✓ (ends in ${end})` : NO_KEY_YET;
}

/** The model list: `models`, with `chosen` in it even when the list does not have it (the one in use is always shown). */
export function modelList(models, chosen) {
  return models.includes(chosen) ? models : [chosen, ...models];
}

/** own is own-ai.js's; config() GET /api/config's answer (null when there is none yet). Answers { draw }. */
export function startAiSettings({ own, config }) {
  let asked = 0; // one more for each list of models asked for: only the newest is shown

  function showError(message) {
    $('ai-error').textContent = message;
    $('ai-error').hidden = !message;
  }

  function showKey(switchedTo = '') {
    const end = own.keyEnd();
    $('ai-key-status').textContent = keyLine(end, switchedTo);
    $('ai-key-status').className = end ? 'grow good' : 'grow muted';
    $('ai-remove').hidden = !end;
  }

  function fillModels(models) {
    const chosen = own.model();
    $('ai-model').replaceChildren(...modelList(models, chosen).map((name) => {
      const option = make('option', '', name);
      option.value = name;
      option.selected = name === chosen;
      return option;
    }));
  }

  /** The usual models at once; with a key, the live list when it comes. */
  async function loadModels() {
    const id = own.provider();
    const mine = (asked += 1);
    fillModels(PROVIDERS[id].fallbackModels);
    if (!own.hasKey()) return;
    try {
      const models = await own.listModels(id);
      if (mine === asked) fillModels(models);
    } catch (err) {
      if (mine === asked) showError(err?.message || FAILED);
    }
  }

  /** The form for the AI picked: its key line, its Get a key link, its models. */
  function drawForm(switchedTo = '') {
    const { label, keyUrl } = PROVIDERS[own.provider()];
    $('ai-provider').value = own.provider();
    $('ai-get-key').href = keyUrl;
    $('ai-key').placeholder = `Paste your ${label} key`;
    showKey(switchedTo);
    loadModels();
  }

  $('ai-provider').replaceChildren(...PROVIDER_IDS.map((id) => {
    const option = make('option', '', PROVIDERS[id].label);
    option.value = id;
    return option;
  }));
  $('ai-provider').addEventListener('change', (e) => {
    own.pick(e.target.value);
    showError('');
    drawForm(); // a key typed but not saved stays in the box
  });
  $('ai-key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const was = own.provider();
    let saved;
    try {
      saved = own.saveKey(was, $('ai-key').value);
    } catch (err) {
      showError(err.message);
      return;
    }
    $('ai-key').value = '';
    showError('');
    drawForm(saved === was ? '' : PROVIDERS[saved].label);
  });
  $('ai-remove').addEventListener('click', () => {
    own.removeKey();
    showError('');
    drawForm();
  });
  $('ai-model').addEventListener('change', (e) => own.setModel(own.provider(), e.target.value));

  return {
    /** Draws the section again: when the Settings tab opens, and when the config comes. */
    draw() {
      const { note, showForm } = aiSection(config());
      $('ai-note').textContent = note;
      $('ai-note').hidden = !note;
      $('ai-form').hidden = !showForm;
      if (!showForm) return; // a saved key stays saved
      showError('');
      drawForm();
    },
  };
}
```

- [ ] **Step 10: Edit `web/public/app/index.html`.** The AI section between Buddy and Memory. The "Get a key" link has no `href` in the page (the files test wants every local href to start with `/`); `ai-settings.js` sets it. Replace:

```html
    <div class="buddies" id="buddy-choice"></div>

    <h2>Memory</h2>
```

with:

```html
    <div class="buddies" id="buddy-choice"></div>

    <h2>AI</h2>
    <p class="muted" id="ai-note" hidden></p>
    <div class="part" id="ai-form" hidden>
      <label class="label" for="ai-provider">Provider</label>
      <select class="field" id="ai-provider"></select>
      <label class="label" for="ai-key">API key</label>
      <form class="row" id="ai-key-form">
        <input class="field" id="ai-key" type="password" autocomplete="off" autocapitalize="off" spellcheck="false">
        <button class="btn btn--ghost btn--sm" type="submit">Save</button>
      </form>
      <p class="row"><span class="grow muted" id="ai-key-status" aria-live="polite"></span><a id="ai-get-key" target="_blank" rel="noopener">Get a key</a></p>
      <button class="btn btn--ghost btn--sm" id="ai-remove" type="button" hidden>Remove</button>
      <label class="label" for="ai-model">Model</label>
      <select class="field" id="ai-model"></select>
      <p class="error" id="ai-error" role="alert" hidden></p>
    </div>

    <h2>Memory</h2>
```

- [ ] **Step 11: Edit `web/public/app/app.css`.** Replace:

```css
button, input, textarea { font: inherit; color: inherit; }
```

with:

```css
button, input, select, textarea { font: inherit; color: inherit; }
```

- [ ] **Step 12: Edit `web/public/app/app.css`.** Replace:

```css
.settings > .btn { align-self: flex-start; }
.settings .error { margin: 0; }
```

with:

```css
.settings > .btn, .part > .btn { align-self: flex-start; }
.settings .error { margin: 0; }
/* a part of Settings that shows or hides as one (the AI form, Admin) */
.part { display: flex; flex-direction: column; gap: 10px; }
.label { margin: 4px 0 -4px; color: var(--ink-2); font-size: 15px; font-weight: 600; }
select.field { appearance: none; padding-right: 32px; background: var(--paper) url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='8'%3E%3Cpath d='M1 1l5 5 5-5' fill='none' stroke='%236B5848' stroke-width='2'/%3E%3C/svg%3E") no-repeat right 14px center; }
p.row { margin: 0; }
.row .grow { flex: 1; min-width: 0; }
.good { margin: 0; color: var(--ok-ink); font-size: 15px; }
```

- [ ] **Step 13: Edit `web/public/app/app.js`.** The header. Replace:

```js
// Buddy on iPhone: starts everything. Signed out, the head and the sign-in button; signed in, three tabs under the
// head: Chat, Claude (Claude Code on the person's computers) and Settings. Each part is its own file; this one hands
// them what they need from each other, and tells the buddy what happens (its feelings, as src/main/feelings.js does on
// the Mac).
```

with:

```js
// Buddy on iPhone: starts everything. Signed out, the head and the sign-in button; signed in, three tabs under the
// head: Chat (answered by Buddy's server or the person's own key: route.js), Claude (Claude Code on the person's
// computers) and Settings. Each part is its own file; this one hands them what they need from each other, and tells
// the buddy what happens (its feelings, as src/main/feelings.js does on the Mac).
```

- [ ] **Step 14: Edit `web/public/app/app.js`.** Replace:

```js
import { createChat } from './chat-core.js';
```

with:

```js
import { createChat } from './chat-core.js';
import { createAsk } from './route.js';
import { createOwnAi } from './own-ai.js';
import { startAiSettings } from './ai-settings.js';
```

- [ ] **Step 15: Edit `web/public/app/app.js`.** Replace:

```js
const memory = createMemory({ store });
```

with:

```js
const memory = createMemory({ store });
const own = createOwnAi({ store }); // the person's own AI key, on this phone only
```

- [ ] **Step 16: Edit `web/public/app/app.js`.** Replace (`currentConfig` and `loadConfig` are function declarations further down, so they are hoisted):

```js
const chat = createChat({
  ask: (body) => api.post('/api/ask', body, { timeoutMs: TIMEOUTS.ask }),
```

with:

```js
const chat = createChat({
  ask: createAsk({
    config: currentConfig,
    freshConfig: () => (person ? loadConfig(person) : Promise.resolve(null)),
    hasKey: () => own.hasKey(),
    askOwn: (body) => own.ask(body),
    askServer: (body) => api.post('/api/ask', body, { timeoutMs: TIMEOUTS.ask }),
  }),
```

- [ ] **Step 17: Edit `web/public/app/app.js`.** Replace:

```js
  support: () => supportHere(window),
});
```

with:

```js
  support: () => supportHere(window),
});
const aiSettings = startAiSettings({ own, config: () => config });
```

- [ ] **Step 18: Edit `web/public/app/app.js`.** Replace:

```js
  if (next === 'settings') settings.draw();
```

with:

```js
  if (next === 'settings') {
    settings.draw();
    aiSettings.draw();
  }
```

- [ ] **Step 19: Edit `web/public/app/app.js`.** Replace (`configAgain` below keeps working: it still reads `configAsk`):

```js
let configAsk = null; // the GET /api/config under way

/** GET /api/config for `who`, and what hangs on it (voice). Offline it stays null, and is asked again (configAgain). */
async function loadConfig(who) {
  const ask = api.get('/api/config', { timeoutMs: TIMEOUTS.config }).catch(() => null);
  configAsk = ask;
  const got = await ask;
  if (configAsk === ask) configAsk = null;
  if (person !== who) return; // signed out meanwhile
  config = got;
  chatView.setVoice(config?.voiceOn === true);
  claudeView.setVoice(config?.voiceOn === true);
}
```

with:

```js
let configAsk = null; // the GET /api/config under way: loadConfig's answer

/**
 * GET /api/config for `who`, and what hangs on it (voice, Settings → AI). Answers what came, or null. Offline the
 * config stays what it was (null at first: it is asked for again, configAgain).
 */
function loadConfig(who) {
  const ask = (async () => {
    const got = await api.get('/api/config', { timeoutMs: TIMEOUTS.config }).catch(() => null);
    if (configAsk === ask) configAsk = null;
    if (person !== who) return null; // signed out meanwhile
    if (got) config = got;
    chatView.setVoice(config?.voiceOn === true);
    claudeView.setVoice(config?.voiceOn === true);
    if (tab === 'settings') aiSettings.draw();
    return got;
  })();
  configAsk = ask;
  return ask;
}

/** The config a message goes by: the one there is, else the one on its way, else one more try. */
async function currentConfig() {
  if (!config && person) await (configAsk ?? loadConfig(person));
  return config;
}
```

- [ ] **Step 20: Run the tests: they pass**

```bash
node --test test/web-app-chat.test.mjs test/web-app-files.test.mjs test/web-app-ai-settings.test.mjs
```

Expected: PASS: 0 fail.

- [ ] **Step 21: Run the whole suite (eslint and every test)**

```bash
npm test
```

Expected: PASS: 1596 tests, 0 fail (eslint clean).

- [ ] **Step 22: Check it in a browser (signed out only; localhost cannot sign in)**

`PORT=8797 npm run serve:web` (run it in the background), open http://localhost:8797/app: the console has no errors (`startAiSettings` looks up its elements when the app starts, so a missing id would throw). In the console, `document.getElementById('ai-provider').options.length` is 4 (Claude (Anthropic), OpenAI, Google Gemini, Groq). Stop the server by its PID (`kill $(lsof -ti tcp:8797 -sTCP:LISTEN)`), never by name.

- [ ] **Step 23: Commit**

```bash
git add web/public/app/ai-settings.js web/public/app/chat-core.js web/public/app/app.js web/public/app/index.html web/public/app/app.css \
  test/web-app-chat.test.mjs test/web-app-files.test.mjs test/web-app-ai-settings.test.mjs
git commit -m "feat(iphone): your own AI key in Settings, used by the chat when free mode is off or used up"
```

---

### Task 4: Settings → Admin

**Files:**
- Create: `web/public/app/admin-core.js` (pure form logic and the Mac's words)
- Create: `web/public/app/admin.js` (draws the Admin section, talks to `/api/admin/*`)
- Modify: `web/public/app/api.js` (`put`)
- Modify: `web/public/app/index.html` (the Admin section after Notifications)
- Modify: `web/public/app/app.css` (`.note`, `h3`, `.switch small`, `.switch .num`, `.segmented`, `.users`)
- Modify: `web/public/app/app.js` (`startAdmin`, drawn with Settings, updated with the config, refetch after a save)
- Test: `test/web-app-api.test.mjs` (PUT), `test/web-app-admin.test.mjs`

**Interfaces:**
- Consumes: `api.js` `createApi(...).get(path, opts)`, `.post(path, body, opts)`, and the new `.put(path, body, opts)`; `dom.js` `$`, `make`, `button`; Task 3's `loadConfig(who)`, `aiSettings`, the `.part`, `.label`, `.row .grow`, `.good` CSS. Server shapes (web/lib/handlers.js): `GET/PUT /api/admin/settings` -> `{ config: { enabled, limitMode, dailyRequests, allowOwnKey, provider, model, clawdLook }, providers: [{ id, label, hasKey, fallbackModels }], voiceOn }`; `GET /api/admin/models?provider=` -> `{ models, live, warning? }`; `GET /api/admin/users` -> `{ users: [{ uid, email, name, joined, lastActive, blocked, usedToday }] }` (busiest first); `POST /api/admin/users { uid, blocked }` -> `{ user }`.
- Produces: `admin-core.js` exports `NO_KEYS, VOICE_ON, VOICE_OFF, LOADING_MODELS, USUAL_MODELS, SAVING, SAVED, CLAWD_SAVED, dailyShown(limitMode), voiceLine(voiceOn) -> { text, kind }, formView({ config, providers }) -> { noKeys, enabledLocked, providers: [{ value, label, selected }] }, modelOptions(models, chosen), modelsNote({ live, warning }), readForm({ enabled, limitMode, daily, own, provider, model }) -> patch, lastActiveText(iso), usersText(count)`; `admin.js` exports `startAdmin({ api, isAdmin: () => bool, onSaved?: () => void }) -> { draw(), update() }`.

`draw()` (Settings opened) loads the server's settings and users again; `update()` (the config changed) only shows or hides the section, and loads it the first time it shows. So the refetch of `/api/config` after a save does not reload the admin form (which would wipe "Saved ✓"). Loads run once at a time. The Clawd save also refetches the config, as the Mac's `admin:save` does for every save.

- [ ] **Step 1: Edit `test/web-app-api.test.mjs`.** Replace:

```js
test('a token turned down is renewed and the call made once more', async () => {
```

with:

```js
test('a PUT sends JSON too (the admin\'s settings)', async () => {
  const s = setup([reply(200, { config: { enabled: true } })]);
  assert.deepStrictEqual(await s.api.put('/api/admin/settings', { enabled: true }), { config: { enabled: true } });
  assert.strictEqual(s.calls[0].method, 'PUT');
  assert.deepStrictEqual(s.calls[0].headers, { authorization: 'Bearer t1', 'content-type': 'application/json' });
  assert.strictEqual(s.calls[0].body, '{"enabled":true}');
});

test('a token turned down is renewed and the call made once more', async () => {
```

- [ ] **Step 2: Create `test/web-app-admin.test.mjs`**

```js
// Buddy on iPhone: Settings → Admin's form logic (web/public/app/admin-core.js), the Mac's Admin window's.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import * as core from '../web/public/app/admin-core.js';

const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', hasKey: false, fallbackModels: ['claude-haiku-4-5-20251001'] },
  { id: 'openai', label: 'OpenAI', hasKey: true, fallbackModels: ['gpt-4.1-mini'] },
  { id: 'gemini', label: 'Google Gemini', hasKey: false, fallbackModels: ['gemini-flash-latest'] },
  { id: 'groq', label: 'Groq', hasKey: true, fallbackModels: ['llama-3.3-70b-versatile'] },
];
const config = (fields = {}) => ({
  enabled: true, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'openai', model: 'gpt-4.1-mini', clawdLook: 'head', ...fields,
});

test("the words are the Mac Admin window's", () => {
  const mac = fs.readFileSync(new URL('../src/renderer/admin/index.html', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../src/renderer/admin/admin.js', import.meta.url), 'utf8');
  for (const name of ['NO_KEYS', 'VOICE_ON', 'VOICE_OFF', 'LOADING_MODELS', 'USUAL_MODELS', 'SAVING', 'SAVED', 'CLAWD_SAVED']) {
    assert.ok(mac.includes(core[name]), `${name}: "${core[name]}" is not the Mac's`);
  }
});

test('only providers with a key on the server can be picked, plus the saved one', () => {
  assert.deepStrictEqual(core.formView({ config: config(), providers: PROVIDERS }).providers, [
    { value: 'openai', label: 'OpenAI', selected: true },
    { value: 'groq', label: 'Groq', selected: false },
  ]);
  assert.deepStrictEqual(core.formView({ config: config({ provider: 'gemini' }), providers: PROVIDERS }).providers.map((p) => p.label), [
    'OpenAI', 'Google Gemini (no key on the server)', 'Groq',
  ]);
});

test('no key on the server: the note, and free mode cannot be switched on (only off)', () => {
  const none = PROVIDERS.map((p) => ({ ...p, hasKey: false }));
  const off = core.formView({ config: config({ enabled: false }), providers: none });
  assert.deepStrictEqual([off.noKeys, off.enabledLocked], [true, true]);
  assert.strictEqual(core.formView({ config: config({ enabled: true }), providers: none }).enabledLocked, false);
  assert.strictEqual(core.formView({ config: config(), providers: PROVIDERS }).noKeys, false);
});

test('the form as a patch: the daily box and own key only for a daily limit', () => {
  const form = { enabled: true, daily: '50', own: true, provider: 'groq', model: 'llama-3.3-70b-versatile' };
  assert.deepStrictEqual(core.readForm({ ...form, limitMode: 'daily' }), {
    enabled: true, limitMode: 'daily', provider: 'groq', model: 'llama-3.3-70b-versatile', dailyRequests: 50, allowOwnKey: true,
  });
  assert.deepStrictEqual(core.readForm({ ...form, limitMode: 'unlimited', daily: 'oops' }), {
    enabled: true, limitMode: 'unlimited', provider: 'groq', model: 'llama-3.3-70b-versatile',
  });
  assert.strictEqual(core.readForm({ ...form, limitMode: undefined }).limitMode, 'daily');
  assert.strictEqual(core.dailyShown('daily'), true);
  assert.strictEqual(core.dailyShown('unlimited'), false);
});

test('the models, the voice line, the users', () => {
  assert.deepStrictEqual(core.modelOptions(['a', 'b'], 'b').map((o) => o.selected), [false, true]);
  assert.deepStrictEqual(core.modelOptions(['a'], 'old').map((o) => o.value), ['old', 'a'], 'the saved model stays in the list');
  assert.strictEqual(core.modelsNote({ live: true }), '');
  assert.strictEqual(core.modelsNote({ live: false, warning: "Couldn't load…" }), '');
  assert.strictEqual(core.modelsNote({ live: false }), core.USUAL_MODELS);
  assert.deepStrictEqual(core.voiceLine(true), { text: 'Voice is on.', kind: 'muted' });
  assert.deepStrictEqual(core.voiceLine(false), { text: 'Voice needs GROQ_API_KEY in Vercel.', kind: 'note' });
  assert.strictEqual(core.lastActiveText(null), 'never');
  assert.strictEqual(core.lastActiveText('2026-10-09T10:00:00.000Z'), new Date('2026-10-09T10:00:00.000Z').toLocaleString());
  assert.strictEqual(core.usersText(1), '1 user');
  assert.strictEqual(core.usersText(0), '0 users');
});
```

- [ ] **Step 3: Run the new tests: they fail**

```bash
node --test test/web-app-api.test.mjs test/web-app-admin.test.mjs
```

Expected: FAIL: the PUT test fails with `TypeError: s.api.put is not a function`; `web-app-admin.test.mjs` fails with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 4: Edit `web/public/app/api.js`.** Replace:

```js
 * onSignedOut() is called when the server turned the person's sign-in down twice. Answers { get, post }: each answers
 * the server's JSON, or throws an ApiError.
```

with:

```js
 * onSignedOut() is called when the server turned the person's sign-in down twice. Answers { get, post, put }: each
 * answers the server's JSON, or throws an ApiError.
```

- [ ] **Step 5: Edit `web/public/app/api.js`.** Replace:

```js
    post: (path, body, options = {}) => call(path, { ...options, method: 'POST', body }),
```

with:

```js
    post: (path, body, options = {}) => call(path, { ...options, method: 'POST', body }),
    put: (path, body, options = {}) => call(path, { ...options, method: 'PUT', body }),
```

- [ ] **Step 6: Create `web/public/app/admin-core.js`**

```js
// Settings → Admin without the page: the Mac's Admin window's form logic and words (src/renderer/admin/admin.js), for
// the same routes (/api/admin/settings, /models, /users). admin.js draws it.

export const NO_KEYS = "No AI key is set on the server yet, so free mode can't be turned on.";
export const VOICE_ON = 'Voice is on.';
export const VOICE_OFF = 'Voice needs GROQ_API_KEY in Vercel.';
export const LOADING_MODELS = 'Loading the models…';
export const USUAL_MODELS = 'The usual models for this provider.';
export const SAVING = 'Saving…';
export const SAVED = 'Saved ✓ Every Buddy app uses it the next time it is opened.';
export const CLAWD_SAVED = 'Saved ✓ Every Buddy app uses it the next time it checks.';

/** The daily box and "own key" belong to a daily limit only. */
export const dailyShown = (limitMode) => limitMode === 'daily';

/** The voice line: on when the server has a Groq key; without one, where the key goes. */
export function voiceLine(voiceOn) {
  return voiceOn === true ? { text: VOICE_ON, kind: 'muted' } : { text: VOICE_OFF, kind: 'note' };
}

/** What the Free AI form starts as, from the server's view { config, providers }. */
export function formView({ config, providers }) {
  const withKey = providers.filter((p) => p.hasKey);
  return {
    noKeys: withKey.length === 0,
    // Free mode can't be switched on with no key on the server (it can still be switched off).
    enabledLocked: withKey.length === 0 && !config.enabled,
    // Only providers with a key on the server can be picked, plus the saved one, so that the list shows what is saved.
    providers: providers.filter((p) => p.hasKey || p.id === config.provider).map((p) => ({
      value: p.id,
      label: p.hasKey ? p.label : `${p.label} (no key on the server)`,
      selected: p.id === config.provider,
    })),
  };
}

/** `models` with `chosen` selected, kept in the list even when the server no longer lists it. */
export function modelOptions(models, chosen) {
  const list = models.includes(chosen) ? models : [chosen, ...models];
  return list.map((m) => ({ value: m, label: m, selected: m === chosen }));
}

/** The note under Model once the list came: GET /api/admin/models's { live, warning }. */
export function modelsNote({ live, warning }) {
  return live || warning ? '' : USUAL_MODELS;
}

/**
 * The switches as the form has them, for PUT /api/admin/settings. The daily box and "own key" are only read for a
 * daily limit (they are hidden for Unlimited), so what is left in them then cannot stop Unlimited from saving.
 */
export function readForm({ enabled, limitMode, daily, own, provider, model }) {
  const mode = limitMode || 'daily';
  const form = { enabled, limitMode: mode, provider, model };
  if (mode === 'daily') {
    form.dailyRequests = Number(daily);
    form.allowOwnKey = own;
  }
  return form;
}

/** "Last active": the time in the phone's own way of writing it, or "never". */
export function lastActiveText(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

export const usersText = (count) => (count === 1 ? '1 user' : `${count} users`);
```

- [ ] **Step 7: Create `web/public/app/admin.js`**

```js
// Settings → Admin, for the admin only (GET /api/config's isAdmin; the server refuses everyone else anyway): what the
// Mac's Admin window does, in the same words. Free AI's switches, where Clawd walks, and the users with Block. The form
// logic is admin-core.js's; this file draws it and talks to the server with api.js.

import {
  NO_KEYS, LOADING_MODELS, SAVING, SAVED, CLAWD_SAVED,
  dailyShown, voiceLine, formView, modelOptions, modelsNote, readForm, lastActiveText, usersText,
} from './admin-core.js';
import { $, make, button } from './dom.js';

const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const checkedValue = (name) => radios(name).find((r) => r.checked)?.value;

/**
 * api is api.js's; isAdmin() whether GET /api/config said so; onSaved() after the switches were saved (the app fetches
 * its config again, so the admin's own phone follows them at once). Answers { draw, update }.
 */
export function startAdmin({ api, isAdmin, onSaved = () => {} }) {
  let view = null; // { config, providers, voiceOn }, as the server last answered
  let loading = null; // load() under way

  function showStatus(id, text, kind = 'muted') {
    $(id).textContent = text;
    $(id).className = kind;
    $(id).hidden = !text;
  }

  function fillSelect(id, options) {
    $(id).replaceChildren(...options.map((o) => {
      const option = make('option', '', o.label);
      option.value = o.value;
      option.selected = o.selected;
      return option;
    }));
  }

  function syncForm() {
    const daily = dailyShown(checkedValue('admin-limit'));
    $('admin-daily-row').hidden = !daily;
    $('admin-own-row').hidden = !daily;
  }

  async function loadModels(provider, chosen) {
    const known = view.providers.find((p) => p.id === provider);
    fillSelect('admin-model', modelOptions(known ? known.fallbackModels : [], chosen));
    showStatus('admin-models-note', LOADING_MODELS);
    showStatus('admin-models-warning', '', 'error');
    let r;
    try {
      r = await api.get(`/api/admin/models?provider=${encodeURIComponent(provider)}`);
    } catch (err) {
      if ($('admin-provider').value !== provider) return;
      showStatus('admin-models-note', '');
      showStatus('admin-models-warning', err.message, 'error');
      return;
    }
    if ($('admin-provider').value !== provider) return; // another provider was picked meanwhile
    fillSelect('admin-model', modelOptions(r.models, $('admin-model').value || chosen));
    showStatus('admin-models-note', modelsNote(r));
    showStatus('admin-models-warning', r.warning || '', 'error'); // the server's words: the usual models are shown
  }

  function render() {
    const { config } = view;
    const form = formView(view);
    showStatus('admin-no-keys', form.noKeys ? NO_KEYS : '', 'error');
    const voice = voiceLine(view.voiceOn);
    showStatus('admin-voice', voice.text, voice.kind);
    $('admin-enabled').checked = config.enabled;
    $('admin-enabled').disabled = form.enabledLocked;
    for (const r of radios('admin-limit')) r.checked = r.value === config.limitMode;
    $('admin-daily').value = String(config.dailyRequests);
    $('admin-own').checked = config.allowOwnKey;
    for (const r of radios('admin-clawd')) r.checked = r.value === config.clawdLook;
    fillSelect('admin-provider', form.providers);
    syncForm();
    loadModels(config.provider, config.model);
  }

  function userRow(user) {
    const li = make('li', user.blocked ? 'blocked' : '');
    const who = make('div', 'who');
    who.append(make('span', 'name', user.name || '—'), make('span', 'under', user.email),
      make('span', 'under', `Today: ${user.usedToday} · Last active: ${lastActiveText(user.lastActive)}`));
    const block = button('chip', user.blocked ? 'Unblock' : 'Block', () => setBlocked(user, li, block));
    li.append(who, block);
    return li;
  }

  function renderUsers(users) {
    showStatus('admin-users-status', usersText(users.length));
    $('admin-users').replaceChildren(...users.map(userRow));
    $('admin-users-empty').hidden = users.length > 0;
  }

  async function loadUsers() {
    showStatus('admin-users-status', 'Loading…');
    try {
      renderUsers((await api.get('/api/admin/users')).users);
    } catch (err) {
      showStatus('admin-users-status', err.message, 'error');
    }
  }

  async function setBlocked(user, li, block) {
    block.disabled = true;
    let r;
    try {
      r = await api.post('/api/admin/users', { uid: user.uid, blocked: !user.blocked });
    } catch (err) {
      block.disabled = false;
      showStatus('admin-users-status', err.message, 'error');
      return;
    }
    // The row shows what the server answered; the whole list is loaded again only by Refresh and opening Settings.
    li.replaceWith(userRow(r.user));
    showStatus('admin-users-status', usersText($('admin-users').children.length));
  }

  /** The server's settings and users, from the start (once at a time). Nothing shows until the settings came. */
  function load() {
    loading ??= (async () => {
      $('admin-body').hidden = true;
      showStatus('admin-load-error', '', 'error');
      try {
        view = await api.get('/api/admin/settings');
      } catch (err) {
        view = null;
        showStatus('admin-load-error', err.message, 'error');
        return;
      }
      render();
      showStatus('admin-save-status', '');
      showStatus('admin-clawd-status', '');
      $('admin-body').hidden = false;
      await loadUsers();
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** Shows or hides the section; answers whether it shows. */
  function toggle() {
    const allowed = isAdmin();
    $('admin-part').hidden = !allowed;
    if (!allowed) view = null;
    return allowed;
  }

  for (const r of radios('admin-limit')) r.addEventListener('change', syncForm);
  $('admin-provider').addEventListener('change', () => {
    const p = view.providers.find((x) => x.id === $('admin-provider').value);
    loadModels(p.id, p.fallbackModels[0]);
  });
  $('admin-models-refresh').addEventListener('click', () => loadModels($('admin-provider').value, $('admin-model').value));
  // "Saved ✓", or why a save was refused, is about the form as it was: it goes as soon as a field changes.
  $('admin-free').addEventListener('input', () => showStatus('admin-save-status', ''));
  $('admin-save').addEventListener('click', async () => {
    $('admin-save').disabled = true;
    showStatus('admin-save-status', SAVING);
    const patch = readForm({
      enabled: $('admin-enabled').checked,
      limitMode: checkedValue('admin-limit'),
      daily: $('admin-daily').value,
      own: $('admin-own').checked,
      provider: $('admin-provider').value,
      model: $('admin-model').value,
    });
    try {
      view = await api.put('/api/admin/settings', patch);
    } catch (err) {
      showStatus('admin-save-status', err.message, 'error');
      return;
    } finally {
      $('admin-save').disabled = false;
    }
    render();
    showStatus('admin-save-status', SAVED, 'good');
    onSaved();
  });
  // Where Clawd walks: saved at once, on its own (the Free AI form keeps whatever is being changed there).
  for (const r of radios('admin-clawd')) {
    r.addEventListener('change', async () => {
      showStatus('admin-clawd-status', SAVING);
      let saved;
      try {
        saved = await api.put('/api/admin/settings', { clawdLook: r.value });
      } catch (err) {
        showStatus('admin-clawd-status', err.message, 'error');
        for (const other of radios('admin-clawd')) other.checked = other.value === view.config.clawdLook;
        return;
      }
      view = { ...view, config: { ...view.config, clawdLook: saved.config.clawdLook } };
      showStatus('admin-clawd-status', CLAWD_SAVED, 'good');
      onSaved();
    });
  }
  $('admin-users-refresh').addEventListener('click', loadUsers);

  return {
    /** The Settings tab opened: for the admin, the section with the server's settings and users, loaded again. */
    draw() {
      if (toggle()) load();
    },

    /** The config changed: the section shows or hides, and is loaded the first time it shows. */
    update() {
      if (toggle() && !view) load();
    },
  };
}
```

- [ ] **Step 8: Edit `web/public/app/index.html`.** The Admin section after Notifications, before Account. Replace:

```html
    <h2>Account</h2>
```

with:

```html
    <!-- For the admin only (admin.js): what the Mac's Admin window does. Nothing in it shows until the settings came. -->
    <div class="part" id="admin-part" hidden>
      <h2>Admin</h2>
      <p class="error" id="admin-load-error" role="alert" hidden></p>
      <div class="part" id="admin-body" hidden>
        <div class="part" id="admin-free">
          <h3>Free AI</h3>
          <p class="muted">These switches apply to every Buddy app and every user, the next time they open Buddy.</p>
          <p class="error" id="admin-no-keys" hidden></p>
          <p class="muted" id="admin-voice" aria-live="polite" hidden></p>
          <label class="switch"><span>Free mode<small>Everyone uses your AI key.</small></span><input type="checkbox" id="admin-enabled"></label>
          <p class="label" id="admin-limit-label">Free requests</p>
          <div class="segmented" role="radiogroup" aria-labelledby="admin-limit-label">
            <label><input type="radio" name="admin-limit" value="unlimited"><span>Unlimited</span></label>
            <label><input type="radio" name="admin-limit" value="daily"><span>Daily limit</span></label>
          </div>
          <label class="switch" id="admin-daily-row"><span>Requests per user per day</span><input class="field num" id="admin-daily" type="number" min="1" max="10000" step="1" inputmode="numeric"></label>
          <label class="switch" id="admin-own-row"><span>Also let users add their own key<small>Used after their free requests run out.</small></span><input type="checkbox" id="admin-own"></label>
          <label class="label" for="admin-provider">AI provider</label>
          <select class="field" id="admin-provider"></select>
          <label class="label" for="admin-model">Model</label>
          <div class="row">
            <select class="field" id="admin-model"></select>
            <button class="btn btn--ghost btn--sm" id="admin-models-refresh" type="button">Refresh</button>
          </div>
          <p class="muted" id="admin-models-note" aria-live="polite" hidden></p>
          <p class="error" id="admin-models-warning" aria-live="polite" hidden></p>
          <div class="row">
            <button class="btn btn--ink btn--sm" id="admin-save" type="button">Save</button>
            <span class="muted" id="admin-save-status" aria-live="polite" hidden></span>
          </div>
        </div>

        <h3>Claude Code</h3>
        <p class="muted">While Claude Code works, Clawd walks with Buddy on the Mac and on the phone. Pick where, for every user.</p>
        <p class="label" id="admin-clawd-label">Clawd walks</p>
        <div class="segmented" role="radiogroup" aria-labelledby="admin-clawd-label">
          <label><input type="radio" name="admin-clawd" value="head"><span>On Buddy’s head</span></label>
          <label><input type="radio" name="admin-clawd" value="face"><span>Under Buddy’s eyes</span></label>
        </div>
        <p class="muted" id="admin-clawd-status" aria-live="polite" hidden></p>

        <h3>Users</h3>
        <div class="row">
          <span class="grow muted" id="admin-users-status" aria-live="polite"></span>
          <button class="btn btn--ghost btn--sm" id="admin-users-refresh" type="button">Refresh</button>
        </div>
        <ul class="users" id="admin-users"></ul>
        <p class="muted" id="admin-users-empty" hidden>No users yet.</p>
      </div>
    </div>

    <h2>Account</h2>
```

- [ ] **Step 9: Edit `web/public/app/app.css`.** Replace:

```css
p.row { margin: 0; }
```

with:

```css
p.row { margin: 0; }
.note { margin: 0; padding: 8px 12px; border-radius: 12px; background: var(--orange-tint); font-size: 15px; }
/* the admin's part */
.settings h3 { margin: 8px 0 0; font: 700 18px/1.1 var(--display); }
.switch small { display: block; color: var(--ink-2); font-size: 14px; }
.switch .num { flex: none; width: 96px; height: auto; text-align: right; }
.segmented { display: flex; gap: 4px; padding: 4px; border-radius: 999px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.segmented label { flex: 1; }
.segmented input { position: absolute; opacity: 0; pointer-events: none; }
.segmented span { display: block; padding: 8px 10px; border-radius: 999px; font-size: 15px; font-weight: 600; text-align: center; }
.segmented input:checked + span { background: var(--ink); color: var(--cream); }
.segmented input:focus-visible + span { outline: 2px solid var(--orange); }
.users { display: grid; gap: 6px; margin: 0; padding: 0; list-style: none; }
.users li { display: flex; align-items: center; gap: 8px; padding: 8px 8px 8px 14px; border-radius: 14px; background: var(--paper); box-shadow: 0 0 0 1px var(--line); }
.users li.blocked { background: var(--bad-bg); }
.users .who { flex: 1; min-width: 0; }
.users .name { display: block; font-weight: 600; }
.users .under { display: block; overflow: hidden; color: var(--ink-2); font-size: 13px; text-overflow: ellipsis; white-space: nowrap; }
```

- [ ] **Step 10: Edit `web/public/app/app.js`.** Replace:

```js
import { startAiSettings } from './ai-settings.js';
```

with:

```js
import { startAiSettings } from './ai-settings.js';
import { startAdmin } from './admin.js';
```

- [ ] **Step 11: Edit `web/public/app/app.js`.** Replace:

```js
const aiSettings = startAiSettings({ own, config: () => config });
```

with:

```js
const aiSettings = startAiSettings({ own, config: () => config });
const admin = startAdmin({
  api,
  isAdmin: () => config?.isAdmin === true,
  onSaved: () => {
    if (person) loadConfig(person); // the admin's own phone follows the new switches at once
  },
});
```

- [ ] **Step 12: Edit `web/public/app/app.js`.** Replace:

```js
    settings.draw();
    aiSettings.draw();
  }
```

with:

```js
    settings.draw();
    aiSettings.draw();
    admin.draw();
  }
```

- [ ] **Step 13: Edit `web/public/app/app.js`.** In `showSignedOut`, replace:

```js
  claudeView.leave();
  chat.clear();
}
```

with:

```js
  claudeView.leave();
  chat.clear();
  admin.update(); // hidden, and forgotten
}
```

- [ ] **Step 14: Edit `web/public/app/app.js`.** In `loadConfig`, replace:

```js
    if (tab === 'settings') aiSettings.draw();
    return got;
```

with:

```js
    if (tab === 'settings') {
      aiSettings.draw();
      admin.update();
    }
    return got;
```

- [ ] **Step 15: Run the tests: they pass**

```bash
node --test test/web-app-api.test.mjs test/web-app-admin.test.mjs test/web-app-files.test.mjs
```

Expected: PASS: 0 fail.

- [ ] **Step 16: Run the whole suite (eslint and every test)**

```bash
npm test
```

Expected: PASS: 1602 tests, 0 fail (eslint clean).

- [ ] **Step 17: Check it in a browser (signed out)**

`PORT=8797 npm run serve:web` in the background, open http://localhost:8797/app: no console errors. In the console, unhide `settings-pane`, `admin-part` and `admin-body` (`.hidden = false`) and click the "Daily limit" radio: its pill turns dark and "Requests per user per day" shows; no console errors. Stop the server by its PID (`kill $(lsof -ti tcp:8797 -sTCP:LISTEN)`).

- [ ] **Step 18: Commit**

```bash
git add web/public/app/admin-core.js web/public/app/admin.js web/public/app/api.js web/public/app/index.html web/public/app/app.css web/public/app/app.js \
  test/web-app-api.test.mjs test/web-app-admin.test.mjs
git commit -m "feat(iphone): Settings → Admin for the admin, as the Mac's Admin window"
```

---

### Task 5: Docs: web/README.md, README.md, the iPhone checklist

**Files:**
- Modify: `web/README.md` (the `public/app/` paragraph)
- Modify: `README.md` (a new "iPhone" section before "Sign-in and free mode"; that section names Settings → Admin)
- Modify: `docs/manual-checklist-iphone.md` ("Your own AI key" and "Admin" sections before "Updates")

**Interfaces:**
- Consumes: the words shipped in Tasks 2 to 4 (route.js, ai-settings.js, admin-core.js).
- Produces: nothing code uses.

README.md has no iPhone section yet (only Android), so this task adds a short one. The Android section's "There is no Admin on the phone" is about Android and stays.

- [ ] **Step 1: Edit `web/README.md`.** Replace:

```md
passed on to Firebase (`vercel.json`) so that sign-in by redirect works in a Home Screen app.
```

with:

```md
passed on to Firebase (`vercel.json`) so that sign-in by redirect works in a Home Screen app. Its Settings has an AI
section, for the person's own AI key: kept on the phone only, it goes from the page straight to the AI provider, never
to this server. The admin also gets an Admin section there, which uses the `/api/admin/*` routes below as the Mac's
Admin window does (design: `docs/superpowers/specs/2026-10-09-iphone-own-key-and-admin-design.md`).
```

- [ ] **Step 2: Edit `README.md`.** Replace:

```md
## Sign-in and free mode

Everyone signs in with Google. The admin (akshatg9636@gmail.com) gets
**Admin…** in the menu bar, to make Buddy free for everyone with the server's AI
key — unlimited or a number of requests a day — and to block people.
```

with:

```md
## iPhone

Buddy on iPhone is a web app: open https://buddywrites.vercel.app/app in Safari,
then Share → Add to Home Screen. It has the same chat (with voice), shows your
Claude Code sessions, and tells you when one finishes. **Settings → AI** takes
your own AI key (Claude, OpenAI, Gemini or Groq) for when free mode is off or
used up: the key stays on the phone and goes only to that AI. The admin also
gets **Settings → Admin** there, with the same switches and users as the Mac's
Admin window. The code is in `web/public/app/` (see `web/README.md`); what only
a real iPhone can check is in `docs/manual-checklist-iphone.md`.

## Sign-in and free mode

Everyone signs in with Google. The admin (akshatg9636@gmail.com) gets
**Admin…** in the menu bar (and **Settings → Admin** in the iPhone app), to make
Buddy free for everyone with the server's AI key — unlimited or a number of
requests a day — and to block people.
```

- [ ] **Step 3: Edit `docs/manual-checklist-iphone.md`.** Replace:

```md
## Updates
```

with:

```md
## Your own AI key
- [ ] Free mode on and Unlimited (Settings → Admin, or the Mac's Admin window): Settings → AI says "Free AI is on. No
      key needed." and shows no form.
- [ ] Free mode off: Settings → AI shows Provider, API key and Model. Chat with no key saved: "Free AI is off. Add your
      own key in Settings."
- [ ] Provider Claude (Anthropic), "Get a key": Anthropic's key page opens. Paste a key, Save: "Key saved ✓ (ends in
      …)" with its last 4 characters, the box is empty again, and Model lists your key's models.
- [ ] Chat `boss ko mail likho`: the answer comes, from your key.
- [ ] With Claude picked, paste a Groq key (`gsk_…`) and Save: "That key is for Groq, so I switched to Groq. Key saved
      ✓ …", and Provider shows Groq. Chat: Groq answers. Do the same with an OpenAI key and a Gemini key.
- [ ] Pick another model, close Buddy fully and open it again: the same model is picked.
- [ ] A wrong key (change one character): chat says "Your Claude key was rejected. Check it in Settings."
- [ ] Sign out and sign in again: the key is still saved. Remove: "No key yet.", and chat says "Free AI is off. Add
      your own key in Settings." again.
- [ ] Daily limit 1 with "Also let users add their own key" on: with a key saved, the second message of the day is
      answered by your key; with none, it says "You've used today's 1 free requests. Add your own key in Settings to
      keep going, or wait until midnight."

## Admin
- [ ] Signed in as the admin: Settings → Admin shows after Notifications, with Free AI, Claude Code and Users. Signed in
      with any other account: there is no Admin section.
- [ ] Turn free mode off, Save: "Saved ✓ Every Buddy app uses it the next time it is opened.", and Settings → AI on
      this phone shows the key form at once.
- [ ] Daily limit shows "Requests per user per day" and "Also let users add their own key"; Unlimited hides them. A
      limit of 0 is refused with the server's words.
- [ ] AI provider lists only the providers with a key on the server; Refresh loads that provider's models.
- [ ] Clawd walks → "Under Buddy’s eyes": "Saved ✓ Every Buddy app uses it the next time it checks.", and the Claude
      Code look on the Mac follows.
- [ ] Users: everyone, busiest today first, with today's count and when they were last active. Block someone: the row
      turns red with Unblock, and their chat says "Your free access is paused.". Unblock them.

## Updates
```

- [ ] **Step 4: Run the whole suite (eslint and every test)**

```bash
npm test
```

Expected: PASS: 1602 tests, 0 fail.

- [ ] **Step 5: Run the sync**

```bash
npm run sync:web-app && git status --short web/public/app
```

Expected: Nothing listed: the copies made in Task 1 are up to date.

- [ ] **Step 6: Commit**

```bash
git add web/README.md README.md docs/manual-checklist-iphone.md
git commit -m "docs(iphone): own AI key and Settings → Admin"
```

---

## Self-review against the spec

- Settings → AI between Buddy and Memory, the Mac's free-mode line (`aiSection`), the form only when `showForm`: Task 3 (`index.html`, `ai-settings.js` `draw`).
- Provider list in `PROVIDERS` order with their labels, no Claude Code: Task 3 (`PROVIDER_IDS.map`); Task 1 test pins the four ids.
- Password field, "Get a key" to `keyUrl`, Save with `providerForKey` switching, Remove, a saved key shown only as "Key saved ✓ (ends in abcd)": Tasks 2 (`saveKey`, `removeKey`, `keyEnd`) and 3 (`keyLine`).
- Model: live list with a saved key, else `fallbackModels`; first model until one is picked: Task 2 (`listModels`, `model`), Task 3 (`modelList`, `setModel` on change).
- Key only in `localStorage` key `ai` with the spec's shape, kept on sign out (nothing in `signOut` touches it), never sent to Buddy's server: Task 2 (`own-ai.js` calls only the provider).
- Anthropic header only for `https://api.anthropic.com/`; prompt via `buildPrompt('chat', …)` / `parseChat`, `MAX_TOKENS`, 60 s `AbortSignal.timeout`: Task 2, tested.
- The routing table and every refusal rule, error texts verbatim: Task 2 (`route.js`), one assertion per row; wired in Task 3 (`createAsk` in `app.js`, a fresh `/api/config` after a refusal).
- `FREE_OFF` no longer shown; `free_off` shows "Free AI is off. Add your own key in Settings.": Task 3.
- Provider `BuddyError` messages shown as they are: Task 3 (`failureText` test with a refused key).
- Admin section after Notifications only for `isAdmin`; Free AI (switch, Unlimited/Daily, 1–10000, own key only for daily, providers with a key, "No AI key…", model + Refresh, voice line, Save), Claude Code look saved on pick, Users busiest first with Block/Unblock; the Mac's words: Task 4 (`admin-core.js` words test reads the Mac's admin files).
- `/api/config` fetched again after an admin save: Task 4 (`onSaved` → `loadConfig`).
- Docs and the owner's on-device checks: Task 5.

Decisions where the spec left room (flag in review if the owner wants otherwise):

- Save keeps the key at once and does not test it first (the Mac tests it with `listModels`); the live model list loads right after, so a refused key shows its words under the form, and the chat shows them too.
- "The first model is used until one is picked" is the provider's first usual model (`fallbackModels[0]`, as the Mac's `modelFor`); the model list always shows the model in use, first if the live list lacks it.
- Remove forgets the key of the AI picked (and its model); the other AIs' keys stay.
- `FREE_OFF` is deleted rather than kept unused.
- That OpenAI, Gemini and Groq answer a page's requests (CORS) is the spec's statement; only the owner's iPhone check (Task 5 checklist) proves it. A refusal shows as "Couldn't reach <AI>. Check your internet."

Notes for the implementer:

- `npm run sync:web-app` rewrites `web/public/app/shared/`, `buddies/`, `vendor/` only. If `git status` shows other changes under them after the sync, something else changed `shared/` or `src/main/`: stop and ask.
- Never deploy (`npm run deploy:server`), push, or kill processes by name. Stop the local server by its PID.
