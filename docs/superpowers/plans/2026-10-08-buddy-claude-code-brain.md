# Claude Code is the brain (piece 1) Implementation Plan

> **For agentic workers:** seven tasks, in order, on the branch `claude-code` in the worktree
> `/Users/akshat/projects/buddy-claude`, on top of the base commit (Settings → Claude Code, `src/main/claude/find.js`,
> `src/main/ipc/claude.js`). Each task is test first, then the code, then one commit. The contracts below are fixed: do not
> change a name, a shape or a channel. If a contract is wrong, stop and report it instead of working around it.

**Goal:** A person with Claude Code installed and signed in (Pro or Max) picks **Claude Code on this computer** in
Settings → AI, and every chat answer comes from one `claude -p` run on their own computer: no API key, no free-mode
limit. Spec: `docs/superpowers/specs/2026-10-08-buddy-claude-code-brain-design.md` (§3–§6). §2 (finding Claude Code,
the status line, the Settings section) is the base and is not planned here.

**Architecture:** `src/main/claude/run.js` starts one `claude` process a request (safe mode, no tools, the user text on
stdin, one JSON object on stdout) and answers `{ text, model, usage }` exactly as a provider's `complete()` does, so
`src/main/ai.js` treats Claude Code as a third route that counts as "an own key" in every free-mode rule.
`src/main/ipc/settings.js` lists it as a fifth provider (`needsKey: false`) and refuses keys for it; the AI form shows
the status line in place of the key box. The three Settings-fixable error codes join `AI_ERRORS` in `actions.js`.

**Tech Stack:** Electron 44, CommonJS, vanilla JS pages, `node --test`, ESLint; Claude Code 2.1.289 on the owner's Mac.

## Global Constraints

- Plain, friendly words in everything the person sees; match the comment density and style of the file you touch.
- Every Settings/panel IPC answer is `{ ok, ... }` through `guarded` (`src/main/ipc/result.js`); errors are
  `BuddyError(code, message)` (`shared/errors.js`).
- Nothing in `shared/` changes in this piece (Claude Code is not in `shared/providers`, by the spec §3). If you do
  change something there, run `npm run sync:web`.
- `npm test` (ESLint + unit tests) must pass in the worktree before every commit.
- Only today's moods: `thinking`, `happy`, `sleepy`, `idle`, `wave`. Never edit `src/renderer/buddy/*`,
  `src/main/buddy-window.js`, `src/main/geometry.js`, `src/main/sleep.js`, `src/main/feelings.js`,
  `src/main/ipc/buddy.js`, `src/preload/buddy.js`, `art/*`, `assets/*`, `src/main/notch-*`, `src/main/home.js`,
  `src/renderer/notch/*`, `src/main/panel-window.js`, `src/main/store.js` (its `provider` default stays `'anthropic'`
  and the store takes any provider string; no new key is needed), `test/e2e/smoke.js` (the new check needs no harness
  line: it puts the fake command on PATH itself).
- In `src/main/main.js` and `src/main/actions.js`: add new lines only, never move or delete. The one exception the
  brief allows is `main.js` line 90, `createAi(...)`, which gains two arguments (Task 2).
- `src/main/actions.js` is held by another session (buddy-72): Task 5 adds one line and changes nothing else, and the
  commit message says so.
- Commits: plain messages, no Co-Authored-By line and no AI-author credit anywhere (commits or files).
- Never print or commit secrets.

## Base prerequisites (the lead's; check before Task 4)

- `src/main/ipc/claude.js` registers `claude:status { force } → { status, line }` and `claude:get` (opens
  `GET_URL`); `src/preload/settings.js` has `claudeStatus(force)` and `claudeGet()`. Task 4's form uses both.
- **The AI form also runs in the Welcome window** (`src/renderer/onboarding/onboarding.js` line 167 mounts it, with the
  same preload), but `main.js` line 276 allows the `claude:*` channels for the Settings window only:
  `allowed: (webContents) => windows.owns(webContents, 'settings')`. Check again and Get Claude Code in the Welcome's
  AI step would answer "Not allowed.". The lead changes that base line to
  `allowed: (webContents) => windows.owns(webContents, 'settings') || windows.owns(webContents, 'onboarding')`
  before Task 4 is executed (it is the base's line, not this plan's). Task 4's worker: `grep -n "registerClaudeIpc"
  src/main/main.js`; if the line still names only `'settings'`, report it and go on (the Settings window works either way).

## Contracts

### C1. The runner (Task 1 makes it; Task 2 calls it)

`src/main/claude/run.js`:

```js
createRun({ find, dataDir, spawnImpl = spawn, env = process.env, fsImpl = fs, timeoutMs = 60_000,
            newName = () => crypto.randomBytes(8).toString('hex') })
  → { runPrompt }
runPrompt({ system, user, image = null, model, signal })
  → Promise<{ text, model, usage: { inputTokens, outputTokens } }>   // the shape a provider's complete() gives
claudeError(code) → BuddyError(code, WORDS[code])                    // exported; the words of spec §5
```

- `find` is `createFind()`'s object (`find.find()` gives the path or null). `dataDir` is `app.getPath('userData')`.
- The command (spec §4): `<path> -p --output-format json --safe-mode --tools "" --strict-mcp-config
  --no-session-persistence --permission-prompts none --model <alias> --system-prompt <system>`, `user` on stdin,
  `cwd: dataDir`, `env: { ...env, BUDDY_CLAUDE_CODE: '1' }`, `windowsHide: true`.
- With `image` (base64 JPEG): the file `<dataDir>/claude-tmp/<newName()>.jpg` (folder mode 0700, file mode 0600),
  `--tools Read` instead of `--tools ""`, `--add-dir <dataDir>/claude-tmp` appended, and the stdin text is
  `` `${user}\n\nThe screenshot is the image file at ${file}. Read it first.` ``. The file is removed in `finally`;
  the folder is removed (`rmSync` recursive, force) once, when `createRun` is called (at launch).
- Errors (codes and words, spec §5): `no_claude` (`find.find()` is null), `claude_signed_out` (the run's result or
  stderr matches `AUTH_WORDS`), `claude_limit` (matches `LIMIT_WORDS`, checked first), `claude_failed` (non-zero exit,
  `is_error: true`, no JSON, an empty `result`, or the process could not start), `timeout` (own timer `timeoutMs`, or
  the `signal`'s reason is a `TimeoutError`; the process is killed). Any other abort of `signal` kills the process and
  rethrows `signal.reason` untouched (as `shared/providers/http.js` does).

```js
const WORDS = {
  no_claude: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.",
  claude_signed_out: "Claude Code isn't signed in. Open a terminal, run claude, and sign in.",
  claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.',
  claude_failed: "Claude Code couldn't answer. Try again.",
  timeout: 'Claude Code took too long to answer. Try again.',
};
const LIMIT_WORDS = /rate[ _-]?limit|usage limit|limit reached/i;
const AUTH_WORDS = /not logged in|not signed in|not authenticated|authentication|unauthori[sz]ed|invalid api key|\/login/i;
```

### C2. The route (Task 2)

`createAi({ store, secrets, cloud, account, providers, fetchImpl, find = null, dataDir = null,
run = find && createRun({ find, dataDir, timeoutMs: AI_TIMEOUT_MS }) })`. With `find` null, Claude Code counts as not
installed and nothing else changes (every existing test passes untouched).

- `store.get('provider') === 'claude-code'` (`PROVIDER_ID` from `find.js`) picks the route. "Has an own key" means:
  that provider picked **and** `(await find.status()).loggedIn === true` (the cached status, never forced).
- `modelFor('claude-code')` → the saved alias when it is one of `MODELS`, else `DEFAULT_MODEL` (`'sonnet'`).
- `listModels('claude-code')` → `MODELS` (no call).
- `askOwn` with Claude Code picked: not installed → `claudeError('no_claude')`; not signed in →
  `claudeError('claude_signed_out')`; else `run.runPrompt({ ...prompts.buildPrompt(action, input), model, signal })`,
  with `check` and `chat` answers parsed as today. No `no_vision` check: every alias reads images.

### C3. The settings snapshot (Task 3; Task 4 reads it)

`registerSettingsIpc({ ..., find })` gains `find`. `snapshot()` becomes `async` and its `providers` list has a fifth
entry, last:

```js
{ id: 'claude-code', label: 'Claude Code on this computer', keyUrl: GET_URL, fallbackModels: MODELS,
  modelLabels: MODEL_LABELS, hasKey: status.loggedIn === true, needsKey: false, status, line: find.line(status) }
```
The four key providers gain `needsKey: true`. `settings:set` takes `provider: 'claude-code'` and
`models: { 'claude-code': alias }` (alias ∈ `MODELS`, else `bad_request` "Those model choices are not valid.").
`settings:save-key` and `settings:clear-key` for `'claude-code'` → `bad_request` "Claude Code doesn't use a key.".
`settings:models` for `'claude-code'` → `{ models: MODELS }`.

### C4. The form's view (Task 4; the e2e in Task 6 drives the page)

`src/renderer/common/ai-form.js` exports (for Node, like `update-view.js`) `aiChoiceView(p, { models, chosen })`:

```js
{ needsKey: boolean, lineText: string, lineKind: 'good' | 'muted', link: { label, url } | null,
  options: [{ value, label, selected }] }
```
Page ids for the e2e: `#ai-claude-line`, `#ai-claude-get`, `#ai-claude-check`; the fifth label's class `ai-choice wide`.

### C5. Error codes (Task 5)

`AI_ERRORS` in `src/main/actions.js` also holds `'no_claude'`, `'claude_signed_out'`, `'claude_limit'`: the chat shows
**Open Settings** for them and it opens on the AI section. `claude_failed` and `timeout` get Try again only, as today.

---

### Task 1: the runner — `src/main/claude/run.js`

**Files:**
- Create: `src/main/claude/run.js`
- Test: `test/claude-run.test.js` (new)

**Interfaces:**
- Consumes: `ENV_MARK` from `src/main/claude/find.js`; `BuddyError` from `shared/errors.js`; `find.find()`.
- Produces: `createRun(...)` → `{ runPrompt }`, `claudeError(code)`, `WORDS` (C1).

