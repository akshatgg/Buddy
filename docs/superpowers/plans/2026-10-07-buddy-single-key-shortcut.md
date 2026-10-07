# Single-key shortcut Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let Buddy's shortcut be one modifier key (or a few together) tapped on its own (⌘, Right ⌥, ⇧ ⌘, fn, Caps Lock), recorded by tapping it in Settings, and opening the panel from any app.

**Architecture:** The Swift helper gets a listen-only event tap (command `watchKeys`) that reports modifier changes, and "some other key or click" while a modifier is held. A pure tap detector in the main process turns those reports into taps. A key watch decides when the helper listens and where taps go (the panel, or Settings while it records). `shortcut.js` sends `Tap:` values to the key watch and everything else to Electron's `globalShortcut`, as today.

**Tech Stack:** Electron 44 (plain JS, CommonJS main/preload, classic-script pages), Swift (`swiftc`, `bin/buddy-helper`), `node --test`, ESLint 10, the e2e harness `test/e2e/smoke.js`.

Design: `docs/superpowers/specs/2026-10-07-buddy-single-key-shortcut-design.md`. Work in `/Users/akshat/projects/buddy-phase2` on branch `modifier-shortcut`.

## Global Constraints

- Saved value: `Tap:` + key names joined by `+`, in this order: `Fn`, `LeftControl`, `RightControl`, `LeftOption`, `RightOption`, `LeftShift`, `RightShift`, `LeftCommand`, `RightCommand`; `CapsLock` only alone.
- Key caps: `Left ⌘`, `Right ⌘`, `Left ⌥`, `Right ⌥`, `Left ⌃`, `Right ⌃`, `Left ⇧`, `Right ⇧`, `fn`, `⇪ Caps Lock`.
- A tap: the key(s) go down and all come back up within **500 ms**, no other key or mouse click in between, no other modifier still held at the end. Caps Lock: each report with no modifier held is a tap; a second report within **400 ms** is the same press.
- The helper reports `{"event":"keys","kind":"flags","keyCode":n,"flags":n,"t":ms}` and, only while a modifier is held, `{"event":"keys","kind":"other"}` — never which key.
- When the helper cannot listen, the key watch asks again every **10 seconds**.
- Exact page strings:
  - hint: `Click the box, then press the keys you want, or tap one key like ⌘ or fn on its own. Esc cancels.`
  - note: `Tap it on its own to open your buddy: press and let go, with no other key.`
  - Caps Lock: `Caps Lock also turns capitals on and off when you tap it.`
  - fn: `If fn also opens emoji or dictation, set “Press 🌐 key to” to “Do Nothing” in System Settings → Keyboard.`
  - no Accessibility (in place of the note's first line, red): `Buddy needs Accessibility to hear this key. Allow it in Permissions.`
- `npm test` (ESLint + unit tests) and `npm run test:e2e` pass at the end of every task. `npm run build:native` compiles after Task 2.
- Comments in the codebase's voice: plain words that say why. Element ids used by scripts/tests stay.
- Commits: no `Co-Authored-By` line and no AI-assistant credit anywhere (the owner's rule).
- Never run `npm start` or `npm run dist:mac`, never touch `cloud.json`, never touch other worktrees or branches, and leave no Buddy, Electron or `buddy-helper` process running.

---

### Task 1: The single-key format and the tap detector

**Files:**
- Modify: `src/renderer/common/shortcut-keys.js` (add the `Tap:` format; `symbols()` shows its caps)
- Create: `src/main/modifier-tap.js`
- Test: `test/shortcut-keys.test.js` (append), `test/modifier-tap.test.js` (new)

**Interfaces:**
- Produces: `ShortcutKeys.isTap(value) -> boolean`, `ShortcutKeys.tapKeys(value) -> string[] | null` (names in the fixed order, or null when malformed), `ShortcutKeys.tapValue(names: string[]) -> string` ("Tap:…" in the fixed order), `ShortcutKeys.symbols("Tap:…") -> string[]` (caps). `require('./modifier-tap')` exports `createTapDetector({ tapMs = 500 } = {}) -> { feed(event) -> string | null, reset() }`, `TAP_MS` (500), `MODIFIERS`.

- [ ] **Step 1: Write the failing format tests**

In `test/shortcut-keys.test.js`, change the require line to:

```js
const { fromKeyEvent, heldSymbols, symbols, keyFor, isTap, tapKeys, tapValue } = require('../src/renderer/common/shortcut-keys');
```

and append:

```js
// ---- a single-key shortcut: modifier keys tapped on their own ----

const TAP_NAMES = ['Fn', 'LeftControl', 'RightControl', 'LeftOption', 'RightOption', 'LeftShift', 'RightShift', 'LeftCommand', 'RightCommand', 'CapsLock'];

test('a single-key shortcut is "Tap:" and the key, for every key that can be one', () => {
  for (const name of TAP_NAMES) {
    assert.strictEqual(isTap(`Tap:${name}`), true, name);
    assert.deepStrictEqual(tapKeys(`Tap:${name}`), [name], name);
    assert.strictEqual(tapValue([name]), `Tap:${name}`, name);
  }
});

test('keys tapped together are written in one order, whatever order they come in', () => {
  assert.strictEqual(tapValue(['LeftCommand', 'LeftShift']), 'Tap:LeftShift+LeftCommand');
  assert.strictEqual(tapValue(['RightCommand', 'Fn', 'LeftControl']), 'Tap:Fn+LeftControl+RightCommand');
  assert.deepStrictEqual(tapKeys('Tap:LeftCommand+LeftShift'), ['LeftShift', 'LeftCommand']);
});

test('a single-key shortcut that is not well formed has no keys', () => {
  for (const value of ['Tap:', 'Tap:Command', 'Tap:leftcommand', 'Tap:LeftCommand+LeftCommand', 'Tap:CapsLock+LeftShift',
    'Tap:LeftCommand+', 'Tap:constructor', 'tap:LeftCommand', 'Alt+Space', '', null, undefined, 42]) {
    assert.strictEqual(tapKeys(value), null, String(value));
  }
  assert.strictEqual(isTap('Alt+Space'), false);
  assert.strictEqual(isTap('tap:LeftCommand'), false, 'the prefix is written exactly so');
  assert.strictEqual(isTap(null), false);
});

test('a single-key shortcut shows its keys as caps, with their side', () => {
  assert.deepStrictEqual(symbols('Tap:RightOption'), ['Right ⌥']);
  assert.deepStrictEqual(symbols('Tap:LeftShift+LeftCommand'), ['Left ⇧', 'Left ⌘']);
  assert.deepStrictEqual(symbols('Tap:LeftControl+RightCommand'), ['Left ⌃', 'Right ⌘']);
  assert.deepStrictEqual(symbols('Tap:Fn'), ['fn']);
  assert.deepStrictEqual(symbols('Tap:CapsLock'), ['⇪ Caps Lock']);
  assert.deepStrictEqual(symbols('Tap:Bogus'), [], 'one that is not well formed has none');
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/shortcut-keys.test.js`
Expected: FAIL (`isTap is not a function`).

- [ ] **Step 3: Add the format to `src/renderer/common/shortcut-keys.js`**

Inside the IIFE, after the `RESERVED` table, add:

```js
  // A single-key shortcut: one or more modifier keys tapped on their own (pressed and let go, with no other key),
  // saved as "Tap:" and their names in this order ("Tap:RightOption", "Tap:LeftShift+LeftCommand"). Left and right are
  // different keys. Caps Lock is only ever tapped alone. The Mac helper hears these (src/main/key-watch.js), not Electron.
  const TAP = 'Tap:';
  const TAP_KEYS = [
    { name: 'Fn', cap: 'fn' },
    { name: 'LeftControl', cap: 'Left ⌃' },
    { name: 'RightControl', cap: 'Right ⌃' },
    { name: 'LeftOption', cap: 'Left ⌥' },
    { name: 'RightOption', cap: 'Right ⌥' },
    { name: 'LeftShift', cap: 'Left ⇧' },
    { name: 'RightShift', cap: 'Right ⇧' },
    { name: 'LeftCommand', cap: 'Left ⌘' },
    { name: 'RightCommand', cap: 'Right ⌘' },
    { name: 'CapsLock', cap: '⇪ Caps Lock' },
  ];
  const TAP_NAMES = TAP_KEYS.map((k) => k.name);
```

Before `symbols`, add:

```js
  /** True for a single-key shortcut ("Tap:…"), well formed or not. */
  function isTap(value) {
    return typeof value === 'string' && value.startsWith(TAP);
  }

  /** The keys of a single-key shortcut, in their order; null when `value` is not a well-formed one. */
  function tapKeys(value) {
    if (!isTap(value)) return null;
    const names = value.slice(TAP.length).split('+');
    if (!names.every((name) => TAP_NAMES.includes(name)) || new Set(names).size !== names.length) return null;
    if (names.includes('CapsLock') && names.length > 1) return null;
    return TAP_NAMES.filter((name) => names.includes(name));
  }

  /** The single-key shortcut for these keys, in their order: ['LeftCommand', 'LeftShift'] is "Tap:LeftShift+LeftCommand". */
  function tapValue(names) {
    return TAP + TAP_NAMES.filter((name) => names.includes(name)).join('+');
  }
```

At the start of `symbols(accelerator)`, before `const words = …`, add:

```js
    if (isTap(accelerator)) return (tapKeys(accelerator) || []).map((name) => TAP_KEYS.find((k) => k.name === name).cap);
```

and update its doc comment's first sentence to: `/** The key caps for a shortcut, however it is spelled: "Shift+Command+B" and "cmd+shift+b" are both ['⇧', '⌘', 'B'], and "Tap:RightOption" is ['Right ⌥']. */`

Change the return line to:

```js
  return { fromKeyEvent, heldSymbols, symbols, keyFor, isTap, tapKeys, tapValue };
```

- [ ] **Step 4: Run them and see them pass**

Run: `node --test test/shortcut-keys.test.js`
Expected: PASS, all tests (old and new).

- [ ] **Step 5: Write the failing detector tests**

Create `test/modifier-tap.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createTapDetector, TAP_MS } = require('../src/main/modifier-tap');

// The Mac's flags: one bit for each kind of modifier, and one for each side of it.
const CMD = 0x100000;
const SHIFT = 0x20000;
const CTRL = 0x40000;
const OPT = 0x80000;
const FN = 0x800000;
const CAPS = 0x10000;
const L_CMD = 0x08;
const R_CMD = 0x10;
const L_SHIFT = 0x02;
const R_SHIFT = 0x04;
const L_CTRL = 0x01;
const R_CTRL = 0x2000;
const L_OPT = 0x20;
const R_OPT = 0x40;
const ALWAYS = 0x100; // macOS sets this one on every event

/** A change of the modifier keys as the helper reports it: the key, the flags after the change, and when. */
const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags: flags | ALWAYS, t });
const OTHER = { kind: 'other' }; // a key or a click while a modifier is held

/** Every tap a new detector hears in `events`. */
function taps(events) {
  const detector = createTapDetector();
  return events.map((event) => detector.feed(event)).filter(Boolean);
}

test('each modifier key tapped on its own is a tap of that key', () => {
  const keys = [
    [55, CMD | L_CMD, 'LeftCommand'], [54, CMD | R_CMD, 'RightCommand'],
    [56, SHIFT | L_SHIFT, 'LeftShift'], [60, SHIFT | R_SHIFT, 'RightShift'],
    [59, CTRL | L_CTRL, 'LeftControl'], [62, CTRL | R_CTRL, 'RightControl'],
    [58, OPT | L_OPT, 'LeftOption'], [61, OPT | R_OPT, 'RightOption'],
    [63, FN, 'Fn'],
  ];
  for (const [keyCode, down, name] of keys) {
    assert.deepStrictEqual(taps([change(keyCode, down, 1000), change(keyCode, 0, 1100)]), [`Tap:${name}`], name);
  }
});

test('keys tapped together are one tap, named in their order, whichever goes first', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000),
    change(56, CMD | L_CMD | SHIFT | L_SHIFT, 1050),
    change(55, SHIFT | L_SHIFT, 1150),
    change(56, 0, 1200),
  ]), ['Tap:LeftShift+LeftCommand']);
});

test('a tap is over within half a second', () => {
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1000 + TAP_MS)]), ['Tap:RightOption'], 'just in time');
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT, 1000), change(61, 0, 1001 + TAP_MS)]), [], 'held too long');
});

test('a key or a click while it is held is no tap: ⌘C, ⌘-click, ⇧ and a letter', () => {
  assert.deepStrictEqual(taps([change(55, CMD | L_CMD, 1000), OTHER, change(55, 0, 1100)]), []);
  assert.deepStrictEqual(taps([change(56, SHIFT | L_SHIFT, 1000), OTHER, OTHER, change(56, 0, 1200)]), []);
});

test('a spoiled tap does not spoil the next one, and keys pressed with no modifier held change nothing', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000), OTHER, change(55, 0, 1100), // ⌘C
    OTHER, OTHER, // typing
    change(55, CMD | L_CMD, 2000), change(55, 0, 2100), // ⌘ tapped
  ]), ['Tap:LeftCommand']);
});

test('the left and the right key are told apart, even while the other one is held', () => {
  assert.deepStrictEqual(taps([
    change(55, CMD | L_CMD, 1000),
    change(54, CMD | L_CMD | R_CMD, 1050),
    change(54, CMD | L_CMD, 1100),
    change(55, 0, 1150),
  ]), ['Tap:LeftCommand+RightCommand']);
  assert.deepStrictEqual(taps([change(54, CMD | R_CMD, 1000), change(54, 0, 1100)]), ['Tap:RightCommand']);
});

test('a keyboard that does not say which side is down still taps: each change of a key flips it', () => {
  assert.deepStrictEqual(taps([change(55, CMD, 1000), change(55, 0, 1100)]), ['Tap:LeftCommand']);
  assert.deepStrictEqual(taps([
    change(55, CMD, 1000), change(54, CMD, 1050), change(54, CMD, 1100), change(55, 0, 1150),
  ]), ['Tap:LeftCommand+RightCommand']);
});

test('a modifier held from before the helper listened spoils the tap', () => {
  assert.deepStrictEqual(taps([change(61, OPT | R_OPT | CMD | L_CMD, 1000), change(61, CMD | L_CMD, 1100)]), [], '⌘ still held at the end');
  assert.deepStrictEqual(taps([
    change(61, OPT | R_OPT | CMD | L_CMD, 1000),
    change(55, OPT | R_OPT, 1050), // ⌘ let go: it was never seen going down
    change(61, 0, 1100),
  ]), [], '⌘ let go meanwhile');
});

test('a key let go that was never seen going down is no tap, and the next tap is heard', () => {
  assert.deepStrictEqual(taps([change(55, 0, 1000), change(55, CMD | L_CMD, 2000), change(55, 0, 2100)]), ['Tap:LeftCommand']);
});

test('fn is a key like the others, and a key while it is held (an arrow) spoils it', () => {
  assert.deepStrictEqual(taps([change(63, FN, 1000), change(63, 0, 1080)]), ['Tap:Fn']);
  assert.deepStrictEqual(taps([change(63, FN, 1000), OTHER, change(63, 0, 1080)]), []);
});

test('each press of Caps Lock on its own is a tap; a second report of the same press is not', () => {
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, 0, 3000)]), ['Tap:CapsLock', 'Tap:CapsLock'], 'on, then off');
  assert.deepStrictEqual(taps([change(57, CAPS, 1000), change(57, CAPS, 1200)]), ['Tap:CapsLock'], 'reported twice');
});

test("Caps Lock with a modifier held is no tap, and it spoils that modifier's tap", () => {
  assert.deepStrictEqual(taps([
    change(56, SHIFT | L_SHIFT, 1000), change(57, SHIFT | L_SHIFT | CAPS, 1050), change(56, CAPS, 1100),
  ]), []);
  assert.deepStrictEqual(taps([change(57, SHIFT | CAPS, 1000)]), [], '⇧ held from before');
});

test('reset() forgets a tap on its way', () => {
  const detector = createTapDetector();
  assert.strictEqual(detector.feed(change(55, CMD | L_CMD, 1000)), null);
  detector.reset();
  assert.strictEqual(detector.feed(change(55, 0, 1100)), null);
  assert.strictEqual(detector.feed(change(55, CMD | L_CMD, 2000)), null);
  assert.strictEqual(detector.feed(change(55, 0, 2100)), 'Tap:LeftCommand');
});

test('other key codes and other reports are ignored', () => {
  assert.deepStrictEqual(taps([
    change(0, CMD | L_CMD, 1000), { kind: 'mystery' }, {}, change(55, CMD | L_CMD, 2000), change(55, 0, 2100),
  ]), ['Tap:LeftCommand']);
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `node --test test/modifier-tap.test.js`
Expected: FAIL (`Cannot find module '../src/main/modifier-tap'`).

- [ ] **Step 7: Write `src/main/modifier-tap.js`**

```js
'use strict';

/**
 * Hears a single-key shortcut: modifier keys tapped on their own. The Mac helper reports each change of the modifier
 * keys ({ kind: 'flags', keyCode, flags, t }) and, while one is held, that some other key or a mouse button went down
 * ({ kind: 'other' }), never which. A tap is keys that go down and all come back up within half a second, with nothing
 * else pressed meanwhile and no other modifier still held at the end; it is named as Settings saves it
 * ("Tap:RightOption"). Caps Lock is different: macOS reports it once per press, so each press alone is a tap.
 */

const { tapValue } = require('../renderer/common/shortcut-keys');

const TAP_MS = 500; // from the first key down to the last one up
const CAPS_LOCK = 57;
const CAPS_REPEAT_MS = 400; // a second report of the same Caps Lock press
// The Mac's key code of each modifier key: its name, the flag bit that says that very key is down, the flag of its
// kind (any ⌘, any ⇧ …), and the other side's bit.
const MODIFIERS = {
  54: { name: 'RightCommand', bit: 0x10, kind: 0x100000, other: 0x08 },
  55: { name: 'LeftCommand', bit: 0x08, kind: 0x100000, other: 0x10 },
  56: { name: 'LeftShift', bit: 0x02, kind: 0x20000, other: 0x04 },
  58: { name: 'LeftOption', bit: 0x20, kind: 0x80000, other: 0x40 },
  59: { name: 'LeftControl', bit: 0x01, kind: 0x40000, other: 0x2000 },
  60: { name: 'RightShift', bit: 0x04, kind: 0x20000, other: 0x02 },
  61: { name: 'RightOption', bit: 0x40, kind: 0x80000, other: 0x20 },
  62: { name: 'RightControl', bit: 0x2000, kind: 0x40000, other: 0x01 },
  63: { name: 'Fn', bit: 0x800000, kind: 0x800000, other: 0 },
};
// ⌃ ⌥ ⇧ ⌘ of either side. Still held when a tap ends, one of them is a key held from before the helper listened.
const HELD_KINDS = 0x100000 | 0x20000 | 0x40000 | 0x80000;

/** Is this modifier key down, going by the flags of a change? */
function isDown(key, flags, wasDown) {
  if (flags & key.bit) return true;
  if (!(flags & key.kind)) return false;
  if (flags & key.other) return false; // the other side is the one held
  return !wasDown; // a keyboard that does not say which side: each change flips it
}

function createTapDetector({ tapMs = TAP_MS } = {}) {
  let held = new Set(); // the modifier keys down now
  let pressed = new Set(); // every key pressed since the first one went down
  let since = 0; // when the first one went down
  let spoiled = false; // something else was pressed meanwhile
  let lastCaps = -Infinity; // the last Caps Lock tap

  function capsLock(flags, t) {
    if (held.size) {
      spoiled = true;
      return null;
    }
    if (flags & HELD_KINDS || t - lastCaps < CAPS_REPEAT_MS) return null;
    lastCaps = t;
    return tapValue(['CapsLock']);
  }

  /** One report from the helper. Answers the shortcut it completes ("Tap:…"), or null. */
  function feed(event) {
    if (!event || typeof event !== 'object') return null;
    if (event.kind === 'other') {
      if (held.size) spoiled = true;
      return null;
    }
    if (event.kind !== 'flags') return null;
    const flags = Number(event.flags) || 0;
    const t = Number(event.t) || 0;
    if (event.keyCode === CAPS_LOCK) return capsLock(flags, t);
    const key = Object.hasOwn(MODIFIERS, event.keyCode) ? MODIFIERS[event.keyCode] : null;
    if (!key) return null;
    if (isDown(key, flags, held.has(key.name))) {
      if (!held.size) {
        pressed = new Set();
        since = t;
        spoiled = false;
      }
      held.add(key.name);
      pressed.add(key.name);
      return null;
    }
    if (!held.has(key.name)) {
      // Let go, but never seen going down: it was held from before the helper listened.
      if (held.size) spoiled = true;
      return null;
    }
    held.delete(key.name);
    if (held.size) return null;
    const tapped = !spoiled && t - since <= tapMs && !(flags & HELD_KINDS);
    const keys = [...pressed];
    pressed = new Set();
    return tapped ? tapValue(keys) : null;
  }

  /** Forget a tap on its way (the shortcut changed, or a new helper started). */
  function reset() {
    held = new Set();
    pressed = new Set();
    spoiled = false;
  }

  return { feed, reset };
}

module.exports = { createTapDetector, TAP_MS, MODIFIERS };
```

- [ ] **Step 8: Run the tests and the whole suite**

Run: `node --test test/modifier-tap.test.js test/shortcut-keys.test.js && npm test`
Expected: PASS, lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/renderer/common/shortcut-keys.js src/main/modifier-tap.js test/shortcut-keys.test.js test/modifier-tap.test.js
git commit -m "feat: a single-key shortcut's format, and the detector that hears its taps"
```

---

### Task 2: The Mac helper reports the modifier keys

**Files:**
- Modify: `src/native/BuddyHelper.swift` (event tap and `watchKeys` command)
- Modify: `src/main/helper.js` (say `started`)
- Test: `test/helper.test.js` (append)

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: helper command `watchKeys { on: boolean }` → `{ watching: boolean }`, or error `no_accessibility`. Events `keys` on the `Helper` (`{ event: 'keys', kind: 'flags', keyCode, flags, t }` / `{ event: 'keys', kind: 'other' }`), and a `started` event emitted by `Helper.start()` every time it spawns a helper.

- [ ] **Step 1: Write the failing helper tests**

Append to `test/helper.test.js`:

```js
test('says when a helper has started: the first time, and after each restart', async () => {
  const spawnImpl = fakeSpawn();
  const helper = new Helper({ binPath: '/x/buddy-helper', spawnImpl, restartMs: 5 });
  let starts = 0;
  helper.on('started', () => {
    starts += 1;
  });
  helper.start();
  assert.strictEqual(starts, 1);
  spawnImpl.children[0].emit('exit', 1);
  await sleep(30);
  assert.strictEqual(starts, 2, 'a new helper after the old one exited');
  helper.stop();
});

test('passes on what the helper reports about the keys', async () => {
  const { helper, child } = started();
  const heard = [];
  helper.on('keys', (event) => heard.push(event));
  child.reply({ event: 'keys', kind: 'flags', keyCode: 61, flags: 524608, t: 1000 });
  child.reply({ event: 'keys', kind: 'other' });
  await tick();
  assert.deepStrictEqual(heard, [
    { event: 'keys', kind: 'flags', keyCode: 61, flags: 524608, t: 1000 },
    { event: 'keys', kind: 'other' },
  ]);
  helper.stop();
});
```

- [ ] **Step 2: Run them and see the first fail**

Run: `node --test test/helper.test.js`
Expected: FAIL in "says when a helper has started" (`0 !== 1`); the keys test already passes (events go out by name).

- [ ] **Step 3: Say `started` in `src/main/helper.js`**

In `start()`, after `child.on('exit', () => this.onExit(child));`, add:

```js
    // A new helper knows nothing of what the last one was asked to do: key-watch.js tells it again.
    this.emit('started');
```

In the file's top comment, after the sentence about `frontApp`, add: `` `keys` reports the modifier keys while Buddy has asked for them (a single-key shortcut, src/main/key-watch.js), and `started` is said each time a helper starts. ``

- [ ] **Step 4: Run them and see them pass**

Run: `node --test test/helper.test.js`
Expected: PASS.

- [ ] **Step 5: Add the event tap to `src/native/BuddyHelper.swift`**

In the header comment, after the `event    {"event": "frontApp", …}` line, add:

```swift
//            {"event": "keys", "kind": "flags", "keyCode": 61, "flags": 524608, "t": 81234567}   (while watchKeys is on)
//            {"event": "keys", "kind": "other"}
```

Right above `func handle(_ msg: [String: Any]) {`, add:

```swift
// MARK: - the keys of a single-key shortcut

// While Buddy's shortcut is a modifier key tapped on its own (or Settings is recording one), a listen-only event tap
// reports each change of the modifier keys: which key, and all the flags, whose low bits say which side is down, with
// the time in milliseconds since the Mac started. A key or a click is reported only while a modifier is held, as
// "other": it spoils a tap, and which key it was is none of Buddy's business. The tap lives on the main run loop.

var keyTap: CFMachPort?
var keyTapSource: CFRunLoopSource?
let heldModifiers: UInt64 = CGEventFlags.maskCommand.rawValue | CGEventFlags.maskShift.rawValue
    | CGEventFlags.maskControl.rawValue | CGEventFlags.maskAlternate.rawValue | CGEventFlags.maskSecondaryFn.rawValue

func onKeyEvent(proxy: CGEventTapProxy, type: CGEventType, event: CGEvent, refcon: UnsafeMutableRawPointer?) -> Unmanaged<CGEvent>? {
    switch type {
    case .tapDisabledByTimeout, .tapDisabledByUserInput:
        // macOS switches a tap off when it is slow, or while a password field takes the keys; it is switched back on.
        if let tap = keyTap { CGEvent.tapEnable(tap: tap, enable: true) }
    case .flagsChanged:
        send(["event": "keys", "kind": "flags",
              "keyCode": Int(event.getIntegerValueField(.keyboardEventKeycode)),
              "flags": Int(event.flags.rawValue),
              "t": Int(ProcessInfo.processInfo.systemUptime * 1000)])
    default:
        if event.flags.rawValue & heldModifiers != 0 { send(["event": "keys", "kind": "other"]) }
    }
    return Unmanaged.passUnretained(event)
}

/// Start or stop reporting the keys. Runs on the main thread, where the tap lives.
func setKeyTap(_ on: Bool) throws {
    if !on {
        guard let tap = keyTap else { return }
        CGEvent.tapEnable(tap: tap, enable: false)
        if let source = keyTapSource { CFRunLoopRemoveSource(CFRunLoopGetMain(), source, .commonModes) }
        CFMachPortInvalidate(tap)
        keyTap = nil
        keyTapSource = nil
        return
    }
    if keyTap != nil { return }
    let noAccess = HelperError(code: "no_accessibility", message: "Buddy needs Accessibility permission to hear a single key.")
    // Without Accessibility the tap would hear no keys (and macOS could ask for Input Monitoring instead).
    guard accessibilityTrusted(prompt: false) else { throw noAccess }
    let types: [CGEventType] = [.flagsChanged, .keyDown, .leftMouseDown, .rightMouseDown, .otherMouseDown]
    let mask = types.reduce(CGEventMask(0)) { $0 | (CGEventMask(1) << $1.rawValue) }
    guard let tap = CGEvent.tapCreate(tap: .cgSessionEventTap, place: .headInsertEventTap, options: .listenOnly,
                                      eventsOfInterest: mask, callback: onKeyEvent, userInfo: nil) else { throw noAccess }
    let source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0)
    CFRunLoopAddSource(CFRunLoopGetMain(), source, .commonModes)
    CGEvent.tapEnable(tap: tap, enable: true)
    keyTap = tap
    keyTapSource = source
}

func watchKeys(_ args: [String: Any]) throws -> [String: Any] {
    let on = args["on"] as? Bool ?? false
    var failure: Error?
    DispatchQueue.main.sync {
        do { try setKeyTap(on) } catch { failure = error }
    }
    if let failure { throw failure }
    return ["watching": on]
}
```

In `handle`, after the `case "screenshot":` lines, add:

```swift
        case "watchKeys":
            result = try watchKeys(args)
```

- [ ] **Step 6: Build the helper**

Run: `npm run build:native`
Expected: exit 0, `bin/buddy-helper` rebuilt (fix any compile error before going on).

- [ ] **Step 7: Check the command by hand (no key is pressed or posted)**

Run:

```bash
(printf '%s\n' '{"id":1,"cmd":"watchKeys","args":{"on":false}}' '{"id":2,"cmd":"watchKeys","args":{"on":true}}' '{"id":3,"cmd":"watchKeys","args":{"on":false}}'; sleep 2) | ./bin/buddy-helper --owner-pid $$ | grep '"id"'
```

Expected: three replies. id 1 and id 3: `"ok":true` with `"watching":false`. id 2: `"ok":true` with `"watching":true` when this terminal has Accessibility, or `"ok":false` with `"code":"no_accessibility"` when it has not. Both are right; say which one you saw in the report. Make sure no `buddy-helper` is left running (`pgrep -fl buddy-helper` must not list one started by you).

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS, lint clean.

- [ ] **Step 9: Commit**

```bash
git add src/native/BuddyHelper.swift src/main/helper.js test/helper.test.js
git commit -m "feat: the Mac helper can report the modifier keys, for a single-key shortcut"
```

---

### Task 3: Buddy hears the single-key shortcut

**Files:**
- Create: `src/main/key-watch.js`
- Modify: `src/main/shortcut.js`, `src/main/settings-windows.js`, `src/main/ipc/settings.js`, `src/main/main.js`, `src/preload/settings.js`, `test/e2e/smoke.js` (fake helper)
- Test: `test/key-watch.test.js` (new), `test/shortcut.test.js`, `test/settings-windows.test.js`, `test/settings-ipc.test.js` (append)

**Interfaces:**
- Consumes: `tapKeys`, `tapValue`, `isTap` (Task 1); `createTapDetector` (Task 1); helper command `watchKeys` and events `keys`, `started` (Task 2).
- Produces: `createKeyWatch({ helper, onPress, later?, cancelLater?, retryMs? }) -> { setShortcut(value | null) -> boolean, startRecording(onTap), stopRecording() }`, `RETRY_MS` (10000). `createShortcut({ globalShortcut, keyWatch, onPress })` (same returned API). `windows.send(kind, channel, ...args)`. IPC: `shortcut:pause` starts the key watch's recording and sends each tap to the Settings page on channel `shortcut:tap`; `resumeShortcut()` (and `shortcut:resume`) stops it. Preload: `window.buddy.onShortcutTap(fn)` with fn(value).

- [ ] **Step 1: Write the failing key-watch tests**

Create `test/key-watch.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createKeyWatch, RETRY_MS } = require('../src/main/key-watch');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags, t });
// Right ⌥ and left ⌘ tapped at `t`: down, then up 100 ms later. The flags say the kind of key and its side.
const rightOption = (t) => [change(61, 0x80040, t), change(61, 0, t + 100)];
const leftCommand = (t) => [change(55, 0x100008, t), change(55, 0, t + 100)];

/** A key watch with a fake helper (it records each call; `failing` is the code its watchKeys fails with) and fake timers. */
function setup(t, { failing = null } = {}) {
  t.mock.method(console, 'warn', () => {});
  const helper = new EventEmitter();
  helper.calls = [];
  helper.failing = failing;
  helper.call = async (cmd, args) => {
    helper.calls.push([cmd, args]);
    if (helper.failing) throw Object.assign(new Error('no'), { code: helper.failing });
    return { watching: args.on };
  };
  const presses = [];
  const timers = new Map();
  let nextTimer = 1;
  const watch = createKeyWatch({
    helper,
    onPress: () => presses.push('open'),
    later: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    cancelLater: (id) => timers.delete(id),
  });
  const press = (...events) => {
    for (const event of events.flat()) helper.emit('keys', event);
  };
  const told = () => helper.calls.map(([, args]) => args.on);
  /** Fire the one timer that is waiting, as if its time had come. */
  const fireTimer = () => {
    const [[id, timer]] = [...timers];
    timers.delete(id);
    timer.fn();
  };
  return { helper, watch, presses, timers, press, told, fireTimer };
}

test('the helper listens only while a single-key shortcut is set', async (t) => {
  const s = setup(t);
  await tick();
  assert.deepStrictEqual(s.told(), [], 'nothing to listen for yet');
  assert.strictEqual(s.watch.setShortcut('Tap:RightOption'), true);
  await tick();
  assert.deepStrictEqual(s.helper.calls, [['watchKeys', { on: true }]]);
  assert.strictEqual(s.watch.setShortcut(null), true);
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
});

test('a tap of the shortcut opens the panel; another key, or the shortcut with a key, does not', (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  s.press(rightOption(1000));
  assert.deepStrictEqual(s.presses, ['open']);
  s.press(leftCommand(2000));
  s.press([change(61, 0x80040, 3000), { kind: 'other' }, change(61, 0, 3100)]);
  assert.deepStrictEqual(s.presses, ['open'], 'nothing more');
});

test('a shortcut saved with its keys in another order is the same shortcut', (t) => {
  const s = setup(t);
  assert.strictEqual(s.watch.setShortcut('Tap:LeftCommand+LeftShift'), true);
  s.press([change(55, 0x100008, 1000), change(56, 0x12000a, 1050), change(55, 0x20002, 1100), change(56, 0, 1150)]);
  assert.deepStrictEqual(s.presses, ['open']);
});

test('a single-key shortcut that is not well formed is refused, and nothing changes', async (t) => {
  const s = setup(t);
  assert.strictEqual(s.watch.setShortcut('Tap:Bogus'), false);
  await tick();
  assert.deepStrictEqual(s.helper.calls, []);
});

test('while Settings records, every tap goes to Settings and none opens the panel', (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  const heard = [];
  s.watch.startRecording((value) => heard.push(value));
  s.press(rightOption(1000), leftCommand(2000));
  assert.deepStrictEqual(heard, ['Tap:RightOption', 'Tap:LeftCommand']);
  assert.deepStrictEqual(s.presses, []);
  s.watch.stopRecording();
  s.press(rightOption(3000));
  assert.deepStrictEqual(s.presses, ['open'], 'after recording, the shortcut opens the panel again');
});

test('recording has the helper listen even with no single-key shortcut, and stop after', async (t) => {
  const s = setup(t);
  s.watch.startRecording(() => {});
  await tick();
  s.watch.stopRecording();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
  s.watch.stopRecording();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false], 'stopping twice tells it nothing more');
});

test('quick changes leave the helper told the last of them', async (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  s.watch.setShortcut(null);
  s.watch.setShortcut('Tap:Fn');
  await tick();
  await tick();
  assert.strictEqual(s.told().at(-1), true);
  s.press([change(63, 0x800000, 1000), change(63, 0, 1100)]);
  assert.deepStrictEqual(s.presses, ['open']);
});

test('a helper that restarts is told again; with nothing to listen for, it is told nothing', async (t) => {
  const s = setup(t);
  s.helper.emit('started');
  await tick();
  assert.deepStrictEqual(s.told(), []);
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  s.helper.emit('started');
  await tick();
  assert.deepStrictEqual(s.told(), [true, true]);
});

test('when the helper cannot listen, it is asked again every 10 seconds until it can', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  assert.deepStrictEqual([...s.timers.values()].map((timer) => timer.ms), [RETRY_MS]);
  s.fireTimer(); // 10 seconds later, still no Accessibility
  await tick();
  assert.strictEqual(s.timers.size, 1, 'asked again later');
  s.helper.failing = null; // the permission is given
  s.fireTimer();
  await tick();
  assert.deepStrictEqual(s.told(), [true, true, true]);
  assert.strictEqual(s.timers.size, 0, 'listening: nothing more to ask');
  s.press(rightOption(1000));
  assert.deepStrictEqual(s.presses, ['open']);
});

test('asking again stops when the shortcut is no longer a single key', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  assert.strictEqual(s.timers.size, 1);
  s.watch.setShortcut(null);
  assert.strictEqual(s.timers.size, 0);
});
```

- [ ] **Step 2: Run them and see them fail**

Run: `node --test test/key-watch.test.js`
Expected: FAIL (`Cannot find module '../src/main/key-watch'`).

- [ ] **Step 3: Write `src/main/key-watch.js`**

```js
'use strict';

/**
 * Hears a single-key shortcut ("Tap:RightOption"). The Mac helper reports the modifier keys only while Buddy needs
 * them: while such a shortcut is Buddy's, and while Settings records a new one. The reports go through a tap detector
 * (modifier-tap.js): a tap of the shortcut opens the panel, and while Settings records, every tap goes to Settings
 * instead. A helper that restarts is told again; one that cannot listen (Buddy has no Accessibility yet) is asked again
 * every 10 seconds, so that the shortcut starts working once the permission is given.
 */

const { tapKeys, tapValue } = require('../renderer/common/shortcut-keys');
const { createTapDetector } = require('./modifier-tap');

const RETRY_MS = 10_000;

function createKeyWatch({ helper, onPress, later = setTimeout, cancelLater = clearTimeout, retryMs = RETRY_MS }) {
  const detector = createTapDetector();
  let shortcut = null; // the tap that opens the panel, or null
  let recorder = null; // while Settings records a shortcut: where the taps go
  let listening = false; // the helper was told to listen, and said yes
  let telling = null; // the helper is being told; this settles once it has been
  let again = false; // what the helper should do changed while it was being told
  let retry = null; // the timer that asks again after the helper could not listen

  const wanted = () => Boolean(shortcut || recorder);

  async function tell() {
    do {
      again = false;
      const want = wanted();
      if (want === listening) continue;
      try {
        await helper.call('watchKeys', { on: want });
        listening = want;
      } catch (err) {
        listening = false; // it could not listen, or could not be told to stop: either way it is not listening for Buddy
        if (want) {
          console.warn('[buddy] could not listen for the shortcut key:', err.code);
          askAgainLater();
        }
      }
    } while (again);
  }

  /** Have the helper listen, or not, as Buddy now needs. Asked again while it is being told, it is told again after. */
  function sync() {
    if (!wanted() && retry !== null) {
      cancelLater(retry);
      retry = null;
    }
    if (telling) {
      again = true;
      return telling;
    }
    telling = tell().finally(() => {
      telling = null;
    });
    return telling;
  }

  function askAgainLater() {
    if (retry !== null) return;
    retry = later(() => {
      retry = null;
      sync();
    }, retryMs);
  }

  helper.on('keys', (event) => {
    const tap = detector.feed(event);
    if (!tap) return;
    if (recorder) recorder(tap);
    else if (tap === shortcut) onPress();
  });
  // A new helper does not listen, whatever the last one was told.
  helper.on('started', () => {
    listening = false;
    detector.reset();
    sync();
  });

  return {
    /** Make `value` ("Tap:…") the shortcut, or none with null. False, changing nothing, when it is not a well-formed one. */
    setShortcut(value) {
      if (value === null) {
        shortcut = null;
      } else {
        const keys = tapKeys(value);
        if (!keys) return false;
        shortcut = tapValue(keys);
      }
      detector.reset();
      sync();
      return true;
    },
    /** While Settings records a shortcut: every tap goes to onTap, and none opens the panel. */
    startRecording(onTap) {
      recorder = onTap;
      detector.reset();
      sync();
    },
    stopRecording() {
      if (!recorder) return;
      recorder = null;
      detector.reset();
      sync();
    },
  };
}

module.exports = { createKeyWatch, RETRY_MS };
```

- [ ] **Step 4: Run them and see them pass**

Run: `node --test test/key-watch.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing shortcut tests**

In `test/shortcut.test.js`, add `const { tapKeys } = require('../src/renderer/common/shortcut-keys');` after the `createShortcut` require at the top, then append:

```js
/** Stands in for key-watch.js: takes a well-formed single-key shortcut, or none. */
function fakeKeyWatch() {
  return {
    shortcut: null,
    setShortcut(value) {
      if (value !== null && !tapKeys(value)) return false;
      this.shortcut = value;
      return true;
    },
  };
}

test('a single-key shortcut is heard through the key watch, not registered with the system', () => {
  const globalShortcut = fakeGlobalShortcut();
  const keyWatch = fakeKeyWatch();
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress: () => {} });
  assert.strictEqual(shortcut.register('Tap:RightOption'), true);
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(shortcut.current(), 'Tap:RightOption');
});

