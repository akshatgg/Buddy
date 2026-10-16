# "Only my voice": Buddy wakes only for its owner (Mac + Android)

Date: 2026-10-16. Branch `my-voice` (worktree `~/projects/buddy-my-voice`), on top of the wake work
(`docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md` §3, plan
`docs/superpowers/plans/2026-10-15-hey-buddy-voice-and-wake.md` Part B) and the wake-hey-only fix (the wake phrases are
only "hey <name>" and "hey buddy").

## What the owner decided (fixed)

- A Settings switch **"Only my voice"**, right under the "Listen for Hey <name>" switch. Turning it on starts a short
  setup: Buddy asks the person to say "Hey <name>" five times and learns their voice. The voice is kept **on this device
  only**: never uploaded, never synced to the account, never in a backup.
- Buttons: **Set up again** (redo the setup) and the switch itself to turn it off.
- After a wake phrase is heard, Buddy checks the voice of **the wake phrase's own audio** against the learned voice
  **before anything is sent to the server**. Not the owner: Buddy stays silent and nothing is sent.
- Strictness **Balanced**: rarely accepts someone else; the owner may sometimes have to repeat in noise. One fixed
  threshold, no choice in Settings.
- Mac and Android together. Free, on the device. An extra download of about 25 MB is fine.
- Copy in plain short English.

## The engine and the model (researched 2026-10-16)

**Engine: sherpa-onnx 1.13.8** (k2-fsa, Apache 2.0), its `SpeakerEmbeddingExtractor`, on both apps.

- **Mac:** the npm package `sherpa-onnx-node@1.13.8` (a Node-API addon, so no rebuild for Electron) with its prebuilt
  `sherpa-onnx-darwin-arm64@1.13.8` (`sherpa-onnx.node`, `libsherpa-onnx-c-api.dylib`, `libonnxruntime.dylib`; all
  ad-hoc signed, linked by `@rpath` with `@loader_path`; 34 MB unpacked, about 10 MB in the DMG). It runs in an Electron
  **utilityProcess** (a crash or the ~106 MB it takes stays out of the main process). Checked on this Mac with Electron
  44.5.1: loads in 170 ms, one embedding of 1 s of audio in 9-10 ms. **`compute(stream, false)` is required**: with the
  default `true` Electron throws "External buffers are not allowed".
- **Android:** the release asset `sherpa-onnx-static-link-onnxruntime-1.13.8.aar` (38.7 MB; SHA-256
  `b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471`). It is not on Maven Central, so the build fetches it
  from the GitHub release and checks that hash. One `.so` per ABI: arm64-v8a 24.2 MB (9.0 MB compressed), armeabi-v7a
  16.4 MB (8.1 MB compressed). With `jniLibs.useLegacyPackaging = true` the release APK grows by about **17 MB**
  (uncompressed it would be about 40 MB). Kotlin API (from the AAR's classes):
  `SpeakerEmbeddingExtractor(null, SpeakerEmbeddingExtractorConfig(model = path, numThreads = 1))`, `createStream()`,
  `OnlineStream.acceptWaveform(FloatArray, 16000)`, `inputFinished()`, `isReady(stream)`, `compute(stream): FloatArray`,
  `release()`.
- Why not the others: **vosk-browser has no speaker model**, and vosk's own `SpeakerModel` (Android only, x-vector, no
  published accuracy) would mean two engines and two thresholds. **sherpa-onnx's WebAssembly npm build** (`sherpa-onnx`)
  does not export the speaker embedding extractor (checked: only diarization symbols). onnxruntime-web/-node plus our own
  fbank code would have to match the model's features by hand on two platforms. The Swift helper has no ONNX runtime.
  One engine on both apps means the same features, the same model, one threshold and shared test vectors.

**Model: 3D-Speaker CAM++ zh-en "common advanced"**
(`3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx` from sherpa-onnx's `speaker-recongition-models` release;
upstream `iic/speech_campplus_sv_zh_en_16k-common_advanced` on ModelScope). **Apache 2.0.** 28,281,164 bytes, SHA-256
`aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2` (matches upstream `checksum.txt`). Input 16 kHz mono,
80-dim fbank (computed inside sherpa-onnx), output 192 floats. Published EER: VoxCeleb1-O 1.16%, CN-Celeb 5.98%.
Trained on large Chinese and English sets, which suits Indian English and Hinglish better than a VoxCeleb-only model.

Why this one: in a spike on this Mac (10 macOS voices, "Hey Buddy" ~0.6 s, enrolled on 5 takes, tested on 2 new takes)
it separated speakers clearly (same speaker min 0.74, other speakers max 0.63), while the English-only VoxCeleb CAM++
exports (3D-Speaker and WeSpeaker) did not separate at all on short phrases, WeSpeaker ResNet34 overlapped heavily, and
NeMo TitaNet-small separated too but is 40 MB. CAM++ is also the cheapest to run (1.72 GFLOPs vs 6.84 for ResNet34).

