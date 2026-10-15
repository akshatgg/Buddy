# Calls, WhatsApp calls, opening apps, and "who's calling?" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed in the chat panel, "call Prince" shows **Call Prince Sharma? [Call] [Not now]** and on Call rings him from
the phone; "WhatsApp call Prince" (or "video call Prince on WhatsApp") does the same through WhatsApp on Android and on
the Mac; "open YouTube" opens it at once; "who is calling me?", "any missed calls?" and "who messaged me?" (recent
notifications) are answered on Android. Every other device says plainly where it can be done.

**Architecture:** The shared brain (`shared/prompts.js`) gets four new answer kinds, `call` `{to, how}`, `open` `{app}`,
`calls` `{what}` and `notifs` `{app}`, each allowed only when the app's request says it can (`canCall`, `canOpen`,
`canSeeCalls`, `canReadNotifs`), like `message`. A new shared file, `shared/pick-lines.js`, words the "which one / none" lines for contacts and apps on top
of hey-buddy's `pickChat`, and is ported to Kotlin and checked against generated cases. Android gets two packages:
`apps/` (launcher apps, opened by label) and `calls/` (phone contacts with numbers and `ACTION_CALL`; WhatsApp's call
button pressed through Buddy's Accessibility service; the ringing number from the phone-state broadcast while the
bubble service runs; missed calls from the call log), and a `notify/` package (a `NotificationListenerService` that
keeps the last 50 notifications in memory, and the line built from them on the phone). The Mac gets `src/main/apps.js` (apps in the app folders, opened
with `shell.openPath`) and one helper command, `waCall`, that opens the chat as `waSend` does and presses its call
button.

**Tech Stack:** Electron + Node (`node:test`), Swift helper (`src/native/BuddyHelper.swift`), Kotlin Android (JUnit4,
kotlinx-coroutines-test, Compose), no new libraries.

**Spec:** `docs/superpowers/specs/2026-10-15-buddy-calls-and-apps-design.md`. It builds on hey-buddy's
`docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md` and its plan
`docs/superpowers/plans/2026-10-15-hey-buddy-message-pr1.md`, whose final code is the template for every task here.

## Global Constraints

- Branch `calls-apps`, worktree `~/projects/buddy-calls`. Never touch other worktrees or branches. hey-buddy
  (`~/projects/buddy-hey`) is another session's: never edit it; only merge it into `calls-apps` where Task 10 says so.
- **No Claude attribution anywhere.** No `Co-Authored-By` trailer and no "Generated with" line in commits or PRs.
- **Buddy never calls without the person pressing Call on the card.** Opening an app needs no question. Buddy tells about
  calls only when asked, and never announces them by itself. Only normal phone calls are seen (not WhatsApp calls).
- User-facing copy in plain short English, exactly as written in this plan. The spec's lines are used word for word;
  every line the spec did not give is listed in "New copy for the owner to OK" at the end.
- Call and notification names stay off the AI: a "who is calling", "missed calls" or notifications answer is shown in
  the chat but never sent back as chat history. Notifications are kept in memory only: never written to disk, synced
  or sent anywhere.
- After changing anything in `shared/`, run `npm run sync:web && npm run sync:web-app && npm run sync:android`.
  `npm test` checks all three copies.
- JS tests: `npm test` (lint and every suite). **Never run two JS suites at once** (two `npm test`, or `npm test` with
  `npm run test:e2e`): they share ports and temp folders. Single file: `node --test test/<file>`.
- Android tests (from `~/projects/buddy-calls/android`):
  `JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ANDROID_HOME="$HOME/Library/Android/sdk" ./gradlew -q -Djava.net.preferIPv4Stack=true :app:testDebugUnitTest`
  (add `--tests '*Name*'` for one class). Android build: the same env and flags with
  `:app:assembleDebug -x checkCloudProperties`.
- **Never run helper WhatsApp commands (`waFind`, `waSend`, `waCall`) against the real WhatsApp without the owner's OK
  said in this session.** `waCall` places a real call: only the owner runs it, in Task 11.
- No Robolectric. Android logic lives in pure functions and small classes over interfaces, tested with fakes, as
  `message/Messenger.kt` is; the Android-only edges (`ContentResolver`, `TelephonyManager`, `AccessibilityNodeInfo`,
  `startActivity`) are thin classes with no logic worth a test.
- Match the surrounding code's style: plain-English doc comments, the same naming, no new libraries.

## Android versions this relies on (minSdk 26, targetSdk 36)

| What | Versions | How the plan handles it | How it is tested |
|---|---|---|---|
| `CALL_PHONE` runtime permission for `ACTION_CALL` | 6+ (all supported) | Asked at the first Call press through a new generic permission launcher; refused → `no_calls` line with Open Settings; `SecurityException` at the call → same line | `PhoneCallerTest` with a fake `Dialer` and a fake `allowed` |
| Ringing number | 9+ (API 28): the number is given only to apps holding `READ_CALL_LOG` | Both `READ_PHONE_STATE` and `READ_CALL_LOG` are asked before "who is calling" | `CallInfoTest` with fakes |
| `TelephonyCallback` vs `PhoneStateListener` | 12+ (API 31): `TelephonyCallback.CallStateListener` replaces `PhoneStateListener` and **carries no number at all**; `PhoneStateListener.onCallStateChanged(state, number)` is deprecated | Neither is used for the number. One runtime-registered receiver for `TelephonyManager.ACTION_PHONE_STATE_CHANGED` (its `EXTRA_STATE` and `EXTRA_INCOMING_NUMBER`) works on 8 through 16, kept while `BubbleService` runs. Android sends that broadcast twice on 10+ (once with the number, for holders of `READ_CALL_LOG`); the pure reducer `Ring.after` keeps the number it has | `RingTest` on `Ring.after` |
| `getCallState()` | 12+ (API 31) needs `READ_PHONE_STATE`, and is deprecated for `getCallStateForSubscription()` | `AndroidPhoneState` picks by `Build.VERSION.SDK_INT`; it is the truth for "ringing now" | Not unit-tested (Android edge); `CallInfoTest` fakes `PhoneState` |
| `registerReceiver` flags | 13+/14 (API 33/34): a flag is required for non-system broadcasts | `ContextCompat.registerReceiver(..., RECEIVER_NOT_EXPORTED)`, as `BubbleService.listenToScreen` already does; protected system broadcasts still arrive | Device check (Task 11) |
| Package visibility for launcher queries | 11+ (API 30) | The manifest already has `<queries><intent>MAIN/LAUNCHER</intent></queries>` (and WhatsApp's packages): `queryIntentActivities` sees every launcher app, and starting one needs nothing more | `AppOpenerTest` with a fake `Launcher` |
| `queryIntentActivities(intent, int)` | 13+ (API 33) deprecated for the `ResolveInfoFlags` overload | `PhoneLauncher` uses the `ResolveInfoFlags` overload on 33+ | Android edge |
| Starting another app's activity from Buddy | 10+ (API 29) background-start limits | Both starts (`ACTION_CALL`, an app's launcher activity, WhatsApp's link) happen right after a button press in the visible panel, as hey-buddy's WhatsApp open does; Buddy also holds "Display over other apps" | Device check (Task 11) |
| Call log and contacts | `READ_CALL_LOG` is its own group since 9; `READ_CONTACTS` as today | Missed calls ask only `READ_CALL_LOG`; names come from the log's cached name, then `PhoneLookup` only when Contacts is already allowed (no third question while the phone rings) | `CallInfoTest` |
| Sideloaded apps and restricted settings | 13+ | Buddy is installed from GitHub releases. Some Android 13+ builds may show Call logs as a "restricted setting" for sideloaded apps; then Android's question never shows and the refusal line + Open Settings is what the person sees. Checked on the owner's phone in Task 11 | Device check |
| Notification access (`NotificationListenerService`) | 4.3+; no runtime dialog exists for it | The service is declared with `BIND_NOTIFICATION_LISTENER_SERVICE`; the person turns it on in Android's Notification access settings (the chat's line + Open Settings). Whether it is on: `NotificationManagerCompat.getEnabledListenerPackages`. On connect, the store is filled from `activeNotifications` | `NotifStoreTest`, `NotifLineTest`, `NotifReaderTest` (pure store, line, and a fake "is it on") |
| Notification access for a sideloaded app | 13+ | Android 13 makes Notification access a "restricted setting" for apps installed outside a store: the switch is greyed until "Allow restricted settings" in Buddy's App info. The same as Buddy can type for you today (`mayBeRestricted`); the off line's Open Settings goes to Notification access, and Task 11 checks what the owner sees | Device check |
| Notification extras | all | Title and text from `Notification.EXTRA_TITLE` / `EXTRA_TEXT` (`CharSequence`, read with `toString()`); ongoing ones (`sbn.isOngoing`), group summaries (`FLAG_GROUP_SUMMARY`) and the call, music and progress categories are skipped | `NotifStoreTest` on the pure `notifFrom` |

## Values that must be confirmed on the owner's devices

- **Android WhatsApp call buttons** (Task 6, Step 1): the view ids of the chat header's voice and video call buttons
  and their content descriptions (expected "Voice call" / "Video call"), from a `uiautomator dump` of an open chat.
- **Android WhatsApp's own "Call?" question** (Task 6, Step 1): whether it shows at all on the owner's WhatsApp, its
  message id (expected `android:id/message`) and its call button id (expected `android:id/button1`).
- **Android WhatsApp's call screen** (Task 6, Step 1): that the chat header id (`conversation_contact_name`) is gone
  while the call screen shows. That is how Buddy knows the call started.
- **Mac WhatsApp call buttons** (Task 10, Step 5): `NavigationBar_CallButton` (voice) and `NavigationBar_VideoCallButton`
  / `NavigationBar_VideoDropdownButton` (video) on WhatsApp 26.41, and what the dropdown shows.
- **Mac WhatsApp's call window** (Task 10, Step 5): that a call opens a window of its own (the window count goes up).

---

### Task 1: The brain learns `call`, `open`, `calls` and `notifs`

**Files:**
- Modify: `shared/prompts.js` (KINDS :26, a new `ELSEWHERE` and `CALL_ONLY` next to `MESSAGE_ONLY_WHATSAPP` :28,
  SYSTEM.chat :88-108, chatPrompt :174-176, parseChat :327-339, exports :346)
- Create: `shared/pick-lines.js`, `test/pick-lines.test.js`
- Modify: `tools/sync-android-shared.js` (CHAT_INPUTS :145-148, CHAT_REPLIES :153-176, a new `LINES_TO` and
  `buildLineCases`, the writer loop :200-206, exports :210)
- Modify: `test/prompts.test.js` (:224 kind list, new tests), `test/android-shared.test.js` (one new test)
- Modify: `src/main/cloud.js:34` (ASK_INPUTS), `test/cloud.test.js:225-240`
- Regenerated: `web/shared/*`, `web/public/app/shared/*`, `android/app/src/main/assets/shared.json`,
  `android/app/src/test/resources/chat-cases.json`, `android/app/src/test/resources/line-cases.json` (new)

