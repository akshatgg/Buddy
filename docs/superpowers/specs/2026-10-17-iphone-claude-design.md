# iPhone web app: the Claude screen like Buddy's Claude mode: design

Date: 2026-10-17. Branch `iphone-claude` (worktree `~/projects/buddy-iphone-claude`), built on `claude-cli` (the Mac
panel's workers, tokens and slash commands: `2026-10-17-claude-mode-cli-design.md`).

## What the owner asked

"In iPhone the Claude CLI screen looks like trash. Make it exactly the same as in Buddy (Mac/Windows/Android). On
iPhone Buddy can't float, so the web app is how I handle Claude and ask anything. Make it proper."

So the iPhone web app's Claude tab (`web/public/app/claude.js`, `claude-core.js`, `index.html` claude-pane, `app.css`
Claude part) draws a session the way the Mac panel's Claude mode does:

- the terminal's rows from `src/renderer/panel/claude-cli.js`: `❯` you on a grey bar, `●` Claude with its markdown
  (bold, code, headings, bullets, code blocks, box-drawn tables), `● Update(src/main.js)` tools with `⎿` results under
  them, quiet tools folded ("Ran 3 shell commands, read 2 files"), `⎿` events, the `✻ Pondering…` working line, the
  `⏵ Claude is waiting for you in the terminal` line;
- the CLI theme (`panel.css .panel.cli`): monospace, the terminal's greens, reds, oranges and blues, `❯` box between two
  lines;
- the status line under the session: `Opus 5.5 · 1.2M in · 34k out`;
- the workers: a `◌ / ● / ✗` line each, or one line that unfolds when there are more than 3, elapsed time moving;
- the slash commands that make sense from a phone, with suggestions while typing `/`.

Mobile first: iPhone Safari and the home-screen app, safe areas, 16px gutters, no sideways scroll except inside code
blocks and tables, the box stays above the keyboard, light and dark.

## What the code is today (read before building)

| Piece | Today |
|---|---|
| Phone page | `claude.js` draws each item as `<li class="cl-<kind>"><p>text</p></li>`: chat bubbles, no markdown, no grouping, no status line, no workers, no commands. |
| Phone logic | `claude-core.js` (`createClaude`, `readLook`, `byDevice`): looks every 2 s while in view; `send(session, text)` and `stop()` POSTs. Tested in `test/web-app-claude.test.mjs`. |
| Mac relay | `src/main/claude/share.js` `feedOf(id)` sends `{ id, name, title, status, canTalk, items }` (items without thinking, last 200). Its change key is status/canTalk/item count/last id only. |
| Server | `web/lib/remote.js` cleans the feed (`cleanSessions`, `cleanItems`) in `macReport`, keeps it in Firestore `remote/{uid}.feed`, and `phoneLook` hands it to the watcher. `handlers.js remotePhone` takes POST `send` and `stop` only. |
| Mac panel | `live.js view()` now also has `stats { model, input, output }` and `workers [{ id, task, status, startedAt, endedAt, tokens }]` (usage.js). `claude-cli.js` is a DOM-free page script (`ClaudeCli`) with `rows`, `blocks`, `tableLines`, `statusLine`, `workerList`, `command`, `suggestions`, `helpLines`, `costLines`, … |
| Sync | `tools/sync-web-app.js` makes `web/public/app/shared/` from repo files; `'script'` turns a page script's global into a default export (as `voice-timing.js`). `test/web-app-sync.test.js` fails when stale. |

### Which slash commands can reach the computer

The server relays typed words to the session's terminal (`phoneSend` → inbox → `share.js typeAll` →
`terminal.type`, which types the text and Enter). The Mac panel itself sends `/model <alias>` and `/clear` to a remote
session as plain words (`mode.js`). So:

| Command | On the phone | Needs |
|---|---|---|
| `/help` | Answered on the phone (`helpLines`). | nothing |
| `/cost` | Answered on the phone (`costLines` over the relayed stats and workers). | stats/workers relayed |
| `/model` | Shows Opus / Sonnet / Haiku buttons. | nothing |
| `/model <alias>` | Sent as the words `/model <alias>` (Claude Code's own command, from the next message). Not saved as that Mac's default (the Mac panel does that only for its own picks). Bad name: the Mac's words. | nothing new |
| `/clear` | Sent as `/clear`. Claude Code then starts a new session (new id) in that terminal, so the phone goes back to the list and says so. | nothing new |
| `/stop` | Esc in the session's terminal on that computer. Words cannot carry Esc (`terminal.type` adds Enter), so a new inbox entry `{ id, sessionId, key: 'esc' }` is relayed and `share.js` calls `terminal.interrupt` (iTerm2 only, as on the Mac). | small server + share.js change |

`/stop` relaying is cheap and safe: one allow-listed key (`'esc'`), the same session and ownership checks as words, the
same inbox (at most 20, dropped after 10 min). A Mac on an older Buddy ignores an inbox entry without `text` (its
filter wants a string), so the entry just lapses. There is no answer back from the Mac, so the phone says "Asked your
computer to press Esc in that terminal. That works when it runs in iTerm2."

## Design

### 1. Relay the tokens and workers (Mac + server)

- `share.js feedOf`: adds `stats` and `workers` from `live.view(id)` when present. The change key also covers them
  (`JSON.stringify` of both: small, at most 20 workers), so new tokens are sent even when no item changed.
- `web/lib/remote.js`: `cleanStats(value)` → `{ model, input, output } | null` (model must match
  `/^[\w.\-[\]<>]{1,80}$/`, numbers whole, 0..1e13, else 0); `cleanWorkers(value)` → at most 20 (the newest), each
  `{ id (/^[\w-]{1,100}$/), task (one line, cut to 120, else "A worker"), status (running | done | failed | stopped),
  startedAt, endedAt (whole ms or null), tokens }`; unknown fields and bad entries dropped. `macReport` keeps them in
  the feed; `phoneLook` returns them (`stats: null, workers: []` for a feed kept before this change). Size: 20 × ~250
  bytes, well inside the record's 1 MiB beside `FEED_CHARS`.
- `mode.js remoteView` also passes them on, so a Mac panel watching another computer gets the status line and workers.

### 2. Relay `/stop` (server + Mac)

- POST `/api/remote/phone { action: 'interrupt', session }`: `remote.phoneSend(doc, { sessionId, key: 'esc', id })`,
  same checks as words (computer online, session listed). The inbox entry has `key` and no `text`.
- `macReport` hands such an entry on as `{ id, sessionId, key: 'esc' }`.
- `share.js`: takes inbox entries with `text` or `key === 'esc'`; for `esc` calls `terminal.interrupt({ tty })`;
  failures are logged by code, as typing failures are. Marked done either way.

### 3. Phone logic (`claude-core.js`, pure, tested)

- `shared/claude-cli.js` is synced from `src/renderer/panel/claude-cli.js` (`as: 'script', name: 'ClaudeCli'`), so the
  phone uses the exact same rows, markdown blocks, table drawing, status line, worker lines and command words.
- `readLook` also reads `feed.stats` (`readStats`) and `feed.workers` (`readWorker`), leniently, as it reads items.
- State gains `stats`, `workers`, `notes` (answers to commands, cleared when another session opens or the list shows).
- `send(words)`: a slash command (`ClaudeCli.command`) is handled as in the table above; anything else is sent as
  today. New dependency `interrupt(sessionId)` (the POST).
- `screen(state, now)`: what the session shows, top to bottom (`rows`, `workers` = `workerList`, `working` verb or
  null, `waiting`, `line` = `statusLine`, `ticking` while a worker runs), the same order as `panel.js drawClaude`.

### 4. Phone page (`claude.js`, `index.html`, `app.css`, `app.js`)

- `claude.js` draws `screen()` with DOM code ported from `panel.js` (`cliSpans`, `cliText`, `foldable`, `cliTool`,
  `cliRow`, `cliWorkers`, `cliNote`, `cliColumns`), suggestions above the box (tap fills, the box keeps focus), the model
  picker buttons, and the status line. While a worker runs it redraws every second (only while the tab is in view).
- A session opens full screen (head and tabs hidden: the terminal gets the whole phone); `⤡` brings the head back,
  `‹` goes back to the list and leaves full screen.
- `app.css`: the CLI theme as tokens on `:root` (`--cli-*`, `--mono`): the Mac's exact black palette when the phone is
  dark; a light terminal palette (same roles) when it is light. The whole Claude pane (list and session) wears it, as
  the Mac panel does in Claude mode. 13px monospace for the session, 16px in the box (iOS zooms on less), 16px gutters,
  44px touch targets for buttons, `overflow-x: hidden` on the list and `overflow-x: auto` only on `pre` (code, tables).
- `app.js`: fits the app to `visualViewport` (iOS keeps `100dvh` under the keyboard), so the box sits right above the
  keys; while the keyboard is up the tabs hide.

### Copy

| Where | Words |
|---|---|
| `/help`, unknown, `/cost`, worker line, status line | `claude-cli.js`'s, as on the Mac |
| `/model` | `Pick a model. It works from your next message.` + Opus / Sonnet / Haiku |
| After a pick | `Model set to Opus. It works from your next message.` |
| Bad name | `There is no model called gpt. Try opus, sonnet or haiku.` |
| `/stop` | `Asked your computer to press Esc in that terminal. That works when it runs in iTerm2.` |
| `/clear` | Over the list: `Started a new conversation there. Tap Look again in a few seconds to open it.` |

## Out of scope / follow-ups

- Android (`ClaudeModel.kt`, `ClaudeView.kt`, `Remote.kt`): read `stats`/`workers` and draw the status line and
  workers; send `/stop` as `action: 'interrupt'`. Not built here.
- The Mac panel watching another computer still says "Stop it on that computer." for `/stop`; it could use the new
  `interrupt` action through `cloud.js`. Not built here.
- `/model` from the phone does not save the model as that Mac's Buddy default.
- Worker times use the phone's clock against the transcript's timestamps; a phone clock that is off shows times off by
  as much.
- Deploying the server is the owner's step (merge auto-deploys); never `npm run deploy:server` from a worktree.
