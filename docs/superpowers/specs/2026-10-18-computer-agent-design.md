# "Buddy, do it": Buddy uses your computer and phone for you (design)

Date: 2026-10-18. Mac (Electron, `src/`), Windows (same Electron app + C# helper, `src/native/windows`), Android
(Kotlin, `android/`), server (`web/`), shared JS (`shared/`). Owner-approved request. Design only: each platform gets
its own implementation plan later, in the order Mac, Windows, Android.

Owner's words: "Tell Buddy anything (voice or typing) and it does it on my device — every app, files, settings — like
Jarvis." Plus **Eyes**: "what is this on my screen / what does this mean", answered from a screenshot.

## 1. Decisions the owner already made

- **Loop:** look (accessibility tree + screenshot) → think (the AI picks ONE next step) → act → check; repeat until
  done or stuck.
- **Order of hands:** direct actions first (open an app, URL or file; run a command; a keyboard shortcut; file work),
  then accessibility elements by name and role, then a screenshot and a click by position as the last resort.
- **Progress:** step by step in Buddy's small speech bubble (PR #62). "Hey Buddy, stop" or Esc stops at once.
- **Safety:** Buddy acts on its own but **asks first** before risky things: deleting, paying or buying, sending
  messages, emails or posts, sharing passwords or credentials, installing or uninstalling, changing system settings or
  security, anything that cannot be undone. The person answers "yes" by voice (the existing ask-aloud). When unsure,
  ask.
- **Brain:** whatever AI the person picked in Settings (Claude, OpenAI, Gemini, Groq, Claude Code, or free mode).
  Claude Sonnet is the recommended one. Weak AIs get a warning before the job starts. Each model has a step limit. Free
  mode has a daily spend cap on the server's account.
- **Today's problem:** the chat only knows a fixed list of kinds (`shared/prompts.js` KINDS), so anything else does
  nothing, and "open X" sometimes misses the app.

## 2. Goals and non-goals

**Goals**

1. One new chat kind, `do`, that hands any "do this on my device" request to an agent job, so no request falls on the
   floor any more. The existing fast kinds (message, call, open, calls, notifs, write, fix, code) stay: they are
   tuned, tested and already confirm the right way.
2. A shared agent core (step protocol, action list, safety rules, limits, model ranks) written once in `shared/agent/`,
   used by the Mac and Windows through Electron, ported to Kotlin for Android with shared test cases.
3. "Hands and eyes" on each platform behind one small interface: observe, act, and a few direct abilities.
4. Safety the AI cannot talk its way around: the device decides what is risky, by action type and words, and only a
   real "yes" lets a risky step run.
5. Eyes: "what is this?" from anywhere (voice or typed), answered in the bubble and out loud.
6. "Open X" that finds the app far more often.

**Non-goals (this design)**

- No iPhone. The iPhone web app cannot control the phone; it can still ask the Mac to do a job later (Claude from
  anywhere style), but not in this design.
- No jobs that run in the background while the person is away or the screen is locked. The job runs while they can
  see it; a locked screen stops it.
- No recording of jobs, no "macros" saved for later, no learning from past jobs.
- No typing of passwords, ever (see §7.4 and question 4).
- No control of other Buddy windows (panel, settings) by the agent, and no control of password managers.
- No Android file management beyond opening and sharing (scoped storage makes it a project of its own).
- No native "computer use" tool of one provider as the main path: it would only work with Claude keys.

## 3. What the person sees

1. They say **"Hey Buddy, turn on dark mode and open my Downloads folder"**, or type it in the panel.
2. The AI answers `kind: "do"` with the job in one clear English sentence. If the AI is weak, Buddy first asks:
   *"Your AI is Groq. It may get confused using the computer. Claude Sonnet works best. Continue anyway?"* (voice yes
   or the bubble's Yes button).
3. The panel (if open) steps aside. The buddy takes its *thinking* look, and the speech bubble shows one short line
   per step: *"Opening System Settings…"*, *"Clicking Appearance…"*, *"Choosing Dark…"*, *"Opening Downloads…"*. The
   bubble has a small **Stop** button. The lines are shown, not spoken (spoken would be slow and noisy).
4. A risky step pauses the job. Buddy says and shows *"Delete 3 files from Downloads? Say yes or no."* Only "yes"
   (spoken, or the bubble's Yes) runs it. "No", silence or an unclear answer = no; the AI is told "the person said no"
   and either finds another way or stops.
5. At the end: *"Done! Dark mode is on and Downloads is open."* (spoken if the job was started by voice, shown in the
   bubble always, and kept in the chat). The buddy is happy.
6. If it can't finish: *"I couldn't finish. I got as far as: opened System Settings, found Appearance."* The buddy
   looks sad for a moment. The chat keeps the full step list.
7. **Stop:** Esc (Mac, Windows), "Hey Buddy, stop" (also "ruko", "bas", "cancel", "band karo"), the bubble's Stop,
   the tray menu, or on Android the notification's Stop or a tap on the head. Buddy says *"Stopped."* Nothing is undone
   by itself.
8. **You take over:** if the person types or clicks themselves during a job (real input, not Buddy's), the job pauses:
   *"You took over. Say 'go on' to continue, or 'stop'."* After 30 s of nothing it stops.
9. **Hand-over:** when a step needs the person (a password, a code sent by SMS, a "I'm not a robot" box), Buddy says
   *"Please type your password yourself, then say 'go on'."* and waits up to 2 minutes.

**Eyes:** *"Hey Buddy, what is this?"* / *"yeh kya hai?"* / *"what does this error mean?"* → Buddy looks at the front
window (screenshot + its readable text), answers in the bubble and out loud. No clicking. Same in the panel, where it
replaces today's "screen" second step with a better picture.

## 4. Architecture

```
            person (voice / panel)
                    │ "turn on dark mode"
                    ▼
   chat (actions.js / PanelModel.kt) ── kind "do" ──► AgentJob (runs on the device)
                                                       │
           ┌───────────────────────────────────────────┼─────────────────────────────┐
           ▼                                           ▼                             ▼
   shared/agent core                         Brain (one call per step)        Hands & Eyes (platform)
   - step prompt + parse                     - own key: provider.complete     - Mac: Swift helper (AX, CGEvent,
   - action schema                           - free: POST /api/ask              ScreenCaptureKit) + main (shell, fs)
   - safety gate (client)                      action "agent"                 - Windows: C# helper (UI Automation,
   - limits + model ranks                    - Claude Code: claude -p           SendInput, capture) + main
   - loop rules (stuck, repeat)                                               - Android: LookService (Accessibility,
                                                                                gestures, takeScreenshot)
                    progress ─► speech bubble / feelings / talkBack (ask-aloud yes/no)
```

### 4.1 Where the loop runs

**On the device**, always. The hands are there, latency matters, and own-key and Claude Code jobs must never depend on
Buddy's server. In free mode the server is only the brain: each step is one `/api/ask` call. The server never drives a
device.

### 4.2 The shared core (`shared/agent/`)

Pure functions and data, no I/O, so they are easy to test and to port:

| File | What it holds |
|---|---|
| `shared/agent/actions.js` | The action list (§5.2), each action's fields and limits, `parseStep(text)` (never throws; bad JSON → a `bad_step` result). |
| `shared/agent/prompt.js` | `SYSTEM.agent`, `agentPrompt(input)` → `{ system, user, image }`, the observation formatter and tree trimmer (§6.3). Added to `buildPrompt` as action `'agent'` (and `'eyes'`), so the server builds the same prompt and never takes a raw one. |
| `shared/agent/safety.js` | `riskOf(action, context)` → `{ risk: 'safe' \| 'ask' \| 'never', reason, question }`. Keyword lists, risky shell patterns, settings apps, password apps (§7). |
| `shared/agent/limits.js` | `rankOf(provider, model)` and the limits table (§8). |
| `shared/agent/loop.js` | `createAgentJob({ brain, hands, ask, show, now, signal })`: the loop itself, platform-free. Used as is by Electron on Mac and Windows. |
| `shared/agent/cases.js` | `RISK_CASES`, `PARSE_CASES`, `RANK_CASES`, `TRIM_CASES`: inputs and expected outputs the Kotlin port must match, written to `android/app/src/test/resources/agent-cases.json` by `tools/sync-android-shared.js` (the PICK_CASES pattern). |

Android: `ai/agent/` in Kotlin ports `actions`, `safety`, `limits`, `loop`; the prompt text, keyword lists, limits
and ranks are data in `shared.json` (synced, so they cannot drift), and the cases file proves the logic matches.

### 4.3 How a job flows

1. Chat answer `kind: "do"`, `text: "<the job in English>"`. Only when the request says `canDo` (the app flag; the
   server turns `do` into a plain answer for apps that did not say so, the `ANSWER_KIND_NEEDS` pattern). Never on a
   second step (the job text must be the person's words, not text read from the screen).
2. `limits.rankOf()` → warn if weak (§8). Check the switch "Buddy can use my Mac/PC/phone" and the permissions; a
   missing one stops with the existing "Open Settings" button (`PERMISSION_ERRORS`).
3. Loop, at most `maxSteps`:
   1. **Observe** (`hands.observe({ screenshot })`): front app, window title, focused element, trimmed element tree;
      a screenshot only when asked for or needed (§6.2).
   2. **Think:** `brain.step(agentPrompt({ goal, log, observation, facts, userName, platform, abilities }))` → one
      step `{ say, action }`.
   3. **Gate:** `safety.riskOf(action, observation)`. `never` → refused, the AI is told why. `ask` → ask-aloud
      (§7.3); no → told "the person said no".
   4. **Act** (`hands.act(action)`), then wait for the screen to settle (§6.4).
   5. **Log** the step and its result in one short line: `click e12 "Appearance" → ok`. The next observation is the
      check.
4. Ends on `done`, `stuck`, stop, the step or time limit, or an error.

## 5. The step protocol

### 5.1 Brain call shape: JSON in text, one step per call, stateless

Each step is **one single-turn request**: system prompt + one user message (+ at most one image), exactly the
`complete({ system, user, image })` shape every provider, the server and `claude -p` already speak. The user message
carries the goal, a compact log of earlier steps and the current observation. Why:

- Works the same with all four providers, free mode (the server builds the prompt from structured input) and Claude
  Code, with no new provider code beyond a larger `maxTokens` setting.
- The Kotlin port reuses `ai/providers/*` unchanged.
- A stateless step makes stop, retry and resume trivial and keeps the token count flat (old screenshots are never
  resent).

Later, without changing the action list: native tool calling or a JSON schema per provider (Anthropic `tool_use`,
OpenAI `response_format: json_schema`, Gemini `responseSchema`) as a "strict" transport, used where it helps weak
models. Not needed for v1.

The reply, JSON only:

```json
{"say": "Clicking Appearance…", "thought": "Dark mode is under Appearance.", "action": {"type": "click", "id": "e12"}}
```

- `say`: the bubble line, at most 60 characters, in the person's language and script (same rule as chat `say`).
- `thought`: at most 200 characters, kept in the log for the next step; never shown.
- `action`: exactly one action from §5.2. Unknown type or missing field → `bad_step`; one retry with the error added,
  then `stuck`.

`maxTokens` per step: 600 (Gemini keeps its THINKING_ROOM factor).

### 5.2 Actions

Grouped in the order the prompt tells the AI to prefer them.

**Direct (try first)**

| type | fields | Mac | Win | Android |
|---|---|---|---|---|
| `open_app` | `name` | ✓ | ✓ | ✓ |
| `open_url` | `url` (http, https, mailto; settings links per platform) | ✓ | ✓ | ✓ |
| `open_file` | `path` | ✓ | ✓ | – |
| `open_settings` | `page` (from a per-platform list: `appearance`, `wifi`, `bluetooth`, `sound`, `display`, `notifications`, `privacy`, …) | ✓ | ✓ | ✓ |
| `menu` | `path` (["File", "Export…"]) — the app's menu bar by AX | ✓ | – | – |
| `keys` | `combo` ("cmd+t", "ctrl+shift+n", "enter", "esc", "tab", arrows, F-keys) | ✓ | ✓ | – |
| `type` | `text`, `id` (optional: the field to type into) | ✓ | ✓ | ✓ |
| `run` | `command` (zsh on Mac, PowerShell on Windows), 30 s timeout, output cut to 2,000 chars | ✓ | ✓ | – |
| `files` | `op`: `list`, `find`, `read` (text, ≤ 8,000 chars), `new_folder`, `copy`, `move`, `rename`, `trash`, `write` (new file only); `path`, `to`, `text` | ✓ | ✓ | – |
| `skill` | `name`: `whatsapp_message`, `call`, `notifications`, `calls` + their fields — runs Buddy's existing tuned flow (with its own confirmation) | ✓ | partly | ✓ |

**Elements (second)**

| type | fields | notes |
|---|---|---|
| `click` | `id` | AXPress / UIA Invoke / ACTION_CLICK; falls back to a click at the element's centre |
| `set_value` | `id`, `text` | AXValue / UIA ValuePattern / ACTION_SET_TEXT |
| `toggle` | `id`, `on` | checkbox, switch |
| `pick` | `id`, `option` | popup, combo box, list item, tab |
| `scroll` | `id` (optional), `dir` (`up`/`down`/`left`/`right`) | |
| `focus` | `id` | |

**Screen (last resort, only right after an observation with a screenshot)**

| type | fields | notes |
|---|---|---|
| `click_at` | `x`, `y` (in the screenshot's pixels), `double` (optional), `right` (optional) | mapped back to screen points by the hands |
| `drag` | `from`, `to` | |
| `swipe` | `from`, `to` | Android |

**Phone only:** `back`, `home`, `recents`, `notifications_shade`, `quick_settings`.

**Control**

| type | fields | meaning |
|---|---|---|
| `look` | – | "send me a screenshot next step" |
| `wait` | `ms` (≤ 3,000) | something is loading |
| `handover` | `why` | the person must do this part (password, code, captcha); Buddy waits for "go on" |
| `ask_user` | `question` | a real question ("Which file, the PDF or the Word one?"); the answer joins the log |
| `done` | `summary` | finished; `summary` is what Buddy says |
| `stuck` | `reason` | cannot go on; Buddy says "I couldn't finish" + how far it got |

Element ids (`e1`, `e2`, …) belong to one observation. An action naming an id from an older one is refused
(`stale_id`) and the AI looks again.

## 6. Hands and eyes, per platform

### 6.1 The interface (JS; Kotlin mirrors it)

```js
hands = {
  observe({ screenshot }) → { app: { name, id }, window: { title }, focused: 'e7' | null, secureFocused: bool,
                              elements: [{ id, role, name, value?, state?, depth }], treeQuality: 'good'|'poor'|'none',
                              screen?: { image /* base64 jpeg */, width, height } },
  act(action) → { ok: true, note? } | { ok: false, code, note },
  apps() → [{ name, id, aliases }],            // for open_app
  watchStop(on) / onStop(fn),                  // Esc, and real input for "you took over"
  hideBuddy(on),                               // keep Buddy's own windows out of the picture
}
```

Hands never decide risk; the loop calls `safety.riskOf` before `act`. Hands still refuse two things on their own,
whatever they are told: typing into a password field, and acting in a password manager (defence in depth).

### 6.2 When a screenshot is sent

Screenshots cost tokens and send pixels away, so they are not sent every step. One goes with a step when:

- the AI asked (`look`), or
- the tree is `poor` or `none` (under 5 named elements, or a canvas / game / remote desktop / some Electron and Java
  apps), or
- the last action was `click_at` / `drag` / `swipe` (to check it), or
- the same action failed twice, or
- the job is Eyes.

And never when the model cannot read images (`isVisionModel` false): then the job is tree-only and the warning says
so. At most 15 screenshots per job. Long edge 1280 px (≈1,400 tokens on Claude), JPEG quality 70; the hands return the
scale so `click_at` maps back exactly.

### 6.3 Trimming the tree (shared, `prompt.js`)

The raw tree can be thousands of nodes. The formatter keeps the prompt near **6,000 tokens of tree (≈24,000 chars)**:

1. Only the front window (plus the menu bar summary on Mac, the system bars on Android), and any open sheet, dialog or
   popover first.
2. Drop nodes with no name, no value and no action that have one child (merge into the child); drop invisible,
   off-screen and zero-size nodes; drop Buddy's own windows.
3. One line per node, indented by depth: `e12 button "Appearance"`, `e14 textfield "Search" value="dark"`,
   `e20 checkbox "Dark" off`. Values cut to 80 chars, names to 60. Password fields: `e9 password-field` — never a value.
4. Over budget: cut the deepest, then the farthest from the focused element, and say `… 312 more hidden; scroll or
   look`. Lists show the first 30 rows and a count.
5. The log of earlier steps: the last 12 steps in full one-liners, older ones summarised as a count. Each `run` and
   `files read` result: first 1,000 chars in the log for the next step only.

Typical step: system ≈2,500 tokens, tree ≤6,000, log ≤1,500, image 0 or ≈1,400. Output ≤600.

### 6.4 Settle and check

After an act: wait until the tree stops changing (two equal hashes 150 ms apart) or 2 s, whichever first; `open_app`
and `open_url` wait up to 6 s for the app or window to be in front. The next observation is the check. The loop also
keeps a hash of each observation: the same action on the same screen three times = `stuck` ("I keep trying the same
thing").

### 6.5 Mac (first)

**Have today** (`src/native/BuddyHelper.swift`, `src/main/helper.js`): Accessibility and Screen Recording permission
checks and prompts (Settings → Permissions), front app events, AX reading of the focused field and of WhatsApp's tree
(`axFind`, `axKids`), password-field check (`focusedIsSecure`), paste with clipboard restore, `press` (only return, z,
d, right), window screenshot of one app (ScreenCaptureKit, 1568 px), event taps for keys and typing, app list from
`/Applications` folders (`src/main/apps.js`) with `shell.openPath`.

**New helper commands** (same JSON-lines protocol; each with a timeout in `DEFAULT_TIMEOUTS`):

| cmd | does |
|---|---|
| `axTree { pid, maxNodes: 1500, maxDepth: 25 }` | walks the focused window (+ sheets, menus), returns nodes with role, subrole, title/description/label, value (never for AXSecureTextField), enabled, focused, selected, frame; keeps the AXUIElement refs under a `gen` number |
| `axAct { gen, id, op, value }` | `press`, `setValue`, `focus`, `pick`, `showMenu`, `scrollTo`, `increment` on a node of that `gen`; `stale_id` for an older gen |
| `menu { pid, path }` | presses a menu bar item by its titles |
| `click { x, y, button, count }` | CGEvent mouse, in screen points; refuses if the point is over a password field |
| `keys { pid, combo }` | any key + modifiers, by the person's keyboard layout (generalises `press`); refused in a password field |
| `typeText { pid, text }` | unicode key events (or paste with restore for long text); refused in a password field |
| `screenshotScreen { maxEdge, excludeOwn: true }` | the display with the front window, via `SCContentFilter(display:excludingApplications:)` leaving out Buddy's own app, so the buddy and bubble are not in the picture; returns image, scale, origin |
| `watchStop { on }` | listen-only tap: emits `{"event":"esc"}` for a real Esc, `{"event":"took_over"}` for a real key or click. Buddy's own events are told apart by `eventSourceUserData` set on every event the helper posts |

Note: the helper runs one command at a time. Stop never waits on it: the job's AbortSignal stops the AI call and
blocks the next act; the act in flight (≤ 1 s AX timeout) finishes.

**In main (Node):** `run` via `child_process.spawn('/bin/zsh', ['-lc', cmd])` with cwd = home, 30 s timeout, killed on
stop; `files` via `fs` (trash with `shell.trashItem`, never `rm`); `open_url` / `open_file` via `shell.openExternal` /
`shell.openPath`; `open_settings` via `x-apple.systempreferences:` links.

**"Open X" fix (Mac):** the app index adds `/System/Library/CoreServices` (Finder), Spotlight's list
(`mdfind "kMDItemContentType == 'com.apple.application-bundle'"`, cached 10 min), each app's display name
(`CFBundleDisplayName`, localized name) as aliases, and a small alias table in shared (`vs code` → Visual Studio Code,
`chrome` → Google Chrome, `settings` → System Settings, `word` → Microsoft Word, …). `pickChat` stays the matcher. When
it still finds none, the `open` kind turns into a `do` job ("open X"), where the AI sees the app list and can use
Spotlight or the Dock. The same alias table serves Windows and Android.

**Permissions:** Accessibility (already asked), Screen Recording (already asked; needed for screenshots), and Input
Monitoring is not needed (listen-only taps under Accessibility already work for `watchTyping`). Settings → Permissions
gets one new row: **"Use my Mac for me"** (on/off), with the line "Buddy clicks and types in your apps when you ask.
It always asks before deleting, paying, sending or changing settings." The first job ever shows this once as a
question.

### 6.6 Windows (second)

**Have today** (`src/native/windows/*.cs`, C# 5 for .NET 4.8, built by the Windows compiler): front app events,
`activate` / `focusWindow`, `press` with modifiers (`KeyInput.PressWith`), paste, window capture (1568 px), UI
Automation for the focused field (`FocusedField.cs`: password and terminal), a keyboard hook for typing
(`TypeWatch.cs`). No app list, no voice (talkBack is null on Windows), no WhatsApp/open-app.

**New helper commands:** `uiTree` (UIA ControlView TreeWalker of the foreground window, cached elements under a
`gen`; `IsPassword` → no value), `uiAct` (Invoke, Value.SetValue, Toggle, SelectionItem.Select, ExpandCollapse,
ScrollItem, SetFocus), `click` (SendInput, already DPI aware), `keys` (any combo), `typeText` (SendInput unicode),
`screenshotScreen` (the monitor of the front window; Buddy's windows hidden with Electron
`setContentProtection(true)` during a job, which uses `WDA_EXCLUDEFROMCAPTURE`), `apps` (the Start menu's
`shell:AppsFolder`, which includes Store apps, with their AppUserModelIDs; opened with
`explorer shell:AppsFolder\<AUMID>`), `watchStop` (the existing low-level hook: real Esc and real input; injected
events carry `LLKHF_INJECTED`).

**In main:** `run` via `powershell -NoProfile -NonInteractive -Command`, `files` via `fs` + `shell.trashItem`,
`open_settings` via `ms-settings:` links.

**Limits:** an app run as administrator cannot be controlled (Windows blocks it): `stuck` with "This app runs as
administrator, so I can't control it." (the existing `elevated` code). UAC prompts are on the secure desktop: always a
`handover`.

**Asking on Windows:** no voice yet, so the question shows in the bubble with **Yes** / **No** buttons (and in the
panel as a card when it is open); 60 s of nothing = no. When Windows gets voice, the ask-aloud is used as on the Mac.

### 6.7 Android (third)

**Have today:** `LookService` (AccessibilityService: text boxes, clicks by id in WhatsApp, `ACTION_SET_TEXT`,
`flagRetrieveInteractiveWindows`, `flagReportViewIds`), `ScreenCapture` (MediaProjection, Android's dialog each time),
`AppOpener` / `PhoneLauncher`, calls, notifications, `PhoneTalkBack.hear()` for ask-aloud, KeyguardLock. minSdk 26.

**New in LookService** (`ui/agent/PhoneHands.kt` calls into it):

- `tree()`: `getWindows()` (interactive windows) → nodes with className → role, text / contentDescription / hint,
  viewId, clickable, editable, scrollable, checked, enabled, bounds; `isPassword` → no text. Buddy's own package
  skipped.
- `act()`: `ACTION_CLICK` on the node or its nearest clickable parent, `ACTION_SET_TEXT`, `ACTION_SCROLL_FORWARD` /
  `BACKWARD`, `ACTION_LONG_CLICK`, `ACTION_EXPAND`, `ACTION_SELECT`.
- `performGlobalAction`: BACK, HOME, RECENTS, NOTIFICATIONS, QUICK_SETTINGS.
- `dispatchGesture`: tap, long press, swipe at points (`click_at`, `swipe`).
- Screenshot: `AccessibilityService.takeScreenshot()` on Android 11+ (API 30), no dialog; on 8–10, the existing
  MediaProjection, asked once per job. The floating head is moved to the screen edge and the panel hidden while a job
  runs.
- `look_service.xml` gains `canPerformGestures="true"` and `canTakeScreenshot="true"` (and the event types it needs).
  The service's description and the in-app disclosure change from "does four things, and nothing else" to say it can
  also use apps for you when you ask, and always asks before risky things.

**Direct actions:** `open_app` (AppOpener + alias table), `open_url` (ACTION_VIEW), `open_settings`
(`Settings.ACTION_*` intents), `skill` (WhatsApp, calls, notifications: existing flows). No `run`, `keys`, `files`,
`menu`.

**Stop:** the bubble's Stop, a tap on the head, the foreground notification's Stop action, "Hey Buddy, stop". The phone
has no Esc; "you took over" = a touch the service did not make (TYPE_TOUCH_INTERACTION_START events while no gesture
of Buddy's is running).

**Asking:** `PhoneTalkBack.hear()` as `askAloud` does today, with the question also in the bubble.

## 7. Safety

### 7.1 Risk classes

| class | examples | what happens |
|---|---|---|
| **safe** | open an app, URL, file or settings page; read; scroll; search; type into a normal field; new folder; copy; comfort settings (see question 3) | done, shown in the bubble |
| **ask** | delete or trash; pay, buy, order, subscribe, donate, transfer; send, post, reply, share, invite, publish; install or uninstall; change system settings, security, privacy, accounts; any `run` not on the read-only list; move or rename that overwrites; a `write` over an existing file; a `click` that looks final ("Confirm", "Submit", "Place order") | spoken question, only a real yes runs it |
| **never** | type into a password field; read a password field; act in a password manager; turn off Buddy's own permissions; `sudo`; disable the firewall / Gatekeeper / SIP / Windows Defender; format a disk; factory reset | refused; the AI is told "not allowed" and must go another way or stop |

### 7.2 The device decides, not the AI

`safety.riskOf(action, observation)` runs on the device before every act, whatever the AI says. The AI may also flag a
step (`"risky": true` in its reply) — that can only raise the class to ask, never lower it. The rules:

1. **By action type:** `files trash` → ask. `files move/rename/write` onto an existing path → ask. `run` → safe only
   when every command in it (split on `;`, `&&`, `|`, `$(…)`, backticks) is on the read-only list (`ls`, `pwd`, `cat`,
   `head`, `tail`, `wc`, `echo`, `date`, `which`, `whoami`, `df`, `du`, `uptime`, `open` with an http(s) URL or a
   folder, `mdfind`, `find` without `-delete`/`-exec`, `Get-ChildItem`, `Get-Content`, `Get-Date`, `Get-Process`,
   `Test-Path`); `never` for `sudo`, `rm -rf /`-like, `diskutil erase`, `csrutil`, `spctl --master-disable`,
   `Format-Volume`, `Set-MpPreference -Disable…`, `netsh advfirewall set … off`; everything else → ask.
   `open_url` with `tel:`, `sms:`, or a link to a `.dmg`/`.pkg`/`.exe`/`.msi`/`.apk` → ask. `skill` → its own
   existing confirmation (WhatsApp send card, call card).
2. **By the target's words:** for `click`, `toggle`, `pick`, `keys enter`, `click_at`, the words of the element (and,
   for `click_at`, the element under the point, looked up in the tree), the window title and the dialog's text are
   matched against word lists in `safety.js`: send, post, publish, tweet, reply, share, invite, submit, pay, buy,
   purchase, order, checkout, subscribe, donate, transfer, confirm, delete, remove, erase, empty trash, uninstall,
   install, update now, restart, shut down, sign out, reset, format, allow (a system permission dialog), unlock,
   accept, agree; plus Hindi/Hinglish ones (bhejo, bhejein, bhugtan, bhugtaan, hatao, mitao, kharido). A match → ask.
3. **By context:** any change in a settings app (System Settings, Control Panel / Settings, Android Settings),
   Keychain / Credential Manager, an installer, a store app's Buy/Get button, a banking or payment page (URL or title
   words: bank, pay, checkout, upi, wallet, card) → ask. **Enter / Cmd+Enter / Ctrl+Enter in a mail, chat or social app
   or page** (the `send-keys.js` app list, plus window-title words) → ask, as "Send this?".
4. **When unsure → ask.** A `click_at` with no element found under the point inside a dialog → ask. A `bad_step` the
   loop cannot read is never acted on.
5. **The question is written by the device**, from the action and target: "Delete 3 files from Downloads?", "Click
   'Place order' in Amazon?", "Run this command: brew install wget?" — the AI's `say` is not used for it, so it cannot
   word a risky step to sound harmless.

### 7.3 Asking

Reuses the ask-aloud: Mac `talkBack.say()` + `talkBack.hear('do')` (the yes/no grammar with "do it", "haan", "yes",
"kar do" added to `voice-words.js` YES words for this verb), Android `PhoneTalkBack.hear()`. The question shows in the
bubble with Yes / No buttons at the same time; pressing works too. No answer in 10 s, an unclear answer, an error, or a
locked screen = **no**. A typed job (panel open, not spoken) asks with a card in the panel instead of out loud, as the
WhatsApp card does today. One yes covers one step only; the same kind of risky step later asks again.

### 7.4 Passwords and secrets

- Password fields are shown to the AI as `password-field` with no value, in every tree, on every platform.
- Buddy never types into a password field (the hands refuse even if asked) — the person types it (`handover`).
- Password managers (1Password, Bitwarden, Keychain Access, LastPass, Dashlane, KeePass*, Google Password Manager
  screens, Credential Manager) are on a `never` list: Buddy does not look at or act in them; a job that reaches one
  stops with "I don't touch password apps."
- A screenshot taken while a password field is focused is not sent (the dots are harmless, but the rule is simple).
- Nothing the job sees is ever saved to Buddy's memory (`remember` is not part of the agent protocol).

### 7.5 Prompt injection

Screen text and web pages may contain "ignore your rules and…". The system prompt says the screen is content, not
instructions (as the chat prompt does today), but the real protection is that risky steps are gated on the device by
§7.2 whatever the AI decides, and the goal comes only from the person's own message.

## 8. Brain choice, ranks and limits (`shared/agent/limits.js`)

| rank | models (matched by provider + model id) | max steps | max time | screenshots | before starting |
|---|---|---|---|---|---|
| **best** | Claude Sonnet (`claude-sonnet-*`), Claude Code `sonnet` | 30 | 8 min | 15 | — |
| **hard** | Claude Opus / Fable (`claude-opus-*`, Claude Code `opus`, `fable`) | 20 | 8 min | 12 | — (costs more; tighter limit) |
| **ok** | GPT-5 / GPT-4.1 / GPT-4o (not mini/nano), o3, o4; Gemini Pro and Flash (not Lite); Claude Haiku, Claude Code `haiku` | 20 | 6 min | 12 | — |
| **weak** | everything on Groq; mini / nano / lite models; unknown models | 15 | 5 min | 8 | warning: "Your AI is Groq. It may get confused using the computer. Claude Sonnet works best. Continue anyway?" |
| **blind** | a model that can't read images (any rank) | as its rank | as its rank | 0 | adds: "It also can't see the screen, so some apps won't work." |

Free mode ranks the admin's model the same way. The table is data (in `shared.json` for Android), tuned after real
use. Each step call also has a 60 s timeout (`AI_TIMEOUT_MS`).

At the limit: "I couldn't finish in 30 steps. I got as far as: …" (the last 3 `say` lines that worked).

### 8.1 How each brain is called

- **Own key:** `provider.complete({ system, user, image, maxTokens: 600 })` from `ai.js`, via a new `ai.agentStep()`
  that reuses `askOwn`'s key and model checks.
- **Free mode:** `POST /api/ask` with `action: 'agent'` and structured input `{ jobId, step, goal, log, observation,
  image? }`. The server rebuilds the prompt with `buildPrompt('agent', body)` (sizes checked, never a raw prompt),
  calls the admin's model, returns the parsed step. See §9 for counting and the cap.
- **Claude Code (v1):** one `claude -p` per step through the existing `run.js` (safe mode, no tools but `Read` for the
  screenshot file, `--no-session-persistence`, `--strict-mcp-config`), the same text protocol. Simple and reuses
  tested code; slower (a process start per step, ≈2–4 s). **Later (v2):** one long `claude -p` with Buddy's own MCP
  server (`mcp__buddy__observe`, `mcp__buddy__act`, …; a small Node script started by Claude Code that talks to Buddy's
  main process over a local socket), where Buddy's MCP handler runs the same safety gate and step counter. See
  question 1.
- **Android:** `Router` gains `agentStep()` with the same three routes (Claude Code is Mac-only, as today).

## 9. Cost controls

- **Steps and time** per job by rank (§8). **Screenshots** only when needed (§6.2) and capped. **Tree** trimmed to
  ≈6k tokens. **No history resend** (stateless steps).
- **Own key and Claude Code:** the person's own limits; Buddy adds only the step/time caps. The chat shows the steps,
  not prices.
- **Free mode (server's account):**
  - A job counts as **one free request** at its first step (the same daily count as chats). Later steps of the same
    `jobId` are not counted again but are checked: the server keeps `agentJobs/{uid}_{day}_{jobId}` with the step
    count and refuses past the rank's max (so a changed app can't run forever).
  - A per-person cap of **agent jobs per day** (admin setting, default 5).
  - A **daily spend cap** for all free agent use together (admin setting, default $3/day): each step's
    `usage.inputTokens / outputTokens` × the model's price (an admin-editable price table, with defaults for the
    fallback models) is added to `spend/{day}`; at the cap the server answers `free_limit` with "Buddy's free helper
    is used up for today. Add your own key in Settings to keep going." The apps already handle `free_limit` and
    `allowOwnKey`.
  - Free mode allows `do` only when the admin's model is rank ok or better; otherwise jobs need the person's own key
    (the admin can override). Eyes counts as a normal free request.

## 10. Stop, pause and errors

**Stop** (any source): `job.stop()` → the AbortController aborts the AI call; no further act runs; a pending question
is answered no; `talkBack.stop()`; the bubble says "Stopped."; the buddy goes idle. Nothing is undone.

**"Hey Buddy, stop":** today a wake while the chat is busy gets the busy line and nothing is written down
(`wake.js`). During a job, a wake instead listens briefly with a **local stop grammar** (stop, ruko, bas, cancel,
band karo, ruk jao — the yes/no model, so no server round trip) and stops the job on a match; anything else gets "I'm
busy with a job. Say 'Hey Buddy, stop' to stop it." Only-my-voice still applies.

**Esc:** the helper's `watchStop` tap, on only while a job runs, so Esc works normally otherwise and Buddy never
swallows it.

**Errors:**

| what | what Buddy does |
|---|---|
| an act fails (element gone, app not answering) | the failure goes into the log; the AI tries another way. 3 failures in a row → stuck |
| the AI's reply can't be read | one retry with the error; then stuck |
| AI errors (no internet, bad key, limit, no credit) | stop with the existing error lines and Settings buttons (`AI_ERRORS`) |
| a permission is missing | stop with "Buddy needs Accessibility (or Screen Recording). Open Settings." |
| the helper crashes | it restarts (helper.js already does); the loop observes again once, then stops |
| the screen locks | stop: "The screen locked, so I stopped." |
| the app runs as admin (Windows) | stuck with its line |
| a new chat message while a job runs | "I'm busy with a job. Say stop first." (panel input is disabled with a Stop button) |

## 11. Privacy

- While a job runs, the trimmed tree text and (sometimes) a screenshot of the front screen go to **the AI the person
  picked** — or, in free mode, through Buddy's server to the admin's AI. Nothing else, and only during the job.
- Nothing is stored: not on the device (no files, no logs of screen text; the step list lives in the chat in memory and
  goes when the chat closes), not on the server (it logs only the kind of failure, as `ask` does today). The admin's
  dashboard sees counts and spend, never content.
- No telemetry. No analytics of jobs.
- Buddy's own windows are left out of screenshots. Password fields and password apps are never read (§7.4).
- The Settings line under the switch says it plainly: "When you ask Buddy to do something, it sends what's on your
  screen to your AI to decide each step. Nothing is saved."

## 12. Eyes ("what is this?")

A one-step, look-only job: `buildPrompt('eyes', { question, appName, tree, image })` → a short answer (`say` + `text`
as the chat's `answer`). No acts, so no safety gate. The chat gets a new kind `eyes` for questions about what is on
screen right now, used from voice and the panel; on the Mac and Windows it uses `screenshotScreen` (Buddy left out)
plus the front window's tree text, which reads small print and code better than pixels alone; on Android it uses
`takeScreenshot()` (no dialog on 11+) instead of MediaProjection. The panel's existing `screen` second step can move to
the same capture later. Weak / blind models: Eyes uses the tree text only and says "I can only read the text on your
screen with this AI."

## 13. Testing

- **Shared core (node:test, `test/agent-*.test.js`):** `parseStep` (good, bad, fenced, extra text), `riskOf` against a
  large table (every word list, every `run` pattern, overwrite, settings context, Enter in mail apps, password apps),
  `rankOf`, tree trimming budgets, the loop with **fake hands** (a tiny scripted world: an app with buttons, a dialog, a
  password field, a list) and a **scripted brain** (a list of replies). Loop tests: done, stuck, step limit, time limit
  (fake clock), stop mid-call and mid-ask, a risky step with yes / no / silence / error, stale ids, the same-action
  loop, bad JSON twice, the AI flagging a safe step risky, the AI trying to type into a password field.
- **Kotlin:** the same cases from `agent-cases.json` (risk, parse, rank, trim) plus loop tests with fakes, as the PICK
  cases are run today.
- **Helpers:** `tools/helper-smoke.js` grows `axTree`, `axAct`, `click`, `keys`, `typeText`, `screenshotScreen` against
  TextEdit (Mac) and Notepad (Windows); a password-field refusal check.
- **Server:** `buildPrompt('agent')` validation, job step counting, per-person and spend caps, `do` hidden from apps
  without `canDo`.
- **Real tasks before each release** (owner's device, Sonnet and one weak model): a list of ~20 tasks per platform,
  e.g. dark mode on, open Downloads and sort by date, new folder on the Desktop, find a file and open it, search
  YouTube for a song, new note with text, change volume, Wi-Fi on/off, empty Trash (must ask), send an email (must
  ask), buy something (must ask), "what is this?" on an error dialog.

## 14. Rollout: three sub-projects

Each one its own implementation plan, branch and PR, in this order.

**A. Mac (plus everything shared)**

1. `shared/agent/*` (actions, prompt, safety, limits, loop, cases) + `buildPrompt('agent' | 'eyes')` + the `do` and
   `eyes` chat kinds behind `canDo` / `canEyes`.
2. Server: `action: 'agent'`, job step counting, per-person jobs/day, daily spend cap, admin settings for both and the
   price table.
3. Swift helper: `axTree`, `axAct`, `menu`, `click`, `keys`, `typeText`, `screenshotScreen`, `watchStop`.
4. Main: `src/main/agent/` (MacHands: helper + shell + fs + shell.openPath), `ai.agentStep()` for own / free / Claude
   Code (v1 per step), the job in `actions.js` (kind `do`), bubble progress + Stop button, feelings (thinking, happy,
   sad), ask via talkBack, "Hey Buddy, stop" in `wake.js`, Esc.
5. "Open X" fix (app index + aliases, `open` → `do` fallback).
6. Settings → Permissions: "Use my Mac for me" switch + first-run question; weak-AI warning.
7. Eyes on the Mac.

**B. Windows**

1. C# helper: `uiTree`, `uiAct`, `click`, `keys`, `typeText`, `screenshotScreen`, `apps`, `watchStop` (C# 5 rules).
2. WinHands in main (PowerShell `run`, `ms-settings:`), the PowerShell patterns in `safety.js`.
3. Asking with bubble Yes/No buttons (no voice on Windows yet); Esc stop.
4. "Open X" for Windows (Start menu apps) — Windows can then open apps at all, which it can't today.
5. Eyes on Windows.

**C. Android**

1. Kotlin port of the core (`ai/agent/`), shared data in `shared.json`, `agent-cases.json` tests.
2. LookService: tree, actions, global actions, gestures, `takeScreenshot` (API 30+) with the MediaProjection fallback;
   `look_service.xml` flags; new disclosure text.
3. `Router.agentStep()`, the `do` kind in `PanelModel`, bubble progress + Stop, notification Stop, "Hey Buddy, stop",
   askAloud for risky steps.
4. "Open X" aliases; Eyes with `takeScreenshot`.

## 15. Open questions for the owner

1. **Claude Code as the brain:** start with one `claude -p` per step (simple, reuses today's code, ≈2–4 s slower per
   step), and move to Buddy's own MCP server later? *Recommendation: yes, per step first; MCP once the Mac job works.*
2. **Free mode:** allow `do` on the server's key at all, with 5 jobs per person per day and a $3/day total spend cap
   (both changeable in admin)? *Recommendation: yes, but only when the admin's free model is rank "ok" or better;
   otherwise jobs need the person's own key.*
3. **Comfort settings without asking:** volume, brightness, dark mode, Do Not Disturb, Wi-Fi and Bluetooth on/off —
   easy to undo, so no question? *Recommendation: yes, no question for these; every other settings change asks.*
4. **Passwords:** never type a password, even when the person says it out loud (Buddy hands over: "Please type it
   yourself, then say 'go on'")? *Recommendation: never — a spoken password would go to the AI and the voice service.*
