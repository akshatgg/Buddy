# Buddy asks out loud, hears yes or no, and wakes on "Hey <name>" (PR 2 and PR 3 of "Hey Buddy") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Part A (PR 2): after the person talks to Buddy (the panel's 🎤 today), Buddy answers out loud. For a message
card it says **"To Priya Sharma: I'm running late. Send it?"**, for a call card **"Call Prince Sharma?"** (or "WhatsApp
call …?"), and a spoken **"yes"** does exactly what the Send or Call button does, once; "no", anything unclear or 8 s of
nothing is no. A locked phone or Mac asks to be unlocked and waits a minute. Part B (PR 3): with a Settings switch,
Buddy listens all the time, on the device, for **"Hey <name>"** (the buddy's own name), and then takes the request
hands-free, on Android and the Mac.

**Architecture:** One shared file, `shared/voice-words.js`, holds every rule both apps must agree on: what a spoken
answer means (`heardAnswer`), the short word list the recognizer listens for (`answerGrammar`), what Buddy says for a
card (`spokenQuestion`) and around it (`spokenLines`, `unlockLine`), whether a line asks something back (`asksBack`),
and in Part B the wake phrase (`wakePhrase`, `wakeMissing`, `wakeFrom`). Android has a Kotlin port checked against
generated cases, as `message/Pick.kt` is. The chat stays where it is (`PanelModel.kt`, `actions.js`): a message can be
marked **spoken**, and then the chat speaks its lines and asks its card through a small `TalkBack` (say / hear yes-no /
listen once more / stop), which presses the card's own button on a yes. Android's `TalkBack` is `TextToSpeech` plus
`Ears` (Vosk through `com.alphacephei:vosk-android`, or `/api/transcribe` before the model is there). The Mac's is a
hidden **ear window** (`speechSynthesis`, `getUserMedia`, `vosk-browser`). The Vosk model
`vosk-model-small-en-in-0.4` is downloaded the first time it is needed from a Buddy GitHub release and checked against a
SHA-256 fixed in `shared/voice-model.js`. Part B adds an always-on wake loop on the same recognizer, with a grammar of
only `"hey <name>"` and `[unk]`: in `BubbleService` (a `microphone` foreground service) on Android, in the ear window on
the Mac.

**Tech Stack:** Electron + Node (`node:test`), `vosk-browser` (WebAssembly) in a renderer, Kotlin Android (JUnit4,
kotlinx-coroutines-test, Compose), `com.alphacephei:vosk-android` + JNA, Android `TextToSpeech` / `AudioRecord`.

**Spec:** `docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md`, sections "2. Talking back and yes/no by voice
(PR 2)" and "3. 'Hey <name>' (PR 3)", and its "Changes after reading the code" (ask first, then act; the locked wait is
in PR 2). The owner added on 2026-10-15 that the spoken question covers **calls** too ("Call Prince Narasimhan?" →
"yes" → it calls). Calls: `docs/superpowers/specs/2026-10-15-buddy-calls-and-apps-design.md`. What exists: the plans
`docs/superpowers/plans/2026-10-15-hey-buddy-message-pr1.md` and `docs/superpowers/plans/2026-10-15-buddy-calls-and-apps.md`
(both merged: #51, #52).

## Global Constraints

- Part A: branch `voice-hey`, worktree `~/projects/buddy-voice-hey` (from master `5adec7e`). Part B: branch `voice-wake`,
  worktree `~/projects/buddy-voice-wake`, made from master once PR 2 is merged (if the owner wants it sooner, from
  `voice-hey`, rebased after the merge). Never touch other worktrees or branches.
- **No Claude attribution anywhere.** No `Co-Authored-By` trailer and no "Generated with" line in commits or PRs.
- **Buddy never sends a message or places a call without a yes.** The yes is the card's button pressed, or a spoken yes
  heard for **that card, while its question is the one being asked**. A spoken yes counts once: it goes through the
  same press path as the button (`press(id, …)` on Android, `act(id, …)` on the Mac), which only works while the card
  still shows the button. Anything unclear (no yes word, any no word, both, nothing, an error) is **no**.
- **Listening for the answer starts only after Buddy has finished speaking the question** (plus 300 ms), so that its
  own "Send it?" or "Call …?" can never be heard as a yes.
- **Privacy:** nothing leaves the device before the wake phrase. The wake check is on the device. Yes/no is on the
  device once the model is there; before that (or when a word of the list is missing from the model) the short answer
  recording goes to `/api/transcribe`, as the 🎤 does. Recordings are never kept on disk, never logged, never committed.
- User-facing copy in plain short English, exactly as written in this plan. The spec's lines are used word for word;
  every line is listed in "New copy for the owner to OK" at the end.
- After changing anything in `shared/`, run `npm run sync:web && npm run sync:web-app && npm run sync:android`.
  `npm test` checks all three copies.
- JS tests: `npm test` (lint and every suite). **Never run two JS suites at once** (two `npm test`, or `npm test` with
  `npm run test:e2e`): they share ports and temp folders. One file: `node --test test/<file>`.
- Android tests (from the worktree's `android/`):
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew -q -Djava.net.preferIPv4Stack=true :app:testDebugUnitTest`
  (add `--tests '*Name*'` for one class). Android build: the same env and flags with
  `:app:assembleDebug -x checkCloudProperties`.
- **No live WhatsApp, call or microphone run without the owner.** The agent never runs `waFind`/`waSend`/`waCall`
  against the real WhatsApp, never places a call, and never opens the real microphone (no `npm start` voice test, no
  install-and-talk on a phone) unless the owner says so in this session. Device steps are the owner's.
- **Publishing the model to a GitHub release is the owner's action** (Task A2, Step 4). The agent prepares the files
  and the exact command, and stops.
- No Robolectric. Android logic lives in pure functions and small classes over interfaces, tested with fakes, as
  `message/Messenger.kt` is; the Android-only edges (`TextToSpeech`, `AudioRecord`, Vosk's JNI, `KeyguardManager`,
  the foreground service) are thin classes with no logic worth a test.
- Match the surrounding code's style: plain-English doc comments, the same naming. The only new libraries are
  `vosk-android` (+ its `jna`) on Android and `vosk-browser` on the Mac.

## Values that must be confirmed (device, network or owner)

| Value | Where it is used | Confirmed in |
|---|---|---|
| The model's upstream URL `https://alphacephei.com/vosk/models/vosk-model-small-en-in-0.4.zip`, its size (about 36 MB) and licence (Apache 2.0) | `tools/pack-voice-model.js` | Task A2, Step 2 |
| The two release asset URLs and their **SHA-256** and byte counts | `shared/voice-model.js` | Task A2, Step 3 (printed by the tool) |
| The words list path inside the model (expected `graph/words.txt`, lines `<word> <id>`) | `VOICE_MODEL.words` | Task A2, Step 2 |
| Whether `haan`, `nahi`, `na`, `ha`, `don't` and the default buddy names `aarav`, `anaya` are in that list | the yes/no grammar, the wake name check | Task A2, Step 2 (printed) |
| `vosk-android` and `jna` versions (expected `com.alphacephei:vosk-android:0.3.47@aar`, `net.java.dev.jna:jna:5.13.0@aar`) and the APK size they add | `android/app/build.gradle.kts` | Task A5, Step 1 |
| `vosk-browser` version (expected `0.0.8`), its API names (`Vosk.createModel(url)`, `new model.KaldiRecognizer(rate, grammarJson)`, `setWords(true)`, `acceptWaveformFloat(samples, rate)`, `retrieveFinalResult()`, the `result` / `partialresult` events) and the CSP it needs in Electron (`'wasm-unsafe-eval'`, `worker-src blob:`, `connect-src blob:`) | the ear page | Task A8, Step 1 (spike) |
| That a hidden Electron window can `getUserMedia` and `speechSynthesis.speak` with `backgroundThrottling: false` | the ear window | Task A8, Step 1 (spike, owner runs it) |
| Vosk's word times (`start`/`end` in seconds since the recognizer began) and its endpoint (a final result after about 0.5 s of quiet) | the answer and wake loops | Task A11 / B9 |
| The wake confidence floor (starts at `0.6`) | `WAKE_FLOOR` | Task B9 (owner's 20 recordings) |
| Android 14+: a `microphone` foreground service started from an activity on screen, and refused after a reboot | `BubbleService` | Task B9 |
| Whether a partial wake lock is needed for `AudioRecord` with the screen off | `WakeControl` | Task B8 |
| CPU (target < 5% of one core, Mac) and battery (target < 4% an hour, phone) | — | Task B8 |

## Android versions this relies on (minSdk 26, targetSdk 36)

| What | Versions | How the plan handles it |
|---|---|---|
| `TextToSpeech` | all | One engine, made on first use; `say` waits for `UtteranceProgressListener.onDone`/`onError`, at most 20 s |
| `AudioRecord` 16 kHz mono PCM16, source `VOICE_RECOGNITION` | all | `AudioRecordSource`; `RECORD_AUDIO` is already in the manifest and asked by the 🎤 |
| `foregroundServiceType="microphone"` + `FOREGROUND_SERVICE_MICROPHONE` | 14+ (API 34) required to record from a service; the type can only be **started** while the app is on screen | `BubbleService.foreground(listening = true)` only from an `ACTION_LISTEN` the app sends while an activity is visible; a refusal (`SecurityException`) sets `wakeNeedsTap` |
| Starting the microphone after a reboot | 14+ refuses `microphone` from `BOOT_COMPLETED` | `BootReceiver` starts the bubble as today; the bubble says "Tap me to listen again" until an activity opens |
| Another app recording, a call | 10+ (API 29) `AudioRecordingConfiguration.isClientSilenced` | `WakeControl` pauses while Buddy's own recording is silenced, while `AudioManager.mode` is a call or ringtone, and while Buddy's own 🎤 or a voice turn records |
| `KeyguardManager.isKeyguardLocked`, `ACTION_USER_PRESENT` | all | `KeyguardLock` (the same broadcast `BubbleService.listenToScreen` uses) |
| The green mic dot | 12+ | Shown while listening; cannot be hidden (the spec says so) |

---

# Part A — PR 2: Buddy talks back, and hears yes or no

### Task A1: The shared voice words

**Files:**
- Create: `shared/voice-words.js`, `test/voice-words.test.js`
- Modify: `tools/sync-android-shared.js` (a new `VOICE_TO`, `VOICE_CASES` and `buildVoiceCases`, the writer loop :223-229,
  exports :232), `test/android-shared.test.js` (one new test, as for `LINES_TO` :81)
- Regenerated: `android/app/src/test/resources/voice-cases.json` (new); `web/shared/*` and `web/public/app/shared/*` get
  the file through the sync tools (nothing there uses it)

**Interfaces (all exported from `shared/voice-words.js`):**
- `YES_WORDS = ['yes', 'yeah', 'haan', 'ha', 'okay']`, `NO_WORDS = ['no', 'nahi', 'na', 'cancel', "don't", 'stop', 'not', 'mat', 'nope', 'nah', 'wait']`,
  `VERBS = ['send', 'call']`.
- `heardWords(text: string, verb: 'send'|'call') -> 'yes' | 'no' | null`: `null` when no word was heard; `'no'` when any
  no word is there or any word is not a yes word, the card's own verb or a filler (`it please ji now do karo kar de`); else
  `'yes'` when a yes word or the verb is there; else `null`. So "do not send it" and "okay, not now" are no.
- `heardAnswer(text, verb) -> 'yes' | 'no'`: `heardWords(...) ?? 'no'`.
- `answerGrammar(verb, known: Set<string> | null) -> { grammar: string[], missing: string[] }`: the yes words, the
  verb and the no words that `known` has (all of them when `known` is null), then `'[unk]'`; `missing` the ones it
  lacks.
- `spokenQuestion(card) -> string` for `{ kind: 'message', name, text }` or `{ kind: 'call', name, how }` (`how`:
  `'phone' | 'whatsapp' | 'whatsapp_video'`).
- `spokenLines(items) -> string[]` for chat items `{ type: 'buddy'|'event'|'error'|'you'|'question', say, text, code }`.
- `asksBack(line) -> boolean`.
- `unlockLine(device: 'phone'|'Mac', kind: 'message'|'call', name) -> string`, `callingLine(name) -> string`.
- `VOICE_LINES = { sent: 'Sent.', notSent: 'Okay, not sent.', notNow: 'Okay, not now.', noInternet: "I can't reach the internet right now.", didntSend: "I didn't send it.", didntCall: "I didn't call." }`.
- `SPOKEN_MAX = 240`, `ANSWER_MS = 8000`, `UNLOCK_WAIT_MS = 60000`, `MAX_FOLLOW_UPS = 2`.

- [ ] **Step 1: Write the failing tests** in `test/voice-words.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  heardWords, heardAnswer, answerGrammar, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine, VOICE_LINES,
} = require('../shared/voice-words');

test('a yes word, or the card\'s own verb, is yes; any no word wins; nothing decisive is no', () => {
  for (const said of ['yes', 'Yes!', 'yeah send it', 'Haan.', 'ha', 'okay', 'OK', 'send']) assert.strictEqual(heardAnswer(said, 'send'), 'yes', said);
  for (const said of ['call', 'yes call him']) assert.strictEqual(heardAnswer(said, 'call'), 'yes', said);
  for (const said of ['no', 'Nahi.', 'nahin', 'na', 'cancel', "don't", 'Don’t send it', 'stop', 'yes no', 'no, send it']) {
    assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  }
  for (const said of ['', '[unk]', 'maybe', 'what', 'call', 'later']) assert.strictEqual(heardAnswer(said, 'send'), 'no', said);
  assert.strictEqual(heardAnswer('send', 'call'), 'no', 'a message\'s verb is not a yes for a call');
});

test('heardWords tells "nothing decisive yet" (null) from a no', () => {
  assert.strictEqual(heardWords('[unk] [unk]', 'send'), null);
  assert.strictEqual(heardWords('hmm', 'call'), null);
  assert.strictEqual(heardWords('nahi', 'call'), 'no');
  assert.strictEqual(heardWords('haan', 'call'), 'yes');
});

test('the grammar keeps the words the model knows, then [unk], and says which it lacks', () => {
  assert.deepStrictEqual(answerGrammar('send', null).grammar,
    ['yes', 'yeah', 'haan', 'ha', 'okay', 'send', 'no', 'nahi', 'na', 'cancel', "don't", 'stop', '[unk]']);
  const known = new Set(['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop']);
  assert.deepStrictEqual(answerGrammar('call', known), {
    grammar: ['yes', 'yeah', 'okay', 'call', 'no', 'cancel', "don't", 'stop', '[unk]'],
    missing: ['haan', 'ha', 'nahi', 'na'],
  });
});

test('the card is asked out loud as the spec says', () => {
  assert.strictEqual(spokenQuestion({ kind: 'message', name: 'Priya Sharma', text: "I'm running late" }), "To Priya Sharma: I'm running late. Send it?");
  assert.strictEqual(spokenQuestion({ kind: 'message', name: 'Priya Sharma', text: 'Where are you? ' }), 'To Priya Sharma: Where are you? Send it?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Narasimhan', how: 'phone' }), 'Call Prince Narasimhan?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Sharma', how: 'whatsapp' }), 'WhatsApp call Prince Sharma?');
  assert.strictEqual(spokenQuestion({ kind: 'call', name: 'Prince Sharma', how: 'whatsapp_video' }), 'WhatsApp video call Prince Sharma?');
});

test('what is said around a card: say, a short line of Buddy\'s own, red lines, done lines', () => {
  const long = 'x'.repeat(241);
  assert.deepStrictEqual(spokenLines([
    { type: 'you', text: 'message priya' },
    { type: 'buddy', say: 'Okay!', text: long },
    { type: 'buddy', say: '', text: 'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.' },
    { type: 'buddy', say: '', text: long },
    { type: 'event', text: '✅ Opened YouTube' },
    { type: 'event', text: '📖 Read your text' },
    { type: 'error', text: 'No internet.', code: 'network' },
    { type: 'error', text: 'Buddy took too long to answer. Try again.', code: 'timeout' },
    { type: 'error', text: 'Sign in to use Buddy.', code: 'signed_out' },
    { type: 'question', text: 'To Priya Sharma: hi' },
  ]), [
    'Okay!',
    'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.',
    'Opened YouTube',
    VOICE_LINES.noInternet,
    VOICE_LINES.noInternet,
    'Sign in to use Buddy.',
  ]);
});

test('a line asks back when it has a question, or asks for the full name', () => {
  assert.strictEqual(asksBack('Who should I send it to?'), true);
  assert.strictEqual(asksBack('Which Priya: Priya Sharma or Priya Verma? Tell me the full name.'), true);
  assert.strictEqual(asksBack('I found lots of people called a. Tell me the full name.'), true);
  assert.strictEqual(asksBack("I couldn't find Zoya in your contacts."), false);
});

test('the locked lines', () => {
  assert.strictEqual(unlockLine('phone', 'message', 'Priya Sharma'), "Unlock your phone and I'll send it to Priya Sharma.");
  assert.strictEqual(unlockLine('Mac', 'message', 'Priya Sharma'), "Unlock your Mac and I'll send it.");
  assert.strictEqual(unlockLine('phone', 'call', 'Prince Sharma'), "Unlock your phone and I'll call Prince Sharma.");
  assert.strictEqual(unlockLine('Mac', 'call', 'Prince Sharma'), "Unlock your Mac and I'll call Prince Sharma.");
  assert.strictEqual(callingLine('Prince Sharma'), 'Calling Prince Sharma.');
});
```

  And in `test/android-shared.test.js`, after the `LINES_TO` test:

```js
test('voice-cases.json is up to date, and covers yes, no, nothing, questions and lines', () => {
  assert.equal(fs.readFileSync(VOICE_TO, 'utf8'), `${JSON.stringify(buildVoiceCases(), null, 2)}\n`);
  const cases = JSON.parse(fs.readFileSync(VOICE_TO, 'utf8'));
  for (const answer of ['yes', 'no', null]) assert.ok(cases.heard.some((c) => c.words === answer), String(answer));
  assert.ok(cases.questions.length >= 4 && cases.lines.length >= 1 && cases.asksBack.length >= 3 && cases.grammar.length >= 2);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/voice-words.test.js test/android-shared.test.js`
Expected: FAIL (`Cannot find module '../shared/voice-words'`).

- [ ] **Step 3: Implement** `shared/voice-words.js`:

```js
'use strict';

/**
 * The words of Buddy's voice flow (docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md §2): what a spoken
 * answer to "Send it?" or "Call Prince Sharma?" means, the short list the on-device recognizer listens for, what Buddy
 * says out loud for a card and around it, and whether a line asks the person something back. The Android app has a
 * port (voice/VoiceWords.kt), checked against the cases tools/sync-android-shared.js writes out.
 */

const YES_WORDS = ['yes', 'yeah', 'haan', 'ha', 'okay'];
const NO_WORDS = ['no', 'nahi', 'na', 'cancel', "don't", 'stop'];
const VERBS = ['send', 'call']; // a card's own word is a yes for that card only
// The same word as a recognizer or Whisper may write it.
const SAME = { ok: 'okay', dont: "don't", nahin: 'nahi', haa: 'haan', han: 'haan' };
const SPOKEN_MAX = 240; // a line of Buddy's own longer than this is only shown
const ANSWER_MS = 8000; // nothing decisive heard this long after the question: no
const UNLOCK_WAIT_MS = 60000;
const MAX_FOLLOW_UPS = 2; // "Which Priya?" answered by voice, at most twice in a row
const DONE = /^(✅|📞|📹)\s*/u;
const NO_INTERNET = ['network', 'timeout'];

const VOICE_LINES = {
  sent: 'Sent.',
  notSent: 'Okay, not sent.',
  notNow: 'Okay, not now.',
  noInternet: "I can't reach the internet right now.",
  didntSend: "I didn't send it.",
  didntCall: "I didn't call.",
};

/** The words said, lower case, punctuation and [unk] gone, each as the lists write it. */
function wordsOf(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/\[unk\]/g, ' ')
    .replace(/[^a-z' ]+/g, ' ')
    .split(/\s+/)
    .map((w) => w.replace(/^'+|'+$/g, ''))
    .filter(Boolean)
    .map((w) => SAME[w] || w);
}

function heardWords(text, verb) {
  const words = wordsOf(text);
  if (words.some((w) => NO_WORDS.includes(w))) return 'no';
  if (words.some((w) => YES_WORDS.includes(w) || w === verb)) return 'yes';
  return null;
}

function heardAnswer(text, verb) {
  return heardWords(text, verb) ?? 'no';
}

function answerGrammar(verb, known = null) {
  const all = [...YES_WORDS, verb, ...NO_WORDS];
  const kept = known ? all.filter((w) => known.has(w)) : all;
  return { grammar: [...kept, '[unk]'], missing: all.filter((w) => !kept.includes(w)) };
}

function spokenQuestion(card) {
  if (card.kind === 'message') {
    const text = String(card.text || '').trim();
    return `To ${card.name}: ${/[.!?…]$/.test(text) ? text : `${text}.`} Send it?`;
  }
  if (card.how === 'whatsapp_video') return `WhatsApp video call ${card.name}?`;
  if (card.how === 'whatsapp') return `WhatsApp call ${card.name}?`;
  return `Call ${card.name}?`;
}

function spokenLines(items) {
  const out = [];
  for (const item of items) {
    const say = String(item.say || '').trim();
    const text = String(item.text || '').trim();
    if (item.type === 'buddy') {
      const line = say || (text.length <= SPOKEN_MAX ? text : '');
      if (line) out.push(line);
    } else if (item.type === 'error') {
      out.push(NO_INTERNET.includes(item.code) ? VOICE_LINES.noInternet : text);
    } else if (item.type === 'event' && DONE.test(text)) {
      out.push(text.replace(DONE, ''));
    }
  }
  return out;
}

function asksBack(line) {
  const text = String(line || '').trim();
  return text.includes('?') || text.endsWith('Tell me the full name.');
}

function unlockLine(device, kind, name) {
  if (device === 'Mac') return kind === 'call' ? `Unlock your Mac and I'll call ${name}.` : "Unlock your Mac and I'll send it.";
  return kind === 'call' ? `Unlock your phone and I'll call ${name}.` : `Unlock your phone and I'll send it to ${name}.`;
}

function callingLine(name) {
  return `Calling ${name}.`;
}

module.exports = {
  YES_WORDS, NO_WORDS, VERBS, SPOKEN_MAX, ANSWER_MS, UNLOCK_WAIT_MS, MAX_FOLLOW_UPS, VOICE_LINES,
  heardWords, heardAnswer, answerGrammar, spokenQuestion, spokenLines, asksBack, unlockLine, callingLine,
};
```

  In `tools/sync-android-shared.js` add (next to `LINES_TO`):

```js
const VOICE_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'voice-cases.json');
const voice = require('../shared/voice-words');
const HEARD = [['yes', 'send'], ['Haan.', 'call'], ['ok send it', 'send'], ['send', 'call'], ['call', 'call'], ['no, send it', 'send'],
  ['Don’t', 'call'], ['nahin', 'send'], ['[unk] [unk]', 'send'], ['', 'call'], ['maybe later', 'send'], ['yes no', 'call']];
const QUESTIONS = [{ kind: 'message', name: 'Priya Sharma', text: "I'm running late" }, { kind: 'message', name: 'Priya', text: 'Kahan ho? ' },
  { kind: 'call', name: 'Prince Narasimhan', how: 'phone' }, { kind: 'call', name: 'Prince', how: 'whatsapp' }, { kind: 'call', name: 'Prince', how: 'whatsapp_video' }];
const LINE_ITEMS = [[{ type: 'buddy', say: 'Okay!', text: 'x' }, { type: 'buddy', say: '', text: 'Which Priya: A or B? Tell me the full name.' },
  { type: 'buddy', say: '', text: 'y'.repeat(241) }, { type: 'event', text: '✅ Opened YouTube' }, { type: 'event', text: '📝 Remembered: x' },
  { type: 'error', text: 'x', code: 'network' }, { type: 'error', text: 'Sign in to use Buddy.', code: 'signed_out' }, { type: 'question', text: 'q' }]];
const ASKS = ['Who should I call?', 'I found lots of apps called a. Tell me the full name.', "I couldn't find YouTube on this phone.", ''];
const KNOWN = [null, ['yes', 'okay', 'send', 'no', 'cancel', 'stop']];

function buildVoiceCases() {
  return {
    note: 'Made by tools/sync-android-shared.js from shared/voice-words.js. Do not edit: run npm run sync:android.',
    heard: HEARD.map(([text, verb]) => ({ text, verb, words: voice.heardWords(text, verb), answer: voice.heardAnswer(text, verb) })),
    grammar: KNOWN.flatMap((known) => voice.VERBS.map((verb) => ({ verb, known, ...voice.answerGrammar(verb, known && new Set(known)) }))),
    questions: QUESTIONS.map((card) => ({ card, said: voice.spokenQuestion(card) })),
    lines: LINE_ITEMS.map((items) => ({ items, said: voice.spokenLines(items) })),
    asksBack: ASKS.map((line) => ({ line, asks: voice.asksBack(line) })),
    unlock: [['phone', 'message'], ['phone', 'call'], ['Mac', 'message'], ['Mac', 'call']]
      .map(([device, kind]) => ({ device, kind, name: 'Priya Sharma', said: voice.unlockLine(device, kind, 'Priya Sharma') })),
  };
}
```

  Add `[VOICE_TO, buildVoiceCases()]` to the writer loop and `buildVoiceCases, VOICE_TO` to the exports and to the
  test's require.

- [ ] **Step 4: Sync and run**

Run: `npm run sync:web && npm run sync:web-app && npm run sync:android && node --test test/voice-words.test.js test/android-shared.test.js`
Expected: PASS. Then `npm test`: PASS.

- [ ] **Step 5: Commit**

```bash
git add shared/voice-words.js tools/sync-android-shared.js test/voice-words.test.js test/android-shared.test.js web android/app/src/test/resources/voice-cases.json
git commit -m "feat(voice): the shared words of Buddy's voice: yes or no, the spoken question, the lines around it"
```

---

### Task A2: The model, as a Buddy release asset (the owner publishes it)

**Files:**
- Create: `tools/pack-voice-model.js`, `shared/voice-model.js`, `test/voice-model-spec.test.js`
- Modify: `tools/sync-android-shared.js` (`buildShared` gets `voiceModel: VOICE_MODEL`), `.gitignore` (`release/voice-model/`)
- Regenerated: `android/app/src/main/assets/shared.json`

**Interfaces:**
- `shared/voice-model.js` exports `VOICE_MODEL = { name, tag, zip: { url, sha256, bytes }, tgz: { url, sha256, bytes }, words }`:
  `name: 'vosk-model-small-en-in-0.4'`, `tag: 'voice-model-1'`,
  `zip.url: 'https://github.com/akshatgg/Buddy/releases/download/voice-model-1/vosk-model-small-en-in-0.4.zip'` (Android),
  `tgz.url: 'https://github.com/akshatgg/Buddy/releases/download/voice-model-1/vosk-model-small-en-in-0.4.tar.gz'` (the Mac;
  `vosk-browser` reads a `.tar.gz`), `words: 'graph/words.txt'` (inside the model folder).
- `tools/pack-voice-model.js [--from <zip>]`: downloads the upstream zip (or takes a local one), checks it has
  `<name>/am/final.mdl` and `<name>/<words>`, writes `release/voice-model/<name>.zip` (the upstream file as it is) and
  `<name>.tar.gz` (the same folder, `tar -czf`), and prints each file's SHA-256 and bytes, the word count, and which of
  `haan nahi na ha don't aarav anaya rahul priya` the words list lacks.

- [ ] **Step 1: Write the failing test** `test/voice-model-spec.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { VOICE_MODEL } = require('../shared/voice-model');

test('the model is a Buddy release asset, fixed by its SHA-256 and size', () => {
  assert.strictEqual(VOICE_MODEL.name, 'vosk-model-small-en-in-0.4');
  for (const file of [VOICE_MODEL.zip, VOICE_MODEL.tgz]) {
    assert.match(file.url, /^https:\/\/github\.com\/akshatgg\/Buddy\/releases\/download\/voice-model-1\//);
    assert.match(file.sha256, /^[0-9a-f]{64}$/, 'the SHA-256 printed by tools/pack-voice-model.js');
    assert.ok(Number.isInteger(file.bytes) && file.bytes > 20e6 && file.bytes < 80e6);
  }
});

test('Android reads the same model from shared.json', () => {
  const shared = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'assets', 'shared.json'), 'utf8'));
  assert.deepStrictEqual(shared.voiceModel, VOICE_MODEL);
});
```

- [ ] **Step 2: Write the tool and run it (downloading a public file is fine; publishing is not).**
  `tools/pack-voice-model.js` uses `fetch` (following redirects) into `release/voice-model/`, `unzip -q` into a temp
  folder, `tar -czf <name>.tar.gz -C <temp> <name>`, `crypto.createHash('sha256')` on each file, and reads
  `<temp>/<name>/<words>` (first column of each line). It refuses (exit 1) when `am/final.mdl` or the words file is
  missing, and prints, for the plan's "Values that must be confirmed" table:

```
vosk-model-small-en-in-0.4.zip     <sha256>  <bytes>
vosk-model-small-en-in-0.4.tar.gz  <sha256>  <bytes>
words: <n>; missing: <the words above not in the list>
```

Run: `node tools/pack-voice-model.js`
Expected: the three lines. **If the words file is not `graph/words.txt`, set `words` to the path found.** Note which yes/no
words and names are missing: they are dropped from the grammar (Task A1) and, for yes/no, the transcribe fallback hears
them; a missing default name means Settings shows its line (Part B).

- [ ] **Step 3: Implement** `shared/voice-model.js` with the printed SHA-256s and bytes:

```js
'use strict';

/**
 * Buddy's ears: the small Indian-English Vosk model (Apache 2.0, from alphacephei.com), not in the installers. Each app
 * downloads it from Buddy's own GitHub release the first time it needs it, and keeps it only when its SHA-256 is this
 * one. Android takes the zip, the Mac the .tar.gz (vosk-browser reads that). tools/pack-voice-model.js makes both.
 */
const BASE = 'https://github.com/akshatgg/Buddy/releases/download/voice-model-1';
const VOICE_MODEL = {
  name: 'vosk-model-small-en-in-0.4',
  tag: 'voice-model-1',
  zip: { url: `${BASE}/vosk-model-small-en-in-0.4.zip`, sha256: '<zip sha256 printed in Step 2>', bytes: 0 /* printed in Step 2 */ },
  tgz: { url: `${BASE}/vosk-model-small-en-in-0.4.tar.gz`, sha256: '<tar.gz sha256 printed in Step 2>', bytes: 0 /* printed in Step 2 */ },
  words: 'graph/words.txt',
};
module.exports = { VOICE_MODEL };
```

  (The four values come from Step 2's output; the test refuses anything else.) In `buildShared` add
  `voiceModel: require('../shared/voice-model').VOICE_MODEL,`. Run `npm run sync:android`, then
  `node --test test/voice-model-spec.test.js`: PASS.

- [ ] **Step 4: OWNER ACTION — publish the asset.** Stop and ask the owner. The command (it must never become "latest":
  the Mac's Update now and the website read `releases/latest`; Android's updater skips tags that are not
  `android-v…`):

```bash
gh release create voice-model-1 --repo akshatgg/Buddy --latest=false \
  --title "Buddy's ears (voice model)" \
  --notes "vosk-model-small-en-in-0.4 (Apache 2.0, alphacephei.com), for Buddy's voice. Downloaded by the apps on first use and checked by SHA-256." \
  release/voice-model/vosk-model-small-en-in-0.4.zip release/voice-model/vosk-model-small-en-in-0.4.tar.gz
```

  After the owner runs it: `curl -sIL <zip url> | grep -i content-length` and the same for the tar.gz match `bytes`;
  `gh release view --repo akshatgg/Buddy --json tagName -q .tagName` still prints the newest `v…` tag.

- [ ] **Step 5: Commit**

```bash
git add tools/pack-voice-model.js shared/voice-model.js tools/sync-android-shared.js test/voice-model-spec.test.js .gitignore android/app/src/main/assets/shared.json web
git commit -m "feat(voice): Buddy's ears come from Buddy's own release, fixed by their SHA-256"
```

---

### Task A3: Android ports the voice words, the end of speech, and WAV

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt`, `voice/SpeechEnd.kt`, `voice/Pcm.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/VoiceWordsTest.kt`, `SpeechEndTest.kt`, `WavTest.kt`

**Interfaces:**

```kotlin
enum class Heard { YES, NO }
data class Grammar(val phrases: List<String>, val missing: List<String>)
sealed interface SpokenCard {
    data class Message(val name: String, val text: String) : SpokenCard
    data class Call(val name: String, val how: String) : SpokenCard // "phone", "whatsapp", "whatsapp_video"
}
data class SpokenItem(val type: String, val say: String = "", val text: String = "", val code: String = "")
object VoiceWords {
    val YES: List<String>; val NO: List<String>
    const val SENT = "Sent."; const val NOT_SENT = "Okay, not sent."; const val NOT_NOW = "Okay, not now."
    const val NO_INTERNET = "I can't reach the internet right now."; const val DIDNT_SEND = "I didn't send it."; const val DIDNT_CALL = "I didn't call."
    const val ANSWER_MS = 8_000L; const val UNLOCK_WAIT_MS = 60_000L; const val MAX_FOLLOW_UPS = 2; const val SPOKEN_MAX = 240
    fun words(text: String, verb: String): Heard?      // heardWords
    fun heard(text: String, verb: String): Heard        // heardAnswer
    fun grammar(verb: String, known: Set<String>?): Grammar
    fun question(card: SpokenCard): String
    fun spoken(items: List<SpokenItem>): List<String>
    fun asksBack(line: String): Boolean
    fun unlockLine(device: String, kind: String, name: String): String
    fun calling(name: String): String
}
// voice/SpeechEnd.kt: a port of src/renderer/panel/voice-timing.js createVoiceTiming, with its numbers as options.
enum class End { LISTEN, DONE, NOTHING, TOO_LONG }
class SpeechEnd(quietMs: Long = 1_500, nothingMs: Long = 8_000, maxMs: Long = 60_000) {
    val heardVoice: Boolean
    fun feed(level: Float, ms: Long): End
    companion object { const val SPEECH_LEVEL = 0.06f; const val MIN_SPEECH_MS = 300L; const val LEVEL_SPAN_MS = 250L }
}
// voice/Pcm.kt
interface PcmSource { fun start(): Boolean; fun read(into: ShortArray): Int; fun stop() } // 16 kHz mono PCM16
class AudioRecordSource : PcmSource // AudioRecord, MediaRecorder.AudioSource.VOICE_RECOGNITION; start() false when it cannot record
fun levelOf(pcm: ShortArray, n: Int): Float // RMS, 0 to 1
object Wav { const val RATE = 16_000; fun of(pcm: ShortArray, n: Int = pcm.size): ByteArray } // a 44-byte RIFF header + the samples
/** The last `maxSamples` samples read; `from(sample)` counts samples since the first one ever added. */
class PcmKeeper(private val maxSamples: Int) { fun add(pcm: ShortArray, n: Int); val size: Int; fun all(): ShortArray; fun from(sample: Long): ShortArray }
```

- [ ] **Step 1: Write the failing tests.** `VoiceWordsTest` reads `src/test/resources/voice-cases.json` as
  `PickLinesTest` reads `line-cases.json`, and checks every case: `words`/`heard` (JSON `"yes"`/`"no"`/`null` ↔
  `Heard.YES`/`Heard.NO`/`null`), `grammar` (with `known` null or a set), `question` (`card.kind` picks
  `SpokenCard.Message`/`SpokenCard.Call`), `spoken` (items → `SpokenItem`), `asksBack`, `unlockLine`.
  `SpeechEndTest` mirrors `test/voice-timing.test.js` for the defaults, and adds:

```kotlin
@Test fun theQuietAndTheLongestAreOptions() {
    val end = SpeechEnd(quietMs = 1_200, nothingMs = 8_000, maxMs = 20_000)
    var ms = 0L
    while (ms < 1_000) { assertEquals(End.LISTEN, end.feed(0.2f, ms)); ms += 100 }
    assertEquals(End.LISTEN, end.feed(0.0f, 2_100))
    assertEquals(End.DONE, end.feed(0.0f, 2_200)) // 1.2 s after the last voice at 1 000
}
@Test fun nothingSaidEndsAtNothingMs() {
    val end = SpeechEnd(nothingMs = 8_000)
    assertEquals(End.LISTEN, end.feed(0f, 7_900))
    assertEquals(End.NOTHING, end.feed(0f, 8_000))
    assertFalse(end.heardVoice)
}
```

  `WavTest`:

```kotlin
@Test fun aWavIsTheRiffHeaderThenTheSamplesLittleEndian() {
    val wav = Wav.of(shortArrayOf(1, -2, 300))
    assertEquals(44 + 6, wav.size)
    assertEquals("RIFF", String(wav, 0, 4)); assertEquals("WAVE", String(wav, 8, 4)); assertEquals("data", String(wav, 36, 4))
    val b = java.nio.ByteBuffer.wrap(wav).order(java.nio.ByteOrder.LITTLE_ENDIAN)
    assertEquals(36 + 6, b.getInt(4)); assertEquals(1, b.getShort(22).toInt()); assertEquals(16_000, b.getInt(24))
    assertEquals(16, b.getShort(34).toInt()); assertEquals(6, b.getInt(40))
    assertEquals(1, b.getShort(44).toInt()); assertEquals(-2, b.getShort(46).toInt()); assertEquals(300, b.getShort(48).toInt())
}
@Test fun theLevelIsTheRmsOfTheSamples() {
    assertEquals(0f, levelOf(ShortArray(10), 10), 0f)
    assertEquals(0.5f, levelOf(ShortArray(10) { 16384 }, 10), 0.001f)
}
@Test fun theKeeperKeepsTheLastSamplesAndCountsFromTheFirst() {
    val k = PcmKeeper(4)
    k.add(shortArrayOf(1, 2, 3), 3); k.add(shortArrayOf(4, 5, 9), 2)
    assertArrayEquals(shortArrayOf(2, 3, 4, 5), k.all())
    assertArrayEquals(shortArrayOf(4, 5), k.from(3)) // from the 4th sample ever added
    assertArrayEquals(shortArrayOf(2, 3, 4, 5), k.from(0)) // what is gone is gone
}
```

- [ ] **Step 2: Run, see them fail** (`--tests '*VoiceWordsTest*' --tests '*SpeechEndTest*' --tests '*WavTest*'`).
- [ ] **Step 3: Implement** the three files as straight ports of `shared/voice-words.js` and `createVoiceTiming`
  (same constants, same order of checks; the emoji prefix as `Regex("^(✅|📞|📹)\\s*")`; `SAME` as a `mapOf`).
  `AudioRecordSource.start()` builds `AudioRecord(VOICE_RECOGNITION, 16000, CHANNEL_IN_MONO, ENCODING_PCM_16BIT,
  max(minBuffer, 3200 * 2))`, returns false on `SecurityException`/`IllegalStateException` or a state that is not
  `STATE_INITIALIZED`, and also turns on `NoiseSuppressor`/`AcousticEchoCanceler` when `isAvailable()`.
- [ ] **Step 4: Run the tests:** PASS.
- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/akshatgg/buddy/voice android/app/src/test/java/com/akshatgg/buddy/voice
git commit -m "feat(android): the voice words, the end of speech and WAV, as the shared rules say"
```

---

### Task A4: Android downloads the model, checks it and unpacks it

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/voice/VoiceModel.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/core/Shared.kt` (read `voiceModel`), `AppGraph.kt` (`voiceModel`)
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/VoiceModelTest.kt`

**Interfaces:**

```kotlin
data class ModelSpec(val name: String, val url: String, val sha256: String, val bytes: Long, val words: String) // Shared.voiceModel (the zip)
sealed interface ModelState { data object Missing : ModelState; data class Getting(val percent: Int) : ModelState; data object Ready : ModelState; data object Failed : ModelState }
class VoiceModel(
    private val root: File,                                       // filesDir/voice-model
    private val spec: ModelSpec,
    private val download: suspend (String, File, (Long) -> Unit) -> Unit, // ApkInstaller::download
    private val scope: CoroutineScope,
) {
    val state: StateFlow<ModelState>
    fun ready(): Boolean            // the folder is there and its "ok" file holds spec.sha256
    fun folder(): File              // root/<name>
    fun words(): Set<String>?       // the words list's first column, read once; null when not ready
    suspend fun fetch()             // download to root/<name>.zip.part, SHA-256, unzip to root/<name>.new, rename, write ok; throws BuddyError("model_failed", …)
    fun fetchInBackground()         // fetch() in scope, once at a time; a failure is logged and the state says Failed
}
```

- [ ] **Step 1: Write the failing tests** with a temp folder and a fake `download` that writes a small zip made in
  the test (`ZipOutputStream` with `<name>/am/final.mdl` and `<name>/graph/words.txt` = `"<eps> 0\nhaan 1\nyes 2\n"`),
  and `spec.sha256` set to that zip's real SHA-256:
  - `fetchUnpacksTheModelAndReadsItsWords`: after `fetch()`, `ready()` is true, `words()` is `setOf("<eps>", "haan", "yes")`
    minus `<eps>` (drop entries starting with `<` or `#`), and no `.part`/`.new` is left.
  - `aDownloadWithAnotherSha256IsThrownAwayAndNothingIsReady`: a fake that writes other bytes → `fetch()` throws
    `BuddyError` with code `model_failed`, `ready()` false, root has no `.zip.part`, state `Failed`.
  - `aZipWhoseEntryLeavesTheFolderIsRefused`: an entry `../evil` → `model_failed`, nothing written outside root.
  - `fetchInBackgroundRunsOnceAtATime`: two calls while the first fake download waits on a `CompletableDeferred` → one
    download.
  - `progressIsAPercentOfTheBytes`: the fake calls `progress(bytes / 2)` → state `Getting(50)`.
- [ ] **Step 2: Run, see them fail.**
- [ ] **Step 3: Implement.** SHA-256 with `MessageDigest` over the `.part` file; unzip with `ZipInputStream`, each
  entry's canonical path must start with `root/<name>.new/`; rename `.new` to `<name>` only after every entry is out;
  `ok` written last. In `Shared.kt`: `val voiceModel: ModelSpec` from `root["voiceModel"]` (`zip.url`, `zip.sha256`,
  `zip.bytes`, `name`, `words`). In `AppGraph`:

```kotlin
/** Buddy's ears (voice/VoiceModel.kt): the Vosk model, downloaded from Buddy's release the first time it is needed. */
val voiceModel: VoiceModel by lazy { VoiceModel(File(appContext.filesDir, "voice-model"), shared.voiceModel, ApkInstaller::download, scope) }
```

- [ ] **Step 4: Run the tests:** PASS.
- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/akshatgg/buddy/voice/VoiceModel.kt android/app/src/main/java/com/akshatgg/buddy/core/Shared.kt android/app/src/main/java/com/akshatgg/buddy/AppGraph.kt android/app/src/test/java/com/akshatgg/buddy/voice/VoiceModelTest.kt
git commit -m "feat(android): Buddy's ears download once, checked by their SHA-256, unpacked safely"
```

---

### Task A5: Android's ears, voice and lock: Vosk, TextToSpeech, the unlock wait

**Files:**
- Modify: `android/app/build.gradle.kts` (dependencies)
- Create: `android/app/src/main/java/com/akshatgg/buddy/voice/Spotter.kt`, `voice/Ears.kt`, `voice/Speaker.kt`,
  `voice/TalkBack.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/EarsTest.kt`, `VoskSaidTest.kt`, `PhoneTalkBackTest.kt`

**Interfaces:**

```kotlin
// Spotter.kt
data class VoskWord(val word: String, val conf: Float, val start: Float, val end: Float)
data class VoskSaid(val text: String, val words: List<VoskWord>)
fun parseVosk(json: String): VoskSaid // {"text": …, "result": [{word, conf, start, end}]} or {"partial": …}; bad JSON → VoskSaid("", [])
interface Spotter { fun accept(pcm: ShortArray, n: Int): String? /* a final result's JSON, or null */; fun finish(): String; fun close() }
fun interface Spotters { fun make(grammar: List<String>): Spotter }
class VoskSpotters(private val model: VoiceModel) : Spotters // org.vosk.Model(folder) loaded once; Recognizer(model, 16000f, grammarJson).apply { setWords(true) }

// Ears.kt
/** One spoken answer: decided on a final result with a yes or no word, else at ANSWER_MS by finish(). */
class AnswerTurn(private val verb: String, private val needsServer: Boolean) {
    fun level(level: Float)                 // marks that a voice was heard
    fun result(text: String): Decision?     // a decisive final result
    fun timeUp(finalText: String): Decision // the deadline: decisive, else the recording for the server, else no
}
sealed interface Decision { data class Words(val text: String) : Decision; data object Recording : Decision }
class Ears(
    private val mic: () -> PcmSource,
    private val spotters: () -> Spotters?,          // null until the model is ready
    private val known: () -> Set<String>?,
    private val transcribe: suspend (ByteArray, String) -> String,
) {
    suspend fun hear(verb: String): Heard           // time is the samples read: 16 per ms
    suspend fun request(quietMs: Long = 1_500, nothingMs: Long = 8_000, maxMs: Long = 20_000): ByteArray? // a WAV, or null
}

// Speaker.kt
interface Speaker { suspend fun say(text: String); fun stop() }
class TtsSpeaker(context: Context) : Speaker // TextToSpeech made on first say; each say waits for onDone/onError (20 s at most); AudioAttributes USAGE_ASSISTANT

// TalkBack.kt
interface TalkBack {
    suspend fun say(text: String)
    suspend fun hear(verb: String): Heard  // starts 300 ms after say() returned; NO for anything unclear
    suspend fun listen(): String?           // one more request ("Priya Sharma"), written down; null for nothing
    fun stop()                              // speaking and listening end at once; a hear() then answers NO
    companion object { val SILENT: TalkBack }
}
interface Lock { fun locked(): Boolean; suspend fun unlocked(withinMs: Long): Boolean; companion object { val OPEN: Lock } }
class PhoneTalkBack(private val speaker: Speaker, private val ears: Ears, private val model: VoiceModel, private val transcribe: suspend (ByteArray, String) -> String) : TalkBack
class KeyguardLock(private val context: Context) : Lock // isKeyguardLocked; waits for ACTION_USER_PRESENT (RECEIVER_NOT_EXPORTED)
```

- [ ] **Step 1: Add the dependency** (versions to confirm at the time; see the table):

```kotlin
    // Buddy's ears: Vosk, offline speech recognition (Apache 2.0), and the JNA it calls its native code through.
    implementation("com.alphacephei:vosk-android:0.3.47@aar")
    implementation("net.java.dev.jna:jna:5.13.0@aar")
```

  Build the debug APK and note its size before and after in the PR (the native library comes for each of the three ABIs).

- [ ] **Step 2: Write the failing tests.**
  - `VoskSaidTest`: a final result with `result` words parses times and confidences; `{"partial":"hey"}` gives text
    `hey` and no words; `"not json"` gives empty.
  - `EarsTest`, with `FakeMic(chunks: List<Pair<Float /*level*/, Int /*samples*/>>)` (fills each read with a constant
    sample of that level) and `FakeSpotter(results: Map<Int /*chunk*/, String /*final JSON*/>, final: String)`:

```kotlin
@Test fun aYesOnTheDeviceIsYesAndNothingGoesToTheServer() = runTest {
    val ears = ears(mic = speech(chunks = 20), spotter = FakeSpotter(mapOf(8 to said("haan")), final = said("")))
    assertEquals(Heard.YES, ears.hear("send"))
    assertEquals(emptyList<String>(), sentToServer)
}
@Test fun nothingDecisiveIn8SecondsIsNo() = runTest {
    val ears = ears(mic = silence(chunks = 100), spotter = FakeSpotter(emptyMap(), final = said("[unk]")))
    assertEquals(Heard.NO, ears.hear("call"))
    assertEquals(80, mic.reads) // 8 s of 100 ms reads, then it stops
    assertTrue(mic.stopped)
}
@Test fun aNoWinsOverAYesInOneAnswer() = runTest { /* final "yes no" → NO */ }
@Test fun withoutTheModelTheAnswerIsWrittenDownByTheServer() = runTest {
    val ears = ears(mic = speechThenQuiet(speechChunks = 6, quietChunks = 20), spotters = null, server = "Haan, bhej do.")
    assertEquals(Heard.YES, ears.hear("send"))
    assertEquals(listOf("audio/wav"), sentToServer)
}
@Test fun withoutTheModelNothingSaidSendsNothing() = runTest { /* silence → NO, nothing to the server */ }
@Test fun aWordTheModelLacksIsAskedOfTheServerOnlyWhenSomethingWasSaid() = runTest {
    // known lacks "haan": the grammar drops it, the spotter only hears [unk], the person spoke: the server hears it
}
@Test fun aServerFailureIsNo() = runTest { /* transcribe throws BuddyError("network") → NO */ }
@Test fun aMicThatCannotStartIsNo() = runTest { /* start() false → NO, no read */ }
@Test fun requestRecordsUntilQuietAndGivesAWav() = runTest {
    val wav = ears(mic = speechThenQuiet(speechChunks = 10, quietChunks = 30)).request(quietMs = 1_200)
    assertEquals("RIFF", String(wav!!, 0, 4))
    assertEquals(44 + (10 + 12) * 1_600 * 2, wav.size) // up to 1.2 s after the last voice
}
@Test fun requestWithNothingSaidIsNull() = runTest { /* 8 s of silence → null */ }
```

  - `PhoneTalkBackTest` with a `FakeSpeaker` (logs, can block) and fake ears: `hear` starts the model download in the
    background when it is missing (`model.fetchInBackground` called once); `stop()` while `hear` waits answers `NO`
    and stops the speaker; `listen()` gives the written words, `null` for "" or an error.
- [ ] **Step 3: Implement.** `Ears.hear`:

```kotlin
suspend fun hear(verb: String): Heard = withContext(Dispatchers.IO) {
    val maker = spotters()
    val grammar = VoiceWords.grammar(verb, if (maker != null) known() else null)
    val turn = AnswerTurn(verb, needsServer = maker == null || grammar.missing.isNotEmpty())
    val spotter = maker?.make(grammar.phrases)
    val source = mic()
    if (!source.start()) return@withContext Heard.NO.also { spotter?.close() }
    val chunk = ShortArray(1_600) // 100 ms
    val kept = PcmKeeper(10 * Wav.RATE) // what was said, for the server when it must hear it (at most 10 s)
    var samples = 0L
    try {
        var decision: Decision? = null
        while (decision == null && isActive) {
            val n = source.read(chunk)
            if (n <= 0) break
            samples += n
            kept.add(chunk, n)
            turn.level(levelOf(chunk, n))
            decision = spotter?.accept(chunk, n)?.let { turn.result(parseVosk(it).text) }
            if (decision == null && samples >= VoiceWords.ANSWER_MS * 16) decision = turn.timeUp(spotter?.let { parseVosk(it.finish()).text } ?: "")
        }
        when (val d = decision ?: turn.timeUp("")) {
            is Decision.Words -> VoiceWords.heard(d.text, verb)
            Decision.Recording -> try { VoiceWords.heard(transcribe(Wav.of(kept.all()), "audio/wav"), verb) } catch (e: CancellationException) { throw e } catch (e: Exception) { Heard.NO }
        }
    } finally {
        source.stop()
        spotter?.close()
    }
}
```

  Without a spotter, `AnswerTurn.result` is never called and `timeUp("")` at 8 s gives `Recording` when a voice was
  heard (else `Words("")` → NO); add one more rule there: without a spotter the loop also ends early once
  `SpeechEnd(quietMs = 1_500, nothingMs = 8_000, maxMs = 10_000)` says `DONE`, so that a quick "haan" does not wait
  8 s. `request()` is the same loop with `SpeechEnd(quietMs, nothingMs, maxMs)` alone, and returns `Wav.of(...)` of
  what was read up to its end, or null when `!heardVoice`. `PhoneTalkBack.hear` = `delay(300)`, then
  `if (!model.ready()) model.fetchInBackground()`, then `ears.hear(verb)`, all inside a `Job` that `stop()` cancels
  (answering `NO`). `TtsSpeaker` and `KeyguardLock` are thin (no test).
- [ ] **Step 4: Run the tests:** PASS. Build the debug APK: PASS.
- [ ] **Step 5: Commit**

```bash
git add android/app/build.gradle.kts android/app/src/main/java/com/akshatgg/buddy/voice android/app/src/test/java/com/akshatgg/buddy/voice
git commit -m "feat(android): Buddy speaks, hears yes or no on the phone, and waits for an unlock"
```

---

### Task A6: Android's chat answers out loud, and a spoken yes presses the card

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/ui/panel/PanelModelTest.kt`

**Interfaces (PanelModel):**
- New constructor parameters, last: `talkBack: TalkBack = TalkBack.SILENT`, `lock: Lock = Lock.OPEN`.
- `Chat` gains `var spoken = false`, `var asking: Int? = null`, `var followUps = 0`.
- `fun voiceWords(text: String)`: with nothing typed and no answer on its way, the words go at once as a **spoken**
  message; else (as today) into the box after what is there.
- `fun sendSpoken(text: String)`: a message said out loud (the 🎤 with an empty box, a follow-up, or in Part B the wake
  word). Same checks as `send()`.
- `fun press(id: Int, button: ChatButton)` is unchanged for the person's own presses, and also ends any spoken
  question (`asking = null`, `talkBack.stop()`). A spoken yes or no goes through a private `pressSpoken(c, id, button)`
  that runs the same branch.

- [ ] **Step 1: Write the failing tests** (in `PanelModelTest`, with these fakes):

```kotlin
/** Buddy's voice, as the panel uses it: what it said, and the answers it hears, in order. */
private class FakeTalkBack(val log: MutableList<String>) : TalkBack {
    val answers = ArrayDeque<Heard>()
    val requests = ArrayDeque<String?>()
    var hearing: CompletableDeferred<Heard>? = null // a hear() that waits until this is completed
    override suspend fun say(text: String) { log += "say $text" }
    override suspend fun hear(verb: String): Heard { log += "hear $verb"; return hearing?.await() ?: answers.removeFirstOrNull() ?: Heard.NO }
    override suspend fun listen(): String? { log += "listen"; return requests.removeFirstOrNull() }
    override fun stop() { log += "stop"; hearing?.complete(Heard.NO) }
}
private class FakeLock(var isLocked: Boolean = false, var unlocks: Boolean = true) : Lock {
    override fun locked() = isLocked
    override suspend fun unlocked(withinMs: Long) = unlocks.also { if (it) isLocked = false }
}
```

  (Add `private val talk = FakeTalkBack(log)` and `private val lock = FakeLock()` next to the other fakes, and
  `talkBack = talk, lock = lock` to `model(...)`; `message(...)` and `priya` are the existing helpers at :778.) Tests:

```kotlin
@Test fun aSpokenMessageAsksOutLoudAndAYesSendsItOnce() = runTest {
    answers(message(to = "Priya", text = "I'm running late"))
    messaging.found += Found.One(priya)
    talk.answers += Heard.YES
    val m = model()
    m.sendSpoken("message Priya on WhatsApp I'm running late")
    advanceUntilIdle()
    assertEquals(listOf("find Priya", "say To Priya Sharma: I'm running late. Send it?", "hear send", "aside",
        "send Priya Sharma: I'm running late", "say Sent."), log)
    assertEquals(ChatEvent(2, "✅ Sent to Priya Sharma"), m.last())
}
@Test fun aSpokenNoSendsNothingAndSaysSo() = runTest { /* Heard.NO → ChatEvent "Okay, not sent.", "say Okay, not sent.", no "send" in log */ }
@Test fun nothingHeardIsNo() = runTest { /* no answers queued → the same as no */ }
@Test fun aTypedMessageNeverSpeaks() = runTest { /* m.say("message priya …") → no "say"/"hear" in log; the card waits for its button */ }
@Test fun pressingSendWhileBuddyAsksSendsOnceAndALateYesIsDropped() = runTest {
    talk.hearing = CompletableDeferred()
    // … card shown, "hear send" in log
    m.press(2, ChatButton.SEND_MESSAGE)
    talk.hearing!!.complete(Heard.YES) // too late: the press already ended the question
    advanceUntilIdle()
    assertEquals(1, log.count { it.startsWith("send ") })
    assertTrue("stop" in log)
}
@Test fun aNewMessageWhileBuddyAsksEndsTheQuestionAndTheCardStays() = runTest { /* sendSpoken again → "stop"; first card keeps its buttons; the late yes sends nothing */ }
@Test fun aSpokenCallAsksCallNameAndAYesCallsOnce() = runTest {
    answers(calling()); phone.found += CallFound.One(princeSharma); talk.answers += Heard.YES
    val m = model(); m.sendSpoken("call Prince"); advanceUntilIdle()
    assertEquals(listOf("find phone Prince", "say Call Prince Sharma?", "hear call", "call Prince Sharma", "say Calling Prince Sharma."), log)
}
@Test fun aSpokenWhatsAppVideoCallAsksItsOwnQuestion() = runTest { /* "say WhatsApp video call Prince Sharma?" */ }
@Test fun lockedBuddyAsksToUnlockThenSends() = runTest {
    lock.isLocked = true
    // yes → "say Unlock your phone and I'll send it to Priya Sharma." then the send, then "say Sent."
}
@Test fun lockedForAMinuteBuddyGivesUpAndTheCardGoes() = runTest {
    lock.isLocked = true; lock.unlocks = false
    // yes → unlock line, no "send", ChatEvent(2, "I didn't send it."), "say I didn't send it."; press Send afterwards does nothing
}
@Test fun aLockedCallSaysItsOwnLines() = runTest { /* "Unlock your phone and I'll call Prince Sharma." / "I didn't call." */ }
@Test fun aWhichQuestionIsAnsweredByVoiceAndTheMessageGoesOn() = runTest {
    answers(message(to = "Priya", text = "hi"), message(to = "Priya Sharma", text = "hi"))
    messaging.found += Found.Say("Which Priya: Priya Sharma or Priya Verma? Tell me the full name.")
    messaging.found += Found.One(priya)
    talk.requests += "Priya Sharma"; talk.answers += Heard.YES
    val m = model(); m.sendSpoken("message Priya hi"); advanceUntilIdle()
    assertEquals(YouSaid(3, "Priya Sharma"), m.state.value.chat.filterIsInstance<YouSaid>().last())
    assertEquals(1, log.count { it.startsWith("send ") })
}
@Test fun followUpsStopAfterTwo() = runTest { /* three "Which" lines in a row: "listen" twice only */ }
@Test fun noInternetIsSaidAsTheSpecSays() = runTest { /* ask throws BuddyError("network", …) → "say I can't reach the internet right now." */ }
@Test fun otherAnswersSayTheirSayOnly() = runTest { /* a write with say "Here you go!" → "say Here you go!"; text not spoken */ }
@Test fun voiceWordsWithAnEmptyBoxGoAtOnceAndWithTypedTextJoinTheBox() = runTest {
    val m = model(); m.voiceWords("hello"); advanceUntilIdle()
    assertEquals(YouSaid(2, "hello"), m.state.value.chat[1])
    m.setDraft("Dear"); m.voiceWords("Sir"); assertEquals("Dear Sir", m.state.value.draft)
}
@Test fun closingThePanelStopsTheQuestion() = runTest { /* close() → "stop"; the late yes sends nothing */ }
```

- [ ] **Step 2: Run, see them fail** (`--tests '*PanelModelTest*'`).
- [ ] **Step 3: Implement.** In `PanelModel`:

```kotlin
    fun send() = sendText(draft, spoken = false, followUp = false)

    /** A message said out loud: Buddy answers out loud too, and asks a card's question (the voice design §2). */
    fun sendSpoken(text: String) = sendText(text, spoken = true, followUp = false)

    private fun sendText(raw: String, spoken: Boolean, followUp: Boolean) {
        if (busy) return
        val c = chat
        hush(c)
        // … the body of today's send(), with `text` from `raw` (the draft is only emptied when it was the draft) …
        c.spoken = spoken
        c.followUps = if (followUp) c.followUps + 1 else 0
        val you = add(c) { YouSaid(it, text) }
        talk(c, you.id)
    }

    /** Words said into the 🎤: with nothing typed (and nothing on its way) they go at once, as a spoken message. */
    fun voiceWords(text: String) {
        val words = text.trim()
        if (words.isEmpty()) return
        val typed = draft.trimEnd()
        if (typed.isEmpty() && !busy) return sendSpoken(words)
        setDraft(if (typed.isEmpty()) words else "$typed $words")
    }

    /** Any question Buddy is asking out loud ends: nothing it hears afterwards counts. */
    private fun hush(c: Chat) {
        if (c.asking != null) talkBack.stop()
        c.asking = null
    }
```

  In `talk`, after the `try/catch/finally` inside `scope.launch` (still in the launched block):

```kotlin
            // Out loud, for a spoken message: what the answer added, then a card's question.
            if (c.spoken && c === chat) speakAnswer(c, youId)
```

  and the new functions:

```kotlin
    private suspend fun speakAnswer(c: Chat, youId: Int) {
        val added = c.items.dropWhile { it.id != youId }.drop(1)
        val card = added.lastOrNull { it.id in c.messages || it.id in c.calls }
        val lines = VoiceWords.spoken(added.filter { it.id != card?.id }.map(::spokenItem))
        for (line in lines) {
            talkBack.say(line)
            if (c !== chat) return
        }
        if (card != null) return askAloud(c, card.id)
        val last = lines.lastOrNull() ?: return
        if (!VoiceWords.asksBack(last) || c.followUps >= VoiceWords.MAX_FOLLOW_UPS) return
        val words = talkBack.listen() ?: return
        if (c === chat && !busy) sendText(words, spoken = true, followUp = true)
    }

    private fun spokenItem(item: ChatItem) = when (item) {
        is BuddySaid -> SpokenItem("buddy", item.say, item.text)
        is ChatEvent -> SpokenItem("event", text = item.text)
        is ChatError -> SpokenItem("error", text = item.text, code = item.code)
        is YouSaid -> SpokenItem("you", text = item.text)
    }

    /**
     * "To Priya Sharma: … Send it?" or "Call Prince Sharma?" out loud, then the answer: a yes presses the card's own
     * button, once, and only while this card's question is the one being asked; anything else is Not now.
     */
    private suspend fun askAloud(c: Chat, id: Int) {
        val call = c.calls[id]
        val question = when (call) {
            is CallCard.Phone -> VoiceWords.question(SpokenCard.Call(call.callee.name, "phone"))
            is CallCard.WhatsApp -> VoiceWords.question(SpokenCard.Call(call.person.name, if (call.video) "whatsapp_video" else "whatsapp"))
            null -> c.messages[id]?.let { (person, text) -> VoiceWords.question(SpokenCard.Message(person.name, text)) } ?: return
        }
        val verb = if (call != null) "call" else "send"
        c.asking = id
        talkBack.say(question)
        if (c.asking != id || c !== chat) return
        mood(Mood.THINKING) // listening: Android's head has no listening face
        val heard = talkBack.hear(verb)
        if (c.asking != id || c !== chat) return
        c.asking = null
        mood(Mood.IDLE)
        val yes = if (verb == "call") ChatButton.CALL else ChatButton.SEND_MESSAGE
        pressSpoken(c, id, if (heard == Heard.YES) yes else ChatButton.NOT_NOW)
    }
```

  `press(id, button)` becomes `hush(chat)` then `pressOn(chat, id, button, spoken = false)`; `pressSpoken(c, id, b)`
  calls `pressOn(c, id, b, spoken = true)`; `pressOn` is today's body of `press` with, in the `NOT_NOW` branch,
  `if (spoken) scope.launch { talkBack.say(line) }` after the card changes. In `sendMessage`, before
  `hands.stepAside()`: `if (!unlockedFor(c, id, "message", person.name)) return`; after `Sent.Done`:
  `if (c.spoken) talkBack.say(VoiceWords.SENT)`; after every other outcome: `if (c.spoken) talkBack.say(<its line>)`.
  In `placeCall`, before the step aside: `if (!unlockedFor(c, id, "call", nameOf(first))) return`; after
  `Called.Done`: `if (c.spoken) talkBack.say(VoiceWords.calling(nameOf(card)))`; the other outcomes say their lines. (`nameOf(card)`: a small private function, the callee's name for
  `CallCard.Phone`, the person's for `CallCard.WhatsApp`; `calledLine` can use it too.)

```kotlin
    /**
     * A locked phone: Buddy asks for the unlock and waits a minute (the spec's locked rule, for calls too). Still
     * locked: the card goes, and says so. True when it may go on.
     */
    private suspend fun unlockedFor(c: Chat, id: Int, kind: String, name: String): Boolean {
        if (!lock.locked()) return true
        val ask = VoiceWords.unlockLine("phone", kind, name)
        say(ask)
        if (c.spoken) talkBack.say(ask)
        if (lock.unlocked(VoiceWords.UNLOCK_WAIT_MS)) return true
        c.messages.remove(id)
        c.calls.remove(id)
        val gave = if (kind == "call") VoiceWords.DIDNT_CALL else VoiceWords.DIDNT_SEND
        replaceItem(c, ChatEvent(id, gave))
        publish()
        if (c.spoken) talkBack.say(gave)
        return false
    }
```

  `close()` and `newChat()` call `hush(chat)` first. `fail()` is unchanged: its red line is spoken by `speakAnswer`
  (`spokenLines` turns `network`/`timeout` into the internet line).
- [ ] **Step 4: Run the tests:** every `PanelModelTest` PASS (the old ones too: a typed chat is unchanged).
- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt android/app/src/test/java/com/akshatgg/buddy/ui/panel/PanelModelTest.kt
git commit -m "feat(android): a spoken message is answered out loud, and a spoken yes presses Send or Call, once"
```

---

### Task A7: Android wires the voice into the panel

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/AppGraph.kt`, `ui/panel/ChatHost.kt` (ChatViewModel),
  `voice/MicButton.kt` (doc comment only), `ui/panel/PanelActivity.kt` (comment at :78)

- [ ] **Step 1: AppGraph** gets the shared parts (one speaker and one set of ears for the process):

```kotlin
    /** Buddy's voice and ears for a spoken chat (voice/TalkBack.kt): TextToSpeech, and yes or no on the phone. */
    val talkBack: TalkBack by lazy {
        val ears = Ears(
            mic = { AudioRecordSource() },
            spotters = { if (voiceModel.ready()) VoskSpotters(voiceModel) else null },
            known = voiceModel::words,
            transcribe = { audio, mime -> cloud.transcribe(audio, mime) },
        )
        PhoneTalkBack(TtsSpeaker(appContext), ears, voiceModel) { audio, mime -> cloud.transcribe(audio, mime) }
    }
    val lock: Lock by lazy { KeyguardLock(appContext) }
```

- [ ] **Step 2: ChatViewModel** passes `talkBack = graph.talkBack, lock = graph.lock` to `PanelModel`.
- [ ] **Step 3: Build and run every Android test:** PASS (`:app:assembleDebug -x checkCloudProperties`, then
  `:app:testDebugUnitTest`).
- [ ] **Step 4: Commit**

```bash
git add android/app/src/main/java/com/akshatgg/buddy
git commit -m "feat(android): the panel's 🎤 starts a spoken chat: Buddy answers and asks out loud"
```

---

### Task A8: The Mac's ear window (spike first): speak, hear yes or no, record one more request

**Files:**
- Modify: `package.json` (`"vosk-browser": "0.0.8"` in `dependencies`), `package-lock.json`,
  `electron-builder.config.js` (keep `node_modules/vosk-browser/dist/vosk.js` only), `src/main/panel-window.js`
  (`permissionRules` lets the ear page have the microphone), `src/renderer/panel/voice-timing.js` (options)
- Create: `src/main/ear-window.js`, `src/preload/ear.js`, `src/renderer/ear/index.html`, `src/renderer/ear/ear.js`,
  `src/renderer/ear/ear-core.js`, `src/renderer/ear/wav.js`, `src/main/voice-model.js`, `src/main/targz.js`,
  `src/main/lock.js`, `src/main/talk-back.js`
- Test: `test/ear-core.test.js`, `test/wav.test.js`, `test/voice-model.test.js`, `test/targz.test.js`,
  `test/lock.test.js`, `test/talk-back.test.js`, `test/ear-window.test.js`, `test/panel-window.test.js` (new cases),
  `test/voice-timing.test.js` (options)

**Interfaces:**
- `createVoiceTiming({ quietMs = 1500, nothingMs = 8000, maxMs = 60000 } = {})` (defaults unchanged).
- `src/renderer/ear/ear-core.js` (`EarCore`, DOM-free, like `VoiceTiming`; the page cannot load the CommonJS
  `shared/`, so the yes/no **meaning** stays in main and the page only tells whether an answer is decisive):
  `isDecisive(text, decisive: { yes: string[], no: string[] }) -> boolean` (the words folded as `wordsOf` folds them);
  `createAnswerTurn({ decisive, needsServer })` with `level(x)`, `result(text) -> { text } | null`, `timeUp(finalText) -> { text } | { audio: true }`; `toPcm16(float32)
  -> Int16Array`; `PcmKeeper(maxSamples)` with `add(int16)`, `all() -> Int16Array`, `from(sample) -> Int16Array`.
- `src/renderer/ear/wav.js` (`Wav`): `Wav.of(int16, rate = 16000) -> Uint8Array`, `Wav.base64(int16) -> string`.
- `src/main/voice-model.js`: `createVoiceModel({ dir, spec = VOICE_MODEL, fetchImpl = fetch })` →
  `{ ready(): boolean, bytes(): Promise<Buffer>, words(): Set<string> | null, ensure({ onProgress }): Promise<void>, state(): 'missing'|'getting'|'ready'|'failed', percent(): number }`.
- `src/main/targz.js`: `fileInTarGz(buffer, pathEnd) -> Buffer | null` (gunzip, then ustar headers).
- `src/main/lock.js`: `createLock({ powerMonitor, setTimer = setTimeout, clearTimer = clearTimeout })` →
  `{ locked(): boolean, unlocked(ms): Promise<boolean> }` (`getSystemIdleState(1) === 'locked'`; `'unlock-screen'`).
- `src/main/ear-window.js`: `createEarWindow({ BrowserWindow, ipcMain, idleMs = 120000 })` →
  `{ call(cmd, args): Promise<object>, stop(): void, keep(on: boolean): void, window(): BrowserWindow | null, close(): void }`.
  IPC: main → page `ear:do` `{ id, cmd, args }` and `ear:stop`; page → main `ear:done` `{ id, result }` (only from the
  ear page). Commands: `say { text }` → `{}`; `hear { verb, grammar: string[] | null, needsServer }` → `{ text }` or
  `{ audio }` (WAV base64); `listen { quietMs, nothingMs, maxMs }` → `{ audio }` or `{}`. The page asks main for the
  model with `ear:model` (invoke) → `{ bytes: ArrayBuffer }` or `{}`.
- `src/main/talk-back.js`: `createTalkBack({ ear, model, transcribe })` → `{ say(text), hear(verb): Promise<'yes'|'no'>, listen(): Promise<string|null>, stop() }`.

- [ ] **Step 1: Spike (the owner runs the last check).** On a scratch branch off `voice-hey` (never merged): an
  `ear/index.html` with `vosk.js`, a `KaldiRecognizer` with the grammar `["yes","no","[unk]"]`, `getUserMedia`, and
  `speechSynthesis.speak("Send it?")`, in a hidden `BrowserWindow` (`show: false`, `backgroundThrottling: false`). The
  model bytes reach the page as a `Blob` URL (`URL.createObjectURL(new Blob([bytes]))` handed to `Vosk.createModel`), so
  no custom protocol is needed. Find the smallest CSP that works; the expected one is:

```html
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src blob:; connect-src blob:; style-src 'self'">
```

  Confirm the API names in the table (`createModel`, `KaldiRecognizer`, `setWords`, `acceptWaveformFloat`,
  `retrieveFinalResult`, `result`/`partialresult`). **The agent writes the spike; the owner runs `npm start` on it and
  says "yes" and "no" into the Mac** (the microphone rule). Write what was found at the top of `ear.js` as a comment,
  then delete the scratch branch. If `vosk-browser` cannot run in Electron, stop and tell the owner: the fallback is the
  server for yes/no on the Mac (the plan's `needsServer` path, always), and Part B on the Mac waits.
- [ ] **Step 2: Write the failing tests.**
  - `test/ear-core.test.js`:

```js
const EarCore = require('../src/renderer/ear/ear-core');
const { YES_WORDS, NO_WORDS, heardWords } = require('../shared/voice-words');
const decisive = (verb) => ({ yes: [...YES_WORDS, verb], no: NO_WORDS });

test('isDecisive agrees with heardWords for every case Android is checked with', () => {
  const cases = require('../android/app/src/test/resources/voice-cases.json');
  for (const c of cases.heard) assert.strictEqual(EarCore.isDecisive(c.text, decisive(c.verb)), heardWords(c.text, c.verb) !== null, c.text);
});

test('an answer turn: a decisive final result decides; a no wins', () => {
  const turn = EarCore.createAnswerTurn({ decisive: decisive('send'), needsServer: false });
  assert.strictEqual(turn.result('[unk]'), null);
  assert.deepStrictEqual(turn.result('haan'), { text: 'haan' });
});
test('at the deadline: decisive, else the recording when the server must hear it and a voice was heard, else nothing', () => {
  const a = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: true });
  a.level(0.2);
  assert.deepStrictEqual(a.timeUp('[unk]'), { audio: true });
  const b = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: true });
  assert.deepStrictEqual(b.timeUp(''), { text: '' }, 'nothing said: nothing goes to the server');
  const c = EarCore.createAnswerTurn({ decisive: decisive('call'), needsServer: false });
  c.level(0.2);
  assert.deepStrictEqual(c.timeUp('[unk]'), { text: '[unk]' });
});
test('samples are kept up to a limit, newest last', () => {
  const k = new EarCore.PcmKeeper(4);
  k.add(Int16Array.from([1, 2, 3])); k.add(Int16Array.from([4, 5]));
  assert.deepStrictEqual([...k.all()], [2, 3, 4, 5]);
  assert.deepStrictEqual([...k.from(3)], [4, 5], 'from the 4th sample ever kept');
});
test('float samples become PCM16, clipped', () => {
  assert.deepStrictEqual([...EarCore.toPcm16(Float32Array.from([0, 0.5, -1, 2]))], [0, 16383, -32768, 32767]);
});
```

  - `test/wav.test.js`: the same header checks as Android's `WavTest`, on `Wav.of`.
  - `test/targz.test.js`: builds a `.tar.gz` in the test (a 512-byte ustar header written by a small helper, the file,
    padding, two empty blocks, `zlib.gzipSync`) and finds `m/graph/words.txt` by `fileInTarGz(buf, 'graph/words.txt')`;
    a missing path gives null; a truncated archive gives null.
  - `test/voice-model.test.js` (temp dir, fake `fetchImpl` answering a `Response` of a small tar.gz, `spec.sha256` its
    real hash): `ensure()` writes `<name>.tar.gz` and `words.txt`, `ready()` true, `words()` the set; another SHA →
    rejects with `code: 'model_failed'`, nothing ready, no `.part` left; two `ensure()` at once fetch once;
    `percent()` follows the bytes.
  - `test/lock.test.js` (fake `powerMonitor` as an `EventEmitter` with `getSystemIdleState`): unlocked → `unlocked(…)`
    resolves true at once; locked then `'unlock-screen'` → true; locked for the whole wait → false and the listener is
    removed; `getSystemIdleState` throwing → not locked.
  - `test/talk-back.test.js` (fake ear: `call(cmd, args)` logs and answers from a queue; fake model; fake
    `transcribe`): `hear('send')` with the model ready sends `hear` with the grammar from `answerGrammar('send',
    words)` and `needsServer` false when no word is missing, and `{ text: 'yes' }` → `'yes'`; `{ audio }` → transcribe
    with `'audio/wav'` → `heardAnswer`; transcribe failing → `'no'`; model missing → `model.ensure` started once,
    `grammar: null`, `needsServer: true`; `{ stopped: true }` → `'no'`; `listen()` → the trimmed words or null.
  - `test/ear-window.test.js` (fake `BrowserWindow` + `ipcMain` as in `test/notch-window.test.js`): `call` makes the
    window on first use and sends `ear:do`; `ear:done` from another page is ignored; a page that crashes resolves every
    call with `{ gone: true }`; `stop()` sends `ear:stop`; the window closes `idleMs` after the last call unless
    `keep(true)`.
  - `test/panel-window.test.js`: `permissionRules({ isPanel, isEar, page, earPage })` lets the ear page's main frame
    have audio only, and nothing else; other pages still none.
- [ ] **Step 3: Implement.**
  - `ear-core.js` mirrors Android's `AnswerTurn` (Task A5), with `isDecisive` in place of `heardWords` (main passes
    the word lists with `hear`, and decides yes or no itself in `talk-back.js`).
  - `ear.js`: one `AudioContext({ sampleRate: 16000 })`, a `MediaStreamSource` from `getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })`,
    a `ScriptProcessorNode(2048, 1, 1)`; each buffer → `level` (VoiceTiming's `levelOf`), `PcmKeeper`, and the
    recognizer's `acceptWaveformFloat` when one is open. `say` → `speechSynthesis.speak(new SpeechSynthesisUtterance(text))`,
    resolving on `end`/`error` (20 s at most). `hear` → opens the microphone only now, waits 300 ms, makes a
    `KaldiRecognizer(16000, JSON.stringify(grammar))` when `grammar` is given (the model loaded once per window via
    `ear:model`), and ends as `createAnswerTurn` says, at `ANSWER_MS` (`retrieveFinalResult()` first); without a
    grammar it also ends early on `createVoiceTiming({ quietMs: 1500, nothingMs: 8000, maxMs: 10000 })`'s `done`.
    `listen` records with `createVoiceTiming({ quietMs, nothingMs, maxMs })` and answers `{ audio: Wav.base64(kept) }`
    when a voice was heard. The microphone is let go of at the end of every command and on `ear:stop`.
  - `ear-window.js`: as `bubble-window.js` (a window remade after a crash), with `show: false`, `skipTaskbar: true`,
    `focusable: false`, `webPreferences: { preload: ear.js, sandbox: true, contextIsolation: true, backgroundThrottling: false }`.
  - `voice-model.js`: downloads `spec.tgz.url` to `<dir>/<name>.tar.gz.part`, hashes, renames, writes
    `words.txt` from `fileInTarGz(bytes, `${spec.words}`)` (first column, `<…>`/`#…` dropped), then `ok`.
  - `talk-back.js`:

```js
function createTalkBack({ ear, model, transcribe }) {
  const writtenDown = async (audio) => String(await transcribe(audio, 'audio/wav')).trim();
  return {
    say: (text) => ear.call('say', { text }).then(() => {}),
    async hear(verb) {
      if (!model.ready()) model.ensure().catch((err) => console.warn('[buddy] voice model:', err.code || err.message));
      const g = model.ready() ? answerGrammar(verb, model.words()) : null;
      const r = await ear.call('hear', { verb, grammar: g ? g.grammar : null, needsServer: !g || g.missing.length > 0, decisive: { yes: [...YES_WORDS, verb], no: NO_WORDS } });
      if (typeof r.text === 'string') return heardAnswer(r.text, verb);
      if (!r.audio) return 'no';
      try {
        return heardAnswer(await writtenDown(r.audio), verb);
      } catch {
        return 'no';
      }
    },
    async listen() {
      const r = await ear.call('listen', { quietMs: 1500, nothingMs: 8000, maxMs: 20000 });
      if (!r.audio) return null;
      try {
        return (await writtenDown(r.audio)) || null;
      } catch {
        return null;
      }
    },
    stop: () => ear.stop(),
  };
}
```

  - `panel-window.js`: `permissionRules` gains `isEar` and `earPage` (`src/renderer/ear/index.html`), and
    `createPanelWindow` takes `isEar` from main.js (the ear window's `webContents`).
- [ ] **Step 4: Run** `npm test`: PASS.
- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json electron-builder.config.js src test
git commit -m "feat(mac): Buddy's ear, a hidden window that speaks, hears yes or no on the Mac, and records one more request"
```

---

### Task A9: The Mac's chat answers out loud, and a spoken yes presses the card

**Files:**
- Modify: `src/main/actions.js`, `src/main/main.js` (wiring), `src/main/ipc/panel.js` (`panel:send` options),
  `src/preload/panel.js` (`send(message, options)`), `src/renderer/panel/panel.js` (`finishListening` sends spoken)
- Test: `test/actions.test.js`, `test/panel-ipc.test.js`

**Interfaces:**
- `createActions({ …, talkBack = null, lock = { locked: () => false, unlocked: async () => true } })`. `talkBack` is
  null on Windows (the spoken flow is Mac and Android only; Windows keeps its cards).
- `send(message, { spoken = false, followUp = false } = {})`; the chat gains `spoken`, `asking` (a card id or null),
  `followUps`.
- `act(id, button, { spoken = false } = {})`: a person's press (from IPC, always two arguments) ends any question
  (`hush`); a spoken yes or no comes with `{ spoken: true }`.
- `panel:send` takes `(message, options)` and passes `{ spoken: options?.spoken === true }` (never `followUp`).

- [ ] **Step 1: Write the failing tests** in `test/actions.test.js`. `setup` gets two options: `talk` (the fake's
  `{ answers, requests }`, or `null` for none) and `lock` (default `{ locked: () => false, unlocked: async () => true }`),
  and passes `talkBack: talk === null ? null : fakeTalkBack(log, talk || {})` and `lock` to `createActions`:

```js
// Buddy's voice, as actions.js uses it: what it says, and the answers it hears, in order.
function fakeTalkBack(log, { answers = [], requests = [] } = {}) {
  let waiting = null;
  return {
    async say(text) { log.push(['say', text]); },
    async hear(verb) {
      log.push(['hear', verb]);
      if (answers[0] === 'wait') { answers.shift(); return new Promise((resolve) => { waiting = resolve; }); }
      return answers.length ? answers.shift() : 'no';
    },
    async listen() { log.push(['listen']); return requests.length ? requests.shift() : null; },
    stop() { log.push(['stop']); if (waiting) waiting('no'); },
    answerLate(a) { if (waiting) waiting(a); },
  };
}
```

  Tests (each with `replies: { waFind: { chats: ['Priya Sharma'] }, waSend: { chat: 'Priya Sharma' } }` as in the
  message tests):

```js
test('a spoken message: the card is asked out loud, and a yes sends it once', async () => {
  const s = setup({ answers: [message({ text: "I'm running late" })], talk: { answers: ['yes'] }, replies: WA });
  await s.actions.open();
  await s.actions.send('message priya im running late', { spoken: true });
  await settle(); // the spoken part runs after send() answers
  assert.deepStrictEqual(entries(s.log, 'say').map((e) => e[1]), ["To Priya Sharma: I'm running late. Send it?", 'Sent.']);
  assert.deepStrictEqual(entries(s.log, 'hear'), [['hear', 'send']]);
  assert.strictEqual(waSends(s).length, 1);
  assert.strictEqual(chatOf(s).at(-1).text, '✅ Sent to Priya Sharma');
});
test('a spoken no, or nothing, sends nothing and says so', async () => { /* 'no' → 'Okay, not sent.' said and shown */ });
test('a typed message never speaks', async () => { /* send(text) → no 'say', no 'hear' */ });
test('Send pressed while Buddy asks: sent once, and the late yes does nothing', async () => {
  // talk answers ['wait']; act(card.id, 'send-message') → 'stop' logged; talkBack.answerLate('yes'); one waSend
});
test('a new message while Buddy asks ends the question; the first card stays', async () => {});
test('a spoken WhatsApp call: "WhatsApp call Prince Sharma?" and a yes calls once', async () => {
  // replies.waFind { chats: ['Prince Sharma'] }, waCall {} → says 'WhatsApp call Prince Sharma?', hears 'call', one waCall, says 'Calling Prince Sharma.'
});
test('a locked Mac: Buddy asks for the unlock, then sends', async () => {
  // lock { locked: () => true once, unlocked: async () => true } → says "Unlock your Mac and I'll send it." then waSend
});
test('locked for a minute: the card says it did not send, and nothing is sent', async () => {
  // unlocked → false → card event "I didn't send it.", said; waSend never; act(card, 'send-message') rejects
});
test('a "Which Priya?" line is answered by voice, and the message goes on', async () => {
  // waFind { chats: ['Priya Sharma', 'Priya Verma'] } then { chats: ['Priya Sharma'] }; talk.requests ['Priya Sharma'], answers ['yes']
});
test('no internet is said as the spec says', async () => {
  // ai throws BuddyError('network', …) → say "I can't reach the internet right now."
});
test('Windows has no talk-back: a spoken message shows the card as typed', async () => {
  // setup({ windows: true, talk: null }) → no say/hear; message elsewhere line as today
});
```

  With, at the top of the section: `const WA = { waFind: { chats: ['Priya Sharma'] }, waSend: { chat: 'Priya Sharma' } };`
  and `const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };`
  (the spoken part runs after `send()` answers; `s.settled()` above is `settle()`). In `test/panel-ipc.test.js`: `panel:send` passes
  `{ spoken: true }` through, and a page that sends `{ spoken: 'yes', followUp: true }` gets `{ spoken: false }`.
- [ ] **Step 2: Run, see them fail** (`node --test test/actions.test.js test/panel-ipc.test.js`).
- [ ] **Step 3: Implement** in `actions.js` (require `spokenQuestion, spokenLines, asksBack, unlockLine, callingLine,
  VOICE_LINES, UNLOCK_WAIT_MS, MAX_FOLLOW_UPS` from `../../shared/voice-words`):

```js
  /** Any question Buddy is asking out loud ends: nothing it hears afterwards counts. */
  function hush(c) {
    if (c.asking !== null && c.asking !== undefined) talkBack?.stop();
    c.asking = null;
  }

  /** Said out loud, only in a spoken chat. Never rejects: a voice that fails leaves the chat as it is. */
  function speak(c, text) {
    if (!c.spoken || !talkBack || !text) return Promise.resolve();
    return talkBack.say(text).catch((err) => console.warn('[buddy] could not speak:', err.message));
  }

  async function send(message, { spoken = false, followUp = false } = {}) {
    const c = chat;
    // … today's checks …
    hush(c);
    c.spoken = spoken && Boolean(talkBack);
    c.followUps = followUp ? (c.followUps || 0) + 1 : 0;
    const you = add(c, { type: 'you', text });
    await talk(c, you);
    // Out loud after the answer is shown; the page's send has its answer meanwhile.
    if (c.spoken && c === chat) speakAnswer(c, you).catch((err) => console.warn('[buddy] voice:', err.message));
    return {};
  }

  async function speakAnswer(c, you) {
    const added = c.items.slice(c.items.indexOf(you) + 1);
    const card = [...added].reverse().find((i) => (i.message || i.call) && i.buttons?.length);
    const lines = spokenLines(added.filter((i) => i !== card));
    for (const line of lines) {
      await speak(c, line);
      if (c !== chat) return;
    }
    if (card) return askAloud(c, card);
    const last = lines.at(-1);
    if (!last || !asksBack(last) || c.followUps >= MAX_FOLLOW_UPS) return;
    const words = await talkBack.listen();
    if (words && c === chat && !c.busy) await send(words, { spoken: true, followUp: true });
  }

  async function askAloud(c, card) {
    const verb = card.call ? 'call' : 'send';
    const question = card.call
      ? spokenQuestion({ kind: 'call', name: card.call.name, how: card.call.video ? 'whatsapp_video' : 'whatsapp' })
      : spokenQuestion({ kind: 'message', name: card.message.name, text: card.message.text });
    c.asking = card.id;
    await speak(c, question);
    if (c.asking !== card.id || c !== chat) return;
    ui.listening?.(true, 'ear'); // the buddy's listening face (feelings.js); 'ear': not the panel's own 🎤
    const heard = await talkBack.hear(verb);
    ui.listening?.(false, 'ear');
    if (c.asking !== card.id || c !== chat) return;
    c.asking = null;
    if (heard === 'yes') {
      await act(card.id, verb === 'call' ? 'call' : 'send-message', { spoken: true });
    } else {
      await act(card.id, 'not-now', { spoken: true });
      await speak(c, verb === 'call' ? VOICE_LINES.notNow : VOICE_LINES.notSent);
    }
  }

  /** A locked Mac: Buddy asks for the unlock and waits a minute; still locked, the card goes and says so. */
  async function unlockedFor(c, item, kind, name) {
    if (!lock.locked()) return true;
    const ask = unlockLine('Mac', kind, name);
    ui.bubble(ask);
    await speak(c, ask);
    if (await lock.unlocked(UNLOCK_WAIT_MS)) return true;
    const gave = kind === 'call' ? VOICE_LINES.didntCall : VOICE_LINES.didntSend;
    swap(c, item, { type: 'event', text: gave, buttons: [] });
    push(c);
    await speak(c, gave);
    return false;
  }
```

  `act(id, button, { spoken = false } = {})`: first line after finding `c`: `if (!spoken) hush(c);`. In
  `sendMessage`, first: `if (!(await unlockedFor(c, item, 'message', item.message.name))) return;`, and after the
  success swap: `await speak(c, VOICE_LINES.sent)`; in each catch branch: `await speak(c, <the line shown>)`. In
  `placeCall` the same with `'call'` and `callingLine(item.call.name)`. `dismiss()` and `replaceChat()` call
  `hush(chat)`.
  - `ipc/panel.js`: `handle('panel:send', (message, options) => actions.send(typeof message === 'string' ? message : '', { spoken: options?.spoken === true }))`.
  - `preload/panel.js`: `send: (message, options) => ipcRenderer.invoke('panel:send', message, options)`.
  - `panel.js`: `send({ spoken = false } = {})` passes `{ spoken }`; `finishListening` remembers whether the box was
    empty before the words went in (`const typed = …` is already there) and calls `send({ spoken: !typed })`.
  - `main.js`: makes `ear = createEarWindow({ BrowserWindow, ipcMain })`, `voiceModel = createVoiceModel({ dir:
    path.join(app.getPath('userData'), 'voice-model') })`, `lock = createLock({ powerMonitor })`, `talkBack =
    process.platform === 'darwin' ? createTalkBack({ ear, model: voiceModel, transcribe: (audio, mime) =>
    actions.transcribe(audio, mime).then((r) => r.text) }) : null`, passes `talkBack` and `lock` to `createActions`
    (the `transcribe` closure reads `actions` lazily), and `isEar` to `createPanelWindow`; `ipcMain.handle('ear:model')`
    answers the model's bytes to the ear page only.
- [ ] **Step 4: Run** `npm test`: PASS. Then (alone) `npm run test:e2e`: PASS (the e2e makes no spoken chat:
  `talkBack` comes from options there, `null`).
- [ ] **Step 5: Commit**

```bash
git add src test
git commit -m "feat(mac): a spoken message is answered out loud, and a spoken yes presses Send or Call, once"
```

---

### Task A10: Pin the safety rules in tests (no device)

**Files:** `test/voice-safety.test.js`, `android/app/src/test/java/com/akshatgg/buddy/ui/panel/VoiceSafetyTest.kt`

These pin the hard rules in one place, so that a later change cannot drop one quietly:

- [ ] **Step 1: Write them** (both sides, with the fakes of A6/A9):
  1. a yes heard for card A after card B was shown does nothing to A (B is asked, A stays as it is);
  2. a yes after the card was pressed, or after Not now, sends or calls nothing more;
  3. `hear` is never called before `say(question)` has returned (the fake `say` suspends; `hear` must not be logged
     until it resumes);
  4. a typed chat after a spoken one does not speak (the flag is per message);
  5. a second step's message (`MESSAGE_ASK`) is spoken as a line and never asked as a card;
  6. every `heardAnswer` case in `voice-cases.json` whose words include a no word is `no`.
- [ ] **Step 2: Run** `npm test` and the Android tests: PASS (they pass at once: they pin what A6/A9 built; if one
  fails, fix the code, not the test).
- [ ] **Step 3: Commit**

```bash
git add test/voice-safety.test.js android/app/src/test/java/com/akshatgg/buddy/ui/panel/VoiceSafetyTest.kt
git commit -m "test(voice): pin the rules: a spoken yes is once, for the card asked, and only after the question"
```

---

### Task A11: Check on the owner's devices

- [ ] **Step 1: Everything green.** `npm test`, then `npm run test:e2e` (one after the other), the Android unit tests
  and the Android debug build. All PASS. The model release (A2 Step 4) is published.
- [ ] **Step 2: Android by hand (the owner, with a test contact they choose).** Install the debug APK.
  1. **Before the model (first use):** panel 🎤, "message <test contact> on WhatsApp testing Buddy" → the card shows,
     Buddy says "To <full name>: testing Buddy. Send it?" → "yes" → sent, "Sent." said. The model starts downloading
     (Settings shows nothing yet in PR 2; check `filesDir/voice-model` via `adb shell run-as`).
  2. **With the model, in airplane mode after the request is answered:** "haan" → sent; "nahi" → "Okay, not sent.";
     8 s of silence → no; "yes no" → no.
  3. **Echo:** loud media volume, say nothing after "Send it?" → "Okay, not sent." (Buddy never hears itself.)
  4. **Calls:** "call <test contact>" → "Call <full name>?" → "yes" → it rings, "Calling <full name>." "WhatsApp call
     <test contact>" → "WhatsApp call <full name>?" → "no" → nothing.
  5. **Press while asked:** press Send while Buddy listens → one message only.
  6. **Locked:** after the question, press the power button and say "yes" → "Unlock your phone and I'll send it to
     <name>." → unlock within a minute → sent. Again, stay locked → "I didn't send it.", nothing sent.
  7. **"Which?":** a name with two contacts → "Which …? Tell me the full name." → say the full name → the card's
     question → "yes".
  8. Note: words reported missing by A2 (`haan`, …) heard through the server; the APK size added.
- [ ] **Step 3: Mac by hand (the owner).** `cd ~/projects/buddy-voice-hey && npm start`. The same 1–7 for WhatsApp
  messages and WhatsApp calls (no phone calls on the Mac), with the panel's 🎤; macOS asks for the microphone only for
  Buddy (no second prompt for the ear). Lock with ⌃⌘Q after the question for 6.
- [ ] **Step 4: Fix what the owner finds**, each with a test.

### Task A12: PR 2

- [ ] **Step 1:** Push `voice-hey` and open the PR to `master` with `gh pr create`. Title: "Buddy asks out loud and
  hears yes or no: messages and calls (Mac + Android)". The body: what it does, the model release and its SHA-256s, the
  APK size added, what the owner checked (A11), and the values still to confirm. **No attribution lines.**

---

# Part B — PR 3: "Hey <name>"

### Task B1: The wake phrase, in the shared words

**Files:**
- Modify: `shared/voice-words.js`, `test/voice-words.test.js`, `tools/sync-android-shared.js` (`wake` cases),
  `android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt`, `…/voice/VoiceWordsTest.kt`
- Regenerated: `android/app/src/test/resources/voice-cases.json`

**Interfaces (added to `shared/voice-words.js` and the Kotlin port):**
- `wakePhrase(name) -> string | null`: `"hey " +` the name lower case, accents gone, letters and spaces only, single
  spaces, at most 3 words; null when nothing is left.
- `wakeMissing(name, known: Set<string>) -> string[]`: the phrase's words (with `hey`) the model lacks.
- `wakeFrom(result, phrase, floor) -> { endSec: number, follows: boolean } | null`: `result` is Vosk's final result
  (`{ text, result: [{ word, conf, start, end }] }`). A wake only when the phrase's words are the **first** words of
  the result, in order, each with `conf >= floor`. `endSec` is the last phrase word's `end`; `follows` whether any
  word comes after it (the request was said in the same breath).
- `WAKE_FLOOR = 0.6`, `REQUEST = { quietMs: 1200, nothingMs: 8000, maxMs: 20000 }`.
- `WAKE_LINES = { cantListen: (name) => `Buddy can't listen for '${name}'. Try another spelling.`, notCaught: (name) => `I didn't catch that. Say 'Hey ${name}' and try again.`, sayNow: (name) => `Say "Hey ${name}" now.`, heard: 'Heard you ✓', notHeard: (name) => `I didn't hear "Hey ${name}". Try again.`, privacy: (name) => `Your microphone stays on. Nothing leaves this device until you say 'Hey ${name}'.`, label: (name) => `Listen for "Hey ${name}"`, tapToListen: 'Tap me to listen again', listening: (name) => `Listening for "Hey ${name}"`, gettingEars: "Getting Buddy's ears ready (36 MB)…", earsFailed: "Couldn't get Buddy's ears ready. Check the internet and try again.", signIn: 'Sign in to talk to Buddy.' }` (`name` as typed in Settings, trimmed).

- [ ] **Step 1: Failing tests:**

```js
test('the wake phrase is "hey" and the name, plain, at most three words', () => {
  assert.strictEqual(wakePhrase('Rahul'), 'hey rahul');
  assert.strictEqual(wakePhrase('  Mr.  Rahul  Kumar Singh '), 'hey mr rahul kumar');
  assert.strictEqual(wakePhrase('Zoë'), 'hey zoe');
  assert.strictEqual(wakePhrase('123'), null);
});
test('words the model lacks', () => {
  assert.deepStrictEqual(wakeMissing('Xyzzy', new Set(['hey', 'rahul'])), ['xyzzy']);
  assert.deepStrictEqual(wakeMissing('Rahul', new Set(['hey', 'rahul'])), []);
});
test('a wake is the phrase as the first words, each sure enough; what follows is the request', () => {
  const w = (word, conf, start, end) => ({ word, conf, start, end });
  const said = (...words) => ({ text: words.map((x) => x.word).join(' '), result: words });
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('rahul', 0.8, 1.2, 1.6)), 'hey rahul', 0.6), { endSec: 1.6, follows: false });
  assert.deepStrictEqual(wakeFrom(said(w('hey', 0.9, 1, 1.2), w('rahul', 0.8, 1.2, 1.6), w('[unk]', 1, 1.7, 2.5)), 'hey rahul', 0.6), { endSec: 1.6, follows: true });
  assert.strictEqual(wakeFrom(said(w('[unk]', 1, 0, 1), w('hey', 0.9, 1, 1.2), w('rahul', 0.9, 1.2, 1.6)), 'hey rahul', 0.6), null, 'the name in the middle of talk');
  assert.strictEqual(wakeFrom(said(w('rahul', 0.9, 0, 0.4)), 'hey rahul', 0.6), null, '"Hey" is required');
  assert.strictEqual(wakeFrom(said(w('hey', 0.5, 1, 1.2), w('rahul', 0.9, 1.2, 1.6)), 'hey rahul', 0.6), null, 'not sure enough');
  assert.strictEqual(wakeFrom({ text: '', result: [] }, 'hey rahul', 0.6), null);
});
```

  plus the Settings/spoken lines as written above. Add `wake` cases to `buildVoiceCases()` (phrases, missing, and
  `wakeFrom` results) and the Kotlin test reads them.
- [ ] **Step 2–4:** implement (JS, then the Kotlin port: `fun wakePhrase(name: String): String?`,
  `fun wakeMissing(name: String, known: Set<String>): List<String>`, `data class Wake(val endSec: Float, val follows: Boolean)`,
  `fun wakeFrom(said: VoskSaid, phrase: String, floor: Float): Wake?`, the lines as functions), sync, run both test
  suites: PASS.
- [ ] **Step 5: Commit**

```bash
git add shared tools test web android
git commit -m "feat(voice): the wake phrase: \"hey\" and the buddy's name, first in what was said"
```

---

### Task B2: Android's wake listener

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/voice/WakeListener.kt`, `voice/MicBus.kt`
- Modify: `voice/Voice.kt` (holds `MicBus` while recording), `voice/TalkBack.kt` (`PhoneTalkBack` holds it in `hear`/`listen`)
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/WakeListenerTest.kt`, `MicBusTest.kt`

**Interfaces:**

```kotlin
/** Who else uses the microphone in Buddy now (the 🎤, a spoken answer): the wake listener steps aside meanwhile. */
object MicBus { val busy: StateFlow<Int>; suspend fun <T> holding(block: suspend () -> T): T }

sealed interface WakeEvent { data object Hearing : WakeEvent; data object Woke : WakeEvent; data class Request(val wav: ByteArray?) : WakeEvent }
class WakeListener(
    private val mic: () -> PcmSource,
    private val spotters: Spotters,
    private val phrase: String,
    private val floor: Float = WAKE_FLOOR,
    private val paused: () -> Boolean = { false },  // a call, the mic silenced, MicBus busy
    private val testOnly: Boolean = false,          // Settings' "Test it": a Woke for each wake, no request
) {
    /** Listens until cancelled: each wake gives Woke, then (unless testOnly) Request with the WAV of what followed. */
    suspend fun run(on: suspend (WakeEvent) -> Unit)
}
```

- [ ] **Step 1: Failing tests** with `FakeMic` and `FakeSpotter` (Task A5), time = samples read:
  - `aWakeAloneRecordsWhatIsSaidAfterItUntilQuiet`: spotter final at chunk 20 = "hey rahul" (end 1.6 s); then 15 chunks of
    voice, 15 of quiet → `Woke`, then `Request(wav)` whose samples start at 1.6 s and end 1.2 s after the last voice.
  - `aRequestInTheSameBreathIsTakenFromWhatWasKept`: final at chunk 40 = "hey rahul [unk] [unk]" (`follows`), the voice
    after 1.6 s already in the keeper → the request starts at 1.6 s, not at chunk 40.
  - `theNameAloneOrInTheMiddleDoesNotWake`: "[unk] hey rahul" and "rahul" → no events.
  - `nothingAfterTheWakeIsARequestWithNoRecording`: 8 s quiet → `Request(null)`.
  - `testOnlyGivesWokeAndNoRequest`.
  - `pausedLetsGoOfTheMicAndComesBack`: `paused` true for 5 reads → `mic.stopped`, then a new `start()`.
  - `aNewSpotterAfterEachWake`: `spotters.make` called once per wake (the recognizer starts fresh).
  - `aMicThatCannotStartIsRetriedEveryFiveSecondsOfClock`: `start()` false → `delay(5_000)` then again.
  - `MicBusTest`: `holding` counts up and down, also on an exception.
- [ ] **Step 2–4:** implement (the keeper holds the last 25 s; the recognizer gets every chunk; on a wake, the request
  is `SpeechEnd(REQUEST.quietMs, REQUEST.nothingMs, REQUEST.maxMs)` fed first with the kept samples from `endSec`, then
  live), run: PASS.
- [ ] **Step 5: Commit**

```bash
git add android/app/src/main/java/com/akshatgg/buddy/voice android/app/src/test/java/com/akshatgg/buddy/voice
git commit -m "feat(android): the wake listener hears \"Hey <name>\" on the phone, and takes the request after it"
```

---

### Task B3: Android listens in the bubble's service (microphone foreground service)

**Files:**
- Modify: `android/app/src/main/AndroidManifest.xml`, `bubble/BubbleService.kt`, `bubble/BootReceiver.kt`,
  `store/AppSettings.kt`, `ui/MainActivity.kt` / `ui/panel/PanelActivity.kt` (on start: `BubbleService.listen(this)` when `wakeOn && wakeNeedsTap`), `res/values/strings.xml`
- Create: `bubble/WakeControl.kt`, `voice/WakeRules.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/WakeRulesTest.kt`

**Interfaces:**
- `AppSettings`: `var wakeOn: Boolean` (default false), `var wakeNeedsTap: Boolean` (default false).
- `WakeRules.listen(s: WakeSituation): Boolean` with `data class WakeSituation(val wakeOn: Boolean, val buddyOn: Boolean, val signedIn: Boolean, val voiceOn: Boolean, val micAllowed: Boolean, val modelReady: Boolean, val nameOk: Boolean, val micService: Boolean)`
  — all must be true; `WakeRules.paused(inCall: Boolean, silenced: Boolean, micBusy: Int, turn: Boolean): Boolean`.
- `BubbleService.listen(context)` (`ACTION_LISTEN`, sent only from an activity on screen) and
  `BubbleService.wakeChanged(context)` (`ACTION_WAKE`: the switch or the name changed).
- `WakeControl(service, graph, onRequest: suspend (ByteArray?) -> Unit)`: `start()`, `stop()`, `refresh()`.

- [ ] **Step 1: Failing `WakeRulesTest`** for every rule (each false input → no; all true → yes; a call, a silenced
  recording, the 🎤 or a turn → paused).
- [ ] **Step 2: Implement.**
  - Manifest: `<uses-permission android:name="android.permission.FOREGROUND_SERVICE_MICROPHONE" />`,
    `<uses-permission android:name="android.permission.WAKE_LOCK" />` (only if Task B8 shows it is needed),
    `android:foregroundServiceType="specialUse|mediaProjection|microphone"`.
  - `BubbleService.foreground(capturing, listening)`: `types or FOREGROUND_SERVICE_TYPE_MICROPHONE` when listening; the
    notification text becomes `Listening for "Hey <name>"` then. `ACTION_LISTEN` → `foreground(…, listening = true)`;
    a `SecurityException` → `settings.wakeNeedsTap = true`, no listening. Success → `wakeNeedsTap = false`,
    `wakeControl.start()`.
  - `onCreate` with `wakeOn`: do not ask for `microphone` (a boot or Android restart cannot): set `wakeNeedsTap = true`
    and say `Tap me to listen again` with `onTap = ::openPanel`; say it again at each `ACTION_USER_PRESENT` while
    `wakeNeedsTap`. The panel's `onStart` sends `ACTION_LISTEN`.
  - `WakeControl`: runs `WakeListener` in `lifecycleScope` on `Dispatchers.Default` while `WakeRules.listen(...)`;
    `paused` = `WakeRules.paused(audioManager.mode in (MODE_IN_CALL, MODE_IN_COMMUNICATION, MODE_RINGTONE), silenced,
    MicBus.busy.value, turnRunning)`, where `silenced` comes from `AudioManager.AudioRecordingCallback` (API 29+:
    Buddy's own configuration `isClientSilenced`). On `Woke`: `BubbleBus.mood(Mood.THINKING)`. On `Request`:
    `onRequest(wav)` (Task B4) with `turnRunning = true` until it returns.
  - `ACTION_WAKE` → `wakeControl.refresh()` (a new phrase for a new name, or stop).
- [ ] **Step 3: Run the tests and build:** PASS.
- [ ] **Step 4: Commit**

```bash
git add android/app/src
git commit -m "feat(android): the bubble listens for \"Hey <name>\" as a microphone service, and asks for a tap after a restart"
```

---

### Task B4: Android takes the request hands-free

**Files:**
- Modify: `AppGraph.kt` (`handsFree`), `ui/panel/PanelModel.kt` (a `readyLine` parameter), `bubble/BubbleService.kt`
  (`onRequest`)
- Create: `voice/HandsFree.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/HandsFreeTest.kt`, `PanelModelTest.kt` (one case)

**Interfaces:**
- `PanelModel(…, readyLine: String = READY)`: what the bubble says when an answer to put in an app waits.
- `class HandsFree(private val chat: PanelModel, private val talkBack: TalkBack, private val transcribe: suspend (ByteArray, String) -> String, private val name: () -> String)` with
  `suspend fun request(wav: ByteArray?)`: null or empty words → says `WAKE_LINES.notCaught(name)`; a `BuddyError` with
  code `network`/`timeout` → says `VOICE_LINES.noInternet`; another `BuddyError` → says its message; else
  `chat.open()` (the same chat within five minutes, so "Priya Sharma" after "Which Priya?" goes on), `chat.hidden()`,
  `chat.sendSpoken(words)`.
- `AppGraph.handsFree: HandsFree` — its own `PanelModel` (not the panel's), with hands that never ask: `contacts =
  { held(READ_CONTACTS) }`, `allow = { held(it) }`, `stepAside = {}`, `screen = { null }`; `talkBack`, `lock`; and
  `readyLine = "Open me and ask again, and I'll write it."`.

- [ ] **Step 1: Failing tests** (`HandsFreeTest` with a fake chat callback and fake talk-back): empty WAV → the
  not-caught line; "" from the server → the same; network → the internet line; words → one `sendSpoken`; a second
  request within five minutes goes on the same chat (`open()` resumes). `PanelModelTest`: an answer with `doIt`
  while not shown says `readyLine`.
- [ ] **Step 2–3:** implement; `BubbleService`'s `onRequest` = `graph.handsFree.request(wav)`. The lines show in the
  speech bubble (`BubbleBus.say`) as they are spoken.
- [ ] **Step 4: Run, PASS. Commit**

```bash
git add android/app/src
git commit -m "feat(android): after \"Hey <name>\" the request goes to its own spoken chat, which answers out loud"
```

---

### Task B5: Android Settings: the switch, its line, Test it

**Files:**
- Modify: `ui/settings/SettingsModel.kt`, `ui/settings/SettingsScreen.kt`, `ui/MainActivity.kt` (Settings' host:
  the microphone permission launcher), `SettingsModelTest.kt`

**Interfaces:**
- `SettingsState` gains `wakeOn: Boolean`, `wakeLine: Status?` (the model download, a name that cannot be heard, signed
  out, the microphone refused), `wakeTesting: Boolean`, `wakeHeard: Int`.
- `SettingsModel(…, voiceModel: VoiceModel, wakeChanged: () -> Unit, micAllowed: () -> Boolean, test: suspend (Long, () -> Unit) -> Unit)`:
  `setWakeOn(on: Boolean)`, `testWake()`; `setName` also re-checks the name and calls `wakeChanged()`.

- [ ] **Step 1: Failing tests:** on with the microphone refused → off, the existing microphone line; on while signed
  out → off, `Sign in to talk to Buddy.`; on with no model → `Getting Buddy's ears ready (36 MB)…` then, when ready,
  the name check; a name the model lacks → `Buddy can't listen for 'Xyzzy'. Try another spelling.` and `wakeChanged`
  not called (the switch stays on, nothing listens); renaming to a known name → the line goes and `wakeChanged` is
  called; a download failure → `Couldn't get Buddy's ears ready. Check the internet and try again.`; `testWake()` →
  `Say "Hey Aarav" now.`, each heard → `wakeHeard + 1` (`Heard you ✓` shown per wake), none in 10 s →
  `I didn't hear "Hey Aarav". Try again.`.
- [ ] **Step 2: Implement.** In the Buddy group, after "Fix where I type": a row titled `Listen for "Hey <name>"` with
  the privacy line under it, the switch, then a `Test it` button shown while it is on, and the status line. The
  switch only turns on with the app open (it is in Settings); turning it on sends `ACTION_LISTEN`. Test it asks the
  running service for a `testOnly` listener for 10 s (`BubbleService.test(context)`; the service reports wakes over
  `BubbleBus`).
- [ ] **Step 3: Run, PASS. Commit**

```bash
git add android/app/src
git commit -m "feat(android): Settings: Listen for \"Hey <name>\", off by default, with Test it"
```

---

### Task B6: The Mac's ear listens for "Hey <name>"

**Files:**
- Modify: `src/renderer/ear/ear.js`, `src/renderer/ear/ear-core.js`, `src/main/ear-window.js`, `src/main/main.js`
- Create: `src/main/wake.js`
- Test: `test/ear-core.test.js` (wake turn), `test/wake.test.js`

**Interfaces:**
- `EarCore.createWakeTurn({ phrase, floor })`: `result(json, keptFrom) -> { follows, fromSample } | null` (on top of
  the same `wakeFrom` rule: main passes the phrase; the page gets `wakeFrom` as a port in `ear-core.js`, checked against
  the `wake` cases of `voice-cases.json` in `test/ear-core.test.js`).
- Ear commands: `wake { phrase, floor, testOnly }` starts the always-on loop (until `ear:stop` or another command,
  which pause it and resume it after); events page → main: `ear:woke` and `ear:request { audio | null }`.
- `src/main/wake.js`: `createWake({ store, ear, model, microphone, power, account, cloud, powerMonitor, actions, talkBack })` →
  `{ refresh(): void, panelListening(on): void, test(): Promise<number>, state(): { on, line } }`, and a pure
  `shouldListen({ wakeOn, buddyOn, signedIn, voiceOn, mic, modelReady, nameOk, locked, asleep, panelListening, turn })`.
  On a request: transcribe (`actions.transcribe(audio, 'audio/wav')`), then `actions.voice(words)`: opens the panel
  (`open()` when hidden) and `send(words, { spoken: true })`; the not-caught and internet lines as Android's.

- [ ] **Step 1: Failing tests:** `shouldListen` for each rule; `wake.js` with a fake ear and fake `powerMonitor`:
  `lock-screen`/`suspend` stop the loop, `unlock-screen`/`resume` start it again; `panelListening(true)` pauses,
  `false` resumes; a turn running pauses until its spoken part ends; a rename (`refresh()`) sends a new `wake` with the
  new phrase; a request with words calls `actions.voice` once; an empty one says the not-caught line; the ear window is
  kept (`ear.keep(true)`) while listening, let go when off.
- [ ] **Step 2: Implement.** In `ear.js`, the loop keeps a `PcmKeeper` of 25 s and a `KaldiRecognizer(16000,
  JSON.stringify([phrase, '[unk]']))` with `setWords(true)`; on a final result `createWakeTurn` decides; on a wake the
  request is cut from `fromSample` and continued live with `createVoiceTiming(REQUEST)`, then a new recognizer.
  `actions.js` exports `voice(words)`. `main.js`: `ui.listening(on, from)` also tells `wake.panelListening(on)` when `from !== 'ear'`
  (the panel page's own 🎤; the ear's listening during a question, A9's `askAloud`, is not the panel's).
- [ ] **Step 3: Run** `npm test`: PASS. **Step 4: Commit**

```bash
git add src test
git commit -m "feat(mac): the ear listens for \"Hey <name>\" on the Mac, and pauses when locked, asleep or the panel listens"
```

---

### Task B7: Mac Settings: the switch, its line, Test it

**Files:**
- Modify: `src/main/ipc/settings.js` (`SETTABLE` gets `wakeOn`; `settings:wake-test`; the snapshot gets
  `wake: { on, line, testing }`), `src/preload/settings.js`, `src/renderer/settings/index.html` (General section,
  after "Listen when the panel opens"), `src/renderer/settings/settings.js`
- Test: `test/settings-ipc.test.js`

- [ ] **Step 1: Failing tests:** `wakeOn` must be a boolean; on → `microphone.ask()` first, refused → off with
  `Allow the microphone in Settings.`; signed out → `Sign in to talk to Buddy.`; on → `wake.refresh()`; a rename →
  `wake.refresh()` (next to `tagWatch?.refresh()`); `settings:wake-test` answers the count after 10 s.
- [ ] **Step 2: Implement** the row:

```html
        <div class="group-row">
          <div class="grow">
            <p id="wake-title" class="row-title">Listen for "Hey Buddy"</p>
            <p id="wake-line" class="muted small">Your microphone stays on. Nothing leaves this device until you say 'Hey Buddy'.</p>
            <p id="wake-status" class="muted small" aria-live="polite"></p>
            <button id="wake-test" type="button" class="secondary" hidden>Test it</button>
          </div>
          <input id="wake-on" class="switch" type="checkbox" role="switch" aria-label="Listen for Hey Buddy">
        </div>
```

  `settings.js` fills the title and the line from `WAKE_LINES.label(name)` / `WAKE_LINES.privacy(name)` (the page gets
  them already worded in the snapshot, so that the renderer needs no `shared/`), and shows `Heard you ✓` per wake
  during a test. Windows: the row is hidden (`snap.platform === 'win32'`).
- [ ] **Step 3: Run** `npm test`: PASS. **Step 4: Commit**

```bash
git add src test
git commit -m "feat(mac): Settings: Listen for \"Hey <name>\", off by default, with Test it"
```

---

### Task B8: Battery and CPU (the owner measures), and the voice check if needed

- [ ] **Step 1: Mac (the owner):** with the switch on and the Mac idle for 10 minutes, Activity Monitor's CPU for
  Buddy's ear renderer ("Buddy Helper (Renderer)" with the ear's pid from `ear.window().webContents.getOSProcessId()`,
  logged once at start). Target under 5% of one core.
- [ ] **Step 2: Android (the owner):** charge to 100%, switch on, screen off, one hour; `adb shell dumpsys batterystats
  --charged com.akshatgg.buddy` and Settings → Battery. Target under 4% an hour. Also check listening goes on with the
  screen off for the hour (a wake after 50 minutes); if it does not, add a `PARTIAL_WAKE_LOCK` held only while
  listening (and the `WAKE_LOCK` permission).
- [ ] **Step 3, only if a target is missed:** the voice check from the spec: the recognizer is fed only after the level
  rises above twice the room's noise (a running 10th percentile of the last 5 s of levels), with the last 300 ms kept
  so that "hey" is not cut. Pure `NoiseGate` in `ear-core.js` and `voice/NoiseGate.kt`, with tests (quiet room →
  nothing fed; a voice → fed from 300 ms before it; a fan's steady noise → the floor rises). Measure again.
- [ ] **Step 4: Commit** what changed (if anything):

```bash
git commit -am "perf(voice): feed the recognizer only when someone speaks"
```

---

### Task B9: Check on the owner's devices

- [ ] **Step 1: Everything green** (`npm test`, then `npm run test:e2e`, the Android tests and build).
- [ ] **Step 2: Recordings (the owner, local only, never committed).** On each device: "Hey <name>" 20 times from 1–3 m,
  and 10 minutes of normal talk and TV. Target: ≥ 18/20 heard, ≤ 1 false wake an hour of talk. If missed, tune
  `WAKE_FLOOR` (one value for both, in `shared/voice-words.js`) and record again.
- [ ] **Step 3: Android by hand:** switch on in Settings; phone on the table, locked: "Hey <name>, message <test
  contact> on WhatsApp testing" in one breath → the question → "yes" → "Unlock your phone and I'll send it to <name>." →
  unlock → sent. The same with a pause after "Hey <name>". "Hey <name>, call <test contact>" → "Call …?" → "yes"
  (locked: the unlock line). Restart the phone → "Tap me to listen again" → tap → listening again (notification says
  so). During a call and while recording a voice note in another app: no wake. The green dot shows. Rename the buddy:
  the old name no longer wakes, the new one does at once. A name the model lacks: the Settings line.
- [ ] **Step 4: Mac by hand:** switch on; "Hey <name>, WhatsApp call <test contact>" → panel opens, the question,
  "no". Lock the Mac: no wake while locked; unlock: wakes again. The panel's 🎤 recording: no wake meanwhile. Sleep and
  wake the Mac: listening comes back.
- [ ] **Step 5: Fix what the owner finds**, each with a test.

### Task B10: PR 3

- [ ] **Step 1:** Push `voice-wake`, open the PR to `master` with `gh pr create`. Title: "\"Hey <name>\": Buddy listens
  for its name, on the device (Mac + Android)". The body: what it does, privacy, the measured CPU and battery, the
  wake results (18/20 etc.), the floor chosen. **No attribution lines.**

---

## Owner actions in this plan

1. **Publish the model release** `voice-model-1` (Task A2, Step 4), never as latest.
2. **Run the ear spike** on the Mac and say yes/no into it (Task A8, Step 1).
3. **Device checks** with a test contact, real messages and calls (A11, B9), and the recordings (B9 Step 2).
4. **Measure** CPU and battery (B8).
5. OK the copy below, and merge PR 2 and PR 3.

## Decisions where the spec was open

- **The 🎤 with an empty box now sends at once on Android**, as the Mac already does, so that the voice flow starts
  ("after a recording the words go to the brain as a chat message"). With text already typed, the words join the box
  as today, and nothing is spoken.
- **Only Mac and Android speak.** Windows keeps the cards (no ear window there), and the iPhone web app is unchanged.
- **A card's own verb is a yes only for that card** ("send" for a message, "call" for a call). Spelling variants are
  folded in (`ok`, `dont`, `nahin`, `haa`, `han`). Any no word wins, so "no, send it" and "haan … na" are no.
- **Decided on Vosk's final results only** (never a partial), within 8 s of the question's end.
- **A word of the list the model lacks** is left out of the grammar; then (and before the model is there) an answer
  where a voice was heard goes to `/api/transcribe`. When the model has every word, no server call is made, as the
  spec says.
- **The model downloads on any network**, in the background, the first time a question is asked out loud (that answer
  uses the server) or when the wake switch is turned on (Settings shows the line). Two assets in one release: a zip for
  Android, a `.tar.gz` for `vosk-browser`.
- **Calls wait for an unlock too**, with their own lines; after the minute the card goes ("I didn't call."). The Mac
  says the spec's "Unlock your Mac and I'll send it." for messages.
- **A line that asks something back** ("Which Priya: …? Tell me the full name.", "Who should I call?") is followed by
  one more listening (no wake word needed), at most twice in a row.
- **Spoken lines:** the AI's `say`; a line of Buddy's own when it is 240 characters or less; red lines (no internet as
  the spec's line); the "done" lines without their sign. Long texts are only shown.
- **A press, a new message, or closing the panel ends the spoken question**; typing alone does not. A late answer is
  dropped.
- **The wake phrase must be the first words of what is said**; the rest of the same breath is the request, and the
  request ends 1.2 s after the last voice (20 s at most). Nothing said within 8 s after a lone "Hey <name>" → "I didn't
  catch that. Say 'Hey <name>' and try again."
- **Android hands-free runs in its own spoken chat**, not in the panel (the phone may be locked); its lines show in the
  speech bubble. Writing into an app is not done by the wake word: "Open me and ask again, and I'll write it." **The
  Mac's wake opens the panel** and the turn runs there.
- **The wake switch stays on when the name cannot be heard or the model is missing**; it listens once both are fixed.
  **Test it** shows only while the switch is on. Signed out, the switch cannot be turned on (the server writes the
  request down).
- **Android's head has no listening face**: it thinks while it listens, as for the 🎤 today.
- **The ear window** is made on first need and closed two minutes after its last use, unless the wake switch is on.

## Top risks

- **Names in a small model's word list:** the default names `Aarav` and `Anaya`, and many Indian names, may be missing
  from `vosk-model-small-en-in`; then the switch cannot be used with them (Settings says so). A2 prints which.
- **`vosk-browser` in Electron** (unmaintained since 2022; WASM, a blob worker, CSP): the A8 spike decides; without it
  the Mac's yes/no goes to the server and Part B on the Mac waits.
- **Android's microphone service rules** (start only with the app on screen, never after a reboot, the screen-off
  behaviour), and the battery target.
- **Wake accuracy** in a noisy Indian home with the TV on, and false wakes; tuned with the owner's recordings.
- **Echo:** Buddy's own question heard as a yes; guarded by listening only after speaking ends, echo cancellation,
  and the verb rule, and checked on device (A11 Step 2.3).

## New copy for the owner to OK

From the spec (used as written): 1. `To Priya Sharma: I'm running late. Send it?` 2. `Sent.` 3. `Okay, not sent.`
4. `Unlock your phone and I'll send it to Priya.` 5. `Unlock your Mac and I'll send it.` 6. `I didn't send it.`
7. `I can't reach the internet right now.` 8. `I didn't catch that. Say 'Hey <name>' and try again.`
9. `Listen for "Hey <name>"` 10. `Your microphone stays on. Nothing leaves this device until you say 'Hey <name>'.`
11. `Test it` 12. `Heard you ✓` 13. `Buddy can't listen for 'Xyzzy'. Try another spelling.` 14. `Tap me to listen again`
15. `Call Prince Narasimhan?` (the owner's own words; the card's existing text)

Made by this plan:

16. `Calling Prince Sharma.` (said after a spoken yes on a call card)
17. `Unlock your phone and I'll call Prince Sharma.`
18. `Unlock your Mac and I'll call Prince Sharma.`
19. `I didn't call.` (locked for the whole minute)
20. `Say "Hey Rahul" now.` (Test it, while it listens)
21. `I didn't hear "Hey Rahul". Try again.` (Test it heard nothing in 10 s)
22. `Getting Buddy's ears ready (36 MB)…` (the model downloading, in Settings)
23. `Couldn't get Buddy's ears ready. Check the internet and try again.`
24. `Sign in to talk to Buddy.` (the wake switch while signed out)
25. `Listening for "Hey Rahul"` (Android's notification while it listens)
26. `Open me and ask again, and I'll write it.` (a writing answer after "Hey <name>" on Android)

Existing lines reused out loud: `Okay, not now.`, `WhatsApp call Prince Sharma?`, `WhatsApp video call Prince Sharma?`,
the "Which …? Tell me the full name." lines, and the microphone lines (`Buddy needs the microphone to hear you. Allow it
in Settings.`, `Allow the microphone in Settings.`).