- [ ] **Write the failing test** `test/claude-run.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRun, claudeError, WORDS } = require('../src/main/claude/run');
const { ENV_MARK } = require('../src/main/claude/find');

const DATA = '/Users/someone/Library/Application Support/Buddy';
const TMP = path.join(DATA, 'claude-tmp');
const CLAUDE = '/opt/homebrew/bin/claude';
const found = { find: () => CLAUDE };
const missing = { find: () => null };
const PROMPT = { system: 'You are Buddy.', user: 'boss ko mail', model: 'sonnet' };
/** What claude prints for `result`, as one JSON object; `extra` overrides fields (is_error, subtype). */
const reply = (result, extra = {}) => JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result, session_id: 's1', stop_reason: 'end_turn',
  usage: { input_tokens: 500, output_tokens: 40 }, ...extra,
});
const REPLY_OK = reply('Dear Sir, I need leave tomorrow.');

/**
 * A fake `spawn`: one child per call, which takes the stdin text, then answers with `answer` ({ out, err, code }), or
 * hangs with 'hang'. `calls` gets { file, args, options, input, killed } for each.
 */
function fakeSpawn(answer, calls = []) {
  return (file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { file, args, options, input: '', killed: false };
    calls.push(call);
    child.kill = () => {
      call.killed = true;
      setImmediate(() => child.emit('close', null));
    };
    child.stdin.on('data', (chunk) => { call.input += chunk; });
    child.stdin.on('end', () => {
      if (answer === 'hang') return;
      setImmediate(() => {
        if (answer.out) child.stdout.write(answer.out);
        if (answer.err) child.stderr.write(answer.err);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', answer.code ?? 0);
      });
    });
    return child;
  };
}

/** A fake file system that remembers what was written (path -> { data, mode }) and every call. */
function fakeFs() {
  const files = new Map();
  const log = [];
  return {
    files,
    log,
    rmSync(p, options) {
      log.push(['rm', p, options]);
      for (const name of [...files.keys()]) if (name === p || name.startsWith(`${p}${path.sep}`)) files.delete(name);
    },
    mkdirSync: (p, options) => log.push(['mkdir', p, options]),
    writeFileSync(p, data, options) {
      files.set(p, { data, mode: options?.mode });
      log.push(['write', p]);
    },
  };
}

function setup({ find = found, answer = { out: REPLY_OK }, fs = fakeFs(), timeoutMs = 60_000 } = {}) {
  const calls = [];
  const run = createRun({
    find, dataDir: DATA, spawnImpl: fakeSpawn(answer, calls), env: { PATH: '/usr/bin', HOME: '/Users/someone' }, fsImpl: fs,
    timeoutMs, newName: () => 'abc123',
  });
  return { run, calls, fs };
}

test('the words of each failure, in plain English', () => {
  assert.deepStrictEqual(Object.keys(WORDS), ['no_claude', 'claude_signed_out', 'claude_limit', 'claude_failed', 'timeout']);
  const err = claudeError('claude_limit');
  assert.strictEqual(err.code, 'claude_limit');
  assert.strictEqual(err.message, 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
});

test('runPrompt: the command, its arguments, the environment mark, the data folder as cwd, and the user text on stdin', async () => {
  const { run, calls } = setup();
  const out = await run.runPrompt(PROMPT);
  assert.deepStrictEqual(out, { text: 'Dear Sir, I need leave tomorrow.', model: 'sonnet', usage: { inputTokens: 500, outputTokens: 40 } });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].file, CLAUDE);
  assert.deepStrictEqual(calls[0].args, [
    '-p', '--output-format', 'json', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--permission-prompts', 'none', '--model', 'sonnet', '--system-prompt', 'You are Buddy.',
  ]);
  assert.strictEqual(calls[0].input, 'boss ko mail');
  assert.strictEqual(calls[0].options.cwd, DATA);
  assert.strictEqual(calls[0].options.env[ENV_MARK], '1');
  assert.strictEqual(calls[0].options.env.PATH, '/usr/bin', 'the rest of the environment comes along');
  assert.strictEqual(calls[0].options.windowsHide, true);
});

test('runPrompt: the command not found is no_claude, and nothing is started', async () => {
  const { run, calls } = setup({ find: missing });
  await assert.rejects(run.runPrompt(PROMPT), { code: 'no_claude', message: WORDS.no_claude });
  assert.strictEqual(calls.length, 0);
});

test('runPrompt: is_error, an empty result, no JSON, a non-zero exit and a start that fails are claude_failed', async () => {
  const cases = [
    ['is_error', { out: reply('boom', { is_error: true, subtype: 'error' }) }],
    ['empty result', { out: reply('   ') }],
    ['no JSON', { out: 'Segmentation fault' }],
    ['non-zero exit', { out: REPLY_OK, code: 2 }],
    ['nothing at all', { out: '', code: 1 }],
  ];
  for (const [what, said] of cases) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_failed', message: WORDS.claude_failed }, what);
  }
  const cannotStart = createRun({ find: found, dataDir: DATA, fsImpl: fakeFs(), spawnImpl: () => { throw new Error('ENOENT'); } });
  await assert.rejects(cannotStart.runPrompt(PROMPT), { code: 'claude_failed' });
});

test('runPrompt: the limit words in the result or on stderr are claude_limit, before any other reading', async () => {
  for (const said of [
    { out: reply('Usage limit reached. Try again at 5pm.', { is_error: true }), code: 1 },
    { out: reply("You've hit your rate_limit for this session", { is_error: true }) },
    { out: '', err: 'Error: usage limit reached\n', code: 1 },
    { out: reply('Not logged in, and your usage limit is reached', { is_error: true }), code: 1 },
  ]) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_limit', message: WORDS.claude_limit });
  }
});

test('runPrompt: a run that fails for want of signing in is claude_signed_out', async () => {
  for (const said of [
    { out: reply('Not logged in · Please run /login', { is_error: true }), code: 1 },
    { out: '', err: 'Error: authentication_error: invalid API key\n', code: 1 },
    { out: '', err: 'Unauthorized\n', code: 1 },
  ]) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_signed_out', message: WORDS.claude_signed_out });
  }
});

test('runPrompt: a run that takes too long is killed and is a timeout', async () => {
  const { run, calls } = setup({ answer: 'hang', timeoutMs: 10 });
  await assert.rejects(run.runPrompt(PROMPT), { code: 'timeout', message: WORDS.timeout });
  assert.strictEqual(calls[0].killed, true);
});

test('runPrompt: the signal kills the run: a deadline is a timeout, a cancel is passed through as it is', async () => {
  const timed = setup({ answer: 'hang' });
  await assert.rejects(timed.run.runPrompt({ ...PROMPT, signal: AbortSignal.timeout(10) }), { code: 'timeout' });
  assert.strictEqual(timed.calls[0].killed, true);

  const cancelled = setup({ answer: 'hang' });
  const controller = new AbortController();
  const pending = cancelled.run.runPrompt({ ...PROMPT, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (err) => err.name === 'AbortError');
  assert.strictEqual(cancelled.calls[0].killed, true);

  const already = setup({ answer: 'hang' });
  const done = new AbortController();
  done.abort();
  await assert.rejects(already.run.runPrompt({ ...PROMPT, signal: done.signal }), (err) => err.name === 'AbortError');
  assert.strictEqual(already.calls.length, 0, 'nothing is started for a request already abandoned');
});

test('runPrompt: a screenshot goes as a file of its own (0600), Read is the one tool, and the text says where it is', async () => {
  const fs = fakeFs();
  const { run, calls } = setup({ fs });
  const image = Buffer.from('jpeg bytes').toString('base64');
  await run.runPrompt({ ...PROMPT, image });
  const file = path.join(TMP, 'abc123.jpg');
  const args = calls[0].args;
  assert.deepStrictEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', 'Read']);
  assert.deepStrictEqual(args.slice(-2), ['--add-dir', TMP]);
  assert.strictEqual(calls[0].input, `boss ko mail\n\nThe screenshot is the image file at ${file}. Read it first.`);
  assert.ok(fs.log.some(([op, p, options]) => op === 'mkdir' && p === TMP && options.recursive === true && options.mode === 0o700));
  const written = fs.log.find(([op]) => op === 'write');
  assert.strictEqual(written[1], file);
  assert.ok(fs.log.some(([op, p]) => op === 'rm' && p === file), 'the file is deleted when the run ends');
  assert.strictEqual(fs.files.has(file), false);
});

test('runPrompt: the screenshot file is written with mode 0600 and deleted when the run fails too', async () => {
  const fs = fakeFs();
  let mode = null;
  const seeing = { ...fs, writeFileSync(p, data, options) { mode = options.mode; fs.writeFileSync(p, data, options); } };
  const { run } = setup({ fs: seeing, answer: { out: 'nope', code: 1 } });
  await assert.rejects(run.runPrompt({ ...PROMPT, image: 'aGk=' }), { code: 'claude_failed' });
  assert.strictEqual(mode, 0o600);
  assert.strictEqual(fs.files.size, 0, 'nothing is left behind');
});

test('createRun empties the screenshot folder at launch, and does not mind it not being there', () => {
  const fs = fakeFs();
  fs.files.set(path.join(TMP, 'old.jpg'), { data: 'x' });
  setup({ fs });
  assert.deepStrictEqual(fs.log[0], ['rm', TMP, { recursive: true, force: true }]);
  assert.strictEqual(fs.files.size, 0);
  const failing = { ...fakeFs(), rmSync() { throw new Error('EPERM'); } };
  assert.doesNotThrow(() => setup({ fs: failing }));
});

test('runPrompt: without a screenshot, no file is touched', async () => {
  const fs = fakeFs();
  const { run } = setup({ fs });
  await run.runPrompt(PROMPT);
  assert.deepStrictEqual(fs.log.slice(1), [], 'only the launch sweep touched the file system');
});
```

- [ ] **Run it:** `cd /Users/akshat/projects/buddy-claude && node --test test/claude-run.test.js` — fails with
  `Cannot find module '../src/main/claude/run'`.

- [ ] **Write the implementation** `src/main/claude/run.js`:

