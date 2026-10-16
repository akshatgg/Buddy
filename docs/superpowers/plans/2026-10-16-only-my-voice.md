# "Only my voice" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A Settings switch "Only my voice" under "Listen for Hey <name>". Turning it on learns the owner's voice from
5 takes of "Hey <name>" and keeps it on the device. After every wake, the wake phrase's own audio is checked against that
voice before anything goes to the server; anyone else gets silence. Mac and Android.

**Architecture:** One engine on both apps: **sherpa-onnx 1.13.8**'s `SpeakerEmbeddingExtractor` with the
**3D-Speaker CAM++ zh-en common-advanced** model (Apache 2.0, 28 MB, 192-dim), downloaded on first use from Buddy's own
release `speaker-model-1` and kept only when its SHA-256 matches. The rules both apps must agree on (the threshold, the
setup state machine, the phrase clip, the profile file, the copy) live in `shared/my-voice.js`; Android has a Kotlin
port checked against generated cases, as `voice/VoiceWords.kt` is. The wake recognizer's result now also says where the
phrase **starts** (`wakeFrom(...).startSec`), so the phrase audio can be cut out of the audio already kept.
Mac: the ear page sends the phrase clip with `ear:woke` / `ear:request`; main checks it in an Electron
`utilityProcess` running `sherpa-onnx-node` (gate in `wake.js` before `actions.transcribe`). Android: `WakeListener`
checks the clip right after the phrase, before it emits `Woke` or records the request, with the AAR's Kotlin API.

**Tech Stack:** Electron 44 (`utilityProcess`), Node `node:test`, `sherpa-onnx-node@1.13.8` +
`sherpa-onnx-darwin-arm64@1.13.8`; Kotlin Android (JUnit4, kotlinx-coroutines-test, Compose),
`sherpa-onnx-static-link-onnxruntime-1.13.8.aar`.

**Spec:** `docs/superpowers/specs/2026-10-16-only-my-voice-design.md` (engine/model research, the threshold table, the
copy, the risks). Wake design this builds on: `docs/superpowers/plans/2026-10-15-hey-buddy-voice-and-wake.md` Part B.

## Global Constraints

- **Order and parallel work.** Task S1 (shared) is done first, on branch `my-voice` (worktree
  `~/projects/buddy-my-voice`), and committed. Then two implementers work **in parallel**, each in its own worktree made
  from `my-voice` after S1:
  - Mac: branch `my-voice-mac`, worktree `~/projects/buddy-my-voice-mac`, Tasks M1-M8. Touches only `src/`, `build/`,
    `electron-builder.config.js`, `package.json`, `package-lock.json`, `test/` (non-Android files), `tools/check-my-voice.js`.
  - Android: branch `my-voice-android`, worktree `~/projects/buddy-my-voice-android`, Tasks A1-A8. Touches only
    `android/` and `.gitignore`.
  - Neither edits `shared/` or `tools/sync-android-shared.js` after S1. If one needs a shared change, stop and ask; the
    change goes on `my-voice` and both rebase.
  - At the end both are merged into `my-voice` (no conflicts expected: disjoint files) and one PR goes to master.
- **Never touch other worktrees or branches** (multi-session rules). Do not push unless the owner says so.
- **No Claude attribution anywhere.** Commits with `git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit`;
  no `Co-Authored-By`, no "Generated with" line in commits or PRs.
- **Privacy rules (tests must prove them):**
  - With "Only my voice" on, nothing is transcribed or sent unless the phrase clip passed the check. Any failure
    (no clip, short clip, no model, no profile, profile of another model, worker crash, 3 s timeout) is **not the owner**.
  - The profile is written only to `<userData>/my-voice.json` (Mac, mode 0600) / `filesDir/my-voice.json` (Android).
    Never in the settings store, never synced, never logged. Turning the switch off deletes it.
  - Clips and take embeddings are never written to disk or logged. Logs say only `voice check: <code>`.
- **Numbers (from `shared/my-voice.js`, never copied by hand into another JS file; the Kotlin port reads them from the
  generated cases and has its own constants checked against them):** `match 0.50`, `agree 0.45`, `takes 5`,
  `extraTakes 3`, `minPhraseMs 350`, `maxPhraseMs 3000`, `padMs 100`, `setupMs 90000`, `checkMs 3000`.
  The ear page can't load `shared/` (it's a sandboxed page), so `ear-core.js` keeps copies of `padMs`, `maxPhraseMs`
  and the span sum, checked by a test against `shared/my-voice.js` (as `EarCore.wakeFrom` is today).
