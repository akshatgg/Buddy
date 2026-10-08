# Buddy for Android: the chat panel, memory and voice — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: Buddy for Android (`2026-10-07-buddy-android-design.md`), the desktop chat panel
(`2026-10-08-buddy-chat-panel-design.md`, whose rules this follows unless said here), and "look where I type"
(`2026-10-08-buddy-android-look-where-i-type-design.md`), whose Accessibility service this widens.

## 1. Goal

The Android panel becomes the same chat as on the desktop: one box, Buddy answers, does it in the app, remembers the
person, and listens when they speak. Owner's choices (2026-10-08): put text into other apps through Accessibility
(Copy and Share without it); no "Send it?" on Android; memory stays on the phone (no sync between devices).

## 2. The panel is a chat

As the desktop (chat panel spec §2), in Compose, in `PanelActivity`:

- Header: the buddy's name, ⚙︎ (Settings) and ✕.
- Messages: the person's on the right, the buddy's on the left, newest at the bottom, scrolling.
- Empty chat: `Hi <first name>! What should we do?` and the example line
  `“boss ko mail, kal chutti chahiye” · “fix this” · “what does this mean?”`.
- **Selection card:** when the panel was opened from "Fix with Buddy" (the text-selection menu) or Share → Buddy, a
  card `Your selection: “first words…”` with ✕; ↩ in an empty box fixes it. The old Fix sheet's Replace stays: an
  answer to a selection from the text menu gets **Replace** (Android's `PROCESS_TEXT` result) when the app allows it.
- The box: `Tell me what to do…`, a send button and 🎤 (§5). A second message waits until the answer has come.
- While it works: `<name> is thinking…`; the head thinks.
- **Answers** by kind, as the desktop: `write`/`fix` → the text with **Insert** (or **Replace**) and **Copy** and
  **Share**; `answer` → **Copy**; done in the app (§3) → `✅ Put it in <app>` with **Undo** and **Copy**.
- Small lines: `👀 Looked at the screen`, `📖 Read your text`, `📝 Remembered: …` with Undo.
- Errors in red with **Try again**, and **Open Settings** where the fix is there.
- The chat ends when the panel is closed with ✕ or Back; a panel only hidden (Buddy put text in the app) opens on the
  same chat within 5 minutes.
- **Gone:** the three tabs (Write / Fix / Check), the tone buttons and the old Fix sheet's own screen.

## 3. The AI request and doing it in the app

- The request is the desktop's `chat` (`shared/prompts.js` `chatPrompt` and `parseChat`), the same JSON answer.
  `tools/sync-android-shared.js` adds to `shared.json` what the chat needs: the chat system prompt, `KINDS`,
  `CHAT_LIMITS`, and the memory rules (`shared/memory-rules.js`: the words and limits `cleanFact` uses). Kotlin ports:
  `chatPrompt`, `parseChat`, `cleanFact`. The `projects` field is never sent from Android (no `code` kind).
  The routing (free / own key) does not change.
- **App name:** the panel knows which app is under it from the Accessibility service (the last window's package,
  turned into its label), else none.
- `box`: Buddy reads the text of the box the person was typing in, through the Accessibility service, and asks again.
  Without the service on, or no box: `Turn on "Buddy can type for you" in Settings to let me read your box.` with
  **Open Settings**.
- `screen`: one screenshot with `ScreenCapture` (Android asks each time, as Check does today), then asks again.
- `send`: `I can't press Send on Android. Press Send yourself.`
- **doIt** with text, the service on and a box known: the panel steps aside and Buddy sets the box's text through
  Accessibility: the selection replaced, a box read for `box` replaced whole, else the text inserted at the cursor
  (`ACTION_SET_TEXT` with the new whole text, then the cursor after it with `ACTION_SET_SELECTION`). The bubble says
  `Done! It's in <app> ✅`; the head celebrates on the feelings branch, `happy` on Android today.
  **Undo** sets the box back to the text it had before. When the box cannot be set (gone, read-only, a password):
  the text is copied and the bubble says `Copied — long-press the box and tap Paste`.
- Without the service: Insert is Copy (`Copied — long-press the box and tap Paste`), plus **Share**.

## 4. The Accessibility service, widened

- The look service (`LookService`) also does the chat's reading and writing. Its name and texts change:
  - Settings row: **Buddy can type for you** (it replaces "Look where I type"), line off:
    `Lets Buddy put its text into the box you are typing in, read that box when you ask, and look at it.`;
    on: `On. Buddy reads or writes only the box you ask it about, and only when you ask.`
  - The disclosure dialog: `Buddy uses Android's Accessibility to see where the box you are typing in is, so that the
    head can look at it; to read the text in that box only when you ask Buddy to fix it; and to put Buddy's text into
    it when you ask. It reads nothing else, and nothing is kept or sent anywhere except with your question to the AI.`
  - The service's description in Android's list says the same in one sentence.
- It remembers the last focused editable box (a node reference, refreshed; not its text) and the app's package, so
  the panel can read or write it after the panel opened. It never reads text unless the chat asks (`box`, or the
  current text for Undo and insert), never logs or stores text.
- Password boxes are never read or written.

## 5. Voice

- 🎤 in the box. The first press asks for the microphone (`RECORD_AUDIO`); refused: `Buddy needs the microphone to
  hear you. Allow it in Settings.` with **Open Settings** (the app's Android settings page).
- Pressing starts recording (`MediaRecorder`, AAC in MP4, mono, 16 kHz, at most 60 s); the head shows `listening` on
  the feelings branch, `thinking` on Android today; the 🎤 turns into ■. Press again (or 60 s) → stop, send to the
  server's `POST /api/transcribe` with the ID token (`{ audio: base64, mime: 'audio/mp4' }`), and the words go into the
  box (the person sends them, as on the desktop when auto-send is off).
- `GET /api/config` `voiceOn: false` → 🎤 shows `Voice isn't set up yet.`. Errors in the desktop's words.
- No recording is kept: the file is in the app's cache and deleted after the request, however it ends.

## 6. Memory (on this phone)

- As the desktop's memory (chat panel spec §5), kept in the app's settings on this phone only: facts from
  `remember` with `📝 Remembered: …` and Undo, at most 50, each ≤ 200 characters, `cleanFact` rules (no passwords,
  PINs, OTPs, card or ID numbers, 12+ digits), sent with each chat request.
- Settings gets a **Memory** section: `What Buddy knows about you` with ✕ on each, a box to add one, **Forget
  everything** (asks first), and the switch `Learn about me from chats` (on by default).

## 7. Testing

- JVM unit tests: the Kotlin `chatPrompt`, `parseChat` and `cleanFact` against the same cases as the desktop tests
  (`test/prompts.test.js`, `test/memory-rules.test.js`); the shared.json additions (the sync test); the chat state
  machine in `PanelModel` with fake ask / box / screen / put / voice (every kind, the second step, doIt with and
  without the service, Undo, errors, the 5-minute resume); the text-setting math (replace selection, replace all,
  insert at cursor); memory (add, limits, cleanFact refusals, forget, learning off); the voice flow with a fake
  recorder and server (permission refused, voiceOn false, upload, the file deleted).
- Emulator: install with `adb install -r` (never wipe the app: the owner's sign-in is on it), and only if Buddy is
  already signed in and set up: open the panel, send a message, see an answer; type into a box in Messages, ask
  "fix my English" with the service on and see the box change. Otherwise report and stop.
- Manual checklist (`docs/manual-checklist-android.md`): a new section for the chat, memory and voice.

## 8. Out of scope

Sharing memory between devices (the owner dropped it 2026-10-08), "Send it?" on Android, the `code` kind, the
desktop's feelings on Android (the head keeps its six moods), auto-send after voice.
