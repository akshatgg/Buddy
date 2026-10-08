# Buddy watches Claude Code (piece 3) Implementation Plan

> **For agentic workers:** one worker, tasks in order on the `claude-code` branch (worktree
> `/Users/akshat/projects/buddy-claude`), on top of the base commit that holds `src/main/claude/find.js`,
> `src/main/ipc/claude.js` and Settings → Claude Code. Each task ends with `npm test` green and one commit. The contracts
> below are fixed: do not change a name, a shape or a channel. If a contract is wrong, stop and report it instead of
> working around it.

**Goal:** While the person works with Claude Code in a terminal, the buddy reacts: it thinks while Claude Code works,
is happy when it is done, waves and says so when Claude Code is waiting for them, and is sleepy (sad, later) when it
fails. Spec: `docs/superpowers/specs/2026-10-08-buddy-claude-code-watch-design.md`. Common ground (the finder, the
section, the `BUDDY_CLAUDE_CODE` mark): `2026-10-08-buddy-claude-code-brain-design.md` §2, already built.

**Architecture:** Buddy writes seven small command hooks into Claude Code's `settings.json` (`src/main/claude/hooks.js`:
pure merge/remove functions over the JSON, and a thin file layer with a one-time backup and atomic writes). Each hook
POSTs Claude Code's event JSON to a local HTTP server on `127.0.0.1` (`src/main/claude/watch.js`: a pure state machine
`(state, event) → { state, mood?, bubble? }` over a map of sessions, and a thin server around it that talks to the buddy
through main.js's `ui.mood` / `ui.bubble`). A switch in Settings → Claude Code turns it on and off through one IPC
channel; main.js starts it with Buddy and stops it when Buddy turns off.

**Tech Stack:** Electron 44, CommonJS, vanilla JS pages, `node --test`, ESLint. No new dependencies (`node:http`,
`node:crypto`, `node:fs`).

## Global Constraints

- Plain, friendly words in everything the person sees; match the comment density and style of the file you touch
  (`src/main/updates.js` and `src/main/ipc/updates.js` are the models).
- Every Settings IPC answer is `{ ok, ... }` through `guarded` (`src/main/ipc/result.js`); errors are
  `BuddyError(code, message)` (`shared/errors.js`).
- `npm test` (ESLint + unit tests) must pass before every commit. Tests are `test/<name>.test.js`, CommonJS, with fakes
  passed in. **No test may touch the real `~/.claude/settings.json`**: the hooks tests use an in-memory fs or a
  temporary folder; the e2e test passes its own file (Task 9).
- Only today's moods: `thinking`, `happy`, `wave`, `sleepy`, `idle`, and only through the one table `MOODS` in
  `watch.js` (so the later switch to `celebrate` / `sad` is one line there).
- Never edit `src/renderer/buddy/*`, `src/main/buddy-window.js`, `src/main/geometry.js`, `src/main/sleep.js`,
  `src/main/feelings.js`, `src/main/ipc/buddy.js`, `src/preload/buddy.js`, `art/*`, `assets/*`, `src/main/notch-*`,
  `src/main/home.js`, `src/renderer/notch/*`, `src/main/panel-window.js`, `src/main/actions.js`.
- In `src/main/main.js`, `src/main/store.js`, `src/main/ipc/settings.js` and `src/renderer/settings/*`: add new lines
  only, never move or delete one (other sessions hold lines of these files). The one exception the lead allowed: the
  existing `registerClaudeIpc({ ... })` line in main.js gains `watch` as a named argument (Task 8).
- `test/e2e/smoke.js`: at most one added line (Task 9).
- Commits: plain messages, no Co-Authored-By line and no AI-author credit anywhere (commits or files).
- `src/main/ipc/claude.js` as it really is in the base: `registerClaudeIpc({ ipcMain, allowed, find, openExternal })`
  (not `{ handle, find }` as the brief said). Build on the real file.

## Contracts

### W1. Settings keys (Task 1)

`src/main/store.js` DEFAULTS gain three keys, as three new lines after `listenOnOpen`:

```js
watchClaudeCode: false, // Settings → Claude Code's "Show me what Claude Code is doing" (src/main/claude/watch.js)
claudeHookPort: null, // the port Claude Code's hooks post to, picked on the first watch and kept (49152–65535)
claudeHookToken: null, // 16 random bytes as hex, part of the hooks' URL, so only Claude Code's hooks are heard
```

### W2. The hooks file (Tasks 2–3), `src/main/claude/hooks.js`

```js
HOOK_EVENTS = [            // [event, matcher]; null = the entry has no "matcher" (every match)
  ['UserPromptSubmit', null], ['PreToolUse', null], ['Stop', null], ['StopFailure', null], ['SessionEnd', null],
  ['PermissionRequest', null], ['Notification', 'permission_prompt|idle_prompt|agent_needs_input'],
]
hookCommand({ port, token, platform }) → string          // spec §3's two command strings, exactly
isBuddyHook(hook) → boolean                               // hook.command is a string containing '/claude-code/'
withHooks(json, { port, token, platform }) → json         // a new object: Buddy's entries replaced by the current ones
withoutHooks(json) → json                                 // a new object: Buddy's entries gone, the rest as it was
CANT_READ = "I couldn't read Claude Code's settings file, so I didn't change it."
createHooks({ find, home, file = null, fs = require('node:fs'), write = writeAtomic, platform = process.platform }) → {
  settingsFile(): Promise<string>,   // `file` when given; else <configDirectory>/settings.json, else <home>/.claude/settings.json
  shown(): string,                   // the last file settingsFile() answered, with <home> shortened to ~ (for the Settings line)
  install({ port, token }): Promise<boolean>,  // true when the file changed; BuddyError('claude_settings', CANT_READ) for a file that is not JSON
  remove(): Promise<boolean>,                  // same, removing
}
```
Each Buddy entry is `{ matcher?, hooks: [{ type: 'command', command, timeout: 3 }] }`, appended after the entries already
under that event. A missing file counts as `{}`. The first change copies the file to `<file>.before-buddy` once (never
overwritten). Writes go through `writeAtomic` from `src/main/store.js` as `JSON.stringify(json, null, 2) + '\n'`; no
write when nothing changed.

### W3. The watcher (Tasks 4–5), `src/main/claude/watch.js`

```js
MOODS = { working: 'thinking', done: 'happy', needsYou: 'wave', failed: 'sleepy', idle: 'idle' }
FORGET_AFTER_MS = 30 * 60 * 1000;  BODY_LIMIT = 64 * 1024;  PORT_MIN = 49152;  PORT_MAX = 65535
OFF_LINE = "Buddy adds a few small hooks to Claude Code's settings so it hears when Claude Code starts, finishes or needs you."
folderName(cwd) → string                                  // the last part of cwd (Mac or Windows separators); 'your project' when empty
parseEvent(text) → { name, sessionId, folder, matcher, error } | null   // null: not JSON, not one of the seven events, no session_id
newState() → { sessions: {}, overall: 'idle' }            // sessions: id → { working, needsYou, name, lastEvent, needTold }
apply(state, event, now) → { state, mood?, bubble? }      // pure; never mutates `state`
forget(state, now) → { state, mood? }                     // drops sessions quiet for FORGET_AFTER_MS or more
createWatch({ store, find, hooks, ui, chatBusy = () => false, now = Date.now, later, cancel, randomPort, newToken }) → {
  start(): Promise<{ port }>,   // listen (pick / re-pick the port, make the token), then hooks.install; a hooks failure is kept for line()
  stop(): void,                 // close, forget the sessions, idle if the watcher set the buddy's last mood; harmless twice
  setOn(on): Promise<{ on, line }>,  // saves watchClaudeCode; on: start (a hooks failure → stop, stays off, throws its words); off: stop + hooks.remove
  status(): { on, line },       // on = store watchClaudeCode === true
  tick(): void,                 // forget quiet sessions now (the timer calls it every minute; tests call it)
}
```
`later(fn, ms)` / `cancel(timer)` default to an unref'd `setTimeout` / `clearTimeout`; `randomPort()` defaults to
`crypto.randomInt(PORT_MIN, PORT_MAX + 1)`; `newToken()` to `crypto.randomBytes(16).toString('hex')`. `find` is accepted
(main.js passes it) and not read: the hooks module owns the finder. The line: a kept hooks failure → its words; on →
`Watching. Hooks are in <hooks.shown()>.`; off → `OFF_LINE`.

The rules (`apply`), for an event on session S, in this order:
- `UserPromptSubmit`, `PreToolUse`: S working, not needsYou, `needTold` false. If S was not working: no session was
  working before → mood `thinking`; else, with n ≥ 2 sessions now working → bubble `${n} sessions working`.
- `PermissionRequest`, `Notification`: S not working, needsYou. If S's `needTold` is false → mood `wave`, bubble
  `Claude Code needs you in <name><still>`, `needTold` true.
- `Stop`: S not working, not needsYou. No session working → mood `happy`. Bubble `Claude Code is done in <name><still>`.
- `StopFailure`: S not working, not needsYou. Mood `sleepy`. Bubble `Claude Code's limit is reached` when `matcher` or
  `error` is `rate_limit`, else `Claude Code hit a problem in <name><still>`.
- `SessionEnd`: S forgotten.
- Then `overall` = any needsYou → `needsYou`; any working → `working`; else `idle`. When the event gave no mood and
  `overall` turned `idle` from something else → mood `idle`.
`<still>` is ` (${k} still working)` for k ≥ 1 other sessions working, else ''. `forget` applies the same last step.

### W4. IPC and preload (Task 6)

`src/main/ipc/claude.js`: `registerClaudeIpc({ ipcMain, allowed, find, openExternal, watch })` gains the channel
`claude:watch` with one argument `on`: `true` / `false` → `await watch.setOn(on)`; `undefined` → `watch.status()`;
anything else → `BuddyError('bad_request', 'Watching Claude Code must be on or off.')`. Answer: `{ on, line }`.
`src/preload/settings.js`: `setClaudeWatch: (on) => ipcRenderer.invoke('claude:watch', on)` and
`claudeWatch: () => ipcRenderer.invoke('claude:watch')`.

