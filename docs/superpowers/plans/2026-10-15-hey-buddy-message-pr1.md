# Message a friend on WhatsApp (PR 1 of "Hey Buddy") Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Typed in the chat panel, "message Priya on WhatsApp I'm late" finds Priya, shows **To Priya Sharma: I'm late
[Send] [Not now]**, and on Send opens her WhatsApp chat, checks its name, puts the text in and presses Send. This works
on Android and on the Mac.

**Architecture:** The shared brain (`shared/prompts.js`) gets a new answer kind, `message`, with a `to` field. A shared
pure rule, `pickChat`, decides one / which one / none from the names found. It is written in JS and ported to Kotlin,
and checked against the same generated cases. Android finds people through WhatsApp's own contact rows, opens the
chat with WhatsApp's send link, and presses Send through Buddy's Accessibility service. The Mac drives WhatsApp
desktop through two new helper commands, `waFind` and `waSend`, which find controls by their fixed Accessibility ids.

**Tech Stack:** Electron + Node (`node:test`), Swift helper (`src/native/BuddyHelper.swift`), Kotlin Android (JUnit4,
kotlinx-coroutines-test, Compose).

**Spec:** `docs/superpowers/specs/2026-10-15-hey-buddy-message-design.md`. Read its "Changes after reading the code"
section. It overrides the earlier sections.

## Global Constraints

- Branch `hey-buddy`, worktree `~/projects/buddy-hey`. Never touch other worktrees or branches.
- **No Claude attribution anywhere.** No `Co-Authored-By` trailer and no "Generated with" line in commits or PRs.
- Buddy never sends without the person pressing **Send** on the card.
- User-facing copy in plain short English, exactly as written in this plan.
- Only WhatsApp. Another app named → "I can only message on WhatsApp for now."
- Windows → "I can message on WhatsApp from the Mac and Android apps for now." The iPhone web app gives the same line.
- After changing anything in `shared/`, run `npm run sync:web && npm run sync:web-app && npm run sync:android`.
  `npm test` checks all three copies.
- JS tests: `npm test`. Android tests:
  `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew -q -Djava.net.preferIPv4Stack=true :app:testDebugUnitTest`.
- Match the surrounding code's style: plain-English doc comments, the same naming, no new libraries.

---

### Task 1: The brain learns `message`

**Files:**
- Modify: `shared/prompts.js` (KINDS :26, SYSTEM.chat :80-117, parseChat :304-325)
- Modify: `tools/sync-android-shared.js:148` (the kind list in CHAT_REPLIES), and add message cases
- Modify: `web/public/app/chat-core.js:43-50` (answerItem)
- Test: `test/prompts.test.js` (:224, :248 kind lists, new tests), `test/web-app-chat.test.mjs`
- Regenerated: `web/shared/*`, `web/public/app/shared/*`, `android/app/src/main/assets/shared.json`,
  `android/app/src/test/resources/chat-cases.json`

**Interfaces:**
- Produces: `KINDS` includes `'message'`. `parseChat(text)` returns the usual 8 fields and, **only for kind
  `message`**, a 9th field `to` (string). A message answer always has `notes: [], doIt: false, send: false,
  again: false`. A bad message answer becomes `kind: 'answer'` (no `to` field).
- Exported constants for copy: `MESSAGE_ONLY_WHATSAPP = 'I can only message on WhatsApp for now.'`.

- [ ] **Step 1: Write the failing tests** in `test/prompts.test.js`. Add `'message'` to the kind lists at :224 and
  :248. For :248 ("reads each kind"), give `message` its own test instead, because its shape differs:

```js
test('parseChat reads "message": who to, and the text to send, never doIt, send, notes or again', () => {
  const r = parseChat(answerOf({ kind: 'message', app: 'whatsapp', to: 'Priya', say: 'Okay!', text: "I'm running late", doIt: true, send: true, notes: ['x'], again: true }));
  assert.deepStrictEqual(r, { kind: 'message', say: 'Okay!', text: "I'm running late", notes: [], doIt: false, send: false, remember: [], again: false, to: 'Priya' });
});

test('parseChat: a message for another app is an answer saying only WhatsApp works', () => {
  const r = parseChat(answerOf({ kind: 'message', app: 'telegram', to: 'Priya', text: 'hi' }));
  assert.deepStrictEqual(r, { kind: 'answer', say: '', text: 'I can only message on WhatsApp for now.', notes: [], doIt: false, send: false, remember: [], again: false });
});

test('parseChat: a message with no one to send to asks who', () => {
  const r = parseChat(answerOf({ kind: 'message', app: 'whatsapp', to: ' ', text: 'hi' }));
  assert.deepStrictEqual(r, { kind: 'answer', say: '', text: 'Who should I send it to?', notes: [], doIt: false, send: false, remember: [], again: false });
});

test('parseChat: a message with nothing to say asks what', () => {
  const r = parseChat(answerOf({ kind: 'message', app: 'WhatsApp', to: 'Priya', text: '' }));
  assert.deepStrictEqual(r, { kind: 'answer', say: '', text: 'What should I say to Priya?', notes: [], doIt: false, send: false, remember: [], again: false });
});

test('parseChat keeps what they remembered on a message', () => {
  const r = parseChat(answerOf({ kind: 'message', app: 'whatsapp', to: 'Priya', text: 'hi', remember: ['Priya is your sister.'] }));
  assert.deepStrictEqual(r.remember, ['Priya is your sister.']);
});

test('the chat prompt tells the model when to answer "message" and its two extra fields', () => {
  const { system } = buildPrompt('chat', { message: 'x' });
  assert.match(system, /- "message": they ask you to message, text or tell someone something on WhatsApp/);
  assert.match(system, /"app" and "to"/);
});
```

  Note: `answerOf` (:243) fills the eight fields. Check that extra keys (`app`, `to`) pass through into the JSON
  string. If `answerOf` only copies known keys, change it to spread `...fields` last.

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/prompts.test.js`
Expected: FAIL on the new tests (`message` is not a kind yet).

- [ ] **Step 3: Implement** in `shared/prompts.js`:

```js
const KINDS = ['write', 'fix', 'answer', 'box', 'screen', 'send', 'code', 'message'];
// What a "message" answer says when it cannot be one.
const MESSAGE_ONLY_WHATSAPP = 'I can only message on WhatsApp for now.';
```

  In SYSTEM.chat:
  - Change the shape line's kind list to `"kind": "write" or "fix" or "answer" or "box" or "screen" or "send" or
    "code" or "message"`.
  - Right after the shape line's "Always give all eight fields…" line, add:
    `'For "message", also give "app" and "to": {"app": "whatsapp", "to": "Priya"}.',`
  - After the `- "code": …` line, add:

```js
      '- "message": they ask you to message, text or tell someone something on WhatsApp ("message Priya I\'m late", "Rahul ko WhatsApp karo ki main aa raha hoon"). "app" is the app they named, lower case ("whatsapp" when they named none). "to" is the person as they said it ("Priya", "Priya Sharma", "mummy"). "text" is the message itself, as they want it sent: in their words and language, fixed only when they ask ("in good English"); never "Hi Priya," added, never their name signed. When they answer "Which Priya?" with a fuller name, answer "message" again with that name and the same text.',
```

  - In the `"text"` field rule, add `For "message", the message to send.` before `For "box", "screen" and "send", "".`

  In parseChat, before `if (out.kind === 'code')`:

```js
  if (out.kind === 'message') {
    const plain = { ...out, notes: [], doIt: false, send: false, again: false };
    const asAnswer = (text) => ({ ...plain, kind: 'answer', say: '', text });
    const app = trimmed(j.app).toLowerCase();
    const to = trimmed(j.to).slice(0, CHAT_LIMITS.nameChars);
    if (app && app !== 'whatsapp') return asAnswer(MESSAGE_ONLY_WHATSAPP);
    if (!to) return asAnswer('Who should I send it to?');
    if (!out.text) return asAnswer(`What should I say to ${to}?`);
    return { ...plain, to };
  }
```

  Add `MESSAGE_ONLY_WHATSAPP` to `module.exports`. Update parseChat's doc comment: "Always returns { kind, say, text,
  notes, doIt, send, remember, again }, and `to` too for a message."

- [ ] **Step 4: Teach the iPhone web app the kind.** In `web/public/app/chat-core.js` answerItem, before the
  `!reply.say && !reply.text` line, add:

```js
  if (reply.kind === 'message') return item(MESSAGE_ELSEWHERE);
```

  Add near CANT_SEND: `const MESSAGE_ELSEWHERE = 'I can message on WhatsApp from the Mac and Android apps for now.';`.
  In `test/web-app-chat.test.mjs` (:70-75), add a case where kind `message` gives an item with that text only.

- [ ] **Step 5: Add Android cases.** In `tools/sync-android-shared.js:148`, add `'message'` to the kind list, and append
  these raw replies to `CHAT_REPLIES`, so that the Kotlin port is checked against them:

```js
  JSON.stringify({ kind: 'message', app: 'whatsapp', to: 'Priya', say: 'Okay!', text: "I'm late", notes: ['x'], doIt: true, send: true, remember: [], again: true }),
  JSON.stringify({ kind: 'message', app: 'telegram', to: 'Priya', say: '', text: 'hi', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'message', app: '', to: '', say: '', text: 'hi', notes: [], doIt: false, send: false, remember: [], again: false }),
  JSON.stringify({ kind: 'message', app: 'whatsapp', to: 'Priya', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false }),
