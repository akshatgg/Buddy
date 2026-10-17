# Hey Buddy: listening face + answer bubble Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or
> superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** After "Hey <name>" Buddy's face listens (with "Yes?") and then thinks; a hands-free answer no longer opens
the chat panel: Buddy speaks it and a small speech bubble beside Buddy shows the text (cut with "…"), held while
speaking and gone 8 s after; a click/tap on it (or on Buddy while it shows) opens the full chat on that conversation.
Card questions and errors show in the bubble too. Mac and Android.

**Architecture:** Two small shared rules (`bubbleLine`, `bubbleText`, `BUBBLE_MAX`, `BUBBLE_HIDE_MS`,
`VOICE_LINES.didntCatch`) in `shared/voice-words.js`, ported to `voice/VoiceWords.kt` and checked through
`voice-cases.json`. Both apps use one bubble contract: `speech(words|null)` shows/holds, `speechDone()` lets go after
`BUBBLE_HIDE_MS`. Mac: a *quiet* chat in `actions.js` (opened without showing the panel), the existing bubble window
gets a clickable speech mode, `wake.js` drives the existing feelings (`listening`, `thinking`). Android: a new
`Mood.LISTENING`, `BubbleEvent.Speech/SpeechDone` sent by the hands-free `PanelModel(showSpoken = true)`, and
`HandsFreeChatActivity` (the panel screen on the hands-free model).

**Tech Stack:** Electron, Node `node:test`; Kotlin Android (JUnit4, kotlinx-coroutines-test).

**Spec:** `docs/superpowers/specs/2026-10-17-wake-emotion-bubble-design.md`.

## Global Constraints

- **Order and parallel work.** Task S1 (shared) first, on branch `voice-bubble` (worktree
  `~/projects/buddy-voice-bubble`), committed. Then two implementers in parallel, each in its own worktree made from
  `voice-bubble` after S1 (e.g. branches `voice-bubble-mac` / `voice-bubble-android`):
  - Mac: Tasks M1 → M2 → M3, in order. Touches only `src/` and `test/` (not `test/resources`, not Android files).
  - Android: Tasks A1 → A2 → A3, in order. Touches only `android/`.
  - Neither edits `shared/` or `tools/` after S1. A shared change needed later: stop and ask.
- **Never touch other worktrees or branches** (multi-session rules). **Do not push.**
- Commits: `git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit`, plain messages, no
  `Co-Authored-By`, no AI mention anywhere (commits, code, comments, PRs).
- After changing anything in `shared/`: `npm run sync:android && npm run sync:web && npm run sync:web-app`.
- JS: one file with `node --test test/<file>`. The full suite **only** with the lock:
  `until mkdir /tmp/buddy-npm-test.lock 2>/dev/null; do sleep 5; done; npm test; rmdir /tmp/buddy-npm-test.lock`
- Android (any Gradle run, from the worktree root):
  `until mkdir /tmp/buddy-gradle.lock 2>/dev/null; do sleep 5; done; cd android && ./gradlew testDebugUnitTest assembleDebug; rmdir /tmp/buddy-gradle.lock`
  (for one class while working, the same lock with `./gradlew testDebugUnitTest --tests '*ClassName*'`).
- **Safety rules unchanged:** a message is sent / a call placed only on a yes (spoken or pressed), once, for the card
  asked. No test that pins this (`test/voice-safety.test.js`, `VoiceSafetyTest.kt`) may be weakened.
- **Unchanged behaviour:** typed chats; the panel's 🎤; a wake while the panel is open; the panel opened by the person
  (resumes a recent chat as today). Mac `listening`/`thinking` looks are reused as they are.
- Style: match the files (JSDoc/KDoc sentences in plain English, `'use strict'`, 2-space JS, 4-space Kotlin).

---

### Task S1 (Shared): the bubble's words

**Files:**
- Modify: `shared/voice-words.js`
- Modify: `tools/sync-android-shared.js`
- Modify: `test/voice-words.test.js`
- Regenerated: `android/app/src/test/resources/voice-cases.json` (by `npm run sync:android`)

**Interfaces (new exports of `shared/voice-words.js`):**
```js
BUBBLE_MAX        // 140
BUBBLE_HIDE_MS    // 8000
VOICE_LINES.didntCatch  // "I didn't catch that."
bubbleLine(text, max = BUBBLE_MAX) -> string
bubbleText(items) -> string   // items: [{ type, say?, text?, code? }] as spokenLines takes
```

- [ ] **Step 1: Write the failing tests** (append to `test/voice-words.test.js`; add `bubbleLine, bubbleText, BUBBLE_MAX, BUBBLE_HIDE_MS` to its require)

```js
test('bubbleLine: short lines as they are (spaces tidied); long ones cut at a word with "…", never past BUBBLE_MAX', () => {
  assert.strictEqual(BUBBLE_MAX, 140);
  assert.strictEqual(BUBBLE_HIDE_MS, 8000);
  assert.strictEqual(VOICE_LINES.didntCatch, "I didn't catch that.");
  assert.strictEqual(bubbleLine('Paris.'), 'Paris.');
  assert.strictEqual(bubbleLine('  two\n  lines  '), 'two lines');
  assert.strictEqual(bubbleLine(''), '');
  assert.strictEqual(bubbleLine(null), '');
  const cut = bubbleLine('word '.repeat(40));
  assert.ok(cut.endsWith('word…'), cut);
  assert.ok(cut.length <= BUBBLE_MAX);
  const one = bubbleLine('x'.repeat(200)); // no space to cut at: cut where it is
  assert.strictEqual(one, `${'x'.repeat(139)}…`);
  assert.ok(bubbleLine('Okay. '.repeat(40)).endsWith(' Okay…'), 'no full stop (or comma) before the "…"');
  assert.strictEqual(bubbleLine(bubbleLine('word '.repeat(40))), cut, 'cutting again changes nothing');
});

test('bubbleText: what the answer says and writes, errors and done lines; long text shown cut, not dropped', () => {
  assert.strictEqual(bubbleText([{ type: 'buddy', say: 'Sure!', text: 'Here it is.' }]), 'Sure! Here it is.');
  assert.strictEqual(bubbleText([{ type: 'error', text: 'x', code: 'timeout' }]), VOICE_LINES.noInternet);
  assert.strictEqual(bubbleText([{ type: 'error', text: 'Sign in to use Buddy.', code: 'signed_out' }]), 'Sign in to use Buddy.');
  assert.strictEqual(bubbleText([{ type: 'event', text: '✅ Opened YouTube' }, { type: 'event', text: '📝 Remembered: x' }]), 'Opened YouTube');
  assert.strictEqual(bubbleText([{ type: 'question', text: 'Send it?' }, { type: 'you', text: 'hi' }]), '');
  const long = bubbleText([{ type: 'buddy', say: '', text: 'y '.repeat(200) }]);
  assert.ok(long.endsWith('…') && long.length <= BUBBLE_MAX);
});
```

- [ ] **Step 2: Run, see them fail**

Run: `node --test test/voice-words.test.js`
Expected: FAIL (`bubbleLine is not a function`).

- [ ] **Step 3: Implement** in `shared/voice-words.js`

