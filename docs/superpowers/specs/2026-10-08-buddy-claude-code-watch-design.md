# Buddy + Claude Code, piece 3: Buddy watches Claude Code — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: the buddy's moods and bubble, and piece 1 (`2026-10-08-buddy-claude-code-brain-design.md`), whose common
ground (§2 there: `src/main/claude/find.js`, the Settings → Claude Code section, the `BUDDY_CLAUDE_CODE=1` mark) this
piece uses. Built in parallel on its own branch from the voice branch (769138a); merged after piece 1.

## 1. Goal

While the person works with Claude Code in a terminal, the buddy on their screen reacts: it thinks while Claude Code
works, is happy when it is done, waves and says so when Claude Code is waiting for them, and is sad when it fails. A
pet for Claude Code, so they can look away from the terminal.

## 2. The switch

- **Settings → Claude Code → "Show me what Claude Code is doing"**, a switch, off by default, with a line under it:
  off: `Buddy adds a few small hooks to Claude Code's settings so it hears when Claude Code starts, finishes or needs
  you.`; on: `Watching. Hooks are in ~/.claude/settings.json.`; a failure: its words (§3). The switch is dimmed with
  `Install Claude Code first.` when Claude Code is not installed (piece 1's status).
- Saved as `watchClaudeCode: true|false`, with `claudeHookPort` (a number) and `claudeHookToken` (16 random bytes as
  hex) in the settings file.

## 3. The hooks (`src/main/claude/hooks.js`)

- **The file:** `<configDirectory>/settings.json` (the folder from `claude auth status`, else `~/.claude`). It is
  read as JSON; a file that is not JSON is left alone and the switch says `I couldn't read Claude Code's settings
  file, so I didn't change it.` The first change makes a copy `settings.json.before-buddy` once.
- **On:** under `hooks`, one entry is added for each of these events, keeping every entry already there:
  `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `StopFailure`, `SessionEnd`, `PermissionRequest`, and `Notification` with
  the matcher `permission_prompt|idle_prompt|agent_needs_input`. Each entry is one command hook with `timeout: 3`:

      [ -n "$BUDDY_CLAUDE_CODE" ] || curl -s -m 2 -X POST --data-binary @- http://127.0.0.1:<port>/claude-code/<token> >/dev/null 2>&1; exit 0

  (on Windows: the same bash command. Claude Code runs hook commands in bash, which is Git Bash on Windows, never
  in cmd.exe. On a Windows machine without Git Bash it runs them in PowerShell: there the hook fails harmlessly,
  without blocking Claude Code, and watching does not work. The owner checks this on Windows.)
  It sends the event's JSON (Claude Code's stdin to hooks) to Buddy and always exits 0, so it never blocks or slows
  Claude Code, and when Buddy is not running nothing happens. Buddy's own runs (pieces 1 and 2) carry the mark and
  send nothing.
- **Off:** every hook entry in Buddy's exact shape (its command holds `BUDDY_CLAUDE_CODE` and
  `http://127.0.0.1:<port>/claude-code/<32 hex token>`) is removed, and an event left with no entries is removed from
  `hooks`; nothing else in the file changes, the person's own hooks included. The file is written atomically; a
  symlinked file stays a symlink, and the file keeps its mode (a new one is 0600).
- **Each launch with the switch on:** Buddy checks the entries are there with the current port and token, and puts
  them back when they are not (the person removed them, or the port changed).

## 4. Buddy listens (`src/main/claude/watch.js`)

- A local HTTP server on `127.0.0.1` only, on `claudeHookPort` (first chosen at random between 49152 and 65535 and
  saved; when it is taken at launch, another is picked, saved, and the hooks rewritten). Only
  `POST /claude-code/<token>` with a JSON body of at most 64 KB is read; anything else gets 404. Every request is
  answered 204 at once.
- **What it keeps:** a map of sessions by `session_id`: `{ working, needsYou, name, lastEvent }`, `name` the last part
  of `cwd`. A session with no event for 30 minutes is forgotten.
- **Events → state:**
  - `UserPromptSubmit`, `PreToolUse`, `PostToolUse`: working, not needsYou.
  - A working session with no event for 5 minutes stops counting as working (Claude Code sends no hook when the
    person presses Esc); it is kept, and its next event makes it work again. A session that needs the person keeps
    waiting.
  - `PermissionRequest`, `Notification` (any of the three types): needsYou.
  - `Stop`: not working, not needsYou; the session ended well.
  - `StopFailure`: not working; failed, with `matcher`/`error` kept for the words.
  - `SessionEnd`: forgotten.
- **State → the buddy** (through `ui.mood` and `ui.bubble` of main.js; the mood names are the buddy's feelings, in one
  table in watch.js):
  - any session working: `thinking`, sent once when it becomes true (not on every tool);
  - a session ends well and none is working: `celebrate`, and the bubble `Claude Code is done in my-app`;
  - a session needs the person: `wave`, and the bubble `Claude Code needs you in my-app`; sent once per need, again
    only after the session worked again;
  - a session fails: `sad`, and the bubble `Claude Code hit a problem in
    my-app`, or `Claude Code's limit is reached` when the matcher is `rate_limit`;
  - nothing working, nothing needed: `idle`, sent only to end `thinking` (the one mood that stays); a celebrate, a wave
    or a sad ends by itself, and every mood counts as a use of the buddy, so an idle after it would only wake a dozing
    buddy.
  - with several sessions, the bubble adds the count: `2 sessions working`, `Claude Code is done in my-app (1 still
    working)`.
  - the mood follows the whole picture after each event (working, needs you, done, failed, idle) and is sent whenever
    that changes, never the same twice in a row: a need beats work (the person must act), work beats the rest. So
    after one session waves or fails, the next work in another shows `thinking` again, and a session that starts
    while another needs you keeps the wave.
- The chat's own moods win: while the panel's chat is thinking (a message in flight) the watcher sends no mood, and
  sends the current state once the chat is done. main.js passes a `chatBusy()` for this; when none is given, moods go
  out as they come.
- Off (the switch, or Buddy turned off): the server closes and the sessions are forgotten; the buddy goes `idle` if
  the watcher set its last mood.

## 5. Wiring

- `main.js`: `createWatch({ store, find, hooks, ui, chatBusy })`, started when the switch is on, as new lines beside
  the other wiring (buddy-26 and buddy-72 hold other lines of this file: add, never move).
- `src/main/ipc/settings.js`: `claude:watch` (on/off, answers the status line) and `claude:status` (piece 1's status,
  for the section). The settings page's section block, as in piece 1 §2.

## 6. Testing

- Unit: the hooks file (added to a file with other hooks, the same twice, removed leaving the rest byte-for-byte as
  JSON, a non-JSON file untouched, the backup once, the same command on Windows, the real command run by bash exits 0), the port pick and re-pick, the server
  (wrong path or token → 404, big body refused, the event parsing), every event → state → mood/bubble rule, the once-
  only rules, several sessions, the 30-minute forgetting, chatBusy holding moods, off.
- e2e: with the switch on, POST the events of a session to the port and see thinking, then the bubble and happy;
  a permission event and the wave.
- Manual: the owner runs Claude Code in a terminal with the switch on: the buddy thinks, the bubble on a permission
  prompt, happy at the end; the switch off leaves the person's other hooks in place.

## 7. Out of scope

Clicking the bubble to bring the terminal forward, answering permissions from Buddy (that is piece 2's job, in its
own runs), which project a session is in beyond the folder name, Claude Code sessions on other machines, watching on
a Windows machine without Git Bash (the owner tests Windows as for the Windows port).
