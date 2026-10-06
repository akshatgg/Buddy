# Buddy v1 (macOS) — Design

Date: 2026-10-06
Status: approved in chat, awaiting review of this file
Working name: **Buddy** (product name can change later)

## 1. Goal

A small 3D character that floats on top of every app on the Mac and helps people
write in English. Tap it, ask it to write an email or fix a message, and it puts
the answer straight into the Gmail or WhatsApp box you were typing in.

The person this is for writes English with mistakes and often thinks in
Hindi/Hinglish. Every feature should work when the request is typed in
Hinglish ("boss ko mail likho kal chutti chahiye") and should always answer in
proper English.

v1 is macOS only. Windows (same Electron codebase) and Android (Kotlin) come
after, reusing the character files and the server.

### Out of scope for v1

Windows, Android, iOS, voice input, streaming answers, chat history, per-user
custom limits, payments, answers in languages other than English, user-made
characters, per-minute burst limits.

## 2. What the user sees

### First launch (onboarding)

1. Sign in with Google (Phase 2 onward; Phase 1 skips this).
2. Pick a buddy (boys and girls shown together) and give it a name.
3. Grant two macOS permissions, one screen each, with a "Open System Settings"
   button and a live check that turns green when granted:
   - **Accessibility** — needed to copy the selected text and paste answers.
   - **Screen Recording** — needed for "Check screen" only; can be skipped and
     granted later the first time Check screen is used.
4. Buddy appears. Buddy is now ON (see §4).

### The buddy

- Default size about an app icon (64 pt); Settings offers Small 48 / Medium 64
  / Large 88.
- Floats slowly up and down (≈3 s cycle, small amplitude) and blinks every 3–6 s
  at random. Head turns slightly toward the mouse pointer.
- Drag anywhere. On release it glides to the nearest left/right screen edge and
  stays inside the screen's visible area. Position is remembered per display.
- Transparent around the character: clicks next to it go to the app behind.
- Visible on every Space and over full-screen apps. No Dock icon; the app lives
  in the menu bar.
- Moods: **idle** (float + blink), **thinking** (while the AI works), **happy**
  (answer ready, short bounce), **sleepy** (no internet / error), **wave**
  (hello when the Mac starts), **wobble** (while being dragged).
- Short speech bubble next to the buddy for status lines ("Copied — press ⌘V").

### The panel

Opens next to the buddy (on the side away from the screen edge) when the buddy
is clicked or the global shortcut is pressed (default **⌥Space**, changeable in
Settings). Closes on Esc or when clicking elsewhere. ~360×460 pt.

Three actions, as tabs:

- **Write for me** — a text box ("What should I write?") and a tone choice:
  Formal / Friendly / Short. Output: the finished text only, no "Here is your
  email" preamble. Unknown details become placeholders like `[Name]`, never
  invented facts.
- **Fix my English** — if the user had text selected when the panel opened, it
  is pre-filled. If not, the tab shows "Select your text first" plus a
  **Use the whole box** button (selects all in the field they were typing in
  and takes that). Output shows the original and the fixed version; the fix
  keeps the meaning and the user's voice.