### W5. The Settings block (Task 7)

Inside `<section id="section-claude">`, after the status row: `<div id="claude-watch" class="group">` with the switch
`#claude-watch-switch` (aria-label "Show me what Claude Code is doing"), its line `#claude-watch-line`, and a status line
`#claude-watch-status`. Dimmed (`disabled`) with the line `Install Claude Code first.` when `claudeStatus()` says not
installed.

### W6. main.js (Task 8)

New lines: the two requires; `const hooks = createHooks({ find, home: app.getPath('home'), file: options.claudeSettingsFile })`
after the `find` line; `const watch = createWatch({ store, find, hooks, ui, chatBusy: () => false })` after `actions`
is made; `watch` passed to `registerClaudeIpc`; a start line in both places Buddy turns on (power.onChange and the
launch block) guarded by `store.get('watchClaudeCode') === true`; `watch.stop()` where Buddy turns off.

---

### Task 1: the three settings keys

**Files:**
- Modify: `src/main/store.js` (DEFAULTS, three new lines after line 30 `listenOnOpen: ...`)
- Test: `test/store.test.js` (append)

**Interfaces:** Produces W1.

- [ ] Append the failing test to `test/store.test.js`:

```js
test('Claude Code is not watched until the person asks; the port and the token come with the first watch', (t) => {
  const store = createStore({ file: tmpFile(t) });
  assert.strictEqual(store.get('watchClaudeCode'), false);
  assert.strictEqual(store.get('claudeHookPort'), null);
  assert.strictEqual(store.get('claudeHookToken'), null);
});
```

- [ ] Run `node --test test/store.test.js` → 1 failing: `watchClaudeCode` is `undefined`, not `false`.
- [ ] Add the three lines of W1 to DEFAULTS, directly after the `listenOnOpen` line.
- [ ] Run `node --test test/store.test.js` → all pass. `npm test` → green.
- [ ] Commit: `git add src/main/store.js test/store.test.js && git commit -m "Claude Code watch: the three settings keys"`

---

### Task 2: the hooks, pure — the commands and the merge / remove

**Files:**
- Create: `src/main/claude/hooks.js`
- Test: `test/claude-hooks.test.js` (new)

**Interfaces:** Produces `HOOK_EVENTS`, `hookCommand`, `isBuddyHook`, `withHooks`, `withoutHooks` (W2). Consumes nothing.

- [ ] Write `test/claude-hooks.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HOOK_EVENTS, hookCommand, isBuddyHook, withHooks, withoutHooks } = require('../src/main/claude/hooks');

const PORT = 51234;
const TOKEN = '0123456789abcdef0123456789abcdef';
const MAC = { port: PORT, token: TOKEN, platform: 'darwin' };
const URL = `http://127.0.0.1:${PORT}/claude-code/${TOKEN}`;
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'Notification'];

// The owner's own settings.json, in short: a status command on several events, and other settings around it.
const STATUS = '/Users/akshat/.config/iterm2/cc-status';
const OWNER = Object.freeze({
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: STATUS }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: STATUS }] }],
    Stop: [{ hooks: [{ type: 'command', command: STATUS }] }],
  },
});

test('the Mac command sends the event to Buddy, skips Buddy\'s own runs, and always exits 0', () => {
  assert.strictEqual(
    hookCommand(MAC),
    `[ -n "$BUDDY_CLAUDE_CODE" ] || curl -s -m 2 -X POST --data-binary @- ${URL} >/dev/null 2>&1; exit 0`,
  );
});

test('the Windows command is the same bash command: Claude Code runs hooks in Git Bash there, never in cmd', () => {
  assert.strictEqual(hookCommand({ ...MAC, platform: 'win32' }), hookCommand(MAC));
});

test('a Buddy hook is known by /claude-code/ in its command', () => {
  assert.strictEqual(isBuddyHook({ type: 'command', command: hookCommand(MAC) }), true);
  assert.strictEqual(isBuddyHook({ type: 'command', command: STATUS }), false);
  assert.strictEqual(isBuddyHook({ type: 'prompt', prompt: 'say /claude-code/' }), false);
  assert.strictEqual(isBuddyHook(null), false);
});

test('on: one entry on each of the seven events, after the entries already there, and nothing else changes', () => {
  const out = withHooks(OWNER, MAC);
  assert.deepStrictEqual(Object.keys(out.hooks).sort(), [...EVENTS].sort());
  for (const [event, matcher] of HOOK_EVENTS) {
    const entries = out.hooks[event];
    const mine = entries[entries.length - 1];
    assert.deepStrictEqual(mine, {
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: hookCommand(MAC), timeout: 3 }],
    }, event);
  }
  assert.deepStrictEqual(out.hooks.PreToolUse[0], OWNER.hooks.PreToolUse[0], 'the owner\'s Bash status hook stays first');
  assert.strictEqual(out.hooks.Stop.length, 2);
  assert.strictEqual(out.hooks.SessionEnd.length, 1);
  assert.strictEqual(out.model, 'opus');
  assert.deepStrictEqual(out.permissions, OWNER.permissions);
  assert.strictEqual(out.hooks.Notification[0].matcher, 'permission_prompt|idle_prompt|agent_needs_input');
  assert.ok(!('matcher' in out.hooks.Stop[1]), 'Stop has no matcher');
});

test('on twice is the same as once, and a new port replaces the old entries', () => {
  const once = withHooks(OWNER, MAC);
  assert.deepStrictEqual(withHooks(once, MAC), once);
  const moved = withHooks(once, { ...MAC, port: 60000 });
  assert.strictEqual(moved.hooks.Stop.length, 2);
  assert.ok(moved.hooks.Stop[1].hooks[0].command.includes(':60000/'));
  assert.ok(!JSON.stringify(moved).includes(`:${PORT}/`), 'the old port is gone');
});

test('on works on a file with no hooks, and on an empty file', () => {
  const out = withHooks({ model: 'opus' }, MAC);
  assert.strictEqual(out.model, 'opus');
  assert.strictEqual(Object.keys(out.hooks).length, 7);
  assert.strictEqual(Object.keys(withHooks({}, MAC).hooks).length, 7);
});

test('off leaves the file as it was, as JSON', () => {
  assert.deepStrictEqual(withoutHooks(withHooks(OWNER, MAC)), OWNER);
  assert.deepStrictEqual(withoutHooks(withHooks({ model: 'opus' }, MAC)), { model: 'opus' });
  assert.deepStrictEqual(withoutHooks(withHooks({}, MAC)), {});
  assert.deepStrictEqual(withoutHooks(OWNER), OWNER, 'nothing to remove: nothing changes');
});

test('off removes only Buddy\'s hook from an entry that holds others too', () => {
  const shared = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: STATUS }, { type: 'command', command: hookCommand(MAC) }] }] },
  };
  assert.deepStrictEqual(withoutHooks(shared), { hooks: { Stop: [{ hooks: [{ type: 'command', command: STATUS }] }] } });
});

test('neither on nor off changes the object it was given', () => {
  const input = structuredClone(OWNER);
  withHooks(input, MAC);
  withoutHooks(withHooks(input, MAC));
  assert.deepStrictEqual(input, OWNER);
});

test('a hooks value that is not an object is left alone by off and replaced by on', () => {
  assert.deepStrictEqual(withoutHooks({ hooks: 'odd' }), { hooks: 'odd' });
  assert.strictEqual(Object.keys(withHooks({ hooks: 'odd' }, MAC).hooks).length, 7);
});
```

- [ ] Run `node --test test/claude-hooks.test.js` → fails: `Cannot find module '../src/main/claude/hooks'`.
- [ ] Create `src/main/claude/hooks.js` with the pure part (the file layer comes in Task 3):

```js
'use strict';

/**
 * Buddy's hooks in Claude Code's settings.json (spec 2026-10-08-buddy-claude-code-watch-design.md §3). Seven small
 * command hooks, one on each event Buddy listens for, POST the event's JSON to Buddy's local port (watch.js). Each
 * command always exits 0, so it never blocks or slows Claude Code, and when Buddy is not running nothing happens.
 * Buddy's own Claude Code runs carry BUDDY_CLAUDE_CODE=1 (find.js ENV_MARK) and send nothing.
 *
 * withHooks / withoutHooks are plain functions over the file's JSON: the person's own hooks stay exactly as they were,
 * Buddy's entries are known by the "/claude-code/" in their command. createHooks is the thin file layer around them.
 */

// The events Buddy listens for, and the matcher each entry carries (null: none, which Claude Code reads as every
// tool, every error). Notification is narrowed to the kinds that mean "Claude Code is waiting for you".
const HOOK_EVENTS = Object.freeze([
  ['UserPromptSubmit', null],
  ['PreToolUse', null],
  ['Stop', null],
  ['StopFailure', null],
  ['SessionEnd', null],
  ['PermissionRequest', null],
  ['Notification', 'permission_prompt|idle_prompt|agent_needs_input'],
]);
const MARK = '/claude-code/'; // in every Buddy command: how its entries are told from the person's own
const HOOK_TIMEOUT_S = 3;
const CANT_READ = "I couldn't read Claude Code's settings file, so I didn't change it.";

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/**
 * The shell command of a Buddy hook: curl the event (stdin) to Buddy, unless this is one of Buddy's own runs. The same
 * on every platform: Claude Code runs hook commands in bash (Git Bash on Windows), never in cmd.exe. On a Windows
 * machine without Git Bash it runs them in PowerShell, where this fails without blocking (watching does not work there).
 */
function hookCommand({ port, token }) {
  const url = `http://127.0.0.1:${port}${MARK}${token}`;
  return `[ -n "$BUDDY_CLAUDE_CODE" ] || curl -s -m 2 -X POST --data-binary @- ${url} >/dev/null 2>&1; exit 0`;
}

function isBuddyHook(hook) {
  return isPlainObject(hook) && typeof hook.command === 'string' && hook.command.includes(MARK);
}

const hasBuddyHook = (entry) => isPlainObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some(isBuddyHook);