**Interfaces:**
- Produces (`shared/prompts.js`):
  - `KINDS` = `[...hey-buddy's 8, 'call', 'open', 'calls', 'notifs']`.
  - `ELSEWHERE = { phoneCall: 'I can only make phone calls from your phone.', whatsAppCall: 'I can make WhatsApp calls from the Mac and Android apps for now.', open: 'I can open apps on the Mac and Android for now.', calls: 'I can only see calls on your phone.', notifs: 'I can only read notifications on your phone.' }` (exported).
  - `CALL_ONLY = 'I can call by phone or on WhatsApp for now.'` (exported).
  - `parseChat` returns, besides the 8 usual fields (and `to` for `message`):
    - `call`: `{ ..., text: '', notes: [], doIt: false, send: false, again: false, to: string, how: 'phone' | 'whatsapp' | 'whatsapp_video' }`
    - `open`: `{ ..., text: '', notes: [], doIt: false, send: false, again: false, app: string }`
    - `calls`: `{ ..., text: '', notes: [], doIt: false, send: false, again: false, what: 'now' | 'missed' }`
    - `notifs`: `{ ..., text: '', notes: [], doIt: false, send: false, again: false, app: string }` (`app` may be `''`:
      every app's notifications)
    - A bad one becomes `kind: 'answer'` with `say: ''` and one of: `Who should I call?`, `Which app should I open?`,
      `CALL_ONLY` (a `how` that is not one of the three; an empty `how` is `'phone'`). `what` other than `missed` is
      `now`.
  - `chatPrompt` adds, each only for a real `true`, after the `canMessage` line and in this order:
    `Buddy can make calls from here.` (`canCall`), `Buddy can open apps from here.` (`canOpen`),
    `Buddy can see their calls from here.` (`canSeeCalls`), `Buddy can read their notifications from here.`
    (`canReadNotifs`).
- Produces (`shared/pick-lines.js`), on top of hey-buddy's `pickChat`/`pickLine`:
  - `contactLine(asked, pick) -> string | null`: none → `I couldn't find ${asked} in your contacts.`; anything else
    → `pickLine(asked, pick)`.
  - `appLine(asked, pick, where) -> string | null` (`where` is `'phone'` or `'Mac'`): one → `null`; none →
    `I couldn't find ${asked} on this ${where}.`; many → `I found lots of apps called ${asked}. Tell me the full name.`;
    choose → `Which one: A or B?` / `Which one: A, B or C?`.
  - `LINE_CASES`: `[asked, names, where][]`, for the Kotlin port.
- Produces (`tools/sync-android-shared.js`): `LINES_TO` (`android/app/src/test/resources/line-cases.json`) and
  `buildLineCases() -> { asked, names, where, pick, contact, app }[]`.
- Produces (`src/main/cloud.js`): `canCall`, `canOpen`, `canSeeCalls`, `canReadNotifs` pass through to the server.

- [ ] **Step 1: Write the failing tests** in `test/prompts.test.js`. Change the kind list at :224 to
  `['write', 'fix', 'answer', 'box', 'screen', 'send', 'code', 'message', 'call', 'open', 'calls', 'notifs']`. Import
  `ELSEWHERE` and `CALL_ONLY` with the other names at the top. Add:

```js
test('parseChat reads "call": who, and how (a phone call when not said), never text, doIt, send, notes or again', () => {
  const r = parseChat(answerOf({ kind: 'call', to: 'Prince', how: 'WhatsApp_Video', say: 'Calling!', text: 'x', doIt: true, send: true, notes: ['n'], again: true }));
  assert.deepStrictEqual(r, { kind: 'call', say: 'Calling!', text: '', notes: [], doIt: false, send: false, remember: [], again: false, to: 'Prince', how: 'whatsapp_video' });
  assert.strictEqual(parseChat(answerOf({ kind: 'call', to: 'Prince' })).how, 'phone');
  assert.strictEqual(parseChat(answerOf({ kind: 'call', to: 'Prince', how: 'whatsapp' })).how, 'whatsapp');
});

test('parseChat: a call with nobody to call asks who; a call by another app says how Buddy can call', () => {
  const plain = { kind: 'answer', say: '', notes: [], doIt: false, send: false, remember: [], again: false };
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'call', to: '  ', how: 'phone' })), { ...plain, text: 'Who should I call?' });
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'call', to: 'Prince', how: 'facetime' })), { ...plain, text: CALL_ONLY });
  assert.strictEqual(CALL_ONLY, 'I can call by phone or on WhatsApp for now.');
});

test('parseChat reads "open": the app as they said it', () => {
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'open', app: ' YouTube ', say: 'Opening it!', text: 'x', doIt: true })), {
    kind: 'open', say: 'Opening it!', text: '', notes: [], doIt: false, send: false, remember: [], again: false, app: 'YouTube',
  });
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'open', app: '' })), {
    kind: 'answer', say: '', text: 'Which app should I open?', notes: [], doIt: false, send: false, remember: [], again: false,
  });
});

test('parseChat reads "calls": who is calling now, or the missed calls', () => {
  const base = { kind: 'calls', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false };
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'calls', what: 'Missed' })), { ...base, what: 'missed' });
  for (const what of ['now', '', 'today', undefined]) assert.deepStrictEqual(parseChat(answerOf({ kind: 'calls', what })), { ...base, what: 'now' }, String(what));
});

test('parseChat reads "notifs": the app they named, or every app', () => {
  const base = { kind: 'notifs', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false };
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'notifs', app: ' Instagram ', text: 'x', doIt: true })), { ...base, app: 'Instagram' });
  assert.deepStrictEqual(parseChat(answerOf({ kind: 'notifs' })), { ...base, app: '' });
});

test('parseChat keeps what they remembered on a call, an open, a calls and a notifs answer', () => {
  for (const fields of [{ kind: 'call', to: 'Mom' }, { kind: 'open', app: 'Camera' }, { kind: 'calls', what: 'now' }, { kind: 'notifs', app: '' }]) {
    assert.deepStrictEqual(parseChat(answerOf({ ...fields, remember: ['Your mother is Sunita.'] })).remember, ['Your mother is Sunita.']);
  }
});

test('the chat prompt says when to answer "call", "open", "calls" and "notifs", their fields, and the lines for elsewhere', () => {
  const { system } = buildPrompt('chat', { message: 'x' });
  const rule = (kind) => system.split('\n').find((line) => line.startsWith(`- "${kind}":`));
  assert.match(system, /For "call", also give "to" and "how"/);
  assert.match(system, /For "open", also give "app"/);
  assert.match(system, /For "calls", also give "what"/);
  assert.match(system, /For "notifs", also give "app"/);
  assert.ok(rule('call').includes('Only when the request says Buddy can make calls'));
  assert.ok(rule('call').includes(`"${ELSEWHERE.phoneCall}"`));
  assert.ok(rule('call').includes(`"${ELSEWHERE.whatsAppCall}"`));
  assert.ok(rule('open').includes('Only when the request says Buddy can open apps'));
  assert.ok(rule('open').includes(`"${ELSEWHERE.open}"`));
  assert.ok(rule('calls').includes('Only when the request says Buddy can see their calls'));
  assert.ok(rule('calls').includes(`"${ELSEWHERE.calls}"`));
  assert.ok(rule('notifs').includes('Only when the request says Buddy can read their notifications'));
  assert.ok(rule('notifs').includes(`"${ELSEWHERE.notifs}"`));
  for (const kind of ['call', 'open', 'calls', 'notifs']) assert.ok(rule(kind).endsWith('Never on the second step.'), kind);
  assert.match(system, /For "box", "screen", "send", "call", "open", "calls" and "notifs", ""\./);
});

test('chat: an app that can call, open apps, see calls or read notifications says so, one line each, after the message line', () => {
  const lines = ['Buddy can make calls from here.', 'Buddy can open apps from here.', 'Buddy can see their calls from here.', 'Buddy can read their notifications from here.'];
  const all = buildPrompt('chat', { message: 'hi', canMessage: true, canCall: true, canOpen: true, canSeeCalls: true, canReadNotifs: true }).user;
  const at = lines.map((line) => all.indexOf(line));
  assert.ok(at.every((i) => i > all.indexOf('Buddy can message people on WhatsApp from here.')));
  assert.deepStrictEqual([...at].sort((a, b) => a - b), at, 'in this order');
  assert.ok(at[3] < all.indexOf('Their message'));
  const none = buildPrompt('chat', { message: 'hi', canCall: 'true', canOpen: 1, canSeeCalls: false, canReadNotifs: 'yes' }).user;
  for (const line of lines) assert.ok(!none.includes(line), line);
});

test('ELSEWHERE says where each thing can be done', () => {
  assert.deepStrictEqual(ELSEWHERE, {
    phoneCall: 'I can only make phone calls from your phone.',
    whatsAppCall: 'I can make WhatsApp calls from the Mac and Android apps for now.',
    open: 'I can open apps on the Mac and Android for now.',
    calls: 'I can only see calls on your phone.',
    notifs: 'I can only read notifications on your phone.',
  });
});
```

  Create `test/pick-lines.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickChat } = require('../shared/message-pick');
const { contactLine, appLine } = require('../shared/pick-lines');

test('contacts: nobody is "not in your contacts"; which one and too many are the message lines', () => {
  assert.strictEqual(contactLine('Zoya', pickChat('Zoya', ['Prince Sharma'])), "I couldn't find Zoya in your contacts.");
  assert.strictEqual(contactLine('Prince', pickChat('Prince', ['Prince Sharma'])), null);
  assert.strictEqual(contactLine('Prince', pickChat('Prince', ['Prince Sharma', 'Prince Kumar'])), 'Which Prince: Prince Sharma or Prince Kumar? Tell me the full name.');
  assert.strictEqual(contactLine('a', pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f'])), 'I found lots of people called a. Tell me the full name.');
});

test('apps: one opens; which one; none on this phone or Mac; too many', () => {
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', ['YouTube', 'YouTube Music']), 'phone'), null);
  assert.strictEqual(appLine('you', pickChat('you', ['YouTube', 'YouTube Music']), 'phone'), 'Which one: YouTube or YouTube Music?');
  assert.strictEqual(appLine('you', pickChat('you', ['YouTube', 'YouTube Music', 'YouTube Kids']), 'Mac'), 'Which one: YouTube, YouTube Music or YouTube Kids?');
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', ['Safari']), 'Mac'), "I couldn't find YouTube on this Mac.");
  assert.strictEqual(appLine('YouTube', pickChat('YouTube', []), 'phone'), "I couldn't find YouTube on this phone.");
  assert.strictEqual(appLine('a', pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f']), 'phone'), 'I found lots of apps called a. Tell me the full name.');
});
```

  In `test/android-shared.test.js`, import `buildLineCases, LINES_TO` and `contactLine, appLine`, and add (same style
  as the pick-cases test at :69):

```js
test('the line cases the Kotlin port is checked against are up to date (run `npm run sync:android`)', () => {
  assert.equal(fs.readFileSync(LINES_TO, 'utf8'), `${JSON.stringify(buildLineCases(), null, 2)}\n`);
  const cases = JSON.parse(fs.readFileSync(LINES_TO, 'utf8'));
  assert.ok(cases.length >= 6);
  for (const { asked, names, where, pick, contact, app } of cases) {
    assert.deepEqual(pickChat(asked, names), pick);
    assert.deepEqual(contactLine(asked, pick), contact);
    assert.deepEqual(appLine(asked, pick, where), app);
  }
});
```

  In `test/cloud.test.js` (:225-240), add `canCall: true, canOpen: true, canSeeCalls: true, canReadNotifs: true,` to
  `input` (with a comment "this app can call, open apps, see calls and read notifications (Android's)"), so the body
  check covers them.

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/prompts.test.js test/pick-lines.test.js test/cloud.test.js`
Expected: FAIL (`call` is not a kind; `../shared/pick-lines` not found; the server body lacks `canCall`).

- [ ] **Step 3: Implement `shared/prompts.js`.**

```js
const KINDS = ['write', 'fix', 'answer', 'box', 'screen', 'send', 'code', 'message', 'call', 'open', 'calls', 'notifs'];
// What a "message" answer says when it cannot be one.
const MESSAGE_ONLY_WHATSAPP = 'I can only message on WhatsApp for now.';
// Where a call, an app to open, their calls or their notifications can be done, said by a device that cannot (and by
// the AI, for a request that does not say the app can): src/main/actions.js on Windows and the Mac, the iPhone web
// app's chat-core.js.
const ELSEWHERE = {
  phoneCall: 'I can only make phone calls from your phone.',
  whatsAppCall: 'I can make WhatsApp calls from the Mac and Android apps for now.',
  open: 'I can open apps on the Mac and Android for now.',
  calls: 'I can only see calls on your phone.',
  notifs: 'I can only read notifications on your phone.',
};
// The ways Buddy calls, and what a call any other way says.
const CALL_HOWS = ['phone', 'whatsapp', 'whatsapp_video'];
const CALL_ONLY = 'I can call by phone or on WhatsApp for now.';
```

  In SYSTEM.chat:
  - The shape line's kind list ends `... or "code" or "message" or "call" or "open" or "calls" or "notifs", "say": ...`.
  - After the `For "message", also give "app" and "to": ...` line, add:

```js
    'For "call", also give "to" and "how": {"to": "Prince", "how": "phone"}. For "open", also give "app": {"app": "YouTube"}. For "calls", also give "what": {"what": "now"}. For "notifs", also give "app": {"app": ""}.',
```

  - After the `- "message": …` line, add (template literals, so the lines stay those of ELSEWHERE):

```js
    `- "call": they ask you to call someone ("call Prince", "Prince ko call karo", "open the phone app and call Prince", "WhatsApp call Prince", "video call Mom on WhatsApp"). "to" is the person as they said it. "how" is "phone" for a phone call (also when they name no app), "whatsapp" for a WhatsApp voice call, "whatsapp_video" for a video call. Only when the request says Buddy can make calls; otherwise answer "${ELSEWHERE.phoneCall}" (for a WhatsApp call: "${ELSEWHERE.whatsAppCall}"). Never on the second step.`,
    `- "open": they ask you to open an app ("open YouTube", "YouTube kholo"). Opening an app to do something in it is not "open" ("open the phone app and call Prince" is "call"). "app" is the app's name as they said it ("YouTube", "Camera"). Only when the request says Buddy can open apps; otherwise answer "${ELSEWHERE.open}". Never on the second step.`,
    `- "calls": they ask who is calling them right now ("who is calling me?", "kaun call kar raha hai?"): "what" is "now"; or about missed calls or who called them ("any missed calls?", "who called me?"): "what" is "missed". Only when the request says Buddy can see their calls; otherwise answer "${ELSEWHERE.calls}". Never on the second step.`,
    `- "notifs": they ask who messaged them, about their notifications, or what a notification says ("who messaged me?", "what are my notifications?", "what's the Instagram notification about?", "kiska message aaya?"). "app" is the app they named, as they said it ("Instagram"), or "" for every app. Only when the request says Buddy can read their notifications; otherwise answer "${ELSEWHERE.notifs}". Never on the second step.`,
```

  - In the `"text"` field rule, change `For "box", "screen" and "send", "".` to
    `For "box", "screen", "send", "call", "open", "calls" and "notifs", "".`

  In chatPrompt, right after the `canMessage` line (:176):

```js
  // The same for calls, apps, the phone's calls and its notifications (the Android app all four; the Mac calls and apps).
  if (input.canCall === true) parts.push('Buddy can make calls from here.');
  if (input.canOpen === true) parts.push('Buddy can open apps from here.');
  if (input.canSeeCalls === true) parts.push('Buddy can see their calls from here.');
  if (input.canReadNotifs === true) parts.push('Buddy can read their notifications from here.');
```

  In parseChat, after the `message` branch and before `code`:

```js
  // A call, an app to open, their calls or their notifications: Buddy does it (or says it cannot) by itself; the fields
  // say what, and there is no text to put anywhere. One that cannot be done becomes an answer that says why.
  if (['call', 'open', 'calls', 'notifs'].includes(out.kind)) {
    const plain = { ...out, text: '', notes: [], doIt: false, send: false, again: false };
    const asAnswer = (text) => ({ ...plain, kind: 'answer', say: '', text });
    if (out.kind === 'call') {
      const how = trimmed(j.how).toLowerCase() || 'phone';
      const to = trimmed(j.to).slice(0, CHAT_LIMITS.nameChars);
      if (!CALL_HOWS.includes(how)) return asAnswer(CALL_ONLY);
      if (!to) return asAnswer('Who should I call?');
      return { ...plain, to, how };
    }
    if (out.kind === 'open') {
      const app = trimmed(j.app).slice(0, CHAT_LIMITS.nameChars);
      if (!app) return asAnswer('Which app should I open?');
      return { ...plain, app };
    }
    if (out.kind === 'notifs') return { ...plain, app: trimmed(j.app).slice(0, CHAT_LIMITS.nameChars) };
    return { ...plain, what: trimmed(j.what).toLowerCase() === 'missed' ? 'missed' : 'now' };
  }
```

  Update parseChat's doc comment: "…, and `to` too for a message; `to` and `how` for a call, `app` for an open and
  for notifs, `what` for calls". Export `ELSEWHERE` and `CALL_ONLY`.

- [ ] **Step 4: Create `shared/pick-lines.js`.**

```js
'use strict';

/**
 * What Buddy says when "Prince" or "YouTube" is not one person or one app: the phone's contacts (a phone call) and the
 * apps on the phone or the Mac (opening one). The pick itself is hey-buddy's pickChat (shared/message-pick.js). The
 * Android app has a port of this (message/PickLines.kt), checked against the cases below (tools/sync-android-shared.js
 * writes them out).
 */

const { pickLine } = require('./message-pick');

/** The line for a pick among the phone's contacts, or null when it is one person. */
function contactLine(asked, pick) {
  if (pick.kind === 'none') return `I couldn't find ${asked} in your contacts.`;
  return pickLine(asked, pick);
}

/** The line for a pick among the apps on this `where` ('phone' or 'Mac'), or null when it is one app. */
function appLine(asked, pick, where) {
  if (pick.kind === 'one') return null;
  if (pick.kind === 'none') return `I couldn't find ${asked} on this ${where}.`;
  if (pick.kind === 'many') return `I found lots of apps called ${asked}. Tell me the full name.`;
  const names = pick.names.length === 2
    ? pick.names.join(' or ')
    : `${pick.names.slice(0, -1).join(', ')} or ${pick.names.at(-1)}`;
  return `Which one: ${names}?`;
}

// The cases the Kotlin port must answer the same way.
const LINE_CASES = [
  ['Prince', ['Prince Sharma'], 'phone'],
  ['Prince', ['Prince Sharma', 'Prince Kumar'], 'phone'],
  ['Zoya', ['Prince Sharma'], 'phone'],
  ['YouTube', ['YouTube', 'YouTube Music'], 'phone'],
  ['you', ['YouTube', 'YouTube Music'], 'phone'],
  ['you', ['YouTube', 'YouTube Music', 'YouTube Kids'], 'Mac'],
  ['YouTube', ['Safari'], 'Mac'],
  ['a', ['A b', 'A c', 'A d', 'A e', 'A f'], 'Mac'],
];

module.exports = { contactLine, appLine, LINE_CASES };
```

- [ ] **Step 5: Android cases.** In `tools/sync-android-shared.js`:
  - `const { contactLine, appLine, LINE_CASES } = require('../shared/pick-lines');` and next to `PICK_TO`:
    `const LINES_TO = path.join(ROOT, 'android', 'app', 'src', 'test', 'resources', 'line-cases.json');`
  - Append to `CHAT_INPUTS` (the comment line first):

```js
  // The Android app can call, open apps, see calls and read notifications too; the Mac calls and opens apps.
  { message: 'call prince', canMessage: true, canCall: true, canOpen: true, canSeeCalls: true, canReadNotifs: true },
  { message: 'open youtube', canOpen: true, canCall: false, canSeeCalls: 'true', canReadNotifs: false },
```

  - Change the kind list at the top of `CHAT_REPLIES` to include `'call', 'open', 'calls', 'notifs'`, and append:

```js
  JSON.stringify({ kind: 'call', to: 'Prince', how: 'WhatsApp_Video', say: 'Calling!', text: 'x', notes: ['n'], doIt: true, send: true, remember: ['A'], again: true }),
  JSON.stringify({ kind: 'call', to: 'Prince', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'call', to: 'Prince', how: 'facetime', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'call', to: ' ', how: 'phone', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'open', app: ' YouTube ', say: 'Opening!', text: 'x', notes: [], doIt: true, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'open', app: '', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'calls', what: 'Missed', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'calls', what: 'today', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'notifs', app: ' Instagram ', say: 'Let me see.', text: 'x', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'notifs', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
```

  - Add, next to `buildPickCases`:

```js
function buildLineCases() {
  return LINE_CASES.map(([asked, names, where]) => {
    const pick = pickChat(asked, names);
    return { asked, names, where, pick, contact: contactLine(asked, pick), app: appLine(asked, pick, where) };
  });
}
```

  - Add `[LINES_TO, buildLineCases()]` to the writer loop, and `buildLineCases, LINES_TO` to `module.exports`.

- [ ] **Step 6: The server gets the flags.** `src/main/cloud.js` ASK_INPUTS, after `'canMessage'`:

```js
  'canCall', 'canOpen', 'canSeeCalls', 'canReadNotifs', // the app can call, open apps, see the phone's calls and notifications
```

- [ ] **Step 7: Sync and run everything**

Run: `npm run sync:web && npm run sync:web-app && npm run sync:android && npm test`
Expected: PASS. `test/server-handlers.test.js` needs no change: the server hands the body to `buildPrompt` as it is.

- [ ] **Step 8: Commit**

```bash
git add -A shared tools web test src/main/cloud.js android/app/src/main/assets/shared.json android/app/src/test/resources
git commit -m "feat(brain): \"call\", \"open\", \"calls\" and \"notifs\" answers, each only for an app that says it can"
```

---

### Task 2: Where Buddy can't: the Windows, Mac and iPhone lines

**Files:**
- Modify: `src/main/actions.js` (imports :21, constants :60-67, `finish` :479-480, a new `elsewhere`)
- Modify: `web/public/app/chat-core.js` (imports :10, `answerItem` :43-50)
- Test: `test/actions.test.js` (after the WhatsApp section, ~:2275), `test/web-app-chat.test.mjs` (:69-77)

**Interfaces:**
- Consumes: `ELSEWHERE` (Task 1), parseChat's `how`/`what`.
- Produces (actions.js): `elsewhere(c, reply) -> true`. For now `finish` sends to it: every `call`, `open`, `calls`,
  `notifs` on Windows; and on the Mac a phone call, `calls` and `notifs`. (Task 9 sends the Mac's `open` to `startOpen`; Task 10 the Mac's
  WhatsApp calls to `startCall`. Until then the Mac does not send `canOpen`/`canCall`, so it never gets them.)
- `say` is not shown with an elsewhere line: the AI's "Calling him now!" would say the opposite of the line.

- [ ] **Step 1: Failing tests** in `test/actions.test.js`:

```js
// Calls, apps and the phone's calls where this computer cannot do them

const calling = (fields = {}) => reply({ kind: 'call', to: 'Prince', how: 'phone', ...fields });
const said = (id, text) => ({ id, type: 'buddy', say: '', text, notes: [], buttons: [] });

test('a phone call, the phone\'s calls and its notifications, on the Mac and on Windows, say they are on the phone', async () => {
  for (const windows of [false, true]) {
    const s = setup({ windows, answers: [calling({ say: 'Calling him!' }), reply({ kind: 'calls', what: 'missed' }), reply({ kind: 'calls', what: 'now' }), reply({ kind: 'notifs', app: 'Instagram' })] });
    await s.actions.open();
    await s.actions.send('call prince');
    assert.deepStrictEqual(lastItem(s), said(2, 'I can only make phone calls from your phone.'), `windows: ${windows}`);
    await s.actions.send('any missed calls?');
    assert.deepStrictEqual(lastItem(s), said(4, 'I can only see calls on your phone.'));
    await s.actions.send('who is calling me?');
    assert.deepStrictEqual(lastItem(s), said(6, 'I can only see calls on your phone.'));
    await s.actions.send('what is the instagram notification about?');
    assert.deepStrictEqual(lastItem(s), said(8, 'I can only read notifications on your phone.'));
    assert.strictEqual(entries(s.log, 'helper').filter((e) => e[1].startsWith('wa')).length, 0);
    assert.strictEqual(moods(s.log).at(-1), 'happy');
  }
});

test('on Windows a WhatsApp call and opening an app say where they work', async () => {
  const s = setup({ windows: true, answers: [calling({ how: 'whatsapp_video' }), reply({ kind: 'open', app: 'YouTube' })] });
  await s.actions.open();
  await s.actions.send('video call prince on whatsapp');
  assert.deepStrictEqual(lastItem(s), said(2, 'I can make WhatsApp calls from the Mac and Android apps for now.'));
  await s.actions.send('open youtube');
  assert.deepStrictEqual(lastItem(s), said(4, 'I can open apps on the Mac and Android for now.'));
});
```

  In `test/web-app-chat.test.mjs`, add `import { ELSEWHERE } from '../web/public/app/shared/prompts.js';` and:

```js
test('a call, an app to open, the phone\'s calls or its notifications say where Buddy can do them', () => {
  const line = (say) => ({ type: 'buddy', say, text: '', notes: [], buttons: [] });
  assert.deepStrictEqual(answerItem(chat({ kind: 'call', to: 'Prince', how: 'phone', say: 'Calling!' }).chat), line(ELSEWHERE.phoneCall));
  assert.deepStrictEqual(answerItem(chat({ kind: 'call', to: 'Prince', how: 'whatsapp' }).chat), line(ELSEWHERE.whatsAppCall));
  assert.deepStrictEqual(answerItem(chat({ kind: 'call', to: 'Prince', how: 'whatsapp_video' }).chat), line(ELSEWHERE.whatsAppCall));
  assert.deepStrictEqual(answerItem(chat({ kind: 'open', app: 'YouTube' }).chat), line(ELSEWHERE.open));
  assert.deepStrictEqual(answerItem(chat({ kind: 'calls', what: 'missed' }).chat), line(ELSEWHERE.calls));
  assert.deepStrictEqual(answerItem(chat({ kind: 'notifs', app: '' }).chat), line(ELSEWHERE.notifs));
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/actions.test.js test/web-app-chat.test.mjs`
Expected: the new tests FAIL (the answers show as written ones).

- [ ] **Step 3: Implement.** actions.js: `const { LIMITS, ELSEWHERE } = require('../../shared/prompts');`. In `finish`,
  right after the `message` line:

```js
    if (['call', 'open', 'calls', 'notifs'].includes(reply.kind)
      && (system === 'win32' || reply.kind === 'calls' || reply.kind === 'notifs' || (reply.kind === 'call' && reply.how === 'phone'))) {
      return elsewhere(c, reply);
    }
```

  and, next to `startMessage`:

```js
  /**
   * A call, an app to open, or their phone's calls or notifications, where this computer cannot do it: one line that
   * says where it can. The AI's own `say` is left out, as it may promise what this line says cannot be done here.
   */
  function elsewhere(c, reply) {
    let text = ELSEWHERE.open;
    if (reply.kind === 'calls') text = ELSEWHERE.calls;
    else if (reply.kind === 'notifs') text = ELSEWHERE.notifs;
    else if (reply.kind === 'call') text = reply.how === 'phone' ? ELSEWHERE.phoneCall : ELSEWHERE.whatsAppCall;
    add(c, { type: 'buddy', say: '', text, notes: [], buttons: [] });
    return true;
  }
```

  chat-core.js: `import { LIMITS, CHAT_LIMITS, ELSEWHERE } from './shared/prompts.js';`, and in `answerItem` after the
  `message` line:

```js
  if (reply.kind === 'call') return item(reply.how === 'phone' ? ELSEWHERE.phoneCall : ELSEWHERE.whatsAppCall);
  if (reply.kind === 'open') return item(ELSEWHERE.open);
  if (reply.kind === 'calls') return item(ELSEWHERE.calls);
  if (reply.kind === 'notifs') return item(ELSEWHERE.notifs);
```

  The iPhone web app sends none of the new flags (as for `canMessage`): the AI gives the same lines itself, from the
  rule's "otherwise" words, and these branches catch an answer of the kind anyway.

- [ ] **Step 4: Run and see them pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/actions.js web/public/app/chat-core.js test/actions.test.js test/web-app-chat.test.mjs
git commit -m "feat: calls, apps and notifications on Windows, the iPhone and (where it can't) the Mac say where Buddy can do them"
```

---

### Task 3: Android reads the new kinds, the flags, and the pick lines

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ai/Prompts.kt` (AskInput :22-37, ChatReply :40-50)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ai/ChatPrompt.kt` (:59 flag lines, readChat :139-149)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/cloud/CloudClient.kt:202`
- Create: `android/app/src/main/java/com/akshatgg/buddy/message/PickLines.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/ai/ChatPromptTest.kt`,
  `android/app/src/test/java/com/akshatgg/buddy/cloud/CloudClientTest.kt` (:240-250), create
  `android/app/src/test/java/com/akshatgg/buddy/message/PickLinesTest.kt`

**Interfaces:**
- Consumes: `chat-cases.json`, `line-cases.json`, `shared.json` from Task 1.
- Produces:
  - `AskInput(..., val canCall: Boolean? = null, val canOpen: Boolean? = null, val canSeeCalls: Boolean? = null, val canReadNotifs: Boolean? = null)`
    after `canMessage`.
  - `ChatReply(..., val to: String = "", val how: String = "", val app: String = "", val what: String = "")`: `how`
    is `phone`/`whatsapp`/`whatsapp_video` for a call, `app` the app's name for an open (and the app named, or `""`,
    for notifs), `what` `now`/`missed` for calls; `""` for every other kind.
  - `fun contactLine(asked: String, pick: Pick): String?` and `fun appLine(asked: String, pick: Pick, where: String): String?`
    in `message/PickLines.kt`.

- [ ] **Step 1: Failing tests.**
  - `ChatPromptTest.inputOf` (:42-55): add `canCall = j["canCall"]?.jsonPrimitive?.booleanOrNull`,
    `canOpen = …`, `canSeeCalls = …`, `canReadNotifs = …` (use `booleanOrNull`: one case has the string `"true"`, which must read as not
    `true`; if `booleanOrNull` reads `"true"` as true, use `j["x"]?.jsonPrimitive?.takeIf { !it.isString }?.boolean`).
  - `everyParseChatCaseIsReadAsTheJavaScriptReadsIt` (:75-93): add to `expected`
    `how = r["how"]?.jsonPrimitive?.content.orEmpty(), app = r["app"]?.jsonPrimitive?.content.orEmpty(), what = r["what"]?.jsonPrimitive?.content.orEmpty(),`.
  - The kinds assertion (:181-187) becomes
    `listOf("write", "fix", "answer", "box", "screen", "send", "code", "message", "call", "open", "calls", "notifs")`,
    and `parseChatReadsEachKind` skips `"message", "call", "open", "calls", "notifs"`.
  - Add:

```kotlin
    @Test fun aCallKeepsWhoAndHowAndNoText() {
        val r = prompts.parseChat("""{"kind":"call","to":"Prince","how":"WhatsApp_Video","say":"Calling!","text":"x","notes":["n"],"doIt":true,"send":true,"remember":[],"again":true}""")
        assertEquals(ChatReply("call", "Calling!", "", emptyList(), false, false, emptyList(), false, to = "Prince", how = "whatsapp_video"), r)
        assertEquals("phone", prompts.parseChat("""{"kind":"call","to":"Prince"}""").how)
    }
    @Test fun aCallAnotherWayOrToNobodyIsAnAnswer() {
        assertEquals(reply("answer", text = "I can call by phone or on WhatsApp for now."), prompts.parseChat("""{"kind":"call","to":"Prince","how":"facetime"}"""))
        assertEquals(reply("answer", text = "Who should I call?"), prompts.parseChat("""{"kind":"call","to":" ","how":"phone"}"""))
    }
    @Test fun anOpenKeepsTheApp() {
        assertEquals(ChatReply("open", "", "", emptyList(), false, false, emptyList(), false, app = "YouTube"), prompts.parseChat("""{"kind":"open","app":" YouTube "}"""))
        assertEquals(reply("answer", text = "Which app should I open?"), prompts.parseChat("""{"kind":"open","app":""}"""))
    }
    @Test fun callsAreNowUnlessMissed() {
        assertEquals("missed", prompts.parseChat("""{"kind":"calls","what":"Missed"}""").what)
        assertEquals("now", prompts.parseChat("""{"kind":"calls","what":"today"}""").what)
    }
    @Test fun notifsKeepTheAppOrNone() {
        assertEquals(ChatReply("notifs", "", "", emptyList(), false, false, emptyList(), false, app = "Instagram"), prompts.parseChat("""{"kind":"notifs","app":" Instagram ","text":"x"}"""))
        assertEquals("", prompts.parseChat("""{"kind":"notifs"}""").app)
    }
    @Test fun theFlagsAddTheirLines() {
        val user = chat(AskInput(message = "hi", canMessage = true, canCall = true, canOpen = true, canSeeCalls = true, canReadNotifs = true)).user
        assertTrue(user.contains("Buddy can make calls from here.\n\nBuddy can open apps from here.\n\nBuddy can see their calls from here.\n\nBuddy can read their notifications from here."))
    }
```

  - In `CloudClientTest` (:240-250), add `canCall = true, canOpen = true, canSeeCalls = true, canReadNotifs = true` to
    the AskInput and `,"canCall":true,"canOpen":true,"canSeeCalls":true,"canReadNotifs":true` at the end of the
    expected body.
  - Create `PickLinesTest.kt`: read `src/test/resources/line-cases.json` as `PickTest` reads `pick-cases.json`, map
    each `pick` to `Pick` with the same `when`, and assert `pickChat(asked, names)`, then
    `contactLine(asked, pick)` against `contact` and `appLine(asked, pick, where)` against `app` (JSON null ↔ Kotlin
    null). `assertTrue(cases.size >= 6)`.

- [ ] **Step 2: Run and see them fail.** Run the Android tests with `--tests '*ChatPromptTest*' --tests '*CloudClientTest*' --tests '*PickLinesTest*'`. Expected: compile failure (`canCall`, `how`, `contactLine` unknown).

- [ ] **Step 3: Implement.**
  - `Prompts.kt`: the four AskInput fields (doc comment: "The chat's: this app can call / open apps / see the
    phone's calls / read its notifications (shared/prompts.js chatPrompt)"), and the three ChatReply fields after `to`
    with a doc comment each.
  - `ChatPrompt.kt` after the canMessage line:

```kotlin
    if (input.canCall == true) parts += "Buddy can make calls from here."
    if (input.canOpen == true) parts += "Buddy can open apps from here."
    if (input.canSeeCalls == true) parts += "Buddy can see their calls from here."
    if (input.canReadNotifs == true) parts += "Buddy can read their notifications from here."
```

  - `ChatPrompt.kt` readChat, after the `message` branch:

```kotlin
    // A call, an app to open, their calls or notifications (shared/prompts.js): no text; one that cannot be done says why.
    if (kind == "call" || kind == "open" || kind == "calls" || kind == "notifs") {
        val plain = out.copy(text = "", notes = emptyList(), doIt = false, send = false, again = false)
        fun asAnswer(text: String) = plain.copy(kind = "answer", say = "", text = text)
        when (kind) {
            "call" -> {
                val how = j.string("how").lowercase().ifEmpty { "phone" }
                val to = j.string("to").take(limits.nameChars)
                if (how !in CALL_HOWS) return asAnswer("I can call by phone or on WhatsApp for now.")
                if (to.isEmpty()) return asAnswer("Who should I call?")
                return plain.copy(to = to, how = how)
            }
            "open" -> {
                val app = j.string("app").take(limits.nameChars)
                if (app.isEmpty()) return asAnswer("Which app should I open?")
                return plain.copy(app = app)
            }
            "notifs" -> return plain.copy(app = j.string("app").take(limits.nameChars))
            else -> return plain.copy(what = if (j.string("what").lowercase() == "missed") "missed" else "now")
        }
    }
```

    with `private val CALL_HOWS = setOf("phone", "whatsapp", "whatsapp_video")` at the top of the file.
  - `CloudClient.kt` after the canMessage line:

```kotlin
            input.canCall?.let { put("canCall", it) }
            input.canOpen?.let { put("canOpen", it) }
            input.canSeeCalls?.let { put("canSeeCalls", it) }
            input.canReadNotifs?.let { put("canReadNotifs", it) }
```

  - `message/PickLines.kt`:

```kotlin
package com.akshatgg.buddy.message

/**
 * What Buddy says when "Prince" or "YouTube" is not one contact or one app. A port of shared/pick-lines.js, checked
 * against line-cases.json.
 */
fun contactLine(asked: String, pick: Pick): String? =
    if (pick == Pick.None) "I couldn't find $asked in your contacts." else pickLine(asked, pick)

fun appLine(asked: String, pick: Pick, where: String): String? = when (pick) {
    is Pick.One -> null
    Pick.None -> "I couldn't find $asked on this $where."
    Pick.Many -> "I found lots of apps called $asked. Tell me the full name."
    is Pick.Choose -> {
        val names = if (pick.names.size == 2) pick.names.joinToString(" or ")
        else pick.names.dropLast(1).joinToString(", ") + " or " + pick.names.last()
        "Which one: $names?"
    }
}
```

- [ ] **Step 4: Run and see them pass.** The full Android suite. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): read \"call\", \"open\", \"calls\" and \"notifs\" answers, and say which contact or app is meant"
```

---

### Task 4: Android opens an app

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/apps/Apps.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt` (constructor :120-131, `answer`
  :385-396 and :438-443, `finish` :463-464, a new `openApp`)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/ChatHost.kt` (:76-86)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/AppGraph.kt` (next to `whatsApp`, :101)
- Test: create `android/app/src/test/java/com/akshatgg/buddy/apps/AppOpenerTest.kt`; modify `PanelModelTest.kt`

**Interfaces:**
- Consumes: `pickChat`, `appLine` (Task 3), `ChatReply.app`.
- Produces:
  - `data class LauncherApp(val label: String, val pkg: String, val activity: String)`
  - `interface Launcher { suspend fun apps(): List<LauncherApp>; fun start(app: LauncherApp) }`, real
    `PhoneLauncher(context)`.
  - `sealed interface Opened { data class Done(val label: String); data class Say(val line: String) }`
  - `fun interface AppOpening { suspend fun open(asked: String): Opened }`, real `AppOpener(launcher: Launcher)`.
  - `AppGraph.launcher: Launcher by lazy { PhoneLauncher(appContext) }`.
  - `PanelModel(..., messaging, apps: AppOpening = AppOpening { error("no apps") }, ...)` (right after `messaging`).
  - PanelModel constants `SECOND_ASK = "Ask me that on its own, and I'll do it."` and the set
    `ACTS = setOf("call", "open", "calls", "notifs")` (answers Buddy acts on by itself, never from a second step).
  - AskInput sent with `canOpen = true`.

  The copy, exactly: done → ChatEvent `✅ Opened {label}`; pick lines from `appLine(asked, pick, "phone")`; a start
  that fails → `I couldn't open {label}.`; a second step → `SECOND_ASK`.

- [ ] **Step 1: Failing tests** in `AppOpenerTest.kt`:

```kotlin
package com.akshatgg.buddy.apps

import android.content.ActivityNotFoundException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class AppOpenerTest {
    private val youTube = LauncherApp("YouTube", "com.google.android.youtube", "Main")
    private val music = LauncherApp("YouTube Music", "com.google.android.apps.youtube.music", "Music")
    private val camera = LauncherApp("Camera", "com.android.camera", "Cam")

    private class FakeLauncher(val list: List<LauncherApp>, val fails: Exception? = null) : Launcher {
        val started = mutableListOf<LauncherApp>()
        override suspend fun apps() = list
        override fun start(app: LauncherApp) { fails?.let { throw it }; started += app }
    }

    @Test fun theOneAppOpens() = runTest {
        val l = FakeLauncher(listOf(youTube, music, camera))
        assertEquals(Opened.Done("YouTube"), AppOpener(l).open("youtube"))
        assertEquals(listOf(youTube), l.started)
    }
    @Test fun twoAppsAskWhichOneAndOpenNothing() = runTest {
        val l = FakeLauncher(listOf(youTube, music))
        assertEquals(Opened.Say("Which one: YouTube or YouTube Music?"), AppOpener(l).open("you"))
        assertEquals(emptyList<LauncherApp>(), l.started)
    }
    @Test fun noSuchApp() = runTest {
        assertEquals(Opened.Say("I couldn't find Netflix on this phone."), AppOpener(FakeLauncher(listOf(camera))).open("Netflix"))
    }
    @Test fun aStartThatFailsSaysSo() = runTest {
        val l = FakeLauncher(listOf(camera), fails = ActivityNotFoundException("gone"))
        assertEquals(Opened.Say("I couldn't open Camera."), AppOpener(l).open("camera"))
    }
}
```

  In `PanelModelTest.kt`:
  - Add a `FakeApps : AppOpening` with a queue of `Opened` answers and `log += "open $asked"`, and pass
    `apps = apps` in `model(...)`.
  - Add `canOpen = true` to the expected AskInputs at :160 and :340, and rename/extend
    `everyStepSaysThisAppCanMessageOnWhatsApp` (:700) to also assert `listOf(true, true)` for `asked.map { it.canOpen }`.
  - New tests:

```kotlin
    private fun opening(app: String, say: String = "") = ChatReply("open", say, "", emptyList(), false, false, emptyList(), false, app = app)

    @Test fun anOpenOpensTheAppAndSaysSo() = runTest {
        answers(opening("YouTube", say = "Opening it!"))
        apps.opened += Opened.Done("YouTube")
        val m = model()
        m.say("open youtube")
        advanceUntilIdle()
        assertEquals(listOf(BuddySaid(2, "Opening it!", "", emptyList(), emptyList()), ChatEvent(3, "✅ Opened YouTube")), m.items.drop(1))
        assertEquals(listOf("open YouTube"), log)
        assertEquals(Mood.HAPPY, moods.last())
    }
    @Test fun anOpenThatIsNotOneAppSaysWhy() = runTest {
        answers(opening("you"))
        apps.opened += Opened.Say("Which one: YouTube or YouTube Music?")
        val m = model()
        m.say("open you")
        advanceUntilIdle()
        assertEquals(BuddySaid(2, "", "Which one: YouTube or YouTube Music?", emptyList(), emptyList()), m.last())
    }
    @Test fun anOpenAnsweredAfterReadingTheBoxIsNotDone() = runTest {
        answers(written("", kind = "box"), opening("YouTube"))
        typeIn.box = BoxText("open youtube now", 16, 16)
        val m = model()
        m.say("do what it says")
        advanceUntilIdle()
        assertEquals(BuddySaid(3, "Ask me that on its own, and I'll do it.", "", emptyList(), emptyList()), m.last())
        assertTrue(log.none { it.startsWith("open") })
    }
```

- [ ] **Step 2: Run and see them fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `apps/Apps.kt`:

```kotlin
package com.akshatgg.buddy.apps

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.appLine
import com.akshatgg.buddy.message.pickChat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** An app on the phone's home screen: its name there, its package, and the activity the home screen starts. */
data class LauncherApp(val label: String, val pkg: String, val activity: String)

/** The phone's home-screen apps, and starting one. */
interface Launcher {
    suspend fun apps(): List<LauncherApp>
    fun start(app: LauncherApp)
}

/** How an "open YouTube" ended: opened (by its name on the phone), or what Buddy says instead. */
sealed interface Opened {
    data class Done(val label: String) : Opened
    data class Say(val line: String) : Opened
}

fun interface AppOpening {
    suspend fun open(asked: String): Opened
}

/**
 * "Open YouTube": the home-screen app of that name (the same rule as for people, shared/message-pick.js), started at
 * once. Two to four that fit ask which one; none or too many say so. Nothing else is opened.
 */
class AppOpener(private val launcher: Launcher) : AppOpening {
    override suspend fun open(asked: String): Opened {
        val apps = launcher.apps()
        val pick = pickChat(asked, apps.map { it.label })
        if (pick !is Pick.One) return Opened.Say(appLine(asked, pick, "phone")!!)
        val app = apps.first { it.label == pick.name }
        return try {
            launcher.start(app)
            Opened.Done(app.label)
        } catch (e: ActivityNotFoundException) {
            Opened.Say("I couldn't open ${app.label}.") // uninstalled or turned off since the list was read
        } catch (e: SecurityException) {
            Opened.Say("I couldn't open ${app.label}.") // an activity that only its own app may start
        }
    }
}

/**
 * The launcher's apps, through the package manager. Android 11 and later list them because the manifest's <queries>
 * names MAIN/LAUNCHER (already there for the chat's app names).
 */
class PhoneLauncher(private val context: Context) : Launcher {
    override suspend fun apps(): List<LauncherApp> = withContext(Dispatchers.IO) {
        val pm = context.packageManager
        val home = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
        val found = if (Build.VERSION.SDK_INT >= 33) pm.queryIntentActivities(home, PackageManager.ResolveInfoFlags.of(0))
        else @Suppress("DEPRECATION") pm.queryIntentActivities(home, 0)
        found.map { LauncherApp(it.loadLabel(pm).toString().trim(), it.activityInfo.packageName, it.activityInfo.name) }
            .filter { it.label.isNotEmpty() }
    }

    override fun start(app: LauncherApp) {
        val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER)
            .setClassName(app.pkg, app.activity)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        context.startActivity(intent)
    }
}
```

  PanelModel:
  - Constructor: `private val apps: AppOpening = AppOpening { error("no apps") },` right after `messaging`.
  - In `answer()`'s AskInput: `canOpen = true, // this app can open apps`.
  - Right after the `second && reply.kind == "message"` block:

```kotlin
        // The same for a call, an app to open, their calls or notifications: Buddy does these by itself, so only from
        // their own words.
        if (second && reply.kind in ACTS) {
            add(c) { BuddySaid(it, SECOND_ASK, "", emptyList(), emptyList()) }
            return Outcome.ANSWERED
        }
```

  - In `finish()`, after the message line: `if (reply.kind == "open") return openApp(c, reply)`, and:

```kotlin
    /** "Open YouTube": opened at once, no question; the chat says it was, or which one or why not. */
    private suspend fun openApp(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
        val opened = apps.open(reply.app)
        if (c !== chat) return Outcome.GONE
        when (opened) {
            is Opened.Done -> add(c) { ChatEvent(it, "✅ Opened ${opened.label}") }
            is Opened.Say -> add(c) { BuddySaid(it, "", opened.line, emptyList(), emptyList()) }
        }
        return Outcome.ANSWERED
    }
```

  - Constants next to MESSAGE_ASK: `private const val SECOND_ASK = "Ask me that on its own, and I'll do it."` and
    `private val ACTS = setOf("call", "open", "calls", "notifs")`.
  - AppGraph (next to `whatsApp`): `/** Open an app: the phone's home-screen apps (apps/Apps.kt). */ val launcher: Launcher by lazy { PhoneLauncher(appContext) }`.
  - ChatHost: `apps = AppOpener(graph.launcher),` after `messaging = …`.

- [ ] **Step 4: Run the Android suite and the build.** Expected: tests PASS, APK builds.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): \"open YouTube\" opens it, or asks which one"
```

---

### Task 5: Android phone calls: contacts with numbers, CALL_PHONE, the Call card

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/calls/PhoneBook.kt`,
  `android/app/src/main/java/com/akshatgg/buddy/calls/PhoneCaller.kt`,
  `android/app/src/main/java/com/akshatgg/buddy/ui/panel/Permissions.kt`
- Modify: `PanelModel.kt` (ChatButton :35, PanelHands :75-83, Chat :132-143, constructor, `finish`, `press` :691-731,
  SETTINGS_ERRORS :760-763, a new public `note`)
- Modify: `PanelScreen.kt` (LABELS :112-116), `SheetActions.kt` (`openSettingsFor` :39-41)
- Modify: `ChatHost.kt` (ChatHost interface :37-50, ChatViewModel :57-108, `closeForGood` :152-156),
  `PanelActivity.kt` (:44-46), `ui/fix/FixActivity.kt` (:58-60)
- Modify: `AndroidManifest.xml` (CALL_PHONE, telephony feature), `AppGraph.kt`
- Test: create `calls/PhoneBookTest.kt`, `calls/PhoneCallerTest.kt`, `ui/panel/PermissionsTest.kt`; modify
  `PanelModelTest.kt`, `ChatHostTest.kt`

**Interfaces:**
- Consumes: `pickChat`, `sameName`, `contactLine` (Task 3), `ChatReply.to/how`, `hands.contacts` (hey-buddy).
- Produces:
  - `data class PhoneRow(val contact: Long, val name: String?, val number: String?, val primary: Boolean, val mobile: Boolean)`
  - `data class Callee(val name: String, val number: String)`
  - `fun calleesFrom(rows: List<PhoneRow>): List<Callee>`: one per contact, its primary number, else its mobile,
    else its first; rows with no name or fewer than 3 digits are left out.
  - `fun sameNumber(a: String, b: String): Boolean`: digits equal, or both 10+ digits with the same last 10.
  - `interface PhoneBook { suspend fun rows(): List<PhoneRow> }`, real `AndroidPhoneBook(context)`.
  - `interface Dialer { fun canCall(): Boolean; fun call(number: String) }`, real `PhoneDialer(context)`.
  - `sealed interface CallFound { data class One(val callee: Callee); data class Say(val line: String, val code: String? = null) }`
  - `sealed interface Called { data object Done; data object Unsure; data class Failed(val line: String, val code: String? = null) }`
    (`Unsure` is used by Task 6.)
  - `interface PhoneCalling { suspend fun find(asked: String): CallFound; suspend fun call(callee: Callee): Called }`,
    real `PhoneCaller(book: PhoneBook, dialer: Dialer, contactsAllowed: suspend () -> Boolean, callsAllowed: suspend () -> Boolean)`.
  - `const val NO_CALLS = "I need permission to make calls. You can allow it in Settings."` (code `no_calls`).
  - `PanelHands.allow: suspend (String) -> Boolean = { false }`: true when the Android permission is held, asking the
    person once (after a why line in the chat) when it is not.
  - `ChatHost.permission: ActivityResultLauncher<String>? get() = null`; `ChatViewModel.permissionAnswered(Boolean)`.
  - `internal fun whyLine(permission: String): String?` (Permissions.kt).
  - `PanelModel.note(text: String)`: a ChatEvent in the current chat.
  - `ChatButton.CALL`, label "Call". `PanelModel(…, phone: PhoneCalling = …)` after `apps`.
  - `private sealed interface CallCard { data class Phone(val callee: Callee) : CallCard }` in PanelModel.kt, and
    `Chat.calls = HashMap<Int, CallCard>()`.
  - `closeForGood(closeChat: () -> Unit, vararg answers: PendingAnswer<Boolean>)`.

  The copy, exactly:

  | When | Line | code |
  |---|---|---|
  | contacts refused | `I need your contacts to find {asked}. You can allow it in Settings.` | `no_contacts` |
  | pick | `contactLine(asked, pick)` | |
  | one name, different numbers | `You have more than one contact called {name}. Rename one in your phone's contacts, then ask me again.` | |
  | card | say `""`, text `Call {name}?`, buttons `[CALL, NOT_NOW]` | |
  | before Android's question | ChatEvent `I need your OK to make calls.` | |
  | CALL_PHONE refused | `I need permission to make calls. You can allow it in Settings.` | `no_calls` (Open Settings → app details) |
  | no telephony | `This phone can't make calls.` | |
  | called | ChatEvent `📞 Calling {name}`, mood HAPPY | |
  | Not now on a call card | ChatEvent `Okay, not now.` | |

- [ ] **Step 1: Failing tests.** `PhoneBookTest.kt`:

```kotlin
package com.akshatgg.buddy.calls

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PhoneBookTest {
    @Test fun oneCalleePerContactWithItsPrimaryElseMobileElseFirstNumber() {
        val rows = listOf(
            PhoneRow(1, "Prince Sharma", "0124 400 1000", primary = false, mobile = false),
            PhoneRow(1, "Prince Sharma", "+91 98123 45678", primary = false, mobile = true),
            PhoneRow(2, "Mom", "98100 00001", primary = false, mobile = true),
            PhoneRow(2, "Mom", "98100 00002", primary = true, mobile = false),
            PhoneRow(3, "Office", "011 2345 6789", primary = false, mobile = false),
        )
        assertEquals(
            listOf(Callee("Prince Sharma", "+91 98123 45678"), Callee("Mom", "98100 00002"), Callee("Office", "011 2345 6789")),
            calleesFrom(rows),
        )
    }
    @Test fun rowsWithNoNameOrNoNumberAreLeftOut() {
        val rows = listOf(PhoneRow(1, " ", "981"), PhoneRow(2, "A", null), PhoneRow(3, "B", "12"), PhoneRow(4, "C", "100"))
        assertEquals(listOf(Callee("C", "100")), calleesFrom(rows))
    }
    @Test fun theSameNumberWrittenTwoWays() {
        assertTrue(sameNumber("+91 98123 45678", "098123-45678"))
        assertTrue(sameNumber("100", "100"))
        assertFalse(sameNumber("+91 98123 45678", "+91 98123 45679"))
        assertFalse(sameNumber("", ""))
    }
}
```

  (`PhoneRow(1, " ", "981")` uses the defaults of `primary` and `mobile`, `false`.)

  `PhoneCallerTest.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class PhoneCallerTest {
    private class FakeBook(val rows: List<PhoneRow>, val refused: Boolean = false) : PhoneBook {
        override suspend fun rows(): List<PhoneRow> { if (refused) throw SecurityException("no"); return rows }
    }
    private class FakeDialer(val can: Boolean = true, val fails: Exception? = null) : Dialer {
        val called = mutableListOf<String>()
        override fun canCall() = can
        override fun call(number: String) { fails?.let { throw it }; called += number }
    }
    private val prince = PhoneRow(1, "Prince Sharma", "+91 98123 45678", mobile = true)
    private fun caller(book: PhoneBook = FakeBook(listOf(prince)), dialer: Dialer = FakeDialer(), contacts: Boolean = true, calls: Boolean = true) =
        PhoneCaller(book, dialer, contactsAllowed = { contacts }, callsAllowed = { calls })

    @Test fun findsTheOneContact() = runTest {
        assertEquals(CallFound.One(Callee("Prince Sharma", "+91 98123 45678")), caller().find("prince"))
    }
    @Test fun nobodyByThatName() = runTest {
        assertEquals(CallFound.Say("I couldn't find Zoya in your contacts."), caller().find("Zoya"))
    }
    @Test fun twoContactsToChooseFrom() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Kumar", "98100 00001")))
        assertEquals(CallFound.Say("Which Prince: Prince Sharma or Prince Kumar? Tell me the full name."), caller(book).find("Prince"))
    }
    @Test fun oneNameTwoNumbersIsNotGuessed() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Sharma", "98100 00001")))
        assertEquals(CallFound.Say("You have more than one contact called Prince Sharma. Rename one in your phone's contacts, then ask me again."), caller(book).find("Prince"))
    }
    @Test fun oneNameTheSameNumberTwiceIsOnePerson() = runTest {
        val book = FakeBook(listOf(prince, PhoneRow(2, "Prince Sharma", "098123 45678")))
        assertEquals(CallFound.One(Callee("Prince Sharma", "+91 98123 45678")), caller(book).find("Prince"))
    }
    @Test fun contactsRefusedOrTakenBack() = runTest {
        val line = CallFound.Say("I need your contacts to find Prince. You can allow it in Settings.", "no_contacts")
        assertEquals(line, caller(contacts = false).find("Prince"))
        assertEquals(line, caller(FakeBook(emptyList(), refused = true)).find("Prince"))
    }
    @Test fun callsTheNumber() = runTest {
        val d = FakeDialer()
        assertEquals(Called.Done, caller(dialer = d).call(Callee("Prince Sharma", "+91 98123 45678")))
        assertEquals(listOf("+91 98123 45678"), d.called)
    }
    @Test fun noCallPermission() = runTest {
        val d = FakeDialer()
        assertEquals(Called.Failed(NO_CALLS, "no_calls"), caller(dialer = d, calls = false).call(Callee("P", "100")))
        assertEquals(emptyList<String>(), d.called)
        assertEquals(Called.Failed(NO_CALLS, "no_calls"), caller(dialer = FakeDialer(fails = SecurityException("x"))).call(Callee("P", "100")))
    }
    @Test fun aPhoneThatCannotCall() = runTest {
        assertEquals(Called.Failed("This phone can't make calls."), caller(dialer = FakeDialer(can = false)).call(Callee("P", "100")))
        assertEquals(Called.Failed("This phone can't make calls."), caller(dialer = FakeDialer(fails = ActivityNotFoundException("x"))).call(Callee("P", "100")))
    }
}
```

  `PermissionsTest.kt`:

```kotlin
package com.akshatgg.buddy.ui.panel

import android.Manifest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PermissionsTest {
    @Test fun eachNewQuestionHasItsLine() {
        assertEquals("I need your OK to make calls.", whyLine(Manifest.permission.CALL_PHONE))
        assertEquals("I need your OK to see who is calling.", whyLine(Manifest.permission.READ_PHONE_STATE))
        assertEquals("I need your OK to see your calls.", whyLine(Manifest.permission.READ_CALL_LOG))
        assertNull(whyLine(Manifest.permission.READ_CONTACTS)) // asked as it was in the message work, with no line
    }
}
```

  `ChatHostTest.kt`: add a test that `closeForGood({ log += "closed" }, contacts, permission)` closes first, then ends
  both waits as no.

  `PanelModelTest.kt`: a `FakePhone : PhoneCalling` (queued `CallFound`/`Called`, `log += "find phone $asked"` /
  `log += "call ${callee.name}"`), passed as `phone = phone`; a helper
  `private fun calling(to: String = "Prince", how: String = "phone", say: String = "") = ChatReply("call", say, "", emptyList(), false, false, emptyList(), false, to = to, how = how)`;
  and tests:
  1. A phone call whose find gives `One(Callee("Prince Sharma", "100"))` adds
     `BuddySaid(id, "", "Call Prince Sharma?", emptyList(), listOf(CALL, NOT_NOW))`; nothing is called.
  2. Pressing CALL calls it; on `Done` the card becomes `ChatEvent(id, "📞 Calling Prince Sharma")` and the mood is
     HAPPY. Pressing CALL again does nothing (`log` has one `call`).
  3. NOT_NOW gives `ChatEvent(id, "Okay, not now.")`; nothing is called.
  4. `Called.Failed(NO_CALLS, "no_calls")` adds `ChatError(_, NO_CALLS, "no_calls", listOf(SETTINGS))`, the bubble says
     it, and the card keeps its buttons (to try again after allowing).
  5. `CallFound.Say(line, "no_contacts")` is a ChatError with SETTINGS; `CallFound.Say(line)` a BuddySaid.
  6. `note("x")` adds `ChatEvent(next, "x")` to the open chat.
  7. A call answered after reading the box is not done (`SECOND_ASK`), as in Task 4.

- [ ] **Step 2: Run and see them fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `calls/PhoneBook.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.Context
import android.provider.ContactsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** One phone number of a contact, as the contacts list has it. */
data class PhoneRow(val contact: Long, val name: String?, val number: String?, val primary: Boolean = false, val mobile: Boolean = false)

/** Someone Buddy can call: their name in the phone's contacts and the number it calls. */
data class Callee(val name: String, val number: String)

private fun digits(number: String) = number.filter { it in '0'..'9' }

/** Whether two numbers are the same, however they are written: the same digits, or the same last 10 of 10 or more. */
fun sameNumber(a: String, b: String): Boolean {
    val x = digits(a)
    val y = digits(b)
    if (x.isEmpty() || y.isEmpty()) return false
    return x == y || (x.length >= 10 && y.length >= 10 && x.takeLast(10) == y.takeLast(10))
}

/**
 * Everyone in the contacts with a number, once each: a contact with several numbers is called on the one marked as
 * the default, else the mobile one, else the first.
 */
fun calleesFrom(rows: List<PhoneRow>): List<Callee> =
    rows.filter { !it.name.isNullOrBlank() && digits(it.number.orEmpty()).length >= 3 }
        .groupBy { it.contact }
        .map { (_, own) ->
            val best = own.firstOrNull { it.primary } ?: own.firstOrNull { it.mobile } ?: own.first()
            Callee(best.name!!.trim(), best.number!!.trim())
        }

/** The phone's contacts' numbers. Needs the Contacts permission (a SecurityException without it). */
interface PhoneBook {
    suspend fun rows(): List<PhoneRow>
}

class AndroidPhoneBook(private val context: Context) : PhoneBook {
    override suspend fun rows(): List<PhoneRow> = withContext(Dispatchers.IO) {
        val p = ContactsContract.CommonDataKinds.Phone
        val columns = arrayOf(p.CONTACT_ID, p.DISPLAY_NAME, p.NUMBER, p.IS_SUPER_PRIMARY, p.IS_PRIMARY, p.TYPE)
        val out = mutableListOf<PhoneRow>()
        context.contentResolver.query(p.CONTENT_URI, columns, null, null, null)?.use { r ->
            while (r.moveToNext()) {
                out += PhoneRow(r.getLong(0), r.getString(1), r.getString(2), r.getInt(3) != 0 || r.getInt(4) != 0, r.getInt(5) == p.TYPE_MOBILE)
            }
        }
        out
    }
}
```

  `calls/PhoneCaller.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.contactLine
import com.akshatgg.buddy.message.pickChat
import com.akshatgg.buddy.message.sameName

/** Who "Prince" is among the phone's contacts: one person, or what Buddy says instead (`code`: the Settings fix). */
sealed interface CallFound {
    data class One(val callee: Callee) : CallFound
    data class Say(val line: String, val code: String? = null) : CallFound
}

/** How a call ended: started; pressed but Buddy cannot tell (never a second call); or not, and why. */
sealed interface Called {
    data object Done : Called
    data object Unsure : Called
    data class Failed(val line: String, val code: String? = null) : Called
}

const val NO_CALLS = "I need permission to make calls. You can allow it in Settings."
private const val CANT_CALL = "This phone can't make calls."

/** The phone app's own call: ACTION_CALL, which rings at once (CALL_PHONE). A phone with two SIMs may ask which. */
interface Dialer {
    fun canCall(): Boolean
    fun call(number: String)
}

class PhoneDialer(private val context: Context) : Dialer {
    override fun canCall() = context.packageManager.hasSystemFeature(PackageManager.FEATURE_TELEPHONY)
    override fun call(number: String) {
        context.startActivity(Intent(Intent.ACTION_CALL, Uri.fromParts("tel", number, null)).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
}

/** What the chat panel needs for a phone call: who, then call. */
interface PhoneCalling {
    suspend fun find(asked: String): CallFound
    suspend fun call(callee: Callee): Called
}

/**
 * A phone call, the steps in order. find(): who "Prince" is among the contacts with a number (the same rule as for
 * WhatsApp). call(), only after the person pressed Call: the call permission (asked the first time), then the call.
 */
class PhoneCaller(
    private val book: PhoneBook,
    private val dialer: Dialer,
    private val contactsAllowed: suspend () -> Boolean,
    private val callsAllowed: suspend () -> Boolean,
) : PhoneCalling {
    override suspend fun find(asked: String): CallFound {
        val noContacts = CallFound.Say("I need your contacts to find $asked. You can allow it in Settings.", "no_contacts")
        if (!contactsAllowed()) return noContacts
        val people = try {
            calleesFrom(book.rows())
        } catch (e: SecurityException) {
            return noContacts // taken back in the phone's settings since it was allowed
        }
        val pick = pickChat(asked, people.map { it.name })
        if (pick !is Pick.One) return CallFound.Say(contactLine(asked, pick)!!)
        // Two contacts with the same name and different numbers: Buddy does not guess which. The same number twice is one.
        val numbers = people.filter { sameName(it.name, pick.name) }
            .fold(listOf<Callee>()) { kept, p -> if (kept.any { sameNumber(it.number, p.number) }) kept else kept + p }
        if (numbers.size > 1) {
            return CallFound.Say("You have more than one contact called ${pick.name}. Rename one in your phone's contacts, then ask me again.")
        }
        return CallFound.One(numbers.first())
    }

    override suspend fun call(callee: Callee): Called {
        if (!dialer.canCall()) return Called.Failed(CANT_CALL)
        if (!callsAllowed()) return Called.Failed(NO_CALLS, "no_calls")
        return try {
            dialer.call(callee.number)
            Called.Done
        } catch (e: SecurityException) {
            Called.Failed(NO_CALLS, "no_calls") // taken back since it was allowed
        } catch (e: ActivityNotFoundException) {
            Called.Failed(CANT_CALL)
        }
    }
}
```

  `ui/panel/Permissions.kt`:

```kotlin
package com.akshatgg.buddy.ui.panel

import android.Manifest

/** The line the chat shows just before Android asks for a permission, saying why; null for none. */
internal fun whyLine(permission: String): String? = when (permission) {
    Manifest.permission.CALL_PHONE -> "I need your OK to make calls."
    Manifest.permission.READ_PHONE_STATE -> "I need your OK to see who is calling."
    Manifest.permission.READ_CALL_LOG -> "I need your OK to see your calls."
    else -> null
}
```

  PanelModel:
  - `enum class ChatButton { …, SEND_MESSAGE, NOT_NOW, CALL }`.
  - PanelHands: `val allow: suspend (String) -> Boolean = { false },` with the doc comment line "`allow` is true when
    Buddy holds the Android permission, asking the person once (with a line why) when it does not."
  - Chat: `val calls = HashMap<Int, CallCard>() // a call card's who, until it is called`.
  - Above the class: `/** Who a Call card calls. */ private sealed interface CallCard { data class Phone(val callee: Callee) : CallCard }`.
  - Constructor after `apps`: `private val phone: PhoneCalling = object : PhoneCalling { override suspend fun find(asked: String) = error("no phone"); override suspend fun call(callee: Callee) = error("no phone") },`.
  - Constants: `private const val NOT_NOW_CALL = "Okay, not now."`.
  - `finish()`, after the open line: `if (reply.kind == "call" && reply.how == "phone") return phoneCall(c, reply)`.
    (Task 6 adds WhatsApp calls; until then this app does not send `canCall`, so no other call comes.)

```kotlin
    /** "Call Prince": who it is (asking for the contacts first), then a card with Call and Not now. Nothing rings yet. */
    private suspend fun phoneCall(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val found = phone.find(reply.to)
        if (c !== chat) return Outcome.GONE
        when (found) {
            is CallFound.Say -> {
                if (found.code != null) {
                    return stop(c, found.code, found.line, if (found.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
                }
                add(c) { BuddySaid(it, "", found.line, emptyList(), emptyList()) }
            }
            is CallFound.One -> {
                val card = add(c) { BuddySaid(it, "", "Call ${found.callee.name}?", emptyList(), listOf(ChatButton.CALL, ChatButton.NOT_NOW)) }
                c.calls[card.id] = CallCard.Phone(found.callee)
            }
        }
        return Outcome.ANSWERED
    }

    /**
     * Call on a call card. Called: the card says so. Not called: a red line says why and the card stays, to press Call
     * again. Not sure: the card says to check, and goes (never a second call).
     */
    private suspend fun placeCall(c: Chat, id: Int) {
        val card = c.calls[id] ?: return
        val called = when (card) {
            is CallCard.Phone -> phone.call(card.callee)
        }
        when (called) {
            Called.Done -> {
                c.calls.remove(id)
                replaceItem(c, ChatEvent(id, calledLine(card)))
                mood(Mood.HAPPY)
            }
            Called.Unsure -> {
                c.calls.remove(id)
                replaceItem(c, ChatEvent(id, CALL_UNSURE))
                say(CALL_UNSURE)
            }
            is Called.Failed -> {
                val code = called.code ?: "call_failed"
                add(c) { ChatError(it, called.line, code, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList()) }
                say(called.line)
            }
        }
        publish()
    }

    private fun calledLine(card: CallCard) = when (card) {
        is CallCard.Phone -> "📞 Calling ${card.callee.name}"
    }

    /** A line in the chat that is not an answer: why Android is about to ask for a permission. */
    fun note(text: String) {
        add(chat) { ChatEvent(it, text) }
        publish()
    }
```

    `CALL_UNSURE` is defined here for now as `private const val CALL_UNSURE = "I'm not sure the call started. Check WhatsApp."`;
    Task 6 moves it to `calls/WhatsAppCaller.kt` and imports it.
  - `press()`: `ChatButton.CALL -> inApp { placeCall(c, id) }`, and NOT_NOW becomes:

```kotlin
            ChatButton.NOT_NOW -> {
                if (working) return // being sent or called now
                val line = if (c.calls.remove(id) != null) NOT_NOW_CALL else NOT_SENT.also { c.messages.remove(id) }
                replaceItem(c, ChatEvent(id, line))
                publish()
            }
```

  - SETTINGS_ERRORS: add `"no_calls"` (and its doc line: "the call permission not allowed").
  - `PanelScreen.kt` LABELS: `ChatButton.CALL to "Call",`.
  - `SheetActions.kt`: `"no_microphone", "no_contacts", "no_calls" -> Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, …)`.
  - ChatHost: interface gets

```kotlin
    /** Where Android's answer to any other permission question goes ("Allow Buddy to make and manage phone calls?"). */
    val permission: ActivityResultLauncher<String>? get() = null
```

    ChatViewModel gets `private val permissionAnswer = PendingAnswer(none = false)`, `allow = ::allow` in `hands`,
    `phone = PhoneCaller(graph.phoneBook, PhoneDialer(app), contactsAllowed = hands.contacts, callsAllowed = { hands.allow(Manifest.permission.CALL_PHONE) })`
    in `model`, and:

```kotlin
    /** Android's answer to a permission question other than the contacts one, from the activity that asked. */
    fun permissionAnswered(allowed: Boolean) {
        permissionAnswer.answered(allowed)
    }

    /**
     * Whether Buddy holds `permission`: when it does not, the chat says why (whyLine) and Android asks the person (after
     * two noes Android no longer asks: only the phone's settings for Buddy allow it then).
     */
    private suspend fun allow(permission: String): Boolean {
        if (ContextCompat.checkSelfPermission(app, permission) == PackageManager.PERMISSION_GRANTED) return true
        val ask = host?.permission ?: return false
        whyLine(permission)?.let(model::note)
        return permissionAnswer.ask { ask.launch(permission) }
    }
```

    `onCleared() = closeForGood(model::close, contactsAnswer, permissionAnswer)`, and `closeForGood` takes
    `vararg answers: PendingAnswer<Boolean>` and gives up each after closing the chat.
  - PanelActivity and FixActivity: next to `contacts`,

```kotlin
    @SuppressLint("InvalidFragmentVersionForActivityResult") // as consent
    override val permission: ActivityResultLauncher<String> =
        registerForActivityResult(ActivityResultContracts.RequestPermission()) { kept.permissionAnswered(it) }
```

  - AppGraph: `/** Call someone: the phone's contacts' numbers (calls/PhoneBook.kt). */ val phoneBook: PhoneBook by lazy { AndroidPhoneBook(appContext) }`.
  - Manifest, after READ_CONTACTS:

```xml
    <!-- Call someone: Buddy rings the contact the person chose, only after they press Call on the card. -->
    <uses-permission android:name="android.permission.CALL_PHONE" />
    <!-- CALL_PHONE would otherwise make a phone line required: Buddy also runs on tablets, which only cannot call. -->
    <uses-feature android:name="android.hardware.telephony" android:required="false" />
```

- [ ] **Step 4: Run the Android suite and the build.** Expected: tests PASS, APK builds.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): call someone from the chat: ask first, then ring them from the phone"
```

---

### Task 6: Android WhatsApp calls

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/calls/WhatsAppCallScreen.kt`,
  `android/app/src/main/java/com/akshatgg/buddy/calls/WhatsAppCaller.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/message/Pick.kt` (one internal wrapper, at the end)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/LookService.kt` (after `pressWhatsAppSend`, :240)
- Modify: `PanelModel.kt` (CallCard, `finish`, `placeCall`, `calledLine`, AskInput `canCall`), `ChatHost.kt`
- Test: create `calls/WhatsAppCallScreenTest.kt`, `calls/WhatsAppCallerTest.kt`; modify `PanelModelTest.kt`

**Interfaces:**
- Consumes: `WhatsApp.open(person, text)`, `Person`, `ChatState`, `WhatsAppScreen`, `sameName`, `Messaging.find`
  (hey-buddy); `Called`, `CallCard`, `placeCall` (Task 5).
- Produces:
  - `internal fun plainName(name: String): String` in Pick.kt (`= plain(name)`), for "does this text name Prince".
  - `enum class Confirm { NONE, PRESSED, OTHER }`: WhatsApp's own "Call?" question was not there, was answered for
    this person, or was about someone else.
  - `class WhatsAppCallScreen<N>(chat: WhatsAppScreen<N>, byId: (N, String) -> List<N>, text: (N) -> String?, describe: (N) -> String?, kids: (N) -> List<N>, voiceIds: List<String> = VOICE_CALL_IDS, videoIds: List<String> = VIDEO_CALL_IDS)`
    with `fun callButtonFor(root: N, app: String, person: String, video: Boolean): N?`, `fun asks(root: N): Boolean`
    and `fun confirmButtonFor(root: N, person: String): N?`.
  - `LookService.pressWhatsAppCall(app: String, name: String, video: Boolean): Boolean` and
    `LookService.whatsAppCallQuestion(app: String, name: String): Confirm` (off the main thread).
  - `interface CallScreen { fun on(): Boolean; suspend fun chat(app: String): ChatState?; suspend fun pressCall(app: String, name: String, video: Boolean): Boolean; suspend fun question(app: String, name: String): Confirm }`,
    real `ServiceCallScreen(context)`.
  - `fun interface WhatsAppCalling { suspend fun call(person: Person, video: Boolean): Called }`, real
    `WhatsAppCaller(whatsApp: WhatsApp, screen: CallScreen, wait: suspend (Long) -> Unit = { delay(it) })`.
  - `const val CALL_UNSURE = "I'm not sure the call started. Check WhatsApp."` (moved here from PanelModel).
  - `CallCard.WhatsApp(val person: Person, val video: Boolean)`; `PanelModel(…, whatsAppCalls: WhatsAppCalling = WhatsAppCalling { _, _ -> error("no WhatsApp calls") })` after `phone`.
  - AskInput sent with `canCall = true`.

  The copy, exactly:

  | When | Line | code |
  |---|---|---|
  | find | hey-buddy's `Messaging.find` lines (WhatsApp not there, contacts, which one, two of one name) | as there |
  | card | `WhatsApp call {name}?` / `WhatsApp video call {name}?`, buttons `[CALL, NOT_NOW]` | |
  | WhatsApp gone at Call | `WhatsApp isn't on this phone.` | |
  | Accessibility off | `It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you.` | `no_accessibility` |
  | chat did not open in 8 s | `WhatsApp didn't open {name}'s chat, so I didn't call.` | |
  | another chat opened | `That opened the wrong chat, so I didn't call.` | |
  | no call button | `I couldn't press Call. Call from WhatsApp yourself.` | |
  | WhatsApp's question names someone else | `WhatsApp asked to call someone else, so I didn't.` | |
  | pressed, start not seen in 4 s, or the press threw | `I'm not sure the call started. Check WhatsApp.` (card goes, no second call) | |
  | called | ChatEvent `📞 Calling {name} on WhatsApp` / `📹 Video calling {name} on WhatsApp`, mood HAPPY | |

- [ ] **Step 1: Find WhatsApp's call controls on the owner's phone (device values).** With the owner's OK, the owner
  opens any WhatsApp chat (no call is made) with the phone on USB debugging, then:

```bash
adb shell uiautomator dump /sdcard/wa-chat.xml && adb pull /sdcard/wa-chat.xml /private/tmp/wa-chat.xml
grep -o 'resource-id="com.whatsapp:id/[^"]*"[^>]*content-desc="[^"]*"' /private/tmp/wa-chat.xml | grep -i -E 'call|video'
```

  Expected: the header's two buttons with descriptions like "Voice call" and "Video call" and their resource ids.
  Write the id suffixes (after `com.whatsapp:id/`) into `VOICE_CALL_IDS` and `VIDEO_CALL_IDS` in Step 4, and the exact
  descriptions into `VOICE_CALL_DESCRIPTIONS` / `VIDEO_CALL_DESCRIPTIONS` if they differ from the defaults below. If the
  buttons have no id, leave the id lists empty: the descriptions find them. Then the owner taps the voice call button
  **and cancels at once if a question shows** (or the owner does this with a test contact who knows): if WhatsApp asks
  "Call …?" first, dump that screen too and note the message id and its call button id (defaults `android:id/message`,
  `android:id/button1`). Note also, from a dump during a call the owner makes themselves, that
  `conversation_contact_name` is not on the call screen. Record all of it in the commit message body of this task.

- [ ] **Step 2: Failing tests.** `WhatsAppCallScreenTest.kt`, with the same tiny `Node` as `WhatsAppScreenTest`:

```kotlin
package com.akshatgg.buddy.calls

import com.akshatgg.buddy.message.WhatsAppScreen
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WhatsAppCallScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList())
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val byId = { root: Node, id: String -> all(root).filter { it.id == id } }
    private val chat = WhatsAppScreen<Node>(byId, text = { it.text }, describe = { it.desc }, kids = { it.kids })
    private val screen = WhatsAppCallScreen(chat, byId, text = { it.text }, describe = { it.desc }, kids = { it.kids },
        voiceIds = listOf("voice_btn"), videoIds = listOf("video_btn"))
    private val header = Node("com.whatsapp:id/conversation_contact_name", text = "Prince Sharma")

    @Test fun theCallButtonByIdOnlyInThatPersonsChat() {
        val voice = Node("com.whatsapp:id/voice_btn", desc = "Voice call")
        val video = Node("com.whatsapp:id/video_btn", desc = "Video call")
        val root = Node(kids = listOf(header, voice, video))
        assertEquals(voice, screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
        assertEquals(video, screen.callButtonFor(root, "com.whatsapp", "prince  sharma", video = true))
        assertNull(screen.callButtonFor(root, "com.whatsapp", "Rahul", video = false))
    }
    @Test fun elseByItsDescription() {
        val voice = Node("x", desc = "Voice call")
        val root = Node(kids = listOf(header, Node("y", desc = "Video call"), voice))
        assertEquals(voice, screen.callButtonFor(root, "com.whatsapp", "Prince Sharma", video = false))
    }
    @Test fun whatsAppsOwnQuestionIsAnsweredOnlyForThatPerson() {
        val call = Node("android:id/button1", text = "CALL")
        val asking = Node(kids = listOf(Node("android:id/message", text = "Start a voice call with ‎Prince Sharma?"), call))
        assertTrue(screen.asks(asking))
        assertEquals(call, screen.confirmButtonFor(asking, "Prince Sharma"))
        assertNull(screen.confirmButtonFor(asking, "Prince"))  // a longer name in the question is not "Prince"
        assertNull(screen.confirmButtonFor(asking, "Rahul"))
        assertFalse(screen.asks(Node(kids = listOf(header))))
    }
}
```

  (Whole words: "Prince" does not match "Prince Sharma" here, because the question must name the very contact on the
  card: `confirmButtonFor` checks that the question holds the person's whole name, and that no other word of a longer
  name follows it. Implement "holds" as: `plainName(question)` contains `plainName(person)` followed by the end, a
  space then a non-letter, or "?". See Step 4.)

  `WhatsAppCallerTest.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import com.akshatgg.buddy.message.ChatState
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.WhatsApp
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class WhatsAppCallerTest {
    private val prince = Person("Prince Sharma", "919812345678", "com.whatsapp")
    private class FakeWhatsApp(val noApp: Boolean = false) : WhatsApp {
        val opened = mutableListOf<Pair<Person, String>>()
        override fun installed() = true
        override suspend fun people() = emptyList<Person>()
        override fun open(person: Person, text: String) { if (noApp) throw ActivityNotFoundException("x"); opened += person to text }
    }
    /** Reads come one after another (the last one stays); `questions` likewise; a press that works ends the chat screen. */
    private class FakeScreen(
        var on: Boolean = true,
        var chats: MutableList<ChatState?> = mutableListOf(ChatState("Prince Sharma", "")),
        var questions: MutableList<Confirm> = mutableListOf(Confirm.NONE),
        var press: Boolean = true,
        var starts: Boolean = true,
        var fails: Exception? = null,
    ) : CallScreen {
        val pressed = mutableListOf<String>()
        override fun on() = on
        override suspend fun chat(app: String) = if (chats.size > 1) chats.removeAt(0) else chats.firstOrNull()
        override suspend fun pressCall(app: String, name: String, video: Boolean): Boolean {
            pressed += "$name ${if (video) "video" else "voice"}"
            fails?.let { throw it }
            if (press && starts) chats = mutableListOf(null)
            return press
        }
        override suspend fun question(app: String, name: String) = if (questions.size > 1) questions.removeAt(0) else questions.first()
    }
    private fun caller(w: WhatsApp = FakeWhatsApp(), s: CallScreen = FakeScreen()) = WhatsAppCaller(w, s, wait = {})

    @Test fun opensTheChatWithNoTextChecksItAndPressesCall() = runTest {
        val w = FakeWhatsApp(); val s = FakeScreen(chats = mutableListOf(null, ChatState("Prince Sharma", "")))
        assertEquals(Called.Done, caller(w, s).call(prince, video = true))
        assertEquals(listOf(prince to ""), w.opened)
        assertEquals(listOf("Prince Sharma video"), s.pressed)
    }
    @Test fun wrongChatIsNotCalled() = runTest {
        val s = FakeScreen(chats = mutableListOf(ChatState("Rahul", "")))
        assertEquals(Called.Failed("That opened the wrong chat, so I didn't call."), caller(s = s).call(prince, false))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun aChatThatNeverOpens() = runTest {
        assertEquals(Called.Failed("WhatsApp didn't open Prince Sharma's chat, so I didn't call."), caller(s = FakeScreen(chats = mutableListOf(null))).call(prince, false))
    }
    @Test fun accessibilityOff() = runTest {
        assertEquals(Called.Failed("It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you.", "no_accessibility"),
            caller(s = FakeScreen(on = false)).call(prince, false))
    }
    @Test fun noWhatsAppAnyMore() = runTest {
        assertEquals(Called.Failed("WhatsApp isn't on this phone."), caller(w = FakeWhatsApp(noApp = true)).call(prince, false))
    }
    @Test fun noCallButton() = runTest {
        assertEquals(Called.Failed("I couldn't press Call. Call from WhatsApp yourself."), caller(s = FakeScreen(press = false)).call(prince, false))
    }
    @Test fun whatsAppsQuestionForThisPersonIsAnsweredThenTheCallStarts() = runTest {
        val s = FakeScreen(questions = mutableListOf(Confirm.PRESSED, Confirm.NONE))
        assertEquals(Called.Done, caller(s = s).call(prince, false))
    }
    @Test fun aQuestionAboutSomeoneElseIsNotAnswered() = runTest {
        val s = FakeScreen(questions = mutableListOf(Confirm.OTHER), starts = false)
        assertEquals(Called.Failed("WhatsApp asked to call someone else, so I didn't."), caller(s = s).call(prince, false))
    }
    @Test fun aPressWhoseCallIsNotSeenIsUnsure() = runTest {
        assertEquals(Called.Unsure, caller(s = FakeScreen(starts = false)).call(prince, false))
        assertEquals(Called.Unsure, caller(s = FakeScreen(fails = IllegalStateException("gone"))).call(prince, false))
    }
    @Test fun onlyOneReadWithoutTheChatIsNotEnough() = runTest {
        // The chat goes for one read (WhatsApp redrawing), then is back: not started.
        val s = FakeScreen(starts = false)
        s.chats = mutableListOf(ChatState("Prince Sharma", ""))
        val flicker = object : CallScreen by s {
            var reads = 0
            override suspend fun chat(app: String): ChatState? { reads += 1; return if (reads == 2) null else s.chat(app) }
        }
        assertEquals(Called.Unsure, caller(s = flicker).call(prince, false))
    }
}
```

  `PanelModelTest.kt`: a `FakeWhatsAppCalls : WhatsAppCalling` (queued `Called`, `log += "wa call ${person.name} $video"`)
  passed as `whatsAppCalls`; add `canCall = true` to the AskInputs at :160 and :340 and to the flags test; and tests:
  1. `calling(how = "whatsapp_video")` with `messaging.found += Found.One(priya)` adds
     `BuddySaid(id, "", "WhatsApp video call Priya Sharma?", emptyList(), listOf(CALL, NOT_NOW))`; `log` has
     `find Priya` (hey-buddy's find) and no call.
  2. CALL → `aside` then `wa call Priya Sharma true`; Done → `ChatEvent(id, "📹 Video calling Priya Sharma on WhatsApp")`;
     voice → `"📞 Calling Priya Sharma on WhatsApp"`.
  3. `Called.Unsure` → `ChatEvent(id, "I'm not sure the call started. Check WhatsApp.")`, the bubble says it, and the
     card has no CALL any more.
  4. `Called.Failed(line, "no_accessibility")` → ChatError with SETTINGS; the card stays.

- [ ] **Step 3: Run and see them fail.** Expected: compile failure.

- [ ] **Step 4: Implement.** `Pick.kt`, at the end:

```kotlin
/** A name as names are compared (lower case, no accents or marks, single spaces), for other WhatsApp screens. */
internal fun plainName(name: String): String = plain(name)
```

  `calls/WhatsAppCallScreen.kt`:

```kotlin
package com.akshatgg.buddy.calls

import com.akshatgg.buddy.message.WhatsAppScreen
import com.akshatgg.buddy.message.plainName
import com.akshatgg.buddy.message.sameName

/** WhatsApp's own "Call …?" question, after the call button: not there, answered for this person, or about someone else. */
enum class Confirm { NONE, PRESSED, OTHER }

// The open chat's call buttons (Task 6 Step 1, on the owner's phone): ids under the app's package, and descriptions.
internal val VOICE_CALL_IDS: List<String> = listOf(/* the voice call id suffix from Step 1, or nothing */)
internal val VIDEO_CALL_IDS: List<String> = listOf(/* the video call id suffix from Step 1, or nothing */)
private val VOICE_CALL_DESCRIPTIONS = listOf("Voice call", "Audio call")
private val VIDEO_CALL_DESCRIPTIONS = listOf("Video call")
// WhatsApp's question is an Android dialog: its text and its "Call" button.
private const val QUESTION_ID = "android:id/message"
private const val YES_ID = "android:id/button1"

/**
 * Where the call controls are on WhatsApp's chat screen, found by id or description, and WhatsApp's own question
 * before a call. Generic over the node, like WhatsAppScreen, so that it is tested without Android.
 */
class WhatsAppCallScreen<N>(
    private val chat: WhatsAppScreen<N>,
    private val byId: (N, String) -> List<N>,
    private val text: (N) -> String?,
    private val describe: (N) -> String?,
    private val kids: (N) -> List<N>,
    private val voiceIds: List<String> = VOICE_CALL_IDS,
    private val videoIds: List<String> = VIDEO_CALL_IDS,
) {
    /** The voice or video call button, only when this very screen shows `person`'s chat; else null. */
    fun callButtonFor(root: N, app: String, person: String, video: Boolean): N? {
        val name = chat.chatName(root, app) ?: return null
        if (!sameName(name, person)) return null
        (if (video) videoIds else voiceIds).firstNotNullOfOrNull { byId(root, "$app:id/$it").firstOrNull() }?.let { return it }
        val wanted = if (video) VIDEO_CALL_DESCRIPTIONS else VOICE_CALL_DESCRIPTIONS
        return find(root) { n -> wanted.any { describe(n)?.trim().equals(it, ignoreCase = true) } }
    }

    /** Whether WhatsApp is asking something (a dialog's text is on the screen). */
    fun asks(root: N): Boolean = question(root) != null

    /** The question's Call button when the question names `person` (their whole name); else null. */
    fun confirmButtonFor(root: N, person: String): N? {
        val asked = question(root) ?: return null
        if (!names(asked, person)) return null
        return byId(root, YES_ID).firstOrNull()
    }

    private fun question(root: N): String? = byId(root, QUESTION_ID).firstNotNullOfOrNull { text(it)?.takeIf(String::isNotBlank) }

    /** Whether `text` holds `person`'s whole name, not only its start ("Prince" is not named by "Prince Sharma?"). */
    private fun names(text: String, person: String): Boolean {
        val said = plainName(text)
        val name = plainName(person)
        if (name.isEmpty()) return false
        var at = said.indexOf(name)
        while (at >= 0) {
            val before = at == 0 || !said[at - 1].isLetterOrDigit()
            val after = said.getOrNull(at + name.length)
            val next = said.getOrNull(at + name.length + 1)
            val ends = after == null || !after.isLetterOrDigit() && !(after == ' ' && next?.isLetter() == true)
            if (before && ends) return true
            at = said.indexOf(name, at + 1)
        }
        return false
    }

    private fun find(node: N, depth: Int = 0, test: (N) -> Boolean): N? {
        if (test(node)) return node
        if (depth > 40) return null
        for (k in kids(node)) find(k, depth + 1, test)?.let { return it }
        return null
    }
}
```

  The two `listOf(/* … */)` lines are the only device values: put Step 1's id suffixes there (as strings) or leave
  `listOf()` and delete the comment.

  `calls/WhatsAppCaller.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.ActivityNotFoundException
import android.content.Context
import com.akshatgg.buddy.bubble.LookService
import com.akshatgg.buddy.message.ChatState
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.message.WhatsApp
import com.akshatgg.buddy.message.sameName
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What Buddy's Accessibility service can do for a call in WhatsApp's chat screen. */
interface CallScreen {
    fun on(): Boolean
    suspend fun chat(app: String): ChatState?
    suspend fun pressCall(app: String, name: String, video: Boolean): Boolean
    suspend fun question(app: String, name: String): Confirm
}

class ServiceCallScreen(private val context: Context) : CallScreen {
    override fun on() = LookService.isEnabled(context) && LookService.running != null
    override suspend fun chat(app: String) = withContext(Dispatchers.Default) { LookService.running?.whatsAppChat(app) }
    override suspend fun pressCall(app: String, name: String, video: Boolean) =
        withContext(Dispatchers.Default) { LookService.running?.pressWhatsAppCall(app, name, video) == true }
    override suspend fun question(app: String, name: String) =
        withContext(Dispatchers.Default) { LookService.running?.whatsAppCallQuestion(app, name) ?: Confirm.NONE }
}

fun interface WhatsAppCalling {
    suspend fun call(person: Person, video: Boolean): Called
}

/** What Buddy says when a call may or may not have started. */
const val CALL_UNSURE = "I'm not sure the call started. Check WhatsApp."
private const val OPEN_WAIT_MS = 8_000L
private const val CALL_WAIT_MS = 4_000L
private const val STEP_MS = 250L
private const val WRONG_CHAT = "That opened the wrong chat, so I didn't call."

/**
 * A WhatsApp call, only after the person pressed Call: open the person's chat (WhatsApp's link with no text), wait
 * until WhatsApp shows that chat, press its call button (checked again on the screen it is pressed on), answer
 * WhatsApp's own "Call?" only when it names the same person, and see the chat give way to the call screen. Call is
 * pressed at most once.
 */
class WhatsAppCaller(
    private val whatsApp: WhatsApp,
    private val screen: CallScreen,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : WhatsAppCalling {
    override suspend fun call(person: Person, video: Boolean): Called {
        try {
            whatsApp.open(person, "")
        } catch (e: ActivityNotFoundException) {
            return Called.Failed("WhatsApp isn't on this phone.")
        }
        if (!screen.on()) {
            return Called.Failed("It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you.", "no_accessibility")
        }
        var seen: ChatState? = null
        var waited = 0L
        while (waited < OPEN_WAIT_MS) {
            wait(STEP_MS)
            waited += STEP_MS
            val now = screen.chat(person.app) ?: continue
            seen = now
            if (sameName(now.name, person.name)) break
        }
        val chat = seen ?: return Called.Failed("WhatsApp didn't open ${person.name}'s chat, so I didn't call.")
        if (!sameName(chat.name, person.name)) return Called.Failed(WRONG_CHAT)
        val pressed = try {
            screen.pressCall(person.app, person.name, video)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            return Called.Unsure // it may have been pressed: never a second call
        }
        if (!pressed) return Called.Failed("I couldn't press Call. Call from WhatsApp yourself.")
        return afterPress(person)
    }

    /**
     * Started once the chat has gone from WhatsApp's screen two reads in a row with no question showing (its call screen
     * is up). WhatsApp's question for this person is answered; one about someone else is not. Not seen in 4 s: unsure.
     */
    private suspend fun afterPress(person: Person): Called {
        var gone = 0
        var waited = 0L
        while (waited < CALL_WAIT_MS) {
            wait(STEP_MS)
            waited += STEP_MS
            when (screen.question(person.app, person.name)) {
                Confirm.OTHER -> return Called.Failed("WhatsApp asked to call someone else, so I didn't.")
                Confirm.PRESSED -> { gone = 0; continue }
                Confirm.NONE -> Unit
            }
            if (screen.chat(person.app) == null) {
                gone += 1
                if (gone >= 2) return Called.Done
            } else {
                gone = 0
            }
        }
        return Called.Unsure
    }
}
```

  LookService, after `pressWhatsAppSend`:

```kotlin
    private val whatsAppCalls = WhatsAppCallScreen(
        whatsApp,
        byId = { root, id -> root.findAccessibilityNodeInfosByViewId(id).orEmpty() },
        text = { it.text?.toString() }, describe = { it.contentDescription?.toString() },
        kids = { n -> (0 until n.childCount).mapNotNull { n.getChild(it) } },
    )

    /**
     * Presses the voice or video call button in the open WhatsApp chat, only when the screen it is found on still shows
     * `name`'s chat. False when anything is off, it is not there, or it did not take the press. Off the main thread.
     */
    fun pressWhatsAppCall(app: String, name: String, video: Boolean): Boolean {
        val root = appRoot(app) ?: return false
        try {
            val button = whatsAppCalls.callButtonFor(root, app, name, video) ?: return false
            return button.performAction(AccessibilityNodeInfo.ACTION_CLICK)
        } finally {
            recycle(root)
        }
    }

    /** WhatsApp's own "Call …?" question: answered (Call pressed) only when it names `name`. Off the main thread. */
    fun whatsAppCallQuestion(app: String, name: String): Confirm {
        val root = appRoot(app) ?: return Confirm.NONE
        try {
            if (!whatsAppCalls.asks(root)) return Confirm.NONE
            val yes = whatsAppCalls.confirmButtonFor(root, name) ?: return Confirm.OTHER
            return if (yes.performAction(AccessibilityNodeInfo.ACTION_CLICK)) Confirm.PRESSED else Confirm.OTHER
        } finally {
            recycle(root)
        }
    }
```

  (`appRoot` looks at every interactive window: WhatsApp's dialog is a window of its own, of the same package, found
  there. Check on the device in Task 11 that `appRoot` returns the dialog's root while it shows; if it returns the chat
  behind it, make `whatsAppCallQuestion` look through every window of `app`, as `appRoot` does, instead of the first.)

  PanelModel:
  - Remove the temporary `CALL_UNSURE` and import `com.akshatgg.buddy.calls.CALL_UNSURE`.
  - `CallCard` gets `data class WhatsApp(val person: Person, val video: Boolean) : CallCard`.
  - Constructor after `phone`: `private val whatsAppCalls: WhatsAppCalling = WhatsAppCalling { _, _ -> error("no WhatsApp calls") },`.
  - AskInput: `canCall = true, // this app can call: by phone and on WhatsApp`.
  - `finish()`, after the phone-call line: `if (reply.kind == "call") return whatsAppCall(c, reply)`.

```kotlin
    /** "WhatsApp call Prince": who it is on WhatsApp (as for a message), then a card with Call and Not now. */
    private suspend fun whatsAppCall(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) {
            add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
            publish()
        }
        val found = messaging.find(reply.to)
        if (c !== chat) return Outcome.GONE
        when (found) {
            is Found.Say -> {
                if (found.code != null) {
                    return stop(c, found.code, found.line, if (found.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
                }
                add(c) { BuddySaid(it, "", found.line, emptyList(), emptyList()) }
            }
            is Found.One -> {
                val video = reply.how == "whatsapp_video"
                val ask = if (video) "WhatsApp video call ${found.person.name}?" else "WhatsApp call ${found.person.name}?"
                val card = add(c) { BuddySaid(it, "", ask, emptyList(), listOf(ChatButton.CALL, ChatButton.NOT_NOW)) }
                c.calls[card.id] = CallCard.WhatsApp(found.person, video)
            }
        }
        return Outcome.ANSWERED
    }
```

  - `placeCall`: `is CallCard.WhatsApp -> { hands.stepAside(); whatsAppCalls.call(card.person, card.video) }`.
  - `calledLine`: `is CallCard.WhatsApp -> if (card.video) "📹 Video calling ${card.person.name} on WhatsApp" else "📞 Calling ${card.person.name} on WhatsApp"`.
  - ChatHost: `whatsAppCalls = WhatsAppCaller(graph.whatsApp, ServiceCallScreen(app)),`.

- [ ] **Step 5: Run the Android suite and the build.** Expected: tests PASS, APK builds.

- [ ] **Step 6: Commit** (the body records Step 1's ids, descriptions and question).

```bash
git add android
git commit -m "feat(android): WhatsApp voice and video calls from the chat: ask first, check the chat, press Call" -m "<what Step 1 found on the owner's phone>"
```

---

### Task 7: Android "who is calling?" and missed calls

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/calls/Ringing.kt`,
  `android/app/src/main/java/com/akshatgg/buddy/calls/CallInfo.kt`,
  `android/app/src/main/java/com/akshatgg/buddy/calls/AndroidCalls.kt`
- Modify: `bubble/BubbleService.kt` (`onCreate` :125-127, `onDestroy` :197-203), `AppGraph.kt`,
  `AndroidManifest.xml`, `PanelModel.kt` (Chat, `historyBefore` :365-375, `finish`, AskInput `canSeeCalls`,
  SETTINGS_ERRORS), `ChatHost.kt`, `SheetActions.kt`
- Test: create `calls/RingTest.kt`, `calls/CallInfoTest.kt`; modify `PanelModelTest.kt`

**Interfaces:**
- Consumes: `PanelHands.allow`, `whyLine` (Task 5).
- Produces:
  - `data class Ring(val ringing: Boolean = false, val number: String? = null)` and
    `fun Ring.after(state: String?, number: String?): Ring` (states are TelephonyManager's `"RINGING"`, `"OFFHOOK"`,
    `"IDLE"`).
  - `class RingWatch(context)` with `fun start()`, `fun stop()`, `val now: Ring`.
  - `data class Missed(val who: String, val at: Long)`, `data class LogRow(val number: String?, val cachedName: String?, val date: Long, val presentation: Int)`.
  - Pure: `fun ringingLine(who: String?): String`, `fun missedLine(calls: List<Missed>, zone: ZoneId): String`,
    `fun startOfToday(now: Long, zone: ZoneId): Long`.
  - `interface PhoneState { fun ringing(): Boolean }`, `interface CallLogReader { suspend fun missedSince(from: Long): List<LogRow> }`,
    `interface NameLookup { suspend fun nameFor(number: String): String? }`; real `AndroidPhoneState`,
    `AndroidCallLog`, `AndroidNameLookup` and `fun phoneFormat(context): (String) -> String` in AndroidCalls.kt.
  - `data class Told(val line: String, val code: String? = null)`;
    `interface CallTelling { suspend fun ringing(): Told; suspend fun missed(): Told }`; real
    `CallInfo(state, ring: () -> Ring, log, names, allowed: suspend (String) -> Boolean, format: (String) -> String, now: () -> Long = System::currentTimeMillis, zone: () -> ZoneId = ZoneId::systemDefault)`.
  - `AppGraph.ringWatch: RingWatch by lazy { RingWatch(appContext) }`.
  - `PanelModel(…, callInfo: CallTelling = …)` after `whatsAppCalls`; `Chat.offRecord = HashSet<Int>()`.
  - AskInput sent with `canSeeCalls = true`.

  The copy, exactly:

  | When | Line | code |
  |---|---|---|
  | ringing, a name | `{name} is calling.` | |
  | ringing, a number only | `{formatted number} is calling.` | |
  | ringing, no number | `Someone is calling, but I can't see who.` | |
  | not ringing | `Nobody is calling right now.` | |
  | missed, none | `No missed calls today.` | |
  | missed, one | `1 missed call today: Prince Sharma at 3:10 pm.` | |
  | missed, 2-5 | `2 missed calls today: Mom at 5:40 pm, Prince Sharma at 3:10 pm.` (newest first) | |
  | missed, more than 5 | `7 missed calls today: A at …, B at …, C at …, D at …, E at … and 2 more.` | |
  | a hidden or unknown number in the list | `Unknown number` | |
  | before Android's questions | `I need your OK to see who is calling.` / `I need your OK to see your calls.` | |
  | refused | `I need permission to see your calls. You can allow it in Settings.` | `no_call_log` (Open Settings → app details) |

- [ ] **Step 1: Failing tests.** `RingTest.kt`:

```kotlin
package com.akshatgg.buddy.calls

import org.junit.Assert.assertEquals
import org.junit.Test

class RingTest {
    @Test fun ringingKeepsTheNumberAndTheEndForgetsIt() {
        val r = Ring().after("RINGING", "+919812345678")
        assertEquals(Ring(true, "+919812345678"), r)
        assertEquals(Ring(), r.after("OFFHOOK", null))
        assertEquals(Ring(), r.after("IDLE", null))
    }
    @Test fun androidsSecondBroadcastWithoutTheNumberKeepsIt() {
        // Android 10 and later send the ringing twice: with the number (READ_CALL_LOG) and without.
        assertEquals(Ring(true, "+91981"), Ring().after("RINGING", "+91981").after("RINGING", null))
        assertEquals(Ring(true, "+91981"), Ring().after("RINGING", null).after("RINGING", "+91981"))
    }
    @Test fun aNewRingDoesNotKeepAnOldNumber() {
        assertEquals(Ring(true, null), Ring(false, "+91981").after("RINGING", ""))
    }
    @Test fun anythingElseChangesNothing() {
        assertEquals(Ring(true, "1"), Ring(true, "1").after(null, null))
    }
}
```

  `CallInfoTest.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.Manifest
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test
import java.time.ZoneId
import java.time.ZonedDateTime

class CallInfoTest {
    private val zone = ZoneId.of("Asia/Kolkata")
    private fun at(h: Int, m: Int) = ZonedDateTime.of(2026, 10, 15, h, m, 0, 0, zone).toInstant().toEpochMilli()
    private val noon = at(12, 0)

    private class Fakes(var ringing: Boolean = false, var ring: Ring = Ring(), var rows: List<LogRow> = emptyList(),
                        val names: Map<String, String> = emptyMap(), val refuse: Set<String> = emptySet()) {
        val asked = mutableListOf<String>()
        var since: Long? = null
    }
    private fun info(f: Fakes) = CallInfo(
        state = object : PhoneState { override fun ringing() = f.ringing },
        ring = { f.ring },
        log = object : CallLogReader { override suspend fun missedSince(from: Long): List<LogRow> { f.since = from; return f.rows } },
        names = object : NameLookup { override suspend fun nameFor(number: String) = f.names[number] },
        allowed = { p -> f.asked += p; p !in f.refuse },
        format = { "+91 98123 45678" },
        now = { noon }, zone = { zone },
    )

    @Test fun whoIsCallingByName() = runTest {
        val f = Fakes(ringing = true, ring = Ring(true, "+919812345678"), names = mapOf("+919812345678" to "Prince Sharma"))
        assertEquals(Told("Prince Sharma is calling."), info(f).ringing())
        assertEquals(listOf(Manifest.permission.READ_PHONE_STATE, Manifest.permission.READ_CALL_LOG), f.asked)
    }
    @Test fun whoIsCallingByNumber() = runTest {
        assertEquals(Told("+91 98123 45678 is calling."), info(Fakes(ringing = true, ring = Ring(true, "+919812345678"))).ringing())
    }
    @Test fun ringingButNoNumber() = runTest {
        assertEquals(Told("Someone is calling, but I can't see who."), info(Fakes(ringing = true)).ringing())
        // A number left from an earlier ring is not this one.
        assertEquals(Told("Someone is calling, but I can't see who."), info(Fakes(ringing = true, ring = Ring(false, "1"))).ringing())
    }
    @Test fun nobody() = runTest {
        assertEquals(Told("Nobody is calling right now."), info(Fakes(ringing = false, ring = Ring(true, "1"))).ringing())
    }
    @Test fun refusedSaysSoWithSettings() = runTest {
        val line = Told("I need permission to see your calls. You can allow it in Settings.", "no_call_log")
        assertEquals(line, info(Fakes(refuse = setOf(Manifest.permission.READ_PHONE_STATE))).ringing())
        assertEquals(line, info(Fakes(refuse = setOf(Manifest.permission.READ_CALL_LOG))).missed())
    }
    @Test fun missedSinceMidnightNewestFirstWithNames() = runTest {
        val f = Fakes(rows = listOf(
            LogRow("+911", "Mom", at(17, 40), 1),
            LogRow("+919812345678", null, at(15, 10), 1),
            LogRow("", null, at(9, 5), 2),
        ), names = mapOf("+919812345678" to "Prince Sharma"))
        assertEquals(Told("3 missed calls today: Mom at 5:40 pm, Prince Sharma at 3:10 pm, Unknown number at 9:05 am."), info(f).missed())
        assertEquals(at(0, 0), f.since)
        assertEquals(listOf(Manifest.permission.READ_CALL_LOG), f.asked)
    }
    @Test fun theLines() {
        assertEquals("No missed calls today.", missedLine(emptyList(), zone))
        assertEquals("1 missed call today: Prince Sharma at 3:10 pm.", missedLine(listOf(Missed("Prince Sharma", at(15, 10))), zone))
        val seven = ('A'..'G').mapIndexed { i, c -> Missed("$c", at(11 - i, 0)) }
        assertEquals("7 missed calls today: A at 11:00 am, B at 10:00 am, C at 9:00 am, D at 8:00 am, E at 7:00 am and 2 more.", missedLine(seven, zone))
        assertEquals("Someone is calling, but I can't see who.", ringingLine(null))
        assertEquals(at(0, 0), startOfToday(noon, zone))
    }
}
```

  `PanelModelTest.kt`: a `FakeCallInfo : CallTelling` (queued `Told`, `log += "ringing"` / `log += "missed"`) passed as
  `callInfo`; `canSeeCalls = true` in the AskInputs at :160, :340 and in the flags test; and tests:
  1. `ChatReply("calls", "", "", …, what = "now")` with `Told("Prince Sharma is calling.")` adds
     `BuddySaid(2, "", "Prince Sharma is calling.", emptyList(), emptyList())` and the mood is HAPPY.
  2. **Kept off the AI:** after that answer, the next message's `AskInput.history` is
     `listOf(ChatTurn("you", "who is calling me?"))`: the line is not in it.
  3. `what = "missed"` asks `missed`.
  4. `Told(line, "no_call_log")` is a `ChatError(_, line, "no_call_log", listOf(SETTINGS))`.

- [ ] **Step 2: Run and see them fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `calls/Ringing.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat

/** The phone's own call, as Buddy last heard of it: ringing or not, and the number ringing (null when not known). */
data class Ring(val ringing: Boolean = false, val number: String? = null)

/**
 * The ring after one of Android's phone-state broadcasts (`state` is TelephonyManager's EXTRA_STATE: "RINGING",
 * "OFFHOOK" or "IDLE"). Android 10 and later send a ringing twice, once with the number (to apps that may read the call
 * log) and once without: the number heard for this ring is kept. Answered or over, it is forgotten.
 */
fun Ring.after(state: String?, number: String?): Ring = when (state) {
    "RINGING" -> Ring(true, number?.trim()?.takeIf { it.isNotEmpty() } ?: this.number.takeIf { ringing })
    "OFFHOOK", "IDLE" -> Ring()
    else -> this
}

/**
 * Listens for the phone's ringing while Buddy's bubble runs (BubbleService starts and stops it), to know who is calling
 * when the person asks. Android 12 and later give the number to no listener (TelephonyCallback has none); this
 * broadcast still carries it on 8 to 16, to an app holding READ_PHONE_STATE and READ_CALL_LOG. Without them nothing
 * arrives. Only the ringing number is kept, and only while it rings.
 */
class RingWatch(private val context: Context) {
    @Volatile
    var now: Ring = Ring()
        private set
    private var receiver: BroadcastReceiver? = null

    fun start() {
        if (receiver != null) return
        val heard = object : BroadcastReceiver() {
            override fun onReceive(c: Context, intent: Intent) {
                @Suppress("DEPRECATION") // EXTRA_INCOMING_NUMBER: the only way left to the ringing number
                now = now.after(intent.getStringExtra(TelephonyManager.EXTRA_STATE), intent.getStringExtra(TelephonyManager.EXTRA_INCOMING_NUMBER))
            }
        }
        // A protected broadcast: only the system sends it, and it still arrives at a receiver that is not exported.
        ContextCompat.registerReceiver(context, heard, IntentFilter(TelephonyManager.ACTION_PHONE_STATE_CHANGED), ContextCompat.RECEIVER_NOT_EXPORTED)
        receiver = heard
    }

    fun stop() {
        receiver?.let { context.unregisterReceiver(it) }
        receiver = null
        now = Ring()
    }
}
```

  `calls/CallInfo.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.Manifest
import java.time.Instant
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** A missed call: who (a name, a number, or "Unknown number") and when. */
data class Missed(val who: String, val at: Long)

/** One missed call as the call log has it. `presentation` is CallLog.Calls' NUMBER_PRESENTATION (1: shown). */
data class LogRow(val number: String?, val cachedName: String?, val date: Long, val presentation: Int)

/** What Buddy says about the phone's calls, and the Settings fix when it cannot (`code`). */
data class Told(val line: String, val code: String? = null)

interface PhoneState { fun ringing(): Boolean }
interface CallLogReader { suspend fun missedSince(from: Long): List<LogRow> }
interface NameLookup { suspend fun nameFor(number: String): String? }

interface CallTelling {
    suspend fun ringing(): Told
    suspend fun missed(): Told
}

private const val NO_CALL_LOG = "I need permission to see your calls. You can allow it in Settings."
private const val SHOWN = 1 // CallLog.Calls.PRESENTATION_ALLOWED
private const val NAMED = 5
private val CLOCK = DateTimeFormatter.ofPattern("h:mm a", Locale.ENGLISH)

fun ringingLine(who: String?): String = if (who == null) "Someone is calling, but I can't see who." else "$who is calling."

fun startOfToday(now: Long, zone: ZoneId): Long =
    Instant.ofEpochMilli(now).atZone(zone).toLocalDate().atStartOfDay(zone).toInstant().toEpochMilli()

/** Today's missed calls in one line, newest first: at most five by name and time, then how many more. */
fun missedLine(calls: List<Missed>, zone: ZoneId): String {
    if (calls.isEmpty()) return "No missed calls today."
    val named = calls.take(NAMED).joinToString(", ") { "${it.who} at ${CLOCK.format(Instant.ofEpochMilli(it.at).atZone(zone)).lowercase()}" }
    val more = if (calls.size > NAMED) " and ${calls.size - NAMED} more" else ""
    val count = if (calls.size == 1) "1 missed call" else "${calls.size} missed calls"
    return "$count today: $named$more."
}

/**
 * "Who is calling?" and "any missed calls?", answered only when asked. The permissions are asked the first time (the
 * chat says why first). Names come from the call log, else the contacts (only when Buddy may already read them: no
 * third question while the phone rings), else the number. Nothing is kept.
 */
class CallInfo(
    private val state: PhoneState,
    private val ring: () -> Ring,
    private val log: CallLogReader,
    private val names: NameLookup,
    private val allowed: suspend (String) -> Boolean,
    private val format: (String) -> String,
    private val now: () -> Long = System::currentTimeMillis,
    private val zone: () -> ZoneId = ZoneId::systemDefault,
) : CallTelling {
    override suspend fun ringing(): Told {
        if (!allowed(Manifest.permission.READ_PHONE_STATE) || !allowed(Manifest.permission.READ_CALL_LOG)) return Told(NO_CALL_LOG, "no_call_log")
        val ringing = try {
            state.ringing()
        } catch (e: SecurityException) {
            return Told(NO_CALL_LOG, "no_call_log")
        }
        if (!ringing) return Told("Nobody is calling right now.")
        val number = ring().takeIf { it.ringing }?.number
        return Told(ringingLine(number?.let { names.nameFor(it) ?: format(it) }))
    }

    override suspend fun missed(): Told {
        if (!allowed(Manifest.permission.READ_CALL_LOG)) return Told(NO_CALL_LOG, "no_call_log")
        val zone = zone()
        val rows = try {
            log.missedSince(startOfToday(now(), zone))
        } catch (e: SecurityException) {
            return Told(NO_CALL_LOG, "no_call_log")
        }
        return Told(missedLine(rows.map { Missed(whoOf(it), it.date) }, zone))
    }

    private suspend fun whoOf(row: LogRow): String {
        val number = row.number?.trim().orEmpty()
        if (row.presentation != SHOWN || number.isEmpty()) return "Unknown number"
        return row.cachedName?.trim()?.takeIf(String::isNotEmpty) ?: names.nameFor(number) ?: format(number)
    }
}
```

  `calls/AndroidCalls.kt`:

```kotlin
package com.akshatgg.buddy.calls

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.telephony.PhoneNumberUtils
import android.telephony.TelephonyManager
import androidx.core.content.ContextCompat
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.util.Locale

/** Whether the phone rings now. Android 12 and later need READ_PHONE_STATE for it (a SecurityException without). */
class AndroidPhoneState(private val context: Context) : PhoneState {
    override fun ringing(): Boolean {
        val phone = context.getSystemService(TelephonyManager::class.java) ?: return false
        val state = if (Build.VERSION.SDK_INT >= 31) phone.callStateForSubscription else @Suppress("DEPRECATION") phone.callState
        return state == TelephonyManager.CALL_STATE_RINGING
    }
}

/** Today's missed calls from the call log, newest first (READ_CALL_LOG). */
class AndroidCallLog(private val context: Context) : CallLogReader {
    override suspend fun missedSince(from: Long): List<LogRow> = withContext(Dispatchers.IO) {
        val c = CallLog.Calls
        val out = mutableListOf<LogRow>()
        context.contentResolver.query(
            c.CONTENT_URI, arrayOf(c.NUMBER, c.CACHED_NAME, c.DATE, c.NUMBER_PRESENTATION),
            "${c.TYPE} = ? AND ${c.DATE} >= ?", arrayOf(c.MISSED_TYPE.toString(), from.toString()), "${c.DATE} DESC",
        )?.use { r -> while (r.moveToNext()) out += LogRow(r.getString(0), r.getString(1), r.getLong(2), r.getInt(3)) }
        out
    }
}

/** A number's name in the contacts, only when Buddy may already read them; else null. */
class AndroidNameLookup(private val context: Context) : NameLookup {
    override suspend fun nameFor(number: String): String? = withContext(Dispatchers.IO) {
        if (ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) != PackageManager.PERMISSION_GRANTED) return@withContext null
        try {
            val uri = Uri.withAppendedPath(ContactsContract.PhoneLookup.CONTENT_FILTER_URI, Uri.encode(number))
            context.contentResolver.query(uri, arrayOf(ContactsContract.PhoneLookup.DISPLAY_NAME), null, null, null)?.use {
                if (it.moveToFirst()) it.getString(0)?.trim()?.ifEmpty { null } else null
            }
        } catch (e: SecurityException) {
            null
        }
    }
}

/** A number as the phone shows it ("+91 98123 45678"), for the network's country. */
fun phoneFormat(context: Context): (String) -> String {
    val phone = context.getSystemService(TelephonyManager::class.java)
    val country = (phone?.networkCountryIso?.ifEmpty { phone.simCountryIso } ?: "").ifEmpty { Locale.getDefault().country }.uppercase()
    return { number -> PhoneNumberUtils.formatNumber(number, country) ?: number }
}
```

  PanelModel:
  - Chat: `val offRecord = HashSet<Int>() // lines kept out of the chat sent to the AI: who called`.
  - `historyBefore`: `c.items.takeWhile { it.id != youId }.filter { it.id !in c.offRecord }.mapNotNull { … }`.
  - Constructor after `whatsAppCalls`: `private val callInfo: CallTelling = object : CallTelling { override suspend fun ringing() = error("no calls"); override suspend fun missed() = error("no calls") },`.
  - AskInput: `canSeeCalls = true, // this app can tell who is calling, and the missed calls`.
  - `finish()`: `if (reply.kind == "calls") return tellCalls(c, reply)`, and:

```kotlin
    /**
     * "Who is calling?" / "Any missed calls?": the answer is shown but kept off the chat sent to the AI, as it names
     * the people who called. The AI's own `say` is left out: the line is the answer.
     */
    private suspend fun tellCalls(c: Chat, reply: ChatReply): Outcome {
        val told = if (reply.what == "missed") callInfo.missed() else callInfo.ringing()
        if (c !== chat) return Outcome.GONE
        val code = told.code
        if (code != null) return stop(c, code, told.line, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
        val line = add(c) { BuddySaid(it, "", told.line, emptyList(), emptyList()) }
        c.offRecord += line.id
        return Outcome.ANSWERED
    }
```

  - SETTINGS_ERRORS: add `"no_call_log"`. `SheetActions.kt`: `"no_microphone", "no_contacts", "no_calls", "no_call_log" -> …APPLICATION_DETAILS_SETTINGS`.
  - ChatHost: `callInfo = CallInfo(AndroidPhoneState(app), { graph.ringWatch.now }, AndroidCallLog(app), AndroidNameLookup(app), allowed = hands.allow, format = phoneFormat(app)),`.
  - AppGraph: `/** Who is calling: the ringing number, heard while the bubble runs (calls/Ringing.kt). */ val ringWatch: RingWatch by lazy { RingWatch(appContext) }`.
  - BubbleService: in `onCreate` after `listenToScreen()`: `AppGraph.instance.ringWatch.start() // who is calling, when asked (calls/Ringing.kt)`;
    in `onDestroy` before `screenReceiver?.let`: `AppGraph.instance.ringWatch.stop()`.
  - Manifest, after CALL_PHONE:

```xml
    <!-- Who is calling, and missed calls: only when the person asks in the chat; nothing is kept. READ_PHONE_STATE says
         whether the phone rings; READ_CALL_LOG gives the ringing number (Android 9 and later) and the missed calls. -->
    <uses-permission android:name="android.permission.READ_PHONE_STATE" />
    <uses-permission android:name="android.permission.READ_CALL_LOG" />
```

- [ ] **Step 4: Run the Android suite and the build.** Expected: tests PASS, APK builds.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): tell who is calling and today's missed calls, only when asked, and never to the AI"
```

---

### Task 8: Android reads out recent notifications

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/notify/Notifs.kt` (pure: `Notif`, `notifFrom`, `NotifStore`,
  `notifsLine`, `NotifReading`, `NotifReader`)
- Create: `android/app/src/main/java/com/akshatgg/buddy/notify/BuddyNotifications.kt` (the `NotificationListenerService`)
- Modify: `AndroidManifest.xml` (the service), `android/app/src/main/res/values/strings.xml` (its label), `AppGraph.kt`,
  `PanelModel.kt` (constructor, AskInput `canReadNotifs`, `finish`, `tellCalls` → `showTold`, SETTINGS_ERRORS),
  `ChatHost.kt`, `SheetActions.kt`
- Test: create `android/app/src/test/java/com/akshatgg/buddy/notify/NotifsTest.kt`; modify `PanelModelTest.kt`

**Interfaces:**
- Consumes: `Told` (Task 7, `calls/CallInfo.kt`), `Chat.offRecord` (Task 7), `pickChat`/`Pick` (hey-buddy),
  `ChatReply.app` (Task 3), `ACTS` already holding `"notifs"` (Task 4).
- Produces:
  - `data class Notif(val key: String, val app: String, val title: String, val text: String, val at: Long)`
  - `fun notifFrom(key: String, pkg: String, own: String, ongoing: Boolean, summary: Boolean, category: String?, app: String, title: String?, text: String?, at: Long): Notif?`
    (null for Buddy's own, ongoing ones, group summaries, the `call`/`transport`/`progress` categories, and empty
    ones; text on one line, at most 200 characters; `app` falls back to `pkg`).
  - `class NotifStore(now: () -> Long = System::currentTimeMillis, max: Int = 50, keepMs: Long = 24 h)` with
    `add(n)`, `remove(key)`, `clear()`, `recent(): List<Notif>` (newest first, none older than 24 h). Thread-safe
    (`@Synchronized`): the listener writes on its thread, the panel reads on another.
  - `fun notifsLine(recent: List<Notif>, app: String): String`.
  - `fun interface NotifReading { suspend fun read(app: String): Told }`, real
    `NotifReader(on: () -> Boolean, recent: () -> List<Notif>)`.
  - `const val NOTIFS_OFF = "Turn on Notification access for Buddy so I can read your notifications."` (code
    `no_notifs`, Open Settings → Android's Notification access page).
  - `AppGraph.notifs: NotifStore`; `PanelModel(…, notifs: NotifReading = NotifReading { error("no notifications") })`
    after `callInfo`; AskInput sent with `canReadNotifs = true`.

  The copy, exactly:

  | When | Line | code |
  |---|---|---|
  | some | up to 5, newest first, joined by spaces: `Prince on WhatsApp: "Where are you?" Mom on WhatsApp: "Call me."` | |
  | one with no title | `Instagram: "New follower"` | |
  | one with no text | `Prince on WhatsApp.` | |
  | none | `No new notifications.` | |
  | none from the app named | `No new notifications from Instagram.` | |
  | access off | `Turn on Notification access for Buddy so I can read your notifications.` | `no_notifs` |
  | Android's list of listeners | `Buddy can read your notifications` (the service's label) | |

- [ ] **Step 1: Failing tests.** `NotifsTest.kt`:

```kotlin
package com.akshatgg.buddy.notify

import com.akshatgg.buddy.calls.Told
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class NotifsTest {
    private val hour = 60 * 60_000L
    private fun n(key: String, app: String, title: String, text: String, at: Long) = Notif(key, app, title, text, at)
    private fun from(pkg: String = "com.whatsapp", ongoing: Boolean = false, summary: Boolean = false, category: String? = "msg",
                     title: String? = "Prince", text: String? = "Where are you?") =
        notifFrom("k", pkg, "com.akshatgg.buddy", ongoing, summary, category, "WhatsApp", title, text, 1L)

    @Test fun aMessageIsKeptOnOneLineAtMost200Characters() {
        assertEquals(Notif("k", "WhatsApp", "Prince", "Where are you?", 1L), from())
        assertEquals("a b", from(text = " a\n\n b ")!!.text)
        assertEquals(200, from(text = "x".repeat(300))!!.text.length)
    }
    @Test fun buddysOwnOngoingSummariesCallsMusicProgressAndEmptyOnesAreSkipped() {
        assertNull(from(pkg = "com.akshatgg.buddy"))
        assertNull(from(ongoing = true))
        assertNull(from(summary = true))
        for (category in listOf("call", "transport", "progress")) assertNull(category, from(category = category))
        assertNull(from(title = " ", text = null))
    }
    @Test fun anAppWithNoLabelIsItsPackage() {
        assertEquals("com.x", notifFrom("k", "com.x", "com.akshatgg.buddy", false, false, null, " ", "T", "t", 1L)!!.app)
    }

    @Test fun theStoreKeepsTheLast50NewestFirstFor24Hours() {
        var now = 100 * hour
        val store = NotifStore(now = { now })
        for (i in 1..55) store.add(n("k$i", "A", "t$i", "x", now - (55 - i) * 1000L))
        assertEquals(50, store.recent().size)
        assertEquals("t55", store.recent().first().title)
        now += 25 * hour
        assertEquals(emptyList<Notif>(), store.recent())
    }
    @Test fun anUpdateReplacesAndARemovalForgets() {
        val store = NotifStore(now = { 10 * hour })
        store.add(n("a", "WhatsApp", "Prince", "1 message", 1L))
        store.add(n("a", "WhatsApp", "Prince", "2 messages", 2L))
        assertEquals(listOf("2 messages"), store.recent().map { it.text })
        store.remove("a")
        assertEquals(emptyList<Notif>(), store.recent())
    }

    @Test fun theLineNamesUpToFiveNewestFirst() {
        val list = listOf(n("1", "WhatsApp", "Prince", "Where are you?", 9L), n("2", "WhatsApp", "Mom", "Call me.", 8L))
        assertEquals("Prince on WhatsApp: \"Where are you?\" Mom on WhatsApp: \"Call me.\"", notifsLine(list, ""))
        val seven = (1..7).map { n("$it", "A", "T$it", "x", (10 - it).toLong()) }
        assertEquals(5, Regex("on A:").findAll(notifsLine(seven, "")).count())
    }
    @Test fun noTitleOrNoText() {
        assertEquals("Instagram: \"New follower\"", notifsLine(listOf(n("1", "Instagram", "", "New follower", 1L)), ""))
        assertEquals("Prince on WhatsApp.", notifsLine(listOf(n("1", "WhatsApp", "Prince", "", 1L)), ""))
    }
    @Test fun onlyTheAppTheyNamed() {
        val list = listOf(n("1", "WhatsApp", "Prince", "hi", 9L), n("2", "Instagram", "", "New follower", 8L))
        assertEquals("Instagram: \"New follower\"", notifsLine(list, "instagram"))
        assertEquals("No new notifications from Gmail.", notifsLine(list, "Gmail"))
        assertEquals("No new notifications.", notifsLine(emptyList(), ""))
    }
    @Test fun theReaderSaysWhenAccessIsOff() = runTest {
        assertEquals(Told(NOTIFS_OFF, "no_notifs"), NotifReader(on = { false }, recent = { error("not read") }).read(""))
        assertEquals(Told("No new notifications."), NotifReader(on = { true }, recent = { emptyList() }).read(""))
        assertEquals("Turn on Notification access for Buddy so I can read your notifications.", NOTIFS_OFF)
    }
}
```

  `PanelModelTest.kt`: a `FakeNotifs : NotifReading` (queued `Told`, `log += "notifs $app"`) passed as `notifs`;
  `canReadNotifs = true` in the AskInputs at :160, :340 and in the flags test; and tests:
  1. `ChatReply("notifs", "", "", …, app = "Instagram")` with `Told("Instagram: \"New follower\"")` adds
     `BuddySaid(2, "", "Instagram: \"New follower\"", emptyList(), emptyList())`; `log` has `notifs Instagram`.
  2. **Kept off the AI:** the next message's `AskInput.history` is `listOf(ChatTurn("you", "<what they typed>"))`.
  3. `Told(NOTIFS_OFF, "no_notifs")` is a `ChatError(_, NOTIFS_OFF, "no_notifs", listOf(SETTINGS))`, and SETTINGS
     calls `openSettings("no_notifs")`.

- [ ] **Step 2: Run and see them fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `notify/Notifs.kt`:

```kotlin
package com.akshatgg.buddy.notify

import com.akshatgg.buddy.calls.Told
import com.akshatgg.buddy.message.Pick
import com.akshatgg.buddy.message.pickChat

/** One notification as Buddy keeps it: which app, its title (usually who), its text on one line, and when. */
data class Notif(val key: String, val app: String, val title: String, val text: String, val at: Long)

private const val MAX_TEXT = 200
private const val SHOWN = 5
private val SPACES = Regex("\\s+")
// Notification.CATEGORY_CALL, CATEGORY_TRANSPORT (music), CATEGORY_PROGRESS (downloads): not what someone said.
private val SKIPPED = setOf("call", "transport", "progress")

private fun oneLine(text: String?) = text.orEmpty().replace(SPACES, " ").trim()

/**
 * A posted notification as Buddy keeps it, or null when it is not one to tell: Buddy's own, an ongoing one (music,
 * a call, a download, charging, USB), a group's summary (its messages come on their own too), a call, music or progress
 * one, or one with nothing in it.
 */
fun notifFrom(
    key: String, pkg: String, own: String, ongoing: Boolean, summary: Boolean, category: String?,
    app: String, title: String?, text: String?, at: Long,
): Notif? {
    if (pkg == own || ongoing || summary || category in SKIPPED) return null
    val who = oneLine(title)
    val said = oneLine(text).take(MAX_TEXT)
    if (who.isEmpty() && said.isEmpty()) return null
    return Notif(key, app.trim().ifEmpty { pkg }, who, said, at)
}

/**
 * The last 50 notifications, in memory only: never written down, synced or sent anywhere, and gone when Buddy's process
 * ends. Each goes after 24 hours, or when its app takes it away.
 */
class NotifStore(
    private val now: () -> Long = System::currentTimeMillis,
    private val max: Int = 50,
    private val keepMs: Long = 24 * 60 * 60_000L,
) {
    private val kept = ArrayList<Notif>()

    @Synchronized fun add(n: Notif) {
        kept.removeAll { it.key == n.key }
        kept += n
        kept.sortByDescending { it.at }
        while (kept.size > max) kept.removeAt(kept.lastIndex)
    }

    @Synchronized fun remove(key: String) {
        kept.removeAll { it.key == key }
    }

    @Synchronized fun clear() = kept.clear()

    /** Newest first, none older than a day. */
    @Synchronized fun recent(): List<Notif> {
        val from = now() - keepMs
        kept.removeAll { it.at < from }
        return kept.toList()
    }
}

private fun told(n: Notif) = when {
    n.title.isEmpty() -> "${n.app}: \"${n.text}\""
    n.text.isEmpty() -> "${n.title} on ${n.app}."
    else -> "${n.title} on ${n.app}: \"${n.text}\""
}

/**
 * The line Buddy says, built here on the phone: up to five, newest first; only the app they named when they named one
 * (found by the same rule as people, shared/message-pick.js).
 */
fun notifsLine(recent: List<Notif>, app: String): String {
    val asked = app.trim()
    val list = if (asked.isEmpty()) recent else {
        val wanted = when (val pick = pickChat(asked, recent.map { it.app }.distinct())) {
            is Pick.One -> setOf(pick.name)
            is Pick.Choose -> pick.names.toSet()
            else -> emptySet()
        }
        recent.filter { it.app in wanted }
    }
    if (list.isEmpty()) return if (asked.isEmpty()) "No new notifications." else "No new notifications from $asked."
    return list.take(SHOWN).joinToString(" ") { told(it) }
}

fun interface NotifReading {
    suspend fun read(app: String): Told
}

const val NOTIFS_OFF = "Turn on Notification access for Buddy so I can read your notifications."

/** "Who messaged me?": the line from the kept notifications, or how to turn Notification access on. */
class NotifReader(private val on: () -> Boolean, private val recent: () -> List<Notif>) : NotifReading {
    override suspend fun read(app: String): Told =
        if (!on()) Told(NOTIFS_OFF, "no_notifs") else Told(notifsLine(recent(), app))
}
```

  `notify/BuddyNotifications.kt`:

```kotlin
package com.akshatgg.buddy.notify

import android.app.Notification
import android.content.pm.PackageManager
import android.service.notification.NotificationListenerService
import android.service.notification.StatusBarNotification
import com.akshatgg.buddy.AppGraph

/**
 * Buddy can read your notifications: on only when the person turns it on in Android's Notification access settings.
 * Each notification posted goes into AppGraph's NotifStore (in memory only), and each one an app takes away leaves it.
 * Nothing is said or shown here: the chat reads the store when the person asks.
 */
class BuddyNotifications : NotificationListenerService() {
    private val store get() = AppGraph.instance.notifs

    override fun onListenerConnected() {
        store.clear()
        activeNotifications?.forEach(::keep) // what is in the shade already
    }

    override fun onListenerDisconnected() = store.clear()

    override fun onNotificationPosted(sbn: StatusBarNotification) = keep(sbn)

    override fun onNotificationRemoved(sbn: StatusBarNotification) = store.remove(sbn.key)

    private fun keep(sbn: StatusBarNotification) {
        val n = sbn.notification ?: return
        val extras = n.extras
        notifFrom(
            key = sbn.key, pkg = sbn.packageName, own = packageName, ongoing = sbn.isOngoing,
            summary = n.flags and Notification.FLAG_GROUP_SUMMARY != 0, category = n.category,
            app = labelOf(sbn.packageName),
            title = extras.getCharSequence(Notification.EXTRA_TITLE)?.toString(),
            text = (extras.getCharSequence(Notification.EXTRA_TEXT) ?: extras.getCharSequence(Notification.EXTRA_BIG_TEXT))?.toString(),
            at = sbn.postTime,
        )?.let(store::add)
    }

    /** The app's name. Android 11 and later show it for the apps the manifest's <queries> can see (the home screen's). */
    private fun labelOf(pkg: String): String = try {
        packageManager.getApplicationLabel(packageManager.getApplicationInfo(pkg, 0)).toString()
    } catch (e: PackageManager.NameNotFoundException) {
        pkg
    }
}
```

  Manifest, after LookService's `<service>`:

```xml
        <!-- Buddy can read your notifications: optional, turned on by the person in Android's Notification access
             settings. Only Android can bind it. What it hears stays in memory (notify/Notifs.kt NotifStore). -->
        <service
            android:name=".notify.BuddyNotifications"
            android:exported="true"
            android:label="@string/notifs_service_label"
            android:permission="android.permission.BIND_NOTIFICATION_LISTENER_SERVICE">
            <intent-filter>
                <action android:name="android.service.notification.NotificationListenerService" />
            </intent-filter>
        </service>
```

  strings.xml: `<string name="notifs_service_label">Buddy can read your notifications</string>`.

  AppGraph: `/** Notifications heard while Notification access is on, in memory only (notify/Notifs.kt). */ val notifs = NotifStore()`.

  PanelModel:
  - Constructor after `callInfo`: `private val notifs: NotifReading = NotifReading { error("no notifications") },`.
  - AskInput: `canReadNotifs = true, // this app can read the phone's notifications`.
  - Split the end of Task 7's `tellCalls` into a function both use:

```kotlin
    private suspend fun tellCalls(c: Chat, reply: ChatReply): Outcome =
        showTold(c, if (reply.what == "missed") callInfo.missed() else callInfo.ringing())

    /**
     * A line about the phone's calls or notifications: shown, but kept off the chat sent to the AI, as it names the
     * people who called or wrote. The AI's own `say` is left out: the line is the answer.
     */
    private fun showTold(c: Chat, told: Told): Outcome {
        if (c !== chat) return Outcome.GONE
        val code = told.code
        if (code != null) return stop(c, code, told.line, if (code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList())
        val line = add(c) { BuddySaid(it, "", told.line, emptyList(), emptyList()) }
        c.offRecord += line.id
        return Outcome.ANSWERED
    }
```

  - `finish()`: `if (reply.kind == "notifs") return showTold(c, notifs.read(reply.app))`.
  - SETTINGS_ERRORS: add `"no_notifs"` (doc line: "Notification access off").
  - `SheetActions.kt` `openSettingsFor`: `"no_notifs" -> Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS)` in the
    `android` `when` (it is Android's own page, opened in a task of its own like the others).
  - ChatHost: `notifs = NotifReader(on = { NotificationManagerCompat.getEnabledListenerPackages(app).contains(app.packageName) }, recent = graph.notifs::recent),`.

- [ ] **Step 4: Run the Android suite and the build.** Expected: tests PASS, APK builds.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): \"who messaged me?\" reads out the latest notifications, kept in memory only and never sent to the AI"
```

---

### Task 9: The Mac opens an app

**Files:**
- Create: `src/main/apps.js`, `test/apps.test.js`
- Modify: `src/main/actions.js` (createActions params :102-120, `answer` :392-394 and :438-443, `finish`, a new
  `startOpen`, a new `SECOND_ASK`), `src/main/main.js` (:209-234)
- Modify: `test/actions.test.js` (`setup` :23-170, `input` :199, new tests), `test/e2e/checks/40-panel.js:94`

**Interfaces:**
- Consumes: `pickChat` (hey-buddy), `appLine` (Task 1), `reply.app`.
- Produces:
  - `createApps({ dirs: string[], openPath: (path) => Promise<string>, readdir? }) -> { list(): {name, path}[], open(path): Promise<string> }`
    (`open` resolves `''` when it opened, else the system's reason), and `appDirs(home) -> string[]`.
  - `createActions({ …, apps = null })`: the Mac's apps; null on Windows.
  - Mac chat requests carry `canOpen: true`.
  - `SECOND_ASK = "Ask me that on its own, and I'll do it."` for `call`, `open`, `calls`, `notifs` from a second step.

  The copy, exactly: done → event `✅ Opened {name}`; pick lines from `appLine(asked, pick, 'Mac')`; the system could
  not open it → `I couldn't open {name}.`

- [ ] **Step 1: Failing tests.** `test/apps.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createApps, appDirs } = require('../src/main/apps');

function folder(tree) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-apps-'));
  for (const rel of tree) fs.mkdirSync(path.join(root, rel), { recursive: true });
  return root;
}

test('apps are the .app folders in each place, and one folder down, by name without ".app"', () => {
  const a = folder(['Safari.app/Contents', 'Utilities/Terminal.app', 'Utilities/Deep/Nope.app', '.Hidden.app', 'Notes.txt']);
  const b = folder(['Chrome Apps.localized/YouTube.app']);
  const apps = createApps({ dirs: [a, b, path.join(a, 'missing')], openPath: async () => '' });
  assert.deepStrictEqual(apps.list().map((x) => x.name).sort(), ['Safari', 'Terminal', 'YouTube']);
  assert.strictEqual(apps.list().find((x) => x.name === 'Terminal').path, path.join(a, 'Utilities', 'Terminal.app'));
});

test('open hands the path to the system and gives back its answer', async () => {
  const opened = [];
  const apps = createApps({ dirs: [], openPath: async (p) => { opened.push(p); return p.includes('Bad') ? 'gone' : ''; } });
  assert.strictEqual(await apps.open('/Applications/Safari.app'), '');
  assert.strictEqual(await apps.open('/Applications/Bad.app'), 'gone');
  assert.deepStrictEqual(opened, ['/Applications/Safari.app', '/Applications/Bad.app']);
});

test('the Mac keeps apps in three places', () => {
  assert.deepStrictEqual(appDirs('/Users/a'), ['/Applications', '/System/Applications', '/Users/a/Applications']);
});
```

  In `test/actions.test.js`:
  - `setup` gets `apps: givenApps = [{ name: 'Safari', path: '/Applications/Safari.app' }]` and `openFails = ''`, and
    passes `apps: windows ? null : { list: () => givenApps, open: async (p) => { log.push(['openApp', p]); return openFails; } }`.
  - `input` (:199) becomes `({ …, canMessage: true, canOpen: true, ...fields })`, and the "Mac says it can message"
    test (:2252) also checks `canOpen` both steps and its absence on Windows.
  - New tests:

```js
// Opening an app on the Mac

test('"open Safari" opens it at once and says so', async () => {
  const s = setup({ answers: [reply({ kind: 'open', app: 'safari', say: 'Opening it!' })], apps: [{ name: 'Safari', path: '/Applications/Safari.app' }, { name: 'Notes', path: '/System/Applications/Notes.app' }] });
  await s.actions.open();
  await s.actions.send('open safari');
  assert.deepStrictEqual(entries(s.log, 'openApp'), [['openApp', '/Applications/Safari.app']]);
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'buddy', say: 'Opening it!', text: '', notes: [], buttons: [] },
    { id: 3, type: 'event', text: '✅ Opened Safari', buttons: [] },
  ]);
  assert.strictEqual(moods(s.log).at(-1), 'happy');
});

test('an app that is not one app on the Mac says which or that it is not there, and opens nothing', async () => {
  const two = [{ name: 'Microsoft Word', path: '/a' }, { name: 'Microsoft Excel', path: '/b' }];
  const s = setup({ answers: [reply({ kind: 'open', app: 'Microsoft' }), reply({ kind: 'open', app: 'YouTube' })], apps: two });
  await s.actions.open();
  await s.actions.send('open microsoft');
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'buddy', say: '', text: 'Which one: Microsoft Word or Microsoft Excel?', notes: [], buttons: [] });
  await s.actions.send('open youtube');
  assert.deepStrictEqual(lastItem(s), { id: 4, type: 'buddy', say: '', text: "I couldn't find YouTube on this Mac.", notes: [], buttons: [] });
  assert.deepStrictEqual(entries(s.log, 'openApp'), []);
});

test('an app the Mac could not open says so', async () => {
  const s = setup({ answers: [reply({ kind: 'open', app: 'Safari' })], openFails: 'The application cannot be opened.' });
  await s.actions.open();
  await s.actions.send('open safari');
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'buddy', say: '', text: "I couldn't open Safari.", notes: [], buttons: [] });
});

test('an open, a call, calls or notifs answered after reading the box are not done: Buddy asks for their own words', async () => {
  for (const second of [reply({ kind: 'open', app: 'Safari' }), reply({ kind: 'call', to: 'Prince', how: 'whatsapp' }), reply({ kind: 'calls', what: 'now' }), reply({ kind: 'notifs', app: '' })]) {
    const s = setup({ replies: { captureSelection: (args) => ({ text: args.selectAll ? 'open safari' : '' }) }, answers: [reply({ kind: 'box' }), second] });
    await s.actions.open();
    await s.actions.send('do what it says');
    assert.deepStrictEqual(lastItem(s), { id: 3, type: 'buddy', say: "Ask me that on its own, and I'll do it.", text: '', notes: [], buttons: [] }, second.kind);
    assert.deepStrictEqual(entries(s.log, 'openApp'), []);
  }
});
```

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/apps.test.js test/actions.test.js`
Expected: FAIL (`../src/main/apps` not found; no `canOpen`; the open shows as a written answer).

- [ ] **Step 3: Implement** `src/main/apps.js`:

```js
'use strict';

/**
 * The apps on this Mac, for "open Safari": the .app folders in the Mac's app folders and one folder down
 * (Utilities, an app maker's folder, Chrome's web apps), by name without ".app". Opening one is the system's
 * (shell.openPath), as a double-click in the Finder would.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Where the Mac keeps apps: for everyone, the system's own, and the person's. */
function appDirs(home) {
  return ['/Applications', '/System/Applications', path.join(home, 'Applications')];
}

function createApps({ dirs, openPath, readdir = (dir) => fs.readdirSync(dir, { withFileTypes: true }) }) {
  function inside(dir, depth) {
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      return []; // not there, or not readable: no apps from it
    }
    const found = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith('.app')) found.push({ name: entry.name.slice(0, -'.app'.length), path: full });
      else if (depth === 0 && entry.isDirectory()) found.push(...inside(full, 1));
    }
    return found;
  }
  return {
    list: () => dirs.flatMap((dir) => inside(dir, 0)),
    /** '' when it opened, else the system's reason. */
    open: (appPath) => openPath(appPath),
  };
}

module.exports = { createApps, appDirs };
```

  actions.js:
  - `const { contactLine, appLine } = require('../../shared/pick-lines');` (only `appLine` is used: import only it).
  - Params: `apps = null,` with the doc line "`apps` is apps.js's list of this Mac's apps and the way to open one; none
    on Windows."
  - `answer()`: after the canMessage line, `if (system === 'darwin') asked.canOpen = true; // the Mac opens apps`.
  - Constant next to MESSAGE_ASK: `const SECOND_ASK = "Ask me that on its own, and I'll do it.";`, and after the
    second-step message block:

```js
    // The same for a call, an app to open, their calls or notifications: Buddy does these by itself, so only from
    // their own words.
    if (second && ['call', 'open', 'calls', 'notifs'].includes(reply.kind)) {
      add(c, { type: 'buddy', say: SECOND_ASK, text: '', notes: [], buttons: [] });
      return true;
    }
```

  - `finish()`, after the elsewhere block (Task 2): `if (reply.kind === 'open') return startOpen(c, reply);`

```js
  /** "Open Safari": opened at once, no question; the chat says it was, or which one, or why not. */
  async function startOpen(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    const found = apps.list();
    const pick = pickChat(reply.app, found.map((app) => app.name));
    const line = appLine(reply.app, pick, 'Mac');
    if (line) {
      add(c, { type: 'buddy', say: '', text: line, notes: [], buttons: [] });
      return true;
    }
    const app = found.find((a) => a.name === pick.name);
    const problem = await apps.open(app.path);
    if (problem) add(c, { type: 'buddy', say: '', text: `I couldn't open ${app.name}.`, notes: [], buttons: [] });
    else add(c, { type: 'event', text: `✅ Opened ${app.name}`, buttons: [] });
    return true;
  }
