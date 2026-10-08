# Buddy + Claude Code, piece 2: Buddy drives Claude Code — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: the chat panel (`2026-10-08-buddy-chat-panel-design.md`) and piece 1
(`2026-10-08-buddy-claude-code-brain-design.md`), whose common ground (§2 there: `src/main/claude/find.js`, the
Settings → Claude Code section, the `BUDDY_CLAUDE_CODE=1` mark) this piece uses. Built in parallel on its own branch
from the voice branch (769138a); merged after piece 1 and piece 3.

## 1. Goal

The person tells Buddy, in the same chat, to do a job in their own code: "fix the login bug in my app", "add a dark
mode switch", "run the tests and tell me what fails". Buddy hands the job to Claude Code in the right project folder,
shows what it is doing, asks before it runs commands, and says what it did. Buddy becomes a coding helper without
leaving the panel.

## 2. Projects

- **Settings → Claude Code → My projects:** a list of folders with ✕ on each and an **Add a folder** button (the
  system's folder picker). Each shows its name (the folder's last part) and the path. Saved as
  `projects: [{ path, name }]` in the settings file, at most 20; a folder added twice is kept once; `lastProject`
  (a path) remembers the last pick. A folder that no longer exists shows "(not found)" and is skipped by the chat.
- Buddy only ever runs Claude Code inside a listed folder. Nothing else on the disk is a project.

## 3. How a message becomes a job

- The chat's AI request gains one field: the person's project names (`projects: ['my-app', 'site']`, at most 20
  names of at most 100 characters), listed in the user part as `Their projects on this computer: my-app, site`, only
  when there are any.
