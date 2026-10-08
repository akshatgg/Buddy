# Buddy for Android: the chat panel — Plan

Spec: `docs/superpowers/specs/2026-10-08-buddy-android-chat-design.md` (§2 the chat, §3 the request and doing it in the
app, §4 the Accessibility service). Branch `android-chat`, on top of `android-look`.

Built in parallel (lead's split, 2026-10-08): **memory** (the store, `cleanFact`, `memoryRules` in shared.json,
Settings → Memory) and **voice** (recorder, transcribe, microphone, `MicButton`) are other branches. This branch codes
against their interfaces only:

- `store.Facts` / `store.Fact` (`facts()`, `add(text, source)`, `remove(id)`, `learning`): the panel saves and forgets
  facts through it; AppGraph passes a placeholder that keeps nothing until the memory branch merges.
- `PanelScreen`'s box has a `micButton` slot; `PanelModel.voiceWords(text)` puts words in the box (not sent) and
  `PanelModel.voiceError(err)` shows the error line.

Every step: a failing JVM test, run it, the code, run it, commit. `npm run android:test` before every commit; `npm test`
when shared/ or tools/ change. The Kotlin compiles with
`cd android && ./gradlew -q -Djava.net.preferIPv4Stack=true :app:assembleDebug -x checkCloudProperties`.

## Task 1 — the chat in shared.json

- `shared/prompts.js` also exports `KINDS` and `CHAT_LIMITS` (no change to any prompt or rule).
- `tools/sync-android-shared.js` adds `chat: { system, kinds, limits, messages }` (the system prompt as `buildPrompt`
  makes it; the refusals `Tell me what to do first.`, the second-step one, too long). It also writes
  `android/app/src/test/resources/chat-cases.json`: inputs of `chatPrompt` and `parseChat` with the answers the
  JavaScript gives, so that the Kotlin port is checked against them.
- `test/android-shared.test.js`: both files up to date; the chat section is what `buildPrompt` makes.

## Task 2 — Kotlin `chatPrompt` and `parseChat`

- `core/Shared.kt` reads `chat`. `ai/Prompts.kt`: `Action.CHAT`, `AskInput`'s chat fields (message, selection, box,
  history, facts, appName, userName, step), `ChatTurn`, `ChatReply`, `Prompts.parseChat`.
- `PromptsTest`/`ChatPromptTest`: the cases of `test/prompts.test.js` (labels, limits, the second step, history, facts,
  names, parseChat's kinds, fences, raw breaks, odd fields, caps, `again`, never throws) and every case in
  `chat-cases.json`.

## Task 3 — the chat request through both routes

- `CloudClient.ask` sends the chat fields (history as `{from, text}`, facts, step); `Answer.chat` is read with
  `parseChat` on both routes (`Router.askOwn`, `CloudClient.ask`). Tests in `CloudClientTest` and `RouterTest`.

## Task 4 — the head turns smoothly

- `Moods.drawFps(fps, picker, looking)`: while the look eases, at least FPS (30); the picker's turn at least IDLE_FPS;
  else as before. `HeadView.tick` uses it. `MoodsTest`.

## Task 5 — putting text in a box (pure)

- `chat/TextEdit.kt`: `BoxText(text, selStart, selEnd)`, `Edit(text, cursor, start, end)`; replace the selection
  (the selected range, else the selected words where they are, else at the cursor), replace all, insert at the cursor
  (over a selection; at the end when the cursor is unknown); again over an earlier put. `TextEditTest`.
- `bubble/TypingTarget.kt`: which box and which app (the last focused text box, not a password, its package; the app
  under the panel from the last window, not Buddy, the keyboard or the system UI; a box of another app is forgotten
  when that app's window goes). `TypingTargetTest`.

## Task 6 — "Buddy can type for you"

- `LookService` keeps the box (a node reference, never its text) through `TypingTarget`, and does the reading and
  writing when the panel asks (`TypeIn`: `on`, `appName`, `read()`, `write(text, cursor)`); never a password box.
  `look_service.xml` gets `flagRetrieveInteractiveWindows`; the manifest a `<queries>` for launchable apps (the app's
  label). Strings: the service's label and description.
- Settings: the row **Buddy can type for you** with the spec's lines; the disclosure's new words. `SettingsScreenTest`
  (instrumented, compile only here).

## Task 7 — the chat PanelModel

- `ui/panel/PanelModel.kt` as a chat (desktop's actions.js on a phone), with fakes for ask, the box (`TypeIn`), the
  screen, putting (step aside, the PROCESS_TEXT Replace), the clipboard and the facts: every kind, the second step and a
  second `box`/`screen`, doIt with and without the service, Replace through PROCESS_TEXT, Undo, again, remember and its
  Undo, errors with Try again and Open Settings, one message at a time, the 5-minute resume, `voiceWords`/`voiceError`.

## Task 8 — the chat on screen

- `PanelScreen`: header (name · app, ⚙︎, ✕), the messages, the greeting and examples, the selection card, the box with
  send and the `micButton` slot, `<name> is thinking…`. Tabs, tones and the Fix sheet's own screen go.
- `PanelActivity` wires the model to Android (the service, ScreenCapture, step aside with `moveTaskToBack`, the
  clipboard, Share, Settings). `FixActivity` shows the same chat with the selection card; Replace hands the text back
  (PROCESS_TEXT) when the app allows it. The instrumented tests follow (compile only).

## Task 9 — docs

- The Android design notes (`2026-10-07-buddy-android-design.md`), the README's Android section and a chat section in
  `docs/manual-checklist-android.md`.