Next to `SPOKEN_MAX`:
```js
const BUBBLE_MAX = 140; // a hands-free answer in the speech bubble: longer is cut at a word, with "…" (the chat has it all)
const BUBBLE_HIDE_MS = 8000; // the speech bubble goes this long after Buddy stops speaking
```
In `VOICE_LINES` add:
```js
  didntCatch: "I didn't catch that.", // the words after "Hey <name>" came back empty: shown, not said
```
After `spokenLines`:
```js
/** A line as the speech bubble shows it: spaces tidied; past `max`, cut at a word (or where it is) with "…". */
function bubbleLine(text, max = BUBBLE_MAX) {
  const line = String(text ?? '').replace(/\s+/g, ' ').trim();
  if (line.length <= max) return line;
  const cut = line.slice(0, max - 1);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).replace(/[\s,;:.!?-]+$/, '')}…`;
}

/**
 * The answer as the speech bubble shows it: each buddy line's words and text, an error (the internet line for no
 * internet), a done line without its mark; through bubbleLine. Unlike spokenLines, a long text is shown (cut), not dropped.
 */
function bubbleText(items) {
  const parts = [];
  for (const item of items) {
    const say = String(item.say || '').trim();
    const text = String(item.text || '').trim();
    if (item.type === 'buddy') parts.push(say, text);
    else if (item.type === 'error') parts.push(NO_INTERNET.includes(item.code) ? VOICE_LINES.noInternet : text);
    else if (item.type === 'event' && DONE.test(text)) parts.push(text.replace(DONE, ''));
  }
  return bubbleLine(parts.filter(Boolean).join(' '));
}
```
Add `BUBBLE_MAX, BUBBLE_HIDE_MS, bubbleLine, bubbleText` to `module.exports`.

- [ ] **Step 4: The Android cases** in `tools/sync-android-shared.js`

Next to `ASKS`:
```js
const BUBBLE_LINES = ['Paris.', '  two\n  lines  ', '', 'word '.repeat(40), 'x'.repeat(200), `${'a'.repeat(100)} ${'b'.repeat(60)}`,
  'Hello, world. '.repeat(15), 'Kahan ho? '.repeat(20)];
const BUBBLE_ITEMS = [...LINE_ITEMS, [{ type: 'buddy', say: 'Sure!', text: 'Here it is.' }], [{ type: 'buddy', say: '', text: 'y '.repeat(200) }],
  [{ type: 'error', text: 'x', code: 'timeout' }], []];
```
In `buildVoiceCases()`, after `asksBack`:
```js
    bubble: {
      max: voice.BUBBLE_MAX,
      hideMs: voice.BUBBLE_HIDE_MS,
      didntCatch: voice.VOICE_LINES.didntCatch,
      lines: BUBBLE_LINES.map((text) => ({ text, shown: voice.bubbleLine(text) })),
      texts: BUBBLE_ITEMS.map((items) => ({ items, shown: voice.bubbleText(items) })),
    },
```
(All case strings use plain ASCII spaces: Kotlin's `\s` and JavaScript's differ only on other spaces.)

- [ ] **Step 5: Sync and run**

Run: `npm run sync:android && npm run sync:web && npm run sync:web-app && node --test test/voice-words.test.js test/android-shared.test.js`
Expected: PASS; `git status` shows `voice-cases.json` changed (and nothing under `web/`).

- [ ] **Step 6: Full suite** (lock command from Global Constraints). Expected: all pass.

- [ ] **Step 7: Commit**
```bash
git add shared/voice-words.js tools/sync-android-shared.js test/voice-words.test.js android/app/src/test/resources/voice-cases.json
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "The speech bubble's words for a hands-free answer: cut at a word, shown 8 s after speech"
```

---

### Task M1 (Mac): the speech bubble window

**Files:**
- Modify: `src/main/geometry.js`, `src/main/notch-geometry.js`
- Modify: `src/main/bubble-window.js`, `src/preload/bubble.js`, `src/renderer/bubble/bubble.js`, `src/renderer/bubble/bubble.css`
- Modify: `src/main/home.js`, `src/main/main.js`
- Test: `test/geometry.test.js`, `test/notch-geometry.test.js`, `test/home.test.js`

**Interfaces:**
```js
// geometry.js
SPEECH                         // { width: 280, height: 110 }
speechBounds(buddy, area)      // beside the floating buddy, top-aligned, like bubbleBounds
// notch-geometry.js
speechUnderNotch(notch, area)  // panelUnderNotch(notch, area, SPEECH)
// bubble-window.js
createBubbleWindow({ ipcMain = null, onClick = () => {} } = {})
  .say(text, buddyBounds, area)   // unchanged: 2.6 s, clicks pass through
  .speak(text | null, at)         // at = home.panelAt(); null holds the words up (cancels the hide timer)
  .release()                      // hides BUBBLE_HIDE_MS later (after any pending show)
  .hide()
// home.js
home.speak(text | null)  -> bubble.speak(text, panelAt())
home.speakDone()         -> bubble.release()
```

- [ ] **Step 1: Failing tests**

`test/geometry.test.js`:
```js
test('the speech bubble is bigger than the bubble and goes beside the buddy the same way', () => {
  assert.deepStrictEqual(g.SPEECH, { width: 280, height: 110 });
  assert.deepStrictEqual(g.speechBounds({ x: 1336, y: 400, width: 96, height: 112 }, AREA), { x: 1336 - 280 - 8, y: 400, width: 280, height: 110 });
  assert.deepStrictEqual(g.speechBounds({ x: 20, y: 400, width: 96, height: 112 }, AREA), { x: 20 + 96 + 8, y: 400, width: 280, height: 110 });
});
```
`test/notch-geometry.test.js`:
```js
test('the speech bubble under the notch is centred on it at the top of the work area', () => {
  assert.deepStrictEqual(g.speechUnderNotch(NOTCH, AREA), { x: 666 + 90 - 140, y: 37, width: 280, height: 110 });
});
```
`test/home.test.js`: in `setup`, replace the `bubble` fake with
```js
  const bubble = {
    say: (text, bounds, area) => calls.push(['bubble.say', text, bounds, area]),
    speak: (text, at) => calls.push(['bubble.speak', text, at]),
    release: () => calls.push(['bubble.release']),
  };