The model is ~28 MB, a little over the 25 MB the owner allowed; gzip saves only 9%, so it is hosted as the plain `.onnx`.

## The threshold ("Balanced")

- Published: ModelScope's configuration for this model sets `yesOrno_thr: 0.33` (its demo threshold), the decision point
  for full-length utterances.
- A wake phrase is under a second, so scores are noisier and other speakers score higher than on long speech. The
  spike (cosine score of a test take against the 5-take profile):

  | threshold | clean: others accepted | 20 dB noise: owner refused / others accepted | 10 dB noise: owner refused |
  |---|---|---|---|
  | 0.45 | 21/180 | 0/20, 10/180 | 1/20 |
  | **0.50** | 11/180 | 1/20, 6/180 | 4/20 |
  | 0.55 | 7/180 | 1/20, 2/180 | 5/20 |
  | 0.60 | 2/180 | 2/20, 0/180 | 8/20 |

  (Synthetic voices from one engine are harder than real people for "others", and easier than a real person for the
  "owner" row: a real owner varies more between takes.)
- **Balanced = 0.50.** Score = cosine similarity between the wake phrase's embedding and the owner's profile; **accept
  when score ≥ 0.50**. It sits well above the published 0.33, refuses most other voices, and the owner repeats only in
  real noise. One constant, `MY_VOICE.match` in `shared/my-voice.js`; the Android port reads the same number. The owner
  can check it on his own voice with `tools/check-my-voice.js` (plan Task M1) before release, and only this number moves.

## How the voice is learned (setup)

1. Only offered while "Listen for Hey <name>" is on and listening (the Vosk model is there, the microphone allowed).
   Turning "Only my voice" on first gets the voice-check model (28 MB) if it is not there.