```

  (Match how the existing entries are written. If they are objects that the script stringifies, write objects.)

- [ ] **Step 6: Sync and run everything**

Run: `npm run sync:web && npm run sync:web-app && npm run sync:android && npm test`
Expected: PASS. If `test/server-handlers.test.js` or `test/actions.test.js` assert the full kind list, add `message`
there too.

- [ ] **Step 7: Commit**

```bash
git add -A shared tools web test android/app/src/main/assets/shared.json android/app/src/test/resources/chat-cases.json
git commit -m "feat(brain): a \"message\" answer: who to send to on WhatsApp, and what"
```

---

### Task 2: `pickChat`, the shared rule for one, which one, or none

**Files:**
- Create: `shared/message-pick.js`
- Create: `test/message-pick.test.js`
- Modify: `tools/sync-android-shared.js` (write `android/app/src/test/resources/pick-cases.json`)
- Modify: `test/android-shared.test.js` (pick-cases.json must be up to date)

**Interfaces:**
- Produces: `pickChat(asked: string, names: string[]) -> { kind: 'one', name } | { kind: 'choose', names: string[] } |
  { kind: 'none' } | { kind: 'many' }` and `sameName(a, b) -> boolean`. Also `PICK_CASES` (array of `[asked, names]`),
  exported for the sync script.
- Also produces the copy, as `pickLine(asked, pick)`:
  - one → `null`
  - choose → `Which ${asked}: ${names.join(' or ')}? Tell me the full name.` (two names), or with three or four
    names: `Which ${asked}: A, B or C? Tell me the full name.`
  - none → `I couldn't find ${asked} on WhatsApp.`
  - many → `I found lots of people called ${asked}. Tell me the full name.`

- [ ] **Step 1: Write the failing tests** in `test/message-pick.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { pickChat, pickLine, sameName } = require('../shared/message-pick');

test('one match by a word of the name', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Rahul Verma', 'Priya Sharma', 'Coorg trip']), { kind: 'one', name: 'Priya Sharma' });
});
test('case, accents, extra spaces and the left-to-right mark do not matter', () => {
  assert.deepStrictEqual(pickChat('  priyá  ', ['‎Priya Sharma']), { kind: 'one', name: '‎Priya Sharma' });
  assert.strictEqual(sameName('‎Priya  Sharma', 'priya sharma'), true);
});
test('an exact full name wins over other matches', () => {
  assert.deepStrictEqual(pickChat('Priya Sharma', ['Priya Sharma', 'Priya Sharma Office']), { kind: 'one', name: 'Priya Sharma' });
});
test('an exact one-word name wins too ("Mummy" over "Mummy Office")', () => {
  assert.deepStrictEqual(pickChat('mummy', ['Mummy Office', 'Mummy']), { kind: 'one', name: 'Mummy' });
});
test('two to four matches: which one', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Priya Sharma', 'Priya Verma']), { kind: 'choose', names: ['Priya Sharma', 'Priya Verma'] });
});
test('every word they said must be in the name, as a word start', () => {
  assert.deepStrictEqual(pickChat('Priya Ver', ['Priya Sharma', 'Priya Verma']), { kind: 'one', name: 'Priya Verma' });
  assert.deepStrictEqual(pickChat('riya', ['Priya Sharma']), { kind: 'none' });
});
test('the same name twice counts once', () => {
  assert.deepStrictEqual(pickChat('Priya', ['Priya Sharma', 'Priya Sharma']), { kind: 'one', name: 'Priya Sharma' });
});
test('no match, and more than four', () => {
  assert.deepStrictEqual(pickChat('Zoya', ['Priya Sharma']), { kind: 'none' });
  assert.deepStrictEqual(pickChat('a', ['A b', 'A c', 'A d', 'A e', 'A f']), { kind: 'many' });
  assert.deepStrictEqual(pickChat('', ['Priya']), { kind: 'none' });
});
test('the lines Buddy says', () => {
  assert.strictEqual(pickLine('Priya', { kind: 'one', name: 'Priya Sharma' }), null);
  assert.strictEqual(pickLine('Priya', { kind: 'choose', names: ['Priya Sharma', 'Priya Verma'] }), 'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.');
  assert.strictEqual(pickLine('Priya', { kind: 'choose', names: ['A', 'B', 'C'] }), 'Which Priya: A, B or C? Tell me the full name.');
  assert.strictEqual(pickLine('Zoya', { kind: 'none' }), "I couldn't find Zoya on WhatsApp.");
  assert.strictEqual(pickLine('a', { kind: 'many' }), 'I found lots of people called a. Tell me the full name.');
});
```

- [ ] **Step 2: Run and see it fail**

Run: `node --test test/message-pick.test.js`
Expected: FAIL, "Cannot find module '../shared/message-pick'".

- [ ] **Step 3: Implement** `shared/message-pick.js`:

```js
'use strict';

/**
 * Who "Priya" is, among the names Buddy found (the phone's WhatsApp contacts, or WhatsApp's search on the Mac): one
 * person, a few to choose from, nobody, or too many. Every word they said must start a word of the name, ignoring
 * case, accents, extra spaces and the invisible left-to-right mark WhatsApp puts before names. A name that is exactly
 * what they said wins over the others. The Android app has a port of this (message/Pick.kt), checked against the cases
 * below (tools/sync-android-shared.js writes them out).
 */

const MAX_CHOICES = 4;

/** Lower case, no accents, no marks, single spaces. */
function plain(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ‎‏‪-‮]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether two names are the same name. */
function sameName(a, b) {
  return plain(a) !== '' && plain(a) === plain(b);
}

function pickChat(asked, names) {
  const words = plain(asked).split(' ').filter(Boolean);
  if (!words.length) return { kind: 'none' };
  const seen = new Set();
  const found = [];
  for (const name of names) {
    const key = plain(name);
    if (seen.has(key)) continue;
    const parts = key.split(' ');
    if (words.every((w) => parts.some((p) => p.startsWith(w)))) {
      seen.add(key);
      found.push(name);
    }
  }
  const exact = found.filter((name) => sameName(name, asked));
  if (exact.length === 1) return { kind: 'one', name: exact[0] };
  if (found.length === 1) return { kind: 'one', name: found[0] };
  if (found.length === 0) return { kind: 'none' };
  if (found.length > MAX_CHOICES) return { kind: 'many' };
  return { kind: 'choose', names: found };
}

/** What Buddy says for a pick, or null when there is one person. */
function pickLine(asked, pick) {
  if (pick.kind === 'one') return null;
  if (pick.kind === 'none') return `I couldn't find ${asked} on WhatsApp.`;
  if (pick.kind === 'many') return `I found lots of people called ${asked}. Tell me the full name.`;
  const names = pick.names.length === 2
    ? pick.names.join(' or ')
    : `${pick.names.slice(0, -1).join(', ')} or ${pick.names.at(-1)}`;
  return `Which ${asked}: ${names}? Tell me the full name.`;
}

// The cases the Kotlin port must answer the same way.
const PICK_CASES = [
  ['Priya', ['Rahul Verma', 'Priya Sharma', 'Coorg trip']],
  ['  priyá  ', ['‎Priya Sharma']],
  ['Priya Sharma', ['Priya Sharma', 'Priya Sharma Office']],
  ['mummy', ['Mummy Office', 'Mummy']],
  ['Priya', ['Priya Sharma', 'Priya Verma']],
  ['Priya', ['Priya Sharma', 'Priya Verma', 'Priya K']],
  ['Priya Ver', ['Priya Sharma', 'Priya Verma']],
  ['riya', ['Priya Sharma']],
  ['Priya', ['Priya Sharma', 'Priya Sharma']],
  ['Zoya', ['Priya Sharma']],
  ['a', ['A b', 'A c', 'A d', 'A e', 'A f']],
  ['', ['Priya']],
];

