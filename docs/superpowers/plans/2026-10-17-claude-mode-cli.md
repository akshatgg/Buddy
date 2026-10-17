# Claude mode feels like the Claude Code CLI: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The panel's Claude mode shows a CLI-like status line (model, tokens in and out), a live list of the workers
(sub-agents) Claude starts (task, status, elapsed time, tokens; folded when many), and takes slash commands in its box:
`/model` (picker) and `/model <name>` (also saved as Buddy's Claude model), `/clear`, `/stop`, `/cost`, `/help`, with
suggestions while typing `/`.

**Architecture:** Claude mode is the person's own terminal session read from its transcript (`live.js`), not `job.js`
(see the spec, "What the code really is"). A new pure `src/main/claude/usage.js` tallies tokens, model and workers from
the same transcript lines; `live.js` feeds it, also reads running workers' own files, and adds `stats` + `workers` to
`view()`. Commands that act on the session go through `mode.js`: `/model <alias>` and `/clear` are typed into the
terminal as Claude Code's own commands, `/stop` sends Esc (iTerm2). `/help`, `/cost` and unknown commands are answered
in the page. Pure renderer helpers live in `claude-cli.js` (tested); `panel.js` draws.

**Tech Stack:** Electron, plain JS (CommonJS main, script renderer), `node:test`, ESLint, AppleScript via `osascript`.

**Spec:** `docs/superpowers/specs/2026-10-17-claude-mode-cli-design.md` (verified transcript shapes, copy table,
follow-ups).

## Global Constraints

- Work only in the worktree `/Users/akshat/projects/buddy-claude-cli`, branch `claude-cli`. Never touch other
  worktrees or branches.
- Commits as `git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit`, plain messages, no
  Co-Authored-By or AI mention.
- JS full test only with lock `until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock`.
  One file: `node --test test/<file>` (no lock needed).
- Do not push.
- Match the code style: `'use strict'`, small functions with a one-line JSDoc in plain words, 2-space indent, single
  quotes, lines up to ~150 chars. Copy exactly as in the spec's copy table.
- Do not change `src/main/claude/job.js`, `actions.js` or `share.js` (relay is a follow-up).
- Tasks are sequential: 1 → 2 → 3 → 4. Each ends green (`npm test` with the lock) and with one commit.

---

### Task 1: Tokens, model and workers from the transcript (`usage.js`, `live.js`)

**Files:**
- Create: `src/main/claude/usage.js`
- Modify: `src/main/claude/live.js`
- Create: `test/claude-usage.test.js`
- Modify: `test/claude-live.test.js`

**Interfaces:**
- `usage.js` exports `newTally() -> Tally`, `tally(t, entry) -> boolean` (changed), `workerTokens(t, toolUseId, usage) -> boolean`,
  `running(t) -> string[]` (tool_use ids of running workers), `viewOf(t) -> { stats: { model, input, output }, workers: Worker[] }`,
  `tokensOf(usage) -> { in, out }`, `WORKERS_KEPT`.
- `Worker = { id, task, status: 'running'|'done'|'failed'|'stopped', startedAt: ms|null, endedAt: ms|null, tokens }`.
- `live.view(id)` gains `stats` and `workers` (spread from `viewOf`).

- [ ] **Step 1: Write the failing tests** `test/claude-usage.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { newTally, tally, workerTokens, running, viewOf, WORKERS_KEPT } = require('../src/main/claude/usage');

const AT = '2026-10-17T10:00:00.000Z';
const U = (input, cacheWrite, cacheRead, output) => ({
  input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output,
});
const reply = (id, usage, content = [], extra = {}) => ({
  type: 'assistant', timestamp: AT, message: { id, model: 'claude-opus-5-5', role: 'assistant', content, usage }, ...extra,
});
const agent = (id, input, name = 'Agent') => reply(`m-${id}`, U(1, 0, 0, 1), [{ type: 'tool_use', id, name, input }]);
const result = (id, toolUseResult, isError = false, at = '2026-10-17T10:01:00.000Z') => ({
  type: 'user', timestamp: at, toolUseResult,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(isError ? { is_error: true } : {}) }] },
});
const notification = (id, status, tokens, at = '2026-10-17T10:05:00.000Z') => ({
  type: 'user', timestamp: at, origin: { kind: 'task-notification' },
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n`
      + `<summary>Agent finished</summary>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>3</tool_uses>`
      + '<duration_ms>1000</duration_ms></usage>\n</task-notification>',
  },
});

test('a reply is counted once, though Claude Code writes a line for each of its blocks', () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'text', text: 'hi' }])), true);
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }])), false);
  tally(t, reply('m2', U(1, 0, 1102, 20)));
  assert.deepStrictEqual(viewOf(t).stats, { model: 'claude-opus-5-5', input: 2205, output: 70 });
});

test("a sub-agent's own lines, Claude Code's synthetic replies and anything malformed leave the count alone", () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('s1', U(5, 5, 5, 5), [], { isSidechain: true })), false);
  assert.strictEqual(tally(t, { type: 'assistant', message: { id: 'syn', model: '<synthetic>', content: [], usage: U(0, 0, 0, 0) } }), false);
  assert.strictEqual(tally(t, 'nonsense'), false);
  assert.strictEqual(tally(t, { type: 'user', message: { content: 42 } }), false);
  assert.deepStrictEqual(viewOf(t), { stats: { model: null, input: 0, output: 0 }, workers: [] });
});

test('a worker starts with an Agent tool_use and ends with its result, or later with its notification', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Fix the login bug', subagent_type: 'general-purpose' }));
  tally(t, agent('w2', { description: 'Write the tests' }));
  tally(t, agent('w3', { subagent_type: 'Explore' }, 'Task'));
  assert.deepStrictEqual(viewOf(t).workers.map((w) => [w.task, w.status]), [
    ['Fix the login bug', 'running'], ['Write the tests', 'running'], ['Explore', 'running'],
  ]);
  assert.deepStrictEqual(running(t), ['w1', 'w2', 'w3']);

  tally(t, result('w1', { status: 'completed', totalTokens: 4200 }));
  tally(t, result('w2', { isAsync: true, status: 'async_launched', agentId: 'a1' })); // in the background: still running
  tally(t, result('w3', {}, true));
  let w = viewOf(t).workers;
  assert.deepStrictEqual(w[0], {
    id: 'w1', task: 'Fix the login bug', status: 'done', startedAt: Date.parse(AT), endedAt: Date.parse('2026-10-17T10:01:00.000Z'), tokens: 4200,
  });
  assert.strictEqual(w[1].status, 'running');
  assert.strictEqual(w[2].status, 'failed');

  assert.strictEqual(tally(t, notification('w2', 'completed', 86829)), true);
  w = viewOf(t).workers;
  assert.deepStrictEqual([w[1].status, w[1].tokens, w[1].endedAt], ['done', 86829, Date.parse('2026-10-17T10:05:00.000Z')]);
  assert.strictEqual(tally(t, notification('w2', 'completed', 1)), false, 'an ended worker stays as it ended');
});

test('a worker the person stopped, or that was killed, shows as stopped; a notification for nobody changes nothing', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Look around' }));
  tally(t, notification('w1', 'killed', 10));
  assert.strictEqual(viewOf(t).workers[0].status, 'stopped');
  assert.strictEqual(tally(t, notification('nobody', 'completed', 10)), false);
});