2. Buddy listens with the wake loop in a **setup mode**: only the phrase "hey <name>" (or "hey buddy" when the model
   can't hear the name, as today), nothing after it is taken, nothing is sent anywhere. Each time the phrase is heard,
   its audio is cut out (see "The phrase audio") and turned into an embedding on the device.
3. A take is **refused** (and the person asked again) when its phrase audio is shorter than 350 ms, or the extractor has
   not enough frames (`isReady` false), or the embedding is all zeros / not finite.
4. After 5 good takes: each take's embedding is made unit length, the profile is the **unit-length mean** of the 5.
   Each take is then checked against the mean of the **other four**: a take scoring below **0.45** (`MY_VOICE.agree`)
   is "odd" (a cough, someone else, a bang) and is dropped and asked for again. At most 3 extra takes in all; more than
   that, or 90 s without finishing, and setup fails with nothing saved.
5. Success: the profile is saved; the switch is on. Cancel (the switch turned off during setup, Settings closed, the
   wake switch turned off): nothing is saved.

## The phrase audio

Vosk's final result gives each phrase word's `start` and `end` (seconds since that recognizer began). `wakeFrom` now
also returns `startSec` (the first phrase word's start). The phrase clip is the kept audio from `startSec − 0.1 s` to
`endSec + 0.1 s` (`MY_VOICE.padMs`), capped at 3 s. It is the **wake phrase only**: never the request after it. It lives
only in memory, is checked, and is dropped.

## The check (after every wake, when "Only my voice" is on)

- **Mac:** the ear page sends the phrase clip (16 kHz PCM16, base64) with `ear:woke` and with `ear:request`. Main is the
  gate: in `wake.js onRequest`, before `actions.transcribe` (the first thing that sends anything), it asks
  `myVoice.allows(phrase)`. Not the owner, or any failure (no clip, too short, model missing, worker crashed, timeout of
  3 s, no saved profile) → **return silently**: nothing transcribed, nothing said, no chat.
- **Android:** `WakeListener` checks right after the phrase is recognised, before it emits `Woke` (so the bubble does not
  even look up) and before the request is recorded. Not the owner → the recognizer restarts silently. `HandsFree` and the
  server never see it.
- **Fail closed:** with "Only my voice" on, Buddy never sends a request it could not check. If the check can't run at
  all (the model file is gone, the profile can't be read, the profile was made with another model), Settings says so
  ("Set up Only my voice again.") and the wake still listens but answers nobody until setup is redone or the switch is
  turned off.
- **Test it** (the wake row's button) with "Only my voice" on counts only wakes that pass the check; a wake that does not
  shows "That didn't sound like you."
- Turning the wake switch off leaves "Only my voice" and the profile as they are; turning it back on checks again.
- Renaming the buddy keeps the profile (the embedding is about the voice, not the words).

## Where the voice is kept

- A small JSON file, `{ "v": 1, "model": "<model sha256>", "dim": 192, "profile": [192 numbers], "at": "<ISO date>" }`:
  - Mac: `<userData>/my-voice.json`, mode 0600. Not in the settings store, so nothing that syncs or exports settings can
    carry it.
  - Android: `filesDir/my-voice.json`. The manifest already has `android:allowBackup="false"`.
- A profile whose `model` is not the current model's SHA-256, or whose numbers are not 192 finite ones, is treated as
  missing.
- **Turning the switch off deletes the file.** Set up again replaces it only when the new setup succeeds.
- The 5 takes' audio and embeddings are never written anywhere.

## The model download

- New release tag **`speaker-model-1`** on `akshatgg/Buddy`, one asset `campplus-zh-en-advanced.onnx` (the upstream file,
  byte for byte). `tools/pack-speaker-model.js` downloads it from the sherpa-onnx release, checks the upstream SHA-256,
  copies it to `release/speaker-model/` and prints the `gh release create` command. **Publishing is the owner's step.**
- `shared/my-voice.js` holds `SPEAKER_MODEL = { name, tag, file, url, sha256, bytes, dim }`. Both apps download it on
  first use (when "Only my voice" is turned on), stream it to `<file>.part`, keep it only when the SHA-256 matches,
  rename it into place. Mac: `<userData>/voice-model/campplus-zh-en-advanced.onnx` (next to the Vosk model). Android:
  `filesDir/voice-model/campplus-zh-en-advanced.onnx`.
- Native code is never downloaded: the engine ships inside the app (Mac: asar-unpacked addon; Android: the AAR's `.so`).

## Packaging

- **Mac:** `sherpa-onnx-node` is a dependency (exact `1.13.8`); `electron-builder.config.js` unpacks
  `node_modules/sherpa-onnx-darwin-arm64/**` and `node_modules/sherpa-onnx-node/**` from the asar (a `.node` and dylibs
  can't load from inside it) and leaves all `sherpa-onnx-*` packages out of the Windows build. `build/afterPack.js` signs
  the three Mach-O files in `app.asar.unpacked` with the same identity as the helper **before** the bundle seal, verifies
  them, and fails the build if they are missing. Hardened runtime is off today (no Developer ID); if it is ever turned
  on, the entitlement `com.apple.security.cs.disable-library-validation` will be needed for these dylibs.
- **Android:** `android/app/build.gradle.kts` gets a `fetchSherpaOnnx` task (download + SHA-256 check into
  `android/app/libs/`, which is git-ignored) that `preBuild` depends on, `implementation(files(...))` for the AAR, and
  `packaging { jniLibs { useLegacyPackaging = true } }`. Release still drops x86/x86_64 (the `abiFilters` as today).
  Minify is off; if it is ever turned on, `-keep class com.k2fsa.sherpa.onnx.** { *; }` is needed (JNI reads the config
  fields by name).

## Settings copy (all new lines)

Under the wake row, shown only while "Listen for Hey <name>" is on:

| When | Line |
|---|---|
| Switch label | `Only my voice` |
| Under it | `Buddy answers only you. Your voice stays on this device.` |
| Getting the model | `Getting the voice check ready (28 MB)…` (with percent) |
| Model failed | `Couldn't get the voice check ready. Check the internet and try again.` |
| Setup start | `Say "Hey Rahul" 5 times. Wait for the tick each time.` |
| Each good take | `Got it ✓ 2 of 5` |
| A take refused (short/unclear) | `I didn't get that. Say "Hey Rahul" again.` |
| An odd take dropped | `That one sounded different. Say "Hey Rahul" again.` |
| Done | `Done. Buddy now answers only your voice.` |
| Failed (odd takes, too many) | `I couldn't learn your voice. Try again somewhere quiet.` |
| Timed out (90 s) | `I didn't hear you. Try again.` |
| On, normal | `On. Buddy answers only you.` |
| Profile missing/unusable | `Set up Only my voice again.` |
| Test it, wake refused | `That didn't sound like you.` |
| Button | `Set up again` |

(Rahul stands for the buddy's shown name; "Hey Buddy" when the name can't be heard.)

## Not in this feature

- The spoken yes/no after a card is not voice-checked (the owner started that turn). A later step could check it too.
- The follow-up listen after an owner-passed answer (`talkBack.listen`) is not voice-checked either, the same as the spoken yes/no.
- Windows: no wake loop there, so no switch.
- No "who else may use it" (one voice per device).

## Risks the owner must know

1. **The threshold is from synthetic voices plus the published 0.33.** It must be checked on real voices (the owner's
   and one or two other people's) with `tools/check-my-voice.js` and on the phone before the release. If the owner is
   refused too often in normal rooms, 0.45 is the next step; if family members get in, 0.55.
2. **The phrase is short (~0.6-1 s).** Short phrases are the hard case for speaker checks; a close family voice (same
   accent, same age and sex) may sometimes pass. It is a convenience lock, not security.
3. **Setup is on "Hey <name>"; "Hey Buddy" is checked against the same profile.** Different words lower the score a
   little; if "Hey Buddy" is refused more than "Hey <name>", that is why.
4. **Size:** model download 28 MB; Mac app about +10 MB; Android APK about +17 MB (installed about +40 MB, both ABIs
   unpacked by the system).
5. **Memory:** about 100 MB more while it is on (the voice check process on the Mac; the native extractor on Android).
6. The AAR is not on Maven Central: Android builds (and CI) need GitHub reachable once to fetch it.
