# Claude mode feels like the Claude Code CLI: design

Date: 2026-10-17. Branch `claude-cli` (worktree `~/projects/buddy-claude-cli`). Mac panel only.

## What the owner asked

Make the panel's Claude mode feel like the Claude Code CLI:

1. **Workers.** When Claude starts sub-agents, a live list: each worker's task, running / done / failed, elapsed time,
   its tokens. One compact row when there are many.
2. **Tokens.** A small status line: the model in use, tokens in (with cache) and out for the whole session.
3. **Slash commands** in the Claude box: `/model` (picker: Opus, Sonnet, Haiku), `/model <name>`, `/clear`, `/stop`,
   `/cost`, `/help`; an unknown `/x` gets a short help line; typing `/` shows suggestions. `/model` applies from the
   next message, keeps the conversation and is saved as Buddy's default Claude model.
4. **Stop, or keep chatting while it works.**

## What the code really is (read before building)

The owner's note says Claude mode runs `claude -p` through `src/main/claude/job.js`. **It does not.** There are two
different things:

| | Panel's **Claude mode** (what the owner sees) | **Coding job** in the chat |
|---|---|---|
| Code | `claude/live.js` (reads transcripts), `claude/mode.js`, `claude/terminal.js` (types into the tty), `renderer/panel/claude-cli.js` + end of `panel.js` | `claude/job.js` (`claude -p --output-format stream-json`), `actions.js` `runJob` / `onJobEvent` |
| Process | The person's own interactive `claude` in iTerm2 / Terminal. Buddy does not own it. | Started and owned by Buddy. One-shot task, no session, no `--resume`. |
| Data | `~/.claude/projects/<folder>/<session>.jsonl` (transcript lines) | stream-json on stdout |
| Relay | `claude/share.js` shares these sessions with the phone and other computers | none |

The Claude box, the relay and "Claude mode" all belong to the left column, so this feature is built there. That changes
three of the owner's details:

- **`/model`**: no `control_request set_model` and no `--resume`: Buddy types Claude Code's own `/model <alias>` into
  the session's terminal. The interactive CLI switches the model for the next message and keeps the conversation.
  Buddy also saves the alias as `models['claude-code']` in its settings (the same value `job.js` and the Claude Code
  brain read).
- **Cost**: transcripts have usage but no cost (no `result` message, no `total_cost_usd`). `/cost` shows tokens only.
- **`/stop`**: Claude mode had no stop. Buddy sends Esc to the session's terminal (what the person would press). That
  works in iTerm2 (`write text (character id 27) newline no`). Terminal.app cannot get a key without coming to the
  front, so there Buddy says "Press Esc in its terminal."