```
and add
```js
test('a hands-free answer goes into the speech bubble, beside the floating buddy or under the notch, and is let go of', async () => {
  const s = setup();
  s.home.speak('Paris.');
  s.home.speakDone();
  assert.deepStrictEqual(s.calls, [['bubble.speak', 'Paris.', { kind: 'beside', buddy: BUDDY, area: PRIMARY.workArea }], ['bubble.release']]);
  await s.home.refresh();
  s.home.speak(null);
  assert.deepStrictEqual(s.calls.at(-1), ['bubble.speak', null, { kind: 'below', notch: NOTCH, area: PRIMARY.workArea }]);
});
```

- [ ] **Step 2: Run, see them fail**

Run: `node --test test/geometry.test.js test/notch-geometry.test.js test/home.test.js`
Expected: FAIL (`speechBounds is not a function`, `s.home.speak is not a function`).

- [ ] **Step 3: Geometry**

`src/main/geometry.js`, next to `BUBBLE`:
```js
const SPEECH = { width: 280, height: 110 }; // the speech bubble: a hands-free answer, up to 4 lines (bubble-window.js speak)
```
next to `bubbleBounds`:
```js
const speechBounds = (buddy, area) => besideBuddy(buddy, area, SPEECH, true);
```
and export `SPEECH` and `speechBounds`.

`src/main/notch-geometry.js`: `const { PANEL, SPEECH, clampToArea } = require('./geometry');` and
```js
/** The speech bubble under the notch: as the panel goes there, at the speech bubble's size. */
const speechUnderNotch = (notch, area) => panelUnderNotch(notch, area, SPEECH);
```
exported.

- [ ] **Step 4: The window** — `src/main/bubble-window.js`

Header comment becomes: "A short speech bubble beside the buddy ("Copied — press ⌘V", or Ctrl+V on Windows), whose clicks pass
through it; and the speech bubble of a hands-free answer (speak), bigger, which wraps and opens the chat on a click."
Requires:
```js
const { BUBBLE_HIDE_MS } = require('../../shared/voice-words');
const { BUBBLE, bubbleBounds, speechBounds } = require('./geometry');
const { speechUnderNotch } = require('./notch-geometry');
```
(`BUBBLE` is still the window's first size in `create()`.) Then:
```js
function createBubbleWindow({ ipcMain = null, onClick = () => {} } = {}) {
  let win = null;
  let ready = null;
  let timer = null;
  let speech = false; // the words up are a hands-free answer's (speak): they take the pointer, and a click opens the chat
  let showing = Promise.resolve(); // the last speak's show, which release() waits for

  function forget(w) {
    if (win !== w) return;
    clearTimeout(timer);
    win = null;
    ready = null;
    speech = false;
  }
  // drop() and create() as they are.

  if (ipcMain) {
    const fromPage = (event) => Boolean(win) && event.sender === win.webContents;
    // Over the words of a speech bubble the window takes the pointer; elsewhere clicks go through, as for the buddy.
    ipcMain.on('bubble:hover', (event, over) => {
      if (fromPage(event) && speech) win.setIgnoreMouseEvents(over !== true, { forward: true });
    });
    ipcMain.on('bubble:click', (event) => {
      if (fromPage(event) && speech) onClick();
    });
  }

  /** Shows `text` at `bounds`; `asSpeech` for a hands-free answer's. Answers the window, or null when it went meanwhile. */
  async function show(text, bounds, asSpeech) {
    if (!win) create();
    const w = win;
    await ready;
    if (w !== win) return null; // the window was closed or dropped (a crash, a failed load) while its page was loading
    clearTimeout(timer);
    speech = asSpeech;
    w.setIgnoreMouseEvents(true, asSpeech ? { forward: true } : {});
    w.setBounds(bounds);
    w.webContents.send('bubble:text', text, asSpeech);
    w.showInactive();
    return w;
  }

  return {
    window: () => win,
    /** Never rejects: whoever asks for a bubble cannot do anything about one that fails, so it is logged. */
    async say(text, buddyBounds, area) {
      try {
        const w = await show(text, bubbleBounds(buddyBounds, area), false);
        if (w) timer = setTimeout(() => w.hide(), SHOW_MS);
      } catch (err) {
        console.error('[buddy] could not show the bubble:', err);
      }
    },
    /**
     * A hands-free answer's words, held up until release(): beside the floating buddy, or under the notch (`at` is
     * home.panelAt()). Null keeps the words up. Never rejects.
     */
    async speak(text, at) {
      if (text === null) {
        if (speech) clearTimeout(timer);
        return;
      }
      const bounds = at.kind === 'below' ? speechUnderNotch(at.notch, at.area) : speechBounds(at.buddy, at.area);
      showing = show(text, bounds, true).catch((err) => console.error('[buddy] could not show the speech bubble:', err));
      await showing;
    },
    /** Buddy stopped speaking: the speech bubble goes BUBBLE_HIDE_MS later (a new speak keeps it). */
    release() {
      showing.then(() => {
        if (!speech || !win) return;
        const w = win;
        clearTimeout(timer);
        timer = setTimeout(() => w.hide(), BUBBLE_HIDE_MS);
      });
    },
    /** The chat is on screen: its words are there now. */
    hide() {
      clearTimeout(timer);
      if (win && !win.isDestroyed()) win.hide();
    },
  };
}
```

- [ ] **Step 5: The page**

`src/preload/bubble.js`:
```js
contextBridge.exposeInMainWorld('buddy', {
  onText: (fn) => ipcRenderer.on('bubble:text', (_event, text, speech) => fn(text, speech === true)),
  hover: (over) => ipcRenderer.send('bubble:hover', over === true),
  click: () => ipcRenderer.send('bubble:click'),
});
```
`src/renderer/bubble/bubble.js`:
```js
'use strict';

const words = document.getElementById('text');

// A speech bubble (a hands-free answer) wraps, and its words take the pointer and a click, which opens the chat.
window.buddy.onText((text, speech) => {
  words.textContent = text;
  document.body.classList.toggle('speech', speech);
});
words.addEventListener('mouseenter', () => window.buddy.hover(true));
words.addEventListener('mouseleave', () => window.buddy.hover(false));
words.addEventListener('click', () => window.buddy.click());
```
`src/renderer/bubble/bubble.css` (append):
```css
body.speech #text {
  white-space: normal; font-weight: 500; cursor: pointer; overflow: hidden;
  display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 4;
}
```

- [ ] **Step 6: home.js**

Move the body of `panelAt()` into a local `function panelAt() { … }` above `return` (same code and comment), use
`panelAt,` in the returned object, and add next to `say`:
```js
    /** A hands-free answer in the speech bubble (bubble-window.js speak), where the panel would go. Null keeps the words up. */
    speak: (text) => bubble.speak(text, panelAt()),
    /** Buddy stopped speaking: the speech bubble goes a few seconds later. */
    speakDone: () => bubble.release(),
```

- [ ] **Step 7: main.js wiring**

```js
  // A click on a speech bubble's words opens the chat it is about, as a click on Buddy does (onCall, below).
  const bubble = createBubbleWindow({ ipcMain, onClick: () => { bubble.hide(); onCall(); } });
```
In `createPanelWindow({ … onVisible })` add as first line of `onVisible`:
```js
      if (visible) bubble.hide(); // the chat is on screen: the speech bubble's words are in it
```
In `const ui = { … }` after `bubble: (text) => buddy.say(text),`:
```js
    // A hands-free answer while the panel is hidden (actions.js quiet chat): its words in the speech bubble, held while
    // Buddy speaks (null keeps what is up), and gone a few seconds after.
    speech: (text) => buddy.speak(text),
    speechDone: () => buddy.speakDone(),
```

- [ ] **Step 8: Run**

Run: `node --test test/geometry.test.js test/notch-geometry.test.js test/home.test.js && npx eslint src test`
Expected: PASS, no lint errors.

- [ ] **Step 9: Commit**
```bash
git add src/main/geometry.js src/main/notch-geometry.js src/main/bubble-window.js src/preload/bubble.js src/renderer/bubble src/main/home.js src/main/main.js test/geometry.test.js test/notch-geometry.test.js test/home.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Mac: a speech bubble for hands-free answers that opens the chat on a click"
```

---

### Task M2 (Mac): the quiet chat — no panel for a hands-free request

**Files:**
- Modify: `src/main/actions.js`
- Modify: `test/helpers/actions-setup.js`
- Test: `test/actions.test.js`

**Interfaces:** `actions.voice(words)` keeps its signature and `{ busy: true }` answer. New chat fields `quiet`,
`quietAt`. Uses `ui.speech?.(text|null)`, `ui.speechDone?.()` (optional: Windows/tests without them do nothing).

- [ ] **Step 1: The fake ui** — in `test/helpers/actions-setup.js`, add to `ui`:
```js
    speech: (text) => log.push(['speech', text]),
    speechDone: () => log.push(['speechDone']),