```

  (`finish` sends `open` here only on the Mac: Windows took the elsewhere branch first.)
  - main.js: `const { createApps, appDirs } = require('./apps');`, and in `createActions({ … })`:

```js
    // "Open Safari": the Mac's apps, opened as the Finder would. Windows has none (yet).
    apps: process.platform === 'darwin' ? createApps({ dirs: appDirs(app.getPath('home')), openPath: (p) => shell.openPath(p) }) : null,
```

  - `test/e2e/checks/40-panel.js:94`: `...(process.platform === 'darwin' ? { canMessage: true, canOpen: true } : {}),`.

- [ ] **Step 4: Run and see them pass**

Run: `npm test`, then (not at the same time) `BUDDY_E2E_ONLY=40-panel npm run test:e2e`
Expected: PASS, PASS.

- [ ] **Step 5: Commit**

```bash
git add src/main/apps.js src/main/actions.js src/main/main.js test/apps.test.js test/actions.test.js test/e2e/checks/40-panel.js
git commit -m "feat(mac): \"open Safari\" opens it, or asks which one"
```

---

### Task 10: The Mac makes WhatsApp calls

**Files:**
- Modify: `src/native/BuddyHelper.swift` (after merging hey-buddy: a new `waOpenChat` factored out of `waSend`, a new
  `waCall`, one `case` in `handle`)
- Modify: `src/main/helper.js:29-30` (`waCall: 20_000`), `test/helper.test.js` (:194-250)
- Modify: `src/main/actions.js` (`answer` canCall, `startMessage` → `findWhatsAppChat`, a new `startCall`,
  `placeCall`, `act` :786-829), `src/renderer/panel/chat-view.js` (LABELS :16-30, PRIMARY :32)
- Modify: `test/actions.test.js`, `test/chat-view.test.js` (:9, :95), `test/e2e/checks/40-panel.js` (:94, one call round)

**Interfaces:**
- Consumes: `whatsAppReady`, `waSearch`, `pressRow`, `waHeader`, `plainName`, `whatsAppWindow`, `axFind`, `axId`,
  `frontPid`, `HelperError`, `waChatNotFound`, `waWrongChat` (hey-buddy, as merged); `pickChat`/`pickLine`/`sameName`.
- Produces:
  - Swift `func waOpenChat(_ pid: pid_t, _ ax: AXUIElement, _ name: String) throws -> String` (the header), used by
    `waSend` and `waCall`. **Merge-conflict risk with hey-buddy:** it moves waSend's "search, press the row, wait for
    the header" block into a function; if hey-buddy changes that block again, redo the move on top of its version.
  - `helper.call('waCall', { name, video })` → `{ chat }`. Errors (code → message):
    - `no_whatsapp` → `Install WhatsApp for Mac and I can call from here.`
    - `whatsapp_not_ready`, `chat_not_found` → hey-buddy's lines
    - `wrong_chat` → `That opened the wrong chat, so I didn't call.`
    - `not_called` → `I couldn't press Call. Call from WhatsApp yourself.`
    - `call_unsure` → `I'm not sure the call started. Check WhatsApp.`
  - actions.js: `findWhatsAppChat(c, to) -> Promise<{ answered: boolean, name?: string }>`; the card
    `{ type: 'question', text: 'WhatsApp call Prince Sharma?' | 'WhatsApp video call Prince Sharma?', buttons: ['call', 'not-now'], call: { name, video } }`
    (`call` is main-only, like `message`); button `'call'` labelled "Call", primary.
  - Mac chat requests carry `canCall: true`.

  The copy, exactly: card as above; called → event `📞 Calling {name} on WhatsApp` / `📹 Video calling {name} on WhatsApp`,
  mood `celebrate`; `call_unsure` or no answer from the helper (`timeout`, `helper_exit`) → event
  `I'm not sure the call started. Check WhatsApp.` and the bubble says it (card gone, no second call); any other error →
  `failed(c, err)`, the card stays; Not now → event `Okay, not now.`; a phone call stays Task 2's line.

