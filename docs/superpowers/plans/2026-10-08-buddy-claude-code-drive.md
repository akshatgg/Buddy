# Buddy drives Claude Code (piece 2) Implementation Plan

> **For agentic workers:** the tasks run one after the other on the branch `claude-code` (worktree
> `~/projects/buddy-claude`), each a small TDD step: the failing test, the code, `npm test`, a commit. They meet through
> the contracts below, which are fixed: do not change a name, a shape or a channel. If a contract is wrong, stop and
> report it instead of working around it. Task 1 is a spike that decides between Task 2a and Task 2b; do the one it
> chose and write which in the report at the end.

**Goal:** In the same chat, the person says "fix the login bug in my-app" and Buddy hands the job to Claude Code in that
project folder, shows what it is doing (`Reading src/login.js`, `Running: npm test`), asks before a command (Allow / No),
can Stop it, and ends with `✅ Done in my-app` and the summary. Spec:
`docs/superpowers/specs/2026-10-08-buddy-claude-code-drive-design.md` (piece 2). The common ground is piece 1's spec §2
and its error words are §5 (`2026-10-08-buddy-claude-code-brain-design.md`); piece 3 (`...-watch-design.md`) is not
built here (its hooks ignore Buddy's own runs by the `BUDDY_CLAUDE_CODE` mark, which every process started here carries).

**Architecture:** `src/main/claude/job.js` runs one `claude -p` process per job (stream-json in and out), turns its
stream into a few events (`line`, `ask`, `expired`, `done`, `failed`, `stopped`) and answers permission requests on its
stdin. `src/main/claude/projects.js` keeps the list of project folders in the store. `src/main/actions.js` (the chat)
picks the project, starts the job, turns the events into chat items (a new `job` item, the `question` items `Which
project?` and `Run npm test?`) and the buttons back into answers; the panel page only draws the state as today. The AI
request `chat` (`shared/prompts.js`) gains the kind `code` and the field `projects`, so every route (own key, the
server in free mode, Android) can answer `code`; the job itself always runs through Claude Code.

**Tech Stack:** Electron 44, CommonJS, vanilla JS pages, `node --test`, ESLint; Claude Code 2.1.289 (the owner's Mac).

## Global Constraints

- Plain, friendly words in everything the person sees; match the comment density and style of the file you touch
  (plain English comments, as the files have).
- Every IPC answer is `{ ok, ... }` through `guarded` (`src/main/ipc/result.js`); errors are `BuddyError(code, message)`
  (`shared/errors.js`).
- After changing anything in `shared/`, run `npm run sync:web` (`test/web-shared.test.js` checks `web/shared` is a copy).
- `npm test` (ESLint + unit tests) must pass before every commit. Tests: `node --test`, `test/<name>.test.js`,
  CommonJS, fakes passed in (no real `claude`, no real spawn, no real timers in unit tests).
- Only today's moods: `thinking`, `happy`, `sleepy`, `idle`, `wave`. ("celebrate" and "sad" come with the feelings PR,
  which swaps them in `actions.js` later: not here.)
- Never edit `src/renderer/buddy/*`, `src/main/buddy-window.js`, `src/main/geometry.js`, `src/main/ipc/buddy.js`,
  `src/preload/buddy.js`, `art/*`, `assets/*`, `src/main/notch-*`, `src/main/home.js`, `src/renderer/notch/*`,
  `src/main/panel-window.js`.
- In `src/main/main.js`, `src/main/actions.js`, `src/main/store.js`, `src/main/ipc/settings.js`,
  `src/renderer/settings/*`: **new lines only**, never move, reword or delete an existing line (other sessions hold
  these files; say so in the commit message: "new lines only").
- `test/e2e/smoke.js`: at most one added line.
- Commits: plain messages, no Co-Authored-By line and no AI-author credit anywhere (commits or files).
- Nothing of the project (code, summary, paths) goes anywhere but Claude Code: no logging of file contents, nothing to
  Buddy's server. The log (`console.warn`) may name an error code and the exit code, never the task text.

## The base (already on the branch: use it, do not build it)

- `src/main/claude/find.js`: `createFind({ env, platform, home, spawnImpl, existsSync, now })` →
  `{ find(), status({ force } = {}), line(status) }`. `find()` → the path of the `claude` command, or null. `status()` →
  Promise of `{ installed, loggedIn, email, plan, version, path, configDirectory }`, cached 60 s. Constants exported:
  `PROVIDER_ID = 'claude-code'`, `ENV_MARK = 'BUDDY_CLAUDE_CODE'`, `MODELS = ['fable', 'opus', 'sonnet', 'haiku']`,
  `DEFAULT_MODEL = 'sonnet'`.
- `src/main/ipc/claude.js`: `registerClaudeIpc({ ipcMain, allowed, find, openExternal })` with the channels
  `claude:status` and `claude:get`; inside, `const handle = guarded(ipcMain, allowed)`. Called from `src/main/main.js`
  line 276 with `allowed` = the Settings window. Its test harness is `test/claude-ipc.test.js` `harness()`.
- `src/preload/settings.js`: `claudeStatus(force)`, `claudeGet()` (lines 36–37).
- Settings page: `<section id="section-claude">` (index.html lines 79–83) with `#claude-status`, `#claude-get` and
  `#claude-check`; `SECTIONS` in `settings.js` has `'claude'`; `renderClaude()` (lines 80–97) fills the line and the
  page's load (the IIFE at lines 607–629) calls it at line 622.
- `src/main/main.js`: line 89 `const find = createFind();` (it reads `process.env` live: a check may put a fake
  `claude` on PATH at any time); piece 1 passes `find` into `createAi` (its line 90).
- Piece 1 adds `no_claude`, `claude_signed_out`, `claude_limit` to `AI_ERRORS` in `actions.js` (so Open Settings goes
  to AI for them). The job's own errors use the same codes and the same words, copied into `job.js` (Contract J4).

## Contracts

### J1. The store and the projects list (Task 3; Tasks 5, 7, 9 use it)

`src/main/store.js` DEFAULTS gain two lines: `projects: []` and `lastProject: null`. Saved shape:
`projects: [{ path, name }]` (`name` = the folder's last part), at most 20; `lastProject` is a path or null.

`src/main/claude/projects.js`: `createProjects({ store, existsSync = fs.existsSync, resolve = path.resolve })` →

```js
{
  list(): [{ path, name, found: boolean }],   // in the order added; found = the folder exists now
  found(): [{ path, name, found: true }],     // only the folders that exist (what the chat uses)
  names(): string[],                           // the names of found(), for the AI request
  add(path): { path, name },                   // resolved; added twice → the one already there (no duplicate);
                                               // 21st → BuddyError('bad_request', 'You can have 20 projects at most. Remove one first.')
                                               // not text / empty → BuddyError('bad_request', 'Pick a folder first.')
  remove(path): boolean,                       // also clears lastProject when it was this one
  lastProject(): { path, name, found } | null, // the saved pick, only when it is still listed and found
  setLastProject(path): void,
}
```

### J2. IPC and preload (Task 7; Task 8 uses it)

`src/main/ipc/claude.js` `registerClaudeIpc({ ipcMain, allowed, find, openExternal, projects, dialog })` gains two
named arguments and three channels (new lines; the watch piece adds `watch` to the same list: both are additive):
- `claude:projects` → `{ projects: projects.list() }`
- `claude:add-project` → opens `dialog.showOpenDialog({ title: 'Add a project folder', properties: ['openDirectory'] })`;
  cancelled → `{ projects, added: null }`; else `projects.add(filePaths[0])` → `{ projects, added: { path, name } }`
  (a refusal is the BuddyError through `guarded`).
- `claude:remove-project` (path) → `{ projects }`.

`src/preload/settings.js` gains `claudeProjects()`, `addProject()`, `removeProject(path)`.

### J3. The `chat` request (Task 4; Task 5 sends it)

`shared/prompts.js`: `KINDS` gains `'code'`. `buildPrompt('chat', input)` takes `projects?: string[]` (at most 20 names,
each on one line and cut to 100 characters, non-strings skipped); when any are left, the user prompt gets the line
`Their projects on this computer: my-app, site` (after the facts, before the chat so far). `parseChat` reads `code` like
the other kinds, with `doIt: false`, `send: false`, `notes: []` and `again: false` always for it (`text` is the job).

### J4. The job (Task 2, 2a/2b; Task 5 calls it)

`src/main/claude/job.js`:

```js
const { createJobs, lineFor, questionFor, ASKS_PERMISSION, ERRORS, MAX_JOB_MS, ANSWER_MS, KILL_MS } = require('./job');
const jobs = createJobs({ find, projects, spawnImpl = child_process.spawn, env = process.env,
                          later = setTimeout, cancelLater = clearTimeout });
jobs.projects()                 // projects.found()
jobs.lastProject()              // projects.lastProject()
jobs.setLastProject(path)
jobs.status()                   // find.status() (cached 60 s)
jobs.start({ project, task, person, model, onEvent })  // → { stop(), answer(requestId, allow): boolean }
```

`start` throws `BuddyError('no_claude', ERRORS.no_claude)` when `find.find()` is null. Otherwise it spawns, with
`cwd: project.path` and `env: { ...env, [ENV_MARK]: '1' }`, `stdio: ['pipe', 'pipe', 'pipe']`:

```
<claude> -p --output-format stream-json --input-format stream-json --verbose
         --permission-mode acceptEdits --permission-prompts host          (2a)
         --permission-mode acceptEdits --permission-prompts none --allowedTools "Read Edit Write Glob Grep Bash(git status*) Bash(git diff*) Bash(npm test*) Bash(npm run *)"   (2b)
         --model <model if in MODELS, else DEFAULT_MODEL>
         --append-system-prompt "The person's name is <person>. When you are done, say in plain words, in at most five short lines, what you did and what is left."
```
(`--max-turns 60` is in the spec but **not in Claude Code 2.1.289's `--help`**: the spike (Task 1) tries it once and
the flag is kept only if the command accepts it; see Task 1 step 5.) The task goes on stdin first as
`{"type":"user","message":{"role":"user","content":"<task>"}}\n`; stdin stays open until the job ends.

`onEvent(event)` is called in order, with exactly one ending event (`done`, `failed` or `stopped`) and nothing after it:

```js
{ type: 'line', text }                     // 'Reading src/login.js' … (lineFor); one per tool_use in an assistant message
{ type: 'ask', requestId, text, what }     // 2a only: 'Run npm test?' / 'Use WebFetch?' (questionFor); what = the command or the tool name
{ type: 'expired', requestId }             // 2a only: no answer in ANSWER_MS (10 min): the job denied it itself
{ type: 'done', text }                     // the result's text (trimmed)
{ type: 'failed', code, message }          // code: 'claude_failed' | 'claude_limit' | 'claude_signed_out' | 'too_long'
{ type: 'stopped' }                        // the process ended after stop()
```

`ERRORS` (the words of the brain spec §5, plus this piece's two): `no_claude: "Claude Code isn't installed on this
computer. Install it, or pick another AI in Settings."`, `claude_signed_out: "Claude Code isn't signed in. Open a
terminal, run claude, and sign in."`, `claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick
another AI in Settings.'`, `claude_failed: (name) => \`Claude Code couldn't finish in ${name}.\``, `too_long: 'That took
too long, so I stopped it.'`. `MAX_JOB_MS = 30 * 60_000`, `ANSWER_MS = 10 * 60_000`, `KILL_MS = 3000`.

`lineFor(name, input, projectPath)`: Read → `Reading <p>`, Edit → `Editing <p>`, Write → `Writing <p>` (`<p>` =
`input.file_path` relative to the project when inside it, else as given), Glob/Grep → `Looking for "<pattern>"`,
Bash → `Running: <command>` (one line, cut to 80 characters with "…"), WebFetch/WebSearch → `Searching the web`,
anything else → `Working…`. `questionFor(name, input)`: Bash → `Run <command>?` (cut to 80), else `Use <name>?`.

### J5. The chat (Task 5 makes it; Task 6 draws it)

The C4 state (`docs/superpowers/plans/2026-10-08-buddy-chat-panel.md`) gains `exampleProject: string` (the name of
`lastProject` when found, else the first found project, else `''`) and one item type:

```js
| { id, type: 'job', project, lines: string[] /* newest 6 */, done: boolean, text /* the summary, '' until done */, buttons }
```
Buttons (new): `'stop'` (while it runs), `'open-folder'`, `'copy'` (done), `'allow'`, `'deny'` (on `Run npm test?`),
`'project:<path>'` and `'not-now'` (on `Which project?`). Labels: Stop, Open folder, Copy, Allow, No, the folder's name,
Not now. Primary: `allow`, `open-folder` (with today's `insert`, `replace`, `send`).

Items in order for a job: `event` `🔧 Started in my-app` → the `job` item → (questions) → `event` `✅ Done in my-app` /
`⏹ Stopped` / an `error` line. Error lines: `Claude Code couldn't finish in my-app.` with `['retry']` (the same task
again); the limit words with `['settings']`; `That took too long, so I stopped it.` with `[]`. `ui` gains
`openFolder(path)` (main.js: `shell.openPath`).

### J6. The fake `claude` for the e2e (Task 10)

The check `test/e2e/checks/49-claude-job.js` writes a shell script `claude` into `<userData>/fake-bin-job/` that runs
`fake-claude-job.js` through this Electron as Node (`ELECTRON_RUN_AS_NODE=1`), puts that folder first on
`process.env.PATH` for the check and takes it off after (`createFind()` reads `process.env` live, so `test/e2e/smoke.js`
needs no line). `auth status` → the JSON of a signed-in Max account (`loggedIn`, `email`, `subscriptionType`,
`configDirectory`), `--version` → `2.1.289 (Claude Code)`, `-p` → the stream of Task 10. Mac only, as the brain's
`48-claude-code.js` (Windows has no sh; the owner tests Windows by hand).

---

### Task 1: the spike — does the host permission exchange work on Claude Code 2.1.289?

**Files:** Create `tools/claude-permission-spike.js`. No test (it is the test). Run on the owner's Mac with the real
`claude` (signed in, Max). It spends a few turns of the owner's plan: say so before running it.

**Interfaces:** Consumes the real `claude`. Produces a decision (2a or 2b) and the exact shapes of `control_request`
and `control_response`, which Task 2a copies into its test fixtures.

- [ ] Write the script:

```js
'use strict';

/**
 * Proves, on this Mac's Claude Code, whether Buddy can answer Claude Code's permission questions over stdin: starts
 * `claude -p` with stream-json in and out and `--permission-prompts host` in an empty temporary folder, asks it to run
 * one harmless shell command, prints every line that goes in or out, and answers the first `control_request`
 * (`can_use_tool`) with an allow. What to look for is in docs/superpowers/plans/2026-10-08-buddy-claude-code-drive.md,
 * Task 1. It uses a few turns of the signed-in plan.
 *
 *   node tools/claude-permission-spike.js            # answers the request with the nested shape (the default)
 *   node tools/claude-permission-spike.js --flat     # answers with the flat shape, if the nested one is ignored
 *   node tools/claude-permission-spike.js --max-turns # also passes --max-turns 60, to see whether 2.1.289 takes it
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');

const TASK = 'Run the shell command `echo buddy-spike-ok` with the Bash tool and tell me exactly what it printed. Do nothing else.';
const GIVE_UP_MS = 120_000;
const flat = process.argv.includes('--flat');
const withTurns = process.argv.includes('--max-turns');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-spike-'));
const args = [
  '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
  '--permission-mode', 'acceptEdits', '--permission-prompts', 'host', '--model', 'sonnet',
  ...(withTurns ? ['--max-turns', '60'] : []),
];
console.log(`[spike] cwd ${dir}`);
console.log(`[spike] claude ${args.join(' ')}`);
const child = spawn('claude', args, { cwd: dir, env: { ...process.env, BUDDY_CLAUDE_CODE: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });

function send(object) {
  const line = `${JSON.stringify(object)}\n`;
  process.stdout.write(`>> ${line}`);
  child.stdin.write(line);
}

let answered = false;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  console.log(`<< ${line}`);
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not JSON: shown above, nothing to answer
  }
  if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool' && !answered) {
    answered = true;
    const id = message.request_id;
    send(flat
      ? { type: 'control_response', request_id: id, subtype: 'success', response: { behavior: 'allow' } }
      : { type: 'control_response', response: { subtype: 'success', request_id: id, response: { behavior: 'allow' } } });
  }
  if (message.type === 'result') {
    console.log(`[spike] result: is_error=${message.is_error} subtype=${message.subtype}`);
    child.stdin.end();
  }
});
readline.createInterface({ input: child.stderr }).on('line', (line) => console.log(`!! ${line}`));
child.on('close', (code, signal) => {
  console.log(`[spike] exited: code=${code} signal=${signal} answered=${answered}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
child.on('error', (err) => console.log(`[spike] could not start claude: ${err.code}`));

send({ type: 'user', message: { role: 'user', content: TASK } });
setTimeout(() => {
  console.log('[spike] giving up after 120 s: SIGTERM');
  child.kill('SIGTERM');
}, GIVE_UP_MS).unref();
```

- [ ] Run it: `node tools/claude-permission-spike.js 2>&1 | tee /tmp/spike-nested.log`. (If `claude` is not on the
  terminal's PATH, put `/opt/homebrew/bin` first.)
- [ ] Read the log for these, in order:
  1. `<< {"type":"system","subtype":"init",...}` — the process started and read stdin (if nothing comes within 20 s,
     the stdin message shape is wrong: check it against J4: `{"type":"user","message":{"role":"user","content":"..."}}`).
  2. `<< {"type":"assistant",...tool_use...,"name":"Bash","input":{"command":"echo buddy-spike-ok"...}}`.
  3. `<< {"type":"control_request","request_id":"…","request":{"subtype":"can_use_tool","tool_name":"Bash","input":{...}}}`
     followed by the script's `>> {"type":"control_response",...}` line.
  4. `<< {"type":"user",...tool_result...buddy-spike-ok...}` — the command ran: the allow was understood.
  5. `<< {"type":"result","subtype":"success","is_error":false,"result":"...buddy-spike-ok..."}` and `[spike] exited: code=0`.
- [ ] **Outcome A (works):** lines 3, 4 and 5 are all there within the 120 s. Copy the exact `control_request` line
  (with the input shortened) and the `control_response` that worked into Task 2a's fixtures (`REQUEST` and `RESPONSE`
  there) and do **Task 2a**.
- [ ] **Outcome B, first try:** line 3 appears but line 4 never comes (the process waits until the 120 s SIGTERM, or
  the result says the command was denied or not run): run `node tools/claude-permission-spike.js --flat` once (the
  other response shape). If that gives lines 4 and 5, it is Outcome A with the flat shape. **Outcome B, final:** no
  `control_request` ever appears (the result says it was denied / needs permission with nothing on stdout to answer),
  or neither shape is understood: do **Task 2b**. Spend at most one task's time on this; the spec fixes the fallback.
- [ ] Also run `node tools/claude-permission-spike.js --max-turns 2>&1 | head -5`: if the first lines say
  `error: unknown option '--max-turns'` (or the process exits at once with code 1 and no `init`), the flag is not in
  2.1.289: Task 2 leaves it out and the report says so. If the run starts normally, Task 2 keeps `--max-turns 60`.
- [ ] Write the outcome (A nested / A flat / B, and the max-turns answer) into the plan's **Report** section at the
  end of this file, then commit: `git add tools/claude-permission-spike.js docs/superpowers/plans/2026-10-08-buddy-claude-code-drive.md && git commit -m "Claude Code: a spike that answers a permission request over stdin, and what it found"`.

---

### Task 2: the job — start, the stream, the result, Stop, the 30-minute end (`src/main/claude/job.js`)

**Files:** Create `src/main/claude/job.js`; Test `test/claude-job.test.js`.

**Interfaces:** Consumes `find.find()` / `find.status()` (the base), `projects` (J1, a fake here), `spawnImpl`
(fake), `later`/`cancelLater`/`now` (fakes). Produces J4: `createJobs`, `lineFor`, `questionFor`, `ERRORS`,
`MAX_JOB_MS`, `ANSWER_MS`, `KILL_MS`, `ASKS_PERMISSION` (set in 2a/2b; `false` here).

- [ ] Write the failing tests. The fake spawn gives a child whose stdout/stderr are `PassThrough` streams and whose
  stdin records what is written:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createJobs, lineFor, questionFor, ERRORS, MAX_JOB_MS, KILL_MS } = require('../src/main/claude/job');
const { ENV_MARK } = require('../src/main/claude/find');

const PROJECT = { path: '/Users/me/code/my-app', name: 'my-app', found: true };
const RESULT = (fields = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'I fixed it.', session_id: 's1', ...fields });
const TOOL = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name, input }] } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

/** A fake child process: what the job writes to its stdin is kept in `written`; the test feeds its stdout. */
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.written = [];
  child.stdinEnded = false;
  child.stdin = { write: (text) => child.written.push(text), end: () => { child.stdinEnded = true; } };
  child.signals = [];
  child.kill = (signal) => child.signals.push(signal);
  child.say = (line) => child.stdout.write(`${line}\n`);
  child.exit = (code, signal = null) => child.emit('close', code, signal);
  return child;
}

function setup({ claudePath = '/opt/homebrew/bin/claude', env = { PATH: '/usr/bin', HOME: '/Users/me' } } = {}) {
  const spawned = [];
  const timers = [];
  const cancelled = [];
  const events = [];
  const jobs = createJobs({
    find: { find: () => claudePath, status: async () => ({ installed: Boolean(claudePath), loggedIn: true }) },
    projects: { found: () => [PROJECT], lastProject: () => null, setLastProject() {} },
    spawnImpl: (command, args, options) => {
      const child = fakeChild();
      spawned.push({ command, args, options, child });
      return child;
    },
    env,
    later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    cancelLater: (t) => cancelled.push(t),
  });
  const start = (fields = {}) => jobs.start({ project: PROJECT, task: 'Fix the login bug.', person: 'Akshat', model: 'sonnet', onEvent: (e) => events.push(e), ...fields });
  return { jobs, start, spawned, timers, cancelled, events, child: () => spawned.at(-1).child };
}

test('start runs claude in the project folder with the stream flags, the model, the name, and the mark in its environment', () => {
  const s = setup();
  s.start();
  const { command, args, options } = s.spawned[0];
  assert.strictEqual(command, '/opt/homebrew/bin/claude');
  assert.deepStrictEqual(args.slice(0, 7), ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--permission-mode']);
  assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.strictEqual(args[args.indexOf('--model') + 1], 'sonnet');
  assert.strictEqual(args[args.indexOf('--append-system-prompt') + 1],
    "The person's name is Akshat. When you are done, say in plain words, in at most five short lines, what you did and what is left.");
  assert.deepStrictEqual(options, { cwd: '/Users/me/code/my-app', env: { PATH: '/usr/bin', HOME: '/Users/me', [ENV_MARK]: '1' }, stdio: ['pipe', 'pipe', 'pipe'] });
});

test('the task is the first user message on stdin, and stdin stays open', () => {
  const s = setup();
  s.start();
  assert.deepStrictEqual(s.child().written, ['{"type":"user","message":{"role":"user","content":"Fix the login bug."}}\n']);
  assert.strictEqual(s.child().stdinEnded, false);
});

test('a model that is not one of the aliases, or none, becomes sonnet', () => {
  for (const model of [undefined, '', 'gpt-5', 'constructor']) {
    const s = setup();
    s.start({ model });
    assert.strictEqual(s.spawned[0].args[s.spawned[0].args.indexOf('--model') + 1], 'sonnet', String(model));
  }
  const s = setup();
  s.start({ model: 'opus' });
  assert.strictEqual(s.spawned[0].args[s.spawned[0].args.indexOf('--model') + 1], 'opus');
});

test('no claude command: start throws no_claude in its words, and nothing is spawned', () => {
  const s = setup({ claudePath: null });
  assert.throws(() => s.start(), { code: 'no_claude', message: ERRORS.no_claude });
  assert.strictEqual(s.spawned.length, 0);
});

test('each tool use in the stream becomes a live line; text and tool results are not shown', async () => {
  const s = setup();
  s.start();
  const c = s.child();
  c.say(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
  c.say(TOOL('Read', { file_path: '/Users/me/code/my-app/src/login.js' }));
  c.say(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'const x = 1;' }] } }));
  c.say(TOOL('Bash', { command: 'npm test' }));
  c.say('not json at all');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'line', text: 'Reading src/login.js' }, { type: 'line', text: 'Running: npm test' }]);
});

test('a line split across two chunks of stdout is still read whole', async () => {
  const s = setup();
  s.start();
  const line = TOOL('Edit', { file_path: 'src/a.js' });
  s.child().stdout.write(line.slice(0, 20));
  await tick();
  s.child().stdout.write(`${line.slice(20)}\n`);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'line', text: 'Editing src/a.js' }]);
});

test('the result ends the job with its text once the process exits', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT({ result: '  I fixed login.js and the tests pass.\n' }));
  await tick();
  assert.deepStrictEqual(s.events, [], 'nothing until the process has exited');
  s.child().exit(0);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'done', text: 'I fixed login.js and the tests pass.' }]);
});

test('is_error, a non-zero exit, no result, or an empty result fail the job in plain words', async () => {
  const cases = [
    ['is_error', (c) => { c.say(RESULT({ is_error: true, subtype: 'error_during_execution', result: 'boom' })); c.exit(0); }],
    ['non-zero exit', (c) => { c.say(RESULT()); c.exit(1); }],
    ['no result', (c) => c.exit(0)],
    ['empty result', (c) => { c.say(RESULT({ result: '   ' })); c.exit(0); }],
    ['bad JSON result', (c) => { c.say('{"type":"result", oops'); c.exit(0); }],
  ];
  for (const [what, play] of cases) {
    const s = setup();
    s.start();
    play(s.child());
    await tick();
    assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'claude_failed', message: "Claude Code couldn't finish in my-app." }], what);
  }
});

test('the limit words fail the job as claude_limit, and an authentication error as claude_signed_out', async () => {
  for (const [text, code] of [
    ['You have reached your usage limit. Try again at 3pm.', 'claude_limit'],
    ['rate_limit: too many requests', 'claude_limit'],
    ['limit reached', 'claude_limit'],
    ['Not logged in. Please run /login.', 'claude_signed_out'],
    ['authentication_error: invalid token', 'claude_signed_out'],
  ]) {
    const s = setup();
    s.start();
    s.child().say(RESULT({ is_error: true, subtype: 'error_during_execution', result: text }));
    s.child().exit(1);
    await tick();
    assert.deepStrictEqual(s.events, [{ type: 'failed', code, message: ERRORS[code] }], text);
  }
});

test('a process that cannot start fails the job once', async () => {
  const s = setup();
  s.start();
  s.child().emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  s.child().exit(-2);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'claude_failed', message: "Claude Code couldn't finish in my-app." }]);
});

test('stop sends SIGTERM, then SIGKILL 3 s later, and the job ends as stopped whatever the stream said', async () => {
  const s = setup();
  const job = s.start();
  job.stop();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM']);
  assert.strictEqual(s.child().stdinEnded, true);
  const kill = s.timers.find((t) => t.ms === KILL_MS);
  kill.fn();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM', 'SIGKILL']);
  s.child().say(RESULT());
  s.child().exit(null, 'SIGKILL');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'stopped' }]);
});

test('a process that exits on SIGTERM does not get the SIGKILL', async () => {
  const s = setup();
  const job = s.start();
  job.stop();
  s.child().exit(null, 'SIGTERM');
  await tick();
  const kill = s.timers.find((t) => t.ms === KILL_MS);
  assert.ok(s.cancelled.includes(kill));
  assert.deepStrictEqual(s.events, [{ type: 'stopped' }]);
});

test('after 30 minutes the job is stopped and fails with "too long"', async () => {
  const s = setup();
  s.start();
  const end = s.timers.find((t) => t.ms === MAX_JOB_MS);
  end.fn();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM']);
  s.child().exit(null, 'SIGTERM');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'too_long', message: ERRORS.too_long }]);
});

test('the 30-minute timer is cancelled when the job ends by itself', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  assert.ok(s.cancelled.includes(s.timers.find((t) => t.ms === MAX_JOB_MS)));
});

test('nothing is reported after the end: a late line is dropped', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  s.child().say(TOOL('Read', { file_path: 'x' }));
  s.child().exit(0);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'done', text: 'I fixed it.' }]);
});

test('the live line for each tool', () => {
  const at = '/Users/me/code/my-app';
  assert.strictEqual(lineFor('Read', { file_path: `${at}/src/login.js` }, at), 'Reading src/login.js');
  assert.strictEqual(lineFor('Edit', { file_path: 'src/login.js' }, at), 'Editing src/login.js'); // a relative path, as it is
  assert.strictEqual(lineFor('Write', { file_path: `${at}/src/new.js` }, at), 'Writing src/new.js');
  assert.strictEqual(lineFor('Read', { file_path: '/etc/hosts' }, at), 'Reading /etc/hosts');
  assert.strictEqual(lineFor('Glob', { pattern: '**/*.js' }, at), 'Looking for "**/*.js"');
  assert.strictEqual(lineFor('Grep', { pattern: 'login' }, at), 'Looking for "login"');
  assert.strictEqual(lineFor('Bash', { command: 'npm test' }, at), 'Running: npm test');
  assert.strictEqual(lineFor('Bash', { command: `echo ${'x'.repeat(100)}` }, at), `Running: echo ${'x'.repeat(75)}…`);
  assert.strictEqual(lineFor('Bash', { command: 'git status\n&& git diff' }, at), 'Running: git status && git diff');
  assert.strictEqual(lineFor('WebFetch', { url: 'https://x.y' }, at), 'Searching the web');
  assert.strictEqual(lineFor('WebSearch', { query: 'x' }, at), 'Searching the web');
  assert.strictEqual(lineFor('TodoWrite', {}, at), 'Working…');
  assert.strictEqual(lineFor('Read', {}, at), 'Working…');
  assert.strictEqual(lineFor('Read', { file_path: 42 }, at), 'Working…');
});

test('the question for a permission request', () => {
  assert.strictEqual(questionFor('Bash', { command: 'npm test' }), 'Run npm test?');
  assert.strictEqual(questionFor('Bash', { command: `x ${'y'.repeat(100)}` }), `Run x ${'y'.repeat(77)}…?`);
  assert.strictEqual(questionFor('WebFetch', { url: 'https://x.y' }), 'Use WebFetch?');
  assert.strictEqual(questionFor('Bash', {}), 'Use Bash?');
});

test('the words of every error', () => {
  assert.strictEqual(ERRORS.no_claude, "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.");
  assert.strictEqual(ERRORS.claude_signed_out, "Claude Code isn't signed in. Open a terminal, run claude, and sign in.");
  assert.strictEqual(ERRORS.claude_limit, 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
  assert.strictEqual(ERRORS.claude_failed('site'), "Claude Code couldn't finish in site.");
  assert.strictEqual(ERRORS.too_long, 'That took too long, so I stopped it.');
});

test('projects, the last pick and the status come through from the modules behind them', async () => {
  const s = setup();
  assert.deepStrictEqual(s.jobs.projects(), [PROJECT]);
  assert.strictEqual(s.jobs.lastProject(), null);
  assert.deepStrictEqual(await s.jobs.status(), { installed: true, loggedIn: true });
});
```

- [ ] Run: `node --test test/claude-job.test.js` → fails with `Cannot find module '../src/main/claude/job'`.
- [ ] Implement `src/main/claude/job.js`:

```js
'use strict';

/**
 * One job for Claude Code: "fix the login bug in my-app" handed to `claude -p` in that project's folder, its stream
 * read line by line into a few events the chat shows (src/main/actions.js), its permission questions answered over its
 * stdin (Task 2a) and the whole thing stopped on Stop or after 30 minutes. Nothing of the project goes anywhere but
 * into the process: the log only ever names an error code and an exit code.
 *
 * The stream (`--output-format stream-json --verbose`) is one JSON object a line: `system` (init), `assistant` (text
 * and tool_use blocks), `user` (tool results), `control_request` (a permission question, with `--permission-prompts
 * host`) and last `result` ({ subtype, is_error, result }).
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { BuddyError } = require('../../../shared/errors');
const { ENV_MARK, MODELS, DEFAULT_MODEL } = require('./find');

// The words of piece 1's errors (the brain spec §5), kept here too: the brain's run.js belongs to another session.
const ERRORS = {
  no_claude: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.",
  claude_signed_out: "Claude Code isn't signed in. Open a terminal, run claude, and sign in.",
  claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.',
  claude_failed: (name) => `Claude Code couldn't finish in ${name}.`,
  too_long: 'That took too long, so I stopped it.',
};
const MAX_JOB_MS = 30 * 60_000; // no job runs longer than this
const ANSWER_MS = 10 * 60_000; // a permission question left open this long is denied (Task 2a)
const KILL_MS = 3000; // SIGKILL this long after SIGTERM, when the process has not gone by itself
const LINE_CHARS = 80; // a command is shown cut to this
// Whether the job asks the person before a command (Task 2a) or runs with a fixed allow list (Task 2b).
const ASKS_PERMISSION = false;
const LIMIT_WORDS = /rate_limit|usage limit|limit reached/i;
const SIGNED_OUT_WORDS = /not logged in|authentication_error|invalid api key|please run \/login/i;
const SUMMARY = (person) => `The person's name is ${person}. When you are done, say in plain words, in at most five short lines, what you did and what is left.`;

/** `text` on one line, cut to `max` characters with "…". */
function cut(text, max = LINE_CHARS) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A file's path as shown: inside the project, relative to it; elsewhere, as it is. */
function shownPath(file, projectPath) {
  if (!projectPath || !path.isAbsolute(file)) return file;
  const relative = path.relative(projectPath, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/** One short line for a tool Claude Code uses: what it reads, edits, writes, looks for or runs. */
function lineFor(name, input, projectPath) {
  const file = typeof input?.file_path === 'string' ? input.file_path : '';
  if (name === 'Read' && file) return `Reading ${shownPath(file, projectPath)}`;
  if (name === 'Edit' && file) return `Editing ${shownPath(file, projectPath)}`;
  if (name === 'Write' && file) return `Writing ${shownPath(file, projectPath)}`;
  if ((name === 'Glob' || name === 'Grep') && typeof input?.pattern === 'string') return `Looking for "${cut(input.pattern)}"`;
  if (name === 'Bash' && typeof input?.command === 'string') return `Running: ${cut(input.command)}`;
  if (name === 'WebFetch' || name === 'WebSearch') return 'Searching the web';
  return 'Working…';
}

/** The question the chat asks before a tool Claude Code may not use on its own: the command, or the tool's name. */
function questionFor(name, input) {
  if (name === 'Bash' && typeof input?.command === 'string' && input.command.trim()) return `Run ${cut(input.command)}?`;
  return `Use ${name}?`;
}

/** Which of piece 1's errors a failed result is, by its words. */
function codeFor(text) {
  if (LIMIT_WORDS.test(text)) return 'claude_limit';
  if (SIGNED_OUT_WORDS.test(text)) return 'claude_signed_out';
  return 'claude_failed';
}

/**
 * `find` is find.js's; `projects` is projects.js's; `spawnImpl`, `env` and the timers are the system's (the tests pass
 * their own). The arguments Claude Code is started with are in the plan (J4); Task 2a or 2b sets the permission ones.
 */
function createJobs({ find, projects, spawnImpl = spawn, env = process.env, later = setTimeout, cancelLater = clearTimeout }) {
  function argsFor({ model, person }) {
    const alias = MODELS.includes(model) ? model : DEFAULT_MODEL;
    return [
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      // Task 2a: '--permission-prompts', 'host'
      // Task 2b: '--permission-prompts', 'none', '--allowedTools', ALLOWED
      '--model', alias,
      '--append-system-prompt', SUMMARY(person),
    ];
  }

  /**
   * Start a job in `project` ({ path, name }). `onEvent` gets the events of J4, the last of them `done`, `failed` or
   * `stopped`, and nothing after that. Answers { stop(), answer(requestId, allow) }.
   */
  function start({ project, task, person, model, onEvent }) {
    const command = find.find();
    if (!command) throw new BuddyError('no_claude', ERRORS.no_claude);
    const child = spawnImpl(command, argsFor({ model, person }), {
      cwd: project.path,
      env: { ...env, [ENV_MARK]: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let result = null; // the stream's last `result`, read
    let ended = false;
    let stopping = null; // null, 'stop' (Stop in the chat) or 'too_long' (the 30 minutes)
    let kill = null;
    const timers = new Set();

    const after = (fn, ms) => {
      const timer = later(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const emit = (event) => {
      if (!ended) onEvent(event);
    };
    const end = (event) => {
      if (ended) return;
      emit(event);
      ended = true;
      for (const timer of timers) cancelLater(timer);
      timers.clear();
    };

    /** Ends the process: SIGTERM, and SIGKILL when it is still there KILL_MS later. */
    function terminate(reason) {
      if (stopping) return;
      stopping = reason;
      child.stdin.end();
      child.kill('SIGTERM');
      kill = after(() => child.kill('SIGKILL'), KILL_MS);
    }

    function onLine(line) {
      if (ended) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return; // claude prints the odd plain line too
      }
      if (message?.type === 'assistant') {
        const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
        for (const block of blocks) {
          if (block?.type === 'tool_use') emit({ type: 'line', text: lineFor(block.name, block.input, project.path) });
        }
      } else if (message?.type === 'result') {
        result = { isError: message.is_error === true, text: typeof message.result === 'string' ? message.result.trim() : '' };
      }
      // Task 2a adds the control_request branch here.
    }

    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', () => {}); // read, so that a chatty process never blocks; never logged
    child.on('error', (err) => {
      console.warn('[buddy] claude could not run:', err.code);
      end({ type: 'failed', code: 'claude_failed', message: ERRORS.claude_failed(project.name) });
    });
    child.on('close', (code) => {
      if (kill) {
        cancelLater(kill);
        timers.delete(kill);
      }
      if (stopping === 'stop') return end({ type: 'stopped' });
      if (stopping === 'too_long') return end({ type: 'failed', code: 'too_long', message: ERRORS.too_long });
      if (result && !result.isError && code === 0 && result.text) return end({ type: 'done', text: result.text });
      console.warn('[buddy] claude job failed: exit', code);
      const failure = codeFor(result?.text || '');
      end({ type: 'failed', code: failure, message: failure === 'claude_failed' ? ERRORS.claude_failed(project.name) : ERRORS[failure] });
    });

    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: task } })}\n`);
    after(() => terminate('too_long'), MAX_JOB_MS);

    return {
      stop: () => terminate('stop'),
      answer: () => false, // Task 2a
    };
  }

  return {
    start,
    projects: () => projects.found(),
    lastProject: () => projects.lastProject(),
    setLastProject: (p) => projects.setLastProject(p),
    status: () => find.status(),
  };
}

module.exports = { createJobs, lineFor, questionFor, ERRORS, MAX_JOB_MS, ANSWER_MS, KILL_MS, ASKS_PERMISSION };
```

  Note on the `kill` timer: `terminate` registers it through `after`, so `end` would cancel it too; the `close`
  handler cancels it first (and takes it out of `timers`), which is what the "exits on SIGTERM" test looks for.
- [ ] If Task 1 said `--max-turns` is accepted, add `'--max-turns', '60'` after `'acceptEdits'` in `argsFor` and
  `assert.strictEqual(args[args.indexOf('--max-turns') + 1], '60')` in the first test.
- [ ] Run: `node --test test/claude-job.test.js` → all pass. `npm test` → pass.
- [ ] Commit: `git add src/main/claude/job.js test/claude-job.test.js && git commit -m "Claude Code job: start claude in the project, read its stream into live lines and the result, Stop, and the 30-minute end"`.

---

### Task 2a (if the spike worked): the permission exchange over stdin

**Files:** Modify `src/main/claude/job.js` (`argsFor`, `onLine`, `answer`, `ASKS_PERMISSION`); Test `test/claude-job.test.js`.

**Interfaces:** Produces J4's `ask` and `expired` events and `answer(requestId, allow)`; `ASKS_PERMISSION = true`.

- [ ] Add the fixtures at the top of the test, with the exact shapes the spike printed (replace these if Task 1's log
  differs; the `request.input` may be shortened):

```js
// The shapes Claude Code 2.1.289 printed in the spike (tools/claude-permission-spike.js, Task 1).
const REQUEST = (id, name, input) => JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: name, input } });
const RESPONSE = (id, response) => `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })}\n`;
```
  (If the spike's `--flat` shape was the one that worked: `RESPONSE = (id, response) => \`${JSON.stringify({ type: 'control_response', request_id: id, subtype: 'success', response })}\n\``,
  and the same shape in `answer` below.)

- [ ] Add the failing tests:

```js
test('the job asks the person before a command, with --permission-prompts host', async () => {
  const s = setup();
  s.start();
  const { args } = s.spawned[0];
  assert.strictEqual(args[args.indexOf('--permission-prompts') + 1], 'host');
  assert.ok(!args.includes('--allowedTools'));
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'ask', requestId: 'r1', text: 'Run npm test?', what: 'npm test' }]);
});

test('Allow and No go back on stdin as the control response; a second answer to the same request is refused', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  s.child().say(REQUEST('r2', 'WebFetch', { url: 'https://x.y' }));
  await tick();
  assert.strictEqual(job.answer('r1', true), true);
  assert.strictEqual(job.answer('r2', false), true);
  assert.deepStrictEqual(s.child().written.slice(1), [
    RESPONSE('r1', { behavior: 'allow' }),
    RESPONSE('r2', { behavior: 'deny', message: 'The person said no.' }),
  ]);
  assert.strictEqual(job.answer('r1', true), false);
  assert.strictEqual(job.answer('nope', true), false);
  assert.strictEqual(s.child().written.length, 3);
});

test('a question left open for 10 minutes is denied by the job itself, and the chat hears that', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'rm -rf build' }));
  await tick();
  const wait = s.timers.find((t) => t.ms === ANSWER_MS);
  wait.fn();
  assert.deepStrictEqual(s.child().written.at(-1), RESPONSE('r1', { behavior: 'deny', message: 'The person said no.' }));
  assert.deepStrictEqual(s.events.at(-1), { type: 'expired', requestId: 'r1' });
  assert.strictEqual(job.answer('r1', true), false, 'answered already');
});

test('an answer in time cancels the 10-minute deny, and the end cancels the ones still waiting', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  s.child().say(REQUEST('r2', 'Bash', { command: 'npm run build' }));
  await tick();
  const [first, second] = s.timers.filter((t) => t.ms === ANSWER_MS);
  job.answer('r1', true);
  assert.ok(s.cancelled.includes(first));
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  assert.ok(s.cancelled.includes(second));
});

test('a control request of another kind, or without an id, is left alone', async () => {
  const s = setup();
  s.start();
  s.child().say(JSON.stringify({ type: 'control_request', request_id: 'r9', request: { subtype: 'initialize' } }));
  s.child().say(JSON.stringify({ type: 'control_request', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } }));
  await tick();
  assert.deepStrictEqual(s.events, []);
});

test('the job says it asks permission', () => {
  assert.strictEqual(ASKS_PERMISSION, true);
});
```
  Add `ANSWER_MS` and `ASKS_PERMISSION` to the test's `require`.
- [ ] Run: `node --test test/claude-job.test.js` → the six new tests fail (no `ask` event, `answer` false, no host flag).
- [ ] Implement. In `argsFor`, after `'acceptEdits'`: `'--permission-prompts', 'host',`. `ASKS_PERMISSION = true`. In
  `start`, a map of open questions, the branch in `onLine`, and `answer`:

```js
    const open = new Map(); // requestId -> the timer that denies it after ANSWER_MS

    /** The control response for one question, in the shape Claude Code 2.1.289 reads (the spike's). */
    function respond(requestId, allow) {
      const response = allow ? { behavior: 'allow' } : { behavior: 'deny', message: 'The person said no.' };
      child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`);
    }

    /** Allow or No from the chat. False when that question is not open (answered, denied by time, or never asked). */
    function answer(requestId, allow) {
      const wait = open.get(requestId);
      if (wait === undefined) return false;
      open.delete(requestId);
      cancelLater(wait);
      timers.delete(wait);
      respond(requestId, allow);
      return true;
    }
```
  In `onLine`, before the closing comment:
```js
      } else if (message?.type === 'control_request' && message.request?.subtype === 'can_use_tool' && typeof message.request_id === 'string') {
        const id = message.request_id;
        const { tool_name: name, input } = message.request;
        // Nothing is answered without the person; a question left open for ANSWER_MS is denied, and the job goes on.
        open.set(id, after(() => {
          open.delete(id);
          respond(id, false);
          emit({ type: 'expired', requestId: id });
        }, ANSWER_MS));
        emit({ type: 'ask', requestId: id, text: questionFor(name, input), what: name === 'Bash' && typeof input?.command === 'string' && input.command.trim() ? cut(input.command) : name });
      }
```
  Return `answer` in place of `() => false`. The `end` already cancels every timer in `timers` (the open ones among them).
- [ ] Run: `node --test test/claude-job.test.js` → pass. `npm test` → pass.
- [ ] Commit: `git add src/main/claude/job.js test/claude-job.test.js && git commit -m "Claude Code job: ask the person before a command, answer Allow and No over stdin, deny after 10 minutes"`.

---

### Task 2b (if the spike did not work): the fixed allow list

**Files:** Modify `src/main/claude/job.js` (`argsFor`, `ASKS_PERMISSION`); Test `test/claude-job.test.js`.

**Interfaces:** `ASKS_PERMISSION = false`; `ALLOWED_TOOLS` exported; no `ask`/`expired` events ever; `answer` always false.

- [ ] Add the failing tests:

```js
test('the job runs with a fixed allow list and nobody to ask (--permission-prompts none)', () => {
  const s = setup();
  s.start();
  const { args } = s.spawned[0];
  assert.strictEqual(args[args.indexOf('--permission-prompts') + 1], 'none');
  assert.strictEqual(args[args.indexOf('--allowedTools') + 1], 'Read Edit Write Glob Grep Bash(git status*) Bash(git diff*) Bash(npm test*) Bash(npm run *)');
  assert.strictEqual(ALLOWED_TOOLS, args[args.indexOf('--allowedTools') + 1]);
  assert.strictEqual(ASKS_PERMISSION, false);
});

test('a control request in the stream is ignored, and answer() is always false', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(JSON.stringify({ type: 'control_request', request_id: 'r1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'ls' } } }));
  await tick();
  assert.deepStrictEqual(s.events, []);
  assert.strictEqual(job.answer('r1', true), false);
  assert.strictEqual(s.child().written.length, 1);
});
```
  Add `ALLOWED_TOOLS`, `ASKS_PERMISSION` to the `require`.
- [ ] Run → the first test fails (no `--permission-prompts`).
- [ ] Implement: `const ALLOWED_TOOLS = 'Read Edit Write Glob Grep Bash(git status*) Bash(git diff*) Bash(npm test*) Bash(npm run *)';`
  and in `argsFor` after `'acceptEdits'`: `'--permission-prompts', 'none', '--allowedTools', ALLOWED_TOOLS,`. Export
  `ALLOWED_TOOLS`. Replace the two `// Task 2a` comments with one line: `// Claude Code's summary says what it was not allowed to do: the host exchange did not work on 2.1.289 (the plan's Task 1).`
- [ ] Run → pass. `npm test` → pass.
- [ ] Commit: `git add src/main/claude/job.js test/claude-job.test.js && git commit -m "Claude Code job: a fixed allow list instead of permission questions"`.

---

### Task 3: the projects list — the store and `projects.js`

**Files:** Modify `src/main/store.js` lines 28–30 (two new lines inside DEFAULTS, new lines only); Create
`src/main/claude/projects.js`; Test `test/claude-projects.test.js`, `test/store.test.js` (one new test).

**Interfaces:** Produces J1.

- [ ] Add to `test/store.test.js`:

```js
test('no projects for Claude Code yet, and no last pick', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.deepStrictEqual(store.get('projects'), []);
  assert.strictEqual(store.get('lastProject'), null);
});
```
- [ ] Write `test/claude-projects.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createProjects } = require('../src/main/claude/projects');

const APP = path.resolve('/Users/me/code/my-app');
const SITE = path.resolve('/Users/me/code/site');

function setup({ projects = [], lastProject = null, missing = [] } = {}) {
  const data = { projects, lastProject };
  const store = { get: (key) => data[key], set(patch) { Object.assign(data, patch); return { ...data }; } };
  const p = createProjects({ store, existsSync: (folder) => !missing.includes(folder) });
  return { p, data };
}

test('a folder is added once, by its resolved path, named after its last part, and saved', () => {
  const { p, data } = setup();
  assert.deepStrictEqual(p.add('/Users/me/code/my-app/'), { path: APP, name: 'my-app' });
  assert.deepStrictEqual(p.add('/Users/me/code/../code/my-app'), { path: APP, name: 'my-app' });
  assert.deepStrictEqual(data.projects, [{ path: APP, name: 'my-app' }]);
  assert.deepStrictEqual(p.list(), [{ path: APP, name: 'my-app', found: true }]);
});

test('nothing, blanks and things that are not text ask for a folder', () => {
  const { p } = setup();
  for (const bad of [undefined, null, '', '   ', 42]) {
    assert.throws(() => p.add(bad), { code: 'bad_request', message: 'Pick a folder first.' }, String(bad));
  }
});

test('at most 20 folders; the 21st is refused in plain words', () => {
  const { p } = setup({ projects: Array.from({ length: 20 }, (_, i) => ({ path: `/p/${i}`, name: String(i) })) });
  assert.throws(() => p.add('/p/twenty'), { code: 'bad_request', message: 'You can have 20 projects at most. Remove one first.' });
  assert.deepStrictEqual(p.add('/p/3'), { path: path.resolve('/p/3'), name: '3' }, 'one already there is not a 21st');
});

test('a folder that is gone shows as not found, and is not one the chat may use', () => {
  const { p } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }], missing: [SITE] });
  assert.deepStrictEqual(p.list(), [{ path: APP, name: 'my-app', found: true }, { path: SITE, name: 'site', found: false }]);
  assert.deepStrictEqual(p.found(), [{ path: APP, name: 'my-app', found: true }]);
  assert.deepStrictEqual(p.names(), ['my-app']);
});

test('remove takes a folder out and forgets it as the last pick', () => {
  const { p, data } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }], lastProject: APP });
  assert.strictEqual(p.remove(APP), true);
  assert.deepStrictEqual(data.projects, [{ path: SITE, name: 'site' }]);
  assert.strictEqual(data.lastProject, null);
  assert.strictEqual(p.remove(APP), false);
  assert.strictEqual(p.remove(SITE), true);
  assert.deepStrictEqual(p.list(), []);
});

test('the last pick is remembered, and given back only while it is listed and found', () => {
  const { p, data } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }] });
  assert.strictEqual(p.lastProject(), null);
  p.setLastProject(SITE);
  assert.strictEqual(data.lastProject, SITE);
  assert.deepStrictEqual(p.lastProject(), { path: SITE, name: 'site', found: true });
  p.setLastProject('/not/listed');
  assert.strictEqual(p.lastProject(), null);
  const gone = setup({ projects: [{ path: SITE, name: 'site' }], lastProject: SITE, missing: [SITE] });
  assert.strictEqual(gone.p.lastProject(), null);
});

test('a damaged list in the settings file is read as empty', () => {
  const { p } = setup({ projects: 'nope' });
  assert.deepStrictEqual(p.list(), []);
  const odd = setup({ projects: [{ path: 42 }, null, { path: APP, name: 'my-app' }] });
  assert.deepStrictEqual(odd.p.list(), [{ path: APP, name: 'my-app', found: true }]);
});
```
- [ ] Run: `node --test test/claude-projects.test.js test/store.test.js` → fail (`Cannot find module`, and
  `projects` undefined).
- [ ] `src/main/store.js`: add two lines after line 30 (`listenOnOpen`), inside DEFAULTS:

```js
  projects: [], // the folders Claude Code may work in, as [{ path, name }] (src/main/claude/projects.js)
  lastProject: null, // the path of the project the chat last worked in, or null
```
- [ ] Create `src/main/claude/projects.js`:

```js
'use strict';

/**
 * The folders Buddy may run Claude Code in: Settings → Claude Code → My projects. Kept in the settings file as
 * [{ path, name }], at most 20, each once; `lastProject` remembers the chat's last pick. Nothing else on the disk is a
 * project: the chat only ever starts a job in one of these, and only while the folder is there.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../../shared/errors');

const MAX_PROJECTS = 20;

function createProjects({ store, existsSync = fs.existsSync, resolve = path.resolve }) {
  /** The saved list, with anything that is not { path: string } left out. */
  const saved = () => (Array.isArray(store.get('projects')) ? store.get('projects') : [])
    .filter((p) => p && typeof p.path === 'string' && p.path)
    .map((p) => ({ path: p.path, name: typeof p.name === 'string' && p.name ? p.name : path.basename(p.path) }));

  const withFound = (p) => ({ ...p, found: existsSync(p.path) });

  function list() {
    return saved().map(withFound);
  }

  function found() {
    return list().filter((p) => p.found);
  }

  function add(folder) {
    const given = typeof folder === 'string' ? folder.trim() : '';
    if (!given) throw new BuddyError('bad_request', 'Pick a folder first.');
    const full = resolve(given);
    const projects = saved();
    const there = projects.find((p) => p.path === full);
    if (there) return { ...there };
    if (projects.length >= MAX_PROJECTS) {
      throw new BuddyError('bad_request', `You can have ${MAX_PROJECTS} projects at most. Remove one first.`);
    }
    const project = { path: full, name: path.basename(full) || full };
    store.set({ projects: [...projects, project] });
    return { ...project };
  }

  function remove(folder) {
    const projects = saved();
    const left = projects.filter((p) => p.path !== folder);
    if (left.length === projects.length) return false;
    const patch = { projects: left };
    if (store.get('lastProject') === folder) patch.lastProject = null;
    store.set(patch);
    return true;
  }

  function lastProject() {
    const last = store.get('lastProject');
    const project = typeof last === 'string' ? saved().find((p) => p.path === last) : null;
    if (!project) return null;
    const checked = withFound(project);
    return checked.found ? checked : null;
  }

  return {
    list,
    found,
    names: () => found().map((p) => p.name),
    add,
    remove,
    lastProject,
    setLastProject: (folder) => store.set({ lastProject: typeof folder === 'string' ? folder : null }),
  };
}

module.exports = { createProjects, MAX_PROJECTS };
```
- [ ] Run → pass. `npm test` → pass (the settings-ipc snapshot test compares `settings` to the store's `all()` minus a
  few keys: the two new keys ride along in both, so it still passes; if a test lists DEFAULTS' keys by name, add the
  two there).
- [ ] Commit: `git add src/main/store.js src/main/claude/projects.js test/claude-projects.test.js test/store.test.js && git commit -m "Claude Code projects: the list of folders in the store, 20 at most, each once, with the last pick (store.js: new lines only)"`.

---

### Task 4: the `code` kind and the `projects` field in the chat request

**Files:** Modify `shared/prompts.js` lines 26 (`KINDS`), 28–30 (`CHAT_LIMITS`), 69 (the JSON shape line), 78 (a new
kind line after `send`), 119–152 (`chatPrompt`), 272–291 (`parseChat`); then `npm run sync:web` (`web/shared/*`);
Test `test/prompts.test.js`.

**Interfaces:** Produces J3. The server (`web/lib/handlers.js`) needs no change: `chat` goes through `ask` as today,
and the Android app re-syncs later (`npm run sync:android`, after PR #9: not here).

- [ ] Add the failing tests:

```js
test('chat: their project names reach the user prompt on one line, at most 20, each cut to 100 characters', () => {
  const p = buildPrompt('chat', { message: 'fix the bug in my-app', projects: ['my-app', 'site', '', 42, null, `${'x'.repeat(120)}`] });
  assert.match(p.user, new RegExp(`Their projects on this computer: my-app, site, ${'x'.repeat(100)}\\n`));
  const many = buildPrompt('chat', { message: 'hi', projects: Array.from({ length: 25 }, (_, i) => `p${i}`) });
  assert.ok(many.user.includes('p19') && !many.user.includes('p20'), 'the first 20');
  assert.ok(!buildPrompt('chat', { message: 'hi' }).user.includes('Their projects'), 'nothing when there are none');
  assert.ok(!buildPrompt('chat', { message: 'hi', projects: 'my-app' }).user.includes('Their projects'), 'not a list: skipped');
});

test('chat: the projects come after what Buddy knows and before the chat so far', () => {
  const p = buildPrompt('chat', { message: 'go', facts: ['You work at Infosys.'], projects: ['my-app'], history: [{ from: 'you', text: 'hi' }] });
  assert.ok(p.user.indexOf('What you know about them') < p.user.indexOf('Their projects on this computer'));
  assert.ok(p.user.indexOf('Their projects on this computer') < p.user.indexOf('Chat so far'));
});

test('chat: the system prompt has the "code" kind and its rule', () => {
  const { system } = buildPrompt('chat', { message: 'hi' });
  assert.match(system, /"code"/);
  assert.match(system, /or "send" or "code"/, 'the JSON shape has it');
  assert.match(system, /- "code": a job in one of their own software projects on this computer/);
  assert.match(system, /Never "code" when no projects are listed/);
  assert.match(system, /one or two clear English sentences for a programmer/);
});

test('parseChat reads "code" with its task as the text, and never with doIt, send, notes or again', () => {
  const r = parseChat(answerOf({ kind: 'code', say: 'On it!', text: 'Fix the login bug in src/login.js.', doIt: true, send: true, notes: ['x'], again: true }));
  assert.deepStrictEqual(r, { kind: 'code', say: 'On it!', text: 'Fix the login bug in src/login.js.', notes: [], doIt: false, send: false, remember: [], again: false });
});
```
  And in `'chat: the system prompt asks for the JSON and gives every rule'` and `'parseChat reads each kind'`, add
  `'code'` to the kinds looped over.
- [ ] Run: `node --test test/prompts.test.js` → the new tests fail.
- [ ] Implement:
  - line 26: `const KINDS = ['write', 'fix', 'answer', 'box', 'screen', 'send', 'code'];`
  - `CHAT_LIMITS` gains `projects: 20, projectChars: 100`.
  - line 69, the shape: `... or "screen" or "send" or "code", "say": ...`.
  - after line 78 (the `"send"` rule), a new line:
    `'- "code": a job in one of their own software projects on this computer (fix a bug, add a feature, run the tests, explain the code), and the request lists their projects. "text" is the job as one or two clear English sentences for a programmer, with everything they said that matters. Never "code" when no projects are listed.',`
  - `chatPrompt`: after the facts,
    ```js
    const projects = (Array.isArray(input.projects) ? input.projects : [])
      .map((name) => oneLine(name, CHAT_LIMITS.projectChars))
      .filter(Boolean)
      .slice(0, CHAT_LIMITS.projects);
    ```
    and after the facts part is pushed: `if (projects.length) parts.push(\`Their projects on this computer: ${projects.join(', ')}\`);`
  - `parseChat`: after `out` is built, `if (out.kind === 'code') return { ...out, notes: [], doIt: false, send: false, again: false };`
    (before the `answer` line).
- [ ] Run → pass. `npm run sync:web`. `npm test` → pass (`web-shared.test.js` sees the copy).
- [ ] Commit: `git add shared/prompts.js web/shared test/prompts.test.js && git commit -m "Chat request: the \"code\" kind and the person's project names"`.

---

### Task 5: the chat flow — `src/main/actions.js` (new lines only)

**Files:** Modify `src/main/actions.js` (new lines only: a `require`, constants near line 51, one line in `SHOWN`
(line 68), one line in `sectionFor` (line 55), one argument in `createActions` (after line 92), one state line (after
line 101), one state field in `stateOf` (after line 159), one line in `answer()` (after line 357), one line at the top
of `finish()` (after line 433), new branches in `act()` inserted before line 664 `} else if (button === 'retry') {`,
and new functions before `return {` (line 705)); Test `test/actions.test.js` (a `jobs` fake in `setup`, new tests at
the end, and `exampleProject: ''` added to every existing assertion that lists the whole state: the first test (lines 182–195) and any other with `voice: {` in it).

**Interfaces:** Consumes J4 (`jobs`), J3 (`projects` in the request), `ui.openFolder`, `ui.isPanelVisible`. Produces
J5 (the items, the buttons, `exampleProject`).

- [ ] In `setup()` of `test/actions.test.js` add the fake jobs. New parameters: `projects = []`, `lastProject = null`,
  `claude = { installed: true, loggedIn: true }`, `startFails = null`. Before `createActions`:

```js
  // Claude Code jobs (src/main/claude/job.js): `projects` are the folders found, `claude` how Claude Code stands, and
  // each job started is kept in `started` with its onEvent, so that a test can play what the job reports.
  let last = lastProject;
  const started = [];
  const jobs = {
    projects: () => projects,
    lastProject: () => projects.find((p) => p.path === last) || null,
    setLastProject(p) {
      last = p;
      log.push(['lastProject', p]);
    },
    status: async () => claude,
    start(options) {
      log.push(['startJob', { project: options.project, task: options.task, person: options.person, model: options.model }]);
      if (startFails) throw startFails;
      const handle = {
        stops: 0,
        answers: [],
        stop() { this.stops += 1; },
        answer(id, allow) { this.answers.push([id, allow]); return true; },
      };
      started.push({ ...options, handle });
      return handle;
    },
  };
```
  Pass `jobs,` into `createActions` and return `started` from `setup`. Add `openFolder: (p) => log.push(['openFolder', p]),`
  to the fake `ui`. In the first test's expected state add `exampleProject: ''` after `voice`.
- [ ] Add the tests at the end of the file:

```js
// Claude Code jobs

const APP_DIR = { path: '/Users/me/code/my-app', name: 'my-app', found: true };
const SITE_DIR = { path: '/Users/me/code/site', name: 'site', found: true };
const code = (fields = {}) => reply({ kind: 'code', say: 'On it!', text: 'Fix the login bug in src/login.js.', ...fields });
/** The job's item in the chat, as the page gets it. */
const jobItem = (s) => chatOf(s).find((i) => i.type === 'job');
const play = (s, event) => s.started.at(-1).onEvent(event);

test('the request carries the names of their projects, only when there are any', async () => {
  const s = setup({ projects: [APP_DIR, SITE_DIR] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  assert.deepStrictEqual(asked(s.log), [input({ message: 'fix the bug', projects: ['my-app', 'site'] })]);
  const none = setup();
  await none.actions.open();
  await none.actions.send('fix the bug');
  assert.deepStrictEqual(asked(none.log), [input({ message: 'fix the bug' })]);
});

test('the empty chat can give an example with the last project, else the first', async () => {
  const s = setup({ projects: [APP_DIR, SITE_DIR], lastProject: SITE_DIR.path });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].exampleProject, 'site');
  const first = setup({ projects: [APP_DIR, SITE_DIR] });
  await first.actions.open();
  assert.strictEqual(entries(first.log, 'showPanel')[0][1].exampleProject, 'my-app');
});

test('a "code" answer with one project starts the job there: the friendly line, "Started", the job item, and the buddy thinks', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the login bug');
  assert.deepStrictEqual(chatOf(s), [
    { id: 1, type: 'you', text: 'fix the login bug' },
    { id: 2, type: 'buddy', say: 'On it!', text: '', notes: [], buttons: [] },
    { id: 3, type: 'event', text: '🔧 Started in my-app', buttons: [] },
    { id: 4, type: 'job', project: 'my-app', lines: [], done: false, text: '', buttons: ['stop'] },
  ]);
  assert.deepStrictEqual(entries(s.log, 'startJob')[0][1], { project: APP_DIR, task: 'Fix the login bug in src/login.js.', person: 'Akshat', model: undefined });
  assert.deepStrictEqual(entries(s.log, 'lastProject'), [['lastProject', APP_DIR.path]]);
  assert.deepStrictEqual(moods(s.log).at(-1), 'thinking');
  assert.strictEqual(s.actions.state().busy, false, 'the box can still be used');
});

test('which project: the one named in the message (any case), else the last one, else the chat asks', async () => {
  const named = setup({ projects: [APP_DIR, SITE_DIR], answers: [code()] });
  await named.actions.open();
  await named.actions.send('fix the bug in MY-APP');
  assert.deepStrictEqual(entries(named.log, 'startJob')[0][1].project, APP_DIR);

  const last = setup({ projects: [APP_DIR, SITE_DIR], lastProject: SITE_DIR.path, answers: [code()] });
  await last.actions.open();
  await last.actions.send('fix the bug');
  assert.deepStrictEqual(entries(last.log, 'startJob')[0][1].project, SITE_DIR);

  const ask = setup({ projects: [APP_DIR, SITE_DIR], answers: [code()] });
  await ask.actions.open();
  await ask.actions.send('fix the bug');
  assert.deepStrictEqual(lastItem(ask), { id: 3, type: 'question', text: 'Which project?', buttons: [`project:${APP_DIR.path}`, `project:${SITE_DIR.path}`, 'not-now'] });
  assert.strictEqual(entries(ask.log, 'startJob').length, 0);
  await ask.actions.act(3, `project:${SITE_DIR.path}`);
  assert.deepStrictEqual(chatOf(ask).slice(2), [
    { id: 3, type: 'event', text: '📁 site', buttons: [] },
    { id: 4, type: 'event', text: '🔧 Started in site', buttons: [] },
    { id: 5, type: 'job', project: 'site', lines: [], done: false, text: '', buttons: ['stop'] },
  ]);
  assert.deepStrictEqual(entries(ask.log, 'startJob')[0][1].task, 'Fix the login bug in src/login.js.');
  assert.deepStrictEqual(entries(ask.log, 'lastProject'), [['lastProject', SITE_DIR.path]]);
});

test('Not now on "Which project?" starts nothing', async () => {
  const s = setup({ projects: [APP_DIR, SITE_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  await s.actions.act(3, 'not-now');
  assert.deepStrictEqual(lastItem(s), { id: 3, type: 'event', text: 'Okay, not now.', buttons: [] });
  assert.strictEqual(entries(s.log, 'startJob').length, 0);
});

test('Claude Code missing, or not signed in, shows the error with Open Settings, and nothing starts', async () => {
  for (const [claude, codeWord, text] of [
    [{ installed: false, loggedIn: false }, 'no_claude', "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings."],
    [{ installed: true, loggedIn: false }, 'claude_signed_out', "Claude Code isn't signed in. Open a terminal, run claude, and sign in."],
  ]) {
    const s = setup({ projects: [APP_DIR], claude, answers: [code()] });
    await s.actions.open();
    await s.actions.send('fix the bug');
    assert.deepStrictEqual(lastItem(s), { id: 3, type: 'error', text, code: codeWord, buttons: ['settings'] }, codeWord);
    assert.strictEqual(entries(s.log, 'startJob').length, 0);
    assert.deepStrictEqual(moods(s.log), ['thinking', 'idle']);
  }
});

test('a "code" answer with no project folder says to add one in Settings', async () => {
  const s = setup({ answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  assert.deepStrictEqual(lastItem(s), { id: 3, type: 'error', text: 'Add a project folder in Settings → Claude Code first.', code: 'no_project', buttons: ['settings'] });
  await s.actions.act(3, 'settings');
  assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['openSettings', 'claude']]);
});

test('a job that cannot start shows why', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()], startFails: failure('no_claude', 'Claude Code isn\'t installed on this computer. Install it, or pick another AI in Settings.') });
  await s.actions.open();
  await s.actions.send('fix the bug');
  assert.deepStrictEqual(lastItem(s).type, 'error');
  assert.strictEqual(jobItem(s), undefined, 'no job item is left behind');
});

test('one job at a time: a second "code" answer is told to stop the first', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code(), code({ say: 'Sure.' })] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  await s.actions.send('add dark mode');
  assert.deepStrictEqual(lastItem(s), { id: 6, type: 'buddy', say: "I'm still working in my-app. Stop it first.", text: '', notes: [], buttons: [] });
  assert.strictEqual(entries(s.log, 'startJob').length, 1);
});

test('live lines: the newest six are kept, and the buddy keeps thinking', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  for (let i = 1; i <= 7; i += 1) play(s, { type: 'line', text: `Reading ${i}.js` });
  assert.deepStrictEqual(jobItem(s).lines, ['Reading 2.js', 'Reading 3.js', 'Reading 4.js', 'Reading 5.js', 'Reading 6.js', 'Reading 7.js']);
  assert.deepStrictEqual(entries(s.log, 'state').at(-1)[1].chat.at(-1).lines.length, 6);
  assert.strictEqual(moods(s.log).at(-1), 'thinking');
});

test('a message sent during a job is answered as usual, and the next live line has the buddy think again', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code(), reply({ kind: 'answer', text: 'It means leave.' })] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  await s.actions.send('what does chutti mean?');
  assert.deepStrictEqual(lastItem(s), { id: 6, type: 'buddy', say: '', text: 'It means leave.', notes: [], buttons: ['copy'] });
  assert.strictEqual(moods(s.log).at(-1), 'happy');
  play(s, { type: 'line', text: 'Editing src/login.js' });
  assert.strictEqual(moods(s.log).at(-1), 'thinking');
});

test('a permission question: Allow and No go to the job, and the chat says what was answered', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  play(s, { type: 'ask', requestId: 'r1', text: 'Run npm test?', what: 'npm test' });
  play(s, { type: 'ask', requestId: 'r2', text: 'Use WebFetch?', what: 'WebFetch' });
  assert.deepStrictEqual(chatOf(s).slice(-2), [
    { id: 5, type: 'question', text: 'Run npm test?', buttons: ['allow', 'deny'] },
    { id: 6, type: 'question', text: 'Use WebFetch?', buttons: ['allow', 'deny'] },
  ]);
  await s.actions.act(5, 'allow');
  await s.actions.act(6, 'deny');
  assert.deepStrictEqual(s.started[0].handle.answers, [['r1', true], ['r2', false]]);
  assert.deepStrictEqual(chatOf(s).slice(-2), [
    { id: 5, type: 'event', text: '✅ Allowed: npm test', buttons: [] },
    { id: 6, type: 'event', text: '🚫 Said no to: WebFetch', buttons: [] },
  ]);
  await assert.rejects(s.actions.act(5, 'allow'), { code: 'bad_request' });
});

test('a question with the panel hidden shows in the bubble; one left open for 10 minutes says the job said no', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  s.blur();
  play(s, { type: 'ask', requestId: 'r1', text: 'Run npm test?', what: 'npm test' });
  assert.deepStrictEqual(entries(s.log, 'bubble').at(-1), ['bubble', 'Run npm test? Open me to answer.']);
  play(s, { type: 'expired', requestId: 'r1' });
  assert.deepStrictEqual(lastItem(s), { id: 5, type: 'event', text: 'No answer for 10 minutes, so I said no.', buttons: [] });
});

test('done: the summary with Open folder and Copy, "Done in my-app", the buddy happy, and the bubble when the panel is hidden', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  play(s, { type: 'line', text: 'Editing src/login.js' });
  play(s, { type: 'done', text: 'I fixed the null check in login.js. The tests pass.' });
  assert.deepStrictEqual(chatOf(s).slice(3), [
    { id: 4, type: 'job', project: 'my-app', lines: ['Editing src/login.js'], done: true, text: 'I fixed the null check in login.js. The tests pass.', buttons: ['open-folder', 'copy'] },
    { id: 5, type: 'event', text: '✅ Done in my-app', buttons: [] },
  ]);
  assert.strictEqual(moods(s.log).at(-1), 'happy');
  assert.strictEqual(entries(s.log, 'bubble').length, 0, 'the panel is open: no bubble');
  await s.actions.act(4, 'copy');
  assert.strictEqual(s.clipboard.text, 'I fixed the null check in login.js. The tests pass.');
  await s.actions.act(4, 'open-folder');
  assert.deepStrictEqual(entries(s.log, 'openFolder'), [['openFolder', APP_DIR.path]]);

  const hidden = setup({ projects: [APP_DIR], answers: [code()] });
  await hidden.actions.open();
  await hidden.actions.send('fix the bug');
  hidden.blur();
  play(hidden, { type: 'done', text: 'Done.' });
  assert.deepStrictEqual(entries(hidden.log, 'bubble').at(-1), ['bubble', 'Done in my-app ✅']);
});

test('Stop: the job gets stop(), and when the process has gone the item says so', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code(), code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  play(s, { type: 'ask', requestId: 'r1', text: 'Run npm test?', what: 'npm test' });
  await s.actions.act(4, 'stop');
  assert.strictEqual(s.started[0].handle.stops, 1);
  assert.deepStrictEqual(jobItem(s).buttons, []);
  play(s, { type: 'stopped' });
  assert.deepStrictEqual(chatOf(s).slice(3), [
    { id: 4, type: 'job', project: 'my-app', lines: [], done: true, text: 'Stopped.', buttons: [] },
    { id: 5, type: 'event', text: 'Not needed any more.', buttons: [] },
    { id: 6, type: 'event', text: '⏹ Stopped', buttons: [] },
  ]);
  assert.strictEqual(moods(s.log).at(-1), 'idle');
  // The next "code" answer may start a job again.
  s.log.length = 0;
  await s.actions.send('try again');
  assert.strictEqual(entries(s.log, 'startJob').length, 1);
});

test('a job that fails: the red line with Try again, which runs the same task again; the buddy is sad for a while', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  play(s, { type: 'failed', code: 'claude_failed', message: "Claude Code couldn't finish in my-app." });
  assert.deepStrictEqual(chatOf(s).slice(3), [
    { id: 4, type: 'job', project: 'my-app', lines: [], done: true, text: '', buttons: [] },
    { id: 5, type: 'error', text: "Claude Code couldn't finish in my-app.", code: 'claude_failed', buttons: ['retry'] },
  ]);
  assert.deepStrictEqual(moods(s.log).slice(-1), ['sleepy']);
  assert.strictEqual(s.timers.at(-1).ms, 5000);
  s.timers.at(-1).fn();
  assert.strictEqual(moods(s.log).at(-1), 'idle');
  await s.actions.act(5, 'retry');
  assert.deepStrictEqual(chatOf(s).slice(4), [
    { id: 6, type: 'event', text: '🔧 Started in my-app', buttons: [] },
    { id: 7, type: 'job', project: 'my-app', lines: [], done: false, text: '', buttons: ['stop'] },
  ]);
  assert.deepStrictEqual(entries(s.log, 'startJob').map((e) => e[1].task), ['Fix the login bug in src/login.js.', 'Fix the login bug in src/login.js.']);
});

test('the limit, signed out and "too long" lines: Open Settings for the first two, nothing to press for the last', async () => {
  for (const [codeWord, message, buttons] of [
    ['claude_limit', 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.', ['settings']],
    ['claude_signed_out', "Claude Code isn't signed in. Open a terminal, run claude, and sign in.", ['settings']],
    ['too_long', 'That took too long, so I stopped it.', []],
  ]) {
    const s = setup({ projects: [APP_DIR], answers: [code()] });
    await s.actions.open();
    await s.actions.send('fix the bug');
    s.blur();
    play(s, { type: 'failed', code: codeWord, message });
    assert.deepStrictEqual(lastItem(s), { id: 5, type: 'error', text: message, code: codeWord, buttons }, codeWord);
    assert.deepStrictEqual(entries(s.log, 'bubble').at(-1), ['bubble', message], codeWord);
  }
});

test('the job goes on when the chat is closed: its end only shows in the bubble, and leaves the new chat alone', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  await s.actions.dismiss();
  assert.strictEqual(moods(s.log).at(-1), 'idle');
  await s.actions.open();
  s.log.length = 0;
  play(s, { type: 'line', text: 'Editing x' });
  play(s, { type: 'done', text: 'Done.' });
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', 'Done in my-app ✅']]);
  assert.deepStrictEqual(moods(s.log), []);
  assert.deepStrictEqual(chatOf(s), []);
});

test('the panel only hid: opened again within 5 minutes, the same chat shows the job', async () => {
  const s = setup({ projects: [APP_DIR], answers: [code()] });
  await s.actions.open();
  await s.actions.send('fix the bug');
  s.blur();
  play(s, { type: 'line', text: 'Reading a.js' });
  await s.actions.open();
  assert.strictEqual(s.actions.state().resumed, true);
  assert.deepStrictEqual(jobItem(s).lines, ['Reading a.js']);
});
```
- [ ] Run: `node --test test/actions.test.js` → the new tests fail (`projects` never sent, no `exampleProject`, a `code`
  answer shown as a written text, `act` refusing the new buttons).
- [ ] Implement, new lines only. At the top, after line 24 (`const platform = require('./platform');`):

```js
const { ERRORS: CLAUDE_ERRORS } = require('./claude/job');
```
  After line 51 (`PERMISSION_ERRORS`):

```js
// A Claude Code job (src/main/claude/job.js) in the chat: how many of its live lines are kept, and the lines the chat
// shows for a question it answered itself, a question that is over, and no project folder yet.
const LIVE_LINES = 6;
const NO_ANSWER = 'No answer for 10 minutes, so I said no.';
const QUESTION_OVER = 'Not needed any more.';
const NO_PROJECT = 'Add a project folder in Settings → Claude Code first.';
```
  In `sectionFor`, after line 55 (`if (AI_ERRORS...`): `if (code === 'no_project') return 'claude';`.
  In `SHOWN`, after line 68 (`question`): `job: ['project', 'lines', 'done', 'text', 'buttons'],`.
  In the doc comment above `createActions` (new line before ` */`): ` * \`jobs\` runs Claude Code in the person's project folders (claude/job.js createJobs); none means no jobs.`
  In the parameters, after `voice = () => ({}),`: `jobs = null,`.
  After line 106 (`let sleepy = null;`): `let job = null; // the Claude Code job under way, if any: { handle, project, item, chat }`.
  In `stateOf`, after `voice: voiceState(),`: `exampleProject: exampleProject(),`.
  In `answer()`, after line 357 (`const asked = ...`):
  `if (jobs?.projects().length) asked.projects = jobs.projects().map((p) => p.name); // only when there are any`.
  In `finish()`, as its first line (after line 433): `if (reply.kind === 'code') return startCode(c, reply);`.
  In `act()`, immediately before line 664 `} else if (button === 'retry') {`, these branches:

```js
    } else if (button === 'stop') {
      // The job's item alone has Stop. The process is told; the item ends when it has gone (the `stopped` event).
      item.buttons = [];
      if (job?.item === item) job.handle.stop();
      push(c);
    } else if (button === 'allow' || button === 'deny') {
      const taken = Boolean(job && job.handle.answer(item.requestId, button === 'allow'));
      const said = button === 'allow' ? `✅ Allowed: ${item.what}` : `🚫 Said no to: ${item.what}`;
      swap(c, item, { type: 'event', text: taken ? said : QUESTION_OVER, buttons: [] });
      push(c);
    } else if (button === 'open-folder') {
      await ui.openFolder(item.path);
    } else if (button.startsWith('project:')) {
      // The pick on "Which project?": the folder must still be there.
      const project = jobs.projects().find((p) => `project:${p.path}` === button);
      if (!project) {
        swap(c, item, { type: 'error', text: "That folder isn't there any more.", code: 'no_project', buttons: ['settings'] });
      } else {
        swap(c, item, { type: 'event', text: `📁 ${project.name}`, buttons: [] });
        runJob(c, project, item.task);
      }
      push(c);
    } else if (button === 'not-now' && item.task !== undefined) {
      swap(c, item, { type: 'event', text: 'Okay, not now.', buttons: [] });
      push(c);
    } else if (button === 'retry' && item.task !== undefined) {
      // The same job again, in place of the red line, in the same folder if it is still there.
      if (job) throw new BuddyError('bad_request', `I'm still working in ${job.project.name}. Stop it first.`);
      const project = jobs.projects().find((p) => p.path === item.path);
      c.items.splice(c.items.indexOf(item), 1);
      if (project) runJob(c, project, item.task);
      else add(c, { type: 'error', text: "That folder isn't there any more.", code: 'no_project', buttons: ['settings'] });
      push(c);
```
  (`button` is a string here: `item.buttons.includes(button)` passed above.) Before `return { open, toggle, ...` (line
  705), the new functions:

```js
  // ---- Claude Code jobs ----

  /** The name for the empty chat's example line: the last project, else the first, else none. */
  function exampleProject() {
    if (!jobs) return '';
    const project = jobs.lastProject() || jobs.projects()[0];
    return project ? project.name : '';
  }

  /** The person's last message in the chat, for the project named in it. */
  const lastYou = (c) => c.items.findLast((i) => i.type === 'you')?.text || '';

  /** The chat says why the job cannot start, in a red line whose fix is in Settings. */
  function inSettings(c, code, text) {
    add(c, { type: 'error', text, code, buttons: ['settings'] });
    return false;
  }

  /**
   * Which project a job goes to: the only one; the one named in the message (any case, the longest name when two
   * match); the last pick; or null, and then the chat asks.
   */
  function pickProject(projects, c) {
    if (projects.length === 1) return projects[0];
    const message = lastYou(c).toLowerCase();
    const named = projects.filter((p) => message.includes(p.name.toLowerCase())).sort((a, b) => b.name.length - a.name.length);
    return named[0] || jobs.lastProject();
  }

  /**
   * A "code" answer: the job goes to Claude Code in one of the person's project folders, once it is clear which. Claude
   * Code must be there and signed in, whichever brain answered the chat: it is the one with the tools. One job at a time.
   */
  async function startCode(c, reply) {
    if (job) {
      add(c, { type: 'buddy', say: `I'm still working in ${job.project.name}. Stop it first.`, text: '', notes: [], buttons: [] });
      return true;
    }
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    if (!jobs) return inSettings(c, 'no_project', NO_PROJECT);
    const status = await jobs.status();
    if (c !== chat) return false;
    if (!status.installed) return inSettings(c, 'no_claude', CLAUDE_ERRORS.no_claude);
    if (!status.loggedIn) return inSettings(c, 'claude_signed_out', CLAUDE_ERRORS.claude_signed_out);
    const projects = jobs.projects();
    if (!projects.length) return inSettings(c, 'no_project', NO_PROJECT);
    const task = reply.text || lastYou(c);
    const project = pickProject(projects, c);
    if (!project) {
      add(c, { type: 'question', text: 'Which project?', buttons: [...projects.map((p) => `project:${p.path}`), 'not-now'], task });
      return true;
    }
    runJob(c, project, task);
    return true;
  }

  /** The buddy is sad for a while (sleepy, until the feelings PR), then idle again: a job that failed. */
  function sadForAWhile() {
    if (sleepy !== null) cancelLater(sleepy);
    ui.mood('sleepy');
    sleepy = later(() => {
      sleepy = null;
      ui.mood('idle');
    }, SLEEPY_MS);
  }

  /**
   * Start the job in `project`: "Started", the job's item (with Stop), the buddy thinking until it ends. The item keeps
   * the task and the folder, so that Try again on a failure can run the same job again.
   */
  function runJob(c, project, task) {
    jobs.setLastProject(project.path);
    add(c, { type: 'event', text: `🔧 Started in ${project.name}`, buttons: [] });
    const item = add(c, { type: 'job', project: project.name, lines: [], done: false, text: '', buttons: ['stop'], task, path: project.path });
    let handle;
    try {
      handle = jobs.start({
        project, task, person: firstName(), model: store.get('models')?.['claude-code'],
        onEvent: (event) => onJobEvent(c, item, project, task, event),
      });
    } catch (err) {
      c.items.splice(c.items.indexOf(item), 1);
      failed(c, err);
      push(c);
      return;
    }
    job = { handle, project, item, chat: c };
    if (sleepy !== null) {
      cancelLater(sleepy);
      sleepy = null;
    }
    c.talking += 1;
    ui.mood('thinking');
    push(c);
  }

  /**
   * What the job reports (claude/job.js, J4) becomes the chat: live lines on its item, questions as question items,
   * and the end as the summary with Open folder and Copy, "Stopped", or a red line. The job goes on when the panel
   * hides or the chat is closed: its end then shows in the bubble, and a closed chat's end leaves the mood alone.
   */
  function onJobEvent(c, item, project, task, event) {
    const hidden = !ui.isPanelVisible() || c !== chat; // the panel is hidden, or shows another chat by now
    if (event.type === 'line') {
      item.lines = [...item.lines, event.text].slice(-LIVE_LINES);
      if (c === chat) ui.mood('thinking'); // an answer meanwhile may have left the buddy happy or idle
      push(c);
      return;
    }
    if (event.type === 'ask') {
      add(c, { type: 'question', text: event.text, buttons: ['allow', 'deny'], requestId: event.requestId, what: event.what });
      if (hidden) ui.bubble(`${event.text} Open me to answer.`);
      push(c);
      return;
    }
    if (event.type === 'expired') {
      const question = c.items.find((i) => i.type === 'question' && i.requestId === event.requestId);
      if (question) swap(c, question, { type: 'event', text: NO_ANSWER, buttons: [] });
      push(c);
      return;
    }
    // The end: done, failed or stopped. A question still open is over with it.
    job = null;
    c.talking -= 1;
    item.done = true;
    for (const i of c.items) if (i.type === 'question' && i.requestId) swap(c, i, { type: 'event', text: QUESTION_OVER, buttons: [] });
    if (event.type === 'done') {
      item.text = event.text;
      item.buttons = ['open-folder', 'copy'];
      add(c, { type: 'event', text: `✅ Done in ${project.name}`, buttons: [] });
      if (hidden) ui.bubble(`Done in ${project.name} ✅`);
      if (c === chat) ui.mood('happy');
    } else if (event.type === 'stopped') {
      item.text = 'Stopped.';
      item.buttons = [];
      add(c, { type: 'event', text: '⏹ Stopped', buttons: [] });
      if (c === chat) ui.mood('idle');
    } else {
      item.buttons = [];
      // Try again for a run that just failed; Settings for the limit and signed out; nothing for "too long".
      const buttons = event.code === 'claude_failed' ? ['retry'] : event.code === 'too_long' ? [] : ['settings'];
      add(c, { type: 'error', text: event.message, code: event.code, buttons, task, path: project.path });
      if (hidden) ui.bubble(event.message);
      if (c === chat) sadForAWhile();
    }
    push(c);
  }
```
  Note `swap` inside the `for` loop over `c.items`: `swap` replaces the entry at the same index, so the loop is safe.
- [ ] Run: `node --test test/actions.test.js` → pass. `npm test` → pass.
- [ ] Commit: `git add src/main/actions.js test/actions.test.js && git commit -m "Chat: a \"code\" answer becomes a Claude Code job in the person's project, with its live lines, questions, Stop and the summary (actions.js: new lines only)"`.

---

### Task 6: the panel page — the `job` item and the new buttons

**Files:** Modify `src/renderer/panel/chat-view.js` (LABELS lines 15–24, PRIMARY line 26, KINDS line 27, `buttonLabel`
lines 32–34, `itemParts` lines 60–76, `speaker` line 84, `spokenLine` lines 89–93), `src/renderer/panel/panel.js`
(`drawItem` lines 169–189, `render` line 137 for the example), `src/renderer/panel/index.html` line 22 (an empty span
for the example), `src/renderer/panel/panel.css` (new rules after line 132); Test `test/chat-view.test.js`.
(`src/renderer/panel/*` is buddy-26's: new functions and new lines where possible; `itemParts` and `drawItem` gain a
branch each.)

**Interfaces:** Consumes J5 (the `job` item, the buttons, `exampleProject`). Produces the drawing of them.

- [ ] Add the failing tests to `test/chat-view.test.js`:

```js
test('the job buttons have their labels, and a project button is named after its folder', () => {
  assert.deepStrictEqual(['stop', 'open-folder', 'allow', 'deny'].map(buttonLabel), ['Stop', 'Open folder', 'Allow', 'No']);
  assert.strictEqual(buttonLabel('project:/Users/me/code/my-app'), 'my-app');
  assert.strictEqual(buttonLabel('project:C:\\Users\\me\\code\\site\\'), 'site');
  assert.strictEqual(buttonLabel('project:'), '');
});

test("a job is drawn with its project, its live lines, whether it is done, its summary and its buttons", () => {
  const running = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Reading src/login.js', 'Running: npm test'], done: false, text: '', buttons: ['stop'] });
  assert.deepStrictEqual(running, {
    id: 5, kind: 'job', say: '', text: '', notes: [], project: 'my-app', lines: ['Reading src/login.js', 'Running: npm test'], done: false,
    buttons: [{ button: 'stop', label: 'Stop', primary: false }],
  });
  const done = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: true, text: 'I fixed it.', buttons: ['open-folder', 'copy'] });
  assert.deepStrictEqual(done.buttons, [{ button: 'open-folder', label: 'Open folder', primary: true }, { button: 'copy', label: 'Copy', primary: false }]);
  assert.deepStrictEqual([done.done, done.text, done.lines], [true, 'I fixed it.', []]);
  // A job with nothing yet is still drawn: its project is its heading.
  assert.deepStrictEqual(itemParts({ id: 6, type: 'job', project: 'site', lines: [], done: false, text: '', buttons: [] }).project, 'site');
  // Odd fields read as nothing.
  const odd = itemParts({ id: 7, type: 'job', project: 7, lines: ['ok', 3, ''], done: 'yes', text: null, buttons: ['stop', 'nope'] });
  assert.deepStrictEqual([odd.project, odd.lines, odd.done, odd.text, odd.buttons.map((b) => b.button)], ['', ['ok'], false, '', ['stop']]);
});

test('the questions a job asks are drawn as questions, with Allow as the main button', () => {
  const parts = itemParts({ id: 8, type: 'question', text: 'Run npm test?', buttons: ['allow', 'deny'] });
  assert.deepStrictEqual(parts.buttons, [{ button: 'allow', label: 'Allow', primary: true }, { button: 'deny', label: 'No', primary: false }]);
  const which = itemParts({ id: 9, type: 'question', text: 'Which project?', buttons: ['project:/a/my-app', 'project:/b/site', 'not-now'] });
  assert.deepStrictEqual(which.buttons.map((b) => b.label), ['my-app', 'site', 'Not now']);
});

test('a screen reader hears a job as the buddy: what it is doing now, or what it did', () => {
  assert.strictEqual(speaker('job', 'Aarav'), 'Aarav:');
  const running = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Reading a.js', 'Editing a.js'], done: false, text: '', buttons: ['stop'] });
  assert.strictEqual(spokenLine(running, 'Aarav'), 'Aarav: Working in my-app. Editing a.js');
  const started = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: false, text: '', buttons: ['stop'] });
  assert.strictEqual(spokenLine(started, 'Aarav'), 'Aarav: Working in my-app.');
  const done = itemParts({ id: 5, type: 'job', project: 'my-app', lines: ['Editing a.js'], done: true, text: 'I fixed it.', buttons: ['copy'] });
  assert.strictEqual(spokenLine(done, 'Aarav'), 'Aarav: Done in my-app. I fixed it.');
  const stopped = itemParts({ id: 5, type: 'job', project: 'my-app', lines: [], done: true, text: 'Stopped.', buttons: [] });
  assert.strictEqual(spokenLine(stopped, 'Aarav'), 'Aarav: Stopped.');
});

test('the example line for the empty chat names the project when there is one', () => {
  assert.strictEqual(exampleLine('my-app'), '“fix the login bug in my-app”');
  assert.strictEqual(exampleLine(''), '');
  assert.strictEqual(exampleLine(undefined), '');
});
```
  Add `exampleLine` to the test's `require`.
- [ ] Run: `node --test test/chat-view.test.js` → fails (`buttonLabel('stop')` is `''`, `job` not drawn, `exampleLine` missing).
- [ ] Implement in `chat-view.js`:
  - LABELS gains `stop: 'Stop', 'open-folder': 'Open folder', allow: 'Allow', deny: 'No',`.
  - `const PRIMARY = ['insert', 'replace', 'send', 'allow', 'open-folder'];` and `KINDS` gains `'job'`.
  - `const PROJECT_BUTTON = 'project:';` and `buttonLabel`:
    ```js
    function buttonLabel(button) {
      // The pick on "Which project?" is named after its folder: the last part of the path, Mac or Windows.
      if (typeof button === 'string' && button.startsWith(PROJECT_BUTTON)) {
        return button.slice(PROJECT_BUTTON.length).split(/[\\/]/).filter(Boolean).pop() || '';
      }
      return Object.hasOwn(LABELS, button) ? LABELS[button] : '';
    }
    ```
  - In `itemParts`, after `parts` is built and before the "nothing to show" check:
    ```js
    if (item.type === 'job') {
      // A Claude Code job: where it works, what it is doing now (the newest lines), and once done, what it did.
      Object.assign(parts, {
        project: text(item.project),
        lines: Array.isArray(item.lines) ? item.lines.filter((line) => text(line) !== '') : [],
        done: item.done === true,
      });
      return parts;
    }
    ```
  - `speaker`: `job` joins `buddy`, `error`, `question`.
  - `spokenLine`:
    ```js
    function spokenLine(parts, buddyName) {
      const words = parts.kind === 'job' ? jobWords(parts) : [parts.say, parts.text, ...parts.notes].filter(Boolean).join(' ');
      ...
    }
    /** A job for a screen reader: where it works and its newest line, or that it is done (or stopped) and its summary. */
    function jobWords(parts) {
      if (!parts.done) return [`Working in ${parts.project}.`, parts.lines.at(-1)].filter(Boolean).join(' ');
      return parts.text === 'Stopped.' ? 'Stopped.' : [`Done in ${parts.project}.`, parts.text].filter(Boolean).join(' ');
    }
    /** The empty chat's example for a job, when the person has a project; '' when they have none. */
    function exampleLine(project) {
      return text(project) ? `“fix the login bug in ${project}”` : '';
    }
    ```
    Export `exampleLine`.
- [ ] `index.html` line 22: add ` <span id="example-code" hidden></span>` inside the `.examples` paragraph, after the
  last example: `… <span>“what does this mean?”</span> <span id="example-sep" hidden>·</span> <span id="example-code" hidden></span>`.
- [ ] `panel.js`: add `exampleLine` to the destructuring of `ChatView` (line 17); in `render()` after the greeting line:
  ```js
  const example = exampleLine(s.exampleProject);
  $('example-code').textContent = example;
  show($('example-code'), Boolean(example));
  show($('example-sep'), Boolean(example));
  ```
  In `drawItem`, before `const bubble = make('div', 'bubble');`, the job branch:
  ```js
  if (parts.kind === 'job') {
    // A Claude Code job: a bubble on the buddy's side with where it works, its newest lines while it runs (a small
    // spinner beside the last one), and its summary once it is done.
    const bubble = make('div', 'bubble');
    bubble.append(make('span', 'visually-hidden', `${speaker(parts.kind, buddyName)} `));
    bubble.append(make('p', 'say', parts.done ? (parts.text === 'Stopped.' ? `⏹ Stopped in ${parts.project}` : `✅ Done in ${parts.project}`) : `🔧 Working in ${parts.project}`));
    if (parts.lines.length) {
      const lines = make('ul', `lines${parts.done ? '' : ' live'}`);
      lines.append(...parts.lines.map((line) => make('li', '', line)));
      bubble.append(lines);
    }
    if (parts.done && parts.text) bubble.append(make('p', 'text', parts.text));
    if (parts.buttons.length) bubble.append(drawButtons(parts));
    li.append(bubble);
    return li;
  }
  ```
- [ ] `panel.css`, after the `.event` rules (line 132):
  ```css
  /* A Claude Code job: its newest lines, small and grey, the last one with the spinner while it runs; then the summary. */
  .job .lines { margin: 6px 0 0; padding: 0; list-style: none; color: var(--muted); font-size: 12px; line-height: 1.4; }
  .job .lines li { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .job .lines.live li:last-child { display: flex; align-items: center; gap: 6px; color: var(--fg); }
  .job .lines.live li:last-child::after {
    content: "";
    flex: none;
    width: 10px;
    height: 10px;
    border: 1.5px solid var(--track);
    border-top-color: var(--accent);
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  .job .say + .text { margin-top: 6px; padding: 7px 10px; border: 1px solid var(--line-soft); border-radius: 8px; background: var(--card); }
  ```
- [ ] Look at it once in the running app with a fake answer is not possible without the job; the e2e (Task 10) reads
  the page's text. `npm test` → pass.
- [ ] Commit: `git add src/renderer/panel test/chat-view.test.js && git commit -m "Panel: a Claude Code job in the chat, its live lines, Stop, Allow and No, Open folder, and the example line"`.

---

### Task 7: the IPC and the preload — the projects list

**Files:** Modify `src/main/ipc/claude.js` (the parameter list line 15, the header comment's channel list lines
8–11, three new `handle` calls before `return {};`), `src/preload/settings.js` (three new lines after line 37);
Test `test/claude-ipc.test.js`.

**Interfaces:** Consumes J1 (`projects`, a fake here), Electron's `dialog.showOpenDialog`. Produces J2.

- [ ] In `harness()` add, before `registerClaudeIpc({`:
  ```js
  const list = [{ path: '/Users/me/code/my-app', name: 'my-app', found: true }];
  const projects = {
    list: () => list,
    add(p) {
      if (p === '/full') throw new BuddyError('bad_request', 'You can have 20 projects at most. Remove one first.');
      const project = { path: p, name: p.split('/').pop() };
      list.push({ ...project, found: true });
      return project;
    },
    remove: (p) => { const at = list.findIndex((x) => x.path === p); if (at >= 0) list.splice(at, 1); return at >= 0; },
  };
  const dialog = { picks: ['/Users/me/code/site'], async showOpenDialog(options) { opened.push(options); const p = this.picks.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; } };
  ```
  pass `projects, dialog,` into `registerClaudeIpc`, and return `projects, dialog, list` too. Add
  `const { BuddyError } = require('../shared/errors');` at the top.
- [ ] Add the tests:
  ```js
  test('claude:projects lists the folders with whether each is there', async () => {
    const { handlers, list } = harness();
    assert.deepEqual(await handlers['claude:projects'](), { ok: true, projects: list });
  });

  test('claude:add-project opens the folder picker and adds the pick; cancelled adds nothing', async () => {
    const { handlers, opened, list, dialog } = harness();
    const r = await handlers['claude:add-project']();
    assert.deepEqual(opened.at(-1), { title: 'Add a project folder', properties: ['openDirectory'] });
    assert.deepEqual(r, { ok: true, projects: list, added: { path: '/Users/me/code/site', name: 'site' } });
    assert.equal(list.length, 2);
    dialog.picks = [];
    assert.deepEqual(await handlers['claude:add-project'](), { ok: true, projects: list, added: null });
  });

  test('claude:add-project passes on a refusal (21 folders) in its words', async () => {
    const { handlers, dialog } = harness();
    dialog.picks = ['/full'];
    const r = await handlers['claude:add-project']();
    assert.deepEqual(r, { ok: false, error: { code: 'bad_request', message: 'You can have 20 projects at most. Remove one first.' } });
  });

  test('claude:remove-project takes a folder out and answers the list', async () => {
    const { handlers, list } = harness();
    assert.deepEqual(await handlers['claude:remove-project']('/Users/me/code/my-app'), { ok: true, projects: list });
    assert.equal(list.length, 0);
    assert.deepEqual(await handlers['claude:remove-project'](42), { ok: true, projects: list }, 'not a path: nothing happens');
  });

  test('the project calls are only for allowed windows', async () => {
    const { handlers } = harness({ allowed: () => false });
    for (const channel of ['claude:projects', 'claude:add-project', 'claude:remove-project']) {
      assert.equal((await handlers[channel]()).error.code, 'not_allowed', channel);
    }
  });
  ```
- [ ] Run: `node --test test/claude-ipc.test.js` → fails (`handlers['claude:projects']` is not a function).
- [ ] Implement in `src/main/ipc/claude.js`: the parameter list becomes
  `function registerClaudeIpc({ ipcMain, allowed, find, openExternal, projects, dialog }) {`; the header comment gains
  ```
   *   claude:projects         -> { projects }: the folders Claude Code may work in (src/main/claude/projects.js), each with `found`
   *   claude:add-project      -> { projects, added }: the system's folder picker, then the folder added (added: null when cancelled)
   *   claude:remove-project   -> { projects }: the folder taken out
  ```
  and before `return {};`:
  ```js
  // Settings → Claude Code → My projects: the folders Buddy may run Claude Code in.
  handle('claude:projects', () => ({ projects: projects.list() }));

  handle('claude:add-project', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Add a project folder', properties: ['openDirectory'] });
    const added = canceled || !filePaths?.length ? null : projects.add(filePaths[0]);
    return { projects: projects.list(), added };
  });

  handle('claude:remove-project', (folder) => {
    if (typeof folder === 'string') projects.remove(folder);
    return { projects: projects.list() };
  });
  ```
  `src/preload/settings.js`, after line 37 (`claudeGet`):
  ```js
  claudeProjects: () => ipcRenderer.invoke('claude:projects'),
  addProject: () => ipcRenderer.invoke('claude:add-project'),
  removeProject: (path) => ipcRenderer.invoke('claude:remove-project', path),
  ```
- [ ] Run → pass. `npm test` → pass.
- [ ] Commit: `git add src/main/ipc/claude.js src/preload/settings.js test/claude-ipc.test.js && git commit -m "Claude Code projects: list, add (the folder picker) and remove over IPC"`.

---

### Task 8: Settings → Claude Code → My projects (new lines only)

**Files:** Modify `src/renderer/settings/index.html` (a block inside `<section id="section-claude">`, after line 82),
`src/renderer/settings/settings.js` (new functions after `renderClaude`'s handlers, line 97; one new line in the load
IIFE after line 622 `await renderClaude();`), `src/renderer/settings/settings.css` (new rules after line 179). No unit
test runs the page (as for Memory); the e2e in Task 10 reads it. Check it by hand: `npm start`, Settings → Claude Code.

**Interfaces:** Consumes J2 (`claudeProjects`, `addProject`, `removeProject`). Produces the block the spec §2 names.

- [ ] `index.html`, after line 82 (the status row), inside the section:
  ```html
      <div id="claude-projects">
        <p class="row-title">My projects</p>
        <p class="muted small">Buddy only runs Claude Code inside these folders.</p>
        <ul id="project-list" class="group facts projects" aria-label="My projects" hidden></ul>
        <p id="project-empty" class="group facts-empty muted" hidden>No folders yet. Add the folder of a project you work on.</p>
        <div class="row">
          <button id="project-add" class="btn" type="button">Add a folder</button>
        </div>
        <p id="project-status" class="status small" aria-live="polite"></p>
      </div>
  ```
- [ ] `settings.js`, after line 97 (the end of the `claude-get` handler):
  ```js
  // ---- Claude Code's projects ----

  /** Settings → Claude Code → My projects: each folder a row with its name, its path and ✕; "(not found)" when it is gone. */
  function renderProjects(projects) {
    const focused = document.activeElement?.closest('#project-list li')?.dataset.path;
    $('project-list').replaceChildren(...projects.map(projectRow));
    if (focused) [...$('project-list').children].find((li) => li.dataset.path === focused)?.querySelector('button').focus();
    $('project-list').hidden = !projects.length;
    $('project-empty').hidden = projects.length > 0;
  }

  function projectRow(project) {
    const words = Object.assign(document.createElement('div'), { className: 'fact grow' });
    const name = Object.assign(document.createElement('p'), { className: 'row-title', textContent: project.name });
    if (!project.found) name.append(Object.assign(document.createElement('span'), { className: 'muted', textContent: ' (not found)' }));
    const where = Object.assign(document.createElement('p'), { className: 'muted small path', textContent: project.path, title: project.path });
    words.append(name, where);
    const remove = Object.assign(document.createElement('button'), {
      type: 'button', className: 'btn quiet small forget', textContent: '✕', title: 'Remove this folder',
    });
    remove.setAttribute('aria-label', `Remove ${project.name}`);
    remove.addEventListener('click', () => removeProject(project.path));
    const row = Object.assign(document.createElement('li'), { className: 'group-row' });
    row.dataset.path = project.path;
    row.append(words, remove);
    return row;
  }

  async function loadProjects() {
    const r = await window.buddy.claudeProjects();
    if (r.ok) renderProjects(r.projects);
    else showStatus('project-status', r.error.message, 'error');
  }

  async function removeProject(folder) {
    const rows = [...$('project-list').children];
    const at = rows.findIndex((li) => li.dataset.path === folder);
    const r = await window.buddy.removeProject(folder);
    if (!r.ok) {
      showStatus('project-status', r.error.message, 'error');
      return;
    }
    showStatus('project-status', '');
    renderProjects(r.projects);
    // The ✕ that was clicked is gone: the keyboard focus moves to the ✕ now in its place, or to Add a folder.
    const left = $('project-list').querySelectorAll('.forget');
    (left[Math.min(at, left.length - 1)] || $('project-add')).focus();
  }

  $('project-add').addEventListener('click', async () => {
    $('project-add').disabled = true; // one picker at a time
    let r;
    try {
      r = await window.buddy.addProject();
    } finally {
      $('project-add').disabled = false;
    }
    if (!r.ok) {
      showStatus('project-status', r.error.message, 'error');
      return;
    }
    renderProjects(r.projects);
    showStatus('project-status', r.added ? `Added ${r.added.name} ✓` : '', 'good');
  });
  ```
  In the load IIFE, after line 622 `await renderClaude();`: `await loadProjects();`.
- [ ] `settings.css`, after line 179:
  ```css
  /* Claude Code → My projects: the name, then the path small and cut short, with ✕ as in Memory. */
  .projects .path { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .projects .row-title { margin: 0; }
  ```
- [ ] `npm test` (ESLint passes on the page). Run `npm start`, open Settings → Claude Code: Add a folder opens the
  picker; the row shows the name and the path; ✕ removes it; a renamed folder shows "(not found)".
- [ ] Commit: `git add src/renderer/settings && git commit -m "Settings → Claude Code: My projects, with Add a folder and ✕ (settings pages: new lines only)"`.

---

### Task 9: the wiring in `src/main/main.js` (new lines only)

**Files:** Modify `src/main/main.js`: two requires after line 41, `projects` and `jobs` after line 89, `openFolder` in
`ui` (after line 158, before the closing `};`), `jobs` passed into `createActions` (a new line after line 181 `ui,`),
`projects` and `dialog` on the `registerClaudeIpc` call (line 276 is one line: add the two named arguments to it — the
one change to an existing line this task makes, the same way the watch piece adds `watch` to it), and `projects`, `jobs` and `find` in
the returned object (line 324: three more names in the list). Test: `npm test` and `npm start`.

**Interfaces:** Consumes J1, J4, J2. Produces the running app: the chat with jobs, Settings with projects.

- [ ] After line 41 (`const { createFind } = require('./claude/find');`):
  ```js
  const { createProjects } = require('./claude/projects');
  const { createJobs } = require('./claude/job');
  ```
- [ ] After line 89 (`const find = createFind();`):
  ```js
  // The folders Claude Code may work in (Settings → Claude Code), and the jobs the chat runs in them (claude/job.js).
  const projects = createProjects({ store });
  const jobs = createJobs({ find, projects });
  ```
- [ ] In `ui`, after `voiceLevel() {},` (line 158):
  ```js
  // Open folder on a finished job: the folder in the Finder (the Explorer on Windows).
  openFolder: (folder) => shell.openPath(folder),
  ```
- [ ] In `createActions({ ... })`, after `ui,` (line 181):
  ```js
    jobs, // Claude Code jobs in the person's projects
  ```
- [ ] Line 276: `registerClaudeIpc({ ipcMain, allowed: ..., find, openExternal: ..., projects, dialog });` (`dialog` is
  already imported from electron at line 13). If the watch piece has added `watch` there by now, keep it.
- [ ] The returned object (line 324) gains `projects, jobs, find` so the e2e can read them (`find`, to force its cached status).
- [ ] `npm test` → pass. `npm start` → the app runs; Settings → Claude Code shows My projects; in the panel, with a
  project added and Claude Code signed in, `fix the typo in the README in <name>` runs a job (a quick manual look; the
  full manual checks are Task 11).
- [ ] Commit: `git add src/main/main.js && git commit -m "Wire Claude Code jobs: projects, jobs into the chat, the folder picker and Open folder (main.js: new lines only)"`.

---

### Task 10: the end-to-end check with a fake `claude`

**Files:** Create `test/e2e/checks/49-claude-job.js`. `test/e2e/smoke.js`: no change (the check puts the fake on
PATH itself, as the brain's `48-claude-code.js` does; `createFind()` reads `process.env` live). Mac only (Windows has
no `sh`; the owner tests Windows by hand).

**Interfaces:** Consumes `ctx.actions`, `ctx.panel`, `ctx.windows`, `ctx.store`, `ctx.bubble`, `ctx.ai` as
`40-panel.js` uses them, `ctx.projects` (Task 9), `ASKS_PERMISSION` from `src/main/claude/job.js`. Produces the e2e
scene of spec §6: a project in Settings, "fix the bug in <name>", the live line, Allow (when the job asks), `✅ Done`,
Open folder, and Stop.

- [ ] Write the check:

```js
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASKS_PERMISSION } = require('../../../src/main/claude/job');

// A Claude Code job from the chat, with a fake `claude` on PATH in place of the real one: it answers `auth status` and
// `--version` as Claude Code does, and `-p` with the stream of a job (a tool use, a permission question when the job
// asks, a result). BUDDY_E2E_JOB=hang makes it wait forever (for Stop). The command is a shell script that runs this
// Electron as Node, so nothing has to be installed. Nothing is written in the project folder but what the check puts
// there. The chat's AI answer is the check's own (ctx.ai.ask), as 40-panel.js does.
const FAKE = `'use strict';
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.289 (Claude Code)\\n'); process.exit(0); }
if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'e2e@example.com', subscriptionType: 'max', configDirectory: '/tmp/e2e-claude' }) + '\\n');
  process.exit(0);
}
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const lines = readline.createInterface({ input: process.stdin });
lines.once('line', (first) => {
  const task = JSON.parse(first).message.content;
  say({ type: 'system', subtype: 'init', session_id: 'e2e', cwd: process.cwd(), model: args[args.indexOf('--model') + 1] });
  say({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'app.js' } }] } });
  if (process.env.BUDDY_E2E_JOB === 'hang') return; // Stop ends it
  const finish = () => {
    say({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } });
    say({ type: 'result', subtype: 'success', is_error: false, result: 'I fixed app.js for: ' + task + ' The tests pass.', session_id: 'e2e' });
    process.exit(0);
  };
  if (!args.includes('host')) return finish();
  say({ type: 'control_request', request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm test' } } });
  lines.once('line', (answer) => {
    const r = JSON.parse(answer);
    const allowed = (r.response?.response?.behavior || r.response?.behavior) === 'allow';
    if (allowed) finish();
    else { say({ type: 'result', subtype: 'success', is_error: false, result: 'I could not run the tests.', session_id: 'e2e' }); process.exit(0); }
  });
});
`;

module.exports = async function claudeJobCheck(ctx, { assert, waitFor }) {
  if (process.platform === 'win32') return;
  const userData = app.getPath('userData');
  const binDir = path.join(userData, 'fake-bin-job');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-claude-job.js'), FAKE);
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "${path.join(binDir, 'fake-claude-job.js')}" "$@"\n`, { mode: 0o755 });
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-app-')));
  const name = path.basename(project);
  fs.writeFileSync(path.join(project, 'app.js'), 'module.exports = 1;\n');
  const env = { PATH: process.env.PATH, BUDDY_E2E_JOB: process.env.BUDDY_E2E_JOB };
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  delete process.env.BUDDY_E2E_JOB;

  const reply = (fields) => ({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...fields });
  const answers = [];
  const asks = [];
  const { ask } = ctx.ai;
  ctx.ai.ask = async (action, input) => {
    asks.push({ action, input });
    const next = answers.shift();
    return { text: JSON.stringify(next), model: 'e2e-model', chat: next };
  };
  const chat = () => ctx.actions.state().chat;
  let panel = null;
  const page = (script) => panel.webContents.executeJavaScript(script);
  const pageShows = (text, what) => waitFor(async () => (await page('document.body.innerText')).includes(text), what);
  const bubbleSays = (text) => waitFor(async () => {
    const win = ctx.bubble.window();
    return Boolean(win?.isVisible()) && (await win.webContents.executeJavaScript("document.getElementById('text').textContent")) === text;
  }, `the bubble to say "${text}"`);
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
  }
  async function type(message) {
    await page(`(() => { const box = document.getElementById('box'); box.focus(); box.value = ${JSON.stringify(message)}; box.dispatchEvent(new Event('input')); })()`);
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  }
  const itemWith = (text) => `[...document.querySelectorAll('#items > li')].findLast((li) => li.innerText.includes(${JSON.stringify(text)}))`;
  async function click(text, label) {
    const clicked = await page(`(() => {
      const button = [...(${itemWith(text)})?.querySelectorAll('button') ?? []].find((b) => b.textContent === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.ok(clicked, `the chat shows ${label} on "${text}"`);
  }
  let settingsWindow = null;
  const openedFolders = [];
  const { openPath } = require('electron').shell;
  require('electron').shell.openPath = async (folder) => { openedFolders.push(folder); return ''; };

  try {
    await ctx.find.status({ force: true }); // not the brain check's cached answer
    // Settings → Claude Code lists the folder (added through the store: the system's folder picker cannot be driven
    // here; claude:add-project is covered by test/claude-ipc.test.js and the manual checklist), and ✕ removes it.
    ctx.store.set({ projects: [{ path: project, name }] });
    settingsWindow = ctx.windows.open('settings', { section: 'claude' });
    const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
    await waitFor(() => settingsPage("document.getElementById('project-list') !== null").catch(() => false), 'the Settings page to load');
    await waitFor(async () => (await settingsPage("document.getElementById('project-list').innerText")).includes(name), 'the folder to be listed');
    assert.ok((await settingsPage("document.getElementById('project-list').innerText")).includes(project), 'with its path');
    await settingsPage("document.querySelector('#project-list .forget').click()");
    await waitFor(() => settingsPage("!document.getElementById('project-empty').hidden"), 'the list to be empty after ✕');
    assert.deepStrictEqual(ctx.store.get('projects'), []);
    ctx.store.set({ projects: [{ path: project, name }] });
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;

    // The chat: the AI says "code", the request named the project, and the job runs with the fake claude.
    await openPanel();
    await pageShows(`“fix the login bug in ${name}”`, 'the example line with the project');
    answers.push(reply({ kind: 'code', say: 'On it!', text: 'Fix the bug in app.js.' }));
    await type(`fix the bug in ${name}`);
    assert.deepStrictEqual(asks.at(-1).input.projects, [name]);
    await pageShows(`🔧 Started in ${name}`, 'the job started');
    await pageShows('Reading app.js', 'the live line');
    if (ASKS_PERMISSION) {
      await pageShows('Run npm test?', 'the permission question');
      await click('Run npm test?', 'Allow');
      await pageShows('✅ Allowed: npm test', 'the answer');
    }
    await pageShows(`✅ Done in ${name}`, 'the job done');
    await pageShows('I fixed app.js for: Fix the bug in app.js. The tests pass.', 'the summary');
    const job = chat().find((item) => item.type === 'job');
    assert.deepStrictEqual([job.done, job.buttons, job.lines], [true, ['open-folder', 'copy'], ['Reading app.js', 'Running: npm test']]);
    await click('I fixed app.js', 'Open folder');
    await waitFor(() => openedFolders.length > 0, 'the folder to open');
    assert.deepStrictEqual(openedFolders, [project]);
    assert.strictEqual(ctx.store.get('lastProject'), project);

    // Stop: a job that never ends gets SIGTERM, and the chat says so. The panel is hidden meanwhile, so the bubble
    // speaks when the job ends.
    process.env.BUDDY_E2E_JOB = 'hang';
    answers.push(reply({ kind: 'code', say: 'Sure.', text: 'Add dark mode.' }));
    await type('add dark mode');
    await pageShows('🔧 Started in', 'the second job started');
    await pageShows('Reading app.js', 'its live line');
    delete process.env.BUDDY_E2E_JOB;
    await click(`Working in ${name}`, 'Stop');
    await pageShows('⏹ Stopped', 'the job stopped');
    assert.strictEqual(chat().findLast((item) => item.type === 'job').text, 'Stopped.');
  } finally {
    require('electron').shell.openPath = openPath;
    ctx.ai.ask = ask;
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    await ctx.actions.dismiss();
    ctx.store.set({ projects: [], lastProject: null });
    process.env.PATH = env.PATH;
    if (env.BUDDY_E2E_JOB === undefined) delete process.env.BUDDY_E2E_JOB;
    else process.env.BUDDY_E2E_JOB = env.BUDDY_E2E_JOB;
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
};
```
  Notes: `ctx.windows.open('settings', { section: 'claude' })` opens on the section (main.js's `openSettings` passes
  `{ section }` the same way). `find.status()` is cached 60 s and the brain's `48-claude-code.js` may have left its own
  fake's answer there: the check's first line in `try` forces it (`ctx.find`, Task 9). The project folder is its real
  path (`realpathSync`): on the Mac `os.tmpdir()` is a symlink, and the fake's `cwd` would otherwise not match it.
- [ ] Run: `npm run test:e2e` → `ok - 49-claude-job.js` with every other check still passing. (If `48-claude-code.js`
  from the brain piece is on the branch by then, both run; each restores PATH.)
- [ ] Commit: `git add test/e2e/checks/49-claude-job.js && git commit -m "e2e: a Claude Code job from the chat with a fake claude: the project in Settings, the live line, Allow, Done, Open folder, Stop"`.

---

### Task 11: the manual checklist, and the report

**Files:** Modify `docs/manual-checklist.md` (a new section after "Voice", lines 40–47; new lines only), this plan's
**Report** section.

- [ ] Add to `docs/manual-checklist.md`, after the Voice section:
  ```
  ## Claude Code does the job
  Run with the real Claude Code signed in (Max), on a small throwaway project with git and `npm test`.
  - [ ] Settings → Claude Code → Add a folder → the folder is listed with its name and path; ✕ removes it; a folder renamed on disk shows "(not found)".
  - [ ] With one project: `fix the typo in README.md` → "On it!", "🔧 Started in <name>", live lines (Reading…, Editing…), then "✅ Done in <name>" with a short summary, Open folder (opens the Finder) and Copy. The file is changed on disk.
  - [ ] With two projects and none named: "Which project?" with a button per project and Not now; the pick runs there, and the next job without a name goes to the same one.
  - [ ] `run the tests in <name>` → "Run npm test?" with Allow and No (if the plan's Task 2a was built) → Allow runs them; No → Claude Code's summary says it could not run them. (With Task 2b, `npm test` runs without a question and `rm` is never allowed.)
  - [ ] Stop during a long job → "⏹ Stopped" within 3 seconds, the files as they were at that moment.
  - [ ] Close the panel during a job and open it again within 5 minutes → the same chat with the job; let it finish with the panel hidden → the bubble says "Done in <name> ✅".
  - [ ] A message during a job (`what does chutti mean?`) is answered as usual; a second code job meanwhile gets "I'm still working in <name>. Stop it first."
  - [ ] Claude Code signed out (`claude /logout` in a terminal) → a code job shows "Claude Code isn't signed in…" with Open Settings and nothing starts.
  ```
- [ ] Fill the **Report** section below: which of 2a/2b was built and why (the spike's log in short, no project text),
  whether `--max-turns` is passed, what was impossible, and anything the sister pieces must know (the three places
  that both this plan and the watch plan touch: `store.js` DEFAULTS after `listenOnOpen`, the parameter list of
  `registerClaudeIpc`, the `registerClaudeIpc(...)` call in `main.js`).
- [ ] `npm test`, `npm run test:e2e`, commit: `git add docs/manual-checklist.md docs/superpowers/plans/2026-10-08-buddy-claude-code-drive.md && git commit -m "Docs: the manual checks for Claude Code jobs, and the plan's report"`.

## Merge (the coordinator)

After piece 1 and piece 3 are in `claude-code`: rebase or merge this branch; the three shared spots above are
additive (keep both sides). `npm run sync:web`; `npm test`; `npm run test:e2e`; the manual checks of Task 11 on the
owner's Mac; then `npm run deploy:server` with the owner's OK (free-mode answers can only say `code` once the server has
the new prompt) and, once PR #9 is in, `npm run sync:android`.

## Report

(Filled in by the worker at the end of Task 11.)

- Spike (Task 1): outcome **A nested**, with one more flag. On 2.1.289, `--permission-prompts host` alone sends no
  `control_request`: the stream says `{"type":"system","subtype":"permission_denied","tool_name":"Bash",...,
  "message":"This command requires approval"}` and Claude Code goes on without the command. With
  `--permission-prompt-tool stdio` added (the Agent SDK's way of being "the SDK host"), the question comes:
  `{"type":"control_request","request_id":"bbb90a19-…","request":{"subtype":"can_use_tool","tool_name":"Bash",
  "display_name":"Bash","input":{"command":"node -e \"console.log(40 + 2)\"","description":"…"},"description":"…",
  "permission_suggestions":[…],"decision_reason":"This command requires approval","decision_reason_type":"other",
  "tool_use_id":"toolu_…"}}`; the nested answer
  `{"type":"control_response","response":{"subtype":"success","request_id":"bbb90a19-…","response":{"behavior":"allow"}}}`
  runs it (`tool_result` `42`, `result` success, exit 0), and `{"behavior":"deny","message":"The person said no."}`
  gives a `tool_result` with `is_error: true` and the words "The person said no.", and the job goes on. The spike's
  command is `node -e "console.log(40 + 2)"`, not `echo`: Claude Code runs read-only commands such as `echo` without
  asking. `--max-turns 60`: **accepted** (the run starts and finishes normally), so the job passes it.
- Built: **Task 2a**, with `--permission-prompt-tool stdio` after `--permission-prompts host`.
- Spec points changed or left out, with why: see "Known differences from the spec" below, plus anything found while building.
- Found while building (the plan left where the real code differs, the simplest way that keeps the spec):
  1. **Starting Claude Code** goes through find.js's `spawnClaude` (the base's rule): the job passes `env` and
     spawnClaude adds the `BUDDY_CLAUDE_CODE` mark and `windowsHide`, and runs an npm `claude.cmd` through cmd with
     every argument quoted on one line. The first test expects `windowsHide: true`, and a new test checks the Windows
     `.cmd` path.
  2. **`--permission-prompt-tool stdio`** is passed after `--permission-prompts host` (the spike: without it 2.1.289
     denies on its own). `--max-turns 60` is passed.
  3. **The live line's cut:** the plan's test wanted `Running: echo` + 75 characters + "…", which is 81 characters of
     command; the code (and `questionFor`'s test) cut to 80 with the "…" included. The test was put right (74).
  4. **"Not now" on "Which project?"** said "Okay, not sent.": the existing `not-now` branch came first. The new
     branches of `act()` go before it instead of before `retry`.
  5. **The buddy kept thinking after a job started from a message?** No: `talk()` set it `happy` after the answer. One
     new line in `talk()` sets it back to `thinking` when that answer started a job (a moment of `happy` first, since
     the existing line is not changed).
  6. **Free mode dropped `projects`:** `src/main/cloud.js` only sends the inputs in `ASK_INPUTS`; `'projects'` is added
     there (a new line), with the cloud test.
  7. **Safety around a closed stdin:** an answer after Stop (or after the end) is refused, the 10-minute deny writes
     nothing after Stop, and a write error on stdin is ignored instead of crashing the app.
  8. **One job at a time on "Which project?"** too: a pick while another job runs is refused with "I'm still working
     in … Stop it first." (two questions could otherwise start two jobs).
  9. **A question from a job whose chat was closed** does not make the bubble say "Open me to answer" (that chat cannot
     be opened again); it is denied after 10 minutes as the spec says.
  10. **A job that failed** had the heading "✅ Done in …" above its red line: the heading is now "🔧 Was working in …"
      (`jobHeading` in chat-view.js; a screen reader hears "Was working in …").
  11. **No name:** with nobody signed in with a name, the appended system prompt leaves the name sentence out.
  12. **The e2e check** does not use the plan's `bubbleSays` (unused, which ESLint refuses).

### Known differences from the spec (decided while planning)

1. **`busy` during a job.** Spec §5 says the job uses "the chat's `busy` and `talking` as for an answer" and also that
   "the chat box is usable meanwhile". `busy: true` disables the box (`canSend`) and refuses `send()`. The plan keeps
   `busy` false during a job and uses `talking` (the buddy thinks) only; after a chat answer in between, the buddy
   thinks again on the job's next live line (not at once).
2. **A question while the panel is hidden.** The spec says nothing; the plan has the bubble say
   `Run npm test? Open me to answer.`, so a question is not left to the 10-minute deny unseen. The same for a failure
   while hidden (the bubble says the error line).
3. **`--max-turns 60`** is not in Claude Code 2.1.289's `--help` (checked while planning): the spike tries it once and
   the flag stays only if the command accepts it.
4. **The e2e cannot press "Add a folder"** (a native picker): the check lists the folder through the store, sees it in
   Settings and removes it with ✕; the picker is covered by the unit test of `claude:add-project` and the manual checklist.
5. **Retry on a job's red line** runs the same task again in the same folder (the spec's "the same task again"); the
   existing `retry` on chat errors re-sends the message, which is left as it is.
6. **The Settings buttons for the job's `claude_limit` / `claude_signed_out` lines** go to the AI section only once
   piece 1's `AI_ERRORS` line is merged; before that they open Settings at its start. `no_project` opens the Claude Code
   section (one new line in `sectionFor`).
