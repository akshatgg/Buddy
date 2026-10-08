# Buddy + Claude Code, piece 1: Claude Code is the brain — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: the chat panel (`2026-10-08-buddy-chat-panel-design.md`), free mode (`2026-10-07-buddy-phase-2-free-mode-design.md`),
and the voice branch (769138a), which every Claude Code branch starts from.
Sister pieces: `2026-10-08-buddy-claude-code-drive-design.md` (Buddy drives Claude Code) and
`2026-10-08-buddy-claude-code-watch-design.md` (Buddy watches Claude Code). This piece owns the common ground (§2).

## 1. Goal

A person who has Claude Code installed and signed in (a Pro or Max plan) uses it as Buddy's brain, with no API key and
no free-mode limit. They pick "Claude Code on this computer" in Settings → AI, and every chat answer comes from Claude
Code running quietly on their own computer. Buddy itself does not change: it still writes, fixes, answers, reads the
box and looks at the screen.

## 2. Common ground: finding Claude Code (`src/main/claude/find.js`)

Used by all three pieces. Desktop only (Mac and Windows); nothing here reaches the server or the Android app.

- **`findClaude()`** gives the path of the `claude` command, or null. Electron does not get the shell's PATH on the
  Mac, so the search is: every folder in `process.env.PATH`, then `/opt/homebrew/bin`, `/usr/local/bin`,
  `~/.local/bin`, `~/.claude/local` and `~/.npm-global/bin` on the Mac; on Windows, PATH, then
  `%LOCALAPPDATA%\Programs\Claude Code\claude.exe` and `%APPDATA%\npm\claude.cmd`. The first file found wins.
- **`status()`** runs `claude auth status` (10 s at most) and reads its JSON: `{ installed, loggedIn, email,
  subscriptionType, version, path }`. `installed: false` when there is no command; `loggedIn: false` when the command
  answers with exit code 1 or `loggedIn` is not true. The answer is kept for 60 s; `status({ force: true })` asks again.