/** The JSON without Buddy's entries: an entry emptied by that goes, an event emptied by that goes, nothing else moves. */
function withoutHooks(json) {
  const out = structuredClone(json);
  if (!isPlainObject(out.hooks)) return out;
  let removedAny = false;
  for (const [event, entries] of Object.entries(out.hooks)) {
    if (!Array.isArray(entries) || !entries.some(hasBuddyHook)) continue;
    removedAny = true;
    const rest = entries.flatMap((entry) => {
      if (!hasBuddyHook(entry)) return [entry];
      const hooks = entry.hooks.filter((hook) => !isBuddyHook(hook));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    if (rest.length) out.hooks[event] = rest;
    else delete out.hooks[event];
  }
  if (removedAny && Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

/** The JSON with Buddy's entries for this port and token, after whatever the person has on each event. */
function withHooks(json, { port, token, platform }) {
  const out = withoutHooks(json);
  const hooks = isPlainObject(out.hooks) ? out.hooks : {};
  const command = hookCommand({ port, token, platform });
  for (const [event, matcher] of HOOK_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...entries, { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] }];
  }
  out.hooks = hooks;
  return out;
}

module.exports = { HOOK_EVENTS, CANT_READ, hookCommand, isBuddyHook, withHooks, withoutHooks };
```
  (The requires of `path`, `BuddyError` and `writeAtomic`, and `BACKUP_SUFFIX`, come in Task 3 with the file layer:
  ESLint's `no-unused-vars` would fail on them now.)

- [ ] Run `node --test test/claude-hooks.test.js` → all pass. `npm test` → green.
- [ ] Commit: `git add src/main/claude/hooks.js test/claude-hooks.test.js && git commit -m "Claude Code watch: the hook commands and the settings.json merge"`

---

### Task 3: the hooks file layer — read, backup once, write atomically

**Files:**
- Modify: `src/main/claude/hooks.js` (append `createHooks`; add the three requires)
- Test: `test/claude-hooks.test.js` (append)

**Interfaces:** Produces `createHooks` (W2). Consumes `writeAtomic` (`src/main/store.js`), `find.status()` (base).

- [ ] Append to `test/claude-hooks.test.js`:

```js
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHooks, CANT_READ } = require('../src/main/claude/hooks');

const HOME = '/Users/someone';

/** A fake fs over a Map of path → text, and createHooks on it (writes land in the Map, through `write`, not writeAtomic). */
function fakeHooks({ files = {}, configDirectory = null, file = null } = {}) {
  const disk = new Map(Object.entries(files));
  const fakeFs = {
    existsSync: (p) => disk.has(p),
    readFileSync: (p) => { if (!disk.has(p)) throw new Error('ENOENT'); return disk.get(p); },
    copyFileSync: (from, to) => disk.set(to, disk.get(from)),
  };
  const asked = [];
  const find = { status: async () => { asked.push(1); return { installed: true, configDirectory }; } };
  const writes = [];
  const hooks = createHooks({
    find, home: HOME, file, fs: fakeFs, platform: 'darwin',
    write: (p, text) => { writes.push(p); disk.set(p, text); },
  });
  return { hooks, disk, writes, asked };
}

const DEFAULT_FILE = `${HOME}/.claude/settings.json`;
const read = (disk, p) => JSON.parse(disk.get(p));

test('the file is Claude Code\'s own config folder, else ~/.claude, and the test\'s own file wins', async () => {
  assert.strictEqual(await fakeHooks().hooks.settingsFile(), DEFAULT_FILE);
  assert.strictEqual(await fakeHooks({ configDirectory: '/elsewhere/claude' }).hooks.settingsFile(), '/elsewhere/claude/settings.json');
  const own = fakeHooks({ configDirectory: '/elsewhere/claude', file: '/tmp/e2e/settings.json' });
  assert.strictEqual(await own.hooks.settingsFile(), '/tmp/e2e/settings.json');
  assert.deepStrictEqual(own.asked, [], 'Claude Code is not asked when the file is given');
});

test('shown() is the file with the home folder as ~', async () => {
  const { hooks } = fakeHooks();
  assert.strictEqual(hooks.shown(), '~/.claude/settings.json');
  const far = fakeHooks({ configDirectory: '/elsewhere/claude' });
  await far.hooks.settingsFile();
  assert.strictEqual(far.hooks.shown(), '/elsewhere/claude/settings.json');
});

test('install writes the merged file and keeps a copy from before, once', async () => {
  const before = JSON.stringify(OWNER, null, 4);
  const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: before } });
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), withHooks(OWNER, MAC));
  assert.strictEqual(disk.get(`${DEFAULT_FILE}.before-buddy`), before, 'the backup is the file as it was');
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  // The same again: nothing to write. Another port: written, and the backup is still the first copy.
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), false);
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  assert.strictEqual(await hooks.install({ port: 60000, token: TOKEN }), true);
  assert.strictEqual(disk.get(`${DEFAULT_FILE}.before-buddy`), before);
});

test('install on a missing file makes it, with Buddy\'s hooks only and no backup', async () => {
  const { hooks, disk } = fakeHooks();
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), withHooks({}, MAC));
  assert.strictEqual(disk.has(`${DEFAULT_FILE}.before-buddy`), false);
});

test('remove puts the file back as JSON, and does nothing to a file without Buddy\'s hooks', async () => {
  const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: JSON.stringify(withHooks(OWNER, MAC)) } });
  assert.strictEqual(await hooks.remove(), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), OWNER);
  assert.strictEqual(await hooks.remove(), false);
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  const none = fakeHooks();
  assert.strictEqual(await none.hooks.remove(), false);
  assert.strictEqual(none.disk.size, 0, 'no file is made just to remove nothing');
});

test('a file that is not JSON is left alone, and the switch is told why', async () => {
  for (const text of ['{ "hooks": [1,], }', '[]', '"a string"']) {
    const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: text } });
    await assert.rejects(hooks.install({ port: PORT, token: TOKEN }), { name: 'BuddyError', code: 'claude_settings', message: CANT_READ });
    await assert.rejects(hooks.remove(), { code: 'claude_settings' });
    assert.strictEqual(disk.get(DEFAULT_FILE), text);
    assert.deepStrictEqual(writes, []);
    assert.strictEqual(disk.has(`${DEFAULT_FILE}.before-buddy`), false, 'no backup of a file that was not changed');
  }
});

test('the same bash command goes into the file on Windows', async () => {
  const disk = new Map();
  const hooks = createHooks({
    find: { status: async () => ({ configDirectory: null }) }, home: 'C:\\Users\\someone', platform: 'win32',
    fs: { existsSync: (p) => disk.has(p), readFileSync: (p) => disk.get(p), copyFileSync: () => {} },
    write: (p, text) => disk.set(p, text),
  });
  await hooks.install({ port: PORT, token: TOKEN });
  const file = [...disk.keys()][0];
  assert.ok(file.endsWith(path.join('.claude', 'settings.json')));
  assert.ok(disk.get(file).includes('[ -n \\"$BUDDY_CLAUDE_CODE\\" ] || curl'));
  assert.ok(!disk.get(file).includes('exit /b'));
});

test('with the real fs, the file is written whole through writeAtomic and no temporary file is left', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(OWNER));
  const hooks = createHooks({ find: { status: async () => { throw new Error('not asked'); } }, home: dir, file, platform: 'darwin' });
  await hooks.install({ port: PORT, token: TOKEN });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), withHooks(OWNER, MAC));
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('}\n'), 'pretty, with a last newline');
  assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
  assert.strictEqual(fs.readFileSync(`${file}.before-buddy`, 'utf8'), JSON.stringify(OWNER));
  await hooks.remove();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), OWNER);
});
```

- [ ] Run `node --test test/claude-hooks.test.js` → the new tests fail: `createHooks is not a function`.
- [ ] Add the three requires at the top of `hooks.js` (after `'use strict';`):

```js
const path = require('node:path');
const { BuddyError } = require('../../../shared/errors');
const { writeAtomic } = require('../store');
```

  the constant `const BACKUP_SUFFIX = '.before-buddy';` next to `HOOK_TIMEOUT_S`, and append `createHooks` before
  `module.exports`, then export it:

```js
/**
 * The file layer: which settings.json (Claude Code's own config folder, from `claude auth status`, else ~/.claude;
 * `file` wins when given, which is how the end-to-end test keeps away from the real one), a copy before the first
 * change, and whole-file writes. `fs` and `write` are passed in by the unit tests.
 */
function createHooks({ find, home, file = null, fs = require('node:fs'), write = writeAtomic, platform = process.platform }) {
  let lastFile = file || path.join(home, '.claude', 'settings.json');

  async function settingsFile() {
    if (file) return file;
    const dir = (await find.status())?.configDirectory || path.join(home, '.claude');
    lastFile = path.join(dir, 'settings.json');
    return lastFile;
  }

  /** The file as Settings names it: the home folder shortened to ~. */
  function shown() {
    return lastFile.startsWith(home) ? `~${lastFile.slice(home.length)}` : lastFile;
  }

  /** The file's JSON; {} when there is no file; a file Buddy cannot read as an object is never touched. */
  function read(target) {
    if (!fs.existsSync(target)) return {};
    try {
      const json = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!isPlainObject(json)) throw new Error('not an object');
      return json;
    } catch {
      throw new BuddyError('claude_settings', CANT_READ);
    }
  }

  /** Write `after` when it differs from `before`; the first write keeps a copy of the file as it was. */
  function save(target, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const backup = `${target}${BACKUP_SUFFIX}`;
    if (fs.existsSync(target) && !fs.existsSync(backup)) fs.copyFileSync(target, backup);
    write(target, `${JSON.stringify(after, null, 2)}\n`);
    return true;
  }

  async function change(update) {
    const target = await settingsFile();
    const before = read(target);
    return save(target, before, update(before));
  }

  return {
    settingsFile,
    shown,
    install: ({ port, token }) => change((json) => withHooks(json, { port, token, platform })),
    remove: () => change(withoutHooks),
  };
}
```

  `module.exports = { HOOK_EVENTS, CANT_READ, hookCommand, isBuddyHook, withHooks, withoutHooks, createHooks };`

- [ ] Run `node --test test/claude-hooks.test.js` → all pass. `npm test` → green.
- [ ] Commit: `git add src/main/claude/hooks.js test/claude-hooks.test.js && git commit -m "Claude Code watch: read, back up and write Claude Code's settings file"`

---

### Task 4: the watcher, pure — events, sessions, moods and bubbles

**Files:**
- Create: `src/main/claude/watch.js` (the pure half)
- Test: `test/claude-watch-rules.test.js` (new)

**Interfaces:** Produces `MOODS`, `FORGET_AFTER_MS`, `folderName`, `parseEvent`, `newState`, `apply`, `forget` (W3).

- [ ] Write `test/claude-watch-rules.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { MOODS, FORGET_AFTER_MS, folderName, parseEvent, newState, apply, forget } = require('../src/main/claude/watch');