```js
'use strict';

/**
 * Runs Claude Code once for one answer: the brain of "Claude Code on this computer" (spec
 * 2026-10-08-buddy-claude-code-brain-design.md, §4). One `claude -p` process a request, in safe mode with no tools
 * (Read alone, for a screenshot), so it answers like a plain model and never runs anything: the user text goes in on
 * stdin and one JSON object comes back on stdout. Buddy's data folder is its working directory, every run is marked
 * BUDDY_CLAUDE_CODE=1 (find.js ENV_MARK, so the watch piece's hooks ignore it), and the process is killed when the
 * request runs out of time or is abandoned.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { BuddyError } = require('../../../shared/errors');
const { ENV_MARK } = require('./find');

const TIMEOUT_MS = 60_000; // ai.js passes its AI_TIMEOUT_MS; this is the same, for a caller that passes none
const TMP_DIR = 'claude-tmp'; // under the data folder: a screenshot waits here, as a file, while Claude Code reads it

// What Buddy says for each way a run can fail (spec §5). The first three are fixed in Settings → AI (actions.js
// AI_ERRORS); the chat offers Try again for the others.
const WORDS = {
  no_claude: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.",
  claude_signed_out: "Claude Code isn't signed in. Open a terminal, run claude, and sign in.",
  claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.',
  claude_failed: "Claude Code couldn't answer. Try again.",
  timeout: 'Claude Code took too long to answer. Try again.',
};
// How a failing run says what went wrong, in its result or on stderr: the plan's usage limit, or not being signed in.
const LIMIT_WORDS = /rate[ _-]?limit|usage limit|limit reached/i;
const AUTH_WORDS = /not logged in|not signed in|not authenticated|authentication|unauthori[sz]ed|invalid api key|\/login/i;

const claudeError = (code) => new BuddyError(code, WORDS[code]);

/** The error a failed run means: its own words say the limit (first) or signing in; anything else is "couldn't answer". */
function errorFor(said) {
  if (LIMIT_WORDS.test(said)) return claudeError('claude_limit');
  if (AUTH_WORDS.test(said)) return claudeError('claude_signed_out');
  return claudeError('claude_failed');
}

/** What an abandoned request means: its deadline passed (a timeout), or it was cancelled (passed through as it is). */
const stopReason = (signal) => (signal.reason?.name === 'TimeoutError' ? claudeError('timeout') : signal.reason);

/**
 * `find` is find.js's finder, `dataDir` Buddy's data folder (app.getPath('userData')). The rest are for the tests:
 * `spawnImpl` in place of spawn, `env` in place of process.env, `fsImpl` in place of fs, `newName` for the screenshot
 * file's name.
 */
function createRun({
  find, dataDir, spawnImpl = spawn, env = process.env, fsImpl = fs, timeoutMs = TIMEOUT_MS,
  newName = () => crypto.randomBytes(8).toString('hex'),
}) {
  const tmpDir = path.join(dataDir, TMP_DIR);
  // Emptied at launch: a screenshot a run left behind (Buddy quit while Claude Code was reading it) is not kept.
  try {
    fsImpl.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // It cannot be removed right now: the next screenshot is written beside what is there, and the next launch tries again.
  }

  /** The screenshot as a file only this user and Claude Code's Read can see: 0600, in a folder of Buddy's own. */
  function writeImage(image) {
    fsImpl.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const file = path.join(tmpDir, `${newName()}.jpg`);
    fsImpl.writeFileSync(file, Buffer.from(image, 'base64'), { mode: 0o600 });
    return file;
  }

  /** Start claude with `user` on its stdin and wait for it: { code, stdout, stderr }, or why it was stopped. */
  function start(file, args, user, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(stopReason(signal));
        return;
      }
      let child;
      try {
        child = spawnImpl(file, args, { cwd: dataDir, env: { ...env, [ENV_MARK]: '1' }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        reject(claudeError('claude_failed'));
        return;
      }
      let stdout = '';
      let stderr = '';
      let done = false;
      const finish = (settle, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        settle(value);
      };
      const stop = (err) => {
        child.kill();
        finish(reject, err);
      };
      const timer = setTimeout(() => stop(claudeError('timeout')), timeoutMs);
      const onAbort = () => stop(stopReason(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', () => finish(reject, claudeError('claude_failed')));
      child.on('close', (code) => finish(resolve, { code, stdout, stderr }));
      child.stdin.on('error', () => {}); // it exited before reading its input: the exit says what happened
      child.stdin.end(user);
    });
  }

  /** The answer in claude's JSON, as a provider gives it, or the error a failing run means. */
  function read({ code, stdout, stderr }, model) {
    let j = null;
    try {
      j = JSON.parse(stdout);
    } catch {
      // No JSON: it failed before answering, and stderr says why, if anything does.
    }
    const result = typeof j?.result === 'string' ? j.result.trim() : '';
    if (j === null || code !== 0 || j.is_error === true || !result) {
      // The exit and the kind of failure go in the log; the words do not (they can hold the person's own text).
      console.warn(`[buddy] claude code exited ${code}${j?.is_error ? ' with an error' : ''}`);
      throw errorFor(`${result}\n${stderr}`);
    }
    return {
      text: result,
      model,
      usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 },
    };
  }

  /**
   * One answer: { text, model, usage } as a provider's complete() gives it. `image` (base64 JPEG) goes along as a file
   * that the user text points at, and is deleted when the run ends, however it ends.
   */
  async function runPrompt({ system, user, image = null, model, signal }) {
    const file = find.find();
    if (!file) throw claudeError('no_claude');
    const args = [
      '-p', '--output-format', 'json', '--safe-mode', '--tools', image ? 'Read' : '', '--strict-mcp-config',
      '--no-session-persistence', '--permission-prompts', 'none', '--model', model, '--system-prompt', system,
    ];
    let text = user;
    let imageFile = null;
    if (image) {
      imageFile = writeImage(image);
      args.push('--add-dir', tmpDir);
      text = `${user}\n\nThe screenshot is the image file at ${imageFile}. Read it first.`;
    }
    try {
      return read(await start(file, args, text, signal), model);
    } finally {
      if (imageFile) fsImpl.rmSync(imageFile, { force: true });
    }
  }

  return { runPrompt };
}

module.exports = { createRun, claudeError, WORDS };
```

- [ ] **Run it:** `node --test test/claude-run.test.js` — all pass (12 tests). Then `npm test` — ESLint clean, all
  green. If the last test's `filter(... || true)` reads oddly to you, replace it with
  `assert.deepStrictEqual(fs.log.slice(1), [])` (the launch sweep is `fs.log[0]`); that is what it checks.

- [ ] **Commit:**
  `git add src/main/claude/run.js test/claude-run.test.js && git commit -m "Claude Code brain: run one claude -p a request (run.js)"`

---

### Task 2: the third route in `src/main/ai.js`

**Files:**
- Modify: `src/main/ai.js` (whole file: lines 1–115 are replaced by the version below; the public shape
  `{ ask, listModels, modelFor }` and the exports `{ createAi, MAX_TOKENS, AI_TIMEOUT_MS }` stay)
- Modify: `src/main/main.js` line 90 only: `const ai = createAi({ store, secrets, cloud, account });` →
  `const ai = createAi({ store, secrets, cloud, account, find, dataDir: userData });`
- Test: `test/ai.test.js` (the `setup` helper gains options; new tests at the end)

**Interfaces:**
- Consumes: C1 (`createRun`, `claudeError`), `PROVIDER_ID`, `MODELS`, `DEFAULT_MODEL` from `find.js`,
  `find.status()` (cached; `{ installed, loggedIn, ... }`).
- Produces: C2.

- [ ] **Write the failing tests.** In `test/ai.test.js`, change `setup` (lines 18–57) so it can pick the provider,
  give Claude Code's status and a fake runner; the old defaults keep every existing test as it is:

```js
function setup({
  key = 'k-1', model, vision = true, answer = 'Fixed text', live = ['m-live'], signedIn = true, free = FREE_OFF, fresh, freshFails,
  freeAsk, signOutDuring = null,
  // The Claude Code route: `picked` 'claude-code' picks it, `claude` is what find.status() says (null: no finder at
  // all, as before this route), `claudeAnswer` what the run answers (or the error it fails with), `alias` the saved model.
  picked = 'openai', claude = null, claudeAnswer = 'Claude answer', alias,
} = {}) {
  const calls = [];
  const cloudCalls = [];
  const runs = [];
  const statusCalls = [];
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
      if (signOutDuring === (options.force ? 'refetch' : 'fetch')) signedIn = false;
      if (options.force && freshFails) throw freshFails;
      return options.force && fresh !== undefined ? fresh : free;
    },
    async ask(action, input, options) {
      cloudCalls.push(['cloudAsk', action, input, options]);
      return freeAsk ? freeAsk() : { text: 'Free answer', model: 'free-model' };
    },
  };
  const models = {};
  if (model) models.openai = model;
  if (alias) models['claude-code'] = alias;
  const settings = { provider: picked, models };
  const find = claude && { status: async (options = {}) => { statusCalls.push(options); return claude; } };
  const run = {
    async runPrompt(opts) {
      runs.push(opts);
      if (claudeAnswer instanceof Error) throw claudeAnswer;
      return { text: claudeAnswer, model: opts.model, usage: { inputTokens: 500, outputTokens: 20 } };
    },
  };
  const ai = createAi({
    store: { get: (k) => settings[k] },
    secrets: { get: (p) => (p === 'openai' ? key : null), has: (p) => p === 'openai' && key !== null },
    providers: { getProvider: () => provider },
    account: { isSignedIn: () => signedIn },
    cloud,
    find,
    run,
  });
  return { ai, calls, cloudCalls, runs, statusCalls };
}
```
Then append:

```js
// ---- Claude Code on this computer (the brain spec §4) ----

const CLAUDE_IN = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max', version: '2.1.289', path: '/opt/homebrew/bin/claude', configDirectory: '/Users/a/.claude' };
const CLAUDE_OUT = { ...CLAUDE_IN, loggedIn: false, email: null, plan: null };
const CLAUDE_NONE = { installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null };
const claudeChat = JSON.stringify({ kind: 'write', say: 'Ye lo!', text: 'Dear Sir,', notes: [], doIt: false, send: false, remember: [], again: false });

test('claude code picked and signed in, free mode off: one run with the prompt, the saved alias and the signal, read like a provider answer', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: claudeChat, alias: 'opus' });
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  const out = await s.ai.ask('chat', { message: 'boss ko mail', appName: 'Mail', step: 1 }, { signal });
  assert.deepStrictEqual([out.text, out.model, out.usage], [claudeChat, 'opus', { inputTokens: 500, outputTokens: 20 }]);
  assert.strictEqual(out.chat.kind, 'write');
  assert.strictEqual(s.runs.length, 1);
  assert.strictEqual(s.runs[0].model, 'opus');
  assert.strictEqual(s.runs[0].signal, signal);
  assert.match(s.runs[0].system, /"kind"/);
  assert.match(s.runs[0].user, /The app they are in: Mail/);
  assert.strictEqual(s.runs[0].image, null);
  assert.strictEqual(s.calls.length, 0, 'no provider, no key');
  assert.ok(s.statusCalls.length >= 1 && s.statusCalls.every((o) => !o.force), 'the cached status, never forced');
  assert.ok(s.statusCalls.every((o) => !o.force));
});

test('claude code: sonnet without a saved alias, and in place of an alias that is not one of its own', async () => {
  for (const [alias, expected] of [[undefined, 'sonnet'], ['haiku', 'haiku'], ['gpt-4.1', 'sonnet'], ['', 'sonnet']]) {
    const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, alias });
    assert.strictEqual(s.ai.modelFor('claude-code'), expected, String(alias));
    await s.ai.ask('write', { instruction: 'leave mail' });
    assert.strictEqual(s.runs[0].model, expected, String(alias));
  }
});

test('claude code: not installed, or not signed in, says so before anything runs', async () => {
  const none = setup({ picked: 'claude-code', claude: CLAUDE_NONE });
  await assert.rejects(none.ai.ask('write', { instruction: 'x' }),
    { code: 'no_claude', message: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings." });
  const out = setup({ picked: 'claude-code', claude: CLAUDE_OUT });
  await assert.rejects(out.ai.ask('write', { instruction: 'x' }),
    { code: 'claude_signed_out', message: "Claude Code isn't signed in. Open a terminal, run claude, and sign in." });
  assert.deepStrictEqual([none.runs, out.runs], [[], []]);
});

test('claude code: a screenshot goes to the run as it is: every alias reads images', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: '{"kind":"answer","say":"It means soon."}' });
  const out = await s.ai.ask('chat', { message: 'what does this mean?', image: 'IMG', step: 2 });
  assert.strictEqual(s.runs[0].image, 'IMG');
  assert.deepStrictEqual([out.chat.kind, out.chat.text], ['answer', 'It means soon.']);
  const check = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: '{"verdict":"good","problems":[],"corrected":null}' });
  assert.deepStrictEqual((await check.ai.ask('check', { image: 'IMG' })).check, { verdict: 'good', problems: [], corrected: null });
});

test("claude code: the run's own failures are passed on as they are", async () => {
  const limit = new BuddyError('claude_limit', 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: limit });
  await assert.rejects(s.ai.ask('write', { instruction: 'x' }), limit);
});

test('claude code: bad input is refused before anything runs', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN });
  await assert.rejects(s.ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  assert.strictEqual(s.runs.length, 0);
});

test('claude code signed in counts as an own key in every free-mode rule', async () => {
  const on = (free) => setup({ picked: 'claude-code', claude: CLAUDE_IN, free });
  // The server never reached: Claude Code answers.
  assert.strictEqual((await setup({ picked: 'claude-code', claude: CLAUDE_IN, free: null }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Free mode off: straight to Claude Code.
  assert.strictEqual((await on(FREE_OFF).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Blocked, own keys allowed.
  assert.strictEqual((await on({ ...FREE_ON, blocked: true, allowOwnKey: true }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Today's requests already used up by the kept settings, own keys allowed: the server is not asked.
  const usedUp = on({ ...FREE_ON, allowOwnKey: true, usedToday: 30 });
  assert.strictEqual((await usedUp.ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  assert.deepStrictEqual(usedUp.cloudCalls, [['settings', {}]]);
  // The server refuses with the limit, own keys allowed: Claude Code takes over after the settings are fetched again.
  const refused = setup({ picked: 'claude-code', claude: CLAUDE_IN, free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  assert.strictEqual((await refused.ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  assert.ok(refused.cloudCalls.some(([name, options]) => name === 'settings' && options.force === true));
  // Free mode turned off meanwhile.
  const off = new BuddyError('free_off', 'Free AI is off.');
  assert.strictEqual((await setup({ picked: 'claude-code', claude: CLAUDE_IN, free: FREE_ON, fresh: FREE_OFF, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // With free requests left, the server answers first and Claude Code is not run.
  const first = on({ ...FREE_ON, allowOwnKey: true });
  assert.strictEqual((await first.ai.ask('fix', { text: 'x' })).text, 'Free answer');
  assert.strictEqual(first.runs.length, 0);
});

test('claude code picked but not signed in is no own key: the free-mode rules say what they say for no key', async () => {
  const out = (free) => setup({ picked: 'claude-code', claude: CLAUDE_OUT, free });
  await assert.rejects(out(null).ai.ask('fix', { text: 'x' }), { code: 'network' });
  await assert.rejects(out({ ...FREE_ON, blocked: true, allowOwnKey: true }).ai.ask('fix', { text: 'x' }), { code: 'blocked' });
  const limited = setup({ picked: 'claude-code', claude: CLAUDE_OUT, free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(limited.ai.ask('fix', { text: 'x' }), { code: 'need_key' });
  // Free mode off: the chat says what to do.
  await assert.rejects(out(FREE_OFF).ai.ask('fix', { text: 'x' }), { code: 'claude_signed_out' });
  // The same for not installed, where the words are "install it".
  await assert.rejects(setup({ picked: 'claude-code', claude: CLAUDE_NONE, free: FREE_OFF }).ai.ask('fix', { text: 'x' }), { code: 'no_claude' });
});

test('claude code: listModels gives its four names without a call, and other AIs are untouched', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN });
  assert.deepStrictEqual(await s.ai.listModels('claude-code'), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepStrictEqual(await s.ai.listModels('openai'), ['m-live']);
});

test('another AI picked: Claude Code is never asked about, and a run never happens', async () => {
  const s = setup({ picked: 'openai', claude: CLAUDE_IN });
  await s.ai.ask('fix', { text: 'x' });
  assert.deepStrictEqual([s.statusCalls, s.runs], [[], []]);
  assert.strictEqual(s.calls.length, 1);
});

test('without a finder (older callers), Claude Code picked is simply not installed', async () => {
  const s = setup({ picked: 'claude-code', claude: null });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), { code: 'no_claude' });
});
```

- [ ] **Run it:** `node --test test/ai.test.js` — the new tests fail (`modelFor` throws `Unknown provider:
  claude-code`, `no_claude` never thrown, `runs` empty); the old ones pass.

- [ ] **Write the implementation.** Replace `src/main/ai.js` with:

```js
'use strict';

/**
 * Answers one panel action, by one of three routes (Phase 2 spec §5, "Routing"; the Claude Code brain spec §4):
 *   free        -- Buddy's server answers with the admin's key (src/main/cloud.js);
 *   own         -- the user's own key, straight to the provider they picked (Phase 1);
 *   claude-code -- Claude Code on this computer, signed in to the person's own plan (src/main/claude/run.js).
 * Which one comes from the server's free-mode settings for this person; Claude Code, when it is picked and signed in,
 * counts as an own key in every rule. Nobody uses any route without signing in.
 */

const { BuddyError } = require('../../shared/errors');
const prompts = require('../../shared/prompts');
const providerRegistry = require('../../shared/providers');
const { PROVIDER_ID: CLAUDE_ID, MODELS: CLAUDE_MODELS, DEFAULT_MODEL: CLAUDE_DEFAULT } = require('./claude/find');
const { createRun, claudeError } = require('./claude/run');

const { MAX_TOKENS } = prompts;
// How long a person waits for the AI (an answer, or a check of their key) before it is given up on.
const AI_TIMEOUT_MS = 60_000;

// What the server says when it will not answer for free; the settings are fetched again after each.
const FREE_REFUSALS = ['free_limit', 'free_off', 'blocked'];

const signedOut = () => new BuddyError('signed_out', 'Sign in to use Buddy.');
// With no finder (older callers, and tests of the other routes), Claude Code is simply not there.
const NO_CLAUDE = Object.freeze({ installed: false, loggedIn: false });

/**
 * `find` is claude/find.js's finder and `dataDir` Buddy's data folder, for the Claude Code route; `run` replaces the
 * runner built from them (tests pass a fake).
 */
function createAi({
  store, secrets, cloud, account, providers = providerRegistry, fetchImpl, find = null, dataDir = null,
  run = find && createRun({ find, dataDir, timeoutMs: AI_TIMEOUT_MS }),
}) {
  const usingClaude = () => store.get('provider') === CLAUDE_ID;
  // Claude Code's status as find.js keeps it: asked again after a minute, never a wait of more than 10 s.
  const claudeStatus = () => (find ? find.status() : Promise.resolve(NO_CLAUDE));

  function modelFor(providerId) {
    if (providerId === CLAUDE_ID) {
      const saved = store.get('models')?.[CLAUDE_ID];
      return CLAUDE_MODELS.includes(saved) ? saved : CLAUDE_DEFAULT;
    }
    const provider = providers.getProvider(providerId);
    return store.get('models')?.[providerId] || provider.fallbackModels[0];
  }

  /** The person's own way to an answer: a key saved for the AI they picked, or Claude Code picked and signed in. */
  async function hasOwn() {
    if (usingClaude()) return (await claudeStatus()).loggedIn === true;
    return secrets.has(store.get('provider'));
  }

  /** A Check's and a chat's answers come back read (prompts.parseCheck, parseChat). */
  function parsed(action, out) {
    if (action === 'check') return { ...out, check: prompts.parseCheck(out.text) };
    if (action === 'chat') return { ...out, chat: prompts.parseChat(out.text) };
    return out;
  }

  /** Claude Code on this computer: one `claude -p` a request (claude/run.js). Every one of its models reads images. */
  async function askClaude(action, input, { signal } = {}) {
    const status = await claudeStatus();
    if (!status.installed) throw claudeError('no_claude');
    if (!status.loggedIn) throw claudeError('claude_signed_out');
    const prompt = prompts.buildPrompt(action, input);
    return parsed(action, await run.runPrompt({ ...prompt, model: modelFor(CLAUDE_ID), signal }));
  }

  /** The user's own key, straight to their provider (Phase 1's route); or Claude Code, when that is what they picked. */
  async function askOwn(action, input, options = {}) {
    if (usingClaude()) return askClaude(action, input, options);
    const { signal } = options;
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
    return parsed(action, out);
  }

  /**
   * The server would not answer for free: carry on with the user's own key (or Claude Code) where the admin allows it.
   * `own` is whether they have one (hasOwn(), decided before the server was asked). When the settings cannot be fetched
   * again, the ones from before the request decide, unless the person has been signed out meanwhile.
   */
  async function afterRefusal(err, before, own, action, input, options) {
    const fresh = await cloud.settings({ force: true }).catch((fetchErr) => {
      if (fetchErr.code === 'signed_out') throw fetchErr;
      return null;
    });
    // Signed out while the settings were being fetched again, which then comes back with none (signing out forgets
    // them): nobody uses either route without signing in, and the settings from before the request must not decide.
    if (!account.isSignedIn()) throw signedOut();
    const now = fresh || before;
    if (err.code === 'free_off') {
      if (!now.freeOn) return askOwn(action, input, options);
      throw err;
    }
    if (now.allowOwnKey && own) return askOwn(action, input, options);
    if (err.code === 'free_limit' && now.allowOwnKey) {
      const limit = now.limit ?? before.limit;
      const used = limit ? `today's ${limit} free requests` : "today's free requests";
      throw new BuddyError('need_key', `You've used ${used}. Add your own key in Settings to keep going, or wait until midnight.`);
    }
    throw err;
  }

  async function ask(action, input, options = {}) {
    if (!account.isSignedIn()) throw signedOut();
    const free = await cloud.settings();
    // Signed out while the settings were being fetched: signing out forgets them, so the fetch comes back with none,
    // which is not "the server was never reached" (nor a reason to use either route).
    if (!account.isSignedIn()) throw signedOut();
    const own = await hasOwn();
    if (!free) {
      // The server has never been reached: the user's own key, when there is one.
      if (own) return askOwn(action, input, options);
      throw new BuddyError('network', "Couldn't reach Buddy's server. Check your internet.");
    }
    if (!free.freeOn) return askOwn(action, input, options);
    if (free.blocked) {
      if (free.allowOwnKey && own) return askOwn(action, input, options);
      throw new BuddyError('blocked', 'Your free access is paused.');
    }
    // Today's free requests are used up and the admin lets this person go on with their own key: the server would only
    // refuse (and the settings be fetched again), so the own key answers at once.
    const usedUp = free.limitMode === 'daily' && free.limit !== null && free.usedToday >= free.limit;
    if (usedUp && free.allowOwnKey && own) return askOwn(action, input, options);
    prompts.buildPrompt(action, input); // input that is not valid is refused here, without a call to the server
    try {
      return await cloud.ask(action, input, options);
    } catch (err) {
      if (!FREE_REFUSALS.includes(err.code)) throw err;
      return afterRefusal(err, free, own, action, input, options);
    }
  }

  /** Models for a provider: the live list for the saved key, else the fallback list. Claude Code's are its own names. */
  async function listModels(providerId, { signal } = {}) {
    if (providerId === CLAUDE_ID) return CLAUDE_MODELS;
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

  Then `src/main/main.js` line 90 becomes
  `const ai = createAi({ store, secrets, cloud, account, find, dataDir: userData });` (nothing else in main.js).

- [ ] **Run it:** `node --test test/ai.test.js` — all pass (the old 29 and the new 11). `npm test` — green.
  Also `node --test test/actions.test.js test/settings-ipc.test.js` still green (they build their own `ai`).

- [ ] **Commit:**
  `git add src/main/ai.js src/main/main.js test/ai.test.js && git commit -m "Claude Code brain: the third route in ai.js, an own key in every free-mode rule"`

---

### Task 3: the provider entry and the refusals in `src/main/ipc/settings.js`

**Files:**
- Modify: `src/main/ipc/settings.js` — the require block (after line 12), `checkModels` (lines 41–47), the
  `registerSettingsIpc` parameters (lines 55–66: add `find`), `snapshot` (lines 94–122: `async`, the fifth entry),
  `settings:set` line 134, `settings:save-key` (a new first line after 158; line 188's spread awaits), `settings:clear-key`
  (a new first line after 193), `settings:models` (a new first line after 199)
- Modify: `src/main/main.js` lines 260–270 — one new line `find, // Claude Code on this computer: the fifth AI choice`
  inside the `registerSettingsIpc({ ... })` call, after `account, cloud, memory, microphone, canSignIn: Boolean(cloudConfig),`
- Test: `test/settings-ipc.test.js`

**Interfaces:**
- Consumes: `find.status()`, `find.line(status)`, `PROVIDER_ID`, `MODELS`, `MODEL_LABELS`, `GET_URL` from `find.js`.
- Produces: C3.

- [ ] **Write the failing tests.** In `test/settings-ipc.test.js`:
  1. Near the top (after line 13) add
     `const { createFind, MODELS: CLAUDE_MODELS, MODEL_LABELS, GET_URL } = require('../src/main/claude/find');`
     and `const { line: claudeLine } = createFind({ env: {}, existsSync: () => false });`.
  2. Give `setup` an option `claude = CLAUDE_OUT` (declare, before `setup`,
     `const CLAUDE_IN = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max', version: '2.1.289', path: '/opt/homebrew/bin/claude', configDirectory: '/Users/a/.claude' };`
     `const CLAUDE_OUT = { ...CLAUDE_IN, loggedIn: false, email: null, plan: null };`
     `const CLAUDE_NONE = { installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null };`),
     add `const claudeCalls = []; // the options of each find.status() call` beside `const calls = [];`, and pass to
     `registerSettingsIpc` a `find` (after `memory,` in the call):
     ```js
     find: { status: async (options = {}) => { claudeCalls.push(options); return claude; }, line: claudeLine },
     ```
     and return `claudeCalls` from `setup` beside `calls`. The status calls get a list of their own because `calls`
     is asserted exactly in some tests (line 213 `assert.deepStrictEqual(s.calls, [])`, line 496
     `[['listModels', ...]]`); nothing existing then changes.
  3. Change the test at line 188 (`settings:get answers the settings ...`): the providers now end with Claude Code, and
     the four key providers carry `needsKey`:
     ```js
     assert.deepStrictEqual(r.providers.map((p) => [p.id, p.hasKey]), [
       ['anthropic', false], ['openai', true], ['gemini', false], ['groq', false], ['claude-code', false],
     ]);
     for (const p of r.providers.slice(0, 4)) assert.deepStrictEqual(Object.keys(p).sort(), ['fallbackModels', 'hasKey', 'id', 'keyUrl', 'label', 'needsKey']);
     assert.ok(r.providers.slice(0, 4).every((p) => p.needsKey === true));
     ```
  4. The test at line 353 (`save-key: a key that belongs to another AI ... switches to it`) lists the providers too
     (lines 369–371): make it
     ```js
     assert.deepStrictEqual(r.providers.map((p) => [p.id, p.hasKey]), [
       ['anthropic', false], ['openai', false], ['gemini', true], ['groq', false], ['claude-code', false],
     ]);
     ```
  5. In `set: a provider must be a real one` (line 604) add at the end:
     `assert.strictEqual((await s.call('settings:set', { provider: 'claude-code' })).settings.provider, 'claude-code');`
  6. In `set: models must be ...` (line 616) add `{ 'claude-code': 'gpt-4.1' }, { 'claude-code': 'Sonnet' }` to `bad`,
     and make `good` `{ anthropic: 'claude-sonnet-5-5', groq: 'llama-3.3-70b-versatile', 'claude-code': 'opus' }`.
  7. Append:

```js
// ---- Claude Code on this computer (the brain spec §3) ----

test('the snapshot lists Claude Code last, with no key to need: signed in counts as a key, and its status line comes along', async () => {
  const signedIn = await setup({ claude: CLAUDE_IN }).call('settings:get');
  const entry = signedIn.providers.at(-1);
  assert.deepStrictEqual(entry, {
    id: 'claude-code',
    label: 'Claude Code on this computer',
    keyUrl: GET_URL,
    fallbackModels: CLAUDE_MODELS,
    modelLabels: MODEL_LABELS,
    hasKey: true,
    needsKey: false,
    status: CLAUDE_IN,
    line: { text: 'Claude Code: signed in as a@b.com (Max)', link: null },
  });
  const out = (await setup({ claude: CLAUDE_OUT }).call('settings:get')).providers.at(-1);
  assert.deepStrictEqual([out.hasKey, out.line.text], [false, 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.']);
  const none = (await setup({ claude: CLAUDE_NONE }).call('settings:get')).providers.at(-1);
  assert.deepStrictEqual([none.hasKey, none.line], [false, { text: "Claude Code isn't installed on this computer.", link: { label: 'Get Claude Code', url: GET_URL } }]);
});

test('the snapshot asks for the cached status, never forced: opening Settings does not run claude twice', async () => {
  const s = setup({ claude: CLAUDE_IN });
  await s.call('settings:get');
  await s.call('settings:set', { size: 'large' });
  assert.deepStrictEqual(s.claudeCalls, [{}, {}]);
});

test('save-key and clear-key for Claude Code are refused: it has no key', async () => {
  const s = setup({ claude: CLAUDE_IN });
  for (const [channel, args] of [['settings:save-key', ['claude-code', 'sk-ant-abc']], ['settings:clear-key', ['claude-code']]]) {
    assert.deepStrictEqual(await s.call(channel, ...args), refused('bad_request', "Claude Code doesn't use a key."), channel);
  }
  assert.deepStrictEqual(s.keys, {});
});

test('settings:models for Claude Code answers its four names without asking the AI', async () => {
  const s = setup({ claude: CLAUDE_IN });
  assert.deepStrictEqual(await s.call('settings:models', 'claude-code'), { ok: true, models: ['fable', 'opus', 'sonnet', 'haiku'] });
  assert.deepStrictEqual(s.calls, []);
});

test('a key saved while Claude Code is picked switches to that key\'s AI, as it does for any other pick', async (t) => {
  t.mock.method(PROVIDERS.gemini, 'listModels', async () => GEMINI_MODELS);
  const s = setup({ claude: CLAUDE_IN, stored: { provider: 'claude-code' } });
  const r = await s.call('settings:save-key', 'anthropic', GEMINI_KEY);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.settings.provider, 'gemini');
  assert.strictEqual(r.providers.at(-1).id, 'claude-code', 'the answer is a whole snapshot');
});
```
  (Check how the existing test at line 353 saves a Gemini key under Claude — `GEMINI_KEY` and `GEMINI_MODELS` are
  already defined at lines 36–37 — and mirror its mocking exactly.)

- [ ] **Run it:** `node --test test/settings-ipc.test.js` — the new tests fail (`registerSettingsIpc` ignores `find`;
  `providers` has four entries; `settings:set { provider: 'claude-code' }` is `bad_request`).

- [ ] **Write the implementation** in `src/main/ipc/settings.js`:

  After line 12 add:
  ```js
  const { PROVIDER_ID: CLAUDE_ID, MODELS: CLAUDE_MODELS, MODEL_LABELS, GET_URL } = require('../claude/find');
  ```
  After line 26 (`CANT_SAVE`) add:
  ```js
  // Claude Code on this computer is the fifth AI choice (the brain spec §3): it has no key, so a key is never saved or
  // cleared for it, and its models are its own four names.
  const NO_KEY_NEEDED = "Claude Code doesn't use a key.";
  ```
  Replace `checkModels` (lines 40–47) with:
  ```js
  /** The { providerId: model name } a page asks to save, copied, if it is well formed. Claude Code's must be one of its aliases. */
  function checkModels(models) {
    const wellFormed = isPlainObject(models) && Object.entries(models).every(([id, model]) => (
      id === CLAUDE_ID
        ? CLAUDE_MODELS.includes(model)
        : PROVIDER_IDS.includes(id) && typeof model === 'string' && model.trim() !== ''
    ));
    if (!wellFormed) throw new BuddyError('bad_request', 'Those model choices are not valid.');
    return { ...models };
  }
  ```
  In the parameters (lines 55–66) add, after `microphone,`:
  ```js
    // Claude Code on this computer (claude/find.js): its status is the fifth AI choice's "key".
    find,
  ```
  Replace `snapshot` (lines 94–122) with:
  ```js
    /** The fifth AI choice: Claude Code on this computer, which has no key; signed in counts as one. */
    function claudeChoice(status) {
      return {
        id: CLAUDE_ID,
        label: 'Claude Code on this computer',
        keyUrl: GET_URL,
        fallbackModels: CLAUDE_MODELS,
        modelLabels: MODEL_LABELS,
        hasKey: status.loggedIn === true,
        needsKey: false,
        status,
        line: find.line(status),
      };
    }

    async function snapshot() {
      const settings = store.all();
      delete settings.positions;
      delete settings.lastDisplayId;
      delete settings.cloud; // the server's free-mode settings: the page gets what they mean, in `ai`
      // What Buddy knows about the person, and its switch: the Memory section asks for them (settings:memory).
      delete settings.memory;
      delete settings.learnFromChats;
      const user = account.user();
      const claude = await find.status(); // kept for a minute (find.js): a page waits on claude once, not on every call
      return {
        settings,
        // 'darwin' or 'win32': the pages leave out what the system does not have (Windows asks for no permissions).
        platform,
        buddyOn: power.isOn(),
        characters: characters.list,
        providers: PROVIDER_IDS.map((id) => ({
          id,
          label: PROVIDERS[id].label,
          keyUrl: PROVIDERS[id].keyUrl,
          fallbackModels: PROVIDERS[id].fallbackModels,
          hasKey: secrets.has(id),
          needsKey: true,
        })).concat(claudeChoice(claude)),
        account: user ? { signedIn: true, email: user.email, name: user.name, photo: user.photo || '' } : { signedIn: false },
        canSignIn,
        version,
        justUpdated,
        ai: aiSection(user ? cloud.last() : null), // free-mode settings apply only to someone signed in
      };
    }
  ```
  Line 134 becomes:
  ```js
      if (Object.hasOwn(changes, 'provider') && changes.provider !== CLAUDE_ID) getProvider(changes.provider);
  ```
  `settings:save-key`: first line of the handler (before `getProvider(providerId);`):
  ```js
      if (providerId === CLAUDE_ID) throw new BuddyError('bad_request', NO_KEY_NEEDED);
  ```
  and line 188 becomes `const answer = { ...(await snapshot()), models, verified: live !== null };`.
  `settings:clear-key`: first line `if (providerId === CLAUDE_ID) throw new BuddyError('bad_request', NO_KEY_NEEDED);`.
  `settings:models`: first line `if (providerId === CLAUDE_ID) return { models: CLAUDE_MODELS };`.
  Every other `return snapshot();` stays as it is: `guarded` awaits the promise.

  Then `src/main/main.js`: inside `registerSettingsIpc({ ... })` (lines 260–270), add the line
  `    find, // Claude Code on this computer: the fifth AI choice, with no key` after the `account, cloud, memory, ...`
  line. New line only.

- [ ] **Run it:** `node --test test/settings-ipc.test.js` — all pass. `npm test` — green.

- [ ] **Commit:**
  `git add src/main/ipc/settings.js src/main/main.js test/settings-ipc.test.js && git commit -m "Claude Code brain: the fifth provider in the settings snapshot, no key to save or clear"`

---

### Task 4: the fifth choice in the AI form

**Files:**
- Modify: `src/renderer/common/ai-form.js` (whole file, 144 lines → the version below)
- Modify: `src/renderer/common/base.css` — one rule after line 371 (`.ai-choice { ... }`):
  `.ai-choice.wide { grid-column: 1 / -1; }`
- Test: `test/ai-form.test.js` (new; `aiChoiceView` is pure)

**Interfaces:**
- Consumes: C3 (the snapshot's `providers`), `window.buddy.claudeStatus(true)`, `window.buddy.claudeGet()`
  (base preload), `window.buddy.set / models / saveKey / openUrl` as today.
- Produces: C4.

- [ ] **Base check:** `grep -n "registerClaudeIpc" src/main/main.js`. If `allowed` names only `'settings'`, note it in
  your report (see "Base prerequisites"); go on.

- [ ] **Write the failing test** `test/ai-form.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { aiChoiceView } = require('../src/renderer/common/ai-form.js');

const KEYED = { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', fallbackModels: ['gpt-4.1', 'gpt-4.1-mini'], hasKey: true, needsKey: true };
const STATUS = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max' };
const CLAUDE = {
  id: 'claude-code', label: 'Claude Code on this computer', keyUrl: 'https://claude.com/claude-code',
  fallbackModels: ['fable', 'opus', 'sonnet', 'haiku'], modelLabels: { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' },
  hasKey: true, needsKey: false, status: STATUS, line: { text: 'Claude Code: signed in as a@b.com (Max)', link: null },
};

test('an AI with a key: the key box, no line, and the models by their own names', () => {
  assert.deepStrictEqual(aiChoiceView(KEYED, { models: ['gpt-4.1', 'o3'], chosen: 'o3' }), {
    needsKey: true,
    lineText: '',
    lineKind: 'muted',
    link: null,
    options: [{ value: 'gpt-4.1', label: 'gpt-4.1', selected: false }, { value: 'o3', label: 'o3', selected: true }],
  });
  // An older snapshot without needsKey is an AI with a key.
  assert.strictEqual(aiChoiceView({ ...KEYED, needsKey: undefined }).needsKey, true);
});

test('Claude Code: the status line in place of the key box, green when signed in, and the models with their names', () => {
  const view = aiChoiceView(CLAUDE, { chosen: 'opus' });
  assert.deepStrictEqual(view, {
    needsKey: false,
    lineText: 'Claude Code: signed in as a@b.com (Max)',
    lineKind: 'good',
    link: null,
    options: [
      { value: 'fable', label: 'Fable', selected: false },
      { value: 'opus', label: 'Opus', selected: true },
      { value: 'sonnet', label: 'Sonnet', selected: false },
      { value: 'haiku', label: 'Haiku', selected: false },
    ],
  });
  // Without a saved alias nothing is selected here: the form's select then shows the first; ai.js uses sonnet.
  assert.ok(aiChoiceView(CLAUDE).options.every((o) => !o.selected));
});

test('Claude Code not signed in, or not installed: the line is quiet, with the Get Claude Code link when it is missing', () => {
  const out = aiChoiceView({ ...CLAUDE, hasKey: false, line: { text: 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.', link: null } });
  assert.deepStrictEqual([out.lineKind, out.link], ['muted', null]);
  const link = { label: 'Get Claude Code', url: 'https://claude.com/claude-code' };
  const none = aiChoiceView({ ...CLAUDE, hasKey: false, line: { text: "Claude Code isn't installed on this computer.", link } });
  assert.deepStrictEqual([none.lineText, none.lineKind, none.link], ["Claude Code isn't installed on this computer.", 'muted', link]);
});
```

- [ ] **Run it:** `node --test test/ai-form.test.js` — fails: `aiChoiceView is not a function` (the file exports nothing).

- [ ] **Write the implementation.** Replace `src/renderer/common/ai-form.js` with:

```js
'use strict';
/* global module */
/* exported mountAiForm */

/**
 * The AI form (which AI, API key, model), used by Settings and the Welcome window. All four AIs are shown at once as
 * choices, so nobody has to open a list to find out which ones Buddy works with; the fifth choice is Claude Code on
 * this computer, which has no key: its status line (installed and signed in, or what to do about it) stands where the
 * key box is, with Check again. The key box never shows a saved key; it only takes a new one.
 */

/**
 * What the form shows for the chosen AI `p` (one of the settings snapshot's providers): whether the key box is there
 * (else Claude Code's line, with its link when Claude Code is missing), and the model choices with their names.
 * `models` is the list to show (the live one, or the built-in one), `chosen` the saved model.
 */
function aiChoiceView(p, { models = p.fallbackModels, chosen } = {}) {
  const needsKey = p.needsKey !== false;
  const line = needsKey ? null : p.line;
  return {
    needsKey,
    lineText: line ? line.text : '',
    lineKind: line && p.hasKey ? 'good' : 'muted',
    link: line ? line.link : null,
    options: models.map((m) => ({ value: m, label: p.modelLabels?.[m] ?? m, selected: m === chosen })),
  };
}

async function mountAiForm(root) {
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const choices = el('div', { className: 'ai-choices' });
  const key = el('input', { id: 'ai-key', type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' });
  const saveKey = el('button', { type: 'button', textContent: 'Save key' });
  const getKey = el('a', { href: '#', textContent: 'Get a key' });
  const status = el('span', { className: 'muted' });
  status.setAttribute('aria-live', 'polite'); // what a check of the key found is read out as it changes
  const model = el('select', { id: 'ai-model' });
  const refresh = el('button', { type: 'button', textContent: 'Refresh' });
  // Claude Code's line, link and Check again, shown in place of the key box when it is the chosen AI.
  const claudeLine = el('span', { id: 'ai-claude-line', className: 'muted' });
  claudeLine.setAttribute('aria-live', 'polite');
  const claudeGet = el('a', { id: 'ai-claude-get', href: '#', textContent: 'Get Claude Code', hidden: true });
  const claudeCheck = el('button', { id: 'ai-claude-check', type: 'button', textContent: 'Check again' });

  const keyLabel = el('label', { htmlFor: 'ai-key', textContent: 'API key' });
  const keyRow = el('div', { className: 'row' }, [key, saveKey]);
  const keyStatusRow = el('p', { className: 'row' }, [status, el('span', { className: 'spacer' }), getKey]);
  const claudeRow = el('p', { className: 'row', hidden: true }, [claudeLine, el('span', { className: 'spacer' }), claudeGet, claudeCheck]);

  root.classList.add('ai-form'); // base.css spaces the form by this class
  root.replaceChildren(
    el('fieldset', {}, [el('legend', { textContent: 'Which AI do you have a key for?' }), choices]),
    keyLabel,
    keyRow,
    keyStatusRow,
    claudeRow,
    el('label', { htmlFor: 'ai-model', textContent: 'Model' }),
    el('div', { className: 'row' }, [model, refresh]),
  );

  let snap = await window.buddy.get();
  if (!snap.ok) {
    root.replaceChildren(el('p', { className: 'error', textContent: snap.error.message }));
    return;
  }
  const current = () => snap.providers.find((p) => p.id === snap.settings.provider);
  const view = (options) => aiChoiceView(current(), { chosen: snap.settings.models[snap.settings.provider], ...options });

  // The choices are made once, and render() only moves the check: making them again would drop the keyboard
  // focus that is on one of them, and the arrow keys would stop after the first press. Claude Code's choice takes
  // a whole row of its own, under the four keys.
  const radios = snap.providers.map((p) => {
    const radio = el('input', { type: 'radio', name: 'ai-provider', value: p.id });
    radio.addEventListener('change', () => pick(p.id));
    const className = p.needsKey === false ? 'ai-choice wide' : 'ai-choice';
    choices.append(el('label', { className }, [radio, el('span', { textContent: p.label })]));
    return radio;
  });

  function setStatus(text, kind = 'muted') {
    status.textContent = text;
    status.className = kind;
  }

  /** What is known about the key: saved or not. */
  function showKeyStatus() {
    const p = current();
    setStatus(p.hasKey ? 'Key saved ✓' : 'No key yet.', p.hasKey ? 'good' : 'muted');
  }

  /** Claude Code's line: signed in (green), or what to do, with Get Claude Code when it is not installed. */
  function showClaudeLine({ lineText, lineKind, link }) {
    claudeLine.textContent = lineText;
    claudeLine.className = lineKind;
    claudeGet.hidden = !link;
    if (link) claudeGet.textContent = link.label;
  }

  function fillModels(models) {
    model.replaceChildren(...view({ models }).options.map((o) => el('option', { value: o.value, textContent: o.label, selected: o.selected })));
  }

  async function loadModels() {
    const p = current();
    fillModels(p.fallbackModels);
    if (!p.hasKey || p.needsKey === false) return; // Claude Code's names are its own: there is no list to fetch
    const r = await window.buddy.models(p.id);
    if (p.id !== snap.settings.provider) return; // another AI was chosen while this one was loading
    if (r.ok) {
      fillModels(r.models);
      showKeyStatus(); // a refresh that works clears the error an earlier one left
    } else {
      setStatus(r.error.message, 'error');
    }
  }

  function render() {
    const p = current();
    const v = view();
    for (const radio of radios) radio.checked = radio.value === p.id;
    key.value = '';
    key.placeholder = `Paste your ${p.label} key`;
    // The key box and its line, or Claude Code's line: one or the other. Refresh is for a key's live list only.
    keyLabel.hidden = keyRow.hidden = keyStatusRow.hidden = !v.needsKey;
    claudeRow.hidden = v.needsKey;
    refresh.hidden = !v.needsKey;
    if (v.needsKey) showKeyStatus();
    else showClaudeLine(v);
  }

  async function pick(id) {
    const r = await window.buddy.set({ provider: id });
    // render() empties the key box, but here the key stays: a person may paste it first and then click their AI.
    // It is read now, after the answer, so anything typed while the AI was being saved is kept too.
    const typed = key.value;
    if (!r.ok) {
      render(); // back to the AI that is saved
      key.value = typed;
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    key.value = typed;
    await loadModels();
  }

  saveKey.addEventListener('click', async () => {
    setStatus('Checking your key…');
    const r = await window.buddy.saveKey(current().id, key.value);
    if (!r.ok) {
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    fillModels(r.models);
    // The key was for another AI than the one that was chosen: it was kept there, and Buddy switched to it.
    const { label } = current();
    const switched = r.switchedFrom ? `That key is for ${label}, so I switched to ${label}. ` : '';
    if (!r.verified) setStatus(`${switched}Key saved — I couldn't check it (no internet)`);
    else if (switched) setStatus(`${switched}Key saved ✓`, 'good');
  });

  model.addEventListener('change', async () => {
    const r = await window.buddy.set({ models: { ...snap.settings.models, [current().id]: model.value } });
    if (r.ok) {
      snap = r;
      if (status.className === 'error') showKeyStatus(); // an earlier error no longer applies
      return;
    }
    fillModels([...model.options].map((o) => o.value)); // back to the model that is saved
    setStatus(r.error.message, 'error');
  });

  refresh.addEventListener('click', () => loadModels());
  getKey.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = await window.buddy.openUrl(current().keyUrl);
    if (!r.ok) setStatus(r.error.message, 'error');
  });

  // Check again asks Claude Code itself (not the cached answer), and the line follows; the snapshot's entry is
  // brought up to date too, so choosing another AI and coming back shows the same.
  claudeCheck.addEventListener('click', async () => {
    claudeLine.textContent = 'Checking…';
    claudeLine.className = 'muted';
    const r = await window.buddy.claudeStatus(true);
    const p = current();
    if (p.needsKey !== false) return; // another AI was chosen meanwhile
    if (!r.ok) {
      claudeLine.textContent = r.error.message;
      claudeLine.className = 'error';
      return;
    }
    Object.assign(p, { status: r.status, line: r.line, hasKey: r.status.loggedIn === true });
    showClaudeLine(view());
  });
  claudeGet.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = await window.buddy.claudeGet();
    if (!r.ok) {
      claudeLine.textContent = r.error.message;
      claudeLine.className = 'error';
    }
  });

  render();
  await loadModels();
}