- [ ] **Step 1: Bring in hey-buddy's WhatsApp search fix.**

Run: `git merge --no-edit hey-buddy`
Expected: a clean merge of `fix(mac): find WhatsApp chats the way WhatsApp for Mac really shows them` (only
`src/native/BuddyHelper.swift` changes) and any later hey-buddy commits. If it conflicts, stop and ask: the other
session's work must not be undone. Then `npm test` (PASS).

- [ ] **Step 2: Write the Swift.** Move waSend's open-and-check block into a function, without changing what it does:

```swift
/// Opens the chat called `name` from WhatsApp's search and waits until its header says so: the header's name. Shared
/// by waSend and waCall, so a message and a call go to a chat the same way.
func waOpenChat(_ pid: pid_t, _ ax: AXUIElement, _ name: String) throws -> String {
    let same = { (other: String) in plainName(other) == plainName(name) }
    guard let row = try waSearch(pid, ax, name).first(where: { same($0.name) })?.row, pressRow(row) else { throw waChatNotFound }
    var header = ""
    let opened = Date().addingTimeInterval(4)
    repeat {
        usleep(250_000)
        header = waHeader(ax)
    } while !same(header) && Date() < opened
    guard same(header) else { throw waWrongChat }
    return header
}
```

  In `waSend`, replace that block (from `let same = …` through `guard same(header) else { throw waWrongChat }`) with
  `let header = try waOpenChat(pid, ax, name)`. If the merged `waSend` still uses `same` further down, keep its
  `let same` line. Then, after `waSend`:

```swift
// The open chat's call buttons on WhatsApp 26.41 (the calls spec): voice, and video (a button, or a menu on some chats).
let waVoiceCallId = "NavigationBar_CallButton"
let waVideoCallIds = ["NavigationBar_VideoCallButton", "NavigationBar_VideoDropdownButton"]
let waNotCalled = HelperError(code: "not_called", message: "I couldn't press Call. Call from WhatsApp yourself.")

/// waCall { name, video }: opens the chat called `name` (as waSend does), checks its header, and presses its voice or
/// video call button once. Called means WhatsApp opened a window of its own for the call within 4 seconds; otherwise
/// Buddy cannot tell (`call_unsure`). Nothing is pressed after 15 seconds: Buddy gives up at 20 (src/main/helper.js).
func waCall(_ args: [String: Any]) throws -> [String: Any] {
    let name = (args["name"] as? String ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
    let video = args["video"] as? Bool ?? false
    guard !name.isEmpty else { throw HelperError(code: "bad_request", message: "name is missing") }
    let started = Date()
    let pid: pid_t
    let ax: AXUIElement
    let header: String
    do {
        (pid, ax) = try whatsAppReady()
        header = try waOpenChat(pid, ax, name)
    } catch let error as HelperError where error.code == "no_whatsapp" {
        throw HelperError(code: "no_whatsapp", message: "Install WhatsApp for Mac and I can call from here.")
    } catch let error as HelperError where error.code == "wrong_chat" {
        throw HelperError(code: "wrong_chat", message: "That opened the wrong chat, so I didn't call.")
    } catch {
        throw error
    }
    guard let window = whatsAppWindow(ax) else { throw waNotCalled }
    let ids = video ? waVideoCallIds : [waVoiceCallId]
    guard let button = ids.lazy.compactMap({ id in axFind(window, { axId($0) == id }) }).first else { throw waNotCalled }
    // Still that chat, WhatsApp in front, and time left.
    guard waHeader(ax) == header, frontPid() == pid, Date().timeIntervalSince(started) < 15 else { throw waNotCalled }
    let windowsBefore = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.count ?? 0
    guard AXUIElementPerformAction(button, kAXPressAction as CFString) == .success else { throw waNotCalled }
    if axId(button) == "NavigationBar_VideoDropdownButton" {
        // A menu: its "Video call" item (Task 10 Step 5 confirms the title on the owner's Mac).
        var item: AXUIElement?
        let shown = Date().addingTimeInterval(1)
        repeat {
            usleep(100_000)
            item = axFind(ax, { axString($0, kAXRoleAttribute) == "AXMenuItem" && axString($0, kAXTitleAttribute).contains("Video call") })
        } while item == nil && Date() < shown
        guard let videoItem = item, AXUIElementPerformAction(videoItem, kAXPressAction as CFString) == .success else { throw waNotCalled }
    }
    let by = Date().addingTimeInterval(4)
    repeat {
        if ((axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.count ?? 0) > windowsBefore { return ["chat": header] }
        usleep(200_000)
    } while Date() < by
    throw HelperError(code: "call_unsure", message: "I'm not sure the call started. Check WhatsApp.")
}
```

  (`axFind` on `ax` walks the app's whole tree, 30 deep: fine for a menu that just opened. If the merged file names
  `axString` or `axAttr` differently, use its names.) In `handle`: `case "waCall": result = try waCall(args)`.

