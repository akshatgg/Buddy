# Buddy for Android — Design

Date: 2026-10-07. Status: agreed with the owner (approach and face style chosen 2026-10-07).

## 1. Goal

The same Buddy as on the Mac, on Android phones: a small buddy that floats over every app and helps people
write in English (Write for me, Fix my English, Check screen), with the same Google sign-in, the same free mode
and the same server.

On a phone the buddy is **only the head** — the cream head with the dark screen, the glowing eyes, the ear cups
and the top piece (the sprout for the boy, the bow for the girl). No body, no arms, no feet: a phone screen is
small, and the buddy must not cover much of it.

### Chosen by the owner

- **How Buddy reaches other apps:** a floating head over every app, plus "Fix with Buddy" in the text-selection
  menu of any app. No Accessibility service (Google Play has restricted it since 2026-01-28), no keyboard.
- **The face:** the real 3D head, from the same `.glb` files as the Mac (`assets/buddies/`), drawn with Filament.

### Out of scope

The Admin window (the admin uses the Mac), a Buddy keyboard, iPhone, Play Store publishing and release signing,
history of answers.

## 2. What the user sees

### Welcome (first launch)

1. **Sign in with Google** — Android's own account picker (Credential Manager). *Next* stays off until signed in.
2. **Pick a buddy** — the boy and the girl heads, turning slowly in 3D; give it a name (Aarav / Anaya by default).
3. **Let Buddy float** — "Display over other apps", with an *Open settings* button and a live check that turns
   green when it is allowed. Then notifications (Android 13+), which the always-on notification needs; it can be
   skipped.
4. **Connect an AI** — only when the person may need a key (free mode off, or a daily limit with own keys
   allowed), exactly as on the Mac.
5. Buddy appears.

### The buddy (the floating head)

- About 56 dp; Settings offers Small 44 / Medium 56 / Large 72.
- The Mac's moods, for a head: **idle** (slow float, blinks every 3–6 s), **thinking** (eyes become lines that
  sweep like a scanner, head tilted), **happy** (smile and a short bounce), **sleepy** (eyes shut, slight tilt —
  no internet or an error), **wave** (hello: smile and a little head wiggle, since there are no arms),
  **wobble** (while dragged).
- Drag it anywhere; on release it glides to the nearest left or right edge. The position is remembered.
- Tap it: the panel opens. Drag it onto the ✕ that appears at the bottom while dragging: Buddy turns off (as
  *Turn off* does) until it is turned on again in the app.
- A short speech bubble beside the head for status lines ("Copied — long-press the box and tap Paste").
- While it is on, Android shows Buddy's notification ("Buddy is on" · Turn off; a tap opens Settings), as every
  always-on app must.

### The panel

Opens over the current app when the head is tapped: a card with three tabs, like the Mac.

- **Write for me** — "What should I write?" and Formal / Friendly / Short. Answer: **Copy**, **Share**,
  **Try again**.
- **Fix my English** — a box with a **Paste** button (Android only lets an app read the clipboard when the person
  asks). Answer: the original and the fixed version, **Copy**, **Share**, **Try again**.