Item 4 (keep chatting while it works) already works: a message typed while Claude works is queued by Claude Code and
shown once (#48). Nothing changes there.

`job.js` and the chat's job card stay as they are (see Follow-ups).

## Data, verified on this Mac (Claude Code 2.1.289 transcripts)

- An **assistant line** has `message.id`, `message.model` (`claude-opus-5-5`, `<synthetic>` for Claude Code's own) and
  `message.usage` `{ input_tokens, cache_creation_input_tokens, cache_read_input_tokens, output_tokens }`. Claude Code
  writes **one line per block** of a reply, each with the same usage, and the lines of one reply come one after the
  other (checked: 267 of 363 replies had 2-7 lines, all equal, none apart). So a reply is counted once, by its id.
- A **worker** starts with a `tool_use` named `Agent` (older: `Task`), `input.description`, `input.subagent_type`.
- Its **end**:
  - run in the foreground: the `tool_result` for that `tool_use_id`; the line's `toolUseResult` has `status`,
    `totalTokens`; `is_error: true` when it failed.
  - run in the background (most of them now): that `tool_result` comes at once with `toolUseResult.status:
    'async_launched'` and an `agentId`; the end comes later as a user line whose text is a `<task-notification>` with
    `<tool-use-id>`, `<status>` (`completed`, `failed`, `killed`, `stopped`) and, often,
    `<usage><subagent_tokens>86829</subagent_tokens>…</usage>`. (`live.js typedText` already hides these from the chat.)
- A worker's **own lines** are in `<session>/subagents/agent-<agentId>.jsonl` next to the session's file, with
  `agent-<agentId>.meta.json` `{ toolUseId, description, … }`. Its newest assistant line's usage gives its live tokens.
  (`isSidechain: true` lines in the main file, from older versions, are still skipped.)

## Design

### Main: `src/main/claude/usage.js` (new, pure)

A tally per session fed the same lines `live.js` reads: `newTally()`, `tally(t, entry) -> changed`,
`workerTokens(t, toolUseId, usage) -> changed`, `viewOf(t) -> { stats: { model, input, output }, workers: [...] }`.

- input = input + cache written + cache read; output = output; summed over replies (by id).
- model = the newest real reply's model id.
- worker `{ id, task, status: 'running' | 'done' | 'failed' | 'stopped', startedAt, endedAt, tokens }` (times in ms
  from the lines' `timestamp`). Tokens: the newest reply's in + out while it runs, `totalTokens` /
  `subagent_tokens` when it ends. The newest 20 kept, never dropping one still running.

### Main: `live.js`

Each session keeps a tally (reset when its file is read from the start). Every refresh also reads the files of the
workers still running (their `.meta.json` maps tool_use id to file; read from where it stopped). `view(id)` gains
`stats` and `workers`. `onChange` fires when items, tokens or workers changed.

For a very long session, tokens count only the part Buddy read (its last 16 MB, `FIRST_READ`). That is fine.

### Main: `terminal.js`, `mode.js`, IPC

- `terminal.interrupt({ tty })`: Esc to the iTerm2 session on that tty; else `no_terminal` "I can only stop Claude in
  iTerm2. Press Esc in its terminal."
- `mode.model(id, alias)`: alias must be one of `find.js MODELS`; types `/model <alias>` (through `talk`, so the copy
  fallback and the remote path work as today) and saves it (`saveModel`, main.js: `store.set({ models: { …,
  'claude-code': alias } })`).
- `mode.stop(id)`: `terminal.interrupt`; for a session on another computer: "Stop it on that computer."
- `mode.clear(id)`: types `/clear`. Claude Code then starts a new session (new id, new file) in the same terminal:
  Buddy looks for it by tty (discover every 0.5 s, 6 tries) and opens it; if none shows, the page goes back to the list.
  For a session on another computer: `/clear` is sent there and the page goes back to the list.
- IPC `panel:claude-model`, `panel:claude-stop`, `panel:claude-clear`; preload `claudeModel`, `claudeStop`,
  `claudeClear`.

### Renderer

- `claude-cli.js` (pure, tested): `tokenCount` (980, 12.3k, 1.2M), `modelName` (`claude-opus-5-5` → Opus 5.5),
  `elapsed` (12s, 1m 12s, 1h 5m), `statusLine`, `workerList` (workers running or ended in the last 5 minutes; compact
  above 3), `command` (parse `/name arg`), `suggestions`, `helpLines`, `costLines`, `COMMANDS`, `MODEL_PICKS`,
  `MODEL_LABELS`.
- `panel.js`: a status line under the session (`Opus 5.5 · 1.2M in · 34k out`); workers as `●` lines at the end of
  the session, or one line that unfolds ("5 workers · 3 running · 2 done"); the list redraws every second while a
  worker runs, so elapsed time moves. Commands are handled before anything is typed: their answers show as `⎿` lines
  at the end of the session (cleared when another session opens). `/model` alone shows three buttons. Typing `/` shows
  the matching commands above the box; click or Tab fills one.

### Copy (plain, short)

| Where | Words |
|---|---|
| `/help` | `/model · pick the model: opus, sonnet or haiku` · `/clear · start a new conversation` · `/stop · stop what Claude is doing` · `/cost · tokens so far` · `/help · these commands` |
| Unknown | `/x isn't a command here. Try /help.` |
| `/model` | `Pick a model. It works from your next message.` + Opus / Sonnet / Haiku |
| After a pick | `Model set to Opus. It works from your next message.` |
| Bad name | `There is no model called gpt. Try opus, sonnet or haiku.` |
| `/cost` | `Tokens so far: 1.2M in · 34k out` · `Model: Opus 5.5` · `Workers: 3 · 120k tokens` · `Cost isn't in the session file. Type /cost in the terminal for it.` |
| `/stop` elsewhere | `I can only stop Claude in iTerm2. Press Esc in its terminal.` / `Stop it on that computer.` |
| Worker line | `Fix the login bug · running · 1m 12s · 12.3k tokens` |

## Out of scope / follow-ups

- **Relay** (phone, other computers): `share.js` builds the shared view field by field. Adding `stats` and `workers`
  there is cheap (two fields, small); the phone (`ClaudeCli.kt`) and the iPhone web app would then draw them. Not
  built now. Slash commands already reach a remote session as typed text, except `/stop`.
- **The chat's coding job (`job.js`)**: the same `usage.js` tally could read its stream-json (same assistant shapes;
  `parent_tool_use_id` instead of `isSidechain`; `result.usage` and `total_cost_usd` at the end) for a status line on
  the job card. Not built now.
- Windows: Claude mode's typing is Mac only already.