/** An event as parseEvent gives it, for session `session` in my-app. */
const ev = (name, session = 's1', extra = {}) => ({ name, sessionId: session, folder: 'my-app', matcher: '', error: '', ...extra });

/** Run events through apply from a fresh state; `out` has one { mood, bubble } per event (null for none). */
function run(events, now = () => 1000) {
  let state = newState();
  const out = [];
  for (const e of events) {
    const r = apply(state, e, now());
    state = r.state;
    out.push({ mood: r.mood ?? null, bubble: r.bubble ?? null });
  }
  return { state, out };
}
const none = { mood: null, bubble: null };

test('the moods of this piece, in one table', () => {
  assert.deepStrictEqual(MOODS, { working: 'thinking', done: 'happy', needsYou: 'wave', failed: 'sleepy', idle: 'idle' });
  assert.strictEqual(FORGET_AFTER_MS, 30 * 60 * 1000);
});

test('a session is named after the last part of its folder, on the Mac and on Windows', () => {
  assert.strictEqual(folderName('/Users/someone/code/my-app'), 'my-app');
  assert.strictEqual(folderName('/Users/someone/code/my-app/'), 'my-app');
  assert.strictEqual(folderName('C:\\Users\\someone\\code\\my-app'), 'my-app');
  assert.strictEqual(folderName(''), 'your project');
});

test('parseEvent reads what the hook sends, and refuses what is not an event', () => {
  const text = JSON.stringify({ hook_event_name: 'StopFailure', session_id: 'abc', cwd: '/x/my-app', matcher: 'rate_limit', error: 'Rate limit reached' });
  assert.deepStrictEqual(parseEvent(text), { name: 'StopFailure', sessionId: 'abc', folder: 'my-app', matcher: 'rate_limit', error: 'Rate limit reached' });
  assert.deepStrictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop', session_id: 'abc' })), { name: 'Stop', sessionId: 'abc', folder: 'your project', matcher: '', error: '' });
  assert.strictEqual(parseEvent('not json'), null);
  assert.strictEqual(parseEvent('[]'), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 'abc' })), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop' })), null);
  assert.strictEqual(parseEvent(JSON.stringify({ hook_event_name: 'Stop', session_id: 7 })), null);
});

test('working: thinking once when the first session starts, not on every tool', () => {
  const { state, out } = run([ev('UserPromptSubmit'), ev('PreToolUse'), ev('PreToolUse')]);
  assert.deepStrictEqual(out, [{ mood: 'thinking', bubble: null }, none, none]);
  assert.strictEqual(state.overall, 'working');
  assert.strictEqual(state.sessions.s1.working, true);
  assert.strictEqual(state.sessions.s1.name, 'my-app');
});

test('done: happy and the bubble when nothing else is working', () => {
  const { state, out } = run([ev('UserPromptSubmit'), ev('Stop')]);
  assert.deepStrictEqual(out[1], { mood: 'happy', bubble: 'Claude Code is done in my-app' });
  assert.strictEqual(state.overall, 'idle');
  assert.strictEqual(state.sessions.s1.working, false);
});

test('needs you: wave and the bubble once per need, again only after the session worked again', () => {
  const { out } = run([
    ev('UserPromptSubmit'), ev('PermissionRequest'), ev('Notification'), ev('PreToolUse'), ev('PermissionRequest'),
  ]);
  assert.deepStrictEqual(out[1], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
  assert.deepStrictEqual(out[2], none, 'a second ask for the same need says nothing');
  assert.deepStrictEqual(out[3], { mood: 'thinking', bubble: null }, 'the permission was given: working again');
  assert.deepStrictEqual(out[4], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
});

test('a need before any work is still a wave', () => {
  const { out } = run([ev('Notification')]);
  assert.deepStrictEqual(out[0], { mood: 'wave', bubble: 'Claude Code needs you in my-app' });
});

test('failed: sleepy and the bubble; the limit has its own words', () => {
  const { out } = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { error: 'Something broke' })]);
  assert.deepStrictEqual(out[1], { mood: 'sleepy', bubble: 'Claude Code hit a problem in my-app' });
  const limit = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { matcher: 'rate_limit' })]);
  assert.deepStrictEqual(limit.out[1], { mood: 'sleepy', bubble: "Claude Code's limit is reached" });
  const byError = run([ev('UserPromptSubmit'), ev('StopFailure', 's1', { error: 'rate_limit' })]);
  assert.strictEqual(byError.out[1].bubble, "Claude Code's limit is reached");
});

test('several sessions: the count in the bubble, and thinking stays while one still works', () => {
  const { state, out } = run([
    ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('PreToolUse', 'b'), ev('Stop', 'a'), ev('Stop', 'b'),
  ]);
  assert.deepStrictEqual(out[0], { mood: 'thinking', bubble: null });
  assert.deepStrictEqual(out[1], { mood: null, bubble: '2 sessions working' });
  assert.deepStrictEqual(out[2], none, 'a tool in a session already working says nothing');
  assert.deepStrictEqual(out[3], { mood: null, bubble: 'Claude Code is done in my-app (1 still working)' });
  assert.deepStrictEqual(out[4], { mood: 'happy', bubble: 'Claude Code is done in my-app' });
  assert.strictEqual(state.overall, 'idle');
});

test('a need in one session while another works says how many still work', () => {
  const { out } = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('PermissionRequest', 'a')]);
  assert.deepStrictEqual(out[2], { mood: 'wave', bubble: 'Claude Code needs you in my-app (1 still working)' });
  const failed = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('StopFailure', 'a')]);
  assert.deepStrictEqual(failed.out[2], { mood: 'sleepy', bubble: 'Claude Code hit a problem in my-app (1 still working)' });
});

test('a session that ends is forgotten; the buddy goes idle when nothing is left to wait for', () => {
  const waved = run([ev('UserPromptSubmit'), ev('PermissionRequest'), ev('SessionEnd')]);
  assert.deepStrictEqual(waved.out[2], { mood: 'idle', bubble: null });
  assert.deepStrictEqual(waved.state.sessions, {});
  const done = run([ev('UserPromptSubmit'), ev('Stop'), ev('SessionEnd')]);
  assert.deepStrictEqual(done.out[2], none, 'after happy, nothing more: happy stays');
  const two = run([ev('UserPromptSubmit', 'a'), ev('UserPromptSubmit', 'b'), ev('SessionEnd', 'a')]);
  assert.deepStrictEqual(two.out[2], none, 'b still works: thinking stays');
});

test('an unknown session ending is nothing', () => {
  const { state, out } = run([ev('SessionEnd', 'ghost')]);
  assert.deepStrictEqual(out[0], none);
  assert.deepStrictEqual(state, newState());
});

test('a session quiet for 30 minutes is forgotten, and the buddy goes idle if it was waiting on it', () => {
  // old's last event at 60 000, new's at 120 000.
  let clock = 0;
  const { state } = run([ev('UserPromptSubmit', 'old'), ev('UserPromptSubmit', 'new')], () => (clock += 60_000));
  const kept = forget(state, 60_000 + FORGET_AFTER_MS - 1);
  assert.deepStrictEqual(Object.keys(kept.state.sessions), ['old', 'new']);
  assert.strictEqual(kept.mood, undefined);
  const older = forget(state, 60_000 + FORGET_AFTER_MS);
  assert.deepStrictEqual(Object.keys(older.state.sessions), ['new'], 'the older one is gone, the newer stays');
  assert.strictEqual(older.mood, undefined, 'new still works: thinking stays');
  const all = forget(state, 120_000 + FORGET_AFTER_MS);
  assert.deepStrictEqual(all.state.sessions, {});
  assert.strictEqual(all.mood, 'idle');
  assert.strictEqual(all.state.overall, 'idle');
});

test('apply and forget never change the state they are given', () => {
  const state = run([ev('UserPromptSubmit')]).state;
  const copy = structuredClone(state);
  apply(state, ev('Stop'), 5000);
  forget(state, 10 ** 9);
  assert.deepStrictEqual(state, copy);
});
```

- [ ] Run `node --test test/claude-watch-rules.test.js` → fails: `Cannot find module '../src/main/claude/watch'`.
- [ ] Create `src/main/claude/watch.js` with the pure half (the server is Task 5):

```js
'use strict';

/**
 * Buddy watches Claude Code (spec 2026-10-08-buddy-claude-code-watch-design.md §4). The hooks in Claude Code's
 * settings.json (hooks.js) POST each event to a small HTTP server here, on 127.0.0.1 only, at a port and a token kept
 * in Buddy's settings. The events move a map of sessions, and the sessions move the buddy: thinking while any works,
 * happy when one is done, a wave and a bubble when one waits for the person, sleepy when one fails, idle when nothing
 * is left. The rules are plain functions over the state (apply, forget), the server is a thin layer around them.
 *
 * MOODS is the one place the mood names live: the feelings PR changes happy → celebrate and sleepy → sad here.
 */

const MOODS = Object.freeze({ working: 'thinking', done: 'happy', needsYou: 'wave', failed: 'sleepy', idle: 'idle' });
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'Notification'];
const FORGET_AFTER_MS = 30 * 60 * 1000; // a session with no event for this long is forgotten
const OFF_LINE = "Buddy adds a few small hooks to Claude Code's settings so it hears when Claude Code starts, finishes or needs you.";

/** The last part of a folder's path, Mac or Windows; 'your project' when there is none. */
function folderName(cwd) {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'your project';
}

