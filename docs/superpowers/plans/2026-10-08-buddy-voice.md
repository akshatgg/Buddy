# Voice (PR 2) Implementation Plan

> **For agentic workers:** three tasks run in parallel on their own branches and worktrees, each touching only its own
> files, meeting through the contracts below. Do not change a name, a shape or a channel; if a contract is wrong, stop
> and report.

**Goal:** Talk to Buddy: the panel listens when it opens, writes down what was said with Whisper on Groq (through
Buddy's server), and sends it. Spec: `docs/superpowers/specs/2026-10-08-buddy-chat-panel-design.md` §6 and the one-box
design's §4 (`git show e8aec99:docs/superpowers/specs/2026-10-08-buddy-one-box-voice-design.md`).

**Architecture:** the page records (MediaRecorder, WebM/Opus) and decides when speech has ended (a pure timing
module); main hands the recording to Buddy's server (`cloud.transcribe`), which sends it to Groq. Main owns the
microphone permission, the "Listen when the panel opens" setting, and tells the page whether voice is on.

**Tech Stack:** as PR 1 (Electron 44, CommonJS, `node --test`, ESLint, Vercel functions).

## Global Constraints

Everything in the PR 1 plan's Global Constraints, plus:
- Only the panel page may use the microphone (Electron permission handlers); nothing else gets `media`.
- No recording is kept anywhere (not on disk, not on the server); only the kind of a failure is logged.
- Moods: none new. Main calls `ui.listening(on)` and `ui.voiceLevel(level)` (the no-op hooks in main.js) and nothing
  else for the buddy.

## Contracts

### V1. The server (Task F)

`POST /api/transcribe`, signed in, body `{ audio: string /* base64 */, mime: string }` → `{ text }`.
- `audio` required, ≤ 2_800_000 characters; `mime` one of `audio/webm`, `audio/webm;codecs=opus`, `audio/ogg`,
  `audio/ogg;codecs=opus`, `audio/mp4`, `audio/wav` → else `bad_request` "That recording didn't come through. Try again.".
- A blocked person → `blocked` "Your free access is paused." (as `ask`). Not counted as a free request.
- No `GROQ_API_KEY` → `voice_off` (status 503) "Voice isn't set up yet.".
- Groq `POST https://api.groq.com/openai/v1/audio/transcriptions` (multipart: `file`, `model: whisper-large-v3-turbo`,
  `response_format: json`, `temperature: 0`, `prompt`: a short Hinglish-and-English example such as "Namaste. Kal mujhe
  chutti chahiye. Please write a mail to my boss.") with a 30 s timeout. Its 429 → `voice_busy` (status 429) "Voice is
  busy right now. Type, or try again in a minute."; any other failure → `upstream` "I couldn't write down what you said.
  Try again.". The text is trimmed; an empty one is answered as `{ text: '' }`.
- `GET /api/config` gains `voiceOn: boolean` (the server has a Groq key). The admin settings view gains `voiceOn` too.
- App: `cloud.js` `readSettings` gains `voiceOn`; `SERVER_CODES` gain `voice_off`, `voice_busy`;
  `cloud.transcribe({ audio, mime }, { signal })` → the text (string).

### V2. Main ↔ page (Task H makes main; Task G makes the page)

The C4 panel state gains `voice: { on: boolean, auto: boolean, mic: 'granted' | 'denied' | 'not-determined' | 'restricted' | 'unknown', system: 'darwin' | 'win32' | string }`.
- `on`: signed in and `cloud.last()?.voiceOn === true`. `auto`: the store's `listenOnOpen` (default true).
- `mic`: Mac `systemPreferences.getMediaAccessStatus('microphone')`; elsewhere `'unknown'` (Windows does not ask per app).

Page → main (`window.buddy`, added to `src/preload/panel.js`):
- `micAccess()` → `invoke('panel:mic-access')` → `{ ok, mic }`: on the Mac asks macOS when it is `not-determined`
  (`systemPreferences.askForMediaAccess('microphone')`), then answers the status; elsewhere `'unknown'`.
- `transcribe(audio, mime)` → `invoke('panel:transcribe', audio, mime)` → `{ ok, text }` (errors as `{ ok: false, error }`).
- `listening(on)` → `send('panel:listening', Boolean(on))`; `voiceLevel(level)` → `send('panel:voice-level', level)`
  (0..1, the page sends at most 10 a second).
- Microphone errors use the existing `openSettings(code)` with code `no_microphone`: main opens Settings → Permissions
  on the Mac and `ms-settings:privacy-microphone` on Windows.

### V3. The page's voice (Task G)

`src/renderer/panel/voice-timing.js` (pure; loaded as a script and required by tests like `chat-view.js`):
`createVoiceTiming()` → `{ feed(level, ms) → 'listen' | 'done' | 'nothing' | 'too-long', heardVoice() }` with
`SPEECH_LEVEL` 0.06 (RMS, 0..1), done after `QUIET_MS` 1500 of quiet following at least `MIN_SPEECH_MS` 300 of speech,
`'nothing'` after `NOTHING_MS` 8000 with no speech, `'too-long'` at `MAX_MS` 60000 (sent like done when a voice was heard).

---

### Task F: the server and the app's call

**Files:** `web/lib/handlers.js`, new `web/lib/transcribe.js` (the Groq call, `fetchImpl` injectable), new
`web/api/transcribe.js`, `web/vercel.json` (only if a function setting is needed), `src/main/cloud.js`,
`src/renderer/admin/*` and `src/main/ipc/admin.js` (show "Voice is on." / "Voice needs GROQ_API_KEY in Vercel." from
`voiceOn`); tests `test/server-handlers.test.js`, new `test/server-transcribe.test.js`, `test/cloud.test.js`,
`test/admin-ipc.test.js`.
- [ ] Tests first for V1 (sign-in, blocked, no key, bad input, Groq's answer, its 429 and other failures, the form it
  posts, nothing logged but the kind, not counted), `voiceOn` in config and the admin view, `cloud.transcribe` and
  `readSettings`. Then implement. `npm test`, commit.

### Task G: the page — recording, timing, the 🎤

**Files:** `src/renderer/panel/index.html`, `panel.css`, `panel.js`, new `voice-timing.js`, `src/preload/panel.js`;
tests new `test/voice-timing.test.js` (and `test/chat-view.test.js` if you add view helpers there).
- [ ] Tests first for V3. Then the page: the 🎤 button in the box; listening: 🎤 glows and pulses, three small bars
  follow the voice, placeholder "Listening… speak now"; then "Writing down what you said…"; the words go in the box and
  are sent (as if ↩). Starts by itself on `panel:open` when `voice.on && voice.auto && voice.mic` is `'granted'` (Mac) or
  `'unknown'` (Windows); 🎤 starts and stops it any time. Typing, 🎤, Esc, closing stop it and nothing is sent. Only a
  recording in which a voice was heard is sent. Messages (the page's own red line): voice off → "Voice isn't set up
  yet."; no words → "I didn't catch that. Try again, or type."; the server's messages as they come; microphone refused
  on the Mac → "Allow the microphone in Settings." with Open Settings (`openSettings('no_microphone')`); getUserMedia
  failing on Windows → "Turn on the microphone in Windows Settings → Privacy & security → Microphone." with Open
  Settings (same code). Recording: `getUserMedia({ audio: { echoCancellation, noiseSuppression, autoGainControl } })`,
  `MediaRecorder` with `audio/webm;codecs=opus` (fall back to what the browser offers), an `AnalyserNode` RMS every
  100 ms into the timing and `voiceLevel`; `listening(true/false)` at start and end; stop at 2 MB. Release the
  microphone (stop every track, close the AudioContext) whenever listening ends.
- [ ] Check it in a throwaway harness with Chrome's fake microphone
  (`--use-fake-ui-for-media-stream --use-fake-device-for-media-stream`) as in PR 1's page check. `npm test`, commit.

### Task H: main — permission, settings, the call, the build

**Files:** `src/main/actions.js` (only: `voice` in the state, `transcribe`), `src/main/ipc/panel.js`,
`src/main/panel-window.js` (permission handlers for its session, only `media` with audio, only for the panel page),
`src/main/main.js` (wiring: the `voice()` source for actions; `ui.listening`/`ui.voiceLevel` stay the no-op hooks),
`src/main/store.js` (`listenOnOpen: true`), `src/main/ipc/settings.js`, `src/preload/settings.js`,
`src/renderer/settings/*` (General: switch "Listen when the panel opens"; Permissions: a Microphone row on the Mac with
Allow / Open System Settings, pane `x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone`),
`electron-builder.config.js` (`NSMicrophoneUsageDescription`: "Buddy listens when you talk to it, to write down what
you say."), `build/entitlements.mac.plist` (`com.apple.security.device.audio-input`), `test/e2e/*` (a voice check with
Chromium's fake microphone and a fake server answering `transcribe`); tests `test/actions.test.js`,
`test/panel-ipc.test.js`, `test/settings-ipc.test.js`, `test/store.test.js`, `test/panel-window.test.js` if present.
- [ ] Tests first for V2's main side. Then implement. `npm test`, `npm run test:e2e` (the voice check can only pass
  after the merge — say so), commit.

## Merge (the coordinator)

Merge F, G, H into `voice`; `npm test`; `npm run test:e2e`; review; manual checks with real speech.