- **Copy** exactly as in the spec's table (`MY_VOICE_LINES`). The Android port's strings are checked against the cases.
- After changing anything in `shared/`, run `npm run sync:web && npm run sync:web-app && npm run sync:android`.
- JS tests: `npm test`. **Never run two JS suites at once.** One file: `node --test test/<file>`.
- Android tests (from the worktree's `android/`):
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew -q -Djava.net.preferIPv4Stack=true :app:testDebugUnitTest`
  (add `--tests '*Name*'` for one class). Build: same env and flags, `:app:assembleDebug -x checkCloudProperties`.
- **Unit tests never load the real model or the native engine.** They use fakes (`fork` fake on the Mac,
  `Embedder` fake on Android). The real engine is exercised only by `tools/check-my-voice.js` (Mac, Task M1) and the
  instrumented `SherpaEmbedderTest` (emulator, Task A8).
- **No microphone, no `npm start` voice run, no install-and-talk on a phone** unless the owner says so in the session.
  Device steps are the owner's.
- **Publishing the model release is the owner's action** (Task S1 Step 7).
- No Robolectric. Android logic in pure functions and small classes over interfaces, tested with fakes.
- Match the surrounding code: plain-English doc comments, the same naming.

## Values confirmed during planning (2026-10-16)

| Value | Confirmed how |
|---|---|
| Model file 28,281,164 bytes, SHA-256 `aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2`, dim 192 | downloaded from `k2-fsa/sherpa-onnx` release `speaker-recongition-models` (sic), matches its `checksum.txt`; `ex.dim` printed 192 |
| Licence Apache 2.0; published threshold `yesOrno_thr 0.33`; EER Vox1-O 1.16% | ModelScope `iic/speech_campplus_sv_zh_en_16k-common_advanced` README + configuration.json |
| `sherpa-onnx-node@1.13.8` is Node-API (61 `napi_` imports, no V8 symbols); darwin-arm64 libs ad-hoc signed, `@rpath` = `@loader_path` | `nm -u`, `otool -L/-l`, `codesign -dv` |
| Runs in Electron 44.5.1 `utilityProcess`: 192-dim, ~10 ms per 1 s clip; `compute(s, true)` throws "External buffers are not allowed" | spike on this Mac |
| `sherpa-onnx-static-link-onnxruntime-1.13.8.aar` 38,691,998 bytes, SHA-256 `b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471`; Kotlin API names | `gh release download`, `javap` on its `classes.jar` |
| The wasm npm build `sherpa-onnx` has no speaker embedding extractor | grep of its exports |

## Values to confirm (device or owner)

| Value | Where | Task |
|---|---|---|
| The release asset URL of `speaker-model-1` resolves and matches the SHA-256 | `SPEAKER_MODEL.url` | S1 Step 7 (owner) |
| The packaged Mac app loads the addon from `app.asar.unpacked` after signing | `afterPack.js` | M1 Step 6 |
| Owner's own score: 5 takes + 10 tests in a room, a fan on, and 2 other people | `MY_VOICE.match` | M8 / A8 (owner) |
| APK size growth (expected ~17 MB) | `build.gradle.kts` | A1 Step 5 |
| Embedding time on the owner's phone (expected < 80 ms for a 1 s clip) | — | A8 (owner) |

---

# Task S1 — The shared rules (do first, alone)

**Files:**
- Create: `shared/my-voice.js`, `test/my-voice.test.js`, `tools/pack-speaker-model.js`
- Modify: `shared/voice-words.js` (`wakeFrom` returns `startSec`), `test/voice-words.test.js` (lines 164-171: add
  `startSec`), `src/renderer/ear/ear-core.js` (`wakeFrom` copy returns `startSec`), `test/ear-core.test.js`,
  `android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt` (`data class Wake` gets `startSec`, `wakeFrom` sets
  it), `android/app/src/test/java/com/akshatgg/buddy/voice/VoiceWordsTest.kt` (line 111), `tools/sync-android-shared.js`
  (`MY_VOICE_TO`, `buildMyVoiceCases`, `speakerModel` in `shared.json`), `test/android-shared.test.js`
- Regenerated: `android/app/src/main/assets/shared.json`, `android/app/src/test/resources/voice-cases.json`,
  `android/app/src/test/resources/my-voice-cases.json` (new), `web/shared/*`, `web/public/app/shared/*`

The Android edits here are the minimum to keep the Android tests green after `voice-cases.json` changes. The Kotlin
port of `my-voice.js` itself is Task A2.

**Interfaces (all exported from `shared/my-voice.js`):**
- `SPEAKER_MODEL = { name: 'campplus-zh-en-advanced', tag: 'speaker-model-1', file: 'campplus-zh-en-advanced.onnx', url, sha256, bytes: 28281164, dim: 192, upstream, upstreamSha256 }`
- `MY_VOICE = { match: 0.5, agree: 0.45, takes: 5, extraTakes: 3, minPhraseMs: 350, maxPhraseMs: 3000, padMs: 100, setupMs: 90000, checkMs: 3000, rate: 16000 }`
- `unit(v) -> number[] | null` (null for empty, non-finite, or ~zero length)
- `cosine(a, b) -> number` (-1 when either is unusable or lengths differ)
- `meanUnit(list) -> number[] | null`
- `oddTakes(takes, agree = MY_VOICE.agree) -> number[]` (indexes whose score against the unit mean of the others is below `agree`)
- `isMe(profile, embedding, match = MY_VOICE.match) -> boolean`
- `phraseSpan(startSec, endSec, rate = 16000) -> { from, to } | null` (samples from the recognizer's start, padded by
  `padMs`, `from >= 0`, at most `maxPhraseMs` long; null when not finite, `end <= start`, or `end - start < minPhraseMs`)
- `createSetup({ takes, extraTakes, agree } = MY_VOICE) -> { add(embedding | null) -> SetupStep }`,
  `SetupStep = { step: 'more' | 'again' | 'odd' | 'done' | 'failed', count: number, profile?: number[] }`
- `profileJson(profile, at) -> object`, `readProfile(json) -> number[] | null`
- `setupPhrase(name, missing)` (= `wakePhrases(name, missing)[0]`), `MY_VOICE_LINES` (the spec's table)

- [ ] **Step 1: Write the failing tests** `test/my-voice.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  SPEAKER_MODEL, MY_VOICE, MY_VOICE_LINES, unit, cosine, meanUnit, oddTakes, isMe, phraseSpan, createSetup,
  profileJson, readProfile, setupPhrase,
} = require('../shared/my-voice');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
// Two-dimensional voices are enough for the sums: a voice is a direction.
const at = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

test('the model and the numbers are the ones the spec fixed', () => {
  assert.strictEqual(SPEAKER_MODEL.sha256, 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2');
  assert.strictEqual(SPEAKER_MODEL.bytes, 28281164);
  assert.strictEqual(SPEAKER_MODEL.dim, 192);
  assert.match(SPEAKER_MODEL.url, /^https:\/\/github\.com\/akshatgg\/Buddy\/releases\/download\/speaker-model-1\/campplus-zh-en-advanced\.onnx$/);
  assert.deepStrictEqual(
    { match: MY_VOICE.match, agree: MY_VOICE.agree, takes: MY_VOICE.takes, extraTakes: MY_VOICE.extraTakes },
    { match: 0.5, agree: 0.45, takes: 5, extraTakes: 3 },
  );
});

test('unit and cosine', () => {
  assert.deepStrictEqual(unit([3, 4]), [0.6, 0.8]);
  for (const bad of [[], [0, 0], [NaN, 1], [Infinity, 0], null, undefined]) assert.strictEqual(unit(bad), null);
  near(cosine([1, 0], [5, 0]), 1);
  near(cosine(at(0), at(60)), 0.5);
  assert.strictEqual(cosine([1, 0], [1, 0, 0]), -1);
  assert.strictEqual(cosine([0, 0], [1, 0]), -1);
  assert.strictEqual(cosine(Float32Array.from([1, 0]), [1, 0]), 1, 'typed arrays work');
});

test('isMe: at or above 0.50 is the owner', () => {
  assert.strictEqual(isMe(at(0), at(60)), true, 'exactly 0.50 passes');
  assert.strictEqual(isMe(at(0), at(61)), false);
  assert.strictEqual(isMe(null, at(0)), false);
  assert.strictEqual(isMe(at(0), null), false);
  assert.strictEqual(isMe(at(0), [1, 0, 0]), false, 'another size');
});

test('oddTakes: a take far from the others is odd', () => {
  assert.deepStrictEqual(oddTakes([at(0), at(5), at(-5), at(3), at(-2)]), []);
  assert.deepStrictEqual(oddTakes([at(0), at(5), at(-5), at(3), at(90)]), [4]);
  assert.deepStrictEqual(oddTakes([at(0)]), [], 'one take has nothing to agree with');
});

test('phraseSpan: padded, from zero, capped, and refused when too short', () => {
  assert.deepStrictEqual(phraseSpan(1.0, 1.6), { from: 14400, to: 27200 });
  assert.deepStrictEqual(phraseSpan(0.05, 0.6), { from: 0, to: 11200 }, 'never before the recognizer began');
  assert.deepStrictEqual(phraseSpan(0, 5), { from: 0, to: 48000 }, 'at most 3 s');
  assert.strictEqual(phraseSpan(1.0, 1.3), null, 'under 350 ms of phrase');
  assert.strictEqual(phraseSpan(1.0, 1.0), null);
  assert.strictEqual(phraseSpan(NaN, 1), null);
});

test('setup: five good takes make the profile', () => {
  const s = createSetup();
  assert.deepStrictEqual(s.add(at(0)), { step: 'more', count: 1 });
  assert.deepStrictEqual(s.add(null), { step: 'again', count: 1 }, 'a refused take asks again, and does not count');
  for (const [i, d] of [[2, 4], [3, -4], [4, 2]]) assert.deepStrictEqual(s.add(at(d)), { step: 'more', count: i });
  const done = s.add(at(-2));
  assert.strictEqual(done.step, 'done');
  assert.strictEqual(done.count, 5);
  near(cosine(done.profile, at(0)), 1, 1e-3);
  assert.strictEqual(s.add(at(0)).step, 'done', 'over is over');
});

test('setup: an odd take is dropped and asked again; too many odd ones fail', () => {
  const s = createSetup();
  for (const d of [0, 4, -4, 2]) s.add(at(d));
  assert.deepStrictEqual(s.add(at(120)), { step: 'odd', count: 4 });
  assert.strictEqual(s.add(at(1)).step, 'done');

  const f = createSetup();
  for (const d of [0, 4, -4, 2]) f.add(at(d));
  assert.strictEqual(f.add(at(120)).step, 'odd');
  assert.strictEqual(f.add(at(-120)).step, 'odd');
  assert.strictEqual(f.add(at(150)).step, 'odd');
  assert.deepStrictEqual(f.add(at(-150)), { step: 'failed', count: 4 }, 'a fourth odd take is one too many');
});

test('the profile file: only the current model, the right size, finite numbers', () => {
  const p = Array.from({ length: 192 }, (_, i) => (i === 0 ? 1 : 0));
  const json = profileJson(p, '2026-10-16T00:00:00.000Z');
  assert.deepStrictEqual(json, { v: 1, model: SPEAKER_MODEL.sha256, dim: 192, profile: p, at: '2026-10-16T00:00:00.000Z' });
  assert.deepStrictEqual(readProfile(JSON.parse(JSON.stringify(json))), p);
  assert.strictEqual(readProfile({ ...json, model: 'x' }), null);
  assert.strictEqual(readProfile({ ...json, v: 2 }), null);
  assert.strictEqual(readProfile({ ...json, profile: p.slice(1), dim: 191 }), null);
  assert.strictEqual(readProfile({ ...json, profile: [...p.slice(1), 'a'] }), null);
  assert.strictEqual(readProfile(null), null);
  assert.strictEqual(readProfile('nope'), null);
});

test('the setup phrase is the name when the model can hear it, else Hey Buddy', () => {
  assert.strictEqual(setupPhrase('Rahul', []), 'hey rahul');
  assert.strictEqual(setupPhrase('Priya', ['priya']), 'hey buddy');
  assert.strictEqual(setupPhrase('', []), 'hey buddy');
});

test('the copy, word for word', () => {
  assert.strictEqual(MY_VOICE_LINES.label, 'Only my voice');
  assert.strictEqual(MY_VOICE_LINES.about, 'Buddy answers only you. Your voice stays on this device.');
  assert.strictEqual(MY_VOICE_LINES.gettingModel, 'Getting the voice check ready (28 MB)…');
  assert.strictEqual(MY_VOICE_LINES.modelFailed, "Couldn't get the voice check ready. Check the internet and try again.");
  assert.strictEqual(MY_VOICE_LINES.start('Rahul'), 'Say "Hey Rahul" 5 times. Wait for the tick each time.');
  assert.strictEqual(MY_VOICE_LINES.got(2), 'Got it ✓ 2 of 5');
  assert.strictEqual(MY_VOICE_LINES.again('Rahul'), 'I didn\'t get that. Say "Hey Rahul" again.');
  assert.strictEqual(MY_VOICE_LINES.odd('Buddy'), 'That one sounded different. Say "Hey Buddy" again.');
  assert.strictEqual(MY_VOICE_LINES.done, 'Done. Buddy now answers only your voice.');
  assert.strictEqual(MY_VOICE_LINES.failed, "I couldn't learn your voice. Try again somewhere quiet.");
  assert.strictEqual(MY_VOICE_LINES.timedOut, "I didn't hear you. Try again.");
  assert.strictEqual(MY_VOICE_LINES.on, 'On. Buddy answers only you.');
  assert.strictEqual(MY_VOICE_LINES.setUpAgain, 'Set up Only my voice again.');
  assert.strictEqual(MY_VOICE_LINES.notYou, "That didn't sound like you.");
  assert.strictEqual(MY_VOICE_LINES.redo, 'Set up again');
});
```

  In `test/voice-words.test.js` add `startSec` to every non-null `wakeFrom` expectation (lines 164-171), e.g.
  `{ startSec: 1, endSec: 1.6, follows: false, phrase: 'hey rahul' }`, and the line-171 case `startSec: 0`.

  In `test/android-shared.test.js`, after the voice-cases test:

```js
test('my-voice-cases.json is up to date, and covers every setup step', () => {
  assert.equal(fs.readFileSync(MY_VOICE_TO, 'utf8'), `${JSON.stringify(buildMyVoiceCases(), null, 2)}\n`);
  const cases = JSON.parse(fs.readFileSync(MY_VOICE_TO, 'utf8'));
  const steps = new Set(cases.setups.flatMap((s) => s.steps.map((x) => x.step)));
  for (const step of ['more', 'again', 'odd', 'done', 'failed']) assert.ok(steps.has(step), step);
  assert.ok(cases.isMe.length >= 4 && cases.spans.length >= 5 && cases.profiles.length >= 4);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/my-voice.test.js test/voice-words.test.js test/android-shared.test.js`
Expected: FAIL (`Cannot find module '../shared/my-voice'`; `startSec` missing).

- [ ] **Step 3: Implement** `shared/my-voice.js`:

```js
'use strict';

/**
 * "Only my voice" (docs/superpowers/specs/2026-10-16-only-my-voice-design.md): the voice-check model, the numbers both
 * apps decide with, the setup's steps, the phrase clip, the profile file and the copy. The voice itself never leaves
 * the device. The Android app has a port (voice/MyVoiceRules.kt), checked against the cases
 * tools/sync-android-shared.js writes out.
 */
const { wakePhrases } = require('./voice-words');
const { VOICE_MODEL } = require('./voice-model');

const BASE = 'https://github.com/akshatgg/Buddy/releases/download/speaker-model-1';
const SPEAKER_MODEL = {
  name: 'campplus-zh-en-advanced',
  tag: 'speaker-model-1',
  file: 'campplus-zh-en-advanced.onnx',
  url: `${BASE}/campplus-zh-en-advanced.onnx`,
  sha256: 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2',
  bytes: 28281164,
  dim: 192,
  // 3D-Speaker CAM++ zh-en common-advanced (Apache 2.0), as sherpa-onnx exports it. tools/pack-speaker-model.js takes it from here.
  upstream: 'https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_campplus_sv_zh_en_16k-common_advanced.onnx',
};

const MY_VOICE = {
  match: 0.5, // "Balanced": the wake phrase is the owner's when its score against the profile is at least this
  agree: 0.45, // a setup take scoring below this against the other takes is odd, and asked again
  takes: 5,
  extraTakes: 3, // odd takes allowed in one setup, in all
  minPhraseMs: 350, // a shorter phrase can't be checked: refused
  maxPhraseMs: 3000,
  padMs: 100, // a little before the first word and after the last one
  setupMs: 90000,
  checkMs: 3000, // a check that takes longer is a no
  rate: 16000,
};

function unit(v) {
  if (!v || !v.length) return null;
  let sum = 0;
  for (const x of v) {
    if (!Number.isFinite(x)) return null;
    sum += x * x;
  }
  const n = Math.sqrt(sum);
  return n > 1e-6 ? Array.from(v, (x) => x / n) : null;
}

function cosine(a, b) {
  const ua = unit(a);
  const ub = unit(b);
  if (!ua || !ub || ua.length !== ub.length) return -1;
  let dot = 0;
  for (let i = 0; i < ua.length; i++) dot += ua[i] * ub[i];
  return dot;
}

function meanUnit(list) {
  const us = (list || []).map(unit);
  if (!us.length || us.some((u) => !u || u.length !== us[0].length)) return null;
  return unit(us[0].map((_, k) => us.reduce((t, u) => t + u[k], 0) / us.length));
}

function oddTakes(takes, agree = MY_VOICE.agree) {
  if (takes.length < 2) return [];
  return takes.flatMap((take, i) => (cosine(take, meanUnit(takes.filter((_, j) => j !== i))) < agree ? [i] : []));
}

function isMe(profile, embedding, match = MY_VOICE.match) {
  return cosine(profile, embedding) >= match;
}

/** Where the phrase is in the audio since the recognizer began, in samples, padded; null when it is too short to check. */
function phraseSpan(startSec, endSec, rate = MY_VOICE.rate) {
  if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || endSec <= startSec) return null;
  if ((endSec - startSec) * 1000 < MY_VOICE.minPhraseMs) return null;
  const pad = MY_VOICE.padMs / 1000;
  const from = Math.max(0, Math.round((startSec - pad) * rate));
  const to = Math.min(Math.round((endSec + pad) * rate), from + Math.round((MY_VOICE.maxPhraseMs / 1000) * rate));
  return { from, to };
}