test('changing between a single key and keys pressed together lets the old one go', () => {
  const globalShortcut = fakeGlobalShortcut();
  const keyWatch = fakeKeyWatch();
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.register('Tap:LeftCommand');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], []);
  assert.strictEqual(keyWatch.shortcut, 'Tap:LeftCommand');
  shortcut.register('Alt+Space');
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['Alt+Space']);
  assert.strictEqual(keyWatch.shortcut, null);
});

test('a single-key shortcut that is not well formed fails and keeps the old one', () => {
  const globalShortcut = fakeGlobalShortcut();
  const keyWatch = fakeKeyWatch();
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress: () => {} });
  shortcut.register('Alt+Space');
  assert.strictEqual(shortcut.register('Tap:Bogus'), false);
  assert.deepStrictEqual([...globalShortcut.registered.keys()], ['Alt+Space']);
  assert.strictEqual(shortcut.current(), 'Alt+Space');
  assert.strictEqual(keyWatch.shortcut, null);
});

test('a taken shortcut after a single key puts the single key back', () => {
  const keyWatch = fakeKeyWatch();
  const shortcut = createShortcut({ globalShortcut: fakeGlobalShortcut(['Command+Space']), keyWatch, onPress: () => {} });
  shortcut.register('Tap:RightOption');
  assert.strictEqual(shortcut.register('Command+Space'), false);
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
  assert.strictEqual(shortcut.current(), 'Tap:RightOption');
});