// For the tests: the page gets the functions as plain script globals (update-view.js does the same).
if (typeof module !== 'undefined') module.exports = { aiChoiceView };
```

  And in `src/renderer/common/base.css`, after line 371 (`.ai-choice { justify-content: center; ... }`), add:
  ```css
  .ai-choice.wide { grid-column: 1 / -1; } /* Claude Code on this computer: a row of its own under the four keys */
  ```

- [ ] **Run it:** `node --test test/ai-form.test.js` — pass (3 tests). `npm test` — ESLint clean (the file is a
  browser script in `eslint.config.js`: the `/* global module */` line at the top tells ESLint about `module`, and the
  `typeof` guard keeps the page happy, as update-view.js does), all green.
  Then look at it once: `npm start`, Settings → AI → pick Claude Code on this computer (the line, Check again, the
  four names, no key box, no Refresh); pick Claude (Anthropic) again (the key box is back). Close the app.

- [ ] **Commit:**
  `git add src/renderer/common/ai-form.js src/renderer/common/base.css test/ai-form.test.js && git commit -m "Claude Code brain: the fifth choice in the AI form, with its status line"`

---

### Task 5: the error codes in `src/main/actions.js` (one new line)

**Files:**
- Modify: `src/main/actions.js` — one new line after line 49 (`const AI_ERRORS = [...]`); nothing else in the file
  moves or changes (another session, buddy-72, holds it: the commit message says so)
- Test: `test/actions.test.js` (one new test appended after the test at line 1292, `Open Settings goes to the AI section ...`)

**Interfaces:**
- Consumes: the error codes of C1.
- Produces: C5.

- [ ] **Write the failing test.** Append to `test/actions.test.js`, after the test that ends at line 1300:

```js
test("Claude Code's errors that are fixed in Settings get Open Settings, which opens on the AI section; a plain failure gets Try again only", async () => {
  for (const [code, message] of [
    ['no_claude', "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings."],
    ['claude_signed_out', "Claude Code isn't signed in. Open a terminal, run claude, and sign in."],
    ['claude_limit', 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.'],
  ]) {
    const s = setup({ answers: [failure(code, message)] });
    await s.actions.open();
    await s.actions.send('mail');
    assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: message, code, buttons: ['retry', 'settings'] }, code);
    await s.actions.act(2, 'settings');
    assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['openSettings', 'ai']], code);
  }
  const s = setup({ answers: [failure('claude_failed', "Claude Code couldn't answer. Try again.")] });
  await s.actions.open();
  await s.actions.send('mail');
  assert.deepStrictEqual(lastItem(s).buttons, ['retry']);
});
```

- [ ] **Run it:** `node --test test/actions.test.js` — the new test fails: buttons are `['retry']` for `no_claude`.

- [ ] **Write the implementation.** In `src/main/actions.js`, after line 49
  (`const AI_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'need_key', 'free_off'];`) insert
  exactly one line:

```js
AI_ERRORS.push('no_claude', 'claude_signed_out', 'claude_limit'); // Claude Code as the brain (claude/run.js): fixed in Settings → AI too
```
  Add the line, change nothing else. (`SETTINGS_ERRORS` at line 59 is built from `AI_ERRORS` after this line, so it
  sees the three codes.)

- [ ] **Run it:** `node --test test/actions.test.js` — pass. `npm test` — green.

- [ ] **Commit:**
  `git add src/main/actions.js test/actions.test.js && git commit -m "Claude Code brain: its three Settings errors join AI_ERRORS (one line in actions.js, held by buddy-72)"`

---

### Task 6: the end-to-end check with a fake claude command

**Files:**
- Create: `test/e2e/checks/48-claude-code.js`
- Modify: `test/e2e/checks/30-settings.js` lines 15–21 (five choices, five labels)
- `test/e2e/smoke.js`: no change (the check puts the fake on PATH itself: `createFind()` reads `process.env` live)

**Interfaces:**
- Consumes: the page ids of C4, `ctx.actions`, `ctx.panel`, `ctx.windows`, `ctx.store`, `ctx.bubble` as
  `40-panel.js` uses them; `app.getPath('userData')`.
- Produces: the two e2e scenes of spec §6.

- [ ] **Edit `30-settings.js`** (the AI form now has five choices):
  line 15: `... document.querySelectorAll('#ai input[type=radio]').length === 5"), 'the five AI choices');`
  lines 17–21:
  ```js
    assert.deepStrictEqual(
      await page(`${labels}.map((label) => label.textContent.trim())`),
      ['Claude (Anthropic)', 'OpenAI', 'Google Gemini', 'Groq', 'Claude Code on this computer'],
      'all four AIs and Claude Code are there, in order',
    );
  ```
  The "two rows of two" and "two columns" checks that follow read `boxes[0..3]` only and still hold; add after them:
  ```js
    const wide = await page(`${labels}[4].getBoundingClientRect().width`);
    assert.ok(wide > boxes[1].right - boxes[0].left - 1, 'Claude Code takes a row of its own, as wide as the two columns');
  ```