/**
 * The setup's steps. `add(embedding)` for each take the wake loop heard (null for one that was too short or could not be
 * checked): 'again' (refused, ask again; it does not count), 'more' (kept), 'odd' (after the fifth: some takes did not
 * agree with the rest; they are dropped and asked again), 'done' (with the profile) or 'failed'. Once done or failed,
 * it stays so.
 */
function createSetup({ takes = MY_VOICE.takes, extraTakes = MY_VOICE.extraTakes, agree = MY_VOICE.agree } = {}) {
  let good = [];
  let extra = 0;
  let over = null;
  return {
    add(embedding) {
      if (over) return over;
      const u = unit(embedding);
      if (!u) return { step: 'again', count: good.length };
      good.push(u);
      if (good.length < takes) return { step: 'more', count: good.length };
      const odd = oddTakes(good, agree);
      if (!odd.length) {
        over = { step: 'done', count: takes, profile: meanUnit(good) };
        return over;
      }
      extra += odd.length;
      good = good.filter((_, i) => !odd.includes(i));
      if (extra > extraTakes) {
        over = { step: 'failed', count: good.length };
        return over;
      }
      return { step: 'odd', count: good.length };
    },
  };
}

function profileJson(profile, at = new Date().toISOString()) {
  return { v: 1, model: SPEAKER_MODEL.sha256, dim: profile.length, profile: Array.from(profile), at };
}

/** The saved profile, or null when it is not one this app can use (another model, another size, bad numbers). */
function readProfile(json) {
  if (!json || typeof json !== 'object' || json.v !== 1 || json.model !== SPEAKER_MODEL.sha256) return null;
  if (json.dim !== SPEAKER_MODEL.dim || !Array.isArray(json.profile) || json.profile.length !== SPEAKER_MODEL.dim) return null;
  if (!json.profile.every((x) => typeof x === 'number' && Number.isFinite(x))) return null;
  return unit(json.profile) ? json.profile : null;
}

/** What setup asks for: "hey <name>" when the model can hear the name, else "hey buddy". */
function setupPhrase(name, missing = VOICE_MODEL.missing) {
  return wakePhrases(name, missing)[0];
}

const MY_VOICE_LINES = {
  label: 'Only my voice',
  about: 'Buddy answers only you. Your voice stays on this device.',
  gettingModel: 'Getting the voice check ready (28 MB)…',
  modelFailed: "Couldn't get the voice check ready. Check the internet and try again.",
  start: (name) => `Say "Hey ${name}" ${MY_VOICE.takes} times. Wait for the tick each time.`,
  got: (count) => `Got it ✓ ${count} of ${MY_VOICE.takes}`,
  again: (name) => `I didn't get that. Say "Hey ${name}" again.`,
  odd: (name) => `That one sounded different. Say "Hey ${name}" again.`,
  done: 'Done. Buddy now answers only your voice.',
  failed: "I couldn't learn your voice. Try again somewhere quiet.",
  timedOut: "I didn't hear you. Try again.",
  on: 'On. Buddy answers only you.',
  setUpAgain: 'Set up Only my voice again.',
  notYou: "That didn't sound like you.",
  redo: 'Set up again',
};

module.exports = {
  SPEAKER_MODEL, MY_VOICE, MY_VOICE_LINES, unit, cosine, meanUnit, oddTakes, isMe, phraseSpan, createSetup,
  profileJson, readProfile, setupPhrase,
};
```

  Check the `phraseSpan(1.0, 1.6)` expectation by hand: from = round(0.9 × 16000) = 14400, to = round(1.7 × 16000) =
  27200. `(0, 5)`: from 0, to = min(83200, 48000) = 48000.

  Check that `shared/voice-words.js` does not `require('./my-voice')` (no cycle: my-voice requires voice-words only).

- [ ] **Step 4: `wakeFrom` returns `startSec`** in all three copies.
  - `shared/voice-words.js` `wakeFrom`: `return { startSec: got[0].start, endSec: got[want.length - 1].end, follows: …, phrase: … };`
    and add "`startSec` is when the first phrase word began" to its doc comment.
  - `src/renderer/ear/ear-core.js` `wakeFrom` (its copy): the same field. `createWakeTurn.result` also returns
    `phraseStartSec: w.startSec, phraseEndSec: w.endSec` (the ear page's Task M4 uses them).
  - `VoiceWords.kt`: `data class Wake(val endSec: Float, val follows: Boolean, val phrase: String, val startSec: Float = 0f)`
    and `wakeFrom` sets `startSec = got[0].start`. `VoiceWordsTest.kt:111`:
    `assertEquals(Wake(want.str("endSec").toFloat(), want.str("follows").toBoolean(), want.str("phrase"), want.str("startSec").toFloat()), got)`.
  - `test/ear-core.test.js` line ~107: also `assert.strictEqual(got.phraseStartSec, c.wake.startSec)`.

- [ ] **Step 5: The Android cases** in `tools/sync-android-shared.js`:

```js
const MY_VOICE_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'my-voice-cases.json');
const myVoice = require('../shared/my-voice');
const deg = (d) => [Math.cos((d * Math.PI) / 180), Math.sin((d * Math.PI) / 180)];
const SETUPS = [[0, null, 4, -4, 2, -2], [0, 4, -4, 2, 120, 1], [0, 4, -4, 2, 120, -120, 150, -150, 3]];

function buildMyVoiceCases() {
  const one = Array.from({ length: myVoice.SPEAKER_MODEL.dim }, (_, i) => (i === 0 ? 1 : 0));
  const base = myVoice.profileJson(one, '2026-10-16T00:00:00.000Z');
  return {
    note: 'Made by tools/sync-android-shared.js from shared/my-voice.js. Do not edit: run npm run sync:android.',
    model: myVoice.SPEAKER_MODEL,
    numbers: myVoice.MY_VOICE,
    isMe: [[0, 60], [0, 61], [0, 0], [0, 180]].map(([a, b]) => ({ profile: deg(a), embedding: deg(b), cosine: myVoice.cosine(deg(a), deg(b)), me: myVoice.isMe(deg(a), deg(b)) })),
    spans: [[1, 1.6], [0.05, 0.6], [0, 5], [1, 1.3], [1, 1]].map(([s, e]) => ({ startSec: s, endSec: e, span: myVoice.phraseSpan(s, e) })),
    setups: SETUPS.map((takes) => {
      const s = myVoice.createSetup();
      return { takes: takes.map((d) => (d === null ? null : deg(d))), steps: takes.map((d) => s.add(d === null ? null : deg(d))) };
    }),
    profiles: [base, { ...base, model: 'x' }, { ...base, v: 2 }, { ...base, dim: 191, profile: one.slice(1) }, null]
      .map((json) => ({ json, ok: myVoice.readProfile(json) !== null })),
    phrases: [['Rahul', []], ['Priya', ['priya']], ['', []]].map(([name, missing]) => ({ name, missing, phrase: myVoice.setupPhrase(name, missing) })),
    lines: {
      label: myVoice.MY_VOICE_LINES.label, about: myVoice.MY_VOICE_LINES.about, gettingModel: myVoice.MY_VOICE_LINES.gettingModel,
      modelFailed: myVoice.MY_VOICE_LINES.modelFailed, start: myVoice.MY_VOICE_LINES.start('Rahul'), got: myVoice.MY_VOICE_LINES.got(2),
      again: myVoice.MY_VOICE_LINES.again('Rahul'), odd: myVoice.MY_VOICE_LINES.odd('Rahul'), done: myVoice.MY_VOICE_LINES.done,
      failed: myVoice.MY_VOICE_LINES.failed, timedOut: myVoice.MY_VOICE_LINES.timedOut, on: myVoice.MY_VOICE_LINES.on,
      setUpAgain: myVoice.MY_VOICE_LINES.setUpAgain, notYou: myVoice.MY_VOICE_LINES.notYou, redo: myVoice.MY_VOICE_LINES.redo,
    },
  };
}
```

  Write it in the writer loop next to `VOICE_TO`, export `MY_VOICE_TO` and `buildMyVoiceCases`, and put
  `speakerModel: myVoice.SPEAKER_MODEL` into the object written to `shared.json` (next to `voiceModel`, line ~260).
  (The third setup reaches its 4th odd take and fails; the trailing `3` shows a finished setup stays failed.)

- [ ] **Step 6: Run sync and all tests**

Run: `npm run sync:web && npm run sync:web-app && npm run sync:android && npm test`
Expected: PASS. Then the Android suite (Global Constraints command): PASS (the `startSec` change and the new resource;
nothing reads `my-voice-cases.json` yet).

- [ ] **Step 7: The model release tool** `tools/pack-speaker-model.js`, then stop for the owner.

```js
#!/usr/bin/env node
'use strict';