test('unregister lets a single-key shortcut go', () => {
  const keyWatch = fakeKeyWatch();
  const shortcut = createShortcut({ globalShortcut: fakeGlobalShortcut(), keyWatch, onPress: () => {} });
  shortcut.register('Tap:Fn');
  shortcut.unregister();
  assert.strictEqual(keyWatch.shortcut, null);
  assert.strictEqual(shortcut.current(), null);
});
```

- [ ] **Step 6: Run them and see them fail**

Run: `node --test test/shortcut.test.js`
Expected: FAIL (the `Tap:` value goes to `globalShortcut`).

- [ ] **Step 7: Rewrite `src/main/shortcut.js`**

```js
'use strict';

/**
 * The shortcut that opens the panel from any app (⌥Space by default): keys pressed together, registered with the
 * system as an Electron accelerator, or a single key tapped on its own ("Tap:RightOption"), heard through the Mac
 * helper (key-watch.js). Changing it never leaves the user with none: if the new one is taken, the old one is put
 * back. It can also be let go while Buddy is turned off; turning Buddy back on takes the saved shortcut again (main.js
 * reads it from the store).
 */

const { isTap } = require('../renderer/common/shortcut-keys');

function createShortcut({ globalShortcut, keyWatch, onPress }) {
  let current = null; // registered with the system, or heard through the helper, right now

  function take(value) {
    if (!value) return false; // nothing to register (a blank setting)
    if (isTap(value)) return keyWatch.setShortcut(value); // false for one that is not well formed
    try {
      return globalShortcut.register(value, onPress);
    } catch {
      return false; // Electron throws on a malformed accelerator
    }
  }

  function release(value) {
    if (isTap(value)) keyWatch.setShortcut(null);
    else globalShortcut.unregister(value);
  }

  return {
    current: () => current,
    /** Takes `value`. If that fails, the one that was taken stays. */
    register(value) {
      const previous = current;
      if (previous) release(previous);
      if (take(value)) {
        current = value;
        return true;
      }
      if (previous) take(previous);
      return false;
    },
    /** Gives the shortcut back, so other apps can use it (and the helper stops listening for a single key). */
    unregister() {
      if (!current) return;
      release(current);
      current = null;
    },
  };
}

