# iPhone web app: the Claude screen like Buddy's Claude mode: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The iPhone web app's Claude tab draws a session exactly as the Mac panel's Claude mode does (terminal rows,
markdown, folded tools, working verb, CLI theme), with the status line (model + tokens), the live workers and the slash
commands (`/help`, `/cost`, `/model`, `/model <name>`, `/clear`, `/stop`), mobile first, light and dark.

**Architecture:** The Mac already has `stats` and `workers` in `live.js view()`. `share.js` relays them in the feed,
`web/lib/remote.js` cleans and keeps them, `phoneLook` returns them. `/stop` gets a new allow-listed relay
(`action: 'interrupt'` → inbox entry `{ key: 'esc' }` → `terminal.interrupt`); `/model <alias>` and `/clear` already
travel as typed words. The phone reuses the panel's DOM-free `claude-cli.js` (synced into `web/public/app/shared/`);
`claude-core.js` (pure, tested) reads the new fields, runs the commands and says what the screen shows; `claude.js`
draws it with code ported from `panel.js`.

**Tech Stack:** Plain JS: CommonJS on the Mac and the server, ES modules in the web app; `node:test`; ESLint.

**Spec:** `docs/superpowers/specs/2026-10-17-iphone-claude-design.md` (command table, copy, follow-ups).

## Global Constraints

- Work only in the worktree `/Users/akshat/projects/buddy-iphone-claude`, branch `iphone-claude`. Never touch other
  worktrees or branches.
- Commits as `git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit`, plain messages, no
  Co-Authored-By or AI mention.
- JS full test only with lock `until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock`.
  One file: `node --test test/<file>` (no lock needed).
- Do not push.
- Never run `npm run deploy:server` (the server deploys itself on merge).
- Match the code style: `'use strict'` in CommonJS, small functions with a one-line JSDoc in plain words, 2-space
  indent, single quotes, lines up to ~150 chars. Copy exactly as in the spec's copy table.
- Do not edit `web/public/app/shared/` by hand: run `npm run sync:web-app`.
- Do not change `src/renderer/panel/claude-cli.js` (the phone must stay the same as the Mac; the sync test guards it).
- Android is a follow-up: do not touch `android/`.
- Tasks are sequential: 1 → 2 → 3 → 4. Each ends green (`npm test` with the lock) and with one commit.

---

### Task 1: Relay the tokens and workers (Mac `share.js`, server `remote.js`, `mode.js`)

**Files:**
- Modify: `src/main/claude/share.js` (`feedOf`)
- Modify: `web/lib/remote.js` (`cleanStats`, `cleanWorkers`, `macReport`, `phoneLook`, exports)
- Modify: `src/main/claude/mode.js` (`remoteView`)
- Test: `test/claude-share.test.js`, `test/server-remote.test.js`, `test/claude-mode.test.js`

**Interfaces:**
- Feed sent by the Mac: `{ id, name, title, status, canTalk, items, stats?, workers? }`.
- `cleanStats(value) -> { model: string|null, input: number, output: number } | null`
- `cleanWorkers(value) -> [{ id, task, status, startedAt, endedAt, tokens }]` (≤ 20)
- `phoneLook(...).result.feed` gains `stats` (null when none) and `workers` ([] when none).

- [ ] **Step 1: Write the failing tests**

In `test/server-remote.test.js`, import `cleanStats, cleanWorkers` from the destructure at the top
(`const { macReport, phoneLook, ..., cleanStats, cleanWorkers } = remote;`), update the two exact feed expectations in
the test "the computer sends the watched session's items; ..." and add a test:

```js
// in "the computer sends the watched session's items; the watcher gets them; looking again soon writes nothing":
  assert.deepStrictEqual(next.feed, {
    sessionId: S1.id, device: MAC.name, name: 'shop', title: 'Fix the cart total', status: 'working', canTalk: true, items: ITEMS, stats: null, workers: [], at: T + 1000,
  });
  const look = phoneLook(next, S1.id, T + 2000);
  assert.deepStrictEqual(look.result.feed, {
    id: S1.id, device: MAC.name, name: 'shop', title: 'Fix the cart total', status: 'working', canTalk: true, items: ITEMS, stats: null, workers: [],
  });
```

```js
test("the watched session's tokens and workers are cleaned, kept and handed to the watcher", () => {
  const W = { id: 'toolu_01', task: 'Fix the login bug', status: 'running', startedAt: T - 5000, endedAt: null, tokens: 12_300 };
  assert.deepStrictEqual(cleanStats({ model: 'claude-opus-5-5', input: 1_200_000.4, output: 34_000, extra: 1 }), { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 });
  assert.deepStrictEqual(cleanStats({ model: '<img src=x onerror=1>', input: -5, output: 'many' }), { model: null, input: 0, output: 0 });
  assert.strictEqual(cleanStats('x'), null);
  assert.deepStrictEqual(cleanWorkers([
    { ...W, extra: 1 },
    { ...W, id: '../x' },
    { ...W, id: 'toolu_02', status: 'dancing' },
    { id: 'toolu_03', task: '  two\nlines ', status: 'done', startedAt: 'x', endedAt: T, tokens: -1 },
    null,
  ]), [W, { id: 'toolu_03', task: 'two lines', status: 'done', startedAt: null, endedAt: T, tokens: 0 }]);
  const many = Array.from({ length: 30 }, (_, i) => ({ ...W, id: `w${i}`, task: 'x'.repeat(500) }));
  const kept = cleanWorkers(many);
  assert.strictEqual(kept.length, 20);
  assert.strictEqual(kept[19].id, 'w29', 'the newest are kept');
  assert.ok(kept.every((w) => w.task.length <= 121));

  const watched = record({ watch: { sessionId: S1.id, at: T } });
  const stats = { model: 'claude-opus-5-5', input: 10, output: 2 };
  const { next } = report(watched, { feed: { ...S1, items: ITEMS, stats, workers: [W] } }, T + 1000);
  assert.deepStrictEqual([next.feed.stats, next.feed.workers], [stats, [W]]);
  const { result } = phoneLook(next, S1.id, T + 2000);
  assert.deepStrictEqual([result.feed.stats, result.feed.workers], [stats, [W]]);
  const old = record({ watch: { sessionId: S1.id, at: T }, feed: { sessionId: S1.id, device: MAC.name, name: 'shop', status: 'done', canTalk: true, items: ITEMS, at: T } });
  assert.deepStrictEqual([phoneLook(old, S1.id, T + 1000).result.feed.stats, phoneLook(old, S1.id, T + 1000).result.feed.workers], [null, []],
    'a feed kept before this change');
});
```

In `test/claude-share.test.js`, add a test (the existing fake `live.view` has no stats, so the existing expectation
stays as it is):

```js
test("the watched session's tokens and workers go with it, and again when only they change", async () => {
  const s = setup({ answers: Array.from({ length: 4 }, () => ({ watch: 's1', inbox: [] })) });
  const stats = { model: 'claude-opus-5-5', input: 10, output: 2 };
  const workers = [{ id: 'toolu_01', task: 'Fix it', status: 'running', startedAt: 1, endedAt: null, tokens: 5 }];
  s.live.view = (id) => (id === 's1' ? { ...S1, items: [...s.live.items], stats: { ...stats }, workers: workers.map((w) => ({ ...w })) } : null);
  s.share.start();
  await s.step();
  await s.step();
  assert.deepStrictEqual([s.reports[1].feed.stats, s.reports[1].feed.workers], [stats, workers]);
  await s.step();
  assert.strictEqual(s.reports[2].feed, undefined, 'nothing new');
  workers[0].tokens = 900;
  await s.step();
  assert.strictEqual(s.reports[3].feed.workers[0].tokens, 900, 'only the tokens changed: sent again');
});
```