/** The event a hook sent (Claude Code's JSON on its stdin), or null for anything that is not one of ours. */
function parseEvent(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (Object.prototype.toString.call(json) !== '[object Object]') return null;
  if (!EVENTS.includes(json.hook_event_name) || typeof json.session_id !== 'string' || !json.session_id) return null;
  const str = (value) => (typeof value === 'string' ? value : '');
  return { name: json.hook_event_name, sessionId: json.session_id, folder: folderName(str(json.cwd)), matcher: str(json.matcher), error: str(json.error) };
}

const newState = () => ({ sessions: {}, overall: 'idle' });
const working = (sessions) => Object.values(sessions).filter((s) => s.working).length;
const needing = (sessions) => Object.values(sessions).some((s) => s.needsYou);
/** " (1 still working)" for the bubble, when other sessions still work. */
const still = (sessions) => (working(sessions) ? ` (${working(sessions)} still working)` : '');
const isRateLimit = (event) => event.matcher === 'rate_limit' || event.error === 'rate_limit';

/** The last step of apply and forget: what the whole picture is, and idle when nothing is left and nothing else was said. */
function settle(sessions, previous, mood, bubble) {
  const overall = needing(sessions) ? 'needsYou' : working(sessions) ? 'working' : 'idle';
  const out = { state: { sessions, overall } };
  if (!mood && overall === 'idle' && previous.overall !== 'idle') mood = MOODS.idle;
  if (mood) out.mood = mood;
  if (bubble) out.bubble = bubble;
  return out;
}

/** One event → the next state, and the mood and bubble to show for it, if any. Pure: `state` is not changed. */
function apply(state, event, now) {
  const sessions = { ...state.sessions };
  const id = event.sessionId;
  const before = sessions[id] ?? { working: false, needsYou: false, name: event.folder, lastEvent: now, needTold: false };
  const wasWorking = working(sessions) > 0;
  const s = { ...before, name: event.folder, lastEvent: now };
  let mood = null;
  let bubble = null;
  switch (event.name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
      sessions[id] = { ...s, working: true, needsYou: false, needTold: false };
      if (!before.working) {
        if (!wasWorking) mood = MOODS.working;
        else bubble = `${working(sessions)} sessions working`;
      }
      break;
    case 'PermissionRequest':
    case 'Notification':
      sessions[id] = { ...s, working: false, needsYou: true, needTold: true };
      if (!before.needTold) {
        mood = MOODS.needsYou;
        bubble = `Claude Code needs you in ${s.name}${still(sessions)}`;
      }
      break;
    case 'Stop':
      sessions[id] = { ...s, working: false, needsYou: false };
      if (!working(sessions)) mood = MOODS.done;
      bubble = `Claude Code is done in ${s.name}${still(sessions)}`;
      break;
    case 'StopFailure':
      sessions[id] = { ...s, working: false, needsYou: false };
      mood = MOODS.failed;
      bubble = isRateLimit(event) ? "Claude Code's limit is reached" : `Claude Code hit a problem in ${s.name}${still(sessions)}`;
      break;
    case 'SessionEnd':
      delete sessions[id];
      break;
    default:
      break;
  }
  return settle(sessions, state, mood, bubble);
}

/** Drop the sessions quiet for FORGET_AFTER_MS or more; idle when that leaves nothing to wait for. */
function forget(state, now) {
  const sessions = Object.fromEntries(Object.entries(state.sessions).filter(([, s]) => now - s.lastEvent < FORGET_AFTER_MS));
  return settle(sessions, state, null, null);
}

module.exports = { MOODS, FORGET_AFTER_MS, OFF_LINE, folderName, parseEvent, newState, apply, forget };
```

- [ ] Run `node --test test/claude-watch-rules.test.js` → all pass. `npm test` → green.
- [ ] Commit: `git add src/main/claude/watch.js test/claude-watch-rules.test.js && git commit -m "Claude Code watch: the sessions, and what each event does to the buddy"`

---

### Task 5: the watcher's server — port, token, requests, timers, start / stop / setOn

**Files:**
- Modify: `src/main/claude/watch.js` (append `createWatch` and the constants; add requires)
- Test: `test/claude-watch.test.js` (new)

**Interfaces:** Produces `createWatch`, `BODY_LIMIT`, `PORT_MIN`, `PORT_MAX` (W3). Consumes W2 (`hooks.install`,
`hooks.remove`, `hooks.shown`), the store (W1), `ui.mood(name)` / `ui.bubble(text)` from main.js.

- [ ] Write `test/claude-watch.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createWatch, MOODS, OFF_LINE, FORGET_AFTER_MS, BODY_LIMIT, PORT_MIN, PORT_MAX } = require('../src/main/claude/watch');
const { BuddyError } = require('../shared/errors');

const TOKEN = 'f'.repeat(32);

/** A port nobody listens on right now. */
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** A server that holds a port, so the watcher finds it taken. */
function hold(t, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    t.after(() => s.close());
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

/** createWatch with a fake store, hooks, buddy and clock; the port comes from `ports`, in order. */
function setup(t, { stored = {}, ports, busy = () => false, hooksError = null } = {}) {
  const saved = { watchClaudeCode: false, claudeHookPort: null, claudeHookToken: null, ...stored };
  const store = { get: (key) => saved[key], set: (patch) => Object.assign(saved, patch) };
  const ui = { moods: [], bubbles: [], mood(name) { this.moods.push(name); }, bubble(text) { this.bubbles.push(text); } };
  const hooks = {
    installs: [], removes: 0,
    shown: () => '~/.claude/settings.json',
    async install(opts) { if (hooksError) throw hooksError; this.installs.push(opts); return true; },
    async remove() { if (hooksError) throw hooksError; this.removes += 1; return true; },
  };
  let clock = 1_000_000;
  const laters = [];
  const queue = [...ports];
  const watch = createWatch({
    store, find: {}, hooks, ui, chatBusy: busy,
    now: () => clock,
    later: (fn, ms) => { const timer = { fn, ms }; laters.push(timer); return timer; },
    cancel: (timer) => { const i = laters.indexOf(timer); if (i >= 0) laters.splice(i, 1); },
    randomPort: () => queue.shift(),
    newToken: () => TOKEN,
  });
  t.after(() => watch.stop());
  const fire = () => { for (const timer of laters.splice(0)) timer.fn(); };
  return { watch, saved, ui, hooks, laters, fire, tick: (ms) => { clock += ms; } };
}

const post = (port, path, body, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body, ...init });
const event = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 's1', cwd: '/x/my-app', ...extra });
const tick = () => new Promise((r) => setImmediate(r));

test('start picks a port, makes a token, saves both and installs the hooks with them', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port] });
  assert.deepStrictEqual(await watch.start(), { port });
  assert.strictEqual(saved.claudeHookPort, port);
  assert.strictEqual(saved.claudeHookToken, TOKEN);
  assert.deepStrictEqual(hooks.installs, [{ port, token: TOKEN }]);
  assert.strictEqual(saved.watchClaudeCode, false, 'start alone does not flip the switch');
  assert.deepStrictEqual(await watch.start(), { port }, 'started twice is started once');
  assert.strictEqual(hooks.installs.length, 1);
});

test('the port range, and the saved port and token are kept on the next launch', async (t) => {
  assert.ok(PORT_MIN === 49152 && PORT_MAX === 65535);
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [], stored: { claudeHookPort: port, claudeHookToken: 'a'.repeat(32) } });
  await watch.start();
  assert.strictEqual(saved.claudeHookPort, port);
  assert.strictEqual(saved.claudeHookToken, 'a'.repeat(32));
  assert.deepStrictEqual(hooks.installs, [{ port, token: 'a'.repeat(32) }], 'the hooks are checked on every launch');
});

test('a taken port: another is picked, saved, and the hooks are written with it', async (t) => {
  const taken = await freePort();
  await hold(t, taken);
  const other = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [other], stored: { claudeHookPort: taken, claudeHookToken: TOKEN } });
  assert.deepStrictEqual(await watch.start(), { port: other });
  assert.strictEqual(saved.claudeHookPort, other);
  assert.deepStrictEqual(hooks.installs, [{ port: other, token: TOKEN }]);
});

test('when no port can be opened, start fails in plain words', async (t) => {
  const taken = await freePort();
  await hold(t, taken);
  const { watch } = setup(t, { ports: Array(20).fill(taken) });
  await assert.rejects(watch.start(), { name: 'BuddyError', code: 'claude_watch', message: "I couldn't open a port for Claude Code's hooks. Try again." });
});