- [ ] **Write the check** `test/e2e/checks/48-claude-code.js`:

```js
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Claude Code as the brain, with a fake `claude` on PATH in place of the real one. The fake answers `auth status` and
// `--version` as Claude Code does, and `-p` with one JSON object, after writing down what it was asked (the arguments,
// the text on stdin, the mark and the folder it ran in). BUDDY_E2E_CLAUDE=out makes it "not signed in". The command is
// a shell script that runs this Electron as Node, so nothing has to be installed; Windows has no sh, and a .cmd is not
// started the same way, so this check is for the Mac (the owner tests Windows by hand, spec §6).
const FAKE = `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const out = process.env.BUDDY_E2E_CLAUDE === 'out';
if (args[0] === '--version') {
  process.stdout.write('2.1.289 (Claude Code)\\n');
  process.exit(0);
}
if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify(out
    ? { loggedIn: false }
    : { loggedIn: true, authMethod: 'claude.ai', email: 'e2e@example.com', subscriptionType: 'max', configDirectory: '/tmp/e2e-claude' }) + '\\n');
  process.exit(out ? 1 : 0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  fs.writeFileSync(process.env.BUDDY_E2E_CLAUDE_LOG, JSON.stringify({ args, input, mark: process.env.BUDDY_CLAUDE_CODE, cwd: process.cwd() }));
  if (out) {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login' }) + '\\n');
    process.exit(1);
  }
  const chat = { kind: 'write', say: 'Ye lo!', text: 'Dear Sir, I need leave tomorrow.', notes: [], doIt: false, send: false, remember: [], again: false };
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(chat), session_id: 'e2e', stop_reason: 'end_turn',
    usage: { input_tokens: 500, output_tokens: 40 },
  }) + '\\n');
});
`;

module.exports = async function claudeCodeCheck(ctx, { assert, waitFor }) {
  if (process.platform === 'win32') return;
  const userData = app.getPath('userData');
  const binDir = path.join(userData, 'fake-bin');
  const log = path.join(userData, 'fake-claude.json');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-claude.js'), FAKE);
  fs.writeFileSync(
    path.join(binDir, 'claude'),
    `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "${path.join(binDir, 'fake-claude.js')}" "$@"\n`,
    { mode: 0o755 },
  );
  const env = { PATH: process.env.PATH, BUDDY_E2E_CLAUDE: process.env.BUDDY_E2E_CLAUDE, BUDDY_E2E_CLAUDE_LOG: process.env.BUDDY_E2E_CLAUDE_LOG };
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.BUDDY_E2E_CLAUDE_LOG = log;
  delete process.env.BUDDY_E2E_CLAUDE;
  const savedProvider = ctx.store.get('provider');

  let settingsWindow = null;
  const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
  async function openSettingsOnAi() {
    settingsWindow = ctx.windows.open('settings');
    await waitFor(() => settingsPage("document.querySelector('#ai input[type=radio]') !== null").catch(() => false), 'the Settings page to load');
    await settingsPage(`document.querySelector('.nav-item[data-section="ai"]').click()`);
    await waitFor(() => settingsPage("document.querySelectorAll('#ai input[type=radio]').length === 5"), 'the five AI choices');
  }
  async function closeSettings() {
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;
  }
  const claudeLine = () => settingsPage("document.getElementById('ai-claude-line').textContent");
  /** Check again in the form: it asks the fake command afresh, and the cached status the brain uses follows. */
  async function checkAgain(expectedLine) {
    await settingsPage("document.getElementById('ai-claude-check').click()");
    await waitFor(async () => (await claudeLine()) === expectedLine, `the line "${expectedLine}"`);
  }

  let panel = null;
  const page = (script) => panel.webContents.executeJavaScript(script);
  const chat = () => ctx.actions.state().chat;
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
  }
  async function type(message) {
    await page(`(() => {
      const box = document.getElementById('box');
      box.focus();
      box.value = ${JSON.stringify(message)};
      box.dispatchEvent(new Event('input'));
    })()`);
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  }
  const pageShows = (text, what) => waitFor(async () => (await page('document.body.innerText')).includes(text), what);

  try {
    // Pick Claude Code in Settings → AI: the key box goes, its line and Check again come, the models are its names.
    await openSettingsOnAi();
    await settingsPage(`[...document.querySelectorAll('#ai fieldset label')].find((l) => l.textContent.trim() === 'Claude Code on this computer').click()`);
    await waitFor(() => ctx.store.get('provider') === 'claude-code', 'Claude Code to be saved as the AI');
    await waitFor(() => settingsPage("document.getElementById('ai-key').parentElement.hidden"), 'the key box to go');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').parentElement.hidden"), false, "Claude Code's line is there");
    assert.deepStrictEqual(
      await settingsPage("[...document.getElementById('ai-model').options].map((o) => [o.value, o.textContent])"),
      [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']],
    );
    assert.strictEqual(await settingsPage("[...document.querySelectorAll('#ai button')].find((b) => b.textContent === 'Refresh').hidden"), true, 'no Refresh');
    // The status the app found before this check (no claude on PATH) is cached: Check again asks the fake.
    await checkAgain('Claude Code: signed in as e2e@example.com (Max)');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').className"), 'good');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-get').hidden"), true, 'no Get Claude Code link when it is there');
    await closeSettings();

    // A chat message: one run of the fake claude, in safe mode, marked, in Buddy's data folder, and its answer in the chat.
    await openPanel();
    await type('boss ko mail, kal chutti chahiye');
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer from Claude Code');
    assert.deepStrictEqual([chat().at(-1).say, chat().at(-1).text, chat().at(-1).buttons], ['Ye lo!', 'Dear Sir, I need leave tomorrow.', ['insert', 'copy']]);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the answer');
    const run = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.deepStrictEqual(run.args.slice(0, 12), [
      '-p', '--output-format', 'json', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--permission-prompts', 'none', '--model', 'sonnet',
    ]);
    assert.strictEqual(run.args[12], '--system-prompt');
    assert.match(run.args[13], /"kind"/, 'the chat system prompt');
    assert.match(run.input, /boss ko mail, kal chutti chahiye/);
    assert.strictEqual(run.mark, '1', 'marked as one of Buddy\'s own runs');
    assert.strictEqual(fs.realpathSync(run.cwd), fs.realpathSync(userData), "run in Buddy's data folder");
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(() => !panel.isVisible(), 'Esc to close the panel');

    // Signed out: the line says what to do, and a message says the same, in red, with Try again and Open Settings.
    process.env.BUDDY_E2E_CLAUDE = 'out';
    await openSettingsOnAi();
    await checkAgain('Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').className"), 'muted');
    await closeSettings();
    await openPanel();
    await type('mail to my boss');
    await waitFor(() => chat().at(-1)?.code === 'claude_signed_out', 'the signed-out error');
    assert.deepStrictEqual([chat().at(-1).text, chat().at(-1).buttons],
      ["Claude Code isn't signed in. Open a terminal, run claude, and sign in.", ['retry', 'settings']]);
    await pageShows('Open Settings', 'the Open Settings button');
  } finally {
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    await ctx.actions.dismiss();
    ctx.store.set({ provider: savedProvider });
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};
```