- **Check screen** — takes a picture of the screen behind the panel (Android asks "Start recording or casting?"
  each time; that is Android's rule), shows a thumbnail and an optional question. Answer: Looks good / Has
  problems, up to 5 problems, the corrected text, **Copy**.

After **Copy** the panel closes and the head says "Copied — long-press the box and tap Paste".

### Fix with Buddy (the text menu)

In any app that shows Android's text-selection menu (Gmail, WhatsApp, Chrome, Messages…): select text →
**Fix with Buddy**. A small sheet shows the fixed text with **Replace**, **Copy** and **Try again**. *Replace* puts
the fixed text in place of the selection; when the app does not allow replacing (read-only text), the sheet shows
**Copy** only. Text shared to Buddy (Share → Buddy) opens the same sheet with **Copy** only.

### Settings (the app's main screen after Welcome)

- **Account** — name, email, **Sign out**.
- **Buddy** — character, name, size, **Buddy on/off**.
- **AI** — the same four states as the Mac (free on; free with a daily count; free with "add your own key";
  free off → the provider / key / model form with all four AIs, where a pasted key picks its own AI).
- **Permissions** — display over other apps, notifications.

### Always on

Buddy on → it starts again after the phone restarts. Buddy off → it does not.

## 3. Rules shared with the Mac (one source)

- **Prompts and provider facts** live in `shared/` (JavaScript). `tools/sync-android-shared.js` writes them to
  `android/app/src/main/assets/shared.json`: every system prompt (write × each tone, fix, check), the limits,
  `MAX_TOKENS`, and per provider its label, key prefixes and fallback models. `npm test` fails when the file is
  stale, as it does for `web/shared`.
- **Errors**: the same codes and the same plain messages as the Mac (`BuddyError` codes from the server and the
  providers).
- **Routing**: exactly the Phase 2 table (`2026-10-07-buddy-phase-2-free-mode-design.md` §5 Routing): free when
  free mode covers the person, else their own key, else "Add your API key in Settings first."; the same refresh
  rules for `GET /api/config` (60 s, 8 s deadline, refresh after `free_off`, `free_limit`, `blocked`).
- **Server**: unchanged. The app calls `GET /api/config` and `POST /api/ask` with a Firebase ID token.

## 4. The app

Kotlin, Jetpack Compose, Android 8.0 (API 26) and up, target API 36. In `android/` at the repository root
(Gradle, Kotlin DSL). Package `com.akshatgg.buddy`.

| Part | What it does |
|---|---|
| `BuddyApp` | starts the parts below; one place that wires real or fake dependencies |
| `ui/welcome`, `ui/settings` | the Welcome steps and Settings (Compose, one `MainActivity`) |
| `ui/panel/PanelActivity` | the panel, a floating dialog over the current app |
| `ui/fix/FixActivity` | "Fix with Buddy" (`ACTION_PROCESS_TEXT`) and Share → Buddy (`ACTION_SEND`) |
| `bubble/BubbleService` | foreground service that owns the floating head window, the drag, the ✕ target, the speech bubble |
| `bubble/HeadRenderer` | Filament: loads the chosen `.glb`, shows only the `Head` node and what is under it, on a transparent `TextureView`; applies the pose |
| `bubble/Moods` | the Mac's `moods.js` in Kotlin, for a head: pure functions of time (float, blinker, mood poses, frame rate) |
| `capture/ScreenCapture` | one screenshot with MediaProjection, scaled so the long edge is at most 1568 px, JPEG q80 |
| `account/GoogleSignIn` | Credential Manager → Google ID token → Firebase `signInWithIdp` (REST, as the Mac) → ID + refresh tokens |
| `account/Account` | the stored refresh token, `idToken()` (renews it), sign out |
| `cloud/CloudClient` | `config()`, `ask()`; server error bodies → `BuddyError` |
| `ai/Router` | the routing table; calls `CloudClient` or a provider |
| `ai/providers/*` | Anthropic, OpenAI, Groq, Gemini: `complete()`, `listModels()`, `isVisionModel()` — ports of `shared/providers` |
| `ai/Prompts` | reads `shared.json`; `buildPrompt()`, `parseCheck()` |
| `store/AppSettings`, `store/Secrets` | settings (SharedPreferences); keys and the refresh token encrypted with an Android Keystore AES key |
| `BootReceiver` | starts Buddy after a restart when it is on |

Gradle takes the `.glb` files from `assets/buddies/` into the APK's assets at build time (leaving out the Mac's
previews and `buddies.json`, which the app does not read), so the Mac and Android share one copy.

`android/cloud.properties` (not in git, like `cloud.json`) holds the server URL, the Firebase Web API key and the
Google **web** client ID; the build fails without it. `npm run sync:android` writes it from `cloud.json` plus the
web client ID.

### Firebase setup (done once, from the command line)

- Register the Android app `com.akshatgg.buddy` in Firebase project `buddy-7f8c2` and add the SHA-1 of the debug
  signing key, so Google sign-in works on a phone and the emulator. (A release key's SHA-1 is added when the app is
  published.)
- The Google web client ID (auto-created by Firebase for Google sign-in) is the `serverClientId` the account picker
  needs; Firebase accepts the ID token it gives.

## 5. Errors

As on the Mac, with these Android-only lines:

| When | Says |
|---|---|
| Display over other apps not allowed | "Let Buddy float: allow Display over other apps." with *Open settings* |
| The person says no to the screen picture | "Check screen needs a picture of your screen. Try again and allow it." |
| Replace not allowed by the other app | the sheet shows Copy only |
| No Google account on the phone | Android's own "Add an account" screen |

## 6. Privacy

As on the Mac: what people write and their screenshots go only to the AI (through the server in free mode) and are
never stored. Keys and the refresh token never leave the phone except to their own AI / Google.

## 7. Testing

- **JVM unit tests:** routing (every row of the table), prompts against `shared.json`, `parseCheck`, each provider's
  request and answer (with a fake HTTP), key → provider, server errors → `BuddyError`, moods, edge snapping.
- **Root `npm test`:** `shared.json` is up to date.
- **On the emulator (Pixel 7, API 36):** Compose UI tests for Welcome, Settings and the panel with a fake account
  and fake server; then a real run: the head floats over other apps, drag and snap, tap → panel, Fix with Buddy in
  a text field replaces the text, Check screen, real sign-in and a real answer through the server. Screenshots are
  kept for the PR.
- `docs/manual-checklist-android.md` for what only a person can check on a real phone.

## 8. Delivery

Branch `android` (worktree `~/projects/buddy-android`), one PR to `master` when it all works on the emulator.
`npm run android:build` builds the debug APK (`android/app/build/outputs/apk/debug/app-debug.apk`).