```

- [ ] **Step 2: Failing tests** — append to `test/actions.test.js` (it already has `spokenOf`, `message`, `WA`,
`waSends`; add `const { BUBBLE_MAX } = require('../shared/voice-words');` at the top), and rename the test at
"voice(words), after "Hey <name>": opens the chat…" to
`'voice(words), after "Hey <name>": the words go as a spoken message; the card is still asked aloud'`.

```js
// "Hey <name>" with the panel hidden: the chat is not shown; the answer is said and shown in the speech bubble

const speeches = (s) => s.log.filter((e) => e[0] === 'speech' || e[0] === 'speechDone').map((e) => (e[0] === 'speech' ? e[1] : 'done'));

test('voice(words) with the panel hidden: no panel; the answer is said, shown in the speech bubble meanwhile, then let go of', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Paris is the capital of France.' })], talk: {} });
  await s.actions.voice('capital of france');
  await settle();
  assert.strictEqual(entries(s.log, 'showPanel').length, 0);
  assert.deepStrictEqual(spokenOf(s), ['Paris is the capital of France.']);
  assert.deepStrictEqual(speeches(s), ['Paris is the capital of France.', 'done']);
});

test('a long answer: the speech bubble shows it cut with "…", the chat keeps it all', async () => {
  const long = `${'word '.repeat(60)}end`;
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Here it is.', text: long })], talk: {} });
  await s.actions.voice('tell me something long');
  await settle();
  const shown = speeches(s)[0];
  assert.ok(shown.startsWith('Here it is. word'), shown);
  assert.ok(shown.endsWith('…') && shown.length <= BUBBLE_MAX, shown);
  assert.strictEqual(chatOf(s).find((i) => i.type === 'buddy').text, long);
});

test('a message card from a wake: asked in the speech bubble with no panel; no yes sends nothing', async () => {
  const s = setup({ answers: [message()], talk: { answers: ['no'] }, replies: WA });
  await s.actions.voice('message priya hi');
  await settle();
  assert.strictEqual(entries(s.log, 'showPanel').length, 0);
  assert.deepStrictEqual(speeches(s).filter((x) => x !== 'done'), ['To Priya Sharma: hi. Send it?', 'Okay, not sent.']);
  assert.strictEqual(waSends(s).length, 0);
});

test('a yes to a wake\'s card sends it once, as with the panel open, and the panel stays hidden', async () => {
  const s = setup({ answers: [message()], talk: { answers: ['yes'] }, replies: WA });
  await s.actions.voice('message priya hi');
  await settle();
  assert.deepStrictEqual(waSends(s).map((e) => e[2]), [{ name: 'Priya Sharma', text: 'hi' }]);
  assert.strictEqual(entries(s.log, 'showPanel').length, 0);
});

test('opening the panel after a wake (a click on the bubble or on Buddy) shows that chat; then no speech bubble', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Paris.' }), reply({ kind: 'answer', say: 'Berlin.' })], talk: {} });
  await s.actions.voice('capital of france');
  await settle();
  await s.actions.toggle();
  const shown = entries(s.log, 'showPanel')[0][1];
  assert.strictEqual(shown.resumed, true);
  assert.deepStrictEqual(shown.chat.map((i) => i.type), ['you', 'buddy']);
  const before = entries(s.log, 'speech').length;
  await s.actions.send('and germany?', { spoken: true });
  await settle();
  assert.strictEqual(entries(s.log, 'speech').length, before, 'the chat is on screen');
});

test('a wake\'s chat over five minutes old: opening the panel starts a new chat, as today', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Paris.' })], talk: {} });
  await s.actions.voice('capital of france');
  await settle();
  s.wait(5 * 60_000);
  await s.actions.toggle();
  assert.deepStrictEqual(entries(s.log, 'showPanel')[0][1].chat, []);
});

test('a second wake within five minutes goes on in the same chat', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Which Priya?' }), reply({ kind: 'answer', say: 'Okay.' })], talk: {} });
  await s.actions.voice('message priya');
  await settle();
  s.wait(60_000);
  await s.actions.voice('priya sharma');
  await settle();
  assert.deepStrictEqual(chatOf(s).filter((i) => i.type === 'you').map((i) => i.text), ['message priya', 'priya sharma']);
});

test('a wake while the panel is open goes into the open panel, with no speech bubble', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', say: 'Paris.' })], talk: {} });
  await s.actions.open();
  await s.actions.voice('capital of france');
  await settle();
  assert.deepStrictEqual(spokenOf(s), ['Paris.']);
  assert.strictEqual(entries(s.log, 'speech').length, 0);
});
```

- [ ] **Step 3: Run, see them fail**

Run: `node --test test/actions.test.js`
Expected: the new tests FAIL (a `showPanel` is logged; no `speech` entries).

- [ ] **Step 4: Implement** in `src/main/actions.js`

1. Require `bubbleLine, bubbleText` from `../../shared/voice-words` (add to the existing destructuring).
2. `newChat`: add `quiet: false, quietAt: 0` to the object. Extend its doc comment: "`quiet` while it is a
   hands-free chat the panel has not shown (sayToBuddy), as recent as `quietAt`."
3. Under `hush`, replace `speak` with:
```js
  /** A hands-free chat the panel has not shown: what Buddy says goes in the speech bubble (ui.speech). */
  const quietly = (c) => c.quiet && c === chat;

  /**
   * Said out loud, only in a spoken chat. Never rejects: a voice that fails leaves the chat as it is. In a quiet chat the
   * speech bubble shows `shown` (null: what it shows already) while the line is said, and goes a few seconds after.
   */
  function speak(c, text, shown = text) {
    if (!c.spoken || !talkBack || !text) return Promise.resolve();
    const bubbled = quietly(c);
    if (bubbled) ui.speech?.(shown === null ? null : bubbleLine(shown));
    c.saying += 1; // hush() stops whatever line is being said
    return Promise.resolve().then(() => talkBack.say(text)).catch((err) => console.warn('[buddy] could not speak:', err.message))
      .finally(() => {
        c.saying -= 1;
        if (bubbled) ui.speechDone?.();
      });
  }
```
4. `openPanel` takes `{ show = true } = {}`; replace the resume lines and the end with:
```js
    // The same chat comes back when the panel only hid, from the same app, a short while ago; the selection is read
    // again all the same, since the person may have selected something else meanwhile. A quiet chat is as recent as its
    // last request, and the panel opened on it shows it whatever the app is now: its words were in the speech bubble.
    const sameApp = (app?.pid ?? null) === (chat.app?.pid ?? null);
    const seen = chat.quiet ? chat.quietAt : ui.panelHiddenAt();
    const resumed = chat.live && now() - seen < RESUME_MS && (sameApp || (show && chat.quiet));
    if (!resumed) replaceChat(newChat(app));
    Object.assign(chat, { app, selection, notice, noticeFix, resumed, live: true, quiet: !show, quietAt: show ? 0 : now() });
    if (show) await showPanel(stateOf(chat));
```
   and its doc gains: "`show: false` (a hands-free request with the panel hidden): the chat is made ready but not
   shown; it is quiet until the panel shows it."
5. `open` passes its options through: `function open(options) { if (!opening) { opening = openPanel(options).finally(…); } return opening; }`.
6. `present(c)`: `return c === chat && (aside > 0 || ui.isPanelVisible() || c.quiet);` and add to its comment:
   "A quiet chat counts: the person asked hands-free, so Buddy works for it as with the panel open."
7. `comeBack(c)`: first line `if (c !== chat || c.quiet) return; // a quiet chat stays in the speech bubble`.
8. `speakAnswer`: after `const lines = …`:
```js
    const shown = bubbleText(added.filter((i) => i !== card)); // the answer in the speech bubble (quiet chat)
    if (!lines.length && shown && quietly(c)) { // a long text, only shown
      ui.speech?.(shown);
      ui.speechDone?.();
    }
```
   and the loop becomes:
```js
      for (const [n, line] of lines.entries()) {
        await speak(c, line, n === 0 ? shown || line : null); // the bubble shows the answer, held through its lines
        if (!live()) return;
      }
```
9. `sayToBuddy`:
```js
  async function sayToBuddy(words) {
    if (!ui.isPanelVisible()) await open({ show: false }); // not shown: the answer goes in the speech bubble
    if (chat.busy) return { busy: true };
    return send(words, { spoken: true });
  }
```
   Its doc: replace "The panel's chat opens first when it is hidden." with "With the panel hidden the chat is made
   ready but not shown (a quiet chat): Buddy answers out loud and in the speech bubble, and opening the panel shows it."

- [ ] **Step 5: Run**

Run: `node --test test/actions.test.js test/voice-safety.test.js`
Expected: PASS (all old tests too).

- [ ] **Step 6: Full suite** (lock command). Expected: all pass.

- [ ] **Step 7: Commit**
```bash
git add src/main/actions.js test/helpers/actions-setup.js test/actions.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Mac: a hands-free request answers out loud and in the speech bubble, not in the panel"
```

---

### Task M3 (Mac): the listening and thinking face for a wake

**Files:**
- Modify: `src/main/wake.js`, `src/main/main.js`
- Test: `test/wake.test.js`

**Interfaces:** `createWake({ …, feel = null })`, `feel = { listening(on), mood(name), bubble(text) }`.

- [ ] **Step 1: Failing tests**

In `test/wake.test.js` `setup`, pass to `createWake`:
```js
    feel: { listening: (on) => log.push(['listening', on]), mood: (name) => log.push(['mood', name]), bubble: (text) => log.push(['bubble', text]) },
```
Append (`ASK` is defined in the file already):
```js
const felt = (s) => s.log.filter((l) => ['listening', 'mood', 'bubble'].includes(l[0])).map((l) => `${l[0]} ${l[1]}`);

test('"Hey Buddy" alone: the listening face comes with Yes? and stays until the request is in; then thinking', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  await s.handlers.woke(ASK);
  assert.deepStrictEqual(felt(s), ['listening true', 'listening false', 'mood thinking']);
  const at = (kind) => s.log.findIndex((l) => l[0] === kind);
  assert.ok(at('listening') < at('say'), 'the face before Yes?');
  assert.ok(s.log.findIndex((l) => l[0] === 'listening' && l[1] === false) > at('call'), 'until the listening is over');
});

test('"Hey Buddy, call Mom" in one go: thinking while it is written down', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(felt(s), ['mood thinking']);
});

test('nothing made out: idle again, and "I didn\'t catch that." in the bubble, not said', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.actions.transcribe = async () => ({ text: '  ' });
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(felt(s), ['mood thinking', 'mood idle', "bubble I didn't catch that."]);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'say'), []);
});

test('Yes? and then nothing said: the face ends, nothing shown', async (t) => {
  const s = setup(t, { listenResult: {} });
  s.wake.refresh();
  await s.handlers.woke(ASK);
  assert.deepStrictEqual(felt(s), ['listening true', 'listening false']);
});

test('no internet: sad, and the line in the bubble as well as said', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.actions.transcribe = async () => { const e = new Error('x'); e.code = 'network'; throw e; };
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(felt(s), ['mood thinking', 'mood sad', "bubble I can't reach the internet right now."]);
});

test('busy: the busy line in the bubble, no face', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.state.busy = true;
  await s.handlers.woke(ASK);
  assert.deepStrictEqual(felt(s), ["bubble I'm still on the last one. Ask me again in a moment."]);
});

test('Only my voice, not the owner: no face at all', async (t) => {
  const s = setup(t, { myVoice: { on: true, allow: (p) => p === 'ME' } });
  s.wake.refresh();
  await s.handlers.woke({ phrase: 'THEM', asks: true });
  await s.handlers.request({ audio: 'AAAA', phrase: 'THEM' });
  assert.deepStrictEqual(felt(s), []);
});
```

- [ ] **Step 2: Run, see them fail**

Run: `node --test test/wake.test.js`
Expected: the new tests FAIL (no `listening`/`mood`/`bubble` entries).

- [ ] **Step 3: Implement** in `src/main/wake.js`

1. Doc comment of the file: add "Buddy's face listens from its "Yes?" until the request is in, and thinks while it is
   written down (`feel`); its own lines (busy, no internet, nothing made out) also show in the speech bubble."
2. `createWake({ …, feel = null, // the face and the speech bubble (main.js): { listening(on), mood(name), bubble(text) }`.
3. Add under `allowed`:
```js
  /** A line of the loop's own: in the speech bubble, and said. Never rejects. */
  async function tell(line) {
    feel?.bubble(line);
    await Promise.resolve(talkBack?.say(line)).catch(() => {});
  }
```
   and in `allowed` replace `await talkBack?.say(BUSY_LINE).catch?.(() => {});` with `await tell(BUSY_LINE);`.
4. Replace `onAsk` with:
```js
  async function onAsk(msg) {
    if (asking) return; // one "Yes?" at a time: a second wake while it runs is ignored, silently
    asking = true;
    try {
      if (!(await allowed(msg?.phrase))) return;
      const r = await askedAndHeard();
      if (r) await handle(r.audio);
    } catch (err) {
      console.warn('[buddy] wake:', err?.code || err?.message);
    } finally {
      asking = false;
    }
  }

  // "Yes?", then the request, with Buddy's listening face from the "Yes?" until the request is in. Null when listening
  // may not go on: the ear page is gone, or Wake went off / the screen locked / the panel records meanwhile (then any
  // audio is dropped, not written down).
  async function askedAndHeard() {
    feel?.listening(true);
    try {
      const said = await talkBack.say(WAKE_LINES.yes);
      if (said?.gone || !mayListen()) return null;
      const r = await ear.call('listen', { ...REQUEST, settleMs: YES_SETTLE_MS });
      return mayListen() ? r || {} : null;
    } finally {
      feel?.listening(false);
    }
  }
```
5. Replace `handle` with:
```js
  async function handle(audio) {
    if (!audio) return; // nothing said: stay quiet, the person just says "Hey <name>" again
    feel?.mood('thinking'); // written down, then answered (actions.js takes the face over from there)
    try {
      const words = String((await actions.transcribe(audio, 'audio/wav')).text ?? '').trim();
      if (!words) {
        feel?.mood('idle');
        feel?.bubble(VOICE_LINES.didntCatch); // shown, not said: the person just says "Hey <name>" again
        return;
      }
      const r = await actions.voice(words);
      if (r && r.busy) { // the chat got busy while the words were written down
        feel?.mood('idle');
        await tell(BUSY_LINE);
      }
    } catch (err) {
      console.warn('[buddy] wake:', err?.code || err?.message);
      feel?.mood('sad');
      if (NO_INTERNET.includes(err?.code)) await tell(VOICE_LINES.noInternet);
    }
  }
```
6. `src/main/main.js`, in `createWake({ … })` add:
```js
      // Buddy's face for a wake (feelings.js) and its own lines in the speech bubble (bubble-window.js speak).
      feel: {
        listening: (on) => feelings.listening(on),
        mood: (name) => feelings.mood(name),
        bubble: (text) => { buddy.speak(text); buddy.speakDone(); },
      },
```