/**
 * Makes Buddy's voice-check release file: the upstream CAM++ model (shared/my-voice.js SPEAKER_MODEL.upstream, or
 * --from <file>), checked against the SHA-256 Buddy expects, copied to release/speaker-model/<file>. Prints the command
 * that publishes it. It does not publish anything: the owner does that.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SPEAKER_MODEL } = require('../shared/my-voice');

const OUT = path.join(__dirname, '..', 'release', 'speaker-model');

async function main() {
  const from = process.argv.indexOf('--from') > -1 ? process.argv[process.argv.indexOf('--from') + 1] : null;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, SPEAKER_MODEL.file);
  if (from) fs.copyFileSync(from, file);
  else {
    const res = await fetch(SPEAKER_MODEL.upstream, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const bytes = fs.statSync(file).size;
  if (sha !== SPEAKER_MODEL.sha256 || bytes !== SPEAKER_MODEL.bytes) {
    fs.rmSync(file, { force: true });
    throw new Error(`not the expected model: ${sha} ${bytes}`);
  }
  console.log(`${SPEAKER_MODEL.file}  ${sha}  ${bytes}`);
  console.log(`publish (owner): gh release create ${SPEAKER_MODEL.tag} "${file}" --repo akshatgg/Buddy --title "Voice check model 1" `
    + '--notes "3D-Speaker CAM++ zh-en common-advanced (Apache 2.0), from sherpa-onnx. Used by Only my voice." --latest=false');
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
```

  Run `node tools/pack-speaker-model.js`; expected the line `campplus-zh-en-advanced.onnx  aa3cfc…ba2  28281164`.
  `release/` is already git-ignored. **Stop and give the owner the printed `gh release create` command.** After he runs
  it: `curl -sIL "$(node -p "require('./shared/my-voice').SPEAKER_MODEL.url")" | grep -i '^content-length'` shows 28281164.

- [ ] **Step 8: Commit**

```bash
git add shared/my-voice.js shared/voice-words.js test/my-voice.test.js test/voice-words.test.js test/ear-core.test.js \
  test/android-shared.test.js tools/sync-android-shared.js tools/pack-speaker-model.js src/renderer/ear/ear-core.js \
  android/app/src/main/assets/shared.json android/app/src/test/resources/voice-cases.json \
  android/app/src/test/resources/my-voice-cases.json android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt \
  android/app/src/test/java/com/akshatgg/buddy/voice/VoiceWordsTest.kt web/shared web/public/app/shared
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Only my voice: shared rules, model spec, phrase start"
```

Then make the two worktrees:
`git worktree add ~/projects/buddy-my-voice-mac -b my-voice-mac my-voice` and
`git worktree add ~/projects/buddy-my-voice-android -b my-voice-android my-voice` (then `npm ci` in each).

---

# Mac (Tasks M1-M8, worktree `~/projects/buddy-my-voice-mac`) — in parallel with Android

### Task M1: The engine in the app, signed, and a desktop check

**Files:**
- Modify: `package.json` (+ lock): `"sherpa-onnx-node": "1.13.8"` in `dependencies`, and
  `"overrides": { "sherpa-onnx-darwin-arm64": "1.13.8" }`; `electron-builder.config.js`; `build/afterPack.js`;
  `test/after-pack.test.js`
- Create: `src/main/voice-check-worker.js` (the utility process; also exports `makeEmbedder`), `tools/check-my-voice.js`

**Interfaces:**
- `makeEmbedder(modelPath, sherpa = require('sherpa-onnx-node')) -> { dim, embed(int16: Int16Array) -> number[] | null }`
  (16 kHz; `Int16 / 32768` to float; `createStream`, `acceptWaveform({ sampleRate: 16000, samples })`,
  `inputFinished`, null unless `isReady`, `compute(stream, false)`; the stream is freed).
- The worker: started as `utilityProcess.fork(workerPath, [modelPath])`. Messages in: `{ id, pcm: ArrayBuffer }`.
  Out: `{ id, embedding: number[] }` or `{ id, error: 'load' | 'embed' }`. Loads the model on the first message.

- [ ] **Step 1: Failing tests** in `test/after-pack.test.js` (it already tests `missingFromAsar`/helpers; follow its
  style): the Mac check finds the three unpacked files.

```js
test('the Mac package must hold the voice check engine outside the asar', () => {
  const { UNPACKED_NATIVE, missingUnpacked } = require('../build/afterPack');
  assert.deepStrictEqual(UNPACKED_NATIVE, [
    'node_modules/sherpa-onnx-darwin-arm64/sherpa-onnx.node',
    'node_modules/sherpa-onnx-darwin-arm64/libsherpa-onnx-c-api.dylib',
    'node_modules/sherpa-onnx-darwin-arm64/libonnxruntime.dylib',
  ]);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpacked-'));
  assert.deepStrictEqual(missingUnpacked(dir), UNPACKED_NATIVE);
  for (const f of UNPACKED_NATIVE) { fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true }); fs.writeFileSync(path.join(dir, f), 'x'); }
  assert.deepStrictEqual(missingUnpacked(dir), []);
});

test('the build config unpacks the engine on the Mac and leaves it out on Windows', () => {
  const config = require('../electron-builder.config');
  assert.ok(config.asarUnpack.includes('node_modules/sherpa-onnx-darwin-arm64/**'));
  assert.ok(config.asarUnpack.includes('node_modules/sherpa-onnx-node/**'));
  assert.ok(config.win.files.includes('!node_modules/sherpa-onnx-*/**'));
});
```

  And a unit test of `makeEmbedder` with a fake `sherpa` in `test/voice-check-worker.test.js`:

```js
const { makeEmbedder } = require('../src/main/voice-check-worker');
test('makeEmbedder: floats from PCM16, external buffers off, null when not ready', () => {
  const seen = {};
  const fake = {
    SpeakerEmbeddingExtractor: class {
      constructor(cfg) { seen.cfg = cfg; this.dim = 3; }
      createStream() { return { acceptWaveform: (w) => { seen.wave = w; }, inputFinished: () => { seen.done = true; } }; }
      isReady() { return seen.ready; }
      compute(_s, external) { seen.external = external; return Float32Array.from([1, 2, 3]); }
    },
  };
  const e = makeEmbedder('/m.onnx', fake);
  assert.deepStrictEqual(seen.cfg, { model: '/m.onnx', numThreads: 1, debug: false, provider: 'cpu' });
  seen.ready = false;
  assert.strictEqual(e.embed(Int16Array.from([16384])), null);
  seen.ready = true;
  assert.deepStrictEqual(e.embed(Int16Array.from([16384, -32768])), [1, 2, 3]);
  assert.deepStrictEqual(Array.from(seen.wave.samples), [0.5, -1]);
  assert.strictEqual(seen.wave.sampleRate, 16000);
  assert.strictEqual(seen.external, false);
});
```

- [ ] **Step 2: Run, see them fail** (`node --test test/after-pack.test.js test/voice-check-worker.test.js`).

- [ ] **Step 3: Implement.**
  - `npm install --save-exact sherpa-onnx-node@1.13.8`; add the `overrides` entry; `npm install`. Check
    `node_modules/sherpa-onnx-darwin-arm64/package.json` says 1.13.8.
  - `electron-builder.config.js`: top level `asarUnpack: ['node_modules/sherpa-onnx-node/**', 'node_modules/sherpa-onnx-darwin-arm64/**']`;
    `win.files: ['!node_modules/sherpa-onnx-*/**', '!node_modules/sherpa-onnx-node/**']` (Windows has no wake loop);
    fix the comment "Buddy has no native Node modules" → "one prebuilt Node-API module (sherpa-onnx-node), nothing to rebuild".
  - `build/afterPack.js`: export `UNPACKED_NATIVE` and `missingUnpacked(unpackedDir)`. In the Mac branch, after
    `requirePackedFiles`, fail when `missingUnpacked(path.join(appPath, 'Contents/Resources/app.asar.unpacked'))` is not
    empty. When signing with Buddy's own certificate, sign each of the three files (`codesign --force …from --sign identity <file>`)
    **before** the bundle (next to the helper); ad-hoc builds keep their ad-hoc signature (as the helper does). After
    the bundle verify, `codesign --verify --strict <file>` for each. Add to the doc comment: if the hardened runtime is
    ever turned on, `com.apple.security.cs.disable-library-validation` is needed in `build/entitlements.mac.plist`.
  - `src/main/voice-check-worker.js`:

```js
'use strict';

/**
 * The voice check's own process (an Electron utilityProcess): sherpa-onnx's speaker embedding extractor over the
 * CAM++ model whose path is argv's last item. It answers { id, embedding } for each { id, pcm } (16 kHz PCM16), or
 * { id, error }. A native crash here ends only this process. Nothing is written or logged.
 */
function makeEmbedder(modelPath, sherpa = require('sherpa-onnx-node')) {
  const ex = new sherpa.SpeakerEmbeddingExtractor({ model: modelPath, numThreads: 1, debug: false, provider: 'cpu' });
  return {
    dim: ex.dim,
    embed(int16) {
      const samples = Float32Array.from(int16, (v) => v / 32768);
      const stream = ex.createStream();
      stream.acceptWaveform({ sampleRate: 16000, samples });
      stream.inputFinished();
      if (!ex.isReady(stream)) return null;
      return Array.from(ex.compute(stream, false)); // Electron refuses external buffers
    },
  };
}

if (process.parentPort) {
  const modelPath = process.argv[process.argv.length - 1];
  let embedder = null;
  process.parentPort.on('message', (event) => {
    const { id, pcm } = event.data || {};
    try {
      embedder = embedder || makeEmbedder(modelPath);
    } catch {
      process.parentPort.postMessage({ id, error: 'load' });
      return;
    }
    try {
      process.parentPort.postMessage({ id, embedding: embedder.embed(new Int16Array(pcm)) });
    } catch {
      process.parentPort.postMessage({ id, error: 'embed' });
    }
  });
}