module.exports = { createShortcut };
```

- [ ] **Step 8: Run them and see them pass**

Run: `node --test test/shortcut.test.js`
Expected: PASS (old and new tests).

- [ ] **Step 9: Write the failing `send()` test**

Append to `test/settings-windows.test.js`:

```js
test('send() reaches the page of the open window of that kind, and no other', () => {
  const { windows, created } = setup();
  windows.open('settings');
  windows.open('admin');
  const [settings, admin] = created;
  windows.send('settings', 'shortcut:tap', 'Tap:Fn');
  assert.deepStrictEqual(settings.sent, [['shortcut:tap', 'Tap:Fn']]);
  assert.deepStrictEqual(admin.sent, []);
  settings.close();
  windows.send('settings', 'shortcut:tap', 'Tap:Fn');
  assert.deepStrictEqual(settings.sent, [['shortcut:tap', 'Tap:Fn']], 'a closed window is sent nothing');
  windows.send('onboarding', 'shortcut:tap', 'Tap:Fn'); // never opened: nothing happens, nothing throws
});
```

Run: `node --test test/settings-windows.test.js` — Expected: FAIL (`windows.send is not a function`).

- [ ] **Step 10: Add `send` to `src/main/settings-windows.js`**

In the returned object, after `close(kind) { … },`, add:

```js
    /** Send to the page of the open window of that kind, if there is one. */
    send(kind, channel, ...args) {
      if (alive(windows[kind])) windows[kind].webContents.send(channel, ...args);
    },
