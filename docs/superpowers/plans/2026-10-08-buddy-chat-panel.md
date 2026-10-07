# The chat panel (PR 1) Implementation Plan

> **For agentic workers:** five tasks run in parallel, each on its own branch and worktree, each touching only its own
> files. They meet through the contracts below, which are fixed: do not change a name, a shape or a channel. If a
> contract is wrong, stop and report it instead of working around it.

**Goal:** The panel becomes a chat: one box, the AI decides write / fix / answer / read the box / look at the screen /
send; Buddy does it in the app when told (with Undo and "Send it?"); Buddy remembers facts about the person.
Spec: `docs/superpowers/specs/2026-10-08-buddy-chat-panel-design.md`. Voice is PR 2 (not in this plan), except the two
no-op hooks in Task E.

**Architecture:** the main process owns the chat (`src/main/actions.js` keeps the items and sends the whole panel state
to the page on every change); the page only draws that state and sends the person's input and button clicks. The AI
request `chat` lives in `shared/prompts.js`, so the own-key route (the app), the free route (the server) and the
Android app answer the same way. Memory is a small store module; send and undo keys come from a pure table; the native
helpers get `press` and `windowTitle`.

**Tech Stack:** Electron 44, CommonJS, vanilla JS pages, `node --test`, ESLint, Swift helper (Mac), C# helper (Windows,
csc.exe), Vercel functions (`web/`).

## Global Constraints

- Plain, friendly words in everything the person sees; match the comment density and style of the file you touch.
- Every Settings/panel IPC answer is `{ ok, ... }` through `guarded` (`src/main/ipc/result.js`); errors are
  `BuddyError(code, message)` (`shared/errors.js`).
- After changing anything in `shared/`, run `npm run sync:web` (test/web-shared.test.js checks `web/shared` is a copy).
- `npm test` (ESLint + unit tests) must pass in your worktree before you finish. On the Mac, `npm run build:native`
  compiles the Swift helper (Task B must keep it compiling).
- Only today's moods: `thinking`, `happy`, `sleepy`, `idle`, `wave`. Do not edit `src/renderer/buddy/*`,
  `src/main/buddy-window.js`, `src/preload/buddy.js`, `art/*`, `assets/buddies/*` (another session owns them).
- Commits: plain messages, no Co-Authored-By line and no AI-author credit anywhere (commits or files).
- Never print or commit secrets (`cloud.json`, keys).

## Contracts

### C1. The `chat` AI request (Task A makes it; Task E calls it)

`shared/prompts.js`: `ACTIONS` gains `'chat'`. `buildPrompt('chat', input)` → `{ system, user, image }`.

```js
input = {
  message: string,          // required, trimmed, ≤ 1000 ('Tell me what to do first.' when empty)
  selection?: string,       // ≤ 8000 (too long → bad_request 'That is too long (over 8000 characters). Try a shorter one.')
  box?: string,             // the person's whole text box, second step only; ≤ 8000
  image?: string,           // base64 JPEG, second step only; ≤ LIMITS.imageChars
  history?: [{ from: 'you' | 'buddy', text: string }],  // last 6 kept, each cut to 2000; bad entries skipped
  facts?: string[],         // ≤ 50 kept, each cut to 200; non-strings skipped
  appName?: string,         // cut to 100
  userName?: string,        // first name, cut to 100
  step?: 1 | 2,             // 2 = this request already carries the box or the screenshot
}
```

`parseChat(text)` → always this shape (never throws):

```js
{ kind: 'write'|'fix'|'answer'|'box'|'screen'|'send', say: string, text: string, notes: string[] /* ≤5 */,
  doIt: boolean, send: boolean, remember: string[] /* ≤5, each ≤200 */ }
```
Code fences are stripped. Not JSON, or an unknown kind → `{ kind: 'write', say: '', text: raw, notes: [], doIt: false,
send: false, remember: [] }`. `kind: 'answer'` with an empty `text` takes `say` as its text (and `say` becomes '').

App routes return `{ text, model, chat: parseChat(text) }` for `chat` (own key: `src/main/ai.js`; free: `src/main/cloud.js`,
which posts every chat field). Server (`web/lib/handlers.js` `ask`): `chat` works like the other actions; when
`step !== 2` and `parseChat(out.text).kind` is `box` or `screen`, the request is given back (`db.refundRequest`).