module.exports = { makeEmbedder };
```

  - `tools/check-my-voice.js` (the desktop check; real engine, real model; never run by `npm test`):
    `node tools/check-my-voice.js [--model <onnx>] (--say | --enroll a.wav b.wav c.wav d.wav e.wav --test x.wav …)`.
    It reads 16 kHz mono 16-bit WAVs (skip the 44-byte header after checking `RIFF`/`WAVE`, 16000, 1 channel),
    computes embeddings with `makeEmbedder`, runs `createSetup` over the enroll takes (prints each step), and prints each
    test's `cosine` and `isMe` against `MY_VOICE.match`. `--say` makes its own takes with macOS `say` (voices Aman, Rishi,
    Samantha, Karen, Daniel, Fred; rates 150-210; `--data-format=LEI16@16000`) into a temp dir and prints, per voice,
    the owner score and the highest other-voice score, then `FAIL` (exit 1) if any voice's own score is below
    `MY_VOICE.match` or more than 15% of other-voice scores reach it. The default `--model` is
    `release/speaker-model/campplus-zh-en-advanced.onnx` (made by S1 Step 7).

- [ ] **Step 4: Run** `node --test test/after-pack.test.js test/voice-check-worker.test.js`, then `npm test`. PASS.

- [ ] **Step 5: Desktop check (no microphone):** `node tools/check-my-voice.js --say`. Expected: every voice's own
  score ≥ 0.50, and a printed other-voice rate around 6% (the spike's 11/180). Then the Electron check:
  `npx electron tools/check-my-voice.js --say --utility` (Electron runs the script as an app's main process; the
  planning spike did exactly this). With `--utility` (only when `process.versions.electron` is set) the script waits for
  `app.whenReady()`, forks `src/main/voice-check-worker.js` with `utilityProcess.fork(worker, [model])`, gets each
  embedding through it, prints the same table and quits. Expected: the same scores (±0.001) as under Node.

- [ ] **Step 6: Packaged check.** `npm run dist:mac` (ad-hoc; the owner's cert step is the same code). Then
  `codesign --verify --strict release/mac-arm64/Buddy.app/Contents/Resources/app.asar.unpacked/node_modules/sherpa-onnx-darwin-arm64/*.dylib`
  and `ELECTRON_RUN_AS_NODE=1 release/mac-arm64/Buddy.app/Contents/MacOS/Buddy -e "require('$PWD/release/mac-arm64/Buddy.app/Contents/Resources/app.asar.unpacked/node_modules/sherpa-onnx-node'); console.log('ok')"`
  prints `ok` (if `ELECTRON_RUN_AS_NODE` is fused off in this build, skip it; M8's owner check covers it). Note the DMG
  size growth in the commit message.

- [ ] **Step 7: Commit** `Only my voice (Mac): ship sherpa-onnx, sign it, desktop check`.

### Task M2: Getting the model

**Files:** Create `src/main/speaker-model.js`, `test/speaker-model.test.js`.

**Interface:** `createSpeakerModel({ dir, spec = SPEAKER_MODEL, fetchImpl = fetch }) -> { ready(), path(), state(), percent(), ensure({ onProgress }) -> Promise }`
— the same shape and rules as `src/main/voice-model.js` (stream to `<file>.part`, hash while streaming, rename only on a
match, one download at a time, error `code: 'model_failed'`), but one plain file: `path()` is `<dir>/<spec.file>`.
`ready()` is "the file is there and its size is `spec.bytes`" (the hash is checked once, at download).

- [ ] **Step 1: Failing tests** — copy the structure of `test/voice-model.test.js` (a fake `fetchImpl` whose body is an
  async iterable of chunks, a temp dir): (1) a body whose SHA-256 is the spec's is kept at `path()` and `ready()` is
  true, progress ends at 100; (2) a wrong body leaves no file and no `.part`, rejects with `model_failed`; (3) HTTP 404
  rejects with `model_failed`; (4) two `ensure()` calls at once download once; (5) a file of the wrong size is not
  `ready()`. Use a small fake spec `{ file: 'm.onnx', url: 'https://x/m.onnx', sha256: <sha of 'abc'>, bytes: 3 }`.
- [ ] **Step 2: Run, fail. Step 3: Implement** (copy `voice-model.js`'s `download()`; keep the doc comment style).
- [ ] **Step 4: Run** `node --test test/speaker-model.test.js` and `npm test`. PASS. **Step 5: Commit.**

### Task M3: The voice check process, from main

**Files:** Create `src/main/voice-check.js`, `test/voice-check.test.js`.

**Interface:**
`createVoiceCheck({ fork, modelPath, timeoutMs = MY_VOICE.checkMs, idleMs = 600000 }) -> { embed(int16: Int16Array) -> Promise<number[] | null>, warm(), close() }`
- `fork(workerPath, args)` returns `{ postMessage(msg, transfer?), on('message', fn), on('exit', fn), kill() }`
  (main passes `(p, a) => utilityProcess.fork(p, a, { serviceName: 'Buddy voice check' })`).
- Started on the first `embed` or `warm()`; one process; killed after `idleMs` with no call; started again after an
  exit. `embed` resolves `null` on a timeout, an `error` answer, an exit while waiting, or `modelPath()` missing; it
  never rejects. Each call has its own id; a late answer for a timed-out id is ignored.

- [ ] **Step 1: Failing tests** with a fake `fork` (an `EventEmitter` child that records messages, answers when the test says):

```js
test('embed sends the PCM and answers the embedding', async () => {
  const kids = [];
  const fork = (p, args) => { const k = Object.assign(new EventEmitter(), { sent: [], postMessage: (m) => k.sent.push(m), kill: () => k.emit('exit') , args }); kids.push(k); return k; };
  const check = createVoiceCheck({ fork, modelPath: () => '/m.onnx' });
  const got = check.embed(Int16Array.from([1, 2]));
  assert.strictEqual(kids.length, 1);
  assert.deepStrictEqual(kids[0].args, ['/m.onnx']);
  const { id, pcm } = kids[0].sent[0];
  assert.deepStrictEqual(Array.from(new Int16Array(pcm)), [1, 2]);
  kids[0].emit('message', { id, embedding: [0.1, 0.2] });
  assert.deepStrictEqual(await got, [0.1, 0.2]);
});
```

  Plus: an `error` answer → `null`; no answer within `timeoutMs` (mock timers) → `null`, and a late answer changes
  nothing; the child exits while waiting → `null`, and the next `embed` forks a new child; `idleMs` after the last
  answer the child is killed; `modelPath()` returning null → `null` without forking; `close()` kills it.

- [ ] **Step 2-4:** fail, implement, `node --test test/voice-check.test.js` + `npm test` pass. **Step 5: Commit.**

### Task M4: The ear page sends the phrase clip

**Files:** Modify `src/renderer/ear/ear-core.js`, `src/renderer/ear/ear.js`, `src/preload/ear.js`,
`src/main/ear-window.js`; tests `test/ear-core.test.js`, `test/ear-window.test.js`.

**Interfaces:**
- `EarCore.phraseSpan(startSec, endSec)` — a copy of `shared/my-voice.js phraseSpan` (the page can't load shared/);
  `EarCore.MY_VOICE_COPY = { padMs, minPhraseMs, maxPhraseMs }`.
- `EarCore.createWakeTurn(...).result(json, keptFrom)` also returns `phrase: { from, to } | null` in **keeper samples**
  (`keptFrom + span.from`, `keptFrom + span.to`).
- `EarCore.pcmBase64(int16)` — little-endian PCM16 as base64 (no WAV header).
- Page → main: `window.ear.woke({ phrase })` and `window.ear.request(audio, phrase)`; `phrase` is base64 PCM16 or null.
- `ear-window.js`: `'woke'` listeners get `{ phrase }`, `'request'` listeners get `{ audio, phrase }`. A `phrase` that
  is not a string, or longer than `ceil(3000 ms × 16 × 2 / 3) × 4` base64 chars (128,000), is `null`.

- [ ] **Step 1: Failing tests.**
  - `test/ear-core.test.js`: `EarCore.MY_VOICE_COPY` equals the three numbers of `shared/my-voice.js MY_VOICE`;
    `EarCore.phraseSpan` equals `phraseSpan` for the cases `[[1,1.6],[0.05,0.6],[0,5],[1,1.3],[1,1],[NaN,1]]`;
    `createWakeTurn({ phrases: ['hey rahul','hey buddy'], floor: 0.6 }).result(said(hey 1.0-1.2, rahul 1.2-1.6), 32000)`
    has `phrase: { from: 46400, to: 59200 }`; a phrase under 350 ms gives `phrase: null` (the wake itself still counts);
    `pcmBase64(Int16Array.from([1, -2]))` is `Buffer.from([1,0,254,255]).toString('base64')`.
  - `test/ear-window.test.js` (it fakes `ipcMain` and the window): an `ear:woke` from the page with `{ phrase: 'AAAA' }`
    reaches `on('woke')` as `{ phrase: 'AAAA' }`; with `{}` as `{ phrase: null }`; a 200,000-char phrase as `null`;
    `ear:request` `{ audio: 'x', phrase: 'AAAA' }` reaches `on('request')` as both; one from another sender reaches nothing.
- [ ] **Step 2: Run, fail.**
- [ ] **Step 3: Implement.**
  - `ear-core.js`: add the copy and `pcmBase64` (use `btoa` over a binary string, as `wav.js` does; under Node tests
    `btoa` exists in Node 20+). In `createWakeTurn.result`, compute `const span = phraseSpan(w.startSec, w.endSec)`.
  - `ear.js` `startWake`: on a wake, `const phrase = woke.phrase ? EarCore.pcmBase64(keeper.from(woke.phrase.from).subarray(0, woke.phrase.to - woke.phrase.from)) : null;`
    then `window.ear.woke({ phrase })`. Keep `phrase` on `request` (`request.phrase`) and send it with
    `window.ear.request(audio, request.phrase)` in both places (`mic.onChunk` end and `stopWake({ finishRequest })`).
    `PcmKeeper` keeps `WAKE_KEEP_S` seconds, more than the 3 s cap, so the phrase is always still there at the wake.
  - `src/preload/ear.js`: `woke: (msg) => ipcRenderer.send('ear:woke', { phrase: typeof msg?.phrase === 'string' ? msg.phrase : null })`,
    `request: (audio, phrase) => ipcRenderer.send('ear:request', { audio, phrase })`.
  - `ear-window.js`: the `ear:woke` / `ear:request` handlers pass the checked `phrase`.
- [ ] **Step 4: Run** the two files and `npm test`. PASS. **Step 5: Commit.**

### Task M5: The owner's voice: profile, check, setup

**Files:** Create `src/main/my-voice.js`, `test/my-voice-main.test.js`.

**Interface:** `createMyVoice({ store, file, fsImpl = fs, model, check, wake, setupMs = MY_VOICE.setupMs, onChange = null })`
where `model` is `createSpeakerModel(...)`, `check` is `createVoiceCheck(...)`, `wake` has `clips(phrase, onClip) -> stop()`
(Task M6). Returns:
- `on() -> boolean` — `store.get('myVoiceOn') === true`.
- `allows(phraseB64) -> Promise<boolean>` — true when off. When on: false unless the profile reads
  (`readProfile(JSON.parse(file))`, cached until changed), the clip decodes to at least `minPhraseMs × 16` samples and at
  most `maxPhraseMs × 16`, and `isMe(profile, await check.embed(pcm))`. Never rejects. Logs only `voice check: <code>`
  (`no_profile`, `short`, `no_embedding`).
- `setup({ name, phrase, onLine }) -> Promise<{ ok: boolean, line: string }>` — one at a time (a second call answers
  the running one). Steps: `model.ensure` (lines `gettingModel` + percent, or `modelFailed`); `check.warm()`; line
  `start(name)`; `wake.clips(phrase, onClip)`; for each clip: decode, `phraseOk` length, `check.embed`, `setup.add`;
  `onLine` with `got(count)` / `again(name)` / `odd(name)`; on `done`: write the file (`profileJson`, mode 0o600, via
  `<file>.tmp` + rename), `store.set({ myVoiceOn: true })`, line `done`; on `failed`: line `failed`; on `setupMs`: line
  `timedOut`. Always `stop()` the clips. Nothing is written unless done.
- `cancel()` — ends a running setup with nothing saved (no line).
- `off()` — `cancel()`, `store.set({ myVoiceOn: false })`, delete the file, `check.close()`.
- `state() -> { on, line, tone, setting: boolean, percent? }` — `on` with a usable profile: `line: MY_VOICE_LINES.on`;
  `on` but the profile is unusable or the model file is gone: `line: setUpAgain, tone: 'error'`.

- [ ] **Step 1: Failing tests** (fake `store`, an in-memory `fsImpl` with `readFileSync/writeFileSync/renameSync/rmSync/existsSync/chmodSync`,
  fake `model` `{ ready, ensure, path }`, fake `check` whose `embed` returns a vector chosen per clip, fake `wake.clips`
  that saves `onClip` and returns a `stop` spy):

```js
const B64 = (n) => Buffer.alloc(n * 2).toString('base64'); // n samples of silence; the fake check decides the voice
const ME = Array.from({ length: 192 }, (_, i) => (i === 0 ? 1 : 0));
const OTHER = Array.from({ length: 192 }, (_, i) => (i === 1 ? 1 : 0));

test('off: everything is allowed, nothing is checked', async () => {
  const { voice, calls } = setup({ on: false });
  assert.strictEqual(await voice.allows(null), true);
  assert.strictEqual(calls.embed, 0);
});

test('on: only the owner passes; a short clip, a missing profile, or no embedding is a no', async () => {
  const { voice, files, embedNext } = setup({ on: true, profile: ME });
  embedNext(ME); assert.strictEqual(await voice.allows(B64(16000)), true);
  embedNext(OTHER); assert.strictEqual(await voice.allows(B64(16000)), false);
  assert.strictEqual(await voice.allows(B64(1000)), false, 'under 350 ms');
  assert.strictEqual(await voice.allows(null), false);
  embedNext(null); assert.strictEqual(await voice.allows(B64(16000)), false);
  files.delete('/u/my-voice.json'); voice.changed();
  embedNext(ME); assert.strictEqual(await voice.allows(B64(16000)), false, 'no profile');
});

test('setup: five takes save the profile with mode 0600 and turn it on', async () => {
  const { voice, files, modes, store, clips, embedNext, lines } = setup({ on: false });
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  for (let i = 0; i < 5; i++) { embedNext(ME); await clips.onClip(B64(12000)); }
  assert.deepStrictEqual(await done, { ok: true, line: 'Done. Buddy now answers only your voice.' });
  assert.deepStrictEqual(JSON.parse(files.get('/u/my-voice.json')).profile, ME);
  assert.strictEqual(modes.get('/u/my-voice.json'), 0o600);
  assert.strictEqual(store.get('myVoiceOn'), true);
  assert.strictEqual(clips.stopped, true);
  assert.deepStrictEqual(lines, ['Say "Hey Rahul" 5 times. Wait for the tick each time.', 'Got it ✓ 1 of 5', 'Got it ✓ 2 of 5', 'Got it ✓ 3 of 5', 'Got it ✓ 4 of 5', 'Done. Buddy now answers only your voice.']);
});
```

  Plus: a short clip gives `again`; an odd fifth gives `odd`; `failed` and the `setupMs` timeout (mock timers) save
  nothing and leave `myVoiceOn` false; `model.ensure` rejecting gives `modelFailed`; `cancel()` mid-setup saves nothing;
  `off()` deletes the file, sets false, closes the check; a file with another model's sha makes `state().line`
  `setUpAgain`.
- [ ] **Step 2-4:** fail, implement, `node --test test/my-voice-main.test.js` + `npm test` pass. **Step 5: Commit.**

### Task M6: The gate in the wake loop, Test it, and setup clips

**Files:** Modify `src/main/wake.js`, `test/wake.test.js`.

**Interfaces:** `createWake({ …, myVoice = null })`. New method `clips(phrase, onClip) -> stop()`: while running, the ear
listens in test mode for `[phrase]` only, and each `woke` calls `onClip(msg.phrase)`; it never takes a request. While
`clips` runs, `test()` answers 0 at once and `onRequest` does nothing.

Rules:
- `onRequest(msg)`: right after the `testing` and `wakeOn` checks and **before** the busy line and `actions.transcribe`:
  `if (myVoice?.on() && !(await myVoice.allows(msg?.phrase))) return;` — silent: no `say`, no `transcribe`, no `voice`.
- `woke` while testing: when `myVoice?.on()`, count it only if `allows(msg.phrase)`; else call `testing.onNotYou?.()`.
  `test(onHeard, onNotYou)`.

- [ ] **Step 1: Failing tests** in `test/wake.test.js` (extend `setup()` with a fake `myVoice = { on: () => mv.on, allows: async (p) => mv.allow(p) }`):

```js
test('only my voice: someone else gets silence, and nothing is written down', async (t) => {
  const { handlers, log, actions, talk } = setup(t, { myVoice: { on: true, allow: () => false } });
  let transcribed = 0;
  actions.transcribe = async () => { transcribed += 1; return { text: 'call mom' }; };
  await handlers.request({ audio: 'UklGRg==', phrase: 'AAAA' });
  assert.strictEqual(transcribed, 0);
  assert.ok(!log.some(([k]) => k === 'voice'));
  assert.strictEqual(talk.said.length, 0, 'not even the busy line');
});

test('only my voice: the owner goes through as before, and the check sees the phrase', async (t) => {
  const seen = [];
  const { handlers, log } = setup(t, { myVoice: { on: true, allow: (p) => { seen.push(p); return true; } } });
  await handlers.request({ audio: 'UklGRg==', phrase: 'AAAA' });
  assert.deepStrictEqual(seen, ['AAAA']);
  assert.ok(log.some(([k, w]) => k === 'voice' && w === 'call mom'));
});

test('only my voice off: no check at all', async (t) => {
  let asked = 0;
  const { handlers, log } = setup(t, { myVoice: { on: false, allow: () => { asked += 1; return false; } } });
  await handlers.request({ audio: 'UklGRg==', phrase: null });
  assert.strictEqual(asked, 0);
  assert.ok(log.some(([k]) => k === 'voice'));
});

test('clips: the ear listens for the one phrase in test mode and hands each clip over', async (t) => {
  const { wake, handlers, log } = setup(t, {});
  const got = [];
  const stop = wake.clips('hey rahul', (p) => got.push(p));
  assert.deepStrictEqual(log.filter(([k]) => k === 'wake').pop()[1].phrases, ['hey rahul']);
  assert.strictEqual(log.filter(([k]) => k === 'wake').pop()[1].testOnly, true);
  handlers.woke({ phrase: 'AAAA' });
  assert.deepStrictEqual(got, ['AAAA']);
  stop();
  assert.deepStrictEqual(log.filter(([k]) => k === 'wake').pop()[1].phrases, RAHUL);
});
```

  Plus: Test it with my voice on counts an allowed wake and calls `onNotYou` for a refused one.
- [ ] **Step 2-4:** fail, implement, `node --test test/wake.test.js` + `npm test` pass. **Step 5: Commit.**

### Task M7: Settings

**Files:** Modify `src/main/ipc/settings.js`, `src/preload/settings.js`, `src/renderer/settings/index.html`,
`src/renderer/settings/settings.js`, `src/main/store.js` (`myVoiceOn: false` default with a comment); test
`test/settings-ipc.test.js`.

**Interfaces:**
- `registerSettingsIpc({ …, myVoice = null })`. The snapshot gets `myVoice: myVoiceSection()` =
  `{ label, about, redo, on, line, tone, setting }` (null on Windows or when `myVoice` is null).
- `settings:my-voice-setup` → runs `myVoice.setup({ name: heard ? shownName(buddyName) : 'Buddy', phrase: setupPhrase(buddyName, [...model.missing()]), onLine })`;
  each line is sent as `myvoice:line` `{ line, tone }` (`tone 'good'` for `got`/`done`, `'error'` for
  `again`/`odd`/`failed`/`timedOut`/`modelFailed`); answers `{ ok, line }`. Refused (answers
  `{ ok: false, line }` with the wake reason) unless the wake row is on and listening.
- `settings:my-voice-off` → `myVoice.off()`; `myvoice:changed` with the section after either.
- `myVoiceOn` is **not** in `SETTABLE` (it only becomes true through setup).
- Page: a row `#myvoice-row` right under `#wake-row`, shown only when the wake switch is on and the wake row is shown:
  title `Only my voice`, line `Buddy answers only you. Your voice stays on this device.`, status `#myvoice-status`
  (aria-live), switch `#myvoice-on`, button `#myvoice-redo` `Set up again` (shown when on). Switch on → setup (the switch
  shows on while it runs; a failed setup turns it back off); switch off → off (cancels a running setup). Test it's
  `onNotYou` shows `That didn't sound like you.` in `#wake-status` (error tone).

- [ ] **Step 1: Failing tests** in `test/settings-ipc.test.js`: `myVoiceOn` can't be set through `settings:set`; setup
  passes `name 'Rahul'` and phrase `hey rahul` for a hearable name, `'Buddy'`/`hey buddy` when not; lines are relayed
  with tones; setup is refused while the wake is off; off calls `myVoice.off()` and sends `myvoice:changed`; the
  snapshot holds the section (and null when `myVoice` is null).
- [ ] **Step 2-4:** fail, implement, run file + `npm test` pass. The page code has no unit test (as the wake row).
  **Step 5: Commit.**

### Task M8: Wiring, and the owner's check

**Files:** Modify `src/main/main.js` (around lines 148-170 and 427).

- [ ] **Step 1:** In `main.js`:

```js
const speakerModel = createSpeakerModel({ dir: path.join(userData, 'voice-model') });
const voiceCheck = createVoiceCheck({
  fork: (p, args) => utilityProcess.fork(p, args, { serviceName: 'Buddy voice check' }),
  modelPath: () => (speakerModel.ready() ? speakerModel.path() : null),
});
// created before wake; wake gets it; myVoice gets wake through a late binding: createMyVoice({ …, wake: { clips: (p, fn) => wake.clips(p, fn) } })
const myVoice = createMyVoice({ store, file: path.join(userData, 'my-voice.json'), model: speakerModel, check: voiceCheck, wake: { clips: (p, fn) => wake.clips(p, fn) } });
```

  Pass `myVoice` to `createWake` and `registerSettingsIpc`. Only on the Mac (`process.platform === 'darwin'`), as the
  wake is. Warm the check (`voiceCheck.warm()`) when the wake starts listening with my voice on, so the first check is
  not slowed by the 170 ms load; close it on quit (`app.on('will-quit', () => voiceCheck.close())`).
- [ ] **Step 2:** `npm test` and `npm run test:e2e` (one at a time). PASS.
- [ ] **Step 3: Owner's check (owner runs; the agent does not open the microphone):** `npm start`; Settings → wake on →
  Only my voice on → say "Hey <name>" 5 times; then 10 × "Hey <name>, what time is it" in a normal room and 5 with a fan
  on (count the misses); then 2 other people, 5 tries each (count the passes). Expected: owner ≥ 8/10 quiet, other
  people ≤ 1/10. Report the numbers; if outside, the only change is `MY_VOICE.match` (0.45 / 0.55) in S1's file,
  with all three syncs. Also: Activity Monitor shows "Buddy voice check" at ~100 MB while on, gone 10 min after the
  last wake. Turning Only my voice off removes `~/Library/Application Support/Buddy/my-voice.json`.
- [ ] **Step 4: Commit** `Only my voice (Mac): wire it up`.

---

# Android (Tasks A1-A8, worktree `~/projects/buddy-my-voice-android`) — in parallel with Mac

Paths below are under `android/app/src/main/java/com/akshatgg/buddy/` (main) and `android/app/src/test/java/com/akshatgg/buddy/` (tests).

### Task A1: The engine in the build

**Files:** Modify `android/app/build.gradle.kts`, `.gitignore` (`android/app/libs/*.aar`).

- [ ] **Step 1:** In `build.gradle.kts`:

```kotlin
// "Only my voice": sherpa-onnx's speaker embedding extractor (Apache 2.0), onnxruntime linked in. Not on Maven Central:
// fetched once from its GitHub release and kept only when its SHA-256 is this one.
val sherpaVersion = "1.13.8"
val sherpaAar = layout.projectDirectory.file("libs/sherpa-onnx-static-link-onnxruntime-$sherpaVersion.aar")
val sherpaSha256 = "b22c3fc1b6a45666d28892bb2f7694beeb77a8362d7ebd77c1a5431ec9435471"
val fetchSherpaOnnx by tasks.registering {
    outputs.file(sherpaAar)
    doLast {
        val out = sherpaAar.asFile
        fun sha(f: java.io.File) = java.security.MessageDigest.getInstance("SHA-256").digest(f.readBytes()).joinToString("") { "%02x".format(it) }
        if (out.isFile && sha(out) == sherpaSha256) return@doLast
        out.parentFile.mkdirs()
        val part = java.io.File(out.path + ".part")
        java.net.URI("https://github.com/k2-fsa/sherpa-onnx/releases/download/v$sherpaVersion/${out.name}").toURL().openStream().use { input -> part.outputStream().use { input.copyTo(it) } }
        check(sha(part) == sherpaSha256) { "sherpa-onnx AAR did not match its SHA-256" }
        part.renameTo(out)
    }
}
tasks.named("preBuild") { dependsOn(fetchSherpaOnnx) }
```

  In `dependencies`: `implementation(files(sherpaAar))`. In `android { packaging { … } }` add
  `jniLibs { useLegacyPackaging = true }` (keeps the APK about 17 MB larger instead of about 40). Keep the existing
  `abiFilters`. Add a comment that minify is off; if turned on it needs `-keep class com.k2fsa.sherpa.onnx.** { *; }`.
- [ ] **Step 2:** Check that both native libs can live together: build debug, then
  `unzip -l app/build/outputs/apk/debug/app-debug.apk | grep -E "lib/.*/(libvosk|libsherpa-onnx-jni|libjnidispatch)"`
  lists all three for each ABI. No duplicate `libc++_shared.so` error (the static AAR has none; if Gradle reports a
  duplicate, add `jniLibs { pickFirsts += "**/libc++_shared.so" }` and say so in the commit).