test("a running worker's tokens follow its newest reply; an ended one's stay", () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Look around' }));
  assert.strictEqual(workerTokens(t, 'w1', U(2, 300, 4000, 25)), true);
  assert.strictEqual(viewOf(t).workers[0].tokens, 4327);
  assert.strictEqual(workerTokens(t, 'w1', U(2, 300, 4000, 25)), false);
  tally(t, result('w1', { status: 'completed', totalTokens: 5000 }));
  assert.strictEqual(workerTokens(t, 'w1', U(9, 9, 9, 9)), false);
  assert.strictEqual(viewOf(t).workers[0].tokens, 5000);
  assert.strictEqual(workerTokens(t, 'nobody', U(1, 1, 1, 1)), false);
});

test(`only the newest ${WORKERS_KEPT} workers are kept, never one still running`, () => {
  const t = newTally();
  for (let i = 0; i < 25; i += 1) tally(t, agent(`w${i}`, { description: `job ${i}` }));
  for (let i = 1; i < 25; i += 1) tally(t, result(`w${i}`, { status: 'completed' }));
  const ids = viewOf(t).workers.map((w) => w.id);
  assert.strictEqual(ids.length, WORKERS_KEPT);
  assert.ok(ids.includes('w0') && ids.includes('w24') && !ids.includes('w5'));
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `node --test test/claude-usage.test.js`
Expected: FAIL, `Cannot find module '../src/main/claude/usage'`.

- [ ] **Step 3: Write `src/main/claude/usage.js`**

```js
'use strict';

/**
 * Claude mode's status line and workers, from the same transcript lines live.js reads: the tokens of the whole session
 * (what went in, with the cache, and what came out), the model answering now, and the sub-agents ("workers") Claude
 * starts with its Agent tool, each with its task, how it stands, when it started and ended, and its tokens.
 *
 * Claude Code writes a line for each block of a reply, each with the whole reply's usage, one after the other: a reply
 * is counted once, by its id. A worker starts with an Agent (older: Task) tool_use. It ends with its tool_result, or,
 * when it runs in the background (the result then says async_launched), with a <task-notification> later. While it
 * runs, its tokens come from its own file (live.js reads it and calls workerTokens).
 */

const WORKERS_KEPT = 20; // the newest workers kept for a session
const TASK_CHARS = 120;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const ENDS = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' }; // a notification's <status>

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const timeOf = (stamp) => {
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
};
const tagIn = (text, tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1]?.trim() ?? null;

/** A reply's tokens: in (input, cache written and cache read) and out. */
function tokensOf(usage) {
  const u = isObject(usage) ? usage : {};
  return { in: count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens), out: count(u.output_tokens) };
}

/** A session's tally, before any line. */
function newTally() {
  return { model: null, input: 0, output: 0, last: null, workers: new Map() };
}

/** The words of a message: its text, or its text blocks joined. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** A worker ends: how, when, and its tokens when the end says them. */
function finish(worker, status, at, tokens) {
  worker.status = status;
  worker.endedAt = at;
  if (tokens > 0) worker.tokens = tokens;
}

/** Only the newest WORKERS_KEPT, the oldest that ended going first. */
function trim(t) {
  for (const [id, w] of t.workers) {
    if (t.workers.size <= WORKERS_KEPT) return;
    if (w.status !== 'running') t.workers.delete(id);
  }
}

/** Add one transcript line to the tally. Answers whether anything shown changed. */
function tally(t, entry) {
  if (!isObject(entry) || entry.isSidechain === true) return false;
  const message = isObject(entry.message) ? entry.message : {};
  const at = timeOf(entry.timestamp);
  let changed = false;
  if (entry.type === 'assistant') {
    if (typeof message.model === 'string' && message.model.startsWith('claude-') && message.model !== t.model) {
      t.model = message.model;
      changed = true;
    }
    if (isObject(message.usage)) {
      const now = tokensOf(message.usage);
      const before = t.last && t.last.id === message.id ? t.last : { in: 0, out: 0 };
      if (now.in !== before.in || now.out !== before.out) changed = true;
      t.input += now.in - before.in;
      t.output += now.out - before.out;
      t.last = { id: message.id, ...now };
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_use' || !AGENT_TOOLS.has(block.name) || typeof block.id !== 'string' || t.workers.has(block.id)) continue;
      const input = isObject(block.input) ? block.input : {};
      const task = [input.description, input.subagent_type].find((s) => typeof s === 'string' && s.trim());
      const words = task ? task.replace(/\s+/g, ' ').trim() : 'A worker';
      t.workers.set(block.id, {
        id: block.id, task: words.length > TASK_CHARS ? `${words.slice(0, TASK_CHARS - 1)}…` : words, status: 'running', startedAt: at, endedAt: null, tokens: 0,
      });
      changed = true;
    }
  } else if (entry.type === 'user') {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const worker = block?.type === 'tool_result' ? t.workers.get(block.tool_use_id) : null;
      if (!worker || worker.status !== 'running') continue;
      const r = isObject(entry.toolUseResult) ? entry.toolUseResult : {};
      if (r.status === 'async_launched') continue; // started in the background: its end comes as a notification
      finish(worker, block.is_error === true ? 'failed' : 'done', at, count(r.totalTokens));
      changed = true;
    }
    const text = textOf(message.content);
    if (text.includes('<task-notification>')) {
      const worker = t.workers.get(tagIn(text, 'tool-use-id'));
      const status = ENDS[tagIn(text, 'status')];
      if (worker && worker.status === 'running' && status) {
        finish(worker, status, at, count(Number(tagIn(text, 'subagent_tokens') ?? tagIn(text, 'total_tokens'))));
        changed = true;
      }
    }
  }
  trim(t);
  return changed;
}

/** A running worker's tokens from its newest reply (in + out). Answers whether they changed. */
function workerTokens(t, id, usage) {
  const worker = t.workers.get(id);
  if (!worker || worker.status !== 'running') return false;
  const { in: input, out } = tokensOf(usage);
  if (input + out === worker.tokens) return false;
  worker.tokens = input + out;
  return true;
}

/** The tool_use ids of the workers still running. */
const running = (t) => [...t.workers.values()].filter((w) => w.status === 'running').map((w) => w.id);

/** What the panel shows: the status line's numbers and the workers, oldest first. */
function viewOf(t) {
  return { stats: { model: t.model, input: t.input, output: t.output }, workers: [...t.workers.values()].map((w) => ({ ...w })) };
}

module.exports = { WORKERS_KEPT, tokensOf, newTally, tally, workerTokens, running, viewOf };
```

- [ ] **Step 4: Run them, see them pass**

Run: `node --test test/claude-usage.test.js`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing live.js test** (append to `test/claude-live.test.js`, after the
  `claudeHome` tests):

```js
test("the session's tokens, model and workers come with its view; a running worker's tokens from its own file", async (t) => {
  const usage = { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 90, output_tokens: 5 };
  const reply = (id, content = []) => assistant(content, {
    timestamp: '2026-10-17T10:00:00.000Z', message: { id, model: 'claude-sonnet-5-5', role: 'assistant', content, usage },
  });
  const home = claudeHome(t, [user('hi'), reply('m1', [{ type: 'tool_use', id: 'toolu_1', name: 'Agent', input: { description: 'Read the docs' } }])]);
  const live = createLive({ configDirs: () => [home.dir], now: () => 2000, ttys: async () => ({}) });
  await live.discover();
  await live.refresh(home.id);
  const view = live.view(home.id);
  assert.deepStrictEqual(view.stats, { model: 'claude-sonnet-5-5', input: 100, output: 5 });
  assert.deepStrictEqual(view.workers.map((w) => [w.task, w.status, w.tokens]), [['Read the docs', 'running', 0]]);

  // The worker's own file, which its .meta.json names: its newest reply's tokens, with nothing new in the session's file.
  const sub = path.join(home.transcript.slice(0, -'.jsonl'.length), 'subagents');
  fs.mkdirSync(sub, { recursive: true });
  fs.writeFileSync(path.join(sub, 'agent-abc123.meta.json'), JSON.stringify({ agentType: 'general-purpose', toolUseId: 'toolu_1' }));
  fs.writeFileSync(path.join(sub, 'agent-abc123.jsonl'), `${JSON.stringify(reply('s1'))}\n`);
  const changed = [];
  live.onChange((id) => changed.push(id));
  await live.refresh(home.id);
  assert.strictEqual(live.view(home.id).workers[0].tokens, 105);
  assert.deepStrictEqual(changed, [home.id]);
  await live.refresh(home.id);
  assert.deepStrictEqual(changed, [home.id], 'nothing new: nobody is told');
});
```

- [ ] **Step 6: Run it, see it fail**

Run: `node --test test/claude-live.test.js`
Expected: FAIL in the new test (`view.stats` is `undefined`).

- [ ] **Step 7: Change `src/main/claude/live.js`**

1. Under `const { needsYou } = require('./hooks');` add:

```js
const { newTally, tally, workerTokens, running, viewOf } = require('./usage');
```

2. Rename `async function readNew(s)` to `async function readLines(s)` and change its JSDoc to
   `/** Read what was added to the session's file since the last read. Answers whether anything shown changed. */`.
   Inside it:
   - in the first-read branch (after `s.queued = [];`) add:

```js
        s.tally = newTally(); // the tokens and workers are counted again with the items
        s.agents = new Map(); // a worker's tool_use id → its own file: { file, offset, rest }
        s.metaSeen = new Set(); // the .meta.json files read
```

   - next to `let added = 0;` add `let touched = false; // the tokens or the workers changed`
   - right after the `try { entry = JSON.parse(line); } catch { continue; }` block add:

```js
        if (tally(s.tally, entry)) touched = true;
```

   - change `return added > 0;` to `return added > 0 || touched;`

3. Below `readLines`, add:

```js
  /** The whole lines added to a worker's file ({ file, offset, rest }) since the last read; none when it is not there. */
  async function newLines(f) {
    let handle;
    try {
      handle = await fs.open(f.file, 'r');
      const { size } = await handle.stat();
      if (size <= f.offset) return [];
      const length = Math.min(size - f.offset, READ_MAX);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, f.offset);
      f.offset += bytesRead;
      const lines = (f.rest + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      f.rest = lines.pop(); // a line still being written ends in the next read
      return lines;
    } catch {
      return [];
    } finally {
      await handle?.close();
    }
  }

  /**
   * The tokens of the workers still running, from their own files: subagents/agent-<id>.jsonl next to the session's
   * file, whose agent-<id>.meta.json names the Agent tool_use it runs for. Answers whether a worker's tokens changed.
   */
  async function readWorkers(s) {
    const ids = running(s.tally);
    if (!ids.length || !s.transcript) return false;
    s.agents ??= new Map();
    s.metaSeen ??= new Set();
    const dir = path.join(s.transcript.slice(0, -'.jsonl'.length), 'subagents');
    let names;
    try {
      names = await fs.readdir(dir);
    } catch {
      return false; // no worker has written yet
    }
    for (const name of names) {
      const m = /^agent-([\w-]{1,100})\.meta\.json$/.exec(name);
      if (!m || s.metaSeen.has(name)) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        s.metaSeen.add(name);
        if (typeof meta?.toolUseId === 'string') s.agents.set(meta.toolUseId, { file: path.join(dir, `agent-${m[1]}.jsonl`), offset: 0, rest: '' });
      } catch {
        // being written: read again next time
      }
    }
    let changed = false;
    for (const id of ids) {
      const f = s.agents.get(id);
      if (!f) continue;
      let usage = null;
      for (const line of await newLines(f)) {
        if (!line.includes('"usage"')) continue;
        try {
          const e = JSON.parse(line);
          if (e?.type === 'assistant' && e.message?.usage) usage = e.message.usage;
        } catch {
          // not a whole line
        }
      }
      if (usage && workerTokens(s.tally, id, usage)) changed = true;
    }
    return changed;
  }

  /** Read what was added to the session's file and to its running workers' files. Answers whether anything changed. */
  async function readNew(s) {
    s.tally ??= newTally();
    const lines = await readLines(s);
    const workers = await readWorkers(s);
    return lines || workers;
  }
```

4. In `view(id)`, return the tokens and workers too:

```js
    return { id: s.id, name: s.name, title: s.title ?? null, status: s.status, canTalk: Boolean(s.tty), items: s.items, ...viewOf(s.tally ?? newTally()) };
```

   And its JSDoc: `/** What the panel shows of a session: its name, status, whether Buddy can type into it, its items, its tokens and workers. */`

- [ ] **Step 8: Run both files, see them pass**

Run: `node --test test/claude-usage.test.js test/claude-live.test.js test/claude-share.test.js test/claude-mode.test.js`
Expected: PASS. (If an existing test compares a whole `view`, add `stats` and `workers` to its expectation; none did
at the time of writing.)

- [ ] **Step 9: Full suite and commit**

```bash
cd /Users/akshat/projects/buddy-claude-cli
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add src/main/claude/usage.js src/main/claude/live.js test/claude-usage.test.js test/claude-live.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude mode: count a session's tokens, model and workers from its transcript"
```

---

### Task 2: `/model`, `/stop` and `/clear` in main (`terminal.js`, `mode.js`, IPC)

**Files:**
- Modify: `src/main/claude/terminal.js`, `src/main/claude/mode.js`, `src/main/ipc/panel.js`, `src/preload/panel.js`, `src/main/main.js`
- Modify: `test/claude-mode.test.js`, `test/panel-ipc.test.js`

**Interfaces:**
- `terminal.interrupt({ tty }) -> { app: 'iterm' }`, throws `BuddyError('no_terminal', PRESS_ESC)` / `('not_allowed', NOT_ALLOWED)`.
  Exports `ESC_SCRIPT`, `PRESS_ESC`.
- `createClaudeMode({ …, saveModel = () => {}, wait = (ms) => new Promise((r) => setTimeout(r, ms)) })` gains
  `model(id, alias) -> { typed, model, message?, remote? }`, `stop(id) -> { stopped: true }`,
  `clear(id) -> { typed, session: View|null, message? }`. Exports `NO_SUCH_MODEL(name)`, `STOP_THERE`.
- IPC: `panel:claude-model (id, alias)`, `panel:claude-stop (id)`, `panel:claude-clear (id)`.
- Preload: `claudeModel(id, alias)`, `claudeStop(id)`, `claudeClear(id)`.

- [ ] **Step 1: Write the failing tests** in `test/claude-mode.test.js`.

Change the requires at the top to:

```js
const { createTerminal, oneLine, SCRIPT, ESC_SCRIPT, NO_TERMINAL, NOT_ALLOWED, ONLY_MAC, PRESS_ESC } = require('../src/main/claude/terminal');
const { createClaudeMode, GONE, NO_SUCH_MODEL } = require('../src/main/claude/mode');
```

After the last terminal.js test (before `// ---- mode.js`), add:

```js
test('Esc goes to the iTerm2 session on that tty; elsewhere the person is told to press it', async () => {
  const f = fakeRun();
  assert.deepStrictEqual(await createTerminal({ platform: 'darwin', run: f.run }).interrupt({ tty: 'ttys003' }), { app: 'iterm' });
  assert.deepStrictEqual(f.calls[0].args, ['-e', ESC_SCRIPT, '/dev/ttys003']);
  assert.ok(ESC_SCRIPT.includes('character id 27') && !ESC_SCRIPT.includes('ttys003'));
  const stop = (opts, tty = 'ttys003') => createTerminal(opts).interrupt({ tty });
  await assert.rejects(stop({ platform: 'darwin', run: fakeRun({ out: 'none' }).run }), { code: 'no_terminal', message: PRESS_ESC });
  await assert.rejects(stop({ platform: 'darwin', run: fakeRun({ fail: 'Not authorized to send Apple events (-1743)' }).run }),
    { code: 'not_allowed', message: NOT_ALLOWED });
  await assert.rejects(stop({ platform: 'win32', run: fakeRun().run }), { code: 'no_terminal', message: PRESS_ESC });
  await assert.rejects(stop({ platform: 'darwin', run: fakeRun().run }, null), { code: 'no_terminal', message: PRESS_ESC });
});
```

Replace the `setup` function under `// ---- mode.js` with (new: `interrupt`, `saveModel`, `wait`, `onWait`, `stopped`, `saved`):

```js
function setup({ typeFails = null, remote = null, onWait = null } = {}) {
  const live = fakeLive();
  const sent = [];
  const typed = [];
  const copied = [];
  const timers = [];
  const stopped = [];
  const saved = [];
  let waits = 0;
  const mode = createClaudeMode({
    live,
    terminal: {
      async type(args) {
        typed.push(args);
        if (typeFails) throw typeFails;
        return { app: 'iterm' };
      },
      async interrupt(args) {
        stopped.push(args);
        return { app: 'iterm' };
      },
    },
    clipboard: { writeText: async (text) => copied.push(text) },
    send: (view) => sent.push(view),
    remote,
    saveModel: (alias) => saved.push(alias),
    wait: async () => {
      waits += 1;
      onWait?.(waits);
    },
    every: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; },
    stopEvery: (t) => { t.on = false; },
  });
  return { live, mode, sent, typed, copied, timers, stopped, saved };
}
```

At the end of the file add:

```js
test("/model <name>: Claude Code's own /model is typed into the terminal, and kept as Buddy's Claude model", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.mode.model('a', 'opus'), { typed: true, model: 'opus' });
  assert.deepStrictEqual(s.typed, [{ tty: 'ttys001', text: '/model opus' }]);
  assert.deepStrictEqual(s.saved, ['opus']);
  await assert.rejects(s.mode.model('a', 'gpt'), { code: 'bad_request', message: NO_SUCH_MODEL('gpt') });
  assert.strictEqual(s.typed.length, 1, 'nothing is typed for a name that is no model');
  assert.deepStrictEqual(s.saved, ['opus']);
});

test("/stop sends Esc to the session's terminal", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.mode.stop('a'), { stopped: true });
  assert.deepStrictEqual(s.stopped, [{ tty: 'ttys001' }]);
  await assert.rejects(s.mode.stop('zzz'), { code: 'bad_request', message: GONE });
});

test('/clear: typed into the terminal, then the new session Claude Code starts there is opened', async () => {
  const s = setup({
    onWait: (n) => {
      if (n === 2) s.live.views.b = { id: 'b', name: 'shop', status: 'idle', canTalk: true, items: [] };
    },
  });
  await s.mode.open('a');
  assert.deepStrictEqual(await s.mode.clear('a'), { typed: true, session: s.live.views.b });
  assert.deepStrictEqual(s.typed, [{ tty: 'ttys001', text: '/clear' }]);
  assert.strictEqual(s.mode.isOpen(), true);
  assert.strictEqual(s.timers[0].on, false, "the old session's reading stopped");
});

test('/clear: when no new session shows up, the page goes back to the list', async () => {
  const s = setup();
  await s.mode.open('a');
  assert.deepStrictEqual(await s.mode.clear('a'), { typed: true, session: null });
  assert.strictEqual(s.mode.isOpen(), false);
});
```

In `test/panel-ipc.test.js`, add to the `claudeMode` fake in `setup`:

```js
      model: async (id, alias) => { calls.push(['claudeModel', id, alias]); return { typed: true, model: alias }; },
      stop: async (id) => { calls.push(['claudeStop', id]); return { stopped: true }; },
      clear: async (id) => { calls.push(['claudeClear', id]); return { typed: true, session: null }; },
```

Change the channel test's title to `'the panel asks through eleven channels and tells main ten things; the old ones are gone'`
and its handler list to:

```js
    'panel:act', 'panel:claude-clear', 'panel:claude-model', 'panel:claude-open', 'panel:claude-sessions', 'panel:claude-stop', 'panel:claude-talk',
    'panel:drop-selection', 'panel:mic-access', 'panel:send', 'panel:transcribe',
```

And add after the existing Claude mode IPC test:

```js
test('Claude mode commands: /model (a name only as text), /stop and /clear, from the panel only', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.handlers['panel:claude-model'](s.fromPanel, 'a', 'opus'), { ok: true, typed: true, model: 'opus' });
  await s.handlers['panel:claude-model'](s.fromPanel, 'a', 7);
  assert.deepStrictEqual(await s.handlers['panel:claude-stop'](s.fromPanel, 'a'), { ok: true, stopped: true });
  assert.deepStrictEqual(await s.handlers['panel:claude-clear'](s.fromPanel, 'a'), { ok: true, typed: true, session: null });
  assert.strictEqual((await s.handlers['panel:claude-stop'](SOMEONE_ELSE, 'a')).ok, false, 'only the panel page');
  assert.deepStrictEqual(s.calls, [['claudeModel', 'a', 'opus'], ['claudeModel', 'a', ''], ['claudeStop', 'a'], ['claudeClear', 'a']]);
});
```

- [ ] **Step 2: Run them, see them fail**

Run: `node --test test/claude-mode.test.js test/panel-ipc.test.js`
Expected: FAIL (`interrupt is not a function`, `s.mode.model is not a function`, missing handlers).

- [ ] **Step 3: `src/main/claude/terminal.js`**

Under `const ONLY_MAC = …` add:

```js
const PRESS_ESC = 'I can only stop Claude in iTerm2. Press Esc in its terminal.';

// Esc for the session on that tty, as when the person presses it: Claude Code stops what it is doing. Only iTerm2 can
// be sent a key without coming to the front; Terminal cannot, so there the person is told to press it.
const ESC_SCRIPT = `
on run argv
  set theTty to item 1 of argv
  if application id "com.googlecode.iterm2" is running then
    tell application id "com.googlecode.iterm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if tty of s is theTty then
              tell s to write text (character id 27) newline no
              return "iterm"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  return "none"
end run
`;
```

In `createTerminal`, make `osascript` take the script: `function osascript(script, args)` with
`run('/usr/bin/osascript', ['-e', script, ...args], …)`, and change the call in `type` to
`osascript(SCRIPT, [`/dev/${tty}`, line])`. Then add, after `type`:

```js
  /** Esc to the session on `tty` (iTerm2 only): Claude Code stops what it is doing. Throws a BuddyError that says what to do. */
  async function interrupt({ tty }) {
    if (platform !== 'darwin' || typeof tty !== 'string' || !/^ttys?\d{1,4}$/.test(tty)) throw new BuddyError('no_terminal', PRESS_ESC);
    let app;
    try {
      app = await osascript(ESC_SCRIPT, [`/dev/${tty}`]);
    } catch (err) {
      if (/-1743|not allowed/i.test(err.stderr)) throw new BuddyError('not_allowed', NOT_ALLOWED);
      console.warn('[buddy] could not send Esc to the terminal:', err.code || err.name);
      throw new BuddyError('no_terminal', PRESS_ESC);
    }
    if (app !== 'iterm') throw new BuddyError('no_terminal', PRESS_ESC);
    return { app };
  }

  return { type, interrupt };
```

(replacing `return { type };`). Export: `module.exports = { SCRIPT, ESC_SCRIPT, TEXT_MAX, NO_TERMINAL, NOT_ALLOWED, ONLY_MAC, PRESS_ESC, oneLine, createTerminal };`

- [ ] **Step 4: `src/main/claude/mode.js`**

Under `const { BuddyError } = …` add `const { MODELS } = require('./find');`. Under `const GONE = …` add:

```js
const CLEAR_TRIES = 6; // after /clear, Claude Code's new session is looked for this many times…
const CLEAR_EVERY_MS = 500; // …this far apart
const STOP_THERE = 'Stop it on that computer.';
const NO_SUCH_MODEL = (name) => `There is no model called ${name}. Try opus, sonnet or haiku.`;
```

Add `saveModel = () => {}` and `wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))` to the
`createClaudeMode({ … })` parameters, and to its JSDoc: "`saveModel(alias)` keeps a model picked with /model as
Buddy's Claude Code model; `wait` is passed in by the unit tests."

Turn the methods of the returned object into named functions with the **same bodies**: `async function sessions()`,
`async function open(id)`, `async function talk(id, text)` (keep their JSDoc above each). Then add below them:

```js
  /** `/model <alias>`: Claude Code's own /model typed into the session (from its next message), and kept as Buddy's. */
  async function model(id, alias) {
    if (!MODELS.includes(alias)) throw new BuddyError('bad_request', NO_SUCH_MODEL(alias));
    const r = await talk(id, `/model ${alias}`);
    saveModel(alias); // the person's choice, also when the words were only copied
    return { ...r, model: alias };
  }

  /** `/stop`: Esc in the session's terminal. A session on another computer is stopped there. */
  async function stop(id) {
    if (openRemote && id === openId) throw new BuddyError('bad_request', STOP_THERE);
    const target = typeof id === 'string' ? live.target(id) : null;
    if (!target) throw new BuddyError('bad_request', GONE);
    await terminal.interrupt({ tty: target.tty });
    return { stopped: true };
  }

  /**
   * `/clear`: typed into the session. Claude Code then starts a new session (a new id and file) in the same terminal,
   * which is looked for by its tty and opened: { typed, session }. None found: the page goes back to the list (null).
   */
  async function clear(id) {
    if (openRemote && id === openId) {
      await remote.send(id, '/clear');
      close();
      return { typed: true, remote: true, session: null };
    }
    const target = typeof id === 'string' ? live.target(id) : null;
    if (!target) throw new BuddyError('bad_request', GONE);
    const r = await talk(id, '/clear');
    if (!r.typed) return { ...r, session: null };
    for (let i = 0; i < CLEAR_TRIES; i += 1) {
      await wait(CLEAR_EVERY_MS);
      await live.discover();
      const next = live.list().find((s) => s.id !== id && live.target(s.id)?.tty === target.tty);
      if (next) return { typed: true, ...(await open(next.id)) };
    }
    close();
    return { typed: true, session: null };
  }

  return { sessions, open, close, talk, model, stop, clear, isOpen: () => openId !== null };
```

Export: `module.exports = { READ_EVERY_MS, LOOK_EVERY_MS, GONE, STOP_THERE, NO_SUCH_MODEL, createClaudeMode };`
Update the file's top comment with one line: "Slash commands that act on the session (/model, /stop, /clear) come
here too: the first and last are typed as Claude Code's own, /stop is Esc."

- [ ] **Step 5: IPC, preload, main**

`src/main/ipc/panel.js`, after `panel:claude-talk`:

```js
  // Claude mode's slash commands that act on the session: /model <alias> (only text), /stop and /clear.
  handle('panel:claude-model', (id, alias) => claudeMode.model(id, typeof alias === 'string' ? alias : ''));
  handle('panel:claude-stop', (id) => claudeMode.stop(id));
  handle('panel:claude-clear', (id) => claudeMode.clear(id));
```

`src/preload/panel.js`, after `claudeTalk`:

```js
  claudeModel: (id, alias) => ipcRenderer.invoke('panel:claude-model', id, alias),
  claudeStop: (id) => ipcRenderer.invoke('panel:claude-stop', id),
  claudeClear: (id) => ipcRenderer.invoke('panel:claude-clear', id),
```

`src/main/main.js`, in `createClaudeMode({ … })` after `send: …`:

```js
    // A model picked with /model in Claude mode is Buddy's Claude Code model from then on (Settings → AI shows it).
    saveModel: (alias) => store.set({ models: { ...(store.get('models') || {}), 'claude-code': alias } }),
```

- [ ] **Step 6: Run them, see them pass**

Run: `node --test test/claude-mode.test.js test/panel-ipc.test.js`
Expected: PASS.

- [ ] **Step 7: Full suite and commit**

```bash
cd /Users/akshat/projects/buddy-claude-cli
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add src/main/claude/terminal.js src/main/claude/mode.js src/main/ipc/panel.js src/preload/panel.js src/main/main.js test/claude-mode.test.js test/panel-ipc.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude mode: /model, /stop and /clear act on the session's terminal"
```

---

### Task 3: The words: status line, workers and commands (`claude-cli.js`)

**Files:**
- Modify: `src/renderer/panel/claude-cli.js`
- Modify: `test/claude-cli.test.js`

**Interfaces (all pure, added to `ClaudeCli`'s return):** `tokenCount(n)`, `modelName(id)`, `elapsed(ms)`,
`statusLine(stats)`, `workerList(workers, now) -> { lines: [{ id, status, text }], compact, summary }`,
`command(text) -> { name, arg, known } | null`, `suggestions(text) -> COMMANDS[]`, `helpLines()`, `unknownLine(name)`,
`costLines(session)`, `COMMANDS`, `MODEL_PICKS`, `MODEL_LABELS`.

- [ ] **Step 1: Write the failing tests** (append to `test/claude-cli.test.js`; add the names to its require):

```js
const {
  tokenCount, modelName, elapsed, statusLine, workerList, command, suggestions, helpLines, unknownLine, costLines, COMMANDS,
} = require('../src/renderer/panel/claude-cli.js');

test('tokens, the model and the time as the terminal writes them', () => {
  assert.deepStrictEqual([0, 980, 1000, 1234, 12345, 123456, 999_999, 1_200_000].map(tokenCount), ['0', '980', '1k', '1.2k', '12.3k', '123k', '1M', '1.2M']);
  assert.strictEqual(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(modelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.strictEqual(modelName('gpt-5'), 'gpt-5');
  assert.strictEqual(modelName(null), '');
  assert.deepStrictEqual([0, 12_400, 72_000, 3_900_000].map(elapsed), ['0s', '12s', '1m 12s', '1h 5m']);
});

test('the status line: the model, then tokens in and out; nothing before any reply', () => {
  assert.strictEqual(statusLine({ model: 'claude-opus-5-5', input: 1_234_567, output: 34_000 }), 'Opus 5.5 · 1.2M in · 34k out');
  assert.strictEqual(statusLine({ model: null, input: 0, output: 0 }), '');
  assert.strictEqual(statusLine(undefined), '');
});

test('workers: running ones and those that ended in the last 5 minutes, folded into one line above three', () => {
  const now = Date.parse('2026-10-17T10:10:00Z');
  const at = (s) => Date.parse(`2026-10-17T10:${s}Z`);
  const w = (id, status, startedAt, endedAt, tokens) => ({ id, task: `job ${id}`, status, startedAt, endedAt, tokens });
  const two = workerList([w('a', 'running', at('08:48'), null, 12_300), w('b', 'done', at('00:00'), at('01:00'), 0), w('c', 'failed', at('06:00'), at('07:00'), 900)], now);
  assert.deepStrictEqual(two.lines, [
    { id: 'a', status: 'running', text: 'job a · running · 1m 12s · 12.3k tokens' },
    { id: 'c', status: 'failed', text: 'job c · failed · 1m 0s · 900 tokens' },
  ]);
  assert.strictEqual(two.compact, false);
  const many = workerList([w('a', 'running', at('09:00'), null, 0), w('b', 'running', at('09:00'), null, 0), w('c', 'done', at('09:00'), at('09:30'), 0),
    w('d', 'stopped', at('09:00'), at('09:30'), 0)], now);
  assert.strictEqual(many.compact, true);
  assert.strictEqual(many.summary, '4 workers · 2 running · 1 done · 1 stopped');
  assert.deepStrictEqual(workerList(undefined, now), { lines: [], compact: false, summary: '0 workers' });
});

test('slash commands: a name and what follows it; a path is not one; "/" suggests them all', () => {
  assert.deepStrictEqual(command('/model Opus'), { name: 'model', arg: 'opus', known: true });
  assert.deepStrictEqual(command('  /clear '), { name: 'clear', arg: '', known: true });
  assert.deepStrictEqual(command('/compact now'), { name: 'compact', arg: 'now', known: false });
  assert.strictEqual(command('/Users/a/shop fix it'), null);
  assert.strictEqual(command('/'), null);
  assert.strictEqual(command('fix /model'), null);
  assert.deepStrictEqual(suggestions('/').map((c) => c.name), ['model', 'clear', 'stop', 'cost', 'help']);
  assert.deepStrictEqual(suggestions('/c').map((c) => c.name), ['clear', 'cost']);
  assert.deepStrictEqual(suggestions('/model opus'), []);
  assert.deepStrictEqual(suggestions('hi'), []);
});

test("the answers the page gives itself: help, an unknown command, and the session's tokens", () => {
  assert.deepStrictEqual(helpLines(), COMMANDS.map((c) => `/${c.name} · ${c.hint}`));
  assert.strictEqual(helpLines()[0], '/model · pick the model: opus, sonnet or haiku');
  assert.strictEqual(unknownLine('compact'), "/compact isn't a command here. Try /help.");
  assert.deepStrictEqual(costLines({ stats: { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 }, workers: [{ tokens: 100_000 }, { tokens: 20_000 }] }), [
    'Tokens so far: 1.2M in · 34k out', 'Model: Opus 5.5', 'Workers: 2 · 120k tokens', "Cost isn't in the session file. Type /cost in the terminal for it.",
  ]);
  assert.deepStrictEqual(costLines({}), ['Tokens so far: 0 in · 0 out', "Cost isn't in the session file. Type /cost in the terminal for it."]);
});
```

(Merge the new names into the file's existing `require` line instead of a second `const { … } = require(…)` if ESLint
complains about it.)

- [ ] **Step 2: Run them, see them fail**

Run: `node --test test/claude-cli.test.js`
Expected: FAIL (`tokenCount is not a function`).

- [ ] **Step 3: Add to `src/renderer/panel/claude-cli.js`**, before its `return { … }`:

```js
  // ---- The status line, the workers and the slash commands ----

  /** A token count as the terminal writes it: 980, 12.3k, 123k, 1.2M. */
  function tokenCount(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v < 1000) return String(v);
    if (v < 100_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    if (v < 999_500) return `${Math.round(v / 1000)}k`;
    return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  const MODEL_LABELS = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }; // find.js's, for the page
  const MODEL_PICKS = ['opus', 'sonnet', 'haiku']; // what /model offers

  /** A model's id as people say it: claude-opus-5-5 is Opus 5.5. Anything else as it is. */
  function modelName(id) {
    const text = String(id ?? '');
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(text);
    if (!m) return text;
    const name = MODEL_LABELS[m[1]] || m[1][0].toUpperCase() + m[1].slice(1);
    return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  }

  /** How long something took: 12s, 1m 12s, 1h 5m. */
  function elapsed(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  /** The line under the session (live.js's stats): "Opus 5.5 · 1.2M in · 34k out"; '' before any reply. */
  function statusLine(stats) {
    if (!stats || (!stats.model && !stats.input && !stats.output)) return '';
    return [stats.model ? modelName(stats.model) : '', `${tokenCount(stats.input)} in`, `${tokenCount(stats.output)} out`].filter(Boolean).join(' · ');
  }

  const WORKER_STATUS = ['running', 'done', 'failed', 'stopped'];
  const RECENT_MS = 5 * 60_000; // a worker that ended shows this long after
  const MANY = 3; // more workers than this fold into one line

  /** One worker as a line: "Fix the login bug · running · 1m 12s · 12.3k tokens". */
  function workerLine(w, now) {
    const parts = [w.task, w.status];
    if (Number.isFinite(w.startedAt)) parts.push(elapsed((w.endedAt ?? now) - w.startedAt));
    if (w.tokens > 0) parts.push(`${tokenCount(w.tokens)} tokens`);
    return parts.join(' · ');
  }

  /**
   * The workers to show (live.js's workers): those running and those that ended in the last RECENT_MS, a line each;
   * `compact` when there are more than MANY, with `summary` for the one line ("4 workers · 2 running · 1 done").
   */
  function workerList(workers, now) {
    const shown = (Array.isArray(workers) ? workers : []).filter((w) => w && WORKER_STATUS.includes(w.status)
      && (w.status === 'running' || (Number.isFinite(w.endedAt) && now - w.endedAt < RECENT_MS)));
    const counts = WORKER_STATUS.map((s) => [s, shown.filter((w) => w.status === s).length]).filter(([, n]) => n > 0);
    return {
      lines: shown.map((w) => ({ id: w.id, status: w.status, text: workerLine(w, now) })),
      compact: shown.length > MANY,
      summary: [`${shown.length} worker${shown.length === 1 ? '' : 's'}`, ...counts.map(([s, n]) => `${n} ${s}`)].join(' · '),
    };
  }

  // The slash commands the Claude box knows, in the order /help and the suggestions list them.
  const COMMANDS = [
    { name: 'model', hint: 'pick the model: opus, sonnet or haiku' },
    { name: 'clear', hint: 'start a new conversation' },
    { name: 'stop', hint: 'stop what Claude is doing' },
    { name: 'cost', hint: 'tokens so far' },
    { name: 'help', hint: 'these commands' },
  ];

  /** The box's words as a slash command: { name, arg, known }, or null ("/" alone and a path like /Users/… are none). */
  function command(text) {
    const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
    if (!m) return null;
    const name = m[1].toLowerCase();
    return { name, arg: (m[2] || '').trim().toLowerCase(), known: COMMANDS.some((c) => c.name === name) };
  }

  /** While the box holds "/" and part of a name: the commands it could be. */
  function suggestions(text) {
    const m = /^\/([a-z]*)$/i.exec(String(text ?? '').trimStart());
    return m ? COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase())) : [];
  }

  const helpLines = () => COMMANDS.map((c) => `/${c.name} · ${c.hint}`);
  const unknownLine = (name) => `/${name} isn't a command here. Try /help.`;

  /** /cost: the session's tokens, its model and its workers' tokens. Transcripts have no cost. */
  function costLines(session) {
    const stats = session?.stats || {};
    const workers = Array.isArray(session?.workers) ? session.workers : [];
    const out = [`Tokens so far: ${tokenCount(stats.input)} in · ${tokenCount(stats.output)} out`];
    if (stats.model) out.push(`Model: ${modelName(stats.model)}`);
    if (workers.length) out.push(`Workers: ${workers.length} · ${tokenCount(workers.reduce((sum, w) => sum + (w.tokens || 0), 0))} tokens`);
    out.push("Cost isn't in the session file. Type /cost in the terminal for it.");
    return out;
  }
```

And extend the return:

```js
  return {
    toolCall, summaryText, rows, inline, blocks, tableLines, wrap, workingVerb, VERBS,
    tokenCount, modelName, elapsed, statusLine, workerList, command, suggestions, helpLines, unknownLine, costLines, COMMANDS, MODEL_PICKS, MODEL_LABELS,
  };
```

Add one line to the file's top comment: "It also words Claude mode's status line, its workers and its slash commands."

- [ ] **Step 4: Run them, see them pass**

Run: `node --test test/claude-cli.test.js`
Expected: PASS.

- [ ] **Step 5: Full suite and commit**

```bash
cd /Users/akshat/projects/buddy-claude-cli
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
git add src/renderer/panel/claude-cli.js test/claude-cli.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude mode: words for the status line, the workers and the slash commands"
```

---

### Task 4: The panel draws it (`index.html`, `panel.js`, `panel.css`)

**Files:**
- Modify: `src/renderer/panel/index.html`, `src/renderer/panel/panel.js`, `src/renderer/panel/panel.css`

No unit tests (the page is DOM; its logic is in Task 3). Checked by lint (`npm test`) and by hand.

- [ ] **Step 1: `index.html`**

After `<ol id="claude-items" …></ol>` (inside `#claude-session`) add:

```html
      <p id="claude-line" class="cl-line" aria-live="off" hidden></p>
```

Inside `.compose`, right before `<div id="box-frame" class="box">`, add:

```html
    <ul id="claude-suggest" class="cl-suggest" aria-label="Commands" hidden></ul>
```

- [ ] **Step 2: `panel.js` state and helpers**

Line 22, replace the ClaudeCli destructuring with:

```js
const {
  rows: cliRows, inline: cliInline, blocks: cliBlocks, tableLines, workingVerb,
  statusLine, workerList, command, suggestions, helpLines, unknownLine, costLines, MODEL_PICKS, MODEL_LABELS,
} = ClaudeCli; // Claude mode, as the terminal draws it
```

Line 38, the state gains the command answers and the clock for workers:

```js
// notes: the answers to slash commands, at the end of the session; tick: redraws while a worker runs.
const claude = { session: null, asked: null, talking: false, newest: 0, open: new Set(), notes: [], nextNote: 1, tick: null };
```

In `CLAUDE_WORDS` add:

```js
  pick: 'Pick a model. It works from your next message.',
  modelSet: (name) => `Model set to ${name}. It works from your next message.`,
```

- [ ] **Step 3: `panel.js` box: suggestions and Tab**

In `box.addEventListener('input', …)` add `showSuggest();` after `updateSend();`. At the top of the `keydown`
listener add:

```js
  // Tab takes the first suggested command.
  if (e.key === 'Tab' && !e.shiftKey && !$('claude-suggest').hidden) {
    e.preventDefault();
    $('claude-suggest').querySelector('button')?.click();
    return;
  }
```

In `applyMode()`, before `updateSend();`, add `if (!on || !claude.session) show($('claude-suggest'), false);`.

In `claudeOpen`, next to `claude.newest = 0; claude.open.clear();` add `claude.notes = [];`.

- [ ] **Step 4: `panel.js` drawing**

In `drawClaude`, after `const rows = cliRows(items).map(cliRow);` add `rows.push(...cliWorkers(session));`. After the
last `rows.push(…)` (the `noTalk` note) add `rows.push(...claude.notes.map(cliNote));`. At the end of `drawClaude` add:

```js
  const line = statusLine(session.stats);
  $('claude-line').textContent = line;
  show($('claude-line'), Boolean(line));
  keepTicking(session);
```

Add these functions right after `cliWorking`:

```js
/** The workers Claude started (ClaudeCli.workerList): a line each, or one line that unfolds when there are many. */
function cliWorkers(session) {
  const view = workerList(session.workers, Date.now());
  const line = (w) => {
    const li = make('li', `cl-worker ${w.status}`);
    li.append(make('span', 'cl-dot', w.status === 'running' ? '◌' : w.status === 'done' ? '●' : '✗'), make('p', '', w.text));
    return li;
  };
  if (!view.compact) return view.lines.map(line);
  const li = make('li', 'cl-workers');
  foldable(li, { type: 'workers', id: 0 }, [make('span', 'cl-mark', '⏺'), document.createTextNode(view.summary)], () => {
    const inner = make('ol', 'cl-inner');
    inner.append(...view.lines.map(line));
    return inner;
  });
  return [li];
}

/** While a worker runs, the session is drawn again every second, so that its time moves. */
function keepTicking(session) {
  const running = Array.isArray(session.workers) && session.workers.some((w) => w.status === 'running');
  if (running && !claude.tick) {
    claude.tick = setInterval(() => {
      if (mode === 'claude' && claude.session) drawClaude(claude.session);
      else keepTicking({});
    }, 1000);
  } else if (!running && claude.tick) {
    clearInterval(claude.tick);
    claude.tick = null;
  }
}

/** An answer to a slash command, at the end of the session (`picker`: with the models to pick from). */
function note(text, { picker = false } = {}) {
  claude.notes.push({ id: claude.nextNote++, text, picker });
  drawClaude(claude.session, { scroll: true });
}

function cliNote(n) {
  const li = make('li', 'cl-event');
  const words = make('div', 'cl-said');
  words.append(make('p', '', n.text));
  if (n.picker) {
    const picks = make('div', 'cl-picks');
    for (const alias of MODEL_PICKS) {
      const b = make('button', 'btn small', MODEL_LABELS[alias]);
      b.type = 'button';
      b.addEventListener('click', () => runCommand({ name: 'model', arg: alias, known: true }));
      picks.append(b);
    }
    words.append(picks);
  }
  li.append(make('span', 'cl-elbow', '⎿'), words);
  return li;
}
```

- [ ] **Step 5: `panel.js` commands**

In `talkToClaude`, right after `showSendError('');` add:

```js
  const cmd = command(text);
  if (cmd) {
    $('box').value = '';
    showSuggest();
    updateSend();
    return runCommand(cmd);
  }
```

Add after `talkToClaude`:

```js
/** A slash command from the box (ClaudeCli.command): answered here, or done in the session's terminal by main. */
async function runCommand(cmd) {
  if (!claude.session || claude.talking) return;
  if (!cmd.known) return note(unknownLine(cmd.name));
  if (cmd.name === 'help') return note(helpLines().join('\n'));
  if (cmd.name === 'cost') return note(costLines(claude.session).join('\n'));
  if (cmd.name === 'model' && !cmd.arg) return note(CLAUDE_WORDS.pick, { picker: true });
  const id = claude.session.id;
  claude.talking = true;
  updateSend();
  let r;
  try {
    if (cmd.name === 'model') r = await window.buddy.claudeModel(id, cmd.arg);
    else if (cmd.name === 'stop') r = await window.buddy.claudeStop(id);
    else r = await window.buddy.claudeClear(id);
  } finally {
    claude.talking = false;
    updateSend();
  }
  if (mode !== 'claude' || claude.session?.id !== id) return; // left meanwhile
  if (!r.ok) return showSendError(r.error.message);
  if (r.typed === false && r.message) showSendError(r.message); // copied, to paste in the terminal
  if (cmd.name === 'model') note(CLAUDE_WORDS.modelSet(MODEL_LABELS[r.model] || r.model));
  if (cmd.name !== 'clear') return;
  if (r.session) {
    claude.asked = r.session.id;
    claude.newest = 0;
    claude.open.clear();
    claude.notes = [];
    drawClaude(r.session, { scroll: true });
  } else if (r.typed) {
    claudeList();
  }
}

/** While the box holds "/" and part of a command's name: the commands it could be, above the box. */
function showSuggest() {
  const list = mode === 'claude' && claude.session ? suggestions(box.value) : [];
  $('claude-suggest').replaceChildren(...list.map((c) => {
    const b = make('button', 'cl-suggestion');
    b.type = 'button';
    b.append(make('strong', '', `/${c.name}`), document.createTextNode(`  ${c.hint}`));
    b.addEventListener('mousedown', (e) => e.preventDefault()); // the box keeps the focus
    b.addEventListener('click', () => {
      box.value = `/${c.name}`;
      showSuggest();
      updateSend();
      box.focus();
    });
    const li = make('li');
    li.append(b);
    return li;
  }));
  show($('claude-suggest'), list.length > 0);
}
```

- [ ] **Step 6: `panel.css`**, after the `.panel.cli .claude-items .cl-note` rule:

```css
.claude-items .cl-worker { display: flex; gap: 8px; padding-left: 2ch; color: var(--cli-dim); }
.claude-items .cl-worker.running .cl-dot { color: var(--cli-orange); }
.claude-items .cl-worker.done .cl-dot { color: var(--cli-green); }
.claude-items .cl-worker.failed .cl-dot, .claude-items .cl-worker.stopped .cl-dot { color: var(--cli-red); }
.claude-items .cl-workers .cl-fold { padding-left: 0; }
.cl-said { min-width: 0; }
.cl-picks { display: flex; gap: 6px; margin-top: 6px; }
.cl-line { flex: none; margin: 0; padding: 4px 12px; border-top: 1px solid var(--cli-line); color: var(--cli-dim); }
.cl-suggest { margin: 0 0 6px; padding: 4px 0; border: 1px solid var(--cli-line); border-radius: 6px; background: #0d0d0d; list-style: none; }
.cl-suggestion { display: block; width: 100%; padding: 2px 10px; border: 0; background: none; color: var(--cli-dim); font: inherit; text-align: left; cursor: pointer; }
.cl-suggestion strong { color: var(--cli-fg); font-weight: 400; }
.cl-suggestion:hover, .cl-suggestion:focus-visible { background: #1a1a1a; outline: none; }
```

- [ ] **Step 7: Lint + full suite**

```bash
cd /Users/akshat/projects/buddy-claude-cli
until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock
```

Expected: PASS, no ESLint errors (the panel's `/* global ChatView, ClaudeCli, VoiceTiming */` already covers ClaudeCli).

- [ ] **Step 8: By hand** (`npm start` in the worktree; a `claude` session open in iTerm2):

1. Claude mode → the session: the line under it shows `Opus 5.5 · … in · … out` after Claude's first reply.
2. Ask Claude "use 2 agents in parallel to look at X and Y": two worker lines appear with `running`, the time moving
   every second, tokens growing; then `done`. With 4+ workers: one line "4 workers · …" that unfolds on click.
3. Type `/`: five commands above the box; `/c` leaves clear and cost; Tab fills the first.
4. `/model` → three buttons; Haiku → `Model set to Haiku…`, the terminal shows Claude Code's model change, and
   Settings → AI shows Haiku for Claude Code. `/model gpt` → red line `There is no model called gpt…`.
5. `/cost`, `/help`, `/foo` answer as in the spec's copy table, nothing typed into the terminal.
6. While Claude works: `/stop` → Claude Code stops ("Interrupted by user" shows). In Terminal.app: the red line
   `I can only stop Claude in iTerm2. Press Esc in its terminal.`
7. `/clear` → the panel moves to the new session in the same terminal (or back to the list if none showed in 3 s).
8. A message typed while Claude works is still queued and shown once (unchanged).

- [ ] **Step 9: Commit**

```bash
cd /Users/akshat/projects/buddy-claude-cli
git add src/renderer/panel/index.html src/renderer/panel/panel.js src/renderer/panel/panel.css
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Claude mode: status line, live workers and slash commands in the panel"
```

---

## Follow-ups (not in this plan)

- Relay: add `stats` and `workers` to `share.js`'s shared view (two small fields) and draw them on the phone and the
  iPhone web app.
- The chat's coding job (`job.js`): feed its stream-json through `usage.js` (`parent_tool_use_id` marks a worker's
  lines; `result.usage` / `total_cost_usd` at the end) for a status line on the job card.