- [ ] **Step 4: Run**

Run: `node --test test/wake.test.js test/feelings.test.js`
Expected: PASS (old wake tests too: "Yes? then an empty request: silent" still has no `say` after Yes?).

- [ ] **Step 5: Full suite** (lock command). Expected: all pass.

- [ ] **Step 6: Owner's check on the Mac** (`npm start` in the worktree; Settings → Listen for "Hey <name>" on):
  "Hey Buddy" → listening face with "Yes?"; "what's the capital of France" → thinking, then the answer said and in
  the speech bubble beside Buddy (under the notch if Buddy lives there), no panel; it goes ~8 s after; click on the
  words opens the chat with the question and answer. "Hey Buddy message Mom I'm late" → bubble shows
  "To Mom: I'm late. Send it?"; "no" → not sent. With the panel open, a wake goes into the panel as before.

- [ ] **Step 7: Commit**
```bash
git add src/main/wake.js src/main/main.js test/wake.test.js
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Mac: Buddy listens with its Yes? and thinks while a hands-free request is answered"
```

---

### Task A1 (Android): the bubble's words in Kotlin

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/voice/VoiceWordsTest.kt`

**Interfaces:**
```kotlin
VoiceWords.BUBBLE_MAX: Int            // 140
VoiceWords.BUBBLE_HIDE_MS: Long       // 8_000L
VoiceWords.DIDNT_CATCH: String        // "I didn't catch that."
VoiceWords.bubbleLine(text: String, max: Int = BUBBLE_MAX): String
VoiceWords.bubbleText(items: List<SpokenItem>): String
```

- [ ] **Step 1: Failing test** (append to `VoiceWordsTest`; imports `kotlinx.serialization.json.int`, `kotlinx.serialization.json.long`)
```kotlin
    @Test fun theSpeechBubbleShowsWhatTheJavaScriptShows() {
        val b = root.getValue("bubble").jsonObject
        assertEquals(b.getValue("max").jsonPrimitive.int, VoiceWords.BUBBLE_MAX)
        assertEquals(b.getValue("hideMs").jsonPrimitive.long, VoiceWords.BUBBLE_HIDE_MS)
        assertEquals(b.str("didntCatch"), VoiceWords.DIDNT_CATCH)
        for (c in b.getValue("lines").jsonArray.map { it.jsonObject }) assertEquals(c.str("text"), c.str("shown"), VoiceWords.bubbleLine(c.str("text")))
        for (c in b.getValue("texts").jsonArray.map { it.jsonObject }) {
            val items = c.getValue("items").jsonArray.map { it.jsonObject }.map {
                fun s(k: String) = it[k]?.jsonPrimitive?.content ?: ""
                SpokenItem(s("type"), s("say"), s("text"), s("code"))
            }
            assertEquals(c.str("shown"), VoiceWords.bubbleText(items))
        }
    }
```

- [ ] **Step 2: Run, see it fail** — Gradle lock command with `./gradlew testDebugUnitTest --tests '*VoiceWordsTest*'`.
Expected: compile FAIL (unresolved `BUBBLE_MAX`).

- [ ] **Step 3: Implement** in `object VoiceWords`, next to `SPOKEN_MAX`:
```kotlin
    const val DIDNT_CATCH = "I didn't catch that." // the words after the wake came back empty: shown, not said
    const val BUBBLE_MAX = 140 // a hands-free answer in the speech bubble: longer is cut at a word, with "…"
    const val BUBBLE_HIDE_MS = 8_000L // the speech bubble goes this long after Buddy stops speaking
```
after `spoken(…)`:
```kotlin
    /** A line as the speech bubble shows it: spaces tidied; past `max`, cut at a word (or where it is) with "…". */
    fun bubbleLine(text: String, max: Int = BUBBLE_MAX): String {
        val line = text.replace(Regex("\\s+"), " ").trim()
        if (line.length <= max) return line
        val cut = line.substring(0, max - 1)
        val space = cut.lastIndexOf(' ')
        return (if (space > max / 2) cut.substring(0, space) else cut).replace(Regex("[\\s,;:.!?-]+$"), "") + "…"
    }

    /** The answer as the speech bubble shows it (shared/voice-words.js bubbleText): a long text is shown cut, not dropped. */
    fun bubbleText(items: List<SpokenItem>): String {
        val parts = ArrayList<String>()
        for (item in items) {
            val say = item.say.trim()
            val text = item.text.trim()
            when {
                item.type == "buddy" -> { parts += say; parts += text }
                item.type == "error" -> parts += if (item.code in NO_INTERNET_CODES) NO_INTERNET else text
                item.type == "event" && DONE.containsMatchIn(text) -> parts += text.replace(DONE, "")
            }
        }
        return bubbleLine(parts.filter { it.isNotEmpty() }.joinToString(" "))
    }
```

- [ ] **Step 4: Run** — same Gradle command. Expected: PASS.

- [ ] **Step 5: Commit**
```bash
git add android/app/src/main/java/com/akshatgg/buddy/voice/VoiceWords.kt android/app/src/test/java/com/akshatgg/buddy/voice/VoiceWordsTest.kt
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Android: the speech bubble's words, as the Mac's"
```

---

### Task A2 (Android): a listening face

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/Moods.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/WakeControl.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt` (askAloud only)
- Test: `android/app/src/test/java/com/akshatgg/buddy/bubble/MoodsTest.kt`

- [ ] **Step 1: Failing test** (append to `MoodsTest`)
```kotlin
    @Test fun listeningLeansInLooksUpAndHolds() {
        val start = Moods.pose(Mood.LISTENING, 0.0)
        val p = Moods.pose(Mood.LISTENING, 1.0)
        assertEquals(0f, start.headTilt, 1e-6f)
        assertEquals(0.14f, p.headTilt, 1e-6f)
        assertEquals(0.25f, p.eyeL, 1e-6f)
        assertEquals(0.25f, p.eyeR, 1e-6f)
        assertFalse(p.eyesClosed)
        assertFalse(Moods.pose(Mood.LISTENING, 60.0).done)
    }
```

- [ ] **Step 2: Run, see it fail** — Gradle lock command, `--tests '*MoodsTest*'`. Expected: compile FAIL.

- [ ] **Step 3: Implement**

`Moods.kt`: `enum class Mood { IDLE, THINKING, HAPPY, SLEEPY, WAVE, WOBBLE, LISTENING }`; in `pose`:
```kotlin
        // Listening ("Hey <name>", and a card's question asked aloud): the head leans in and the eyes look up, eased in
        // over 0.4 s, until another mood. The Mac's listening face, without its ears.
        Mood.LISTENING -> {
            val leaning = min(since / 0.4, 1.0)
            Pose(headTilt = (0.14 * leaning).toFloat(), eyeL = (0.25 * leaning).toFloat(), eyeR = (0.25 * leaning).toFloat())
        }
```
`WakeControl.listen`: the `Woke` branch ends in `else BubbleBus.mood(Mood.LISTENING)` (was THINKING); in the
`Request` branch, right after `turnRunning = true`:
```kotlin
                            BubbleBus.mood(Mood.THINKING) // written down, then answered
```
`PanelModel.askAloud`: `mood(Mood.THINKING) // listening: Android's head has no listening face` →
`mood(Mood.LISTENING) // the person answers`. If a test in `PanelModelTest`/`VoiceSafetyTest` asserts THINKING for
that moment, change it to LISTENING (only that moment).