- [ ] **Step 3:** `:app:testDebugUnitTest` still passes.
- [ ] **Step 4:** Release size: note `ls -l` of `app-release.apk` (or the CI artifact) before and after; expected
  +~17 MB. CI: the release workflow's Gradle step needs nothing new (the task fetches the AAR), check the `android` job
  in `.github/workflows/release.yml` has network (it does, it already downloads Gradle deps).
- [ ] **Step 5: Commit** `Only my voice (Android): sherpa-onnx in the build`.

### Task A2: The shared rules in Kotlin

**Files:** Create `voice/MyVoiceRules.kt`, test `voice/MyVoiceRulesTest.kt`. Modify `core/Shared.kt` (read `speakerModel`).

**Interfaces:**

```kotlin
data class SpeakerModelSpec(val name: String, val file: String, val url: String, val sha256: String, val bytes: Long, val dim: Int)
data class SetupStep(val step: String, val count: Int, val profile: FloatArray? = null) // "more" | "again" | "odd" | "done" | "failed"
data class Span(val from: Int, val to: Int)

object MyVoiceRules {
    const val MATCH = 0.5f; const val AGREE = 0.45f; const val TAKES = 5; const val EXTRA_TAKES = 3
    const val MIN_PHRASE_MS = 350; const val MAX_PHRASE_MS = 3000; const val PAD_MS = 100; const val SETUP_MS = 90_000L; const val CHECK_MS = 3_000L
    fun unit(v: FloatArray?): FloatArray?
    fun cosine(a: FloatArray?, b: FloatArray?): Float          // -1 when unusable
    fun meanUnit(list: List<FloatArray>): FloatArray?
    fun oddTakes(takes: List<FloatArray>, agree: Float = AGREE): List<Int>
    fun isMe(profile: FloatArray?, embedding: FloatArray?, match: Float = MATCH): Boolean
    fun phraseSpan(startSec: Float, endSec: Float, rate: Int = 16_000): Span?
    fun setupPhrase(name: String, missing: Set<String>): String = VoiceWords.wakePhrases(name, missing).first()
    fun profileJson(profile: FloatArray, modelSha: String, at: String): String
    fun readProfile(json: String?, model: SpeakerModelSpec): FloatArray?
    object Lines { const val LABEL = "Only my voice"; /* … every MY_VOICE_LINES entry; start(name), got(count), again(name), odd(name) as funs */ }
}
class Setup(private val takes: Int = MyVoiceRules.TAKES, private val extraTakes: Int = MyVoiceRules.EXTRA_TAKES, private val agree: Float = MyVoiceRules.AGREE) {
    fun add(embedding: FloatArray?): SetupStep
}
```

  Compute in `Double` and compare as `Float` only at the end, so 0.5 at 60° matches JS (`cos(60°)` in double is
  0.5000000000000001; in float sums it could fall under 0.5). The test below catches it.