```

Run: `node --test test/settings-windows.test.js` — Expected: PASS.

- [ ] **Step 11: Write the failing Settings IPC tests**

In `test/settings-ipc.test.js`:

1. In `setup()`, before `const ipc = registerSettingsIpc({`, add:

```js
  // Stands in for key-watch.js: `log` is 'start' and 'stop', in order; `recorder` is where taps go while recording.
  const keyWatch = {
    log: [],
    recorder: null,
    startRecording(onTap) {
      this.recorder = onTap;
      this.log.push('start');
    },
    stopRecording() {
      this.recorder = null;
      this.log.push('stop');
    },
  };
  const sent = []; // [kind, channel, ...args] for each thing sent to a window's page
```

2. In the `windows:` fake, after `owns: …,` add `send: (kind, channel, ...args) => sent.push([kind, channel, ...args]),`.
3. After `shortcut: realShortcut || { … },` add `keyWatch,`.
4. Change the return line to `return { call, callFromWelcome, handlers, store, keys, calls, opened, ipc, shortcutNow: () => current, keyWatch, sent };`.
5. Add `const { tapKeys } = require('../src/renderer/common/shortcut-keys');` next to the other requires at the top.
6. Append these tests after the existing `shortcut:pause`/`shortcut:resume` tests:

```js
test('shortcut:pause also has a key tapped on its own heard, and sends each tap to the Settings page', async () => {
  const s = setup({ buddyOn: true });
  await s.call('shortcut:pause');
  assert.deepStrictEqual(s.keyWatch.log, ['start']);
  s.keyWatch.recorder('Tap:RightOption');
  assert.deepStrictEqual(s.sent, [['settings', 'shortcut:tap', 'Tap:RightOption']]);
});

test('shortcut:resume, and resumeShortcut when Settings closes, stop the recording, whether Buddy is on or off', async () => {
  const on = setup({ buddyOn: true });
  await on.call('shortcut:pause');
  await on.call('shortcut:resume');
  assert.deepStrictEqual(on.keyWatch.log, ['start', 'stop']);
  const off = setup({ buddyOn: false });
  off.ipc.resumeShortcut();
  assert.deepStrictEqual(off.keyWatch.log, ['stop']);
});

test('set: a single-key shortcut is saved like any other, and one that is not well formed is refused', async () => {
  const keyWatch = {
    shortcut: null,
    setShortcut(value) {
      if (value !== null && !tapKeys(value)) return false;
      this.shortcut = value;
      return true;
    },
  };
  const globalShortcut = { register: () => true, unregister() {} };
  const s = setup({ buddyOn: true, realShortcut: createShortcut({ globalShortcut, keyWatch, onPress() {} }) });
  const r = await s.call('settings:set', { shortcut: 'Tap:RightOption' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption');
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
  assert.deepStrictEqual(
    await s.call('settings:set', { shortcut: 'Tap:Bogus' }),
    refused('shortcut_taken', '"Tap:Bogus" can\'t be used. Try another one.'),
  );
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption', 'nothing changed');
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
});
```

Run: `node --test test/settings-ipc.test.js` — Expected: FAIL in the first two new tests (`keyWatch.log` stays empty).

- [ ] **Step 12: Use the key watch in `src/main/ipc/settings.js`**

1. Add `keyWatch` to the destructured parameters, right after `shortcut`:

```js
function registerSettingsIpc({
  ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, keyWatch, onFinishOnboarding, shell,
  account, cloud, canSignIn, version,
}) {
```

2. Make `resumeShortcut` stop the recording first:

```js
  /**
   * Recording is over: taps open the panel again, and the saved shortcut is registered again while Buddy is on (after
   * a recording, or when Settings closes). If another app took it while it was let go, that is logged (as main.js does
   * when Buddy starts) and nothing else happens.
   */
  function resumeShortcut() {
    keyWatch.stopRecording();
    const saved = store.get('shortcut');
    if (!power.isOn() || shortcut.current() === saved) return;
    if (!shortcut.register(saved)) console.warn('[buddy] could not take the shortcut back');
  }
```

3. Replace the `shortcut:pause` handler and its comment with:

```js
  // While the Settings page records a new shortcut, Buddy lets go of its own, so that pressing the current one is
  // heard by the page instead of opening the panel. A key tapped on its own is heard by the Mac helper instead (the
  // page does not see fn or Caps Lock), and each tap is sent to the page.
  handleSettings('shortcut:pause', () => {
    shortcut.unregister();
    keyWatch.startRecording((value) => windows.send('settings', 'shortcut:tap', value));
    return {};
  });
```

Run: `node --test test/settings-ipc.test.js` — Expected: PASS (old and new tests).

- [ ] **Step 13: Wire it in `src/main/main.js` and the preload**

In `src/main/main.js`:
- add `const { createKeyWatch } = require('./key-watch');` after `const { createShortcut } = require('./shortcut');`;
- replace

```js
  // The shortcut is taken only while Buddy is on: it opens the panel, and the panel reads the person's selection.
  const shortcut = createShortcut({ globalShortcut, onPress: onCall });
```

with

```js
  // The shortcut is taken only while Buddy is on: it opens the panel, and the panel reads the person's selection. A key
  // tapped on its own ("Tap:RightOption") is heard through the helper; any other shortcut is registered with the system.
  const keyWatch = createKeyWatch({ helper, onPress: onCall });
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress: onCall });
```

- in the `registerSettingsIpc({` call, change `helper, buddy, power, shortcut,` to `helper, buddy, power, shortcut, keyWatch,`.

In `src/preload/settings.js`, after the `resumeShortcut` line, add:

```js
  onShortcutTap: (fn) => ipcRenderer.on('shortcut:tap', (_event, value) => fn(value)),
```

- [ ] **Step 14: Let the e2e fake helper answer `watchKeys`**

In `test/e2e/smoke.js`, in the fake `helper`, add a `watching: false,` property after `calls: [],` with the comment `// whether the app has the helper listen to the modifier keys (a single-key shortcut)`, and in `call()` after the `permissions` line add:

```js
    if (cmd === 'watchKeys') {
      this.watching = args.on;
      return { watching: args.on };
    }
```

- [ ] **Step 15: Run everything**

Run: `npm test && npm run test:e2e`
Expected: unit tests PASS, lint clean; e2e: all checks ok (the Settings recorder steps still pass: recording now also has the fake helper listen).

- [ ] **Step 16: Commit**

```bash
git add src/main/key-watch.js src/main/shortcut.js src/main/settings-windows.js src/main/ipc/settings.js src/main/main.js src/preload/settings.js test/key-watch.test.js test/shortcut.test.js test/settings-windows.test.js test/settings-ipc.test.js test/e2e/smoke.js
git commit -m "feat: a key tapped on its own can be the shortcut: heard through the helper, recorded from Settings"
```

---

### Task 4: Settings records and explains a single-key shortcut

**Files:**
- Modify: `src/renderer/settings/index.html`, `src/renderer/settings/settings.js`, `src/renderer/settings/settings.css`
- Modify: `test/e2e/checks/30-settings.js`, `docs/manual-checklist.md`

**Interfaces:**
- Consumes: `window.buddy.onShortcutTap(fn)`, `ShortcutKeys.isTap/tapKeys/symbols` (Tasks 1, 3); `ctx.helper.emit('keys', …)` and `ctx.helper.watching` in the e2e (Task 3).
- Produces: `#shortcut-note` (`p.note.small`, hidden unless the shortcut is a single key; `.error` without Accessibility).

- [ ] **Step 1: Write the failing e2e steps**

In `test/e2e/checks/30-settings.js`, inside `sectionsAndShortcutCheck`, right after the "Reset with ⌥ Space already saved" block (the line `assert.deepStrictEqual(registered(), ['Alt+Space']);` that follows `assert.strictEqual(saves, 0, 'nothing was saved');`) and before `// Choosing another section ends a recording`, add:

```js
  // A key tapped on its own. While the box waits, the Mac helper (the fake in ctx.helper) listens to the modifier keys;
  // the tap it reports is saved at once, and from then on the helper listens for it, not Electron. Tapped on its own it
  // opens the panel; with another key pressed meanwhile it does not. The reports are the real helper's: a key code, the
  // flags after the change (their bits say which side is down) and the time in milliseconds.
  const keys = (...events) => {
    for (const event of events) ctx.helper.emit('keys', event);
  };
  const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags, t });
  const RIGHT_OPTION_DOWN = 0x80040; // an ⌥ is down, and it is the right one
  const note = () => page("document.getElementById('shortcut-note').hidden ? null : document.getElementById('shortcut-note').textContent");
  const TAP_NOTE = 'Tap it on its own to open your buddy: press and let go, with no other key.';
  assert.strictEqual(await note(), null, 'no note for keys pressed together');
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => registered().length === 0 && ctx.helper.watching === true, 'the helper to listen while the box waits');
  keys(change(61, RIGHT_OPTION_DOWN, 1000), change(61, 0, 1120));
  await waitFor(() => ctx.store.get('shortcut') === 'Tap:RightOption', 'the tapped key to be saved');
  await waitFor(async () => (await status()) === 'Saved ✓', 'the Shortcut box to say it is saved');
  assert.deepStrictEqual(await caps(), ['Right ⌥'], 'the key is shown with its side');
  assert.strictEqual(await recording(), false);
  assert.deepStrictEqual(registered(), [], 'nothing is registered with Electron');
  await waitFor(async () => (await note()) === TAP_NOTE, 'the note under the box');
  assert.strictEqual(ctx.helper.watching, true, 'the helper listens for the shortcut');

  keys(change(61, RIGHT_OPTION_DOWN, 5000), { kind: 'other' }, change(61, 0, 5100)); // ⌥ with a letter
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.strictEqual(ctx.panel.isVisible(), false, 'Right ⌥ with another key does not open the panel');
  keys(change(61, RIGHT_OPTION_DOWN, 6000), change(61, 0, 6100));
  await waitFor(() => ctx.panel.isVisible(), 'Right ⌥ tapped on its own to open the panel');
  ctx.panel.hide();
  await waitFor(() => !ctx.panel.isVisible(), 'the panel to close');

  // Caps Lock: one press is a tap, and the note says what macOS also does with it.
  await page("document.getElementById('shortcut').click()");
  await waitFor(() => recording(), 'the box to wait for keys');
  keys(change(57, 0x10000, 9000));
  await waitFor(() => ctx.store.get('shortcut') === 'Tap:CapsLock', 'Caps Lock to be saved');
  assert.deepStrictEqual(await caps(), ['⇪ Caps Lock']);
  await waitFor(
    async () => (await note()) === `${TAP_NOTE} Caps Lock also turns capitals on and off when you tap it.`,
    'the Caps Lock note',
  );

  // Reset: ⌥ Space again, the helper stops listening, and the note goes.
  await page("document.getElementById('shortcut-reset').click()");
  await waitFor(() => ctx.store.get('shortcut') === 'Alt+Space', 'the default shortcut to be saved');
  await waitFor(() => ctx.helper.watching === false, 'the helper to stop listening');
  assert.deepStrictEqual(registered(), ['Alt+Space']);
  await waitFor(async () => (await note()) === null, 'the note to go');
```

(`waitFor` accepts a function returning a value or a promise, as the steps above already use it.)

- [ ] **Step 2: Run the e2e and see it fail**

Run: `npm run test:e2e`
Expected: FAIL in the Settings check ("no note for keys pressed together": `#shortcut-note` does not exist yet, so `note()` throws or the tap is never saved).

- [ ] **Step 3: The page's markup and style**

In `src/renderer/settings/index.html`, change the hint and add the note after the status row:

```html
      <p id="shortcut-hint" class="muted small">Click the box, then press the keys you want, or tap one key like ⌘ or fn on its own. Esc cancels.</p>
      <div class="row">
        <span id="shortcut-status" class="status small" aria-live="polite"></span>
        <span class="spacer"></span>
        <button id="shortcut-reset" class="btn quiet small" type="button">Reset to ⌥ Space</button>
      </div>
      <p id="shortcut-note" class="note small" aria-live="polite" hidden></p>
```

In `src/renderer/settings/settings.css`, after `#shortcut-reset { … }`, add:

```css
#shortcut-note { margin-top: 12px; }
```

- [ ] **Step 4: The page's script**

In `src/renderer/settings/settings.js`:

1. After `const DEFAULT_SHORTCUT = 'Alt+Space';`, add:

```js
// Under the Shortcut box while the shortcut is a key tapped on its own: how to press it, and what macOS also does with
// Caps Lock and fn. Without Accessibility Buddy cannot hear the key at all, and the first line says so instead.
const TAP_NOTE = 'Tap it on its own to open your buddy: press and let go, with no other key.';
const TAP_KEY_NOTES = {
  CapsLock: 'Caps Lock also turns capitals on and off when you tap it.',
  Fn: 'If fn also opens emoji or dictation, set “Press 🌐 key to” to “Do Nothing” in System Settings → Keyboard.',
};
const CANNOT_HEAR = 'Buddy needs Accessibility to hear this key. Allow it in Permissions.';
```

2. After `function showHeld(held) { … }`, add:

```js
/** The note under the Shortcut box: shown only for a key tapped on its own, in red when Buddy cannot hear it. */
async function renderShortcutNote() {
  const permissions = ShortcutKeys.isTap(snap.settings.shortcut) ? await window.buddy.permissions() : null;
  const keys = ShortcutKeys.tapKeys(snap.settings.shortcut); // after the wait: the shortcut may have changed meanwhile
  const note = $('shortcut-note');
  note.hidden = !keys;
  if (!keys) return;
  const deaf = Boolean(permissions?.ok && !permissions.accessibility);
  note.classList.toggle('error', deaf);
  note.textContent = [deaf ? CANNOT_HEAR : TAP_NOTE, ...keys.map((k) => TAP_KEY_NOTES[k]).filter(Boolean)].join(' ');
}
```

3. At the end of `render()`, after the `$('version').textContent = …;` line, add `renderShortcutNote();`.

4. In `saveShortcut`, in the `if (r.ok)` branch after `showStatus('shortcut-status', 'Saved ✓', 'good');`, add `renderShortcutNote();`.

5. After the `document.addEventListener('keyup', …, true);` block, add:

```js
// A key tapped on its own while the box waits: the Mac helper hears it (the page does not see fn or Caps Lock), and the
// main process sends it here.
window.buddy.onShortcutTap((value) => {
  if (recording) saveShortcut(value);
});
```

- [ ] **Step 5: Run the e2e and the unit tests**

Run: `npm test && npm run test:e2e`
Expected: PASS, every e2e check ok.

- [ ] **Step 6: Look at it**

Capture the Shortcut section with `Tap:RightOption` saved, in light and in dark mode, the same way the existing e2e screenshots are taken (into `test/e2e/out/png/`), and look at them: the `Right ⌥` cap sits centred in the box, the note sits under the status row with the base `.note` look, nothing overlaps or is cut off. Fix the CSS if needed.

- [ ] **Step 7: The manual checklist**

Append to `docs/manual-checklist.md`:

```markdown

## Single-key shortcut

- [ ] Settings → Shortcut: click the box and tap Right ⌥ on its own → saved as "Right ⌥", with the note "Tap it on its own to open your buddy: press and let go, with no other key."
- [ ] In TextEdit, tap Right ⌥ → the panel opens; tap it again → it closes.
- [ ] Hold Right ⌥ for a second and let go → nothing. Type ⌥ with a letter (a special character) → nothing. ⌥-click → nothing. Tap Left ⌥ → nothing.
- [ ] Record Left ⌘: ⌘C, ⌘V and ⌘-click in other apps never open Buddy; a ⌘ tap does.
- [ ] Record ⇧ and ⌘ tapped together → "Left ⇧ Left ⌘"; tapping both opens Buddy, ⇧ alone or ⌘ alone does not.
- [ ] Record fn → "fn" and the note about emoji and dictation; tapping fn opens Buddy (after setting "Press 🌐 key to" to "Do Nothing" if macOS opens emoji instead).
- [ ] Record Caps Lock → "⇪ Caps Lock" and its note; each press opens or closes Buddy once, and capitals toggle as the note says.
- [ ] While recording, press ⌘ and B together → saved as "⌘ B", not as a ⌘ tap.
- [ ] Turn Buddy's Accessibility off in System Settings: the note turns red ("Buddy needs Accessibility to hear this key. Allow it in Permissions."); turn it on again: within 10 seconds the key works, without restarting Buddy.
- [ ] Quit the helper (`pkill buddy-helper`): within a few seconds the key works again.
- [ ] Turn Buddy off (General): tapping the key does nothing; on again: it works.
- [ ] Reset to ⌥ Space: ⌥ Space works again and tapping the key does nothing.
```

- [ ] **Step 8: Commit**

```bash
git add src/renderer/settings/index.html src/renderer/settings/settings.js src/renderer/settings/settings.css test/e2e/checks/30-settings.js docs/manual-checklist.md
git commit -m "feat: Settings records a key tapped on its own and says how it works"
```