- `shared/prompts.js` gains one chat kind, **`code`**, added to `KINDS` and to the chat prompt, next to the others:
  `- "code": a job in one of their own software projects on this computer (fix a bug, add a feature, run the tests,
  explain the code), and the request lists their projects. "text" is the job as one or two clear English sentences for
  a programmer, with everything they said that matters. Never "code" when no projects are listed.` `say` stays the
  friendly line; `doIt`, `send`, `again` are false and `notes` is `[]` for it. `parseChat` passes `code` through with
  `text`. Nothing else in the `chat` prompt changes (buddy-26's rule), and the old kinds behave as before.
  The server builds this prompt in free mode, so the server is deployed after the merge (`npm run deploy:server`,
  with the owner's OK) and the Android app re-syncs (`npm run sync:android`) once PR #9 is in; until the server is
  deployed, free-mode answers never say `code`, which is harmless.
- **Which project:** one listed project, or the message names one of them (its name appears in the message, any
  case), or `lastProject` is listed: Buddy starts there. Otherwise the chat asks `Which project?` with one button per
  project (and **Not now**); the pick becomes `lastProject`.
- **Claude Code missing or not signed in:** the chat shows the piece 1 error (`no_claude` / `claude_signed_out`) with
  Open Settings, and nothing starts. The job always runs through Claude Code, whichever brain the person picked for
  the chat: it is the one with the tools.
- One job at a time: a `code` answer while a job runs gets `I'm still working in my-app. Stop it first.` with
  **Stop**, which stops that job (its own item may be in a chat closed by now), and no new job.

## 4. The job (`src/main/claude/job.js`)

- **`startJob({ project, task, person, model, onEvent })`** starts, with `cwd` the project folder and the environment
  mark of piece 1:

      claude -p --output-format stream-json --input-format stream-json --verbose
             --permission-mode acceptEdits --permission-prompts host --max-turns 60
             --model <the picked Claude Code alias, else sonnet>
             --append-system-prompt "The person's name is <first name>. When you are done, say in plain words, in at
                                     most five short lines, what you did and what is left."

  The task goes in as the first user message on stdin (the stream-json shape). The person's project settings (its
  CLAUDE.md, hooks, MCP servers) apply as they would in a terminal: this is their project.
- **Live lines:** from the stream's `assistant` messages, each tool use becomes one short line, the newest 6 kept in
  the chat item: `Reading src/login.js`, `Editing src/login.js`, `Writing src/new.js`, `Looking for "login"`,
  `Running: npm test`, `Searching the web`, and `Working…` for anything else. Text the AI says between tools is not
  shown (it comes in the summary).
- **Asking before a command:** Claude Code may read, search and edit files on its own (`acceptEdits`). When it wants
  something more (a command, a web fetch, a file outside the project), the stream sends a permission request
  (`control_request`, `can_use_tool`) and the job answers it over stdin (`control_response`). The chat shows a
  question item: `Run npm test?` (the command, or `Use <tool>?`) with **Allow** and **No**; No sends a deny with the
  words "The person said no." Nothing is answered without the person; a question left open for 10 minutes is denied
  and the job goes on without it.
  The first task of the plan proves this protocol on the owner's Claude Code version (2.1.289) with a fake tool need.
  If it cannot be made to work in one task, the fallback is fixed here: `--permission-prompts none` with
  `--allowedTools "Read Edit Write Glob Grep Bash(git status*) Bash(git diff*) Bash(npm test*) Bash(npm run *)"`, and
  Claude Code's summary says what it was not allowed to do. Which one was built is written in the plan's report.
- **Stop:** the chat item has **Stop**: the process gets SIGTERM, and SIGKILL 3 s later; the item ends with
  `Stopped.` and the files stay as they are.
- **End:** the `result` message gives the summary. The chat shows `✅ Done in my-app`, the summary text, and the
  buttons **Open folder** (the system's file browser on the folder) and **Copy**. `is_error`, a non-zero exit or a
  `result` with no text shows a red line `Claude Code couldn't finish in my-app.` with **Try again** (the same task
  again); the limit words of piece 1 give `claude_limit` with its words. No job runs longer than 30 minutes: then it
  is stopped with `That took too long, so I stopped it.`
- **Nothing of the project goes anywhere but Claude Code**: not the code, not the summary, not to Buddy's server.

## 5. In the chat (`src/main/actions.js`, the panel page)

- A new item type **`job`**: `{ project, lines: [...], buttons: ['stop'] }` while it runs, then
  `{ ..., done: true, text: summary, buttons: ['open-folder', 'copy'] }`. The buddy thinks the whole time (the chat's
  `busy` and `talking` as for an answer), is `happy` when it ends well (celebrate once the feelings PR is in) and
  `sleepy` (sad) when it fails. The chat box is usable meanwhile; a message sent during a job is answered as usual
  (a chat answer, not a second job).
- The question items (`Which project?`, `Run npm test?`) use the chat's existing `question` type with new buttons
  `project:<path>`, `allow`, `deny`, `not-now`.
- An `event` line `🔧 Started in my-app` opens the job; `✅ Done in my-app` / `⏹ Stopped` / the red line closes it.
- The empty chat's example line gets `“fix the login bug in my-app”` when the person has a project.
- A job keeps running when the panel hides; the panel opens again on the same chat within the 5 minutes as today,
  and the bubble says `Done in my-app ✅` when the job ends while the panel is hidden.
- `actions.js` and `src/renderer/panel/*` are shared with the other sessions: new functions and new lines only, and
  say so to buddy-72 (actions.js) and buddy-26 (the panel) before the change.

## 6. Testing

- Unit: the stream parsing (live lines per tool, the result, errors, the limit words), the permission exchange (a
  request becomes a question, Allow and No go back as the right JSON, the 10-minute deny), Stop (SIGTERM then SIGKILL),
  the 30-minute end, the project pick (one, named, last, ask), one job at a time, the projects list (add, remove,
  twice, 20 at most, not found), the prompt's `code` kind and the `projects` field, the chat items and buttons, the
  moods.
- e2e: a fake `claude` command that streams a tool use, a permission request and a result: add a folder in Settings,
  send "fix the bug in <name>", see the live line, answer Allow, see `✅ Done`, Open folder.
- Manual: a real job in a small project on the owner's Mac: edit a file, run a test with Allow, Stop a run, and the
  summary.

## 7. Out of scope

Undo of the changes (use git), showing the diff in the panel, several jobs at once, jobs outside the listed folders,
Claude Code's questions to the person (AskUserQuestion is denied like any other need), Android, the notch buddy.