- [ ] **Step 1: Failing test** `MyVoiceRulesTest.kt` reading `my-voice-cases.json` (the same helper style as
  `VoiceWordsTest.kt`):

```kotlin
class MyVoiceRulesTest {
    private val cases = Json.parseToJsonElement(javaClass.getResource("/my-voice-cases.json")!!.readText()).jsonObject
    private fun JsonElement.floats() = jsonArray.map { it.jsonPrimitive.float }.toFloatArray()

    @Test fun numbersMatchShared() {
        val n = cases.getValue("numbers").jsonObject
        assertEquals(n.getValue("match").jsonPrimitive.float, MyVoiceRules.MATCH)
        assertEquals(n.getValue("agree").jsonPrimitive.float, MyVoiceRules.AGREE)
        assertEquals(n.getValue("takes").jsonPrimitive.int, MyVoiceRules.TAKES)
        assertEquals(n.getValue("extraTakes").jsonPrimitive.int, MyVoiceRules.EXTRA_TAKES)
        assertEquals(n.getValue("minPhraseMs").jsonPrimitive.int, MyVoiceRules.MIN_PHRASE_MS)
        assertEquals(n.getValue("maxPhraseMs").jsonPrimitive.int, MyVoiceRules.MAX_PHRASE_MS)
        assertEquals(n.getValue("padMs").jsonPrimitive.int, MyVoiceRules.PAD_MS)
    }

    @Test fun isMeAsShared() = cases.getValue("isMe").jsonArray.forEach { c ->
        val o = c.jsonObject
        assertEquals(o.toString(), o.getValue("me").jsonPrimitive.boolean, MyVoiceRules.isMe(o.getValue("profile").floats(), o.getValue("embedding").floats()))
    }

    @Test fun spansAsShared() = cases.getValue("spans").jsonArray.forEach { c ->
        val o = c.jsonObject
        val want = (o["span"] as? JsonObject)?.let { Span(it.getValue("from").jsonPrimitive.int, it.getValue("to").jsonPrimitive.int) }
        assertEquals(o.toString(), want, MyVoiceRules.phraseSpan(o.getValue("startSec").jsonPrimitive.float, o.getValue("endSec").jsonPrimitive.float))
    }

    @Test fun setupsAsShared() = cases.getValue("setups").jsonArray.forEach { c ->
        val o = c.jsonObject
        val setup = Setup()
        o.getValue("takes").jsonArray.zip(o.getValue("steps").jsonArray).forEach { (take, want) ->
            val got = setup.add((take as? JsonArray)?.let { take.floats() })
            assertEquals(o.toString(), want.jsonObject.getValue("step").jsonPrimitive.content, got.step)
            assertEquals(o.toString(), want.jsonObject.getValue("count").jsonPrimitive.int, got.count)
            assertEquals(want.jsonObject.containsKey("profile"), got.profile != null)
        }
    }

    @Test fun profilesAsShared() { /* each case: readProfile(json?.toString(), spec) != null == ok */ }
    @Test fun phrasesAsShared() { /* setupPhrase(name, missing.toSet()) == phrase */ }
    @Test fun linesAsShared() { /* every entry of "lines" equals the Kotlin one (start("Rahul"), got(2), again("Rahul"), odd("Rahul")) */ }
    @Test fun modelSpecFromSharedJson() { /* Shared(...).speakerModel equals cases.model's fields */ }
}
```

  (Write the three `/* … */` bodies out in full, in the same pattern.)
- [ ] **Step 2: Run** `--tests '*MyVoiceRulesTest*'`, fail. **Step 3: Implement** (and `Shared.speakerModel`, read
  from `root.getValue("speakerModel")` like `voiceModel`). **Step 4: Run, pass; whole suite passes.** **Step 5: Commit.**

### Task A3: Getting the model

**Files:** Create `voice/SpeakerModelFile.kt`, test `voice/SpeakerModelFileTest.kt`. Modify `AppGraph.kt`
(`val speakerModel by lazy { SpeakerModelFile(File(appContext.filesDir, "voice-model"), shared.speakerModel, ApkInstaller::download, scope) }`).

**Interface:** like `VoiceModel` without the unzip: `state: StateFlow<ModelState>` (reuse `ModelState`), `ready()`
(file there with `spec.bytes` bytes and an `ok` side file `<file>.ok` holding the SHA-256), `file()`, `suspend fun fetch()`
(download to `.part`, SHA-256, rename, write `.ok` last; throws `BuddyError("model_failed", …)` and leaves nothing),
`generation` bumps on each new file.

- [ ] **Step 1: Failing tests** (copy `VoiceModelTest.kt`'s fake `download` writing given bytes into the file): a body
  with the right hash and size is ready and the state goes Getting → Ready; a wrong hash leaves no file, state Failed,
  throws `model_failed`; a download that throws leaves nothing; progress percent from bytes; `generation` grows.
- [ ] **Step 2-4:** fail, implement, pass. **Step 5: Commit.**

### Task A4: The embedder and the owner's voice

**Files:** Create `voice/Embedder.kt`, `voice/MyVoice.kt`; tests `voice/MyVoiceTest.kt`, `voice/SharedEmbedderTest.kt`.

**Interfaces:**

```kotlin
/** A speaker embedding for 16 kHz PCM16, or null when it can't be made. */
fun interface Embedder { fun embed(pcm: ShortArray): FloatArray? }

/** sherpa-onnx on the device (thin, no logic worth a unit test; checked by the instrumented SherpaEmbedderTest). */
class SherpaEmbedder(model: File) : Embedder, AutoCloseable {
    private val ex = SpeakerEmbeddingExtractor(null, SpeakerEmbeddingExtractorConfig(model = model.absolutePath, numThreads = 1))
    @Synchronized override fun embed(pcm: ShortArray): FloatArray? {
        val stream = ex.createStream()
        try {
            stream.acceptWaveform(FloatArray(pcm.size) { pcm[it] / 32768f }, 16_000)
            stream.inputFinished()
            return if (ex.isReady(stream)) ex.compute(stream) else null
        } finally { stream.release() }
    }
    override fun close() = ex.release()
}

/** Loaded once and reused, like SharedSpotters: reloaded when the model file is replaced; null while it isn't there. */
class SharedEmbedder(private val ready: () -> Boolean, private val generation: () -> Int, private val load: () -> Embedder) {
    @Synchronized fun get(): Embedder?
    fun warm()
    @Synchronized fun close()
}

class MyVoice(
    private val file: File,                      // filesDir/my-voice.json
    private val spec: SpeakerModelSpec,
    private val embedder: () -> Embedder?,       // SharedEmbedder::get
    private val isOn: () -> Boolean,             // settings.myVoiceOn
    private val setOn: (Boolean) -> Unit,
    private val now: () -> String = { java.time.Instant.now().toString() },
) {
    /** True when off. When on: the clip is long enough, the profile reads, and the embedding is the owner's. Never throws. */
    fun allows(clip: ShortArray?): Boolean
    fun profileUsable(): Boolean
    /** Saves a finished setup's profile (tmp file + rename) and turns it on. */
    fun save(profile: FloatArray)
    /** Off: forgets the voice (deletes the file). */
    fun off()
    fun embed(clip: ShortArray): FloatArray?     // for setup: null when too short/long or not ready
}
```

  `allows` length rule: `MIN_PHRASE_MS * 16 <= clip.size <= MAX_PHRASE_MS * 16`. Exceptions inside → false (log
  `voice check: <code>` only).

- [ ] **Step 1: Failing tests** `MyVoiceTest.kt` with a `TemporaryFolder` and a fake `Embedder`:

```kotlin
private val ME = FloatArray(192).also { it[0] = 1f }
private val OTHER = FloatArray(192).also { it[1] = 1f }
private fun clip(ms: Int) = ShortArray(ms * 16)

@Test fun offAllowsEverythingWithoutChecking() {
    var calls = 0
    val v = voice(on = false, embed = { calls++; OTHER })
    assertTrue(v.allows(null)); assertEquals(0, calls)
}

@Test fun onOnlyTheOwnerPasses() {
    var next: FloatArray? = ME
    val v = voice(on = true, embed = { next }).also { it.save(ME) }
    assertTrue(v.allows(clip(800)))
    next = OTHER; assertFalse(v.allows(clip(800)))
    next = ME; assertFalse("too short", v.allows(clip(300)))
    assertFalse("too long", v.allows(clip(3100)))
    next = null; assertFalse(v.allows(clip(800)))
}

@Test fun noProfileOrAnotherModelIsANo() { /* on, no file → false; file with model "x" → false; profileUsable() false */ }
@Test fun embedderMissingOrThrowingIsANo() { /* embedder() returns null → false; embed throws → false */ }
@Test fun saveWritesTheFileAndTurnsOn() { /* JSON as MyVoiceRules.profileJson, setOn(true) called */ }
@Test fun offDeletesTheFile() { /* file gone, setOn(false) */ }
```

  `SharedEmbedderTest.kt`: loads once, reloads after `generation` changes (closing the old one if it is
  `AutoCloseable`), null while not ready, a failed load is tried again next time (as `SharedSpottersTest`).
- [ ] **Step 2-4:** fail, implement, pass. Wire in `AppGraph.kt`:
  `val embedder by lazy { SharedEmbedder(speakerModel::ready, { speakerModel.generation }, { SherpaEmbedder(speakerModel.file()) }) }`
  and `val myVoice by lazy { MyVoice(File(appContext.filesDir, "my-voice.json"), shared.speakerModel, embedder::get, { settings.myVoiceOn }, { settings.myVoiceOn = it }) }`;
  `store/AppSettings.kt`: `var myVoiceOn: Boolean` (default false), next to `wakeOn`. **Step 5: Commit.**

### Task A5: The check inside the wake listener

**Files:** Modify `voice/WakeListener.kt`; test `voice/WakeListenerTest.kt`.

**Interfaces:**

```kotlin
sealed interface WakeEvent {
    /** The phrase was heard (and, with a check, it was the owner). `phrase`: its audio, for setup; null when too short. */
    class Woke(val phrase: ShortArray?) : WakeEvent
    /** Test it only: a wake that did not pass the voice check. */
    data object NotYou : WakeEvent
    class Request(val wav: ByteArray?) : WakeEvent
}
class WakeListener(…, private val check: ((ShortArray?) -> Boolean)? = null)
```

  After `VoiceWords.wakeFrom(...)` succeeds: `val span = MyVoiceRules.phraseSpan(wake.startSec, wake.endSec)`;
  `val phrase = span?.let { kept.from(spotterStart + it.from).copyOfRange(0, minOf(kept.from(spotterStart + it.from).size, it.to - it.from)) }`
  (write a `PcmKeeper.range(from, to)` helper instead of copying twice). Then
  `if (check != null && !check(phrase)) { if (testOnly) on(WakeEvent.NotYou); restart the spotter as the testOnly path does; continue }`.
  Then `on(WakeEvent.Woke(phrase))` as today. `KEEP_SAMPLES` (25 s) is far more than 3 s, so the phrase is there.

- [ ] **Step 1: Failing tests** (`WakeListenerTest.kt` already fakes `PcmSource` and `Spotters`; the fake spotter returns
  a final result JSON with word times):
  - with `check = { false }`: no `Woke`, no `Request`, and the mic is not read for a request (the fake source counts
    reads after the wake: only the chunks the loop itself reads continue); a second spotter was made;
  - with `check = { true }`: `Woke(phrase)` then `Request` as before; the phrase has `(endSec - startSec + 0.2) * 16000`
    samples and starts at the right sample (fill the fake mic with a ramp so values show the offset);
  - with `check` that records its argument: it got the same samples as `Woke.phrase`;
  - testOnly + `check = { false }` → `NotYou`;
  - `check = null` (off) behaves exactly as today (the existing tests still pass, updated only for `Woke` being a class:
    `is WakeEvent.Woke`).
- [ ] **Step 2-4:** fail, implement, pass. Update `bubble/WakeControl.kt`'s `when` (`is WakeEvent.Woke ->`,
  `WakeEvent.NotYou -> BubbleBus.notYou()`). **Step 5: Commit.**