In `test/claude-mode.test.js`, test "another computer's session: waiting until its items come, ...": the expected
session gains `stats: null, workers: []`:

```js
  assert.deepStrictEqual(session, {
    id: 'r1', name: 'api', title: null, status: 'waiting', canTalk: true, device: 'Office PC', remote: true, waiting: true, items: [], stats: null, workers: [],
  });
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/server-remote.test.js test/claude-share.test.js test/claude-mode.test.js`
Expected: FAIL (`cleanStats is not a function`, feed shapes differ).

- [ ] **Step 3: Implement**

`web/lib/remote.js`: after the existing constants add

```js
const WORKERS_MAX = 20;
const WORKER_STATUSES = ['running', 'done', 'failed', 'stopped'];
const WORKER_ID = /^[\w-]{1,100}$/;
const MODEL_ID = /^[\w.\-[\]<>]{1,80}$/; // claude-opus-5-5, claude-sonnet-4-5[1m]; never HTML (the phone sets text only anyway)
const TASK_CHARS = 120;
const TOKENS_MAX = 1e13;
```

and after `cleanItems`:

```js
const whole = (value) => (Number.isFinite(value) && value > 0 ? Math.min(Math.round(value), TOKENS_MAX) : 0);
const msOrNull = (value) => (Number.isFinite(value) && value > 0 ? Math.round(value) : null);

/** The watched session's tokens and model as the computer sent them (live.js stats), cleaned; null for none. */
function cleanStats(value) {
  if (!isObject(value)) return null;
  const model = typeof value.model === 'string' && MODEL_ID.test(value.model) ? value.model : null;
  return { model, input: whole(value.input), output: whole(value.output) };
}

/** The watched session's workers as the computer sent them (live.js workers), cleaned: the newest WORKERS_MAX, known fields only. */
function cleanWorkers(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((w) => isObject(w) && typeof w.id === 'string' && WORKER_ID.test(w.id) && WORKER_STATUSES.includes(w.status))
    .slice(-WORKERS_MAX)
    .map((w) => {
      const task = typeof w.task === 'string' ? w.task.replace(/\s+/g, ' ').trim() : '';
      return { id: w.id, task: task ? cut(task, TASK_CHARS) : 'A worker', status: w.status, startedAt: msOrNull(w.startedAt), endedAt: msOrNull(w.endedAt), tokens: whole(w.tokens) };
    });
}
```

In `macReport`, the feed built from `sent`:

```js
    feed = {
      sessionId: myWatch, device: device.name, name: view.name, title: view.title, status: view.status, canTalk: view.canTalk, items: cleanItems(sent.items),
      stats: cleanStats(sent.stats), workers: cleanWorkers(sent.workers), at: now,
    };
```

In `phoneLook`:

```js
  if (doc.feed?.sessionId === sessionId) {
    const { sessionId: id, device, name, title = null, status, canTalk, items, stats = null, workers = [] } = doc.feed;
    result.feed = { id, device, name, title, status, canTalk, items, stats, workers };
  }
```

Update the record comment at the top: `feed { sessionId, device, name, status, canTalk, items, stats, workers, at }`.
Export `cleanStats, cleanWorkers, WORKERS_MAX`.

`src/main/claude/share.js` `feedOf`:

```js
  function feedOf(id) {
    const view = live.view(id);
    if (!view) return null;
    // Claude's thinking is for the panel here only: the phone draws a kind it does not know as a plain line.
    const items = view.items.filter((item) => item.kind !== 'thinking').slice(-ITEMS_SENT);
    // The status line and the workers (usage.js): small, so they go whole, and their change counts as a change.
    const extra = {
      ...(view.stats ? { stats: view.stats } : {}),
      ...(Array.isArray(view.workers) ? { workers: view.workers } : {}),
    };
    const key = `${id}:${view.status}:${view.canTalk}:${items.length}:${items.length ? items[items.length - 1].id : 0}:${JSON.stringify(extra)}`;
    if (key === sentKey) return null;
    sentKey = key;
    return { id: view.id, name: view.name, title: view.title ?? null, status: view.status, canTalk: view.canTalk, items, ...extra };
  }
```

`src/main/claude/mode.js` `remoteView` return adds `stats: view.stats ?? null, workers: view.workers ?? []`:

```js
    return {
      id: session.id, name: view.name, title: view.title ?? session.title ?? null, status: view.status, canTalk: view.canTalk,
      device: session.device, remote: true, waiting: !feed, items: view.items, stats: view.stats ?? null, workers: view.workers ?? [],
    };
```

- [ ] **Step 4: Run the tests**

Run: `node --test test/server-remote.test.js test/claude-share.test.js test/claude-mode.test.js`
Expected: PASS.

- [ ] **Step 5: Full test and commit**

```bash
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add src/main/claude/share.js src/main/claude/mode.js web/lib/remote.js test/claude-share.test.js test/server-remote.test.js test/claude-mode.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude from anywhere: the session's tokens and workers go to the phone too"
```

---

### Task 2: `/stop` from the phone (Esc relayed to the session's terminal)

**Files:**
- Modify: `web/lib/handlers.js` (`remotePhone`: `action: 'interrupt'`)
- Modify: `web/lib/remote.js` (`phoneSend` takes `key`, `macReport` hands it on)
- Modify: `src/main/claude/share.js` (`report` filter, `typeAll`)
- Test: `test/server-remote.test.js`, `test/claude-share.test.js`

**Interfaces:**
- POST `/api/remote/phone { action: 'interrupt', session }` → `{ sent: true }` (same errors as `send`).
- `phoneSend(doc, { sessionId, text?, key?, id }, now)`: with `key: 'esc'` the inbox entry is `{ id, sessionId, key: 'esc', at }`.
- `macReport(...).result.inbox` entries: `{ id, sessionId, text }` or `{ id, sessionId, key: 'esc' }`.
- `share.js` calls `terminal.interrupt({ tty })` for `key: 'esc'`.

- [ ] **Step 1: Write the failing tests**

`test/server-remote.test.js`, add:

```js
test('Esc for a session waits for its computer like words, without text; an older Mac skips it', () => {
  const sent = phoneSend(record(), { sessionId: S1.id, key: 'esc', id: 'k1' }, T + 1000);
  assert.deepStrictEqual(sent.next.inbox, [{ id: 'k1', sessionId: S1.id, key: 'esc', at: T + 1000 }]);
  assert.deepStrictEqual(report(sent.next, {}, T + 2000).result.inbox, [{ id: 'k1', sessionId: S1.id, key: 'esc' }]);
  assert.throws(() => phoneSend(record(), { sessionId: 'zzzz', key: 'esc', id: 'k' }, T), { code: 'not_found' });
});
```

and in "Mac and phone of the same person meet through the server; ..." (or a new handler test next to it), the
handler path:

```js
test('the phone asks for Esc in a session: it reaches the computer; anything else is refused', async () => {
  const db = fakeDb({ remotes: { u1: record() } });
  const call = (r) => handle(remotePhone, r, deps(db, T + 100));
  assert.deepStrictEqual((await call(req('POST', 'a', { body: { action: 'interrupt', session: S1.id } }))).body, { sent: true });
  const answer = await handle(remoteMac, req('POST', 'm', { body: { device: MAC, sessions: [S1, S2] } }), deps(db, T + 200));
  assert.deepStrictEqual(answer.body.inbox.map(({ sessionId, key }) => ({ sessionId, key })), [{ sessionId: S1.id, key: 'esc' }]);
  assert.strictEqual((await call(req('POST', 'a', { body: { action: 'interrupt' } }))).status, 400);
  assert.strictEqual((await call(req('POST', 'a', { body: { action: 'interrupt', session: '../x' } }))).status, 400);
});
```

Use the file's existing `req`, `deps` and token helpers exactly as the neighbouring handler tests do (read lines
140-180 first; adapt the user/token arguments so the request is signed in as `u1`).

`test/claude-share.test.js`: in `setup`, give the fake terminal an `interrupt` that records
(`async interrupt(args) { typed.push({ esc: true, ...args }); }`), then add:

```js
test("Esc from the phone goes to its session's terminal once; a word without text or key is skipped", async () => {
  const inbox = [{ id: 'k1', sessionId: 's1', key: 'esc' }, { id: 'x1', sessionId: 's1' }, { id: 'x2', sessionId: 's1', key: 'f1' }];
  const s = setup({ answers: [{ watch: 's1', inbox }, { watch: 's1', inbox: [] }] });
  s.share.start();
  await s.step();
  assert.deepStrictEqual(s.typed, [{ esc: true, tty: 'ttys001' }]);
  await s.step();
  assert.deepStrictEqual(s.reports[1].done, ['k1']);
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/server-remote.test.js test/claude-share.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement**

`web/lib/remote.js` `phoneSend`:

```js
/**
 * A watcher sends words to a session, or a key (`key: 'esc'`, for /stop): they wait in the inbox for its computer, which
 * types them into its terminal (or presses the key there).
 */
function phoneSend(doc, { sessionId, text, key, id }, now) {
  if (!onlineDevices(doc, now).length) throw new BuddyError('mac_offline', OFFLINE);
  if (!ownerOf(doc, sessionId, now)) throw new BuddyError('not_found', NO_SESSION);
  const entry = key === 'esc' ? { id, sessionId, key: 'esc', at: now } : { id, sessionId, text, at: now };
  const inbox = [...(doc.inbox || []), entry].slice(-INBOX_MAX);
  return { next: { ...doc, inbox, watch: { sessionId, at: now } }, result: { sent: true } };
}
```

`macReport`, the `words` line:

```js
  const words = inbox.filter((m) => owns(m.sessionId))
    .map(({ id, sessionId, text, key }) => (key === 'esc' ? { id, sessionId, key } : { id, sessionId, text }));
```

Update the header comment: `inbox [{ id, sessionId, text | key: 'esc', at }]`.

`web/lib/handlers.js` `remotePhone`, after the `stop` line:

```js
  if (body.action === 'interrupt') {
    // /stop on the phone: Esc in the session's terminal on its computer (share.js, terminal.interrupt).
    const sessionId = remote.checkSessionId(body.session, { required: true });
    const id = deps.newId ? deps.newId() : require('node:crypto').randomUUID();
    return answer(await deps.db.updateRemote(who.uid, (doc) => remote.phoneSend(doc, { sessionId, key: 'esc', id }, now)));
  }
```

and add `POST { action: 'interrupt', session }: Esc in that session's terminal.` to its JSDoc.

`src/main/claude/share.js`: in `report`, the inbox filter:

```js
    const known = (m) => m && typeof m.id === 'string' && (typeof m.text === 'string' || m.key === 'esc');
    if (Array.isArray(r?.inbox)) await typeAll(r.inbox.filter(known));
```

`typeAll`:

```js
  /** Type each new word from the phone into its session's terminal (or press Esc there, for /stop); one that cannot be is let go, with a note. */
  async function typeAll(inbox) {
    for (const m of inbox) {
      if (handled.has(m.id)) continue;
      handled.add(m.id);
      done.push(m.id);
      const tty = live.target(m.sessionId)?.tty ?? null;
      try {
        if (m.key === 'esc') await terminal.interrupt({ tty });
        else await terminal.type({ tty, text: m.text });
      } catch (err) {
        console.warn('[buddy] could not do what the phone sent:', err.code || err.name);
      }
    }
  }
```

The existing test "words from the phone are typed ..." checks the warn count only, so the new warn wording is fine.

- [ ] **Step 4: Run the tests**

Run: `node --test test/server-remote.test.js test/claude-share.test.js`
Expected: PASS.

- [ ] **Step 5: Full test and commit**

```bash
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add web/lib/handlers.js web/lib/remote.js src/main/claude/share.js test/server-remote.test.js test/claude-share.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude from anywhere: /stop from the phone presses Esc in the session's terminal"
```

---

### Task 3: Phone logic: the panel's `claude-cli.js`, tokens, workers and slash commands (`claude-core.js`)

**Files:**
- Modify: `tools/sync-web-app.js` (plan entry), then run `npm run sync:web-app` (creates `web/public/app/shared/claude-cli.js`)
- Modify: `web/public/app/claude-core.js`
- Test: `test/web-app-sync.test.js`, `test/web-app-claude.test.mjs`

**Interfaces:**
- `readLook(j)`: `feed` is `{ session, items, stats, workers }` (`stats` null when none, `workers` [] when none).
- `createClaude({ look, send, interrupt, stop, ... })`: new dep `interrupt(sessionId)`.
- State gains `stats`, `workers`, `notes: [{ id, text, picker }]`.
- `send(words)`: slash commands handled (see spec table); answers `{ ok: true }` or `{ ok: false, error }` as today.
- `screen(state, now) -> { rows, workers, working, waiting, line, ticking }`.
- New exports: `PICK`, `MODEL_SET(name)`, `NO_SUCH_MODEL(name)`, `STOPPING`, `CLEARED`, `screen`.

- [ ] **Step 1: Write the failing tests**

`test/web-app-sync.test.js`, in "the Node modules made into ES modules answer as they do in Node", add:

```js
  const { default: ClaudeCli } = await import(url('claude-cli.js'));
  const node = require('../src/renderer/panel/claude-cli');
  assert.strictEqual(ClaudeCli.tokenCount(12_300), node.tokenCount(12_300));
  assert.deepStrictEqual(ClaudeCli.rows([{ id: 1, kind: 'tool', text: '$ npm test' }]), node.rows([{ id: 1, kind: 'tool', text: '$ npm test' }]));
```

(rename the inner `node` if it clashes with a name already in that test.)

`test/web-app-claude.test.mjs`: import the new exports
(`screen, PICK, MODEL_SET, NO_SUCH_MODEL, STOPPING, CLEARED`), give `setup` an `interrupt` fake that records into a new
`interrupted` array and returns it from `setup` (`interrupt: async (session) => { interrupted.push(session); }`), make
the fake `send` also throw for `/model haiku` (`if (text === 'fail' || text === '/model haiku') throw new ApiError(...)`), update
the exact expectation in "a look is read the way the Android app reads it" to
`feed: { session: S1, items: [...], stats: null, workers: [] }`, and add:

```js
const W = { id: 'toolu_01', task: 'Fix the login bug', status: 'running', startedAt: 1_000, endedAt: null, tokens: 12_300 };
const STATS = { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 };

test("a look reads the session's tokens and workers, leaving out what is odd", () => {
  const r = readLook({ online: true, sessions: [S1], feed: { ...S1, items: [], stats: { ...STATS, extra: 1 }, workers: [W, { id: 7 }, { ...W, id: 'x', status: 'dancing' }, W] } });
  assert.deepStrictEqual(r.feed.stats, STATS);
  assert.deepStrictEqual(r.feed.workers, [W]);
  assert.deepStrictEqual(readLook({ online: true, sessions: [S1], feed: { ...S1, items: [], stats: 'x', workers: 'y' } }).feed, { session: S1, items: [], stats: null, workers: [] });
});

/** Claude mode on S1, its feed `feed` (readLook's shape) come in. */
async function opened(feed = { session: S1, items: ITEMS, stats: STATS, workers: [W] }) {
  const s = setup([online([S1]), online([S1]), online([S1], feed), online([S1], feed), online([S1])]);
  s.claude.enter();
  await settle();
  s.claude.open(S1.id);
  await settle();
  await s.tick();
  return s;
}

test('/help, /cost, /model and an unknown command are answered on the phone; nothing goes to the computer', async () => {
  const s = await opened();
  assert.deepStrictEqual(s.claude.state.stats, STATS);
  for (const words of ['/help', '/cost', '/model', '/dance', '/model gpt']) assert.deepStrictEqual(await s.claude.send(words), { ok: true });
  assert.deepStrictEqual(s.sent, []);
  const notes = s.claude.state.notes;
  assert.match(notes[0].text, /^\/model · pick the model/);
  assert.match(notes[1].text, /^Tokens so far: 1\.2M in · 34k out\nModel: Opus 5\.5\nWorkers: 1 · 12\.3k tokens/);
  assert.deepStrictEqual([notes[2].text, notes[2].picker], [PICK, true]);
  assert.strictEqual(notes[3].text, "/dance isn't a command here. Try /help.");
  assert.strictEqual(notes[4].text, NO_SUCH_MODEL('gpt'));
});

test('/model <name> goes as Claude Code\'s own command; /stop asks for Esc; /clear goes and the list shows, saying why', async () => {
  const s = await opened();
  assert.deepStrictEqual(await s.claude.send('/model Sonnet'), { ok: true });
  assert.deepStrictEqual(s.sent, [{ session: S1.id, text: '/model sonnet' }]);
  assert.strictEqual(s.claude.state.notes.at(-1).text, MODEL_SET('Sonnet'));
  assert.deepStrictEqual(await s.claude.send('/stop'), { ok: true });
  assert.deepStrictEqual(s.interrupted, [S1.id]);
  assert.strictEqual(s.claude.state.notes.at(-1).text, STOPPING);
  assert.deepStrictEqual(await s.claude.send('/clear'), { ok: true });
  assert.deepStrictEqual(s.sent.at(-1), { session: S1.id, text: '/clear' });
  await settle();
  assert.deepStrictEqual([s.claude.state.session, s.claude.state.listError, s.claude.state.notes], [null, CLEARED, []]);
});

test('a command that cannot reach the computer gives the words back to the box', async () => {
  const s = await opened();
  assert.deepStrictEqual(await s.claude.send('/model haiku'), { ok: false, error: 'None of your computers is sharing right now.' });
  assert.strictEqual(s.claude.state.boxError, 'None of your computers is sharing right now.');
  assert.strictEqual(s.claude.state.notes.length, 0, 'no "Model set" when it did not go');
});
```

- [ ] **Step 2: Run them to see them fail**

Run: `node --test test/web-app-claude.test.mjs test/web-app-sync.test.js`
Expected: FAIL (no `shared/claude-cli.js`, no `screen`).

- [ ] **Step 3: Implement the sync**

`tools/sync-web-app.js` `plan()`, after the `voice-timing.js` line:

```js
    ['shared/claude-cli.js', { from: 'src/renderer/panel/claude-cli.js', as: 'script', name: 'ClaudeCli' }],
```

and add `the panel's Claude mode words (claude-cli.js)` to the header comment's `shared/` description. Then run:

```bash
npm run sync:web-app
```

- [ ] **Step 4: Implement `claude-core.js`**

Top of the file:

```js
import ClaudeCli from './shared/claude-cli.js';

const { command, helpLines, unknownLine, costLines, rows, workerList, statusLine, workingVerb, MODEL_LABELS } = ClaudeCli;
```

New words (after `GONE`), as the Mac panel's (`panel.js CLAUDE_WORDS`, `mode.js NO_SUCH_MODEL`):

```js
export const PICK = 'Pick a model. It works from your next message.';
export const MODEL_SET = (name) => `Model set to ${name}. It works from your next message.`;
export const NO_SUCH_MODEL = (name) => `There is no model called ${name}. Try opus, sonnet or haiku.`;
export const STOPPING = 'Asked your computer to press Esc in that terminal. That works when it runs in iTerm2.';
export const CLEARED = 'Started a new conversation there. Tap Look again in a few seconds to open it.';
const MODEL_IDS = Object.keys(MODEL_LABELS); // Claude Code's aliases: fable, opus, sonnet, haiku
const WORKER_STATUS = ['running', 'done', 'failed', 'stopped'];
```

Readers (after `readItem`):

```js
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const msOrNull = (value) => (Number.isFinite(value) ? value : null);

/** The session's tokens and model (the Mac's live.js stats), or null. */
function readStats(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  return { model: text(j.model) || null, input: count(j.input), output: count(j.output) };
}

/** One worker Claude started, or null when it is not one. */
function readWorker(j) {
  if (!j || typeof j.id !== 'string' || !j.id || !WORKER_STATUS.includes(j.status)) return null;
  return { id: j.id, task: text(j.task) || 'A worker', status: j.status, startedAt: msOrNull(j.startedAt), endedAt: msOrNull(j.endedAt), tokens: count(j.tokens) };
}
```

`readLook`, the feed:

```js
  const feed = session ? {
    session,
    items: firstOfEach((Array.isArray(j.feed.items) ? j.feed.items : []).map(readItem).filter(Boolean)),
    stats: readStats(j.feed.stats),
    workers: firstOfEach((Array.isArray(j.feed.workers) ? j.feed.workers : []).map(readWorker).filter(Boolean)),
  } : null;
```

`fresh()` gains:

```js
  stats: null, // the session's tokens and model (its status line)
  workers: [], // the workers Claude started
  notes: [], // answers to slash commands, at the end of the session: [{ id, text, picker }]
```

`createClaude` takes `interrupt` (default `async () => {}`) and keeps `let nextNote = 1;`. In `list()` the `set({...})`
also clears `stats: null, workers: [], notes: []`; in `open()` the `set({...})` also sets `stats: null, workers: [],
notes: []`. In `poll().step`:

```js
      set(feed ? { session: feed.session, items: feed.items, stats: feed.stats ?? null, workers: feed.workers ?? [], problem: null } : { problem: null });
```

Replace `send(words)` with a shared `deliver` plus the commands:

```js
  /** An answer to a slash command, at the end of the session (`picker`: with the models to pick from). */
  function note(words, picker = false) {
    set({ notes: [...state.notes, { id: nextNote++, text: words, picker }] });
    return { ok: true };
  }

  /** `go()` sends something for the session shown: the box waits meanwhile, and hears why when it fails. */
  async function deliver(go) {
    const mine = generation;
    set({ sending: true, boxError: null });
    try {
      await go();
      if (mine === generation) set({ sending: false });
      return { ok: true };
    } catch (err) {
      const error = messageOf(err);
      if (mine === generation) set({ sending: false, boxError: error });
      return { ok: false, error };
    }
  }

  /** A slash command (ClaudeCli.command): answered here, or sent to the session's computer (see the spec's table). */
  async function runCommand(cmd, session) {
    const still = () => state.session?.id === session.id;
    if (!cmd.known) return note(unknownLine(cmd.name));
    if (cmd.name === 'help') return note(helpLines().join('\n'));
    if (cmd.name === 'cost') return note(costLines({ stats: state.stats, workers: state.workers }).join('\n'));
    if (cmd.name === 'model') {
      if (!cmd.arg) return note(PICK, true);
      if (!MODEL_IDS.includes(cmd.arg)) return note(NO_SUCH_MODEL(cmd.arg));
      const r = await deliver(() => send(session.id, `/model ${cmd.arg}`));
      if (r.ok && still()) note(MODEL_SET(MODEL_LABELS[cmd.arg]));
      return r;
    }
    if (cmd.name === 'stop') {
      const r = await deliver(() => interrupt(session.id));
      if (r.ok && still()) note(STOPPING);
      return r;
    }
    // /clear: Claude Code starts a new session (a new id) in that terminal, so this one is left for the list.
    const r = await deliver(() => send(session.id, '/clear'));
    if (r.ok && still()) list(CLEARED);
    return r;
  }
```

and in the returned object:

```js
    /** Words (or a slash command) for the session shown. Answers { ok: true }, or { ok: false, error } (the box gives them back). */
    async send(words) {
      const session = state.session;
      const typed = String(words ?? '').trim();
      if (!session || state.sending || !typed) return { ok: false, error: '' };
      const cmd = command(typed);
      if (cmd) return runCommand(cmd, session);
      return deliver(() => send(session.id, typed));
    },
```

`list` is a function declaration inside `createClaude`, so `runCommand` can call it. Finally the pure `screen`:

```js
/**
 * What the session shows, top to bottom, as the Mac panel draws it (panel.js drawClaude): the terminal's rows, the
 * workers, the working verb (the same for the whole turn), whether Claude waits, the status line, and whether the
 * screen must redraw every second (a worker runs: its time moves).
 */
export function screen(state, now) {
  const items = Array.isArray(state.items) ? state.items : [];
  const workers = Array.isArray(state.workers) ? state.workers : [];
  const asked = [...items].reverse().find((item) => item.kind === 'you');
  const status = state.session?.status;
  return {
    rows: rows(items),
    workers: workerList(workers, now),
    working: status === 'working' ? workingVerb(asked?.id ?? 0) : null,
    waiting: status === 'waiting',
    line: statusLine(state.stats),
    ticking: workers.some((w) => w.status === 'running'),
  };
}
```

Update the file's header comment: it now also reads the status line and workers, and runs the slash commands.

- [ ] **Step 5: Run the tests**