module.exports = { pickChat, pickLine, sameName, PICK_CASES };
```

- [ ] **Step 4: Run and see it pass**

Run: `node --test test/message-pick.test.js`
Expected: PASS.

- [ ] **Step 5: Write the Kotlin cases.** In `tools/sync-android-shared.js`, next to `CASES_TO`, add
  `const PICK_TO = path.join(ROOT, 'android/app/src/test/resources/pick-cases.json');` (use the same root variable the
  file already uses). Write:

```js
const { pickChat, pickLine, PICK_CASES } = require('../shared/message-pick');
function buildPickCases() {
  return PICK_CASES.map(([asked, names]) => {
    const pick = pickChat(asked, names);
    return { asked, names, pick, line: pickLine(asked, pick) };
  });
}
```

  Write it the same way `chat-cases.json` is written: same JSON formatting and trailing newline. In
  `test/android-shared.test.js`, add a test in the same style as the chat-cases one:
  `'the pick cases the Kotlin port is checked against are up to date (run \`npm run sync:android\`)'`.

  The sync tool and `web/shared` both copy `shared/`. Run `npm run sync:web` too. The web copy checks every file in
  `shared/`.

- [ ] **Step 6: Run everything**

Run: `npm run sync:web && npm run sync:web-app && npm run sync:android && npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A shared tools test web android/app/src/test/resources/pick-cases.json
git commit -m "feat(message): one rule for which person \"Priya\" is, shared by the Mac and Android"
```

---

### Task 3: Android reads `message` and ports `pickChat`

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ai/Prompts.kt:38-47` (ChatReply)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ai/ChatPrompt.kt:122-143` (readChat)
- Create: `android/app/src/main/java/com/akshatgg/buddy/message/Pick.kt`
- Test: `android/app/src/test/java/com/akshatgg/buddy/ai/ChatPromptTest.kt`, create
  `android/app/src/test/java/com/akshatgg/buddy/message/PickTest.kt`

**Interfaces:**
- Consumes: `chat-cases.json` and `pick-cases.json` from Tasks 1-2.
- Produces:
  - `ChatReply(..., val to: String = "")` as the last parameter, with a default so that every positional caller keeps
    working.
  - `sealed interface Pick { data class One(val name: String); data class Choose(val names: List<String>); data object
    None; data object Many }`
  - `fun pickChat(asked: String, names: List<String>): Pick`
  - `fun pickLine(asked: String, pick: Pick): String?`
  - `fun sameName(a: String, b: String): Boolean`

- [ ] **Step 1: Failing tests.**
  - In `ChatPromptTest.kt`, update the hard-coded kinds assertion (:181-187) to include `"message"`.
  - Make `parseChatReadsEachKind` (:191) skip `"message"`, because it has its own shape.
  - Make the chat-cases comparison (:75-93) also compare `to` (`reply.optString("to", "")` against `parsed.to`).
  - Add:

```kotlin
@Test fun aMessageKeepsWhoItIsToAndNeverDoesItOrSends() {
    val r = prompts.parseChat("""{"kind":"message","app":"whatsapp","to":"Priya","say":"Okay!","text":"I'm late","notes":["x"],"doIt":true,"send":true,"remember":[],"again":true}""")
    assertEquals(ChatReply("message", "Okay!", "I'm late", emptyList(), false, false, emptyList(), false, to = "Priya"), r)
}
@Test fun aMessageForAnotherAppSaysOnlyWhatsApp() {
    val r = prompts.parseChat("""{"kind":"message","app":"telegram","to":"Priya","say":"","text":"hi","notes":[],"doIt":false,"send":false,"remember":[],"again":false}""")
    assertEquals(ChatReply("answer", "", "I can only message on WhatsApp for now.", emptyList(), false, false, emptyList(), false), r)
}
```

  Create `PickTest.kt`. It reads `src/test/resources/pick-cases.json` the way ChatPromptTest reads chat-cases.json
  (same loader), and for every case asserts that `pickChat(asked, names)` matches `pick` (map JSON `kind`
  one/choose/none/many to the sealed types) and that `pickLine` matches `line` (JSON null ↔ Kotlin null).

- [ ] **Step 2: Run and see them fail**

Run: `cd android && JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home" ./gradlew -q -Djava.net.preferIPv4Stack=true :app:testDebugUnitTest --tests '*ChatPromptTest*' --tests '*PickTest*'`
Expected: FAIL to compile (`to`, `pickChat` unknown).

- [ ] **Step 3: Implement.**
  - In `Prompts.kt`, add `val to: String = ""` as ChatReply's last parameter.
  - In `ChatPrompt.kt` readChat, before the `kind == "code"` line:

```kotlin
    if (kind == "message") {
        val plain = out.copy(notes = emptyList(), doIt = false, send = false, again = false)
        fun asAnswer(text: String) = plain.copy(kind = "answer", say = "", text = text)
        val app = j.string("app").lowercase()
        val to = j.string("to").take(limits.nameChars)
        if (app.isNotEmpty() && app != "whatsapp") return asAnswer("I can only message on WhatsApp for now.")
        if (to.isEmpty()) return asAnswer("Who should I send it to?")
        if (plain.text.isEmpty()) return asAnswer("What should I say to $to?")
        return plain.copy(to = to)
    }
```

  `limits.nameChars` exists in `ChatLimits` (`Shared.kt:13-16`).

  Create `message/Pick.kt`, a direct port of `shared/message-pick.js` with the same doc comment, pointing back to the
  JS file:

```kotlin
package com.akshatgg.buddy.message

import java.text.Normalizer

/** Who "Priya" is among the names found. A port of shared/message-pick.js, checked against pick-cases.json. */
sealed interface Pick {
    data class One(val name: String) : Pick
    data class Choose(val names: List<String>) : Pick
    data object None : Pick
    data object Many : Pick
}

private const val MAX_CHOICES = 4
private val MARKS = Regex("[\\u0300-\\u036f\\u200e\\u200f\\u202a-\\u202e]")
private val SPACES = Regex("\\s+")

private fun plain(name: String): String =
    Normalizer.normalize(name, Normalizer.Form.NFKD).replace(MARKS, "").lowercase().replace(SPACES, " ").trim()

fun sameName(a: String, b: String): Boolean = plain(a).isNotEmpty() && plain(a) == plain(b)

fun pickChat(asked: String, names: List<String>): Pick {
    val words = plain(asked).split(' ').filter { it.isNotEmpty() }
    if (words.isEmpty()) return Pick.None
    val seen = HashSet<String>()
    val found = mutableListOf<String>()
    for (name in names) {
        val key = plain(name)
        if (key in seen) continue
        val parts = key.split(' ')
        if (words.all { w -> parts.any { it.startsWith(w) } }) { seen += key; found += name }
    }
    val exact = found.filter { sameName(it, asked) }
    return when {
        exact.size == 1 -> Pick.One(exact[0])
        found.size == 1 -> Pick.One(found[0])
        found.isEmpty() -> Pick.None
        found.size > MAX_CHOICES -> Pick.Many
        else -> Pick.Choose(found)
    }
}

fun pickLine(asked: String, pick: Pick): String? = when (pick) {
    is Pick.One -> null
    Pick.None -> "I couldn't find $asked on WhatsApp."
    Pick.Many -> "I found lots of people called $asked. Tell me the full name."
    is Pick.Choose -> {
        val names = if (pick.names.size == 2) pick.names.joinToString(" or ")
        else pick.names.dropLast(1).joinToString(", ") + " or " + pick.names.last()
        "Which $asked: $names? Tell me the full name."
    }
}
```

  Note: JS `toLowerCase()` and Kotlin `lowercase()` agree for these cases. JS `\s` and Kotlin `\s` differ on some
  Unicode spaces. The pick cases decide, so if one fails, align the regex with JS (use `[\\s\\u00a0]`).

- [ ] **Step 4: Run and see them pass**

Run: the gradle command from Step 2, then the full Android suite (Global Constraints).
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): read \"message\" answers, and the same rule for which person it is"
```

---

### Task 4: Android finds WhatsApp people and opens their chat

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/message/WhatsApp.kt`
- Modify: `android/app/src/main/AndroidManifest.xml` (READ_CONTACTS, `<queries>` packages)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/AppGraph.kt` (next to `typeIn`, :97)
- Test: create `android/app/src/test/java/com/akshatgg/buddy/message/WhatsAppTest.kt`

**Interfaces:**
- Produces:
  - `data class Person(val name: String, val number: String, val app: String)`. `app` is the package that knows this
    person: `"com.whatsapp"` or `"com.whatsapp.w4b"`. `number` is digits only.
  - `fun personFrom(name: String?, data1: String?, mime: String?): Person?`. Pure: turns one contacts row into a
    Person, or null.
  - `fun chatLink(person: Person, text: String): String`. Pure:
    `https://api.whatsapp.com/send?phone=<number>&text=<urlencoded>`.
  - `interface WhatsApp { fun installed(): Boolean; suspend fun people(): List<Person>; fun open(person: Person, text:
    String) }`
  - `class PhoneWhatsApp(context: Context) : WhatsApp`, the real one.
  - `AppGraph.whatsApp: WhatsApp by lazy { PhoneWhatsApp(appContext) }`.

- [ ] **Step 1: Failing tests** in `WhatsAppTest.kt`:

```kotlin
package com.akshatgg.buddy.message

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WhatsAppTest {
    @Test fun aWhatsAppRowIsAPersonWithTheirNumber() {
        assertEquals(Person("Priya Sharma", "919812345678", "com.whatsapp"),
            personFrom("Priya Sharma", "919812345678@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
    }
    @Test fun aBusinessRowIsForWhatsAppBusiness() {
        assertEquals("com.whatsapp.w4b", personFrom("Priya", "91981@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.w4b.profile")?.app)
    }
    @Test fun rowsWithoutANameOrNumberOrOfAnotherKindAreNobody() {
        assertNull(personFrom("", "9198@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "abc@s.whatsapp.net", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
        assertNull(personFrom("Priya", "9198@s.whatsapp.net", "vnd.android.cursor.item/phone_v2"))
        assertNull(personFrom("Group", "1203630@g.us", "vnd.android.cursor.item/vnd.com.whatsapp.profile"))
    }
    @Test fun theLinkCarriesTheNumberAndTheTextEncoded() {
        assertEquals("https://api.whatsapp.com/send?phone=919812345678&text=I%27m+late+%26+sorry%21",
            chatLink(Person("Priya", "919812345678", "com.whatsapp"), "I'm late & sorry!"))
    }
}
```

- [ ] **Step 2: Run and see it fail** (gradle with `--tests '*WhatsAppTest*'`). Expected: compile failure.

- [ ] **Step 3: Implement** `message/WhatsApp.kt`:

```kotlin
package com.akshatgg.buddy.message

import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.ContactsContract
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.net.URLEncoder

/** Someone the phone knows on WhatsApp: the name in the phone's contacts, their number (digits) and which WhatsApp. */
data class Person(val name: String, val number: String, val app: String)

// WhatsApp adds a row of its own to each contact who uses it; `data1` is "<number>@s.whatsapp.net".
private val MIMES = mapOf(
    "vnd.android.cursor.item/vnd.com.whatsapp.profile" to "com.whatsapp",
    "vnd.android.cursor.item/vnd.com.whatsapp.w4b.profile" to "com.whatsapp.w4b",
)
private const val SUFFIX = "@s.whatsapp.net"
private val DIGITS = Regex("\\d{5,20}")

/** One contacts row as a Person, or null when it is not a person on WhatsApp. */
fun personFrom(name: String?, data1: String?, mime: String?): Person? {
    val app = MIMES[mime] ?: return null
    val who = name?.trim().orEmpty()
    val id = data1?.trim().orEmpty()
    if (who.isEmpty() || !id.endsWith(SUFFIX)) return null
    val number = id.removeSuffix(SUFFIX)
    if (!DIGITS.matches(number)) return null
    return Person(who, number, app)
}

/** WhatsApp's own link that opens the chat with the text in its box (nothing is sent). */
fun chatLink(person: Person, text: String): String =
    "https://api.whatsapp.com/send?phone=${person.number}&text=${URLEncoder.encode(text, "UTF-8")}"

/** WhatsApp on this phone, as Buddy uses it to message someone. */
interface WhatsApp {
    fun installed(): Boolean
    /** Everyone in the phone's contacts who is on WhatsApp. Needs the Contacts permission. */
    suspend fun people(): List<Person>
    /** Opens the person's chat with `text` in the box. */
    fun open(person: Person, text: String)
}

class PhoneWhatsApp(private val context: Context) : WhatsApp {
    override fun installed(): Boolean = MIMES.values.any { has(it) }

    private fun has(pkg: String): Boolean = try {
        context.packageManager.getPackageInfo(pkg, 0); true
    } catch (_: PackageManager.NameNotFoundException) { false }

    override suspend fun people(): List<Person> = withContext(Dispatchers.IO) {
        val out = mutableListOf<Person>()
        val columns = arrayOf(ContactsContract.Data.DISPLAY_NAME, ContactsContract.Data.DATA1, ContactsContract.Data.MIMETYPE)
        val where = "${ContactsContract.Data.MIMETYPE} IN (?, ?)"
        context.contentResolver.query(ContactsContract.Data.CONTENT_URI, columns, where, MIMES.keys.toTypedArray(), null)?.use { rows ->
            while (rows.moveToNext()) personFrom(rows.getString(0), rows.getString(1), rows.getString(2))?.let(out::add)
        }
        out.filter { has(it.app) }
    }

    override fun open(person: Person, text: String) {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(chatLink(person, text)))
            .setPackage(person.app)
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        context.startActivity(intent)
    }
}
```

  Manifest: add `<uses-permission android:name="android.permission.READ_CONTACTS" />` next to RECORD_AUDIO. Inside
  `<queries>`, add `<package android:name="com.whatsapp" />` and `<package android:name="com.whatsapp.w4b" />`.

  AppGraph (next to `typeIn`): `val whatsApp: WhatsApp by lazy { PhoneWhatsApp(appContext) }`.

- [ ] **Step 4: Run and see it pass.** Run the full Android suite. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): find people on WhatsApp in the phone's contacts and open their chat"
```

---

### Task 5: Android's Accessibility service reads WhatsApp's chat name and presses Send

**Files:**
- Create: `android/app/src/main/java/com/akshatgg/buddy/message/WhatsAppScreen.kt` (pure, generic over the node type)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/bubble/LookService.kt` (two public functions)
- Modify: `android/app/src/main/res/xml/look_service.xml` (add `flagReportViewIds`)
- Test: create `android/app/src/test/java/com/akshatgg/buddy/message/WhatsAppScreenTest.kt`

**Interfaces:**
- Produces:
  - `class WhatsAppScreen<N>(private val byId: (N, String) -> List<N>, private val text: (N) -> String?, private val
    describe: (N) -> String?)` with `fun chatName(root: N, app: String): String?` and `fun sendButton(root: N, app:
    String): N?`.
  - `LookService.whatsAppChat(app: String): String?` and `LookService.pressWhatsAppSend(app: String): Boolean`.
  - Both read `rootInActiveWindow` and must be called off the main thread.

  WhatsApp's view ids (Android, 2026), all under the package `<app>`:
  - chat name: `<app>:id/conversation_contact_name`
  - Send: `<app>:id/send`

  Send has a fallback: any node under `<app>:id/footer` (or the whole root) whose content description is "Send"
  (ignoring case).

- [ ] **Step 1: Failing tests.** Use a tiny fake node type, as `TypingTargetTest` does with Strings:

```kotlin
package com.akshatgg.buddy.message

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class WhatsAppScreenTest {
    data class Node(val id: String = "", val text: String? = null, val desc: String? = null, val kids: List<Node> = emptyList())
    private fun all(n: Node): List<Node> = listOf(n) + n.kids.flatMap(::all)
    private val screen = WhatsAppScreen<Node>(
        byId = { root, id -> all(root).filter { it.id == id } },
        text = { it.text }, describe = { it.desc },
    )

    @Test fun theChatNameIsTheHeadersText() {
        val root = Node(kids = listOf(Node("com.whatsapp:id/conversation_contact_name", text = "Priya Sharma")))
        assertEquals("Priya Sharma", screen.chatName(root, "com.whatsapp"))
    }
    @Test fun noHeaderNoName() = assertNull(screen.chatName(Node(), "com.whatsapp"))
    @Test fun sendIsFoundByItsIdInTheRightApp() {
        val send = Node("com.whatsapp.w4b:id/send", desc = "Send")
        assertEquals(send, screen.sendButton(Node(kids = listOf(send)), "com.whatsapp.w4b"))
        assertNull(screen.sendButton(Node(kids = listOf(send)), "com.whatsapp"))
    }
    @Test fun elseByItsDescription() {
        val send = Node("x", desc = "send")
        assertEquals(send, screen.sendButton(Node(kids = listOf(Node("y", desc = "Emoji"), send)), "com.whatsapp"))
    }
}
```

  `byId` returns every match under the root. `chatName` takes the first non-blank text. The description fallback
  walks the root itself: add `private val kids: (N) -> List<N>` as a fourth constructor parameter, and update the
  test's `screen` with `kids = { it.kids }`.

- [ ] **Step 2: Run and see it fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `WhatsAppScreen.kt`:

```kotlin
package com.akshatgg.buddy.message

/**
 * Where things are on WhatsApp's chat screen, found by WhatsApp's own view ids (and Send also by its description,
 * should an update rename it). Generic over the node so that it can be tested without Android.
 */
class WhatsAppScreen<N>(
    private val byId: (N, String) -> List<N>,
    private val text: (N) -> String?,
    private val describe: (N) -> String?,
    private val kids: (N) -> List<N>,
) {
    fun chatName(root: N, app: String): String? =
        byId(root, "$app:id/conversation_contact_name").firstNotNullOfOrNull { text(it)?.trim()?.takeIf(String::isNotEmpty) }

    fun sendButton(root: N, app: String): N? =
        byId(root, "$app:id/send").firstOrNull() ?: find(root) { describe(it).equals("send", ignoreCase = true) }

    private fun find(node: N, depth: Int = 0, test: (N) -> Boolean): N? {
        if (test(node)) return node
        if (depth > 40) return null
        for (k in kids(node)) find(k, depth + 1, test)?.let { return it }
        return null
    }
}
```

  In `look_service.xml`, change the flags to `android:accessibilityFlags="flagRetrieveInteractiveWindows|flagReportViewIds"`
  and add one line to its comment: "flagReportViewIds: Buddy finds WhatsApp's chat name and Send by their ids
  (message/WhatsAppScreen.kt)."

  In `LookService.kt`, add (the node type is `AccessibilityNodeInfo`):

```kotlin
    private val whatsApp = WhatsAppScreen<AccessibilityNodeInfo>(
        byId = { root, id -> root.findAccessibilityNodeInfosByViewId(id) },
        text = { it.text?.toString() }, describe = { it.contentDescription?.toString() },
        kids = { n -> (0 until n.childCount).mapNotNull { n.getChild(it) } },
    )

    /** The name at the top of the open WhatsApp chat, or null when WhatsApp (`app`) is not showing a chat. */
    fun whatsAppChat(app: String): String? {
        val root = rootInActiveWindow ?: return null
        if (root.packageName?.toString() != app) return null
        return whatsApp.chatName(root, app)
    }

    /** Presses Send in the open WhatsApp chat. False when it is not there or did not take the press. */
    fun pressWhatsAppSend(app: String): Boolean {
        val root = rootInActiveWindow ?: return false
        if (root.packageName?.toString() != app) return false
        val send = whatsApp.sendButton(root, app) ?: return false
        return send.performAction(AccessibilityNodeInfo.ACTION_CLICK)
    }
```

  Check how the file releases nodes (`recycle()` is a no-op from API 33; minSdk is 26). Follow the existing
  `fresh()`/`copy` pattern if it recycles. Otherwise leave it as above.