### Task A6: The service side: the check, setup clips

**Files:** Modify `bubble/WakeControl.kt`, `bubble/BubbleBus.kt`, `bubble/BubbleService.kt`, `voice/WakeRules.kt` (only
if a rule is added); tests `voice/WakeRulesTest.kt` if touched.

- [ ] **Step 1:** `WakeControl.listen(...)` passes
  `check = if (graph.settings.myVoiceOn) { clip -> graph.myVoice.allows(clip) } else null` (normal listening and Test it).
  Warm the embedder (`graph.embedder.warm()` on `Dispatchers.IO`) when listening starts with my voice on.
- [ ] **Step 2:** Setup clips: `BubbleBus.clips: SharedFlow<ShortArray?>` (extraBufferCapacity 8), `BubbleBus.notYou`
  (a `SharedFlow<Unit>` like `wakes`). `BubbleService.enroll(context, phrase, ms)` sends `ACTION_ENROLL` with
  `EXTRA_PHRASE`/`EXTRA_MS`; the service (only while `listening`, as `ACTION_TEST`) calls
  `wakeControl.refresh(testMs = ms, only = listOf(phrase), clips = true)`: a `testOnly` listener over `[phrase]`, no
  check, each `Woke(phrase)` → `BubbleBus.clip(phrase)`. `BubbleService.stopEnroll(context)` (`ACTION_ENROLL_STOP`)
  → `wakeControl.refresh()`.
- [ ] **Step 3:** No unit test for the service glue (Android edges, as today). `:app:testDebugUnitTest` and
  `:app:assembleDebug -x checkCloudProperties` pass. **Step 4: Commit.**

### Task A7: Settings

**Files:** Modify `ui/settings/SettingsModel.kt`, `ui/settings/SettingsScreen.kt`, `ui/MainActivity.kt`; test
`ui/settings/SettingsModelTest.kt`.

**Interfaces:**
- `SettingsState` gets `myVoiceOn: Boolean`, `myVoiceLine: Status?`, `myVoiceSetting: Boolean`.
- `SettingsModel(…, speakerModel: SpeakerModelFile? = null, myVoice: MyVoiceSettings? = null, collectClips: suspend (phrase: String, ms: Long, onClip: suspend (ShortArray?) -> Unit) -> Unit = { _, ms, _ -> delay(ms) })`
  where `interface MyVoiceSettings { val on: Boolean; fun profileUsable(): Boolean; fun embed(clip: ShortArray): FloatArray?; fun save(profile: FloatArray); fun off() }`
  (`MyVoice` implements it).
- `setMyVoiceOn(true)`: refused unless `wakeOn && wakeListening`; fetch the speaker model if needed (`GETTING_MODEL`
  with percent / `MODEL_FAILED`); then `Status(start(name))`, run `collectClips(phrase, SETUP_MS)` with a `Setup()`:
  each clip → `myVoice.embed` (on `Dispatchers.Default`) → `setup.add` → status `got(n)` (GOOD) / `again(name)` /
  `odd(name)` (ERROR); `done` → `myVoice.save`, `myVoiceOn = true`, `DONE`; `failed` → `FAILED`; time up → `TIMED_OUT`.
  `name` = the shown name when `wakeNameHeard`, else `"Buddy"`; `phrase` = `MyVoiceRules.setupPhrase(settings.buddyName, modelMissing())`.
- `setMyVoiceOn(false)`: cancel a running setup, `myVoice.off()`, state off.
- `redoMyVoice()`: the same as turning on, replacing the profile only on success (the old one stays until then).
- Test it with my voice on: `BubbleBus.notYou` → `wakeLine = Status(NOT_YOU, Tone.ERROR)` (MainActivity's `test` lambda
  collects it beside `wakes`, through a new `notYou: () -> Unit` argument).
- Screen: `MyVoiceRow` under `WakeRow`, only while `state.wakeOn && state.wakeListening`: title `Only my voice`, line
  `Buddy answers only you. Your voice stays on this device.`, `Switch`, `StatusLine(state.myVoiceLine)`, and
  `Secondary("Set up again")` when on and not setting up. When `myVoiceOn && !profileUsable()`:
  `Status(SET_UP_AGAIN, Tone.ERROR)`; else when on: `Status(ON)`.

- [ ] **Step 1: Failing tests** in `SettingsModelTest.kt` (fake `MyVoiceSettings` with a scripted `embed`, fake
  `collectClips` that feeds given clips, `runTest` + `advanceUntilIdle`): 5 good clips → profile saved, `myVoiceOn`
  true, the status lines in order `start, got 1..4, done`; a null embed → `again`; an odd fifth → `odd`; time up →
  `TIMED_OUT`, nothing saved; refused while the wake is off; off → `myVoice.off()` called; turning off mid-setup saves
  nothing; the name is "Buddy" and the phrase "hey buddy" when the model can't hear the name.
- [ ] **Step 2-4:** fail, implement, pass; build debug. **Step 5: Commit.**

### Task A8: Emulator check, and the owner's phone check

**Files:** Create `android/app/src/androidTest/java/com/akshatgg/buddy/voice/SherpaEmbedderTest.kt`,
`tools/android-voice-check.sh`.

- [ ] **Step 1:** The instrumented test loads the real engine on the x86_64 emulator (debug keeps x86_64):

```kotlin
@RunWith(AndroidJUnit4::class)
class SherpaEmbedderTest {
    // tools/android-voice-check.sh pushes these into the app's files dir (run-as) before the test.
    private val dir = File(InstrumentationRegistry.getInstrumentation().targetContext.filesDir, "voice-check-test")

    @Test fun sameVoiceScoresHigherThanAnother() {
        val model = File(dir, "campplus-zh-en-advanced.onnx")
        assumeTrue("run tools/android-voice-check.sh", model.isFile)
        SherpaEmbedder(model).use { e ->
            fun wav(name: String) = File(dir, name).readBytes().let { b -> ShortArray((b.size - 44) / 2) { i -> ((b[44 + 2 * i + 1].toInt() shl 8) or (b[44 + 2 * i].toInt() and 0xff)).toShort() } }
            val takes = (1..5).map { e.embed(wav("a-e$it.wav"))!! }
            val setup = Setup(); var last: SetupStep? = null
            takes.forEach { last = setup.add(it) }
            assertEquals("done", last!!.step)
            val t0 = System.nanoTime(); val mine = e.embed(wav("a-t1.wav")); val ms = (System.nanoTime() - t0) / 1e6
            assertTrue(MyVoiceRules.isMe(last!!.profile, mine))
            assertFalse(MyVoiceRules.isMe(last!!.profile, e.embed(wav("b-t1.wav"))))
            assertEquals(192, mine!!.size)
            Log.i("BuddyVoiceCheck", "embed ms=$ms")
        }
    }
}
```

- [ ] **Step 2:** `tools/android-voice-check.sh`: makes `a-e1..5.wav`, `a-t1.wav` (macOS `say -v Rishi`, rates
  150-210) and `b-t1.wav` (`say -v Samantha`) as `LEI16@16000`, needs `release/speaker-model/campplus-zh-en-advanced.onnx`
  (S1 Step 7), installs the debug APK, pushes the files with `adb push` to `/data/local/tmp` then
  `adb shell run-as com.akshatgg.buddy sh -c 'mkdir -p files/voice-check-test && cp /data/local/tmp/<f> files/voice-check-test/'`,
  and runs `./gradlew :app:connectedDebugAndroidTest -Pandroid.testInstrumentationRunnerArguments.class=com.akshatgg.buddy.voice.SherpaEmbedderTest`
  (same env/flags as the Global Constraints), then prints `adb logcat -d -s BuddyVoiceCheck`. Run it on the emulator
  (no microphone involved). Expected: PASS, `embed ms` printed.
- [ ] **Step 3: Owner's phone check** (owner runs; the agent does not): install the debug APK on his phone; Settings →
  wake on → Only my voice → setup; 10 × "Hey <name>, what time is it" quiet, 5 with a fan, 2 other people × 5. Expected
  as M8. Also run the instrumented test on the phone (`tools/android-voice-check.sh` with the phone connected) for the
  arm64 `embed ms` (expected < 80 ms).
- [ ] **Step 4: Commit** `Only my voice (Android): emulator check`.

---

# Finish (after both tracks)

- [ ] Merge `my-voice-mac` and `my-voice-android` into `my-voice` (in `~/projects/buddy-my-voice`), run `npm test` and the
  Android suite once more, one at a time.
- [ ] Owner: publish `speaker-model-1` if not done (S1 Step 7); give M8 / A8 numbers; OK the copy table in the spec.
- [ ] PR to master from `my-voice` (owner says when), body without any attribution line.

## Which tasks can run in parallel

| Order | Mac track | Android track |
|---|---|---|
| 1 (alone) | S1 | S1 |
| 2 | M1, M2, M3, M4 (any order; independent files) | A1, A2, A3 (A1 first if A4 needs the AAR on the classpath) |
| 3 | M5 (needs M2, M3), M6 (needs M4) | A4 (needs A1-A3), A5 (needs A2) |
| 4 | M7 (needs M5, M6) | A6 (needs A4, A5), A7 (needs A4, A6) |
| 5 | M8 | A8 |

The two tracks never touch the same file after S1.