Run: `npm run build:native`
Expected: builds `bin/buddy-helper` with no errors.

- [ ] **Step 3: JS side, failing tests first.**
  - `test/helper.test.js`: add `waCall: 20_000` to the DEFAULT_TIMEOUTS expectation (:195-204, and its title: "…; WhatsApp
    15 to find and 20 to send or call; …"), and a test in the style of :207-225:

```js
test('waCall: what a WhatsApp call asks of the helper, and what comes back', async () => {
  const { helper, child } = started();
  const called = helper.call('waCall', { name: 'Prince Sharma', video: true });
  const unsure = helper.call('waCall', { name: 'Prince Sharma', video: false });
  await tick();
  assert.deepStrictEqual(child.written, [
    { id: 1, cmd: 'waCall', args: { name: 'Prince Sharma', video: true } },
    { id: 2, cmd: 'waCall', args: { name: 'Prince Sharma', video: false } },
  ]);
  child.reply({ id: 1, ok: true, result: { chat: 'Prince Sharma' } });
  child.reply({ id: 2, ok: false, error: { code: 'call_unsure', message: "I'm not sure the call started. Check WhatsApp." } });
  assert.deepStrictEqual(await called, { chat: 'Prince Sharma' });
  await assert.rejects(unsure, { code: 'call_unsure' });
  helper.stop();
});
```

  - `test/chat-view.test.js`: add `'call'` to the label list at :9 (expecting `'Call'`), and
    `itemParts({ id: 11, type: 'question', text: 'WhatsApp call Prince Sharma?', buttons: ['call', 'not-now'] }).buttons`
    → `[{ button: 'call', label: 'Call', primary: true }, { button: 'not-now', label: 'Not now', primary: false }]`.
  - `test/actions.test.js`: `input` gets `canCall: true`; the Mac/Windows flags test checks `canCall` too; and:

```js
// A WhatsApp call on the Mac: found as for a message, called only on Call

const waCalls = (s) => entries(s.log, 'helper').filter((e) => e[1] === 'waCall');

test('a WhatsApp call: Buddy finds the chat, comes back and asks before calling', async () => {
  const s = setup({ answers: [calling({ how: 'whatsapp_video', say: 'Sure!' })], replies: { waFind: { chats: ['Prince Sharma', 'Rahul'] } } });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('video call prince on whatsapp');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'waFind', 'showPanel']);
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'buddy', say: 'Sure!', text: '', notes: [], buttons: [] },
    { id: 3, type: 'question', text: 'WhatsApp video call Prince Sharma?', buttons: ['call', 'not-now'] },
  ]);
  assert.strictEqual(waCalls(s).length, 0, 'nothing is called before Call');
});

test('Call: the helper calls that chat; the card says so; a called card cannot call again', async () => {
  const s = setup({ answers: [calling({ how: 'whatsapp' })], replies: { waFind: { chats: ['Prince Sharma'] }, waCall: { chat: 'Prince Sharma' } } });
  await s.actions.open();
  await s.actions.send('whatsapp call prince');
  const card = lastItem(s);
  const from = s.log.length;
  assert.deepStrictEqual(await s.actions.act(card.id, 'call'), {});
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'waCall']);
  assert.deepStrictEqual(waCalls(s).at(-1), ['helper', 'waCall', { name: 'Prince Sharma', video: false }]);
  assert.deepStrictEqual(lastItem(s), { id: card.id, type: 'event', text: '📞 Calling Prince Sharma on WhatsApp', buttons: [] });
  assert.strictEqual(moods(s.log).at(-1), 'celebrate');
  await assert.rejects(s.actions.act(card.id, 'call'), { code: 'bad_request' });
  assert.strictEqual(waCalls(s).length, 1);
});

test('a call Buddy cannot be sure of takes the card away; one that did not happen keeps it', async () => {
  for (const [error, gone] of [[failure('call_unsure', "I'm not sure the call started. Check WhatsApp."), true], [failure('timeout', 'x'), true], [failure('wrong_chat', "That opened the wrong chat, so I didn't call."), false]]) {
    const s = setup({ answers: [calling({ how: 'whatsapp' })], replies: { waFind: { chats: ['Prince Sharma'] }, waCall: error } });
    await s.actions.open();
    await s.actions.send('whatsapp call prince');
    const card = lastItem(s);
    await s.actions.act(card.id, 'call');
    const now = chatOf(s).find((i) => i.id === card.id);
    if (gone) {
      assert.deepStrictEqual(now, { id: card.id, type: 'event', text: "I'm not sure the call started. Check WhatsApp.", buttons: [] }, error.code);
      assert.deepStrictEqual(entries(s.log, 'bubble').at(-1), ['bubble', "I'm not sure the call started. Check WhatsApp."]);
    } else {
      assert.strictEqual(now.type, 'question', error.code);
      assert.strictEqual(lastItem(s).text, "That opened the wrong chat, so I didn't call.");
    }
  }
});

test('Not now on a call card calls nobody', async () => {
  const s = setup({ answers: [calling({ how: 'whatsapp' })], replies: { waFind: { chats: ['Prince Sharma'] } } });
  await s.actions.open();
  await s.actions.send('whatsapp call prince');
  const card = lastItem(s);
  await s.actions.act(card.id, 'not-now');
  assert.deepStrictEqual(lastItem(s), { id: card.id, type: 'event', text: 'Okay, not now.', buttons: [] });
  assert.strictEqual(waCalls(s).length, 0);
});

test('a WhatsApp call to someone WhatsApp does not know, or twice, gets the message lines', async () => {
  const s = setup({ answers: [calling({ to: 'Zoya', how: 'whatsapp' }), calling({ to: 'Prince', how: 'whatsapp' })], replies: { waFind: (args) => ({ chats: args.name === 'Zoya' ? [] : ['Prince Sharma', 'Prince Kumar'] }) } });
  await s.actions.open();
  await s.actions.send('whatsapp call zoya');
  assert.strictEqual(lastItem(s).text, "I couldn't find Zoya on WhatsApp.");
  await s.actions.send('whatsapp call prince');
  assert.strictEqual(lastItem(s).text, 'Which Prince: Prince Sharma or Prince Kumar? Tell me the full name.');
});

test('the card keeps who it calls to the main side: the page never gets it', async () => {
  const s = setup({ answers: [calling({ how: 'whatsapp' })], replies: { waFind: { chats: ['Prince Sharma'] } } });
  await s.actions.open();
  await s.actions.send('whatsapp call prince');
  const states = [...entries(s.log, 'state'), ...entries(s.log, 'showPanel')].map((e) => e[1]);
  for (const state of states) for (const item of state.chat) assert.strictEqual(Object.hasOwn(item, 'call'), false);
});
```

  (Also check that every existing message test still passes unchanged after the `findWhatsAppChat` move below.)

Run: `node --test test/helper.test.js test/chat-view.test.js test/actions.test.js`
Expected: the new tests FAIL.

- [ ] **Step 4: Implement the JS.**
  - helper.js DEFAULT_TIMEOUTS: `waCall: 20_000,` after `waSend` (comment: "…, its chat opened and its call
    started first").
  - chat-view.js: `call: 'Call', // a WhatsApp call, on its card "WhatsApp call Prince Sharma?"` in LABELS; `'call'`
    in PRIMARY.
  - actions.js: `answer()`: `if (system === 'darwin') asked.canCall = true; // the Mac makes WhatsApp calls (a phone call says it can't)`.
    Constant: `const CALL_UNSURE = "I'm not sure the call started. Check WhatsApp.";`. Move the search part of
    `startMessage` into `findWhatsAppChat`, with no change to what a message does:

```js
  /**
   * Who `to` is in WhatsApp's search, for a message or a call. WhatsApp comes to the front for it, so only while the
   * person is still with Buddy. `answered` false: Buddy stopped short (the reason is in the chat). Otherwise `name` is
   * the one chat, or missing when the chat says which one or why not.
   */
  async function findWhatsAppChat(c, to) {
    let found;
    try {
      found = await inApp(async () => {
        if (!present(c)) return null;
        return (await stepAside(() => helper.call('waFind', { name: to }))) || {};
      }, { wait: true });
    } catch (err) {
      failed(c, err);
      await comeBack(c);
      return { answered: false };
    }
    if (found === null) {
      // The person hid the panel meanwhile: WhatsApp is left alone, and the bubble says there is something to read.
      if (c === chat) ui.bubble(READY);
      add(c, { type: 'buddy', say: 'Open me again and ask once more, so I can look in WhatsApp.', text: '', notes: [], buttons: [] });
      return { answered: false };
    }
    const names = (list) => (Array.isArray(list) ? list.filter((name) => typeof name === 'string') : null);
    const chats = names(found.chats) || [];
    // WhatsApp's search also lists a message found in a chat under that chat's name: only the rows that are chats or
    // contacts (`exact`) can be two chats with one name. A helper from before `exact`, or an `exact` with no row of
    // the picked name, counts every row.
    const exact = names(found.exact) || chats;
    const pick = pickChat(to, chats);
    const rows = pick && exact.some((name) => sameName(name, pick.name)) ? exact : chats;
    const line = pickLine(to, pick);
    if (line) {
      add(c, { type: 'buddy', say: '', text: line, notes: [], buttons: [] });
      return { answered: true };
    }
    if (rows.filter((name) => sameName(name, pick.name)).length > 1) {
      const text = `You have more than one chat called ${pick.name}. Rename one in WhatsApp, then ask me again.`;
      add(c, { type: 'buddy', say: '', text, notes: [], buttons: [] });
      return { answered: true };
    }
    return { answered: true, name: pick.name };
  }

  async function startMessage(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    if (system === 'win32') {
      add(c, { type: 'buddy', say: '', text: MESSAGE_ELSEWHERE, notes: [], buttons: [] });
      return true;
    }
    const found = await findWhatsAppChat(c, reply.to);
    if (!found.answered) return false;
    if (found.name) add(c, { type: 'question', text: `To ${found.name}: ${reply.text}`, buttons: ['send-message', 'not-now'], message: { name: found.name, text: reply.text } });
    await comeBack(c);
    return true;
  }

  /** "WhatsApp call Prince": found as for a message, then "WhatsApp call Prince Sharma?" with Call and Not now. */
  async function startCall(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    const found = await findWhatsAppChat(c, reply.to);
    if (!found.answered) return false;
    if (found.name) {
      const video = reply.how === 'whatsapp_video';
      add(c, { type: 'question', text: `WhatsApp ${video ? 'video call' : 'call'} ${found.name}?`, buttons: ['call', 'not-now'], call: { name: found.name, video } });
    }
    await comeBack(c);
    return true;
  }

  /**
   * Call on a WhatsApp call card: the helper opens that chat, checks it and presses its call button, once. `calling`
   * keeps Not now off the card meanwhile. One that did not happen leaves the card, to try again; one Buddy cannot be
   * sure of takes the card away: no second call.
   */
  async function placeCall(c, item) {
    item.calling = true;
    try {
      await stepAside(() => helper.call('waCall', item.call));
    } catch (err) {
      const code = err instanceof BuddyError ? err.code : '';
      if (code === 'call_unsure' || UNKNOWN_END.includes(code)) {
        swap(c, item, { type: 'event', text: CALL_UNSURE, buttons: [] });
        ui.bubble(CALL_UNSURE);
      } else {
        failed(c, err); // the card stays, to try again
      }
      await comeBack(c);
      return;
    } finally {
      item.calling = false;
    }
    swap(c, item, { type: 'event', text: `${item.call.video ? '📹 Video calling' : '📞 Calling'} ${item.call.name} on WhatsApp`, buttons: [] });
    if (c === chat) ui.mood('celebrate'); // not for a chat closed meanwhile, as for a message
    push(c);
  }
```

    `finish()`, after the open line: `if (reply.kind === 'call') return startCall(c, reply);` (a phone call took the
    elsewhere branch first).
  - `act()`: after the `send-message` branch, `} else if (button === 'call') { await inApp(() => placeCall(c, item));`;
    the guard becomes `} else if (button === 'not-now' && (item.sending || item.calling)) {`; and before the job's
    `not-now` branch:

```js
    } else if (button === 'not-now' && item.call) {
      swap(c, item, { type: 'event', text: 'Okay, not now.', buttons: [] });
      push(c);
```

  - e2e (`test/e2e/checks/40-panel.js`): `canCall: true` in the darwin input at :94, and after the message round
    (:186-201), on the Mac only, one call round in the same style: push `reply({ kind: 'call', to: 'Prince', how: 'whatsapp' })`,
    set `ctx.helper.replies.waFind = { chats: ['Prince Sharma'] }` and `ctx.helper.replies.waCall = { chat: 'Prince Sharma' }`,
    type "whatsapp call prince", wait for "WhatsApp call Prince Sharma?", check the buttons are `['Call', 'Not now']`
    and no `waCall` yet, click "Call", wait for "📞 Calling Prince Sharma on WhatsApp", check the one `waCall` was
    `{ name: 'Prince Sharma', video: false }`, then delete both replies.

Run: `npm test`, then (not at the same time) `BUDDY_E2E_ONLY=40-panel npm run test:e2e`
Expected: PASS, PASS.

- [ ] **Step 5: Look at WhatsApp's call buttons on the owner's Mac (device values, read-only).** Only with the owner's
  OK said in this session (WhatsApp comes to the front; **no call is made**): open a chat in WhatsApp by hand, then
  with Accessibility Inspector (Xcode → Open Developer Tool) check that the header's call buttons have the ids
  `NavigationBar_CallButton` and `NavigationBar_VideoCallButton` or `NavigationBar_VideoDropdownButton`, and, for the
  dropdown, the title of its video item. Fix the ids or the "Video call" title in the Swift if they differ, rebuild,
  and say so in the commit body. Do **not** run `waCall` here: it calls someone. The owner does that in Task 11.

- [ ] **Step 6: Commit**

```bash
git add src/native/BuddyHelper.swift src/main/helper.js src/main/actions.js src/renderer/panel/chat-view.js test
git commit -m "feat(mac): WhatsApp voice and video calls from the chat: ask first, check the chat, press Call"
```

---

### Task 11: Checks on the owner's devices, then the PR

- [ ] **Step 1: Everything green.** `npm test`, then `npm run test:e2e` (one after the other), the Android unit tests
  and the Android debug build. All PASS.
- [ ] **Step 2: Android by hand (the owner, with a test contact they choose).** Install the debug APK. Check:
  1. "call <test contact>" → card **Call <full name>?**; Not now calls nobody; Call asks once for calls (with the
     line before it) and rings the contact. A name with two contacts asks "Which …?"; a name not there says "I
     couldn't find … in your contacts."
  2. "WhatsApp call <test contact>" and "video call <test contact> on WhatsApp" → the card, then the call in
     WhatsApp. If WhatsApp asks its own question, Buddy answers it only for that person. With "Buddy can type for you"
     off: the chat is open and the Accessibility line shows.
  3. "open YouTube", "open camera", "open settings" → each opens at once; "open microsoft" (or any two-app name)
     asks which one.
  4. With a second phone ringing this one: "who is calling me?" → the name (or number); after it stops: "Nobody is
     calling right now." With the bubble off: "Someone is calling, but I can't see who."
  5. After missing a call: "any missed calls?" → the line with the name and time. Refuse Call logs once: the refusal
     line with Open Settings. If Android shows Call logs as a restricted setting, note it for the README.
  6. After a "who is calling" answer, ask "who was that?": the AI must not know the name (the line is kept off the
     history).
  7. "who messaged me?" with Notification access off → the line with Open Settings, which opens Notification access
     (note whether Android shows it as a restricted setting for the sideloaded APK, and what unlocks it). Turned on,
     after a WhatsApp message and an Instagram notification: "who messaged me?" names both, newest first; "what's the
     Instagram notification about?" only Instagram's; "any Gmail notifications?" → "No new notifications from Gmail.".
     Music playing and a download in progress are not in the line. After the answer, "who was that?": the AI must not
     know.
- [ ] **Step 3: Mac by hand (the owner).** `cd ~/projects/buddy-calls && npm start`. Check: "WhatsApp call <test
  contact>" → card, Call → WhatsApp calls them and the card says so; "video call … on WhatsApp" the same; "call
  <test contact>" → "I can only make phone calls from your phone."; "who is calling me?" → "I can only see calls on
  your phone."; "open Safari", "open Notes", "open Terminal" open; "open YouTube" → "I couldn't find YouTube on this
  Mac." (unless it is installed as an app).
- [ ] **Step 4: iPhone web app and Windows lines.** On buddy.akshatgg.in/app (after deploy, or a local `npm run
  sync:web-app` page) and on Windows (the owner): "call Prince", "open YouTube", "any missed calls?" and "who messaged
  me?" give the lines of the table. On the Mac, "who messaged me?" gives "I can only read notifications on your phone."
- [ ] **Step 5: Fix what the owner finds** (each fix with a test), then push and open the PR to `master` with
  `gh pr create`. Title: "Calls, WhatsApp calls, opening apps, who's calling and notifications (Android + Mac)". The body is a plain
  summary of what it does and how it was checked. **No attribution lines.**

---

## Decisions where the spec was open

- **Windows and the iPhone send no new flags**, as for `canMessage` (the spec: "older apps and other platforms never
  get them"). Their exact lines still show: each rule's "otherwise" words are the table's lines, and the code turns any
  answer of the kind into the same line. The Mac sends `canOpen` and `canCall` (WhatsApp calls; a phone call gets its
  line in code) but not `canSeeCalls` or `canReadNotifs`.
- **The ringing number comes from the phone-state broadcast, not TelephonyCallback**: on Android 12+ TelephonyCallback
  gives no number. Without the bubble running, Buddy knows that the phone rings but not who.
- **Missed calls are listed newest first**, as the spec's rule says; the spec's example lists them oldest first.
- **Contacts are asked as hey-buddy asks them** (no line before Android's question); the new permissions get one.
  Who's calling and missed calls use Contacts only when already allowed, so no third question while the phone rings.
- **The AI's `say` is not shown** with an elsewhere line, a calls line or a notifications line; it is shown before a
  card and before an opened app, as for messages.
- **A call by another app** ("FaceTime Prince") is `I can call by phone or on WhatsApp for now.`; `what` other than
  `missed` is `now`.

## New copy for the owner to OK

These user-facing lines are not in the spec; they follow its plain short English. (The spec's own lines are used as
written.)

1. `I can call by phone or on WhatsApp for now.` (a call asked through another app)
2. `Ask me that on its own, and I'll do it.` (a call, an app or calls from a second step)
3. `I couldn't find Prince in your contacts.` (a phone call to nobody in the contacts)
4. `I found lots of apps called a. Tell me the full name.` (more than four apps fit)
5. `I couldn't open Safari.` (the app was found but would not start)
6. `Okay, not now.` (Not now on a call card; already Buddy's line for a job)
7. `This phone can't make calls.` (no phone line, e.g. a tablet)
8. `I need your OK to make calls.` (before Android asks for calls)
9. `I need your OK to see who is calling.` (before Android asks for the phone state)
10. `I need your OK to see your calls.` (before Android asks for the call log)
11. `I need permission to see your calls. You can allow it in Settings.` (call log or phone state refused)
12. `📞 Calling Prince Sharma` (a phone call started; the spec gives the WhatsApp one)
13. `📹 Video calling Prince Sharma on WhatsApp` (a video call started)
14. `It's open in WhatsApp. Turn on Buddy in Accessibility so I can press Call for you.`
15. `WhatsApp didn't open Prince Sharma's chat, so I didn't call.`
16. `That opened the wrong chat, so I didn't call.`
17. `I couldn't press Call. Call from WhatsApp yourself.`
18. `WhatsApp asked to call someone else, so I didn't.`
19. `Install WhatsApp for Mac and I can call from here.`
20. `Someone is calling, but I can't see who.` (ringing, number hidden or not heard)
21. `Unknown number` (a hidden number in the missed-calls line)
22. `1 missed call today: Prince Sharma at 3:10 pm.` (the one-call form; and `… and 2 more.` after five names)
23. `✅ Opened YouTube` (the spec says "✅ Opened YouTube" for Android; used on the Mac too)
24. `Instagram: "New follower"` (a notification with no title: the app, then its text)
25. `Prince on WhatsApp.` (a notification with no text)

Lines to the AI only (never shown): `Buddy can make calls from here.`, `Buddy can open apps from here.`,
`Buddy can see their calls from here.`, `Buddy can read their notifications from here.`, and the four new rules in
SYSTEM.chat (Task 1).