### C2. Memory (Task C makes it; Task E calls it)

`shared/memory-rules.js`: `MAX_FACTS = 50`, `MAX_FACT_CHARS = 200`, `cleanFact(text)` → trimmed single-line string, or
`null` when empty, longer than 200, containing password / passcode / PIN / OTP / CVV (whole words, any case), or 12+
digits once spaces, dots and dashes are removed.

`src/main/memory.js`: `createMemory({ store, now = Date.now, newId = () => crypto.randomUUID() })` →

```js
{
  list(): [{ id, text, at }],               // oldest first
  facts(): string[],                        // the texts, for the AI
  learning(): boolean,                      // store 'learnFromChats'
  add(text, { source = 'chat' } = {}): { id, text } | null,  // null: refused by cleanFact, already known (same text,
                                            // any case), or source 'chat' while learning is off. Over 50 → oldest dropped.
  remove(id): boolean,
  clear(): void,
  setLearning(on: boolean): void,
  onChange(fn): void,                       // fn(list()) after every change
}
```
Store DEFAULTS gain `memory: []` and `learnFromChats: true` (`src/main/store.js`).

### C3. Keys and the helper (Task B makes them; Task E calls them)

`src/main/send-keys.js`: `sendKeyFor({ bundleId, name, title }, platform)` → `{ key, modifiers }` or `null`;
`undoKey(platform)` → `{ key: 'z', modifiers: ['cmd'] }` on darwin, `['ctrl']` elsewhere. `key` ∈ `'return' | 'z' | 'd'`,
`modifiers` ⊆ `['cmd', 'ctrl', 'shift', 'alt']`. The table is in the spec §4 (Mac by bundle id, Windows by exe name in
`bundleId`, browsers by window title; fall back to the app's name).

Helper commands (`helper.call(name, args)`), Swift and C#:
- `press` `{ pid, key, modifiers }` → `{ via }`. Brings the app forward like `paste`, refuses like `paste` (Mac:
  `no_accessibility`, `not_frontmost`, `secure_field`; Windows: `terminal`, `elevated`, `secure_field`, `keys_held`),
  `bad_request` for a key or modifier not in the lists.
- `windowTitle` `{ pid }` → `{ title }` (`''` when there is none or it cannot be read; never an error for that).

### C4. The panel (Task E sends it; Task D draws it)

Main → page, on `'panel:open'` (a new opening, or a resumed chat) and `'panel:state'` (every change):

```js
state = {
  buddyName: string, appName: string,
  greeting: string,          // 'Hi Akshat! What should we do?' / 'Hi! What should we do?'
  notice: string,            // a note about the selection (e.g. Accessibility off), '' for none
  selection: string,         // the selected text the next message uses, '' for none
  busy: boolean,             // waiting for the AI: the page shows '<buddyName> is thinking…' and does not send
  resumed: boolean,          // 'panel:open' only: true when this is the same chat as before
  chat: Item[],
}
Item =
  | { id, type: 'you', text }
  | { id, type: 'buddy', say, text, notes: string[], buttons: Button[] }
  | { id, type: 'event', text, buttons: Button[] }        // '👀 Looked at Gmail', '📝 Remembered: …', '✅ Put it in Gmail', '✅ Sent', …
  | { id, type: 'error', text, code, buttons: Button[] }  // buttons: 'retry', and 'settings' when the fix is in Settings
  | { id, type: 'question', text, buttons: Button[] }     // 'Send it?' with 'send', 'not-now'
Button = 'insert' | 'replace' | 'copy' | 'undo' | 'retry' | 'settings' | 'send' | 'not-now'
```
Labels: Insert, Replace, Copy, Undo, Try again, Open Settings, Send, Not now. `id` is a number, unique in the chat.

Page → main (`src/preload/panel.js` exposes `window.buddy`):
- `onOpen(fn)`, `onState(fn)` — `fn(state)`.
- `send(message)` → `invoke('panel:send', message)` → `{ ok }` once the answer is in (the state events show progress).
  An empty message with a selection means "fix this".
- `act(id, button)` → `invoke('panel:act', id, button)` → `{ ok }`.
- `dropSelection()` → `invoke('panel:drop-selection')` → `{ ok }`.
- `close()` → `send('panel:close')`; `openSettings(code)` → `send('panel:open-settings', code)` (as today).

The old channels `panel:whole-box`, `panel:run`, `panel:screenshot`, `panel:insert`, `panel:copy` go away.

### C5. Settings memory IPC (Task C)

`settings:memory` → `{ facts: [{ id, text, at }], learning }`; `settings:memory-add` (text) → same shape, or
`bad_request` "I can't save that. Passwords, PINs, OTPs and long numbers are never saved." (also for empty / too long /
already known: "I already know that." for a duplicate); `settings:memory-remove` (id); `settings:memory-clear`;
`settings:memory-learning` (boolean). Event `'memory:changed'` (list) to the Settings window. Preload:
`memory()`, `addMemory(text)`, `removeMemory(id)`, `clearMemory()`, `setMemoryLearning(on)`, `onMemory(fn)`.

---

### Task A: the brain — `chat` prompt, server, app routes

**Files:** `shared/prompts.js`, `web/shared/*` (via `npm run sync:web`), `web/lib/handlers.js`, `src/main/ai.js`,
`src/main/cloud.js`; tests `test/prompts.test.js`, `test/server-handlers.test.js`, `test/ai.test.js`, `test/cloud.test.js`.

- [ ] Tests first for `buildPrompt('chat')`: required message; selection/box/history/facts/appName/userName/step reach
  the user prompt (labelled sections, e.g. `Selected text:`, `Their text box:`, `Chat so far:`, `What you know about
  them:`); caps (history 6 × 2000, facts 50 × 200, 1000/8000 limits, image limit); bad entries skipped; the system
  prompt names every kind, `doIt`, `send`, `remember` rules and the language rule.
- [ ] Tests for `parseChat`: each kind; fences; not JSON; unknown kind; answer with only `say`; caps on notes/remember;
  wrong types (doIt "yes" → false).
- [ ] Implement. The system prompt (BASE + chat rules) must say: reply with JSON only in exactly the C1 shape; `say` in
  the person's language and script (Hinglish → Hinglish in English letters), at most two short sentences; `text` in
  English unless asked; never invent names, dates or numbers — use what you know about them, else `[Name]`, `[Date]`;
  `box` only when the request is about the text they are writing and no selection or box text was given; `screen` only
  when the request needs something on screen that was not given and this is not step 2; on step 2 never answer `box` or
  `screen`; `doIt` true for an instruction to do it, false for a question; `send` true only when they asked to send;
  `remember` only new, lasting facts about the person (name, job, company, boss, team, city, signature, sign-off),
  never passwords, PINs, OTPs, card/bank/ID numbers; `notes` for `fix`, short, at most 5.
- [ ] Server: `chat` through `ask`, refund rule (C1). Tests: refund on step-1 `box`/`screen`, none on step 2 or other
  kinds, free limits as today.
- [ ] App: `ai.js` own route and `cloud.js` free route return `chat` (C1); `cloud.ask` posts `message, selection, box,
  image, history, facts, appName, userName, step` when present. Tests for both.
- [ ] `npm run sync:web`, `npm test`, commit.

### Task B: keys — the helper's `press` and `windowTitle`, the send-key table

**Files:** `src/native/BuddyHelper.swift`, `src/native/windows/Commands.cs`, `src/native/windows/KeyInput.cs`,
`src/native/windows/Program.cs` (command dispatch), `src/native/windows/Native.cs` (if new Win32 calls),
`src/main/send-keys.js`; tests `test/send-keys.test.js` (and the existing helper tests if they list commands).

- [ ] Tests first for `sendKeyFor`/`undoKey` (C3): Mail ⌘⇧D; Outlook Mac ⌘↩, Windows `outlook.exe`/`olk.exe` Ctrl+↩;
  Gmail and Outlook in Chrome/Safari/Arc/Edge/Firefox/Brave by title (⌘↩ Mac, Ctrl+↩ Windows); WhatsApp, Telegram,
  Slack, Discord, Teams, Messages, Signal apps and browser tabs → ↩; by name when the bundle id is unknown; unknown app
  or browser tab → null; title matching ignores case.
- [ ] Implement `src/main/send-keys.js` (a data table, plain).
- [ ] Swift: `press` and `windowTitle` per C3 (`Key` enum gains return 0x24, z 0x06, d 0x02; flags from modifiers;
  post like `pressCommand`; title from `AXFocusedWindow` else `AXMainWindow`, `kAXTitleAttribute`). Add them to
  `handle`. `npm run build:native` must compile.
- [ ] C#: `Press` and `WindowTitle` per C3 (VK_RETURN 0x0D, Z 0x5A, D 0x44; modifiers ctrl/shift/alt; wait for keys up
  as `PressCtrl` does; title of the process's front top-level visible window via `GetWindowText`). Register both in the
  command dispatch. It is built on Windows only (CI `windows-2022` job builds it with csc.exe): read the existing code
  carefully and keep to the C# version it already uses.
- [ ] `npm test`, commit.

### Task C: memory — the store module, rules, Settings

**Files:** `shared/memory-rules.js` (+ `npm run sync:web`), `src/main/memory.js`, `src/main/store.js` (DEFAULTS),
`src/main/ipc/settings.js`, `src/preload/settings.js`, `src/renderer/settings/index.html`, `settings.js`,
`settings.css`, `src/main/main.js` (only: create the memory and pass it to `registerSettingsIpc`; send `memory:changed`
to the Settings window on change); tests `test/memory.test.js`, `test/memory-rules.test.js`, `test/settings-ipc.test.js`.

- [ ] Tests first: `cleanFact` (each refusal, 12-digit rule with spaces/dashes, 10-digit phone kept, length, empty);
  `createMemory` (add/list/facts, duplicate any case, cap 50 drops oldest, learning off refuses `chat` but not
  `settings`, remove, clear, onChange, saved in the store).
- [ ] Implement C2.
- [ ] Settings IPC (C5) + tests; preload.
- [ ] Settings page: a **Memory** nav item between AI and Permissions; section title "What Buddy knows about you";
  note "Buddy learns these from your chats. They stay on this computer."; the list (each fact with ✕), an add box with
  **Add**, the switch **Learn about me from chats**, and **Forget everything** (asks once more inline: "Forget all N
  things?" with Forget / Cancel). Empty list: "Nothing yet. Tell Buddy about yourself in a chat, or add something here."
  Same look as the other sections (shared design system classes).
- [ ] `npm test`, commit.

### Task D: the panel page — the chat view

**Files:** `src/renderer/panel/index.html`, `panel.css`, `panel.js`, new `src/renderer/panel/chat-view.js` (pure, loaded
as a script and `require`d by tests like `src/renderer/common/update-view.js`), `src/preload/panel.js`; test
`test/chat-view.test.js`. (Do not change `src/main/geometry.js`: the panel stays 360 × 480.)

- [ ] Tests first for `chat-view.js`: `buttonLabel(button)`; `selectionPreview(text)` (first ~40 characters, “…”);
  `thinkingLine(buddyName)`; `canSend({ busy, text, selection })`; an `itemParts(item)` that says what to draw for each
  item type (C4).
- [ ] Page: header as today; the chat list (you right, buddy left, events small and centred, errors red, the question
  with its buttons); the greeting and the examples line when the chat is empty; the selection card with ✕
  (`dropSelection`); the notice line; the box at the bottom (textarea that grows to 4 lines, placeholder
  "Tell me what to do…", a send button); "… is thinking…" while `busy`. ↩ sends, ⇧↩ new line, nothing while composing;
  Esc closes. Buddy text is shown as text (never as HTML), keeping line breaks. Scroll to the newest item on each state.
  On `panel:open`: clear the box unless `resumed`, focus it. Buttons call `window.buddy.act(id, button)`.
- [ ] Preload per C4 (and remove the old functions).
- [ ] Keep the CSP (`script-src 'self'`). Same look as today's panel (`../common/base.css`, design tokens).
- [ ] `npm test`, commit.

### Task E: the chat flow — actions, panel IPC, main

**Files:** `src/main/actions.js`, `src/main/ipc/panel.js`, `src/main/panel-window.js` (a `send`), `src/main/main.js` (wiring only: pass `memory`, `sendKeyFor`,
`undoKey`, `userName`, and the no-op `ui.listening(on)` / `ui.voiceLevel(level)` hooks), `test/actions.test.js`,
`test/panel-ipc.test.js`, `test/e2e/smoke.js`. Tasks A, B and C build modules this task calls: inject them
(`createActions({ ..., memory, sendKeyFor, undoKey, userName, now })`) and use fakes in the unit tests. The e2e test can
only pass once all five branches are merged; update it to the new panel anyway.

- [ ] Tests first (fakes for helper, ai, memory, clipboard, ui), for everything in the spec §2–§4 and §7:
  - open: selection read as today → state with greeting, selection, notice, empty chat; resumed chat (same app pid,
    hidden < 5 min, not closed) → `resumed: true` and the items; after `dismiss()` → a new chat.
  - `send(message)`: `you` item; `busy` true then false; `ai.ask('chat', input)` with message, selection, history (last
    6 you/buddy items as `{ from, text }`, a buddy item's text = say + text), `facts: memory.facts()`, appName, userName,
    `step: 1`; empty message + selection → "Fix this."; empty and no selection → an error item "Tell me what to do first.".
  - answers: write/fix/answer items with the right buttons (fix of a selection or box → replace, else insert).
  - `box`: panel hidden, `captureSelection { selectAll: true }`, shown again with the SAME chat, event
    "📖 Read your text in <app>", second ask with `box` and `step: 2`, the selection left out; empty box → error item
    "That box looks empty."; `screen`: `screenshot`, event "👀 Looked at <app>", second ask with `image`, `step: 2`;
    a second `box`/`screen` → error item "I couldn't find it. Select the text and ask me again.".
  - `remember`: `memory.add(fact)` for each; saved → event "📝 Remembered: <fact>" with `undo`; act undo →
    `memory.remove`, the event says "Okay, I forgot that." with no buttons.
  - `doIt` with text: panel hidden, `paste` (selectAll for box text; selection replaced; else at the cursor), buddy item
    with `undo` + `copy`, event "✅ Put it in <app>", bubble "Done! It's in <app> ✅", mood happy; paste fails →
    clipboard, bubble `Copied — press ⌘V` (platform paste keys), buddy item with insert/replace + copy, event
    "Copied — press ⌘V"; with `send: true` and the paste done → the panel shows again with a `question` "Send it?".
  - `kind: 'send'` → the question "Send it?".
  - act `send`: `windowTitle`, `sendKeyFor({ ...app, title }, platform)`; null → the question becomes a buddy item
    "I don't know how to send in <app>. Press Send yourself."; else panel hidden, `press` with the key, bubble "Sent ✅",
    the question becomes event "✅ Sent". `not-now` → event "Okay, not sent.".
  - act `undo` on a put item: panel hidden, `press` with `undoKey(platform)`, bubble "Undone", the `undo` button goes.
  - act `insert`/`replace`/`copy` on a buddy item; act `retry` on an error item (sends the same message again, the error
    item removed); act `settings` → `openSettings(section)` (AI errors → 'ai').
  - errors: the error item with `retry` (+ `settings` for the codes in today's SETTINGS_ERRORS); moods as today.
  - one message at a time: `send` while busy → `bad_request` "Wait for my answer first.".
  - `dropSelection()`; `dismiss()` clears the chat; on Windows the app is activated as today.
- [ ] Implement in `actions.js`: the chat items, a state push after every change (`ui.panelState(state)` → main sends
  `'panel:state'`; `ui.showPanel(state)` sends `'panel:open'` as today), the 5-minute resume. Keep every `ui.mood` call
  in this file.
- [ ] `ipc/panel.js`: `panel:send`, `panel:act`, `panel:drop-selection` (guarded, from the panel only), `panel:close`,
  `panel:open-settings`; remove the old channels; tests.
- [ ] `main.js`: wire it (memory from Task C's `createMemory`, `require('./send-keys')` from Task B; `userName` = first
  word of `account.user()?.name`), `ui.panelState` → `panel` window `send('panel:state', state)`, the two voice hooks as
  no-ops with a comment that the buddy's feelings will use them. `panel-window.js` gets `send(channel, state)` if it has
  none (it sends `panel:open` today; look at how).
- [ ] e2e (`test/e2e/smoke.js`): drive the new panel (send a message with a fake AI answering write → Insert; doIt →
  pasted; a remembered fact). It may fail until the merge; say so in your report.
- [ ] `npm test`, commit.

## Merge (the coordinator)

Merge A, B, C, D, E into `chat-panel`; `npm run sync:web`; `npm test`; `npm run test:e2e`; fix what the contracts did
not catch; a full review; then the manual checks on the Mac.