- [ ] **Run it:** `npm run test:e2e` — `ok - 48-claude-code.js` among the others, `e2e: all checks passed`. If
  `30-settings.js` fails first, its edits above are not in. If the check times out at "the answer from Claude Code",
  run the fake by hand to see it: `BUDDY_E2E_CLAUDE_LOG=/tmp/x.json ELECTRON_RUN_AS_NODE=1 node_modules/.bin/electron
  <userData>/fake-bin/fake-claude.js -p --model sonnet <<< 'hi'` (the folder is printed by the harness in `userData`).

- [ ] **Commit:**
  `git add test/e2e/checks/48-claude-code.js test/e2e/checks/30-settings.js && git commit -m "Claude Code brain: the end-to-end check with a fake claude on PATH"`

---

### Task 7: the manual checklist and the last run

**Files:**
- Modify: `docs/manual-checklist.md` — a new section at the end (after line 135)

- [ ] **Append** to `docs/manual-checklist.md`:

```markdown

## Claude Code is the brain

Run with the real Claude Code (2.1.289 or newer) signed in to a Max plan, and free mode off for this account.

- [ ] Settings → AI shows a fifth choice under the four keys, "Claude Code on this computer", on a row of its own. Pick it → the key box, "Get a key" and Refresh go; in their place "Claude Code: signed in as you@mail.com (Max)" in green, with Check again; the model list says Fable, Opus, Sonnet, Haiku, with Sonnet chosen.
- [ ] Settings → Claude Code says the same line; Check again there and in the AI form both ask again (the line flickers to "Checking…").
- [ ] The Welcome window (delete `onboarded` from settings.json, or a fresh user data folder with `BUDDY_USER_DATA`) → Connect an AI shows the fifth choice, and Check again works there too.
- [ ] Panel: "boss ko mail, kal chutti chahiye" → an answer in about 2–5 s with Insert and Copy, from Claude Code (Activity Monitor shows a `claude` process while it thinks, and none after).
- [ ] TextEdit: select `i am go to market yesterday`, open the panel, ↩ in the empty box → the fix replaces the selection; the panel stays hidden; "Done! It's in TextEdit ✅".
- [ ] "what does this say?" on a window with text → "👀 Looked at …", then an answer about what is on screen; `~/Library/Application Support/Buddy/claude-tmp` is empty afterwards (and gone after a relaunch).
- [ ] Pick Opus in the model list → the next answer comes from Opus (`claude` shows `--model opus` in Activity Monitor's process info); pick Sonnet again.
- [ ] Settings → AI, pick Claude (Anthropic) → the key box is back; pick Claude Code again → its line is back and nothing was saved as a key.
- [ ] In a terminal, `claude auth logout`. Check again → "Claude Code is installed but not signed in. Open a terminal, run claude, and sign in." Panel, any message → the same words in red, with Try again and Open Settings → Settings opens on AI. `claude auth login`, Check again → signed in again; Try again answers.
- [ ] Move the command away (`mv "$(which claude)" /tmp/claude.off`), Check again → "Claude Code isn't installed on this computer." with Get Claude Code → opens claude.com/claude-code. Panel → "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings." with Open Settings. Move it back (`mv /tmp/claude.off <the path it came from>`), Check again → signed in.
- [ ] When the plan's limit is reached (Claude Code says so in a terminal too): the chat says "Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings." with Open Settings.
- [ ] Free mode on with own keys allowed (Admin → daily limit 1): the first message is the server's; the second comes from Claude Code (a `claude` process appears), with no "used up" error. Own keys not allowed → the "used up" error as before, and Claude Code is not run.
- [ ] Quit Buddy while an answer is on its way → no `claude` process is left behind.
- [ ] Windows: the owner tests the pick, a write and the signed-out line with Claude Code installed there (`claude.exe`).
```

- [ ] **Run everything:** `npm test` (green), `npm run test:e2e` (all checks pass).

- [ ] **Commit:**
  `git add docs/manual-checklist.md && git commit -m "Claude Code brain: the manual checks"`

## Spec → task map (self-review)

| Spec | Task |
|---|---|
| §3 the fifth choice, hides the key box, the names, Refresh hidden | 4 (form), 3 (snapshot), 6 (e2e) |
| §3 `provider: 'claude-code'`, not in `shared/providers`, snapshot entry, refusals | 3 |
| §3 picked while not signed in stays picked; the chat says so | 2 (`claude_signed_out`), 6 |
| §3 the free-mode note unchanged, hidden with the form | nothing to do (`free-state.js` untouched; `#ai` hides the whole form) |
| §4 the third route, "own key" rules | 2 |
| §4 `runPrompt`, the command, stdin, cwd, env, usage | 1 |
| §4 the screenshot as a file, 0600, deleted, folder emptied at launch | 1 |
| §4 timeout and signal | 1 (run) + 2 (the signal passed on) |
| §4 `buildPrompt` / `parseChat` unchanged | 2 |
| §5 the five errors and words | 1 (words), 2 (pre-checks), 5 (`AI_ERRORS`) |
| §6 unit tests | 1, 2, 3, 4, 5 |
| §6 e2e | 6 |
| §6 manual | 7 |