- [ ] **Step 4: Run and see it pass.** Run the full Android suite. Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add android
git commit -m "feat(android): Buddy can read WhatsApp's chat name and press its Send"
```

---

### Task 6: Android's panel does the message: card, Send, check, sent

**Files:**
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelModel.kt`
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelScreen.kt` (LABELS :112-115)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/ChatHost.kt` (wiring :56-76; Contacts permission)
- Modify: `android/app/src/main/java/com/akshatgg/buddy/ui/panel/PanelActivity.kt` and `FixActivity.kt` (a Contacts
  permission launcher, as for screen capture)
- Create: `android/app/src/main/java/com/akshatgg/buddy/message/Messenger.kt` (the steps, testable)
- Test: create `android/app/src/test/java/com/akshatgg/buddy/message/MessengerTest.kt`; modify `PanelModelTest.kt`

**Interfaces:**
- Consumes: `WhatsApp`, `Person`, `pickChat`, `pickLine`, `sameName`, `LookService.whatsAppChat`,
  `LookService.pressWhatsAppSend`, and `ChatReply.to`.
- Produces:
  - `interface ChatScreen { fun on(): Boolean; suspend fun chatName(app: String): String?; suspend fun pressSend(app:
    String): Boolean }`, with the real one `ServiceChatScreen(context)` over `LookService.running` (and
    `LookService.isEnabled`).
  - `class Messenger(whatsApp: WhatsApp, screen: ChatScreen, contactsAllowed: suspend () -> Boolean, wait: suspend
    (Long) -> Unit = ::delay)` with:
    - `suspend fun find(asked: String): Found`, where `sealed interface Found { data class One(val person: Person);
      data class Say(val line: String, val code: String? = null) }`
    - `suspend fun send(person: Person, text: String): Sent`, where `sealed interface Sent { data object Done; data
      class Failed(val line: String, val code: String? = null) }`
  - `ChatButton.SEND_MESSAGE` and `ChatButton.NOT_NOW`, labelled "Send" and "Not now".
  - `PanelHands.contacts: suspend () -> Boolean` (default `{ false }`): true when Contacts is allowed, asking once if
    not.

  The copy, exactly:

  | When | Line | code |
  |---|---|---|
  | no WhatsApp | `WhatsApp isn't on this phone.` | |
  | Contacts refused | `I need your contacts to find {asked}. You can allow it in Settings.` | `no_contacts` (gets "Open Settings", opening the app's details like `no_microphone`) |
  | pick line | from `pickLine` | |
  | card | say: `""`, text: `To {name}:\n{text}`, buttons `[SEND_MESSAGE, NOT_NOW]` | |
  | Accessibility off at Send | `It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.` | `no_accessibility` |
  | chat did not open in 8 s | `WhatsApp didn't open {name}'s chat, so I didn't send it.` | |
  | wrong chat | `That opened the wrong chat, so I didn't send it.` | |
  | Send not pressed | `I couldn't press Send. It's ready in WhatsApp: press Send yourself.` | |
  | sent | ChatEvent `✅ Sent to {name}`, bubble `Sent ✅`, mood HAPPY | |
  | Not now | ChatEvent `Okay, not sent.` | |

- [ ] **Step 1: Failing tests for Messenger** (`MessengerTest.kt`), with fakes for WhatsApp and ChatScreen:

```kotlin
package com.akshatgg.buddy.message

import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Test

class MessengerTest {
    private val priya = Person("Priya Sharma", "9198", "com.whatsapp")
    private class FakeWhatsApp(var on: Boolean = true, val list: List<Person> = emptyList()) : WhatsApp {
        val opened = mutableListOf<Pair<Person, String>>()
        override fun installed() = on
        override suspend fun people() = list
        override fun open(person: Person, text: String) { opened += person to text }
    }
    private class FakeScreen(var on: Boolean = true, var names: MutableList<String?> = mutableListOf("Priya Sharma"), var press: Boolean = true) : ChatScreen {
        val pressed = mutableListOf<String>()
        override fun on() = on
        override suspend fun chatName(app: String) = if (names.size > 1) names.removeAt(0) else names.firstOrNull()
        override suspend fun pressSend(app: String): Boolean { pressed += app; return press }
    }
    private fun messenger(w: WhatsApp, s: ChatScreen = FakeScreen(), allowed: Boolean = true) =
        Messenger(w, s, contactsAllowed = { allowed }, wait = {})

    @Test fun findsOnePerson() = runTest {
        assertEquals(Found.One(priya), messenger(FakeWhatsApp(list = listOf(priya, Person("Rahul", "9197", "com.whatsapp")))).find("priya"))
    }
    @Test fun noWhatsApp() = runTest {
        assertEquals(Found.Say("WhatsApp isn't on this phone."), messenger(FakeWhatsApp(on = false)).find("Priya"))
    }
    @Test fun noContacts() = runTest {
        assertEquals(Found.Say("I need your contacts to find Priya. You can allow it in Settings.", "no_contacts"),
            messenger(FakeWhatsApp(list = listOf(priya)), allowed = false).find("Priya"))
    }
    @Test fun whichOne() = runTest {
        val two = listOf(priya, Person("Priya Verma", "9199", "com.whatsapp"))
        assertEquals(Found.Say("Which Priya: Priya Sharma or Priya Verma? Tell me the full name."), messenger(FakeWhatsApp(list = two)).find("Priya"))
    }
    @Test fun sendsAfterTheRightChatOpens() = runTest {
        val w = FakeWhatsApp(); val s = FakeScreen(names = mutableListOf(null, null, "Priya Sharma"))
        assertEquals(Sent.Done, messenger(w, s).send(priya, "I'm late"))
        assertEquals(listOf(priya to "I'm late"), w.opened)
        assertEquals(listOf("com.whatsapp"), s.pressed)
    }
    @Test fun wrongChatIsNotSent() = runTest {
        val s = FakeScreen(names = mutableListOf("Rahul"))
        assertEquals(Sent.Failed("That opened the wrong chat, so I didn't send it."), messenger(FakeWhatsApp(), s).send(priya, "hi"))
        assertEquals(emptyList<String>(), s.pressed)
    }
    @Test fun chatThatNeverOpens() = runTest {
        val s = FakeScreen(names = mutableListOf(null))
        assertEquals(Sent.Failed("WhatsApp didn't open Priya Sharma's chat, so I didn't send it."), messenger(FakeWhatsApp(), s).send(priya, "hi"))
    }
    @Test fun accessibilityOff() = runTest {
        val w = FakeWhatsApp()
        assertEquals(Sent.Failed("It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", "no_accessibility"),
            messenger(w, FakeScreen(on = false)).send(priya, "hi"))
        assertEquals(1, w.opened.size) // the text is still put in, for them to send
    }
    @Test fun sendNotTaken() = runTest {
        assertEquals(Sent.Failed("I couldn't press Send. It's ready in WhatsApp: press Send yourself."),
            messenger(FakeWhatsApp(), FakeScreen(press = false)).send(priya, "hi"))
    }
}
```

- [ ] **Step 2: Run and see it fail.** Expected: compile failure.

- [ ] **Step 3: Implement** `message/Messenger.kt`:

```kotlin
package com.akshatgg.buddy.message

import android.content.Context
import com.akshatgg.buddy.bubble.LookService
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext

/** What Buddy's Accessibility service can do in WhatsApp's chat screen. */
interface ChatScreen {
    fun on(): Boolean
    suspend fun chatName(app: String): String?
    suspend fun pressSend(app: String): Boolean
}

class ServiceChatScreen(private val context: Context) : ChatScreen {
    override fun on() = LookService.isEnabled(context) && LookService.running != null
    override suspend fun chatName(app: String) = withContext(Dispatchers.Default) { LookService.running?.whatsAppChat(app) }
    override suspend fun pressSend(app: String) = withContext(Dispatchers.Default) { LookService.running?.pressWhatsAppSend(app) == true }
}

sealed interface Found {
    data class One(val person: Person) : Found
    data class Say(val line: String, val code: String? = null) : Found
}

sealed interface Sent {
    data object Done : Sent
    data class Failed(val line: String, val code: String? = null) : Sent
}

/** What the chat panel needs for a message: who, then send. */
interface Messaging {
    suspend fun find(asked: String): Found
    suspend fun send(person: Person, text: String): Sent
}

private const val OPEN_WAIT_MS = 8_000L
private const val STEP_MS = 250L

/**
 * Messaging someone on WhatsApp, the steps in order. find(): who "Priya" is, among the phone's WhatsApp contacts.
 * send(), only after the person said yes: open the chat with the text in its box, wait until WhatsApp shows that
 * chat, check its name, press Send. Nothing is sent when anything is off; the text then waits in WhatsApp's box.
 */
class Messenger(
    private val whatsApp: WhatsApp,
    private val screen: ChatScreen,
    private val contactsAllowed: suspend () -> Boolean,
    private val wait: suspend (Long) -> Unit = { delay(it) },
) : Messaging {
    override suspend fun find(asked: String): Found {
        if (!whatsApp.installed()) return Found.Say("WhatsApp isn't on this phone.")
        if (!contactsAllowed()) return Found.Say("I need your contacts to find $asked. You can allow it in Settings.", "no_contacts")
        val people = whatsApp.people()
        val pick = pickChat(asked, people.map { it.name })
        if (pick is Pick.One) return Found.One(people.first { it.name == pick.name })
        return Found.Say(pickLine(asked, pick)!!)
    }

    override suspend fun send(person: Person, text: String): Sent {
        whatsApp.open(person, text)
        if (!screen.on()) return Sent.Failed("It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you.", "no_accessibility")
        var name: String? = null
        var waited = 0L
        while (waited < OPEN_WAIT_MS) {
            name = screen.chatName(person.app)
            if (name != null) break
            wait(STEP_MS); waited += STEP_MS
        }
        if (name == null) return Sent.Failed("WhatsApp didn't open ${person.name}'s chat, so I didn't send it.")
        if (!sameName(name, person.name)) return Sent.Failed("That opened the wrong chat, so I didn't send it.")
        return if (screen.pressSend(person.app)) Sent.Done
        else Sent.Failed("I couldn't press Send. It's ready in WhatsApp: press Send yourself.")
    }
}
```

  Note: when WhatsApp shows a phone number because the contact name differs, `sameName` fails and Buddy does not send.
  That is the safe side.

- [ ] **Step 4: Run MessengerTest and see it pass.**

- [ ] **Step 5: Failing PanelModel tests.** In `PanelModelTest.kt`:
  - Add a `FakeMessaging : Messaging` (the interface is in `message/Messenger.kt`), with queued `Found`/`Sent` answers
    and a log of calls.
  - The constructor gets `messaging: Messaging` as a new parameter after `hands`.
  - Tests:
    1. A `message` reply whose find gives `One(priya)` adds `BuddySaid(id, "", "To Priya Sharma:\nI'm late",
       emptyList(), listOf(SEND_MESSAGE, NOT_NOW))`, and nothing is opened.
    2. Pressing SEND_MESSAGE calls `hands.stepAside` and then `send(priya, "I'm late")`. On Done, the card becomes
       `ChatEvent(id, "✅ Sent to Priya Sharma")`, the bubble says "Sent ✅" and the mood is HAPPY.
    3. NOT_NOW turns the card into `ChatEvent(id, "Okay, not sent.")` and send is never called.
    4. `Found.Say(line)` adds `BuddySaid(id, "", line, emptyList(), emptyList())`. With code `no_contacts`, it adds
       `ChatError(id, line, "no_contacts", listOf(SETTINGS))` instead.
    5. `Sent.Failed(line, code)` adds a ChatError with SETTINGS when the code is in SETTINGS_ERRORS, and the bubble says
       the line. The card stays a card, so they can press Send again.
    6. The `say` of the reply, when not blank, is shown before the card (as a BuddySaid with only say), so "Okay!"
       still shows.

- [ ] **Step 6: Implement in PanelModel.**
  - Add `SEND_MESSAGE` and `NOT_NOW` to `ChatButton`. Add a private map `messages = HashMap<Int, Pair<Person,
    String>>()` to `Chat`, next to `modes` and `about`.
  - In `finish()`, first line:

```kotlin
        if (reply.kind == "message") return message(c, reply)
```

```kotlin
    private suspend fun message(c: Chat, reply: ChatReply): Outcome {
        if (reply.say.isNotBlank()) add(c) { BuddySaid(it, reply.say, "", emptyList(), emptyList()) }
        when (val found = messaging.find(reply.to)) {
            is Found.Say -> add(c) {
                if (found.code != null) ChatError(it, found.line, found.code, listOf(ChatButton.SETTINGS))
                else BuddySaid(it, "", found.line, emptyList(), emptyList())
            }
            is Found.One -> {
                val item = add(c) { BuddySaid(it, "", "To ${found.person.name}:\n${reply.text}", emptyList(), listOf(ChatButton.SEND_MESSAGE, ChatButton.NOT_NOW)) }
                c.messages[item.id] = found.person to reply.text
            }
        }
        return Outcome.ANSWERED
    }
```

  (Use the file's real `add` signature and return type.) In `press()`:

```kotlin
            ChatButton.SEND_MESSAGE -> {
                val (person, text) = c.messages[id] ?: return
                inApp {
                    hands.stepAside()
                    when (val sent = messaging.send(person, text)) {
                        Sent.Done -> {
                            c.messages.remove(id)
                            replaceItem(c, ChatEvent(id, "✅ Sent to ${person.name}"))
                            say("Sent ✅"); bubble(BubbleEvent.Mood(Mood.HAPPY)) // use the file's own way to set the mood (see wentIn)
                            publish()
                        }
                        is Sent.Failed -> {
                            add(c) { ChatError(it, sent.line, sent.code ?: "message_failed", if (sent.code in SETTINGS_ERRORS) listOf(ChatButton.SETTINGS) else emptyList()) }
                            say(sent.line); publish()
                        }
                    }
                }
            }
            ChatButton.NOT_NOW -> { c.messages.remove(id); replaceItem(c, ChatEvent(id, "Okay, not sent.")); publish() }
```

  Add `"no_contacts"` and `"no_accessibility"` to `SETTINGS_ERRORS` if they are not there.

  In `SheetActions.kt` `sectionFor`/`openSettingsFor`, make `"no_contacts"` open the app's details page, the same as
  `"no_microphone"`. Make `"no_accessibility"` open Android's Accessibility settings, using the same intent that
  Buddy's Settings already uses for "Buddy can type for you" (search `ACTION_ACCESSIBILITY_SETTINGS`).

  In `PanelScreen.kt` LABELS, add `ChatButton.SEND_MESSAGE to "Send", ChatButton.NOT_NOW to "Not now"`.

- [ ] **Step 7: Contacts permission.**
  - In `ChatHost`, add `contacts: ActivityResultLauncher<String>?` next to `consent`.
  - PanelActivity and FixActivity each register `registerForActivityResult(ActivityResultContracts.RequestPermission())`
    and complete a `CompletableDeferred<Boolean>` that `ChatViewModel` awaits. This is the same pattern as `screen()`
    (`ChatHost.kt:87-120`).
  - `PanelHands.contacts`:
    - true at once when `ContextCompat.checkSelfPermission(app, READ_CONTACTS) == GRANTED`
    - else launch and await
    - false when there is no host
  - In `ChatHost.kt:56-76`, build `Messenger(graph.whatsApp, ServiceChatScreen(graph.appContext), contactsAllowed =
    hands.contacts)` and pass it as `messaging`.

- [ ] **Step 8: Run the whole Android suite, and build**

Run: the Android test command, then `cd android && ./gradlew -q -Djava.net.preferIPv4Stack=true :app:assembleDebug -x checkCloudProperties` (same JAVA_HOME).
Expected: tests PASS, APK builds.

- [ ] **Step 9: Commit**

```bash
git add android
git commit -m "feat(android): message someone on WhatsApp from the chat: ask first, check the chat, press Send"
```

---

### Task 7: Mac helper commands `waFind` and `waSend`

**Files:**
- Modify: `src/native/BuddyHelper.swift` (two functions, and two `case`s in the switch at :748)
- Modify: `src/main/helper.js:23` (timeouts `waFind: 15_000, waSend: 20_000`)
- Test: `test/helper.test.js` (timeouts are used; the commands pass through)

**Interfaces:**
- Produces:
  - `helper.call('waFind', { name })` → `{ chats: string[] }`. The chat names in WhatsApp's search results for `name`,
    in order, with U+200E/U+200F stripped and anything after the first ", " removed ("Nisha, 1 unread message" →
    "Nisha"), at most 10.
  - `helper.call('waSend', { name, text })` → `{ chat: string }`. Opens the result whose cleaned name equals `name`,
    waits until the header (`NavigationBar_HeaderViewButton`) says `name`, focuses `ChatBar_ComposerTextView`, pastes
    `text` and presses Return.
  - Errors (`HelperError` code → message):
    - `no_whatsapp` → "Install WhatsApp for Mac and I can message from here."
    - `whatsapp_not_ready` → "WhatsApp didn't open. Open it once, then try again."
    - `chat_not_found` → "I couldn't find that chat in WhatsApp."
    - `wrong_chat` → "That opened the wrong chat, so I didn't send it."
    - existing `no_accessibility`

  Fixed ids found on WhatsApp 26.41 (spec, "Changes after reading the code"):
  - search box: `TokenizedSearchBar_TextView`
  - result list: `ChatListView_TableView` (rows are `AXButton`s; skip ids starting `ChatListFilterAction_` and
    `ChatListView_archiveCell`)
  - header: `NavigationBar_HeaderViewButton`
  - message box: `ChatBar_ComposerTextView`
  - menu WhatsApp → "Open main window" when there is no window

- [ ] **Step 1: Write the Swift.** Follow the file's patterns (`needAccessibility()`, `ensureFront`, `HelperError`,
  the 1 s AX timeout, `pressKeys`, and the clipboard save/restore in `paste`):

```swift
// WhatsApp for Mac, driven by its controls' fixed ids (found on WhatsApp 26.41; see the hey-buddy spec).
let whatsAppId = "net.whatsapp.WhatsApp"
let lrm = CharacterSet(charactersIn: "\u{200E}\u{200F}")

func axAttr(_ e: AXUIElement, _ name: String) -> AnyObject? {
    var v: AnyObject?
    return AXUIElementCopyAttributeValue(e, name as CFString, &v) == .success ? v : nil
}
func axKids(_ e: AXUIElement) -> [AXUIElement] { (axAttr(e, kAXChildrenAttribute) as? [AXUIElement]) ?? [] }
func axId(_ e: AXUIElement) -> String { (axAttr(e, "AXIdentifier") as? String) ?? "" }
func axDesc(_ e: AXUIElement) -> String {
    ((axAttr(e, kAXDescriptionAttribute) as? String) ?? "").trimmingCharacters(in: lrm).trimmingCharacters(in: .whitespaces)
}
/** The first element under `root` (depth-first, at most 30 deep) that passes `test`. */
func axFind(_ root: AXUIElement, depth: Int = 0, _ test: (AXUIElement) -> Bool) -> AXUIElement? {
    if test(root) { return root }
    if depth > 30 { return nil }
    for k in axKids(root) { if let f = axFind(k, depth: depth + 1, test) { return f } }
    return nil
}
func chatName(_ desc: String) -> String {
    let clean = desc.components(separatedBy: CharacterSet(charactersIn: "\u{200E}\u{200F}")).joined()
    return (clean.components(separatedBy: ", ").first ?? clean).trimmingCharacters(in: .whitespaces)
}

/** WhatsApp running, in front, with its main window: its app element. */
func whatsAppReady() throws -> (pid_t, AXUIElement) {
    try needAccessibility()
    var app = NSRunningApplication.runningApplications(withBundleIdentifier: whatsAppId).first
    if app == nil {
        guard let url = NSWorkspace.shared.urlForApplication(withBundleIdentifier: whatsAppId) else {
            throw HelperError(code: "no_whatsapp", message: "Install WhatsApp for Mac and I can message from here.")
        }
        let done = DispatchSemaphore(value: 0)
        NSWorkspace.shared.openApplication(at: url, configuration: NSWorkspace.OpenConfiguration()) { _, _ in done.signal() }
        _ = done.wait(timeout: .now() + 10)
        for _ in 0..<40 where app == nil {
            app = NSRunningApplication.runningApplications(withBundleIdentifier: whatsAppId).first
            usleep(250_000)
        }
    }
    guard let running = app else { throw HelperError(code: "whatsapp_not_ready", message: "WhatsApp didn't open. Open it once, then try again.") }
    let pid = running.processIdentifier
    let ax = AXUIElementCreateApplication(pid)
    _ = ensureFront(pid)
    if ((axAttr(ax, kAXWindowsAttribute) as? [AXUIElement]) ?? []).isEmpty, let bar = axAttr(ax, kAXMenuBarAttribute) {
        // Its window was closed: WhatsApp → "Open main window".
        if let item = axFind(bar as! AXUIElement, { ((axAttr($0, kAXTitleAttribute) as? String) ?? "").contains("Open main window") }) {
            AXUIElementPerformAction(item, kAXPressAction as CFString)
        }
    }
    for _ in 0..<40 {
        if let win = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first,
           axFind(win, { axId($0) == "TokenizedSearchBar_TextView" }) != nil { return (pid, ax) }
        usleep(250_000)
    }
    throw HelperError(code: "whatsapp_not_ready", message: "WhatsApp didn't open. Open it once, then try again.")
}

/** Puts `text` into the focused box through the clipboard (⌘A, ⌘V), as paste does, keeping their clipboard. */
func pasteHere(_ text: String) { /* reuse the body of paste(): save clip, write text, ⌘A, ⌘V, wait, restore */ }

func waSearch(_ ax: AXUIElement, _ name: String) throws -> [(String, AXUIElement)] {
    guard let win = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first,
          let search = axFind(win, { axId($0) == "TokenizedSearchBar_TextView" }) else {
        throw HelperError(code: "whatsapp_not_ready", message: "WhatsApp didn't open. Open it once, then try again.")
    }
    AXUIElementSetAttributeValue(search, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(200_000)
    pasteHere(name)
    usleep(900_000) // WhatsApp's search updates as it is typed
    guard let list = axFind(win, { axId($0) == "ChatListView_TableView" }) else { return [] }
    var out: [(String, AXUIElement)] = []
    func walk(_ e: AXUIElement, _ d: Int) {
        if out.count >= 10 || d > 6 { return }
        let id = axId(e)
        if (axAttr(e, kAXRoleAttribute) as? String) == "AXButton", !id.hasPrefix("ChatListFilterAction_"), id != "ChatListView_archiveCell" {
            let name = chatName(axDesc(e)); if !name.isEmpty { out.append((name, e)) }
            return
        }
        for k in axKids(e) { walk(k, d + 1) }
    }
    walk(list, 0)
    return out
}

func waFind(_ args: [String: Any]) throws -> [String: Any] {
    guard let name = args["name"] as? String, !name.isEmpty else { throw HelperError(code: "bad_request", message: "name is missing") }
    let (_, ax) = try whatsAppReady()
    return ["chats": try waSearch(ax, name).map { $0.0 }]
}

func waSend(_ args: [String: Any]) throws -> [String: Any] {
    guard let name = args["name"] as? String, !name.isEmpty, let text = args["text"] as? String, !text.isEmpty else {
        throw HelperError(code: "bad_request", message: "name and text are needed")
    }
    let (pid, ax) = try whatsAppReady()
    let same = { (a: String) in a.compare(name, options: [.caseInsensitive, .diacriticInsensitive]) == .orderedSame }
    guard let row = try waSearch(ax, name).first(where: { same($0.0) })?.1 else {
        throw HelperError(code: "chat_not_found", message: "I couldn't find that chat in WhatsApp.")
    }
    AXUIElementPerformAction(row, kAXPressAction as CFString)
    var header = ""
    for _ in 0..<24 {
        usleep(250_000)
        if let win = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first,
           let h = axFind(win, { axId($0) == "NavigationBar_HeaderViewButton" }) { header = chatName(axDesc(h)); if same(header) { break } }
    }
    guard same(header) else { throw HelperError(code: "wrong_chat", message: "That opened the wrong chat, so I didn't send it.") }
    guard let win = (axAttr(ax, kAXWindowsAttribute) as? [AXUIElement])?.first,
          let box = axFind(win, { axId($0) == "ChatBar_ComposerTextView" }) else {
        throw HelperError(code: "chat_not_found", message: "I couldn't find that chat in WhatsApp.")
    }
    AXUIElementSetAttributeValue(box, kAXFocusedAttribute as CFString, kCFBooleanTrue)
    usleep(200_000)
    _ = ensureFront(pid)
    pasteHere(text)
    pressKeys(.returnKey, [])
    return ["chat": header]
}
```

  Refactor `paste(args)` so that its clipboard part is `pasteHere(text)`, and have `paste` call it. Keep paste's
  behaviour byte for byte: its secure/readonly checks stay in `paste`. Match the existing `pressKeys` signature.
  Add to the switch: `case "waFind": result = try waFind(args)` and `case "waSend": result = try waSend(args)`.

- [ ] **Step 2: Build it.**

Run: `npm run build:native`
Expected: builds `bin/buddy-helper` with no errors.

- [ ] **Step 3: JS side.**
  - `src/main/helper.js:23`: add `waFind: 15_000, waSend: 20_000` to `DEFAULT_TIMEOUTS`.
  - In `test/helper.test.js`, add a test in the style of :59-77: `helper.call('waFind', { name: 'Priya' })` writes
    `{cmd:'waFind', args:{name:'Priya'}}` and uses the 15 s timeout. Check how existing tests read timeouts; follow
    that.

Run: `npm test`. Expected: PASS.

- [ ] **Step 4: Try it on the owner's Mac.**
  - Do this only with the owner's OK, said in this session, because WhatsApp comes to the front.
  - Read-only first: `printf '{"id":1,"cmd":"waFind","args":{"name":"<a chat name the owner gives>"}}\n' | bin/buddy-helper`.
    Expected: `{"id":1,"ok":true,"result":{"chats":[…]}}` with that name.
  - Adjust the row filter if the results include section headings or message hits. Message hits are rows whose
    description has the message text; keep only rows whose cleaned name passes `pickChat`, which Task 8 does anyway.
  - Do **not** run `waSend` here. It sends a real message. The owner does that in Task 9.

- [ ] **Step 5: Commit**

```bash
git add src/native/BuddyHelper.swift src/main/helper.js test/helper.test.js
git commit -m "feat(mac): the helper finds a chat in WhatsApp and sends to it, checking its name first"
```

---

### Task 8: The Mac panel does the message

**Files:**
- Modify: `src/main/actions.js` (`finish` :458, `act` :665, new `startMessage`, `sendMessage`)
- Modify: `src/renderer/panel/chat-view.js` (LABELS :16-29, PRIMARY :31)
- Modify: `test/actions.test.js`, `test/chat-view.test.js`
- Modify: `test/e2e/checks/40-panel.js` (one message round)

**Interfaces:**
- Consumes: `helper.call('waFind', {name}) -> {chats}`, `helper.call('waSend', {name, text}) -> {chat}`, `pickChat`,
  `pickLine` (`shared/message-pick.js`), and `reply.to`.
- Produces:
  - Buttons `'send-message'` (label "Send", primary) and the existing `'not-now'`.
  - The card is a `question` item: `{ type: 'question', text: 'To Priya Sharma: I\'m late', buttons:
    ['send-message', 'not-now'], message: { name, text } }`. `message` is main-only (not in SHOWN).

  The copy, exactly:
  - Windows: say `I can message on WhatsApp from the Mac and Android apps for now.`
  - Pick lines from `pickLine`.
  - Sent: event `✅ Sent to {name}`, bubble `Sent ✅`, mood `celebrate`.
  - Not now: the existing `Okay, not sent.` branch.
  - Helper errors: shown with `failed(c, err)`. `no_accessibility` already gets Open Settings.

- [ ] **Step 1: Failing tests** in `test/actions.test.js`. Use the existing `setup`, `reply`, `chatOf`, `steps`,
  `entries` and `moods`:

```js
test('a message: Buddy looks for the person in WhatsApp, comes back and asks before sending', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', say: 'Okay!', text: "I'm late" })], replies: { waFind: { chats: ['Priya Sharma', 'Rahul'] } } });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('message priya on whatsapp im late');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'waFind', 'showPanel']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'waFind', { name: 'Priya' }]);
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'buddy', say: 'Okay!', text: '', notes: [], buttons: [] },
    { id: 3, type: 'question', text: "To Priya Sharma: I'm late", buttons: ['send-message', 'not-now'] },
  ]);
});

test('Send on a message: the helper opens the chat, checks it and sends; the card says it was sent', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', text: "I'm late" })], replies: { waFind: { chats: ['Priya Sharma'] }, waSend: { chat: 'Priya Sharma' } } });
  await s.actions.open();
  await s.actions.send('message priya im late');
  const card = chatOf(s).at(-1);
  const from = s.log.length;
  assert.deepStrictEqual(await s.actions.act(card.id, 'send-message'), {});
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'waSend', 'bubble']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'waSend', { name: 'Priya Sharma', text: "I'm late" }]);
  assert.deepStrictEqual(chatOf(s).at(-1), { id: card.id, type: 'event', text: '✅ Sent to Priya Sharma', buttons: [] });
  assert.strictEqual(moods(s.log).at(-1), 'celebrate');
});

test('a message to someone WhatsApp has twice asks which one', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', text: 'hi' })], replies: { waFind: { chats: ['Priya Sharma', 'Priya Verma'] } } });
  await s.actions.open();
  await s.actions.send('message priya hi');
  assert.deepStrictEqual(chatOf(s).at(-1), { id: 2, type: 'buddy', say: '', text: 'Which Priya: Priya Sharma or Priya Verma? Tell me the full name.', notes: [], buttons: [] });
});

test('a message when WhatsApp is not on the Mac says so', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', text: 'hi' })], replies: { waFind: failure('no_whatsapp', 'Install WhatsApp for Mac and I can message from here.') } });
  await s.actions.open();
  await s.actions.send('message priya hi');
  assert.strictEqual(chatOf(s).at(-1).text, 'Install WhatsApp for Mac and I can message from here.');
});

test('a wrong chat on Send is not sent, and the card stays to try again', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', text: 'hi' })], replies: { waFind: { chats: ['Priya Sharma'] }, waSend: failure('wrong_chat', "That opened the wrong chat, so I didn't send it.") } });
  await s.actions.open();
  await s.actions.send('message priya hi');
  const card = chatOf(s).at(-1);
  await s.actions.act(card.id, 'send-message');
  assert.ok(chatOf(s).some((i) => i.id === card.id && i.type === 'question'));
  assert.strictEqual(chatOf(s).at(-1).text, "That opened the wrong chat, so I didn't send it.");
});

test('Not now on a message sends nothing', async () => {
  const s = setup({ answers: [reply({ kind: 'message', to: 'Priya', text: 'hi' })], replies: { waFind: { chats: ['Priya Sharma'] } } });
  await s.actions.open();
  await s.actions.send('message priya hi');
  const card = chatOf(s).at(-1);
  await s.actions.act(card.id, 'not-now');
  assert.deepStrictEqual(chatOf(s).at(-1), { id: card.id, type: 'event', text: 'Okay, not sent.', buttons: [] });
  assert.strictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'waSend').length, 0);
});

test('on Windows a message says it works on the Mac and Android for now', async () => {
  const s = setup({ windows: true, answers: [reply({ kind: 'message', to: 'Priya', text: 'hi' })] });
  await s.actions.open();
  await s.actions.send('message priya hi');
  assert.strictEqual(chatOf(s).at(-1).text, 'I can message on WhatsApp from the Mac and Android apps for now.');
  assert.strictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'waFind').length, 0);
});
```

  `reply(fields)` (:14) must pass `to` through. Extend it if it only copies the eight fields. Adjust the expected
  `steps` to how `stepAside` and `comeBack` really log, after reading them.

  In `test/chat-view.test.js`, add `'send-message'` to the "every button has its label" expectations, and check that
  `itemParts` gives it `{ button: 'send-message', label: 'Send', primary: true }`.

- [ ] **Step 2: Run and see them fail**

Run: `node --test test/actions.test.js test/chat-view.test.js`
Expected: the new tests FAIL.

- [ ] **Step 3: Implement.** chat-view.js:
  - Add `'send-message': 'Send'` to LABELS.
  - Add `'send-message'` to PRIMARY.

  actions.js:

```js
const { pickChat, pickLine } = require('../../shared/message-pick');
const MESSAGE_ELSEWHERE = 'I can message on WhatsApp from the Mac and Android apps for now.';
```

  In `finish`, first line: `if (reply.kind === 'message') return startMessage(c, reply);`

```js
  /**
   * "Message Priya on WhatsApp …": Buddy looks Priya up in WhatsApp's search (WhatsApp comes to the front for it), comes
   * back, and asks "To Priya Sharma: … Send it?". Nothing goes into WhatsApp before Send.
   */
  async function startMessage(c, reply) {
    if (reply.say) add(c, { type: 'buddy', say: reply.say, text: '', notes: [], buttons: [] });
    if (system === 'win32') {
      add(c, { type: 'buddy', say: '', text: MESSAGE_ELSEWHERE, notes: [], buttons: [] });
      return true;
    }
    let chats;
    try {
      chats = (await inApp(() => stepAside(() => helper.call('waFind', { name: reply.to })), { wait: true }))?.chats ?? [];
    } catch (err) {
      failed(c, err);
      if (present(c) || c === chat) await comeBack(c);
      return false;
    }
    const pick = pickChat(reply.to, chats);
    const line = pickLine(reply.to, pick);
    if (line) add(c, { type: 'buddy', say: '', text: line, notes: [], buttons: [] });
    else add(c, { type: 'question', text: `To ${pick.name}: ${reply.text}`, buttons: ['send-message', 'not-now'], message: { name: pick.name, text: reply.text } });
    if (c === chat) await comeBack(c);
    return true;
  }

  async function sendMessage(c, item) {
    try {
      await stepAside(() => helper.call('waSend', item.message));
    } catch (err) {
      failed(c, err); // the card stays, to try again
      await comeBack(c);
      return;
    }
    swap(c, item, { type: 'event', text: `✅ Sent to ${item.message.name}`, buttons: [] });
    ui.bubble('Sent ✅');
    if (c === chat) ui.mood('celebrate');
    push(c);
  }
```

  Check `inApp`'s return value. If it does not return `work()`'s result, capture it in a closure variable instead. Read
  `comeBack` and `present`, so that the panel comes back only when the chat is still the current one. That matches
  `put`'s `if (present(c)) await comeBack(c)`. If the person closed the panel meanwhile, `c !== chat` and nothing is
  shown.

  In `act`, before the generic `'not-now'` branch:

```js
    } else if (button === 'send-message') {
      await inApp(() => sendMessage(c, item));
```

  The generic `not-now` branch already gives "Okay, not sent.". Make sure the job `not-now` branch (`item.task !==
  undefined`) does not catch message cards: message cards have no `task`.

  `talk()`'s mood: `startMessage` returns true. Check that a card ending a turn gives `happy`, as other answers do.

- [ ] **Step 4: Run and see them pass**

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: e2e.** In `test/e2e/checks/40-panel.js`, add one round:
  - Feed a `message` reply.
  - Set `ctx.helper.replies.waFind = { chats: ['Priya Sharma'] }` and `ctx.helper.replies.waSend = { chat: 'Priya
    Sharma' }`.
  - Type "message priya hi".
  - Wait for the card text "To Priya Sharma: hi", click "Send", and wait for "✅ Sent to Priya Sharma".
  - Afterwards, remove `waFind`/`waSend` from `replies`, so later checks are unaffected.

Run: `BUDDY_E2E_ONLY=40-panel npm run test:e2e`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/main/actions.js src/renderer/panel/chat-view.js test
git commit -m "feat(mac): message someone on WhatsApp from the chat: ask first, check the chat, send"
```

---

### Task 9: Check on the owner's devices, then the PR

- [ ] **Step 1: Everything green.** Run `npm test`, `npm run test:e2e`, the Android unit tests and the Android debug
  build. All PASS.
- [ ] **Step 2: Mac by hand (the owner, with a test contact they choose).**
  1. `cd ~/projects/buddy-hey && npm start`.
  2. Open the panel and type "message <test contact> on WhatsApp testing Buddy".
  3. Check:
     - the card shows the contact's full name
     - Not now sends nothing
     - asking again and pressing Send sends exactly the text
     - a name with two matches asks "Which …?"
     - a name that doesn't exist says "I couldn't find …"
- [ ] **Step 3: Android by hand (the owner).** Install the debug APK. Do the same as Step 2. Also check:
  - Contacts permission asked once
  - with "Buddy can type for you" off: text left in WhatsApp plus the Accessibility line
  - WhatsApp Business only, if available
- [ ] **Step 4: Fix what the owner finds** (each fix with a test), then push and open the PR to `master` with
  `gh pr create`. The title is "Message a friend on WhatsApp from Buddy's chat (Mac + Android)". The body is a plain
  summary of what it does and how it was checked. **No attribution lines.**