- [ ] **Step 4: Run** — Gradle lock command (full `testDebugUnitTest assembleDebug`). Expected: PASS, build OK.

- [ ] **Step 5: Commit**
```bash
git add android/app/src/main/java/com/akshatgg/buddy/bubble/Moods.kt android/app/src/main/java/com/akshatgg/buddy/bubble/WakeControl.kt android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt android/app/src/test/java/com/akshatgg/buddy/bubble/MoodsTest.kt
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Android: Buddy listens after Hey <name> and thinks while it answers"
```

---

### Task A3 (Android): the answer in the speech bubble, and the hands-free chat on screen

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/BubbleBus.kt` (`BubbleEvent`)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/SpeechBubble.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/BubbleService.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelActivity.kt`
- Create: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/HandsFreeChatActivity.kt`
- Modify: `android/app/src/main/AndroidManifest.xml`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/AppGraph.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/voice/HandsFree.kt`
- Create test: `android/app/src/test/java/com/akshatgg/buddy/ui/panel/HandsFreeBubbleTest.kt`
- Modify test: `android/app/src/test/java/com/akshatgg/buddy/voice/HandsFreeTest.kt`

**Interfaces:**
```kotlin
sealed interface BubbleEvent {
    data class Speech(val text: String?) : BubbleEvent   // show and hold; null holds what is up
    data object SpeechDone : BubbleEvent                  // goes BUBBLE_HIDE_MS later
}
PanelModel(..., showSpoken: Boolean = false)             // the hands-free chat: off screen, speech goes to the bubble
SpeechBubble.say(text, head, area, onTap = null, stay = false); keep(); release(ms); val spoken: Boolean
AppGraph.handsFreeChat: PanelModel
class HandsFreeChatActivity : PanelActivity()
```

- [ ] **Step 1: Failing tests**