- **The status line**, in words, for Settings (`statusLine(status)`):
  - `Claude Code: signed in as you@mail.com (Max)` (the plan word capitalised; `signed in` alone without an email);
  - `Claude Code isn't installed on this computer.` with a link **Get Claude Code** (https://claude.com/claude-code);
  - `Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.`
  - and a **Check again** button beside it.
- **Settings → Claude Code**, a new section after AI in the sidebar, holds that status line. The sister pieces add
  their own blocks under it (projects; the watch switch). Whoever builds first makes the section; the others add to it.
- **Buddy's own runs are marked:** every Claude Code process Buddy starts gets the environment variable
  `BUDDY_CLAUDE_CODE=1`, so the watch piece's hooks can ignore them.

## 3. The choice in Settings → AI

- The AI form (`src/renderer/common/ai-form.js`, also in the Welcome window) shows a fifth choice after the four keys:
  **Claude Code on this computer**. Picking it hides the key box and the "Get a key" link, and shows the status line
  of §2 in their place (with Check again). The model list shows Claude Code's own names: `Fable`, `Opus`, `Sonnet`,
  `Haiku` (sent as the aliases `fable`, `opus`, `sonnet`, `haiku`; the default is `sonnet`). Refresh does nothing
  here (the button is hidden).
- It is saved as `provider: 'claude-code'` in the settings file. It is not in `shared/providers` (which the server and
  the Android app share): `src/main/ipc/settings.js` and `src/main/ai.js` know this one id before they ask the
  registry, and the settings snapshot lists it as a provider with `needsKey: false`, `hasKey` = signed in, its
  `fallbackModels` and the `status` of §2. Saving or clearing a key for it is refused (`bad_request`).
- A person who picks it while not signed in may keep it picked: the status line tells them what to do, and a chat
  message then says the same as an error (§5).
- The free-mode note above the form (`src/main/free-state.js`) does not change. Where free mode hides the form, this
  choice is hidden with it.

## 4. The route (`src/main/claude/run.js` and `src/main/ai.js`)

- `ai.js` gets a third route beside `free` and `own`: **claude-code**. For every rule in `ask()` and `afterRefusal()`
  that today says "the user's own key" (`hasOwnKey()`), Claude Code counts as an own key when it is the picked provider
  and `status().loggedIn` is true (the cached status; never a wait of more than 10 s). So: free mode on, the server
  answers first and Claude Code takes over when the server refuses, by the same rules as a key; free mode off, Claude
  Code answers straight away. The free-mode rules themselves do not change (the Android port mirrors them).
- **`runPrompt({ system, user, image, model, signal })`** in `run.js` starts the command from §2 once per request:

      claude -p --output-format json --safe-mode --tools "" --strict-mcp-config --no-session-persistence
             --permission-prompts none --model <alias> --system-prompt <system>

  with `user` written to its stdin, `cwd` Buddy's own data folder, and the environment of §2. `--safe-mode` turns off
  the person's hooks, skills, plugins, MCP servers and CLAUDE.md files, so Claude Code answers like a plain model and
  never runs anything. Measured on the owner's Mac: about 2 s a reply, about 500 input tokens.
  The answer's JSON `result` is the text; `is_error` or an empty result is an error (§5). `usage` fills the same
  `{ inputTokens, outputTokens }` the providers give.
- **A screenshot** (the chat's second step) goes as a file: the JPEG is written to `<data folder>/claude-tmp/<random>.jpg`
  (mode 0600), the run adds `--tools Read --add-dir <that folder>` and a last line to the user text:
  `The screenshot is the image file at <path>. Read it first.` The file is deleted when the run ends, however it ends,
  and the folder is emptied at launch.
- The request times out after `AI_TIMEOUT_MS` (60 s) as the others do; the process is killed on the timeout and on
  the `signal`.
- `prompts.buildPrompt` and `parseChat` are used unchanged: the route gives `{ text, model, usage }` like a provider,
  and `askOwn` keeps parsing `check` and `chat` answers.

## 5. Errors, in Buddy's words

| Code | When | Words | Settings |
|---|---|---|---|
| `no_claude` | the command is not found | Claude Code isn't installed on this computer. Install it, or pick another AI in Settings. | AI |
| `claude_signed_out` | `auth status` says not signed in, or the run fails with an authentication error | Claude Code isn't signed in. Open a terminal, run claude, and sign in. | AI |
| `claude_limit` | the run's result says the usage limit is reached (`rate_limit`, "usage limit", "limit reached") | Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings. | AI |
| `claude_failed` | any other failing run (non-zero exit, `is_error`, bad JSON) | Claude Code couldn't answer. Try again. | — |
| `timeout` (as today) | 60 s passed | as today | — |

The first three are added to `AI_ERRORS` in `src/main/actions.js` so the chat shows **Open Settings** for them (one
line; buddy-72 holds that file: say so before the change). The model-check error `no_vision` never applies here:
every alias reads images.

## 6. Testing

- Unit: the finder (PATH and the extra folders, Windows names, nothing found), `status()` (signed in, not signed in,
  not installed, a hung command, the 60 s cache), the status lines; `runPrompt` with a fake spawn (the arguments,
  stdin, the JSON result, `is_error`, the limit words, the kill on timeout and signal, the screenshot file written
  with 0600 and deleted on success and on failure); `ai.js` with the new route through every free-mode rule; the
  settings snapshot and the refusals (save-key, clear-key); the AI form's fifth choice.
- e2e (`test/e2e`): with a fake `claude` command on PATH, pick Claude Code in Settings, send a chat message, see the
  answer; with the fake saying "not signed in", see the error with Open Settings.
- Manual: the owner's Mac with the real Claude Code (Max): a write, a fix, a screenshot step, the limit words; and
  Windows (the owner tests, as for the Windows port).

## 7. Out of scope

Claude Code as the brain on Android or through the server; the person's own CLAUDE.md, skills or MCP servers in chat
answers; streaming answers; choosing the effort level.