test('only POST /claude-code/<token> is heard; the rest is 404; a big body is dropped', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  assert.strictEqual((await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'))).status, 204);
  assert.strictEqual((await post(port, '/claude-code/wrong', event('Stop'))).status, 404);
  assert.strictEqual((await post(port, '/other', event('Stop'))).status, 404);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/claude-code/${TOKEN}`)).status, 404, 'GET is not heard');
  const big = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', pad: 'x'.repeat(BODY_LIMIT) });
  await post(port, `/claude-code/${TOKEN}`, big).catch(() => {}); // the socket may be closed under it
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking'], 'the big Stop never reached the sessions');
});

test('a session\'s events move the buddy', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  const send = (name, extra) => post(port, `/claude-code/${TOKEN}`, event(name, extra));
  await send('UserPromptSubmit');
  await send('PreToolUse', { tool_name: 'Read' });
  await send('PermissionRequest', { tool_name: 'Bash' });
  await send('PreToolUse', { tool_name: 'Bash' });
  await send('Stop');
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave', 'thinking', 'happy']);
  assert.deepStrictEqual(ui.bubbles, ['Claude Code needs you in my-app', 'Claude Code is done in my-app']);
  await post(port, `/claude-code/${TOKEN}`, 'not json');
  await post(port, `/claude-code/${TOKEN}`, JSON.stringify({ hook_event_name: 'PostToolUse', session_id: 's1' }));
  await tick();
  assert.strictEqual(ui.moods.length, 4, 'what is not an event does nothing');
});

test('while the chat is thinking, moods wait; the picture is sent once the chat is done', async (t) => {
  const port = await freePort();
  let busy = true;
  const { watch, ui, fire, laters } = setup(t, { ports: [port], busy: () => busy });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await post(port, `/claude-code/${TOKEN}`, event('PermissionRequest'));
  await tick();
  assert.deepStrictEqual(ui.moods, [], 'held');
  assert.deepStrictEqual(ui.bubbles, ['Claude Code needs you in my-app'], 'the words still go');
  assert.ok(laters.some((timer) => timer.ms === 500), 'it looks again shortly');
  fire();
  assert.deepStrictEqual(ui.moods, [], 'still busy');
  busy = false;
  fire();
  assert.deepStrictEqual(ui.moods, ['wave'], 'the current picture, once');
  fire();
  assert.deepStrictEqual(ui.moods, ['wave']);
});

test('a session quiet for 30 minutes is forgotten by the minute timer', async (t) => {
  const port = await freePort();
  const { watch, ui, laters, fire, tick: advance } = setup(t, { ports: [port] });
  await watch.start();
  assert.ok(laters.some((timer) => timer.ms === 60_000), 'it looks every minute');
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await tick();
  advance(FORGET_AFTER_MS - 1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking']);
  advance(1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle']);
  assert.ok(laters.some((timer) => timer.ms === 60_000), 'and keeps looking');
  watch.tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle'], 'nothing more to forget');
});

test('stop closes the port, forgets the sessions, and goes idle only if the watcher moved the buddy', async (t) => {
  const port = await freePort();
  const { watch, ui, laters } = setup(t, { ports: [port] });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await tick();
  watch.stop();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle']);
  assert.deepStrictEqual(laters, [], 'no timers left');
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'the port is closed');
  watch.stop();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle'], 'stopped twice is stopped once');
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('Stop'));
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle', 'happy'], 'started again from no sessions: s1 is new, Stop with nothing working is happy');
  const quiet = setup(t, { ports: [await freePort()] });
  await quiet.watch.start();
  quiet.watch.stop();
  assert.deepStrictEqual(quiet.ui.moods, [], 'the buddy was never moved: nothing to put back');
});

test('setOn saves the switch; on starts and off stops and removes the hooks; the line says which', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port] });
  assert.deepStrictEqual(watch.status(), { on: false, line: OFF_LINE });
  assert.deepStrictEqual(await watch.setOn(true), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' });
  assert.strictEqual(saved.watchClaudeCode, true);
  assert.strictEqual((await post(port, `/claude-code/${TOKEN}`, event('Stop'))).status, 204);
  assert.deepStrictEqual(await watch.setOn(false), { on: false, line: OFF_LINE });
  assert.strictEqual(saved.watchClaudeCode, false);
  assert.strictEqual(hooks.removes, 1);
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')));
});

test('a settings file Buddy cannot read: on fails with its words and stays off; a launch keeps listening and the line says so', async (t) => {
  const words = "I couldn't read Claude Code's settings file, so I didn't change it.";
  const port = await freePort();
  const bad = setup(t, { ports: [port], hooksError: new BuddyError('claude_settings', words) });
  await assert.rejects(bad.watch.setOn(true), { code: 'claude_settings', message: words });
  assert.strictEqual(bad.saved.watchClaudeCode, false);
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'nothing listens');
  const launched = setup(t, { ports: [await freePort()], stored: { watchClaudeCode: true }, hooksError: new BuddyError('claude_settings', words) });
  const { port: p } = await launched.watch.start();
  assert.strictEqual((await post(p, `/claude-code/${TOKEN}`, event('Stop'))).status, 204, 'hooks put there by hand still work');
  assert.deepStrictEqual(launched.watch.status(), { on: true, line: words });
});

test('the moods it sends are only the ones in MOODS', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  for (const name of ['UserPromptSubmit', 'Notification', 'PreToolUse', 'StopFailure', 'UserPromptSubmit', 'Stop']) {
    await post(port, `/claude-code/${TOKEN}`, event(name));
  }
  await tick();
  for (const mood of ui.moods) assert.ok(Object.values(MOODS).includes(mood), mood);
});
```

- [ ] Run `node --test test/claude-watch.test.js` → fails: `createWatch is not a function`.
- [ ] Add to `watch.js`, after `'use strict';` and the header comment:

```js
const http = require('node:http');
const crypto = require('node:crypto');
const { BuddyError } = require('../../../shared/errors');
```

  the constants next to the others:

```js
const FORGET_EVERY_MS = 60 * 1000; // how often quiet sessions are looked for
const HOLD_EVERY_MS = 500; // how often a held mood looks whether the chat is done
const BODY_LIMIT = 64 * 1024; // an event bigger than this is not read
const PORT_MIN = 49152; // the port is picked here: the range systems keep for short-lived use
const PORT_MAX = 65535;
const PORT_TRIES = 10;
const PATH_PREFIX = '/claude-code/';
const CANT_LISTEN = "I couldn't open a port for Claude Code's hooks. Try again.";

const defaultLater = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
};
const defaultRandomPort = () => crypto.randomInt(PORT_MIN, PORT_MAX + 1);
const defaultToken = () => crypto.randomBytes(16).toString('hex');
```

  and `createWatch` before `module.exports`:

```js
/**
 * The server and the switch. `ui` is main.js's { mood(name), bubble(text) }; `chatBusy()` says the panel's chat has a
 * message in flight, whose moods win: a mood that comes then waits, and the picture is sent once the chat is done.
 * The clock, the timers, the port pick and the token are passed in by the unit tests.
 */
function createWatch({
  store, hooks, ui, chatBusy = () => false,
  now = Date.now, later = defaultLater, cancel = clearTimeout, randomPort = defaultRandomPort, newToken = defaultToken,
}) {
  let server = null;
  let token = null;
  let state = newState();
  let error = null; // the words of a hooks failure kept for the Settings line
  let lastMood = null; // the last mood this watcher sent, so stop() knows whether to put the buddy back
  let forgetTimer = null;
  let holdTimer = null;

  function send(mood) {
    lastMood = mood;
    ui.mood(mood);
  }

  /** Once the chat is done, the picture as it is now; until then, look again shortly. */
  function waitForChat() {
    if (holdTimer) return;
    holdTimer = later(() => {
      holdTimer = null;
      if (!server) return;
      if (chatBusy()) {
        waitForChat();
        return;
      }
      send(MOODS[state.overall]);
    }, HOLD_EVERY_MS);
  }

  function show({ mood, bubble }) {
    if (bubble) ui.bubble(bubble);
    if (!mood) return;
    if (chatBusy()) waitForChat();
    else send(mood);
  }

  function take(text) {
    const event = parseEvent(text);
    if (!event) return;
    const r = apply(state, event, now());
    state = r.state;
    show(r);
  }

  /** Only Claude Code's hooks are heard: the path carries the token. The hook is answered before anything is done. */
  function onRequest(req, res) {
    if (req.method !== 'POST' || req.url !== PATH_PREFIX + token) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      res.statusCode = 204;
      res.end();
      take(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', () => {});
  }

  function listen(port) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(onRequest);
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => {
        s.off('error', reject);
        s.on('error', (err) => console.warn('[buddy] the Claude Code hooks server failed:', err.code || err.message));
        resolve(s);
      });
    });
  }

  function tick() {
    const r = forget(state, now());
    state = r.state;
    show(r);
  }

  function schedule() {
    forgetTimer = later(() => {
      forgetTimer = null;
      if (!server) return;
      tick();
      schedule();
    }, FORGET_EVERY_MS);
  }

  /** Listen (the saved port, or a new one when it is taken), then put the hooks in place for it. */
  async function start() {
    if (server) return { port: store.get('claudeHookPort') };
    token = store.get('claudeHookToken');
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
      token = newToken();
      store.set({ claudeHookToken: token });
    }
    const saved = store.get('claudeHookPort');
    let port = Number.isInteger(saved) && saved >= PORT_MIN && saved <= PORT_MAX ? saved : randomPort();
    let s = null;
    for (let tries = 0; tries < PORT_TRIES && !s; tries += 1) {
      try {
        s = await listen(port);
      } catch (err) {
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
        port = randomPort();
      }
    }
    if (!s) throw new BuddyError('claude_watch', CANT_LISTEN);
    server = s;
    state = newState();
    error = null;
    if (port !== saved) store.set({ claudeHookPort: port });
    try {
      await hooks.install({ port, token });
    } catch (err) {
      if (!(err instanceof BuddyError)) throw err;
      error = err.message; // the server stays up: hooks put there by hand still reach it
    }
    schedule();
    return { port };
  }

  function stop() {
    if (!server) return;
    server.closeAllConnections?.();
    server.close();
    server = null;
    cancel(forgetTimer);
    cancel(holdTimer);
    forgetTimer = null;
    holdTimer = null;
    state = newState();
    if (lastMood && lastMood !== MOODS.idle) ui.mood(MOODS.idle);
    lastMood = null;
  }

  function line() {
    if (error) return error;
    if (store.get('watchClaudeCode') === true) return `Watching. Hooks are in ${hooks.shown()}.`;
    return OFF_LINE;
  }

  const status = () => ({ on: store.get('watchClaudeCode') === true, line: line() });

  /** The switch. On: nothing is saved until the port and the hooks are in place. Off: the hooks go too. */
  async function setOn(on) {
    if (on) {
      await start();
      if (error) {
        const words = error;
        stop();
        throw new BuddyError('claude_settings', words);
      }
      store.set({ watchClaudeCode: true });
    } else {
      stop();
      store.set({ watchClaudeCode: false });
      error = null;
      await hooks.remove();
    }
    return status();
  }

  return { start, stop, setOn, status, tick };
}
```

  `module.exports = { MOODS, FORGET_AFTER_MS, OFF_LINE, BODY_LIMIT, PORT_MIN, PORT_MAX, folderName, parseEvent, newState, apply, forget, createWatch };`

- [ ] Run `node --test test/claude-watch.test.js test/claude-watch-rules.test.js` → all pass. If the "big body" test
  hangs: `req.destroy()` after the response headers are not yet sent is fine with Node's `fetch` (it rejects), and the
  `.catch(() => {})` swallows it; make sure `res.end()` is not called for a destroyed request (the `end` event does not
  fire then). `npm test` → green.
- [ ] Commit: `git add src/main/claude/watch.js test/claude-watch.test.js && git commit -m "Claude Code watch: the local server, the port and token, start and stop"`

---

### Task 6: the IPC channel and the preload

**Files:**
- Modify: `src/main/ipc/claude.js` (the parameter list; the header comment's channel list; one new `handle`)
- Modify: `src/preload/settings.js` (two new lines after `claudeGet`)
- Test: `test/claude-ipc.test.js` (the harness gains a fake `watch`; two new tests)

**Interfaces:** Produces W4. Consumes `watch.setOn(on)`, `watch.status()` (W3).

- [ ] In `test/claude-ipc.test.js`, add to `harness()` (new lines before `registerClaudeIpc({`):

```js
  const watch = {
    calls: [],
    async setOn(on) { this.calls.push(on); return { on, line: on ? 'Watching.' : 'off words' }; },
    status: () => ({ on: false, line: 'off words' }),
  };
```
  pass `watch,` into `registerClaudeIpc({ ... })` and return it: `return { handlers, asked, status, opened, watch };`.
  Append:

```js
test('claude:watch answers the switch, and turns it on and off through the watcher', async () => {
  const { handlers, watch } = harness();
  assert.deepEqual(await handlers['claude:watch'](), { ok: true, on: false, line: 'off words' });
  assert.deepEqual(await handlers['claude:watch'](true), { ok: true, on: true, line: 'Watching.' });
  assert.deepEqual(await handlers['claude:watch'](false), { ok: true, on: false, line: 'off words' });
  assert.deepEqual(watch.calls, [true, false]);
});

test('claude:watch wants on or off, and tells the page in plain words otherwise', async () => {
  const { handlers, watch } = harness();
  const r = await handlers['claude:watch']('yes');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'bad_request');
  assert.equal(r.error.message, 'Watching Claude Code must be on or off.');
  assert.deepEqual(watch.calls, []);
});
```

- [ ] Run `node --test test/claude-ipc.test.js` → the two fail: `handlers['claude:watch'] is not a function`.
- [ ] In `src/main/ipc/claude.js`: add `watch` to the destructured parameters
  (`function registerClaudeIpc({ ipcMain, allowed, find, openExternal, watch })`), add the `BuddyError` require
  (`const { BuddyError } = require('../../../shared/errors');`), add this line to the header comment's list:

```
 *   claude:watch { on? }    -> { on, line }: "Show me what Claude Code is doing" (src/main/claude/watch.js); with `on`
 *                              true or false it turns the watch on or off, with none it answers how it stands
```
  and the handler after `claude:status`:

```js
  handle('claude:watch', async (on) => {
    if (on === undefined) return watch.status();
    if (typeof on !== 'boolean') throw new BuddyError('bad_request', 'Watching Claude Code must be on or off.');
    return watch.setOn(on);
  });
```

- [ ] In `src/preload/settings.js`, after the `claudeGet` line:

```js
  setClaudeWatch: (on) => ipcRenderer.invoke('claude:watch', on),
  claudeWatch: () => ipcRenderer.invoke('claude:watch'),
```

- [ ] Run `node --test test/claude-ipc.test.js` → all pass. `npm test` → green.
- [ ] Commit: `git add src/main/ipc/claude.js src/preload/settings.js test/claude-ipc.test.js && git commit -m "Claude Code watch: the claude:watch call"`

---

### Task 7: the switch in Settings → Claude Code

**Files:**
- Modify: `src/renderer/settings/index.html` (new lines inside `<section id="section-claude">`, after the status `<p class="row">`)
- Modify: `src/renderer/settings/settings.js` (new lines after the `claude-get` click handler; one new line in the load block after `await renderClaude();`)

**Interfaces:** Consumes W4 (`window.buddy.claudeWatch()`, `setClaudeWatch(on)`) and the base's `claudeStatus(force)`.
No unit test runs the page (none does today); the e2e check of Task 9 drives it. Copy the pattern of General's
"Check for updates automatically" (`#update-auto`) and Memory's "Learn about me from chats" (`#memory-learning`).

- [ ] `index.html`, inside `#section-claude`, after the status row:

```html
      <div id="claude-watch" class="group">
        <div class="group-row">
          <div class="grow">
            <p class="row-title">Show me what Claude Code is doing</p>
            <p id="claude-watch-line" class="muted small" aria-live="polite"></p>
          </div>
          <input id="claude-watch-switch" class="switch" type="checkbox" role="switch" aria-label="Show me what Claude Code is doing">
        </div>
      </div>
      <p id="claude-watch-status" class="status small" aria-live="polite"></p>
```

- [ ] `settings.js`, after the `$('claude-get').addEventListener(...)` block (new lines):

```js
/**
 * Settings → Claude Code's "Show me what Claude Code is doing" (src/main/claude/watch.js): the switch, the line under
 * it, and dimmed with a word of advice while Claude Code is not installed. The status is the cached one (a minute).
 */
async function renderClaudeWatch() {
  const [status, watch] = await Promise.all([window.buddy.claudeStatus(false), window.buddy.claudeWatch()]);
  const installed = status.ok && status.status.installed === true;
  $('claude-watch-switch').disabled = !installed;
  if (!watch.ok) {
    showStatus('claude-watch-status', watch.error.message, 'error');
    return;
  }
  $('claude-watch-switch').checked = watch.on;
  $('claude-watch-line').textContent = installed || watch.on ? watch.line : 'Install Claude Code first.';
}
$('claude-watch-switch').addEventListener('change', async () => {
  const want = $('claude-watch-switch').checked;
  const r = await window.buddy.setClaudeWatch(want);
  if (r.ok) {
    $('claude-watch-switch').checked = r.on;
    $('claude-watch-line').textContent = r.line;
    showStatus('claude-watch-status', 'Saved ✓', 'good');
  } else {
    $('claude-watch-switch').checked = !want; // the switch shows what is saved, and the line says why
    $('claude-watch-line').textContent = r.error.message;
    showStatus('claude-watch-status', '');
  }
});
// Check again (the base's handler asks Claude Code afresh): the switch follows the fresh answer, which this call shares.
$('claude-check').addEventListener('click', () => renderClaudeWatch());
```

- [ ] In the page's load block, after the line `await renderClaude();`, add one line: `  await renderClaudeWatch();`
- [ ] `npm test` → green (ESLint covers the page). Run the app once (`npm start`) and open Settings → Claude Code:
  the switch is there under the status line, dimmed with "Install Claude Code first." on a Mac without Claude Code,
  live with the off words on the owner's Mac. (Flipping it on now does nothing yet: main.js has no watcher until Task 8.)
- [ ] Commit: `git add src/renderer/settings/index.html src/renderer/settings/settings.js && git commit -m "Claude Code watch: the switch in Settings"`

---

### Task 8: main.js — make the hooks and the watcher, start and stop them with Buddy

**Files:**
- Modify: `src/main/main.js` (new lines only, plus `watch` on the existing `registerClaudeIpc({...})` line)

**Interfaces:** Consumes W2 `createHooks`, W3 `createWatch`, W4. The base's lines are anchors: `const find = createFind();`
(after `cloud`), the `ui` object, `const actions = createActions({ ... });`, `power.onChange(on)`, the launch block
`if (power.isOn()) { ... }`, and the `registerClaudeIpc({ ... })` line.

- [ ] Requires, after `const { createFind } = require('./claude/find');`:

```js
const { createHooks } = require('./claude/hooks');
const { createWatch } = require('./claude/watch');
```

- [ ] After `const find = createFind(); // ...`:

```js
  // Buddy watches Claude Code (claude/watch.js) through hooks in Claude Code's settings file (claude/hooks.js). The
  // end-to-end test passes its own file, so that it never touches the person's real ~/.claude/settings.json.
  const hooks = createHooks({ find, home: app.getPath('home'), file: options.claudeSettingsFile });
```

- [ ] After the `const actions = createActions({ ... });` statement ends (the `});` line before `const onCall`):

```js
  // The chat's own moods win over Claude Code's: chatBusy says a chat answer is in flight. Not hooked to the chat yet
  // (a later line gives it actions' busy state); until then the watcher never waits.
  const watch = createWatch({ store, find, hooks, ui, chatBusy: () => false });
  const startWatch = () => {
    if (store.get('watchClaudeCode') !== true) return;
    watch.start().catch((err) => console.warn('[buddy] could not watch Claude Code:', err.message));
  };
```

- [ ] In `power.onChange(on)`: in the `if (on) {` branch, after `buddy.mood('wave');`, add `        startWatch();`;
  in the `else` branch, before `buddy.hide();`, add `        watch.stop(); // the buddy goes idle if Claude Code had moved it`.
- [ ] In the launch block `if (power.isOn()) { ... buddy.mood('wave'); }`, after `buddy.mood('wave');`, add `      startWatch();`.
- [ ] The existing `registerClaudeIpc({ ipcMain, allowed: ..., find, openExternal: ... });` line: add `watch` after
  `find` (`..., find, watch, openExternal: ...`). This is the one edit of an existing line the lead allowed.
- [ ] `npm test` → green. `npm start`: Settings → Claude Code, switch on → "Watching. Hooks are in ~/.claude/settings.json."
  and `~/.claude/settings.json` holds the seven entries beside the owner's `cc-status` hooks, with
  `settings.json.before-buddy` next to it; switch off → the entries are gone, the rest as before. (This is the owner's
  Mac: the one place the real file is meant to change. Leave it as you found it: switch off.)
- [ ] Commit: `git add src/main/main.js && git commit -m "Claude Code watch: wired into main, on with Buddy and off with it"`

---

### Task 9: the end-to-end check

**Files:**
- Create: `test/e2e/checks/47-claude-watch.js`
- Modify: `test/e2e/smoke.js` (one line in the `start({ ... })` options)

**Interfaces:** Consumes the running app (`ctx.windows`, `ctx.store`, `ctx.buddy.window()`, `ctx.bubble.window()`),
`window.buddy.setClaudeWatch` from the Settings page (W4), the port (W1), the hooks file at the path smoke.js gives.
Read `test/e2e/checks/11-buddy-navigation.js` (how `window.__moods` collects the buddy page's moods) and
`40-panel.js` (`bubbleSays`) first.

- [ ] In `test/e2e/smoke.js`, inside the `start({` options, after `loginItems: ...,` add one line:

```js
      claudeSettingsFile: path.join(userData, 'claude-home', 'settings.json'), // Claude Code's hooks go here, never into ~/.claude
```

- [ ] Create `test/e2e/checks/47-claude-watch.js`:

```js
'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Buddy watches Claude Code (src/main/claude/watch.js): with the switch on, Claude Code's hooks POST each event to a
// port on this computer, and the buddy reacts. The switch is turned on through the Settings page's own call (not a
// click: on a computer without Claude Code the switch is dimmed), the port and the token are read from the settings,
// a session's events are sent as the hooks would send them, and the moods the buddy page got and the bubble's words
// are read back. The hooks go into the test's own settings.json (smoke.js's claudeSettingsFile), never the real one.
module.exports = async function claudeWatchCheck(ctx, { assert, delay, waitFor }) {
  const hooksFile = path.join(app.getPath('userData'), 'claude-home', 'settings.json');
  const EVENTS = ['Notification', 'PermissionRequest', 'PreToolUse', 'SessionEnd', 'Stop', 'StopFailure', 'UserPromptSubmit'];
  const win = ctx.windows.open('settings', { section: 'claude' });
  const page = (script) => win.webContents.executeJavaScript(script);
  await waitFor(() => page("document.getElementById('claude-watch-line').textContent !== ''").catch(() => false), 'the Claude Code section to load');
  assert.strictEqual(await page("document.getElementById('claude-watch-switch').checked"), false, 'the switch starts off');
  assert.strictEqual(ctx.store.get('watchClaudeCode'), false);

  const on = await page('window.buddy.setClaudeWatch(true)');
  assert.strictEqual(on.ok, true, `the switch turns on: ${JSON.stringify(on)}`);
  assert.strictEqual(on.on, true);
  assert.match(on.line, /^Watching\. Hooks are in .*settings\.json\.$/);
  const asked = await page('window.buddy.claudeWatch()');
  assert.deepStrictEqual(asked, { ok: true, on: true, line: on.line }, 'the page can read the switch back');
  const port = ctx.store.get('claudeHookPort');
  const token = ctx.store.get('claudeHookToken');
  assert.ok(Number.isInteger(port) && port >= 49152 && port <= 65535, `a port was picked: ${port}`);
  assert.match(token, /^[0-9a-f]{32}$/, 'a token was made');
  const written = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.deepStrictEqual(Object.keys(written.hooks).sort(), EVENTS, 'one entry on each event');
  assert.ok(written.hooks.Stop[0].hooks[0].command.includes(`http://127.0.0.1:${port}/claude-code/${token}`), 'the hook posts to the port with the token');
  assert.strictEqual(written.hooks.Stop[0].hooks[0].timeout, 3);
  assert.strictEqual(fs.existsSync(`${hooksFile}.before-buddy`), false, 'no backup of a file that was not there');

  const buddyPage = ctx.buddy.window().webContents;
  await buddyPage.executeJavaScript('window.__moods = []; window.buddy.onMood((name) => window.__moods.push(name)); true');
  const moods = () => buddyPage.executeJavaScript('window.__moods');
  const bubbleSays = (text) => waitFor(async () => {
    const bubble = ctx.bubble.window();
    return Boolean(bubble?.isVisible()) && (await bubble.webContents.executeJavaScript("document.getElementById('text').textContent")) === text;
  }, `the bubble to say "${text}"`);
  const post = async (event, extra = {}, tokenUsed = token) => {
    const res = await fetch(`http://127.0.0.1:${port}/claude-code/${tokenUsed}`, {
      method: 'POST',
      body: JSON.stringify({ hook_event_name: event, session_id: 'e2e-session', cwd: '/Users/someone/code/my-app', ...extra }),
    });
    return res.status;
  };

  assert.strictEqual(await post('UserPromptSubmit', {}, 'wrong-token'), 404, 'a wrong token is not heard');
  assert.strictEqual(await post('UserPromptSubmit'), 204);
  await waitFor(async () => (await moods()).includes('thinking'), 'the buddy to think');
  assert.strictEqual(await post('PreToolUse', { tool_name: 'Read' }), 204);
  await delay(200);
  assert.deepStrictEqual(await moods(), ['thinking'], 'thinking is sent once, not on every tool');
  assert.strictEqual(await post('PermissionRequest', { tool_name: 'Bash' }), 204);
  await waitFor(async () => (await moods()).includes('wave'), 'the buddy to wave');
  await bubbleSays('Claude Code needs you in my-app');
  assert.strictEqual(await post('PreToolUse', { tool_name: 'Bash' }), 204);
  await waitFor(async () => (await moods()).filter((m) => m === 'thinking').length === 2, 'the buddy to think again once the permission is given');
  assert.strictEqual(await post('Stop'), 204);
  await waitFor(async () => (await moods()).includes('happy'), 'the buddy to be happy');
  await bubbleSays('Claude Code is done in my-app');

  const off = await page('window.buddy.setClaudeWatch(false)');
  assert.strictEqual(off.ok, true, 'the switch turns off');
  assert.strictEqual(off.on, false);
  assert.strictEqual(ctx.store.get('watchClaudeCode'), false);
  assert.ok(!fs.readFileSync(hooksFile, 'utf8').includes('/claude-code/'), 'the hooks are gone from the file');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/claude-code/${token}`, { method: 'POST', body: '{}' }), 'the port is closed');
  ctx.windows.close('settings');
  await waitFor(() => win.isDestroyed(), 'the Settings window to close');
};
```

- [ ] Run `npm run test:e2e` → `ok - 47-claude-watch.js` and `e2e: all checks passed`. If `bubbleSays` times out,
  read the bubble page's text element id in `src/renderer/bubble/index.html` and use that id (40-panel.js uses `text`).
- [ ] Commit: `git add test/e2e/checks/47-claude-watch.js test/e2e/smoke.js && git commit -m "Claude Code watch: the end-to-end check"`

---

### Task 10: the manual checklist

**Files:**
- Modify: `docs/manual-checklist.md` (a new section at the end)

- [ ] Append:

```markdown

## Buddy watches Claude Code
Run with the installed Buddy.app and the real Claude Code, signed in. Keep a copy of `~/.claude/settings.json` first.
- [ ] Settings → Claude Code: the switch "Show me what Claude Code is doing" is live, with "Buddy adds a few small hooks to Claude Code's settings so it hears when Claude Code starts, finishes or needs you." under it. On → "Watching. Hooks are in ~/.claude/settings.json." and the file has one entry on each of UserPromptSubmit, PreToolUse, Stop, StopFailure, SessionEnd, PermissionRequest and Notification, whose command holds the port and the token, after your own cc-status hooks; `~/.claude/settings.json.before-buddy` is the file as it was.
- [ ] A terminal, `claude` in a project, ask for something that reads a few files → the buddy thinks as soon as you send, and does not jump again on every tool.
- [ ] Ask for something that needs a permission (a Bash command) → the buddy waves and the bubble says "Claude Code needs you in <folder>"; allow it → thinking again; when Claude Code finishes → happy and "Claude Code is done in <folder>".
- [ ] Ask again and say no to the permission → thinking, then happy and "done", with no second wave for the same need.
- [ ] Two terminals, both working → the bubble "2 sessions working"; one finishes → "Claude Code is done in <folder> (1 still working)" and the buddy keeps thinking; the other finishes → happy.
- [ ] A run that fails (turn the network off) → sleepy and "Claude Code hit a problem in <folder>"; at your usage limit → "Claude Code's limit is reached".
- [ ] Close a terminal with Claude Code waiting for you (/exit, or close the tab) → the buddy goes idle.
- [ ] Settings → General → Always on off → the buddy goes idle and the port closes; on again → Claude Code is watched again without visiting Settings → Claude Code.
- [ ] Quit and reopen Buddy with the switch on → the same port and token, the hooks unchanged; remove Buddy's entries from the file by hand, reopen Buddy → they are back.
- [ ] Switch off → your own hooks stay as they were, Buddy's are gone, and no empty `hooks` is left behind in a file that had none.
- [ ] Put a trailing comma in `~/.claude/settings.json` and flip the switch on → "I couldn't read Claude Code's settings file, so I didn't change it.", the switch stays off, the file is untouched; fix the file and it works.
- [ ] On a Mac without Claude Code: the switch is dimmed with "Install Claude Code first.".
- [ ] Windows (the owner, as for the Windows port): the same bash command as on the Mac, run by Claude Code in Git Bash. On a Windows machine without Git Bash (Claude Code uses PowerShell there) the hook fails harmlessly, without blocking Claude Code, and watching does not work there: check both.
- [ ] Once Claude Code is Buddy's brain (piece 1 merged): a chat answer through it never moves the buddy through the hooks.
```

- [ ] Commit: `git add docs/manual-checklist.md && git commit -m "Manual checklist: Buddy watches Claude Code"`

---

## Spec → tasks

| Spec | Where |
|---|---|
| §2 the switch and the three keys | Tasks 1, 6, 7 |
| §3 the file, the backup, the commands, on, off, each launch | Tasks 2, 3 (file, backup, commands, on, off), 5 (`start()` installs on every launch) |
| §4 the server, the port pick and re-pick, 404s, 64 KB, 204; the sessions; events → state; state → the buddy; several sessions; chatBusy; off | Tasks 4 (rules), 5 (server, timers, chatBusy, stop) |
| §5 wiring | Tasks 6 (IPC: `claude:watch` lives in `src/main/ipc/claude.js`, the base's file for this section, not `ipc/settings.js`), 8 (main.js) |
| §6 unit, e2e, manual | Tasks 2–6, 9, 10 |

## Finishing

`npm test` and `npm run test:e2e` green; then the manual section with the real Claude Code on the owner's Mac. Open
the PR against `master` after piece 1 merges (the spec: merged after piece 1); the PR body is plain, with no AI credit.