`HandsFreeBubbleTest.kt` (uses the internal fakes of `PanelModelTest.kt`):
```kotlin
package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.ai.Answer
import com.akshatgg.buddy.ai.ChatReply
import com.akshatgg.buddy.bubble.BubbleEvent
import com.akshatgg.buddy.message.Found
import com.akshatgg.buddy.message.Person
import com.akshatgg.buddy.voice.VoiceWords
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** The hands-free chat off screen: what Buddy says shows in the speech bubble, held while said, let go of after. */
@OptIn(ExperimentalCoroutinesApi::class)
class HandsFreeBubbleTest {
    private val events = mutableListOf<BubbleEvent>()
    private val replies = ArrayDeque<ChatReply>()
    private val log = mutableListOf<String>()
    private val messaging = FakeMessaging(log)
    private val talk = FakeTalkBack(log)
    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")

    private fun answer(say: String, text: String = "") = ChatReply("answer", say, text, emptyList(), false, false, emptyList(), false)
    private fun message() = ChatReply("message", "", "hi", emptyList(), false, false, emptyList(), false, "Priya")

    /** A chat as AppGraph makes the hands-free one (opened, then hidden: never on screen), or the panel's own. */
    private fun chat(scope: CoroutineScope, showSpoken: Boolean = true, onScreen: Boolean = false) = PanelModel(
        ask = { _, _ -> Answer("raw", "m", chat = replies.removeFirst()) },
        scope = scope,
        bubble = { events += it },
        typeIn = FakeTypeIn(),
        facts = FakeFacts(),
        hands = PanelHands(stepAside = { log += "aside" }),
        messaging = messaging,
        talkBack = talk,
        lock = FakeLock(),
        now = { 1_000_000L },
        showSpoken = showSpoken,
    ).apply { open(); if (!onScreen) hidden() }

    /** What the speech bubble was told: the words, "(hold)" for null, "done". */
    private val speech get() = events.mapNotNull {
        when (it) {
            is BubbleEvent.Speech -> it.text ?: "(hold)"
            BubbleEvent.SpeechDone -> "done"
            else -> null
        }
    }

    @Test fun theAnswerIsShownWhileSaidAndLetGoOfAfter() = runTest {
        replies += answer("Paris is the capital of France.")
        chat(this).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(listOf("Paris is the capital of France.", "done"), speech)
        assertTrue("say Paris is the capital of France." in log)
    }

    @Test fun aLongAnswerIsCutInTheBubbleAndKeptWholeInTheChat() = runTest {
        val long = "word ".repeat(60) + "end"
        replies += answer("Here it is.", long)
        val m = chat(this)
        m.sendSpoken("tell me something long")
        advanceUntilIdle()
        val shown = speech.first()
        assertTrue(shown, shown.startsWith("Here it is. word") && shown.endsWith("…") && shown.length <= VoiceWords.BUBBLE_MAX)
        assertEquals(long, m.state.value.items.filterIsInstance<BuddySaid>().last().text)
    }

    @Test fun aCardsQuestionIsShownAndNoYesSendsNothing() = runTest {
        replies += message()
        messaging.found += Found.One(priya)
        chat(this).sendSpoken("message Priya hi")
        advanceUntilIdle()
        assertEquals(listOf("To Priya Sharma: hi. Send it?", "Okay, not sent."), speech.filter { it != "done" })
        assertTrue(log.none { it.startsWith("send ") })
    }

    @Test fun onScreenNothingGoesToTheBubble() = runTest {
        replies += answer("Paris.")
        chat(this, onScreen = true).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(emptyList<String>(), speech)
    }

    @Test fun thePanelsOwnChatNeverUsesTheBubble() = runTest {
        replies += answer("Paris.")
        chat(this, showSpoken = false).sendSpoken("capital of france")
        advanceUntilIdle()
        assertEquals(emptyList<String>(), speech)
    }
}
```
(If `FakeMessaging` logs a send differently from `"send …"`, match `VoiceSafetyTest`'s `sent()` helper.)

`HandsFreeTest.kt`: rename `nothingWrittenDownByTheServerStaysSilent` to `nothingWrittenDownIsShownNotSaid` and expect
`assertEquals(listOf(VoiceWords.DIDNT_CATCH), shown)` (`said` and `log` still empty).

- [ ] **Step 2: Run, see them fail** — Gradle lock command, `--tests '*HandsFree*'`. Expected: compile FAIL
(`showSpoken`, `BubbleEvent.Speech`).

- [ ] **Step 3: Events** — in `BubbleEvent` (BubbleBus.kt):
```kotlin
    /** A hands-free answer (or its question) in the speech bubble, held until SpeechDone; null holds what is up. A tap opens that chat. */
    data class Speech(val text: String?) : BubbleEvent
    /** Buddy stopped speaking: the speech bubble goes VoiceWords.BUBBLE_HIDE_MS later. */
    data object SpeechDone : BubbleEvent
```

- [ ] **Step 4: PanelModel**

Constructor, last parameter:
```kotlin
    private val showSpoken: Boolean = false, // the hands-free chat: while off screen, what Buddy says shows in the speech bubble
```
Under `sayAloud`, the one way Buddy speaks:
```kotlin
    /**
     * Says `text`. In the hands-free chat off screen the speech bubble shows `words` meanwhile (null: what it shows
     * already), and goes a few seconds after.
     */
    private suspend fun aloud(text: String, words: String? = text) {
        val off = showSpoken && !shown
        if (off) bubble(BubbleEvent.Speech(words?.let { VoiceWords.bubbleLine(it) }))
        try {
            talkBack.say(text)
        } finally {
            if (off) bubble(BubbleEvent.SpeechDone)
        }
    }
```
`sayAloud`: `talkBack.say(text)` → `aloud(text)`.
`speakAnswer`: after `val lines = …`:
```kotlin
            val words = VoiceWords.bubbleText(added.filter { it.id != card?.id }.map(::spokenItem))
            if (lines.isEmpty() && words.isNotEmpty() && showSpoken && !shown) { // a long text, only shown
                bubble(BubbleEvent.Speech(words))
                bubble(BubbleEvent.SpeechDone)
            }
            for ((n, line) in lines.withIndex()) {
                aloud(line, if (n == 0) words.ifEmpty { line } else null) // the answer shows, held through its lines
                if (c !== chat || c.voice != epoch) return
            }
```
(replacing the old `for (line in lines)` loop). `askAloud`: `talkBack.say(question)` → `aloud(question)`.

- [ ] **Step 5: SpeechBubble**
```kotlin
    /** The words up are a hands-free answer's (said with `stay`): a tap on the head opens that chat too. */
    var spoken = false
        private set
```
`say` gains `stay: Boolean = false` (KDoc: "`stay`: a hands-free answer, held until release()"); its end becomes:
```kotlin
        timer?.cancel()
        spoken = stay
        timer = if (stay) null else scope.launch {
            delay(if (onTap == null) SHOW_MS else TAP_SHOW_MS)
            hide()
        }
```
and add:
```kotlin
    /** A hands-free bubble stays up: its timer, if one runs, is let go of. */
    fun keep() {
        if (!spoken) return
        timer?.cancel()
        timer = null
    }

    /** A hands-free bubble goes `ms` from now. */
    fun release(ms: Long) {
        if (!spoken || view == null) return
        timer?.cancel()
        timer = scope.launch {
            delay(ms)
            hide()
        }
    }
```
`hide()` also sets `spoken = false`.

- [ ] **Step 6: BubbleService**

In the `BubbleBus.events` `when`:
```kotlin
                    is BubbleEvent.Speech -> speak(event.text)
                    BubbleEvent.SpeechDone -> speech?.release(VoiceWords.BUBBLE_HIDE_MS)
```
Head click: `view.setOnClickListener { if (speech?.spoken == true) { speech?.hide(); openHandsFreeChat() } else openPanel() }`.
Next to `openPanel()`:
```kotlin
    /** The hands-free chat on screen: a tap on its speech bubble, or on the head while that bubble is up. */
    private fun openHandsFreeChat() {
        startActivity(Intent(this, HandsFreeChatActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
    }
```
Next to `say(…)`:
```kotlin
    /** A hands-free answer in the speech bubble, held until SpeechDone; null holds what is up. A tap opens that chat. */
    private fun speak(text: String?) {
        val bubble = speech ?: return
        if (text == null) return bubble.keep()
        val view = head ?: return
        // Out of a sheet's way, or no overlay any more: the chat has the words, and nobody would see them now.
        if (view.visibility != View.VISIBLE || !Settings.canDrawOverlays(this)) return
        bubble.say(text, headBounds(), area(), ::openHandsFreeChat, stay = true)
    }
```
Import `com.akshatgg.buddy.ui.panel.HandsFreeChatActivity` (and `VoiceWords` if not imported).

- [ ] **Step 7: The chat on screen**

`PanelActivity.kt`: `class PanelActivity` → `open class PanelActivity`; `private val model: PanelModel get() = kept.model`
→ `protected open val model: PanelModel get() = kept.model`; `private fun opened()` → `protected open fun opened()`.

`HandsFreeChatActivity.kt`:
```kotlin
package com.akshatgg.buddy.ui.panel

import com.akshatgg.buddy.AppGraph

/**
 * The hands-free chat ("Hey <name>", AppGraph.handsFreeChat) on screen: the panel's screen on that chat, opened by a tap
 * on its speech bubble or on the head while the bubble is up. Opening it never starts a new chat; closing it ends that one.
 */
class HandsFreeChatActivity : PanelActivity() {
    override val model: PanelModel get() = AppGraph.instance.handsFreeChat

    override fun opened() = Unit // the chat "Hey <name>" started, as it is; onStart puts it on screen (model.shown())

    override fun onStop() {
        if (isFinishing) model.close()
        super.onStop()
    }
}
```
`AndroidManifest.xml`, after the PanelActivity entry:
```xml
        <!-- The hands-free chat on screen (a tap on its speech bubble): the panel's card, on that chat. -->
        <activity
            android:name=".ui.panel.HandsFreeChatActivity"
            android:exported="false"
            android:excludeFromRecents="true"
            android:launchMode="singleTask"
            android:taskAffinity=""
            android:theme="@style/Theme.Buddy.Panel"
            android:windowSoftInputMode="adjustResize" />
```

- [ ] **Step 8: AppGraph and HandsFree**

`AppGraph.kt`: split `handsFree` in two. The `PanelHands` + `PanelModel(…)` block moves into
```kotlin
    /**
     * The chat "Hey <name>" talks to: its own, not the panel's, answering out loud. Off screen, what it says shows in the
     * speech bubble (showSpoken); HandsFreeChatActivity puts it on screen. It has no screen picture and no permission
     * questions: its hands never ask (a permission Buddy does not hold is a no).
     */
    val handsFreeChat: PanelModel by lazy {
        // fun held(…), val hands = PanelHands(…) as they are
        PanelModel(/* every argument as it is */, readyLine = "Open me and ask again, and I'll write it.", showSpoken = true)
    }

    /** What follows "Hey <name>" (voice/HandsFree.kt), on handsFreeChat. */
    val handsFree: HandsFree by lazy {
        val model = handsFreeChat
        val chat = object : SpokenChat { /* as it is */ }
        HandsFree(/* as it is */)
    }
```
`HandsFree.request`: `if (words.isEmpty()) return` →
```kotlin
        if (words.isEmpty()) return bubble(VoiceWords.DIDNT_CATCH) // shown, not said: the person just says the wake words again
```
and in its KDoc add: "Words that come back empty show "I didn't catch that." in the bubble, without a word said."

- [ ] **Step 9: Run** — Gradle lock command (full `testDebugUnitTest assembleDebug`). Expected: PASS, build OK.

- [ ] **Step 10: Owner's check on the phone** (install the debug APK; Listen for "Hey <name>" on): "Hey Buddy" → head
leans in, eyes up, "Yes?"; "what's the capital of France" → thinking, then the answer said and in the bubble beside
the head (no panel), gone ~8 s after; tap the bubble (or the head while it shows) → the chat with the question and
answer; ✕ closes it. "Hey Buddy message Mom I'm late" → bubble "To Mom: I'm late. Send it?", "no" → "Okay, not sent.",
nothing sent. Typing in the panel and its 🎤 as before.

- [ ] **Step 11: Commit**
```bash
git add android/app/src/main android/app/src/test
git -c user.name="akshatgg" -c user.email="akshatg9636@gmail.com" commit -m "Android: hands-free answers in the speech bubble, and a tap opens that chat"
```

---

## Which tasks can run in parallel

- S1 first (alone).
- Then **Mac (M1 → M2 → M3)** and **Android (A1 → A2 → A3)** in parallel: disjoint files (`src/`+`test/` vs `android/`).
- At the end: merge both into `voice-bubble`, run the full JS suite and the Gradle command (both with their locks),
  then one PR to master (not pushed by the implementers).