- **Check screen** — takes a screenshot of the front window of the app the user
  was in, shows a thumbnail, and an optional question box ("Is this mail
  okay?"). Output: a verdict (Looks good / Has problems), up to 5 short
  problems, and a corrected version of the main text when there is one.

Every answer has:

- **Insert** (Write) / **Replace** (Fix, Check) — goes back to the app the user
  was in and pastes. Replace pastes over the selection the text came from; in
  whole-box mode it selects all first. In Check, Replace selects all in the
  focused field first.
- **Copy**
- **Try again** — same request, new answer.

### Menu bar

Show/Hide buddy · Settings… · Turn off buddy · Quit.

### Settings

Buddy (change character, rename, size), shortcut, AI (only when free mode is
OFF: provider, API key, model), account (signed-in email, sign out), "Turn off
buddy".

## 3. Characters

- **6 at launch: 3 boys, 3 girls.** Cute, round, cartoon (chibi) 3D style,
  about two heads tall, big glossy eyes, soft pastel colours. All built from one
  shared base body; variety comes from hair, colours, outfits and accessories,
  so more can be added later cheaply.
- Phase 1 ships the first two (one boy, one girl); Phase 3 adds the other four.
- Built in Blender (through the Blender MCP connection) from a Python script so
  every character is reproducible. Sources and the script live in `art/`.
- Exported as `.glb`, each under 1 MB, no Draco compression.
- Before integration, each character gets a preview render (front + turntable)
  for the user to approve.

### File contract (every `.glb` must follow it)

Named nodes, animated by app code (no baked animation clips needed):

| Node | Used for |
|---|---|
| `Root` | float, bounce, wobble, breathing scale |
| `Head` | look-at, head tilt (thinking) |
| `ArmL`, `ArmR` | wave, happy |
| `Face` mesh with morph targets `blink`, `smile`, `mouthO` | blink, sleep (blink = 1), happy, talking |

`assets/buddies/buddies.json` lists characters:
`{ id, gender: "boy" | "girl", defaultName, file, accent }`.

### Rendering

three.js with `GLTFLoader` in the buddy window's renderer, transparent
background, soft lighting. Rendering capped at 30 fps and paused when the buddy
is hidden, the screen is locked, or the display sleeps. Target: under 3 % CPU
while idle on Apple Silicon.

## 4. Always on

- `buddyOn` is stored in settings. Turning the buddy on (end of onboarding, or
  "Turn on buddy" in the menu) sets `buddyOn = true` and registers the app to
  open at login (`app.setLoginItemSettings({ openAtLogin: true })`).
- On launch: if `buddyOn`, show the buddy (with the wave mood).
- **Quit** from the menu bar closes the app for now; it comes back at the next
  login because the login item is still set.
- Only **Turn off buddy** (menu or Settings) sets `buddyOn = false`, removes the
  login item and hides the buddy. The menu bar icon stays until Quit, with
  "Turn on buddy".
- If the buddy window's renderer crashes, it is reloaded automatically.

## 5. AI: keys, routing, prompts

### Routing

```
freeOn (from server)  → route "free":  app → POST /api/ask → admin's key
else, own key saved   → route "own":   app → provider directly, user's key
else                  → route "none":  panel shows "Add your API key" screen
```

- Free mode ON always wins: users never see key settings while it is ON. Saved
  own keys are kept and used again when free mode goes OFF.
- The app refreshes `GET /api/config` at launch, when the panel opens and the
  last check is older than 5 minutes, and immediately after any `free_off`,
  `free_limit` or `blocked` error. When offline it keeps the last known config.
- Phase 1 has no server: route is always "own".

### Providers

Four providers behind one interface — `complete({ system, user, image?,
maxTokens }) → { text, usage: { inputTokens, outputTokens }, model }`:

| Provider | Endpoint style | Usage fields read |
|---|---|---|
| Anthropic (Claude) | Messages API | `usage.input_tokens`, `usage.output_tokens` |
| OpenAI | Chat Completions | `usage.prompt_tokens`, `usage.completion_tokens` |
| Groq | OpenAI-compatible | same as OpenAI |
| Google Gemini | `generateContent` | `usageMetadata.promptTokenCount`, `candidatesTokenCount` |

- The model list is fetched live from each provider's models endpoint with the
  key in use; a short fallback list per provider is used until it returns
  (lesson from Souffleur: hardcoded lists rot). Anthropic fallback:
  `claude-haiku-4-5-20251001`, `claude-sonnet-5-5`. Other fallbacks are
  checked against provider docs at implementation time.
- Each model is marked vision-capable or not. Check screen with a non-vision
  model shows: "This model can't read screenshots. Pick another in Settings."
- Non-streaming in v1 (answers are short).
- Output capped at 1024 tokens per request.
- Screenshots are downscaled so the long edge is at most 1568 px, JPEG q80.

### Prompts

Prompts for the three actions live in one shared module used by both the app
(own route) and the server (free route), so both routes behave the same. The
server builds the prompt itself from the action and inputs — it never accepts a
raw prompt — so the free key cannot be used as a general-purpose free AI.

- All actions: understand Hindi/Hinglish/broken English input; always answer in
  English; return only the requested text.
- Check screen asks for JSON `{ verdict: "good" | "problems", problems: string[],
  corrected: string | null }`; if the reply is not valid JSON it is shown as
  plain text.

### Own keys

Stored encrypted with Electron `safeStorage` (Keychain-backed) in the app's user
data folder. Sent only to the chosen provider.

## 6. Server, data and admin dashboard (Phase 2)

Stack, following Souffleur: Vercel serverless functions + Firebase Auth (Google)
+ Firestore. A new Firebase project and a new Vercel project, separate from
Souffleur. Admin: **akshatg9636@gmail.com** (checked with `email_verified`).

### App sign-in

Google OAuth for desktop apps (authorization code + PKCE, loopback redirect to
`127.0.0.1`) opened in the system browser → Google ID token → Firebase Auth REST
`accounts:signInWithIdp` → Firebase ID token + refresh token. The refresh token
is stored with `safeStorage`; ID tokens are refreshed through
`securetoken.googleapis.com`. Every server call sends
`Authorization: Bearer <Firebase ID token>`. Sign-in is required in Phase 2+
whatever the route.

### Server environment (Vercel)

`FIREBASE_SERVICE_ACCOUNT` (JSON), `ADMIN_EMAIL`, and any of
`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY`. Admin
keys never leave the server and are never stored in Firestore.

### Firestore

| Path | Fields | Written by |
|---|---|---|
| `config/free` | `enabled`, `limitMode: "unlimited" \| "daily"`, `dailyRequests`, `provider`, `model`, `prices: { [model]: { inPerM, outPerM } }` | admin (dashboard) |
| `users/{uid}` | `uid`, `email`, `name`, `photo`, `createdAt`, `lastActive`, `blocked` | server; admin may change `blocked` only |
| `usage/{uid}_{day}` | `uid`, `day`, `requests`, `inputTokens`, `outputTokens`, `byModel: { [model]: { requests, inputTokens, outputTokens } }` | server only |
| `usageDaily/{day}` | same counters, all users together | server only |

`day` is the calendar date in **Asia/Kolkata** (`YYYY-MM-DD`); "resets at
midnight" means IST midnight.

Rules: `config/*`, `usage/*`, `usageDaily/*` readable and writable by admin
only from the client (server uses the Admin SDK); `users/*` readable by admin
only; clients never create users; admin may update only `blocked`. Everything
else denied.

### Endpoints

`GET /api/config` (signed in) — creates/updates the `users/{uid}` row from the
verified token, then returns
`{ freeOn, limit: number | null, usedToday, blocked }`.

`POST /api/ask` (signed in) — body
`{ action: "write" | "fix" | "check", instruction?, tone?, text?, image? }`
(instruction ≤ 1 000 chars, text ≤ 8 000 chars, image ≤ 2 MB base64 JPEG).

1. Verify ID token (`email_verified`).
2. Read `config/free` and `users/{uid}`. Blocked → 403 `blocked`.
   Free off → 403 `free_off`.
3. Validate body → 400 `bad_request`.
4. In a Firestore transaction on `usage/{uid}_{day}`: if `limitMode` is
   `daily` and `requests ≥ dailyRequests` → 429 `free_limit` (message includes
   the limit and "resets at midnight"); otherwise `requests += 1`. Counted
   before the AI call so parallel requests cannot slip past the limit.
5. Build the prompt with the shared module and call `config.provider/model`
   with the admin key.
6. Provider fails → refund (`requests -= 1`) and return 502 `upstream` with a
   friendly message.
7. Success → increment token counters in `usage/{uid}_{day}` (total and
   `byModel`) and `usageDaily/{day}`, set `users/{uid}.lastActive`, return
   `{ text, usage, model }`.

Nothing the user writes, and no screenshot, is logged or stored.

`GET /api/admin/providers` (admin) — which providers have a key set.
`GET /api/admin/models?provider=` (admin) — live model list using the admin key.

Errors always come back as `{ error: { code, message } }` with codes
`unauthenticated`, `blocked`, `free_off`, `free_limit`, `bad_request`,
`upstream`.

### Admin dashboard

A web page in the same Vercel project (`/admin`). Google sign-in; anyone other
than the admin sees "Not allowed" (and Firestore rules enforce it regardless of
the UI).

- **Switches:** Free mode ON/OFF · Unlimited / N requests per user per day ·
  provider (only those with a key set) · model (live list).
- **Prices:** input/output $ per million tokens per model, editable, used for
  cost estimates.
- **Totals:** today / last 7 days / last 30 days — requests, input tokens,
  output tokens, estimated cost.
- **Per model:** requests, tokens, estimated cost for the chosen period.
- **30-day chart:** requests per day.
- **Users table:** name, email, requests today, tokens (period), last active,
  **Block/Unblock**. Sortable by usage.

## 7. App architecture (Electron, Mac first)

Follows Souffleur/Loupe conventions: plain JavaScript, CommonJS in the main
process, vanilla HTML/CSS/JS renderers, `node --test`, ESLint, electron-builder.
macOS 14 or later (ScreenCaptureKit screenshot API).

```
buddy/
  app/
    src/main/        main.js, windows (buddy, panel, settings, onboarding),
                     tray, store, loginItem, shortcut, helper client,
                     ai router, auth (Phase 2), config client (Phase 2)
    src/renderer/    buddy/ (three.js scene, moods), panel/, settings/, onboarding/
    src/native/      BuddyHelper.swift
    assets/buddies/  *.glb, buddies.json
  shared/            prompts, provider adapters, usage parsing, day key —
                     used by app and server
  web/               Vercel project: api/, admin dashboard, firestore.rules
  art/               Blender sources + character build script, preview renders
  docs/
```

How `shared/` gets into both the Electron build and the Vercel deployment is
settled in the implementation plan.

### Buddy window

Transparent, frameless, no shadow, not focusable (clicking it does not steal
focus from the app the user is typing in), always on top at floating level,
visible on all Spaces and over full-screen apps. Slightly larger than the
character to leave room for floating and the speech bubble. Mouse events are
ignored on transparent pixels (forwarded hit-testing against the model) so
clicks pass through. Dragging is done in code (mouse events → IPC → move
window), not with a CSS drag region, so clicks and drags can be told apart.

### Native helper (`BuddyHelper.swift`)

One long-running process started by the main process (built with `swiftc`, like
Souffleur's AudioTap). Newline-delimited JSON over stdin/stdout:
request `{ id, cmd, args }` → reply `{ id, ok, result | error }`, plus events
`{ event, ... }`.

| Command / event | What it does |
|---|---|
| event `frontApp` | Emitted whenever the frontmost app changes (NSWorkspace notifications), excluding Buddy itself. Main keeps the last one as `lastApp`. |
| `permissions` | `{ accessibility, screenRecording }` |
| `requestAccessibility` / `requestScreenRecording` | show the system prompts |
| `captureSelection { pid, selectAll }` | Activate `pid`; refuse with `secure_field` if the focused element is a secure text field; save clipboard; optionally ⌘A; ⌘C; wait up to 300 ms for the clipboard to change; read text; restore clipboard. Returns `{ text }` (empty when nothing was selected). |
| `paste { pid, text, selectAll }` | Activate `pid`; save clipboard; set text; optionally ⌘A; ⌘V; restore clipboard after 500 ms. |
| `screenshot { pid }` | Capture the front window of `pid` with ScreenCaptureKit; return a downscaled JPEG (base64). |

### Panel open sequence

1. Buddy click or ⌥Space → main reads `lastApp`.
2. `captureSelection(lastApp, selectAll: false)` before the panel takes focus.
3. Panel opens on the Fix tab if text came back, otherwise on Write.

## 8. Errors

| Situation | What the user sees |
|---|---|
| Paste fails (no Accessibility permission, app gone) | Answer copied; bubble: "Copied — press ⌘V" |
| Focused field is a password field | "I don't read password fields." |
| No Screen Recording permission | Check screen tab explains and links to System Settings |
| No internet | Sleepy mood + "No internet" |
| Own key wrong/expired/out of credit | Provider's reason in plain words + "Open Settings" |
| `free_limit` | "You've used today's N free actions. Resets at midnight." |
| `free_off` | Config refreshed; key setup screen appears |
| `blocked` | "Your free access is paused." |
| Provider error on free route | "Buddy couldn't answer. Try again." (request refunded) |
| Model can't read images | "This model can't read screenshots. Pick another in Settings." |

## 9. Testing

- **Unit (`node --test`)**: shared prompts (shape, Hinglish instruction
  present, no-preamble rule); each provider adapter's request building and
  usage parsing with mocked `fetch`; route picking; IST day key; limit and
  refund logic; Check-screen JSON parsing with fallback.
- **Server handlers**: written with injected dependencies (token verifier,
  Firestore, provider) and tested for every error code and the
  count → call → refund/record order.
- **Firestore rules**: emulator tests for admin-only reads/writes and the
  `blocked`-only admin update.
- **Electron e2e** (as in Loupe): buddy window exists, is transparent and on
  top; drag + snap + remembered position; panel opens on click; turning on/off
  sets and clears the login item and `buddyOn`.
- **Manual checklist** (native helper cannot be automated reliably): Insert,
  Replace and Use-the-whole-box in Gmail (Chrome and Safari), WhatsApp Desktop,
  Notes, Mail; password field refusal; Check screen on Gmail compose;
  permissions revoked mid-use; reboot with buddy ON and OFF.

## 10. Phases

1. **Phase 1 — usable on your Mac:** buddy window + 2 characters (1 boy,
   1 girl) + moods, panel with all three actions, native helper, own-key route
   for all four providers, settings, always-on, menu bar.
2. **Phase 2 — free mode:** Google sign-in in the app, Vercel server
   (`/api/config`, `/api/ask`, admin endpoints), Firestore + rules, admin
   dashboard.
3. **Phase 3 — share it:** remaining 4 characters, polish, packaged release
   following Souffleur's release setup. A signed and notarized build needs an
   Apple Developer ID ($99/year); without it users see a Gatekeeper warning.
4. **Later (separate specs):** Windows, then Android.

## 11. Setup the owner must do (Phase 2)

Create the Firebase project (enable Google sign-in, Firestore), create a Google
OAuth client of type "Desktop app", create the Vercel project and set the
environment variables in §6, and add at least one provider key.