Run: `node --test test/web-app-claude.test.mjs test/web-app-sync.test.js`
Expected: PASS. If the `/cost` regex fails, print `notes[1].text` and match `costLines` exactly (its wording is the
panel's; do not change `claude-cli.js`).

- [ ] **Step 6: Full test and commit**

```bash
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add tools/sync-web-app.js web/public/app/shared/claude-cli.js web/public/app/claude-core.js test/web-app-sync.test.js test/web-app-claude.test.mjs
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "iPhone: Claude mode reads tokens and workers and takes the slash commands"
```

---

### Task 4: Phone page: the terminal look, status line, workers, suggestions, full screen, keyboard

**Files:**
- Modify: `web/public/app/claude.js` (drawing)
- Modify: `web/public/app/index.html` (claude-pane markup)
- Modify: `web/public/app/app.css` (the Claude part, lines ~79-108)
- Modify: `web/public/app/app.js` (keyboard fit)
- No unit tests (DOM); `npm test` (ESLint + the logic tests) and a browser check with a throwaway harness.

**Interfaces:** `startClaudeView({ api, onMic, onFull })` keeps its answer (`show, hidden, away, leave, setVoice,
voiceState, addWords, showError`). Element ids added: `claude-line`, `claude-suggest`.

- [ ] **Step 1: Markup**

`web/public/app/index.html`: the Claude pane wears the terminal look, and gets the status line and the suggestions:

```html
  <section class="pane cli" id="claude-pane" aria-label="Claude Code" hidden>
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
      <ol class="claude-items" id="claude-items" aria-label="The session" aria-live="polite"></ol>
      <p class="cl-line" id="claude-line" aria-live="off" hidden></p>
      <p class="error" id="claude-problem" role="alert" hidden></p>
      <p class="error" id="claude-error" role="alert" hidden></p>
      <ul class="cl-suggest" id="claude-suggest" aria-label="Commands" hidden></ul>
      <form class="box" id="claude-form">
        <button class="icon mic" id="claude-mic" type="button" aria-label="Speak" aria-pressed="false" hidden>🎤</button>
        <textarea id="claude-input" rows="1" enterkeyhint="send" autocapitalize="off" autocorrect="off" spellcheck="false" aria-label="Message Claude"></textarea>
        <button class="icon send" id="claude-send" type="submit" aria-label="Send" disabled>↑</button>
      </form>
    </div>
  </section>
```

- [ ] **Step 2: CSS**

`web/public/app/app.css`: replace everything from `/* Claude Code */` to `.app.full .claude-session { ... }`
(inclusive) with:

```css
/* Claude Code, drawn as the Mac panel's Claude mode draws it: as Claude Code's terminal (src/renderer/panel/panel.css
   .panel.cli), monospace, ● ⎿ ❯ and its greens, reds and oranges. The Mac's black when the phone is dark; a light
   terminal, the same roles, when it is light. claude-cli.js says what each row is. */
:root {
  --cli-bg: #FFFFFF; --cli-fg: #1F1F1F; --cli-dim: #6E6E6E; --cli-bar: #EFEFEF; --cli-line: #DCDCDC;
  --cli-panel: #F6F6F6; --cli-hover: #EBEBEB;
  --cli-green: #2E8540; --cli-red: #C8364F; --cli-orange: #B85A35; --cli-blue: #4651C4;
  --mono: ui-monospace, "SF Mono", SFMono-Regular, Menlo, Consolas, monospace;
}
@media (prefers-color-scheme: dark) {
  :root {
    --cli-bg: #000000; --cli-fg: #F2F2F2; --cli-dim: #8C8C8C; --cli-bar: #2C2C2C; --cli-line: #3A3A3A;
    --cli-panel: #0D0D0D; --cli-hover: #1A1A1A;
    --cli-green: #4EBA65; --cli-red: #FF6B80; --cli-orange: #D77757; --cli-blue: #B1B9F9;
  }
}
.cli { background: var(--cli-bg); color: var(--cli-fg); font: 13px/1.5 var(--mono); }
.cli .muted { color: var(--cli-dim); font-size: 13px; }
.cli .icon { color: var(--cli-fg); }
.cli .btn--ghost { border: 1px solid var(--cli-line); border-radius: 6px; color: var(--cli-fg); font: inherit; }
.cli .error { margin: 0 16px 8px; border-radius: 6px; background: color-mix(in srgb, var(--cli-red) 15%, transparent); color: var(--cli-red); font-size: 13px; }

/* the sessions, by computer */
.claude-pick { display: flex; flex: 1; flex-direction: column; gap: 12px; padding: 12px 16px; overflow-y: auto; }
.claude-pick h2 { margin: 0; font: 700 15px/1.3 var(--mono); }
.claude-pick .btn { align-self: center; }
.settings h2 { margin: 6px 0 0; font: 700 22px/1.1 var(--display); }
.groups { display: grid; gap: 14px; }
.group h3 { margin: 0 0 6px; color: var(--cli-dim); font-size: 12px; font-weight: 600; letter-spacing: .05em; text-transform: uppercase; }
.sessions { display: grid; gap: 8px; margin: 0; padding: 0; list-style: none; }
.sessions button { display: flex; align-items: center; justify-content: space-between; gap: 8px; width: 100%; min-height: 48px; padding: 10px 12px; border: 1px solid var(--cli-line); border-radius: 6px; background: var(--cli-panel); color: var(--cli-fg); font: inherit; text-align: left; }
.sessions button:active { background: var(--cli-hover); }
.sessions .name { min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.sessions .name .under { display: block; color: var(--cli-dim); font-size: 12px; font-weight: 400; }
.status-chip { flex: none; padding: 1px 8px; border-radius: 999px; background: var(--cli-bar); color: var(--cli-dim); font: 12px/1.6 var(--mono); }
.status-chip.working { background: color-mix(in srgb, var(--cli-orange) 20%, transparent); color: var(--cli-orange); }
.status-chip.waiting, .status-chip.failed { background: color-mix(in srgb, var(--cli-red) 18%, transparent); color: var(--cli-red); }
.status-chip.done { background: color-mix(in srgb, var(--cli-green) 18%, transparent); color: var(--cli-green); }

/* one session */
.claude-session { display: flex; flex: 1; flex-direction: column; min-height: 0; }
.claude-bar { display: flex; flex: none; align-items: center; gap: 4px; padding: 0 8px 4px; border-bottom: 1px solid var(--cli-line); }
.claude-bar .grow { flex: 1; min-width: 0; overflow: hidden; font-weight: 600; text-overflow: ellipsis; white-space: nowrap; }
.claude-items { display: flex; flex: 1; flex-direction: column; gap: 12px; margin: 0; padding: 10px 16px 12px; overflow-x: hidden; overflow-y: auto; list-style: none; overscroll-behavior: contain; }
.claude-items > li { flex: none; min-width: 0; }
.claude-items p { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; }
.cl-text { flex: 1; min-width: 0; }
.cl-text p.blank { height: .75em; }
.cl-text code { color: var(--cli-blue); font: inherit; }
.cl-text strong, .cl-heading { font-weight: 700; }
.cl-marker { color: var(--cli-dim); }
/* code and tables: the only places that scroll sideways */
.cl-code, .cl-table { max-width: 100%; margin: 2px 0; overflow-x: auto; font: inherit; white-space: pre; -webkit-overflow-scrolling: touch; }
.cl-code { color: var(--cli-blue); }
.cl-probe { position: absolute; visibility: hidden; white-space: pre; }
.claude-items .cl-you { display: flex; gap: 8px; margin: 0 -16px; padding: 2px 16px; background: var(--cli-bar); }
.cl-prompt { flex: none; color: var(--cli-dim); }
.claude-items .cl-claude { display: flex; gap: 8px; }
.cl-dot { flex: none; width: 1ch; }
.cl-tool .cl-call { overflow-wrap: anywhere; }
.cl-tool .cl-dot { display: inline-block; margin-right: 8px; color: var(--cli-green); }
.cl-tool.error .cl-dot { color: var(--cli-red); }
.cl-out, .claude-items .cl-event { display: flex; gap: 8px; padding-left: 2ch; color: var(--cli-dim); }
.cl-out.error, .claude-items .cl-event.error { color: var(--cli-red); }
.cl-elbow { flex: none; }
/* Ran 3 shell commands: folded, grey; a tap unfolds the tools. ∴ Thinking and many workers: the same. */
.cl-fold { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; margin: 0; padding: 0 0 0 calc(1ch + 8px); border: 0; background: none; color: var(--cli-dim); font: inherit; text-align: left; }
.cl-summary.error .cl-fold { color: var(--cli-red); }
.cl-thinking .cl-fold, .cl-workers .cl-fold { padding-left: 0; }
.cl-mark { flex: none; width: 1ch; }
.cl-thought { margin: 4px 0 0 calc(1ch + 8px); color: var(--cli-dim); font-style: italic; }
.cl-inner { display: flex; flex-direction: column; gap: 8px; margin: 8px 0 0; padding: 0; list-style: none; }
.claude-items .cl-working { display: flex; gap: 8px; color: var(--cli-orange); }
.cl-spin { flex: none; width: 1ch; }
.cl-spin::before { content: "✻"; animation: cli-spin 1.2s steps(1, end) infinite; }
@keyframes cli-spin {
  0% { content: "·"; } 16% { content: "✢"; } 33% { content: "✳"; } 50% { content: "✶"; } 66% { content: "✻"; } 83% { content: "✽"; }
}
.claude-items .cl-waiting { color: var(--cli-orange); }
.claude-items .cl-note { color: var(--cli-dim); }
.claude-items .cl-worker { display: flex; gap: 8px; padding-left: 2ch; color: var(--cli-dim); }
.cl-worker.running .cl-dot { color: var(--cli-orange); }
.cl-worker.done .cl-dot { color: var(--cli-green); }
.cl-worker.failed .cl-dot, .cl-worker.stopped .cl-dot { color: var(--cli-red); }
.cl-said { flex: 1; min-width: 0; }
.cl-picks { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 8px; }
.cl-pick { min-height: 40px; padding: 4px 16px; border: 1px solid var(--cli-line); border-radius: 6px; background: var(--cli-panel); color: var(--cli-fg); font: inherit; }
.cl-pick:active { background: var(--cli-hover); }
/* the status line: Opus 5.5 · 1.2M in · 34k out */
.cl-line { flex: none; margin: 0; padding: 4px 16px; overflow: hidden; border-top: 1px solid var(--cli-line); color: var(--cli-dim); text-overflow: ellipsis; white-space: nowrap; }
/* typing "/": the commands it could be */
.cl-suggest { flex: none; margin: 0 16px 6px; padding: 4px 0; border: 1px solid var(--cli-line); border-radius: 6px; background: var(--cli-panel); list-style: none; }
.cl-suggestion { display: block; width: 100%; min-height: 40px; padding: 8px 12px; border: 0; background: none; color: var(--cli-dim); font: inherit; text-align: left; }
.cl-suggestion strong { color: var(--cli-fg); font-weight: 400; }
.cl-suggestion:active { background: var(--cli-hover); }
/* the box: ❯ between two lines, as the terminal's prompt; 16px so iOS does not zoom in */
.cli .box { align-items: center; margin: 0; padding: 2px 8px 2px 16px; border-top: 1px solid var(--cli-line); border-bottom: 1px solid var(--cli-line); border-radius: 0; background: transparent; box-shadow: none; }
.cli .box::before { content: "❯"; flex: none; color: var(--cli-fg); }
.cli .box textarea { color: var(--cli-fg); font: 16px/1.4 var(--mono); }
.cli .box textarea::placeholder { color: var(--cli-dim); }
.cli .send { background: var(--cli-fg); color: var(--cli-bg); }
/* full screen (a session opens so): the head and the tabs make room, and the box keeps clear of the home bar */
.app.full { background: var(--cli-bg); }
.app.full .stage, .app.full .tabs { display: none; }
.app.full .claude-session { padding-bottom: var(--bottom); }
/* the keyboard is up: the tabs make room, and the box sits on the keys */
.app.keys .tabs { display: none; }
.app.keys .claude-session { padding-bottom: 0; }
```

Note the `.claude-pick h2, .settings h2` rule is split: Settings keeps its display font.

- [ ] **Step 3: Drawing (`claude.js`)**

Rewrite `web/public/app/claude.js` keeping its answer and its existing parts (`setLine`, `setFull`, `drawList`,
`updateSend`, `sendTyped`, the listeners, the returned object). Imports and new state:

```js
import ClaudeCli from './shared/claude-cli.js';
import { createClaude, readLook, byDevice, screen, STATUS, OFFLINE, NONE, NO_TALK } from './claude-core.js';
import { TIMEOUTS } from './api.js';
import { $, make, button, grow } from './dom.js';

const { inline, blocks, tableLines, suggestions, MODEL_PICKS, MODEL_LABELS } = ClaudeCli;
const PLACEHOLDERS = { listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };
const TICK_MS = 1000; // a worker runs: its time moves
```

`createClaude` gets `interrupt: (session) => remote({ action: 'interrupt', session })`. Inside `startClaudeView`, beside
`full`, `shownId`, `newest`:

```js
  let notesShown = 0; // the command answers drawn last: a new one scrolls down
  const unfolded = new Set(); // the folded rows opened, as `${type}:${id}`
  let tick = null;
```

The terminal's rows, ported from `src/renderer/panel/panel.js` (`cliSpans` … `cliNote`), drawing into `make()`
elements only (never `innerHTML`):

```js
  /** A line's words with Claude's **bold** and `code` (ClaudeCli.inline), into `p`. */
  function spans(p, line) {
    for (const part of inline(line)) {
      p.append(part.bold ? make('strong', '', part.s) : part.code ? make('code', '', part.s) : document.createTextNode(part.s));
    }
    return p;
  }

  /** How many characters of the session's font fit across where a reply's words go (for a table's width). */
  function columns() {
    const probe = make('span', 'cl-probe', '0000000000');
    list.append(probe);
    const char = probe.getBoundingClientRect().width / 10 || 8;
    probe.remove();
    const room = list.clientWidth - 32 - char * 2 - 8; // the list's 16px gutters, and the ● column beside a reply
    return Math.max(20, Math.floor(room / char));
  }

  /** Claude's markdown as the terminal shows it (ClaudeCli.blocks): lines, headings, lists, code, box-drawn tables. */
  function words(text, className = '') {
    const body = make('div', `cl-text ${className}`.trim());
    for (const block of blocks(text)) {
      if (block.type === 'heading') body.append(make('p', 'cl-heading', block.text));
      else if (block.type === 'bullet') {
        const p = make('p', 'cl-bullet');
        p.style.paddingLeft = `${block.depth * 2}ch`;
        p.append(make('span', 'cl-marker', `${block.marker} `));
        body.append(spans(p, block.text));
      } else if (block.type === 'code') body.append(make('pre', 'cl-code', block.lines.join('\n')));
      else if (block.type === 'table') body.append(make('pre', 'cl-table', tableLines(block.header, block.rows, columns()).join('\n')));
      else if (block.type === 'blank') body.append(make('p', 'blank'));
      else body.append(spans(make('p'), block.text));
    }
    return body;
  }

  /** A row that unfolds when tapped (folded tools, thinking, many workers): its head, and what shows when open. */
  function foldable(li, key, head, body) {
    const open = unfolded.has(key);
    const b = button('cl-fold', '', () => {
      if (unfolded.has(key)) unfolded.delete(key);
      else unfolded.add(key);
      draw();
    });
    b.setAttribute('aria-expanded', String(open));
    b.append(...head);
    li.append(b);
    if (open) li.append(body());
  }

  /** A tool as the terminal shows it: ● Update(src/main.js), and under it ⎿ what it gave back. */
  function tool(row) {
    const li = make('li', `cl-tool${row.error ? ' error' : ''}`);
    const head = make('p', 'cl-call');
    head.append(make('span', 'cl-dot', '●'), make('strong', '', row.name));
    if (row.arg) head.append(document.createTextNode(`(${row.arg})`));
    li.append(head);
    for (const result of row.results) {
      const out = make('div', `cl-out${result.error ? ' error' : ''}`);
      out.append(make('span', 'cl-elbow', '⎿'), words(result.text));
      li.append(out);
    }
    return li;
  }

  /** One row of the session (ClaudeCli.rows says which). */
  function row(r) {
    if (r.type === 'you' || r.type === 'claude') {
      const li = make('li', `cl-${r.type}`);
      li.append(make('span', r.type === 'you' ? 'cl-prompt' : 'cl-dot', r.type === 'you' ? '❯' : '●'), words(r.text));
      return li;
    }
    if (r.type === 'thinking') {
      const li = make('li', 'cl-thinking');
      foldable(li, `thinking:${r.id}`, [make('span', 'cl-mark', '∴'), make('em', '', 'Thinking…')], () => words(r.text, 'cl-thought'));
      return li;
    }
    if (r.type === 'tool') return tool(r);
    if (r.type === 'summary') {
      const li = make('li', `cl-summary${r.error ? ' error' : ''}`);
      foldable(li, `summary:${r.id}`, [document.createTextNode(r.text)], () => {
        const inner = make('ol', 'cl-inner');
        inner.append(...r.tools.map(tool));
        return inner;
      });
      return li;
    }
    const li = make('li', `cl-event${r.error ? ' error' : ''}`);
    li.append(make('span', 'cl-elbow', '⎿'), make('p', '', r.text));
    return li;
  }

  /** The workers (ClaudeCli.workerList): a line each, or one line that unfolds when there are many. */
  function workerRows(view) {
    const line = (w) => {
      const li = make('li', `cl-worker ${w.status}`);
      li.append(make('span', 'cl-dot', w.status === 'running' ? '◌' : w.status === 'done' ? '●' : '✗'), make('p', '', w.text));
      return li;
    };
    if (!view.compact) return view.lines.map(line);
    const li = make('li', 'cl-workers');
    foldable(li, 'workers:0', [make('span', 'cl-mark', '⏺'), document.createTextNode(view.summary)], () => {
      const inner = make('ol', 'cl-inner');
      inner.append(...view.lines.map(line));
      return inner;
    });
    return [li];
  }

  /** An answer to a slash command; /model alone has the three models to tap. */
  function noteRow(n) {
    const li = make('li', 'cl-event');
    const said = make('div', 'cl-said');
    said.append(make('p', '', n.text));
    if (n.picker) {
      const picks = make('div', 'cl-picks');
      picks.append(...MODEL_PICKS.map((alias) => button('cl-pick', MODEL_LABELS[alias], () => core.send(`/model ${alias}`))));
      said.append(picks);
    }
    li.append(make('span', 'cl-elbow', '⎿'), said);
    return li;
  }

  /** While a worker runs, the session is drawn again every second (only while it is shown). */
  function keepTicking(on) {
    if (on && !tick) tick = setInterval(draw, TICK_MS);
    else if (!on && tick) {
      clearInterval(tick);
      tick = null;
    }
  }

  /** While the box holds "/" and part of a name: the commands it could be, above the box. A tap fills one in. */
  function showSuggest() {
    const found = core.state.session ? suggestions(input.value) : [];
    $('claude-suggest').replaceChildren(...found.map((c) => {
      const b = button('cl-suggestion', '', () => {
        input.value = `/${c.name}`;
        grow(input);
        showSuggest();
        updateSend();
        input.focus();
      });
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // the box keeps the focus, and the keyboard stays up
      b.append(make('strong', '', `/${c.name}`), document.createTextNode(`  ${c.hint}`));
      const li = make('li');
      li.append(b);
      return li;
    }));
    $('claude-suggest').hidden = found.length === 0;
  }
```

`drawSession(s)` becomes:

```js
  function drawSession(s) {
    const { session } = s;
    const named = session.title || session.name;
    $('claude-name').textContent = session.device ? `${named} · on ${session.device}` : named;
    $('claude-name').title = session.title ? `${session.title} (${session.name})` : session.name;
    $('claude-status').className = `status-chip ${session.status}`;
    $('claude-status').textContent = STATUS[session.status] || session.status;
    const opened = shownId !== session.id;
    if (opened) {
      voiceError = null; // another session: the old voice error and the open folds do not follow
      unfolded.clear();
      if (!full) setFull(true); // a session gets the whole phone; ⤡ brings the head back
    }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const view = screen(s, Date.now());
    const rows = view.rows.map(row);
    rows.push(...workerRows(view.workers));
    if (view.working) {
      const li = make('li', 'cl-working');
      li.append(make('span', 'cl-spin'), make('span', '', view.working));
      rows.push(li);
    }
    if (view.waiting) rows.push(make('li', 'cl-waiting', '⏵ Claude is waiting for you in the terminal'));
    if (s.items === null) rows.push(make('li', 'cl-note', `Waiting for ${session.device || 'your computer'}…`));
    if (!session.canTalk) rows.push(make('li', 'cl-note', NO_TALK));
    rows.push(...s.notes.map(noteRow));
    list.replaceChildren(...rows);
    const items = s.items || [];
    const last = items.length ? items[items.length - 1].id : 0;
    if (opened || s.notes.length > notesShown || (atBottom && last !== newest)) list.scrollTop = list.scrollHeight;
    shownId = session.id;
    newest = last;
    notesShown = s.notes.length;
    setLine('claude-line', view.line);
    setLine('claude-problem', s.problem);
    setLine('claude-error', s.boxError || voiceError);
    if (voice === 'idle') input.placeholder = `Message Claude in ${named}…  (/ for commands)`;
    keepTicking(view.ticking);
  }
```

In `draw()`, the list branch also calls `keepTicking(false)` and `showSuggest()` runs at the end (the session may have
gone). `sendTyped()` calls `showSuggest()` after clearing the box; the `input` listener calls `showSuggest()` too.
`away()`, `hidden()` and `leave()` call `keepTicking(false)`; `show()` needs nothing more (the next look redraws). Update
the file's header comment to say it draws as the Mac panel's Claude mode does, through `shared/claude-cli.js`.

- [ ] **Step 4: Keyboard fit (`app.js`)**

After `const claudeView = startClaudeView(...)`:

```js
// The keyboard: iOS leaves 100dvh under it, so the app is fitted to what shows, and the box sits on the keys.
const viewport = window.visualViewport;
if (viewport) {
  const fit = () => {
    app.style.height = `${Math.round(viewport.height)}px`;
    app.classList.toggle('keys', window.innerHeight - viewport.height > 120);
    if (window.scrollY) window.scrollTo(0, 0);
  };
  viewport.addEventListener('resize', fit);
  fit();
}
```

- [ ] **Step 5: Lint and tests**

```bash
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
```

Expected: PASS (ESLint covers `claude.js`, `app.js`).

- [ ] **Step 6: Look at it in a phone-sized browser (throwaway harness, not committed)**

Create `web/public/app/dev-claude.html` (delete it after; never commit it): copy `index.html`'s `<head>` (fonts,
`app.css`) and the `<div class="app" id="app">` with only the `claude-pane` section (unhidden), then:

```html
<script type="module">
import { startClaudeView } from '/app/claude.js';
const S = { id: 'aaaa-1111', name: 'buddy', title: 'Fix the login bug', status: 'working', canTalk: true, device: 'MacBook Air' };
const items = [
  { id: 1, kind: 'you', text: 'fix the login bug and run the tests' },
  { id: 2, kind: 'tool', text: '$ npm test' }, { id: 3, kind: 'result', text: '12 passing' },
  { id: 4, kind: 'tool', text: 'Read src/main.js' }, { id: 5, kind: 'tool', text: 'Edit src/main.js' }, { id: 6, kind: 'result', text: 'Updated 3 lines' },
  { id: 7, kind: 'claude', text: '**Done.** Changed `login()`:\n\n| File | Change |\n|---|---|\n| src/main.js | the token is checked before the call, not after |\n\n```js\nconst ok = await check(token); // a long line that must scroll sideways inside the code block only\n```' },
];
const look = { online: true, sessions: [S], feed: { ...S, items, stats: { model: 'claude-opus-5-5', input: 1_234_567, output: 34_000 },
  workers: [{ id: 'w1', task: 'Fix the login bug', status: 'running', startedAt: Date.now() - 72_000, endedAt: null, tokens: 12_300 }] } };
const api = { get: async () => look, post: async (_, body) => { console.log('POST', body); return { sent: true }; } };
startClaudeView({ api, onMic() {}, onFull: (on) => document.getElementById('app').classList.toggle('full', on) }).show();
</script>
```

Serve and open it phone-sized:

```bash
cd /Users/akshat/projects/buddy-iphone-claude/web/public && python3 -m http.server 8765
```

Open `http://localhost:8765/app/dev-claude.html` with the chrome-devtools MCP (`emulate` an iPhone 15, 393×852, both
`prefers-color-scheme: dark` and `light`), tap the session, and check: rows as on the Mac (❯ bar, ● reply, "Ran 1 shell
command, read 1 file" folded, ● Update(src/main.js) with ⎿), the box-drawn table fits, only the code block scrolls
sideways (`document.documentElement.scrollWidth === innerWidth`), the worker line's time moves each second, the status
line reads `Opus 5.5 · 1.2M in · 34k out`, typing `/` shows the five commands, `/help`, `/cost` and `/model` (three
buttons) answer, `/stop` logs `POST { action: 'interrupt', … }`. Take a screenshot of each theme. Then stop the server
and `rm web/public/app/dev-claude.html`.

- [ ] **Step 7: Commit**

```bash
git status --short   # dev-claude.html must not be listed
git add web/public/app/claude.js web/public/app/index.html web/public/app/app.css web/public/app/app.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "iPhone: the Claude screen looks and works like Claude mode on the Mac"
```

---

## After the tasks

- Owner checks on the iPhone after merge (the server and `/app` deploy on merge): a real session from the Mac, in light
  and dark, keyboard up, `/model sonnet`, `/stop` in iTerm2, `/clear`.
- Follow-ups (spec): Android draws stats/workers and sends `interrupt`; the Mac panel's remote `/stop` uses
  `interrupt`.
