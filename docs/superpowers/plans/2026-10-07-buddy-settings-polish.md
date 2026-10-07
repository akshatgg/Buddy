# Buddy Settings polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A professional-looking Buddy: a sidebar Settings window with the person's Google profile and Sign out, a shortcut recorder (press the keys; saved at once), and one shared look across Settings, Welcome, Admin and the panel.

**Architecture:** Task 1 adds the logic, test-first and in complete code: a pure key-to-accelerator module the Settings page loads (and Node tests require), shortcut pause/resume IPC so the global shortcut doesn't fire while recording, the Google photo through sign-in → account.json → the Settings snapshot, and "open Settings on a section" from the panel's errors. Task 2 rebuilds the Settings page on a new shared design system (`base.css`) with complete HTML and JS; its visual CSS is written against the design tokens and component list below and checked with screenshots in light and dark mode (the deliberate exception to "every line in the plan": visual polish needs looking at the result). Task 3 applies the same look to Welcome, Admin and the panel.

**Tech Stack:** Electron 44, vanilla HTML/CSS/JS renderers (no framework, no bundler), CommonJS main process, `node --test`, ESLint 10, the e2e harness in `test/e2e/`.

**Spec:** `docs/superpowers/specs/2026-10-07-buddy-settings-polish-design.md`

## Global Constraints

- Plain JavaScript; CommonJS in main/preload; classic `<script>` renderers; no new dependencies.
- Every element id that a page script or an e2e check uses stays, unless the plan changes that check in the same task.
- Shortcuts are saved as Electron accelerators (e.g. `Alt+Space`, `Shift+Command+B`); the default is `Alt+Space`; display uses the Mac's order and symbols ⌃ ⌥ ⇧ ⌘.
- The Settings page's content-security policy allows images from `'self'` and `https://*.googleusercontent.com` only; nothing else is widened.
- Messages a person sees are plain words. Logs carry codes and kinds only.
- Light and dark mode both work (`prefers-color-scheme`); the accent stays the existing teal (`#1f7a70` light, `#5ad1c3` dark).
- No `Co-Authored-By` line and no mention of Claude as an author in any commit (the user's rule).
- `npm test` must stay lint-clean and green; `npm run test:e2e` must pass (it opens Buddy's windows briefly, fakes only).

## File map

```
src/renderer/common/shortcut-keys.js   NEW  ShortcutKeys.fromKeyEvent(e), .heldSymbols(e), .symbols(accelerator), .keyFor(code)
src/main/ipc/settings.js               shortcut:pause / shortcut:resume; snapshot gets account.photo and version; returns { resumeShortcut }
src/main/settings-windows.js           open(kind, { section }); onClosed(fn)
src/main/ipc/panel.js                  panel:open-settings carries the error code → the AI section for key errors
src/main/google-signin.js              the sign-in answer's photo (https only)
src/main/account.js                    keeps and answers the photo
src/main/main.js                       openSettings(section); resume the shortcut when Settings closes; version
src/preload/settings.js                pauseShortcut, resumeShortcut, onSection
src/preload/panel.js                   openSettings(code)
src/renderer/panel/panel.js            sends the shown error's code with Open Settings
src/renderer/common/base.css           the shared design system (rewritten in Task 2)
src/renderer/settings/{index.html,settings.js,settings.css}   the sidebar Settings (Task 2)
src/renderer/onboarding/*, src/renderer/admin/*, src/renderer/panel/*   the shared look (Task 3)
test/shortcut-keys.test.js             NEW
test/{settings-ipc,settings-windows,panel-ipc,google-signin,account}.test.js   extended
test/e2e/smoke.js, test/e2e/checks/{30-settings,40-panel,70-account}.js   updated
```

---

### Task 1: The logic — keys to shortcuts, pause/resume, the photo, Settings sections

**Files:**
- Create: `src/renderer/common/shortcut-keys.js`, `test/shortcut-keys.test.js`
- Modify: `src/main/ipc/settings.js`, `src/main/settings-windows.js`, `src/main/ipc/panel.js`, `src/main/google-signin.js`, `src/main/account.js`, `src/main/main.js`, `src/preload/settings.js`, `src/preload/panel.js`, `src/renderer/panel/panel.js`
- Test: `test/settings-ipc.test.js`, `test/settings-windows.test.js`, `test/panel-ipc.test.js`, `test/google-signin.test.js`, `test/account.test.js`, `test/e2e/smoke.js`

**Interfaces (produces):**
- `ShortcutKeys` (browser global and `module.exports`): `fromKeyEvent(e) → { held } | { accelerator, keys } | { refused, held }` (the shortcuts every app uses, such as ⌘C, are refused); `heldSymbols(e) → string[]`; `symbols(accelerator) → string[]`; `keyFor(code) → string | null`.
- IPC (Settings and Welcome windows): `shortcut:pause → {}` (lets go of the global shortcut); `shortcut:resume → {}` (registers the saved one again when Buddy is on and it isn't the registered one). The snapshot gains `account.photo` (string, `''` when none) and `version` (string).
- `registerSettingsIpc(...)` returns `{ resumeShortcut }`; it takes a new dep `version`.
- `windows.open(kind, { section })`: a new window loads with `#<section>`; an open one gets the IPC event `settings:section` with the name. `windows.onClosed(fn)`: `fn(kind)` after a window closes.
- Preload (settings): `window.buddy.pauseShortcut()`, `resumeShortcut()`, `onSection(fn)`. Preload (panel): `window.buddy.openSettings(code?)`.
- `account.user()` and `signIn()` answer `{ uid, email, name, photo }`.

- [ ] **Step 1: Write the failing tests for the keys module**

Create `test/shortcut-keys.test.js`:

```js
'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fromKeyEvent, heldSymbols, symbols, keyFor } = require('../src/renderer/common/shortcut-keys');

/** A keydown as the page sees it: the physical key's code and the modifiers held. */
const ev = (code, mods = {}) => ({ code, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

test("a key with ⌘, ⌥ or ⌃ is a shortcut, in Electron's words and the Mac's symbols", () => {
  assert.deepStrictEqual(fromKeyEvent(ev('KeyB', { metaKey: true, shiftKey: true })), { accelerator: 'Shift+Command+B', keys: ['⇧', '⌘', 'B'] });
  assert.deepStrictEqual(fromKeyEvent(ev('Space', { altKey: true })), { accelerator: 'Alt+Space', keys: ['⌥', 'Space'] });
  assert.deepStrictEqual(fromKeyEvent(ev('ArrowUp', { ctrlKey: true })), { accelerator: 'Control+Up', keys: ['⌃', '↑'] });
  assert.strictEqual(fromKeyEvent(ev('Digit7', { metaKey: true, altKey: true })).accelerator, 'Alt+Command+7');
  assert.strictEqual(fromKeyEvent(ev('KeyK', { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })).accelerator,
    'Control+Alt+Shift+Command+K');
});

test('every key a shortcut may use has its accelerator name; anything else has none', () => {
  for (const [code, key] of [
    ['KeyA', 'A'], ['KeyZ', 'Z'], ['Digit0', '0'], ['Digit9', '9'], ['F1', 'F1'], ['F24', 'F24'], ['Space', 'Space'],
    ['Enter', 'Return'], ['NumpadEnter', 'Return'], ['Tab', 'Tab'], ['Backspace', 'Backspace'], ['Delete', 'Delete'],
    ['ArrowUp', 'Up'], ['ArrowDown', 'Down'], ['ArrowLeft', 'Left'], ['ArrowRight', 'Right'],
    ['Minus', '-'], ['Equal', '='], ['BracketLeft', '['], ['BracketRight', ']'], ['Backslash', '\\'], ['Semicolon', ';'],
    ['Quote', "'"], ['Comma', ','], ['Period', '.'], ['Slash', '/'], ['Backquote', '`'],
  ]) {
    assert.strictEqual(keyFor(code), key, code);
  }
  for (const code of ['F25', 'Escape', 'CapsLock', 'MetaLeft', 'Numpad5', 'IntlBackslash', '', 'constructor', 'toString']) {
    assert.strictEqual(keyFor(code), null, code);
  }
});

test('modifiers alone are shown while held, and are not a shortcut yet', () => {
  assert.deepStrictEqual(fromKeyEvent(ev('MetaLeft', { metaKey: true })), { held: ['⌘'] });
  assert.deepStrictEqual(fromKeyEvent(ev('ShiftRight', { metaKey: true, shiftKey: true })), { held: ['⇧', '⌘'] });
  assert.deepStrictEqual(fromKeyEvent(ev('AltLeft', { altKey: true, ctrlKey: true })), { held: ['⌃', '⌥'] });
  assert.deepStrictEqual(fromKeyEvent(ev('CapsLock')), { held: [] });
});

test('a key needs ⌘, ⌥ or ⌃ (⇧ alone would take over typing capitals); F-keys may stand alone', () => {
  assert.deepStrictEqual(fromKeyEvent(ev('KeyA')), { refused: 'Hold ⌘, ⌥ or ⌃ with the key.', held: [] });
  assert.deepStrictEqual(fromKeyEvent(ev('KeyA', { shiftKey: true })), { refused: 'Hold ⌘, ⌥ or ⌃ with the key.', held: ['⇧'] });
  assert.deepStrictEqual(fromKeyEvent(ev('F5')), { accelerator: 'F5', keys: ['F5'] });
  assert.deepStrictEqual(fromKeyEvent(ev('F5', { shiftKey: true })), { accelerator: 'Shift+F5', keys: ['⇧', 'F5'] });
  assert.deepStrictEqual(fromKeyEvent(ev('Numpad5', { metaKey: true })), { refused: "That key can't be part of a shortcut.", held: ['⌘'] });
});

// Taking one of these would break it in every app while Buddy holds it (or, for ⌘Tab and ⌘Space, the Mac's own).
test('the shortcuts every app uses are refused, each named for what it does', () => {
  for (const [code, mods, message] of [
    ['KeyC', { metaKey: true }, '⌘C is used by every app (Copy). Pick another one.'],
    ['KeyV', { metaKey: true }, '⌘V is used by every app (Paste). Pick another one.'],
    ['KeyX', { metaKey: true }, '⌘X is used by every app (Cut). Pick another one.'],
    ['KeyZ', { metaKey: true }, '⌘Z is used by every app (Undo). Pick another one.'],
    ['KeyZ', { metaKey: true, shiftKey: true }, '⇧⌘Z is used by every app (Redo). Pick another one.'],
    ['KeyA', { metaKey: true }, '⌘A is used by every app (Select All). Pick another one.'],
    ['KeyQ', { metaKey: true }, '⌘Q is used by every app (Quit). Pick another one.'],
    ['KeyW', { metaKey: true }, '⌘W is used by every app (Close Window). Pick another one.'],
    ['KeyS', { metaKey: true }, '⌘S is used by every app (Save). Pick another one.'],
    ['KeyH', { metaKey: true }, '⌘H is used by every app (Hide). Pick another one.'],
    ['KeyM', { metaKey: true }, '⌘M is used by every app (Minimise). Pick another one.'],
    ['Tab', { metaKey: true }, '⌘Tab is used by every app (switching apps). Pick another one.'],
    ['Space', { metaKey: true }, '⌘Space is used by every app (Spotlight). Pick another one.'],
  ]) {
    const held = mods.shiftKey ? ['⇧', '⌘'] : ['⌘'];
    assert.deepStrictEqual(fromKeyEvent(ev(code, mods)), { refused: message, held }, message);
  }
});

test('those keys with other modifiers are shortcuts like any other', () => {
  for (const [code, mods, accelerator] of [
    ['KeyC', { metaKey: true, altKey: true }, 'Alt+Command+C'],
    ['KeyC', { metaKey: true, shiftKey: true }, 'Shift+Command+C'],
    ['KeyC', { ctrlKey: true }, 'Control+C'],
    ['KeyZ', { metaKey: true, shiftKey: true, altKey: true }, 'Alt+Shift+Command+Z'],
    ['KeyQ', { metaKey: true, ctrlKey: true }, 'Control+Command+Q'],
    ['Tab', { altKey: true }, 'Alt+Tab'],
    ['Space', { metaKey: true, ctrlKey: true }, 'Control+Command+Space'],
    ['Space', { altKey: true }, 'Alt+Space'],
  ]) {
    assert.strictEqual(fromKeyEvent(ev(code, mods)).accelerator, accelerator, accelerator);
  }
});

// While recording, the box shows the modifiers held as caps and follows them as they are let go: a keyup says what is
// still held, whichever key it is for (the Mac can keep a key's keydown to itself and still send its keyup).
test('heldSymbols: the modifiers a key event says are held, in the Mac order', () => {
  assert.deepStrictEqual(heldSymbols(ev('MetaLeft', { metaKey: true, shiftKey: true })), ['⇧', '⌘']);
  assert.deepStrictEqual(heldSymbols(ev('ShiftLeft', { metaKey: true })), ['⌘'], 'the keyup of ⇧, with ⌘ still held');
  assert.deepStrictEqual(heldSymbols(ev('MetaLeft')), [], 'the keyup of the last one');
  assert.deepStrictEqual(heldSymbols(ev('ArrowUp', { ctrlKey: true, altKey: true })), ['⌃', '⌥'], 'the keyup of a key');
  assert.deepStrictEqual(heldSymbols(ev('KeyK', { metaKey: true, ctrlKey: true, altKey: true, shiftKey: true })), ['⌃', '⌥', '⇧', '⌘']);
});

test('symbols: any saved accelerator becomes key caps in the Mac order', () => {
  assert.deepStrictEqual(symbols('Alt+Space'), ['⌥', 'Space']);
  assert.deepStrictEqual(symbols('CommandOrControl+Shift+B'), ['⇧', '⌘', 'B']);
  assert.deepStrictEqual(symbols('Command+Control+Alt+Shift+K'), ['⌃', '⌥', '⇧', '⌘', 'K']);
  assert.deepStrictEqual(symbols('Ctrl+Option+Enter'), ['⌃', '⌥', '↩']);
  assert.deepStrictEqual(symbols('Cmd+a'), ['⌘', 'A']);
  assert.deepStrictEqual(symbols('Control+Up'), ['⌃', '↑']);
  assert.deepStrictEqual(symbols('F12'), ['F12']);
  assert.deepStrictEqual(symbols(''), []);
  assert.deepStrictEqual(symbols(undefined), []);
});

// Electron takes an accelerator in any case ("cmd+shift+b" is as good as "Command+Shift+B"), and before the recorder the
// Shortcut box was free text, so what was saved is whatever its owner typed.
test('symbols: a shortcut saved in any case, or with Super or Meta, shows all of its keys', () => {
  for (const [accelerator, keys] of [
    ['alt+space', ['⌥', 'Space']],
    ['cmd+shift+b', ['⇧', '⌘', 'B']],
    ['CTRL+ALT+X', ['⌃', '⌥', 'X']],
    ['ctrl+alt+x', ['⌃', '⌥', 'X']],
    ['Super+B', ['⌘', 'B']],
    ['Meta+B', ['⌘', 'B']],
    ['Meta+Return', ['⌘', '↩']],
    ['control+up', ['⌃', '↑']],
    ['f12', ['F12']],
    ['SHIFT+COMMAND+b', ['⇧', '⌘', 'B']],
    ['commandorcontrol+Option+enter', ['⌥', '⌘', '↩']],
    ['CmdOrCtrl+ESC', ['⌘', 'Esc']],
    ['altgr+TAB', ['⌥', '⇥']],
    ['ctrl+backspace', ['⌃', '⌫']],
    ['Command+DELETE', ['⌘', '⌦']],
    ['alt+Down', ['⌥', '↓']],
    ['alt+LEFT', ['⌥', '←']],
    ['alt+right', ['⌥', '→']],
    ['SUPER+SPACE', ['⌘', 'Space']],
    ['meta+f1', ['⌘', 'F1']],
    ['META+F24', ['⌘', 'F24']],
    ['  cmd + shift + b ', ['⇧', '⌘', 'B']],
  ]) {
    assert.deepStrictEqual(symbols(accelerator), keys, accelerator);
  }
});

test('symbols: every spelling of a modifier, in every case, is that modifier', () => {
  for (const [spellings, cap] of [
    [['command', 'cmd', 'commandorcontrol', 'cmdorctrl', 'super', 'meta'], '⌘'],
    [['control', 'ctrl'], '⌃'],
    [['alt', 'option', 'altgr'], '⌥'],
    [['shift'], '⇧'],
  ]) {
    for (const spelling of spellings) {
      const title = spelling[0].toUpperCase() + spelling.slice(1);
      for (const written of [spelling, spelling.toUpperCase(), title]) {
        assert.deepStrictEqual(symbols(`${written}+K`), [cap, 'K'], written);
      }
    }
  }
});

test('symbols: every key the recorder can make shows the same in lower and upper case', () => {
  const codes = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((letter) => `Key${letter}`)
    .concat([...'0123456789'].map((digit) => `Digit${digit}`))
    .concat(Array.from({ length: 24 }, (_, i) => `F${i + 1}`))
    .concat(['Space', 'Enter', 'Tab', 'Backspace', 'Delete', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight',
      'Minus', 'Equal', 'BracketLeft', 'BracketRight', 'Backslash', 'Semicolon', 'Quote', 'Comma', 'Period', 'Slash', 'Backquote']);
  for (const code of codes) {
    const key = keyFor(code);
    const caps = symbols(`Control+Alt+Shift+Command+${key}`);
    assert.deepStrictEqual(caps.slice(0, 4), ['⌃', '⌥', '⇧', '⌘'], code);
    assert.strictEqual(caps.length, 5, code);
    assert.deepStrictEqual(symbols(`control+alt+shift+command+${key.toLowerCase()}`), caps, `${code} in lower case`);
    assert.deepStrictEqual(symbols(`CONTROL+ALT+SHIFT+COMMAND+${key.toUpperCase()}`), caps, `${code} in upper case`);
  }
});

test('symbols: names it has no key cap for are shown as written, and no object property counts as a name it knows', () => {
  assert.deepStrictEqual(symbols('Command+PageUp'), ['⌘', 'PageUp']);
  assert.deepStrictEqual(symbols('Command+constructor'), ['⌘', 'constructor']);
  assert.deepStrictEqual(symbols('Command+toString'), ['⌘', 'toString']);
  assert.deepStrictEqual(symbols('constructor+B'), ['B'], 'a word that is no modifier is no modifier, whatever an object has by that name');
  assert.deepStrictEqual(symbols('__proto__+B'), ['B']);
  assert.deepStrictEqual(symbols('Command+F25'), ['⌘', 'F25'], 'there is no F25');
});
```

Run: `node --test test/shortcut-keys.test.js` — Expected: FAIL (`Cannot find module '../src/renderer/common/shortcut-keys'`).

- [ ] **Step 2: Write the keys module**

Create `src/renderer/common/shortcut-keys.js`:

```js
'use strict';
/* global module */
/* exported ShortcutKeys */

/**
 * Key presses into a shortcut, and a shortcut into key caps. A shortcut is an Electron accelerator
 * ("Shift+Command+B", "Alt+Space"): what Settings saves and the main process registers. The Settings page loads
 * this as a script; the unit tests require it (module.exports at the end).
 */
const ShortcutKeys = (() => {
  // The modifiers in the Mac's order: ⌃ ⌥ ⇧ ⌘.
  const MODIFIERS = [
    { prop: 'ctrlKey', name: 'Control', symbol: '⌃' },
    { prop: 'altKey', name: 'Alt', symbol: '⌥' },
    { prop: 'shiftKey', name: 'Shift', symbol: '⇧' },
    { prop: 'metaKey', name: 'Command', symbol: '⌘' },
  ];
  // Keys that only modify: pressing one of them alone is not a shortcut yet.
  const MODIFIER_CODE = /^(Meta|Control|Alt|Shift)(Left|Right)$|^(OS|CapsLock|Fn|FnLock)/;
  const NAMED = {
    Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  };
  // Electron ignores case in an accelerator ("cmd+shift+b" works), and a shortcut typed into the old Shortcut box is
  // saved as it was typed. So the two tables below are in lower case, and a word is looked up in lower case.
  // How a key looks on its key cap (Enter is another name for Return, Esc for Escape).
  const KEY_SYMBOL = {
    return: '↩', enter: '↩', tab: '⇥', backspace: '⌫', delete: '⌦', up: '↑', down: '↓', left: '←', right: '→',
    escape: 'Esc', esc: 'Esc', space: 'Space',
  };
  // Every spelling Electron takes for a modifier, and the name used for it above (Super and Meta are ⌘ on a Mac).
  const MODIFIER_SPELLING = {
    control: 'Control', ctrl: 'Control',
    alt: 'Alt', option: 'Alt', altgr: 'Alt',
    shift: 'Shift',
    command: 'Command', cmd: 'Command', commandorcontrol: 'Command', cmdorctrl: 'Command', super: 'Command', meta: 'Command',
  };
  // Shortcuts that every app uses, and what they do there (⌘Tab and ⌘Space are the Mac's own). Taken by Buddy, the key
  // would stop doing that in every app.
  const RESERVED = {
    'Command+C': 'Copy', 'Command+V': 'Paste', 'Command+X': 'Cut', 'Command+Z': 'Undo', 'Shift+Command+Z': 'Redo',
    'Command+A': 'Select All', 'Command+Q': 'Quit', 'Command+W': 'Close Window', 'Command+S': 'Save', 'Command+H': 'Hide',
    'Command+M': 'Minimise', 'Command+Tab': 'switching apps', 'Command+Space': 'Spotlight',
  };

  /** The accelerator's name for a key (KeyboardEvent.code), or null for a key a shortcut cannot use. */
  function keyFor(code) {
    const text = String(code || '');
    let m = /^Key([A-Z])$/.exec(text);
    if (m) return m[1];
    m = /^Digit([0-9])$/.exec(text);
    if (m) return m[1];
    m = /^F([1-9]|1[0-9]|2[0-4])$/.exec(text);
    if (m) return `F${m[1]}`;
    return Object.hasOwn(NAMED, text) ? NAMED[text] : null;
  }

  /** The modifier a word of an accelerator stands for ("cmd" -> "Command"), or null when it is none. */
  function modifierNamed(word) {
    const spelling = word.toLowerCase();
    return Object.hasOwn(MODIFIER_SPELLING, spelling) ? MODIFIER_SPELLING[spelling] : null;
  }

  /** How a key looks on its key cap: Return is ↩, f12 is F12, b is B. A key with no cap of its own is left as it was written. */
  function keyCap(key) {
    const spelling = key.toLowerCase();
    if (Object.hasOwn(KEY_SYMBOL, spelling)) return KEY_SYMBOL[spelling];
    const functionKey = /^f([1-9]|1[0-9]|2[0-4])$/.exec(spelling);
    if (functionKey) return `F${functionKey[1]}`;
    return key.length === 1 ? key.toUpperCase() : key;
  }

  /** The key caps for an accelerator, however it is spelled: "Shift+Command+B" and "cmd+shift+b" are both ['⇧', '⌘', 'B']. */
  function symbols(accelerator) {
    const words = String(accelerator || '').split('+').map((w) => w.trim()).filter(Boolean);
    const key = words.pop();
    if (!key) return [];
    const named = words.map(modifierNamed);
    const mods = MODIFIERS.filter((m) => named.includes(m.name)).map((m) => m.symbol);
    return [...mods, keyCap(key)];
  }

  /** The symbols of the modifiers a key event says are held, in the Mac's order. A keyup says what is still held. */
  function heldSymbols(e) {
    return MODIFIERS.filter((m) => e[m.prop]).map((m) => m.symbol);
  }

  /**
   * What a keydown means while a shortcut is being recorded:
   *   { held }                only modifiers so far (their symbols, to show)
   *   { accelerator, keys }   a complete shortcut, ready to save
   *   { refused, held }       a key that cannot make a shortcut this way: why, in plain words
   */
  function fromKeyEvent(e) {
    const mods = MODIFIERS.filter((m) => e[m.prop]);
    const held = heldSymbols(e);
    if (MODIFIER_CODE.test(String(e.code || ''))) return { held };
    const key = keyFor(e.code);
    if (!key) return { refused: "That key can't be part of a shortcut.", held };
    const functionKey = /^F\d+$/.test(key);
    const strong = mods.some((m) => m.name !== 'Shift');
    if (!strong && !functionKey) return { refused: 'Hold ⌘, ⌥ or ⌃ with the key.', held };
    const accelerator = [...mods.map((m) => m.name), key].join('+');
    if (Object.hasOwn(RESERVED, accelerator)) {
      return { refused: `${held.join('')}${key} is used by every app (${RESERVED[accelerator]}). Pick another one.`, held };
    }
    return { accelerator, keys: symbols(accelerator) };
  }

  return { fromKeyEvent, heldSymbols, symbols, keyFor };
})();

if (typeof module !== 'undefined') module.exports = ShortcutKeys;
```

Run: `node --test test/shortcut-keys.test.js` — Expected: PASS. Run `npx eslint src/renderer/common/shortcut-keys.js` — Expected: clean.

- [ ] **Step 3: Write the failing tests for pause/resume, the photo, the version and sections**

In `test/settings-ipc.test.js`:
1. In the fake `account.user()` return `{ uid: 'u1', email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' }` (and the same object from `signIn()`), and pass `version: '0.1.0'` to `registerSettingsIpc`. Keep the result of `registerSettingsIpc(...)` as `ipc` and return it from `setup` too.
2. Update the existing expectations that list the account to include the photo: `{ signedIn: true, email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' }`.
3. Append:

```js
// ---- the shortcut recorder, the profile photo, the version ----

test('shortcut:pause lets go of the global shortcut, so the page hears the keys instead of the panel opening', async () => {
  const s = setup({ buddyOn: true });
  assert.deepStrictEqual(await s.call('shortcut:pause'), { ok: true });
  assert.deepStrictEqual(s.calls, [['unregister']]);
  assert.strictEqual(s.shortcutNow(), null);
});

test('shortcut:resume takes the saved shortcut back while Buddy is on, and only when it is not the one registered', async () => {
  const s = setup({ buddyOn: true, registered: null, stored: { shortcut: 'Shift+Command+B' } });
  assert.deepStrictEqual(await s.call('shortcut:resume'), { ok: true });
  assert.deepStrictEqual(s.calls, [['register', 'Shift+Command+B']]);
  assert.strictEqual(s.shortcutNow(), 'Shift+Command+B');
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, [['register', 'Shift+Command+B']], 'already registered: nothing more');
});

test('shortcut:resume does nothing while Buddy is off; resumeShortcut is also there for the main process', async () => {
  const s = setup({ buddyOn: false, registered: null });
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, []);
  assert.strictEqual(typeof s.ipc.resumeShortcut, 'function');
});

test('saving a new shortcut while paused registers it, and resume then leaves it alone', async () => {
  const s = setup({ buddyOn: true });
  await s.call('shortcut:pause');
  const r = await s.call('settings:set', { shortcut: 'Shift+Command+B' });
  assert.strictEqual(r.ok, true);
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, [['unregister'], ['register', 'Shift+Command+B']]);
  assert.strictEqual(s.shortcutNow(), 'Shift+Command+B');
});

test('a shortcut that is taken while paused is refused, and resume puts the old one back', async () => {
  const s = setup({ buddyOn: true, taken: ['Command+Space'] });
  await s.call('shortcut:pause');
  const r = await s.call('settings:set', { shortcut: 'Command+Space' });
  assert.strictEqual(r.error.code, 'shortcut_taken');
  await s.call('shortcut:resume');
  assert.strictEqual(s.shortcutNow(), 'Alt+Space');
  assert.strictEqual(s.store.get('shortcut'), 'Alt+Space');
});

test("the snapshot carries the person's photo and the app's version", async () => {
  const r = await setup().call('settings:get');
  assert.strictEqual(r.account.photo, 'https://lh3.googleusercontent.com/a/rahul');
  assert.strictEqual(r.version, '0.1.0');
  assert.deepStrictEqual((await setup({ signedIn: false }).call('settings:get')).account, { signedIn: false });
});
```

In `test/settings-windows.test.js`: give `FakeWindow` an `on(event, fn)` that records handlers (`this.handlers[event] = fn`, with `this.handlers = {}` in the constructor), a `webContents.send` that records `[channel, ...args]` into `this.sent` (array), and make `loadFile(file, options)` record `this.loadOptions = options`. Append:

```js
test('Settings can open on a section: a new window loads with it in the hash, an open one is told', () => {
  const { windows, created } = setup();
  const win = windows.open('settings', { section: 'ai' });
  assert.deepStrictEqual(win.loadOptions, { hash: 'ai' });
  windows.open('settings', { section: 'shortcut' });
  assert.deepStrictEqual(win.sent, [['settings:section', 'shortcut']]);
  windows.open('settings');
  assert.deepStrictEqual(win.sent, [['settings:section', 'shortcut']], 'no section, nothing sent');
  assert.strictEqual(created.length, 1);
  const plain = setup().windows.open('onboarding');
  assert.strictEqual(plain.loadOptions, undefined);
});

test('onClosed hears which kind of window closed', () => {
  const { windows } = setup();
  const heard = [];
  windows.onClosed((kind) => heard.push(kind));
  const win = windows.open('settings');
  win.handlers.closed();
  assert.deepStrictEqual(heard, ['settings']);
});
```

In `test/panel-ipc.test.js`: make the fake `openSettings: (section) => calls.push(['openSettings', section])` (update the existing expectation that recorded `'openSettings'` to `['openSettings', undefined]`), and append:

```js
test("Open Settings goes to the AI section for a key, model or free-mode problem, and to the start otherwise", () => {
  for (const [code, section] of [
    ['no_key', 'ai'], ['bad_key', 'ai'], ['no_credit', 'ai'], ['bad_model', 'ai'], ['no_vision', 'ai'], ['need_key', 'ai'],
    ['free_off', 'ai'], ['signed_out', undefined], ['not_set_up', undefined], [undefined, undefined], ['constructor', undefined], [7, undefined],
  ]) {
    const s = setup();
    s.listeners['panel:open-settings'](s.fromPanel, code);
    assert.deepStrictEqual(s.calls, ['hide', ['openSettings', section]], String(code));
  }
});
```

In `test/google-signin.test.js`: add `photoUrl: 'https://lh3.googleusercontent.com/a/photo'` to `FIREBASE_ANSWER`; the whole-sign-in test now expects `photo: 'https://lh3.googleusercontent.com/a/photo'` in the result. Append:

```js
test('the photo is kept only when it is an https address', async () => {
  for (const [photoUrl, photo] of [['http://example.com/p.jpg', ''], ['javascript:alert(1)', ''], [undefined, ''], [42, '']]) {
    const fetchImpl = googleFetch({
      [GOOGLE_TOKEN]: { body: { id_token: 'google-id' } },
      [FIREBASE_IDP]: { body: { ...FIREBASE_ANSWER, photoUrl } },
    });
    const r = await signInWithGoogle({ config: CONFIG, openBrowser: browserThatSignsIn(), fetchImpl });
    assert.strictEqual(r.photo, photo, String(photoUrl));
  }
});
```

In `test/account.test.js`: add `photo: 'https://lh3.googleusercontent.com/a/photo'` to `SIGNED_IN`; every expectation of `user()` / `signIn()` gains that `photo` (and the second account in the "Sign in again" test `photo: ''` when its answer has none); the account.json expectation gains `photo`. Append:

```js
test('an account kept before photos were stored answers an empty photo', (t) => {
  const s = setup(t);
  fs.writeFileSync(s.file, JSON.stringify({ uid: 'u', email: 'e@x.com', name: 'E', refreshToken: Buffer.from('enc:r').toString('base64') }));
  assert.deepStrictEqual(setup(t, { file: s.file }).account.user(), { uid: 'u', email: 'e@x.com', name: 'E', photo: '' });
});
```

Run: `node --test test/settings-ipc.test.js test/settings-windows.test.js test/panel-ipc.test.js test/google-signin.test.js test/account.test.js` — Expected: the new tests FAIL (no handler `shortcut:pause`, no photo, no section).

- [ ] **Step 4: Implement**

`src/main/ipc/settings.js`:
- Add `version` to the destructured deps.
- In `snapshot()`, the account becomes `user ? { signedIn: true, email: user.email, name: user.name, photo: user.photo || '' } : { signedIn: false }`, and add `version,` after `canSignIn,`.
- After the `onboarding:finish` handler add:

```js
  /** The saved shortcut, registered again while Buddy is on (after a recording, or when Settings closes). */
  function resumeShortcut() {
    const saved = store.get('shortcut');
    if (power.isOn() && shortcut.current() !== saved) shortcut.register(saved);
  }

  // While the Settings page records a new shortcut, Buddy lets go of its own, so that pressing the current one is
  // heard by the page instead of opening the panel.
  handle('shortcut:pause', () => {
    shortcut.unregister();
    return {};
  });

  handle('shortcut:resume', () => {
    resumeShortcut();
    return {};
  });

  return { resumeShortcut };
```

`src/main/settings-windows.js`:
- Change the first comment's first line to `/** The Settings, Welcome and Admin windows: ordinary windows, at most one of each. Settings can open on a section. */`.
- `KINDS.settings` becomes `{ title: 'Buddy Settings', width: 760, height: 560, preload: 'settings.js' }`.
- Add `const listeners = [];` after `const windows = {};`.
- `open(kind)` becomes `open(kind, { section } = {})`. In the "already open" branch, after `windows[kind].focus();` add `if (section) windows[kind].webContents.send('settings:section', section);`. For a new window, load with `win.loadFile(path.join(__dirname, '..', 'renderer', kind, 'index.html'), section ? { hash: section } : undefined)` (same `.catch`), and after creating it add `win.on('closed', () => { for (const fn of listeners) fn(kind); });`.
- Add to the returned object: `/** fn(kind) runs after a window of that kind closes. */ onClosed(fn) { listeners.push(fn); },`.

`src/main/ipc/panel.js`:

```js
// Errors whose fix is in the AI section of Settings: a key, a model, or free mode.
const AI_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'need_key', 'free_off'];
const sectionFor = (code) => (AI_ERRORS.includes(code) ? 'ai' : undefined);
```

and the `panel:open-settings` listener becomes `(event, code) => { if (!fromPanel(event.sender)) return; panel.hide(); openSettings(sectionFor(code)); }`.

`src/preload/panel.js`: `openSettings: (code) => ipcRenderer.send('panel:open-settings', typeof code === 'string' ? code : undefined),`.

`src/renderer/panel/panel.js`: keep the shown error's code in a module variable (`let errorCode = null;`, set in `showError(message, code)` to `code || null`, cleared when the message is cleared); the `error-settings` button calls `window.buddy.openSettings(errorCode)`; the gear button keeps `window.buddy.openSettings()`.

`src/preload/settings.js`: add `pauseShortcut: () => ipcRenderer.invoke('shortcut:pause'),`, `resumeShortcut: () => ipcRenderer.invoke('shortcut:resume'),`, `onSection: (fn) => ipcRenderer.on('settings:section', (_event, name) => fn(name)),`.

`src/main/google-signin.js`: in `firebaseSignIn`'s answer add `photo: typeof body.photoUrl === 'string' && /^https:\/\//.test(body.photoUrl) ? body.photoUrl : '',`.

`src/main/account.js`: `keep(user, refreshToken)` stores `photo: typeof user.photo === 'string' ? user.photo : ''` (between `name` and `refreshToken`); `user()` answers `{ uid: saved.uid, email: saved.email, name: saved.name, photo: typeof saved.photo === 'string' ? saved.photo : '' }`. `read()` is unchanged (a file without a photo is still an account).

`src/main/main.js`:
- `const openSettings = (section) => windows.open('settings', section ? { section } : undefined);`
- `app.on('second-instance', () => openSettings());` (Electron passes the event first; it must not become a section).
- Keep the result: `const settingsIpc = registerSettingsIpc({ …, version: app.getVersion(), … });` then `windows.onClosed((kind) => { if (kind === 'settings') settingsIpc.resumeShortcut(); });` — a recording cut short by closing Settings gives the shortcut back.

`test/e2e/smoke.js`: the fake account's `user()` answers `{ uid: 'e2e-user', email: 'e2e@example.com', name: 'E2E Tester', photo: '' }`.

Run the five focused files — Expected: PASS. Run `npm test` — Expected: lint clean, all pass. Run `npm run test:e2e` — Expected: all checks ok (the pages are unchanged in this task; 40-panel still sees `['settings']` opened).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/common/shortcut-keys.js test/shortcut-keys.test.js src/main/ipc/settings.js src/main/settings-windows.js \
  src/main/ipc/panel.js src/main/google-signin.js src/main/account.js src/main/main.js src/preload/settings.js src/preload/panel.js \
  src/renderer/panel/panel.js test/settings-ipc.test.js test/settings-windows.test.js test/panel-ipc.test.js \
  test/google-signin.test.js test/account.test.js test/e2e/smoke.js
git commit -m "feat: keys become shortcuts, the shortcut pauses while recording, the profile photo, and Settings opens on a section"
```

---

### Task 2: The new Settings window and the shared design system

**Files:**
- Rewrite: `src/renderer/common/base.css`
- Rewrite: `src/renderer/settings/index.html`, `src/renderer/settings/settings.js`; Create: `src/renderer/settings/settings.css`
- Modify: `src/renderer/common/ai-form.js` only if a class name must change to fit the new style (ids stay)
- Modify: `test/e2e/checks/30-settings.js`, `test/e2e/checks/40-panel.js`, `test/e2e/checks/70-account.js`

**Interfaces:** consumes Task 1 (`ShortcutKeys`, `pauseShortcut`, `resumeShortcut`, `onSection`, `account.photo`, `version`). Produces the shared classes Task 3 uses (below).

**The design system (`base.css`)** — write it as a clean macOS-style system, with these tokens and pieces (names are the contract Task 3 relies on; the visual details are yours, checked by screenshots):

- Tokens on `:root` (light) and under `@media (prefers-color-scheme: dark)`: `--bg`, `--sidebar`, `--card`, `--fg`, `--muted`, `--line`, `--line-soft`, `--accent` (`#1f7a70` / `#5ad1c3`), `--accent-fg`, `--accent-soft`, `--good`, `--good-soft`, `--error`, `--error-soft`, `--radius` (10px), `--radius-sm` (7px), `--shadow`, `--focus-ring`. Font: `-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", sans-serif`, 13px/1.45; headings semibold.
- Keep working everything the pages use today: `[hidden] { display: none !important; }`, `.row`, `.spacer`, `.grow`, `.muted`, `.good`, `.error`, `.card`, `.buddies`, `.buddy-card`, `.ai-choices`, `.ai-choice`, inputs/selects/textareas, `label`, `button` and `button.primary`, `footer`.
- New pieces: `.btn` (default), `.btn.primary`, `.btn.quiet` (text-like), `.btn.small`, `.btn.block` (full width); `.switch` (an `input[type=checkbox]` drawn as a Mac toggle); `.segmented` (a radio group drawn as a segmented control: `label > input[type=radio] + span`); `.badge`, `.badge.good`, `.badge.off`; `.group` with `.group-row` children (a rounded panel of rows separated by hairlines, each row: content left, control right), `.row-title`; `kbd` (a key cap); `.avatar` (round, initials centred, an `img` filling it); `.note` (a soft accent-tinted info box); `.small`; `.lead` (a muted intro line under a title); `.status` (a status line; with `.good` / `.error`).
- Focus is always visible (`:focus-visible` uses `--focus-ring`), hit targets at least 28px tall, transitions ≤ 150 ms.

**`src/renderer/settings/index.html`** — exactly this structure (classes may be added for styling; ids and the order of sections stay):

```html
<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; img-src 'self' https://*.googleusercontent.com; style-src 'self'; script-src 'self'">
  <title>Buddy Settings</title>
  <link rel="stylesheet" href="../common/base.css">
  <link rel="stylesheet" href="settings.css">
</head>
<body class="settings">
<div class="layout">
  <aside class="sidebar">
    <div class="profile">
      <div id="avatar" class="avatar" aria-hidden="true">
        <img id="avatar-img" alt="" referrerpolicy="no-referrer" hidden>
        <span id="avatar-initials"></span>
      </div>
      <div class="who">
        <p id="profile-name" class="who-name"></p>
        <p id="profile-email" class="who-email"></p>
      </div>
    </div>
    <nav class="nav" aria-label="Settings sections">
      <button type="button" class="nav-item" data-section="buddy">Buddy</button>
      <button type="button" class="nav-item" data-section="shortcut">Shortcut</button>
      <button type="button" class="nav-item" data-section="ai">AI</button>
      <button type="button" class="nav-item" data-section="permissions">Permissions</button>
      <button type="button" class="nav-item" data-section="general">General</button>
    </nav>
    <div class="sidebar-foot">
      <button id="sign-in" class="btn primary block" type="button" hidden>Sign in with Google</button>
      <button id="sign-out" class="btn block" type="button" hidden>Sign out</button>
      <p id="account-status" class="status small"></p>
    </div>
  </aside>
  <main class="content">
    <section id="section-buddy" class="section">
      <h1>Buddy</h1>
      <div id="buddies" class="buddies"></div>
      <p id="buddy-status" class="status small"></p>
      <div class="group">
        <div class="group-row">
          <label for="name" class="row-title">Name</label>
          <input id="name" type="text" maxlength="24">
        </div>
        <div class="group-row">
          <span id="size-label" class="row-title">Size</span>
          <div id="size" class="segmented" role="radiogroup" aria-labelledby="size-label">
            <label><input type="radio" name="size" value="small"><span>Small</span></label>
            <label><input type="radio" name="size" value="medium"><span>Medium</span></label>
            <label><input type="radio" name="size" value="large"><span>Large</span></label>
          </div>
        </div>
      </div>
      <p id="name-status" class="status small"></p>
      <p id="size-status" class="status small"></p>
    </section>
    <section id="section-shortcut" class="section" hidden>
      <h1>Shortcut</h1>
      <p class="lead">Press it in any app to open your buddy.</p>
      <button id="shortcut" class="recorder" type="button" aria-describedby="shortcut-hint">
        <span id="shortcut-keys" class="keys"></span>
      </button>
      <p id="shortcut-hint" class="muted small">Click the box, then press the keys you want. Esc cancels.</p>
      <div class="row">
        <span id="shortcut-status" class="status small"></span>
        <span class="spacer"></span>
        <button id="shortcut-reset" class="btn quiet small" type="button">Reset to ⌥ Space</button>
      </div>
    </section>
    <section id="section-ai" class="section" hidden>
      <h1>AI</h1>
      <p id="ai-note" class="note" hidden></p>
      <div id="ai"></div>
    </section>
    <section id="section-permissions" class="section" hidden>
      <h1>Permissions</h1>
      <div class="group">
        <div class="group-row">
          <div class="grow">
            <p class="row-title">Accessibility</p>
            <p class="muted small">Read the text you select, and paste answers.</p>
          </div>
          <span id="perm-accessibility" class="badge"></span>
          <button id="perm-accessibility-btn" class="btn small" type="button">Allow</button>
        </div>
        <div class="group-row">
          <div class="grow">
            <p class="row-title">Screen Recording</p>
            <p class="muted small">See the window you're in, for Check screen.</p>
          </div>
          <span id="perm-screenRecording" class="badge"></span>
          <button id="perm-screenRecording-btn" class="btn small" type="button">Allow</button>
        </div>
      </div>
      <p id="perm-status" class="status small"></p>
    </section>
    <section id="section-general" class="section" hidden>
      <h1>General</h1>
      <div class="group">
        <div class="group-row">
          <div class="grow">
            <p class="row-title">Always on</p>
            <p id="power-status" class="muted small"></p>
          </div>
          <input id="power" class="switch" type="checkbox" role="switch" aria-label="Always on">
        </div>
        <div class="group-row">
          <p class="grow row-title">Version</p>
          <span id="version" class="muted"></span>
        </div>
      </div>
    </section>
  </main>
</div>
<script src="../common/buddy-grid.js"></script>
<script src="../common/ai-form.js"></script>
<script src="../common/shortcut-keys.js"></script>
<script src="settings.js"></script>
</body>
</html>
```

**`src/renderer/settings/settings.css`** — the layout: `body.settings` fills the window (no page scroll); `.layout` is a two-column grid (sidebar ~220px, content the rest); `.sidebar` uses `--sidebar`, a hairline on its right, the profile at the top (avatar 40px; name semibold, ellipsis; email muted small, ellipsis), the nav items as full-width rows with an icon drawn in CSS (or an inline SVG mask) and a rounded accent-soft highlight for `.active`, the foot pinned to the bottom; `.content` scrolls by itself, with comfortable padding and `h1` at ~20px; `.recorder` is a large rounded box (min-height ~56px) showing `kbd` caps centred, with an accent border and a soft pulse while `.recording`; the AI form inside `#ai` fits the content width. The nav items get simple icons (buddy: a face/robot, shortcut: a keyboard, AI: a sparkle, permissions: a lock/shield, general: a gear).

**`src/renderer/settings/settings.js`** — exactly this behaviour:

```js
'use strict';
/* global mountAiForm, renderBuddyGrid, ShortcutKeys */

const $ = (id) => document.getElementById(id);
const SECTIONS = ['buddy', 'shortcut', 'ai', 'permissions', 'general'];
const DEFAULT_SHORTCUT = 'Alt+Space';
let snap = null;
let gridBuilt = false;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one
let recording = false; // the Shortcut box is waiting for keys

function showStatus(id, text, kind = 'muted') {
  $(id).textContent = text;
  $(id).className = `status small ${kind}`;
}

/** Shown in place of the page when its settings cannot be loaded. */
function showLoadError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('.content').replaceChildren(p);
}

// ---- sections ----

function showSection(name) {
  const section = SECTIONS.includes(name) ? name : 'buddy';
  if (recording && section !== 'shortcut') stopRecording();
  for (const s of SECTIONS) {
    $(`section-${s}`).hidden = s !== section;
    const item = document.querySelector(`.nav-item[data-section="${s}"]`);
    item.classList.toggle('active', s === section);
    if (s === section) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

const navItems = [...document.querySelectorAll('.nav-item')];
for (const item of navItems) {
  item.addEventListener('click', () => showSection(item.dataset.section));
  item.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = navItems[(navItems.indexOf(item) + (e.key === 'ArrowDown' ? 1 : navItems.length - 1)) % navItems.length];
    next.focus();
    showSection(next.dataset.section);
  });
}
window.buddy.onSection((name) => showSection(name));

// ---- the profile ----

function initials(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [String(email || '').charAt(0)];
  return letters.join('').toUpperCase();
}

function showPhoto(url) {
  const img = $('avatar-img');
  if (!url) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  if (img.getAttribute('src') !== url) {
    img.hidden = true; // shown once it has loaded; the initials stay underneath until then, and if it fails
    img.src = url;
  }
}
$('avatar-img').addEventListener('load', () => { $('avatar-img').hidden = false; });
$('avatar-img').addEventListener('error', () => { $('avatar-img').hidden = true; });

function renderAccount() {
  const { account, canSignIn } = snap;
  if (account.signedIn) {
    $('profile-name').textContent = account.name || account.email;
    $('profile-email').textContent = account.name ? account.email : '';
    $('avatar-initials').textContent = initials(account.name, account.email);
    showPhoto(account.photo);
  } else {
    $('profile-name').textContent = 'Not signed in';
    $('profile-email').textContent = canSignIn ? 'Sign in with Google to use your buddy.' : "This copy of Buddy isn't set up for sign-in.";
    $('avatar-initials').textContent = '';
    showPhoto('');
  }
  $('sign-in').hidden = account.signedIn || !canSignIn;
  $('sign-out').hidden = !account.signedIn;
}

// ---- the rest of the page ----

function renderAi() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
  $('ai').hidden = !snap.ai.showForm;
}

function showKeys(accelerator) {
  $('shortcut-keys').replaceChildren(
    ...ShortcutKeys.symbols(accelerator).map((k) => Object.assign(document.createElement('kbd'), { textContent: k })),
  );
}

/** Show `snap`. With `fields: false` the text boxes are left alone: a refresh must not throw away what is being typed. */
function render({ fields = true } = {}) {
  renderAccount();
  renderAi();
  if (gridBuilt) {
    // Only move the check: rebuilding the radio buttons would drop the keyboard focus that is on one of them.
    for (const radio of $('buddies').querySelectorAll('input')) radio.checked = radio.value === snap.settings.buddyId;
  } else {
    renderBuddyGrid($('buddies'), snap.characters, snap.settings.buddyId, (c) => save({ buddyId: c.id }, 'buddy-status'));
    gridBuilt = true;
  }
  if (fields) $('name').value = snap.settings.buddyName;
  for (const radio of $('size').querySelectorAll('input')) radio.checked = radio.value === snap.settings.size;
  if (!recording) showKeys(snap.settings.shortcut);
  $('power').checked = snap.buddyOn;
  $('power-status').textContent = snap.buddyOn
    ? 'Your buddy is on, and comes back every time your Mac starts.'
    : 'Your buddy is off.';
  $('version').textContent = snap.version ? `Buddy ${snap.version}` : '';
}

/** Save a change and say next to its field how it went. Then show what is saved, so a refused change puts the field back. */
async function save(patch, statusId) {
  const r = await window.buddy.set(patch);
  showStatus(statusId, r.ok ? 'Saved ✓' : r.error.message, r.ok ? 'good' : 'error');
  if (r.ok) snap = r;
  render();
}

async function renderPermissions() {
  const r = await window.buddy.permissions();
  for (const which of ['accessibility', 'screenRecording']) {
    const granted = Boolean(r.ok && r[which]);
    $(`perm-${which}`).textContent = granted ? 'Allowed' : 'Not allowed';
    $(`perm-${which}`).className = `badge ${granted ? 'good' : 'off'}`;
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

// ---- the shortcut recorder ----

async function startRecording() {
  if (recording) return;
  recording = true;
  $('shortcut').classList.add('recording');
  $('shortcut-keys').textContent = 'Press your shortcut…';
  showStatus('shortcut-status', '');
  await window.buddy.pauseShortcut();
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(snap.settings.shortcut);
  await window.buddy.resumeShortcut();
}

async function saveShortcut(accelerator) {
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(accelerator);
  const r = await window.buddy.set({ shortcut: accelerator });
  if (r.ok) {
    snap = r;
    showStatus('shortcut-status', 'Saved ✓', 'good');
  } else {
    showKeys(snap.settings.shortcut);
    const keys = ShortcutKeys.symbols(accelerator).join(' ');
    showStatus('shortcut-status', r.error.code === 'shortcut_taken' ? `${keys} is taken. Try another one.` : r.error.message, 'error');
  }
  await window.buddy.resumeShortcut(); // the saved shortcut is registered again (the new one, or the old one if refused)
}

$('shortcut').addEventListener('click', (e) => {
  if (!recording) startRecording();
  else if (e.detail > 0) stopRecording(); // a mouse click ends it; Return or Space while recording is a key to record
});
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
    stopRecording();
    return;
  }
  const r = ShortcutKeys.fromKeyEvent(e);
  if (r.accelerator) {
    saveShortcut(r.accelerator);
    return;
  }
  $('shortcut-keys').textContent = r.held.length ? `${r.held.join(' ')} …` : 'Press your shortcut…';
  if (r.refused) showStatus('shortcut-status', r.refused, 'error');
}, true);
$('shortcut-reset').addEventListener('click', () => saveShortcut(DEFAULT_SHORTCUT));
window.addEventListener('blur', () => { stopRecording(); });

// ---- account, buddy, power, permissions ----

$('sign-in').addEventListener('click', async () => {
  showStatus('account-status', 'Finish signing in in your browser…');
  signingIn += 1;
  let r;
  try {
    r = await window.buddy.signIn();
  } finally {
    signingIn -= 1;
  }
  if (r.ok) {
    snap = r;
    render({ fields: false });
    showStatus('account-status', 'Signed in ✓', 'good');
  } else if (r.error.code !== 'sign_in_cancelled') {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    showStatus('account-status', r.error.message, 'error');
  }
});
$('sign-out').addEventListener('click', async () => {
  const r = await window.buddy.signOut();
  if (!r.ok) {
    showStatus('account-status', r.error.message, 'error');
    return;
  }
  snap = r;
  render({ fields: false });
  showStatus('account-status', 'Signed out.');
});
$('name').addEventListener('change', () => save({ buddyName: $('name').value }, 'name-status'));
for (const radio of $('size').querySelectorAll('input')) {
  radio.addEventListener('change', () => save({ size: radio.value }, 'size-status'));
}
$('power').addEventListener('change', async () => {
  const want = $('power').checked;
  const r = await window.buddy.setBuddyOn(want);
  if (r.ok) {
    snap = r;
    render({ fields: false });
  } else {
    $('power').checked = !want;
    $('power-status').textContent = r.error.message;
  }
});
for (const which of ['accessibility', 'screenRecording']) {
  $(`perm-${which}-btn`).addEventListener('click', async () => {
    const asked = await window.buddy.requestPermission(which);
    const opened = await window.buddy.openPermissionSettings(which);
    const failed = [asked, opened].find((r) => !r.ok);
    showStatus('perm-status', failed ? failed.error.message : '', failed ? 'error' : 'muted');
  });
}
// Coming back to this window: System Settings may have changed the permissions, and the account may have changed
// behind this page's back. Show what changed; what is being typed stays, and a waiting sign-in answers by itself.
window.addEventListener('focus', async () => {
  renderPermissions();
  if (signingIn || !snap?.ok) return;
  const fresh = await window.buddy.get();
  if (signingIn || !fresh.ok) return;
  const changed = fresh.account.signedIn !== snap.account.signedIn;
  snap = fresh;
  render({ fields: false });
  if (changed) showStatus('account-status', '');
});

(async () => {
  showSection(location.hash.slice(1));
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
  // The admin may have changed free mode since the app last asked; what is typed meanwhile stays.
  const fresh = await window.buddy.refresh();
  if (fresh.ok) {
    snap = fresh;
    render({ fields: false });
  }
})();
```

- [ ] **Step 1: Update the e2e checks first (they fail against the old page)**

- `30-settings.js`: wait for `document.querySelector('#size input:checked')?.value === 'medium'` instead of `#size`'s value. Append after the size and permission steps (before closing the window):
  - Sections: clicking `.nav-item[data-section="shortcut"]` shows `#section-shortcut` and hides `#section-buddy`; the clicked item has class `active`.
  - The recorder: click `#shortcut` → `#shortcut` has class `recording` and the fake `ctx.globalShortcut.registered` is empty (paused); dispatch `new KeyboardEvent('keydown', { code: 'KeyB', key: 'B', metaKey: true, shiftKey: true, bubbles: true })` on `document` → wait until `ctx.store.get('shortcut') === 'Shift+Command+B'`; `#shortcut-keys` text is `⇧⌘B`; `[...ctx.globalShortcut.registered.keys()]` is `['Shift+Command+B']`; `#shortcut-status` says `Saved ✓`.
  - Esc cancels: click `#shortcut`, dispatch an Escape keydown → the saved shortcut is unchanged and registered again.
  - Reset: click `#shortcut-reset` → the store says `Alt+Space` and it is registered. (Leave it `Alt+Space`.)
  - General: `#power` is a checked switch; `#version` text starts with `Buddy `.
- `40-panel.js`: after the error-settings click opens Settings (existing step), also wait until that Settings window's `#section-ai` is visible (`!document.getElementById('section-ai').hidden`) — the panel's `bad_key` error opens Settings on AI.
- `70-account.js`: replace `account-line` with the profile: signed in → `#profile-name` is `E2E Tester` and `#profile-email` is `e2e@example.com`, `#avatar-initials` is `ET`, `#avatar-img` hidden (the fake has no photo); signed out → `#profile-name` is `Not signed in`; the "loaded" marker becomes `document.getElementById('profile-name').textContent !== ''`. Keep every other assertion (sign-in/sign-out buttons, AI card states, panel errors, Welcome).

Run `npm run test:e2e` — Expected: 30/40/70 FAIL against the old page.

- [ ] **Step 2: Write `base.css`, the Settings page (HTML, JS above, CSS) — keep the other pages working on the new `base.css`**

Check the other pages still render sensibly with the new `base.css` (they are restyled properly in Task 3; here they must simply not break).

- [ ] **Step 3: Look at it**

Capture the Settings window in light and dark mode on every section (signed in with the fake account; signed out once) — for example from a small script that starts the app the way `test/e2e/smoke.js` does and calls `win.webContents.capturePage()`, writing PNGs to `test/e2e/out/` (ignored by git), with `nativeTheme.themeSource = 'light' | 'dark'`. Fix what doesn't look professional: alignment, spacing, contrast (text ≥ 4.5:1), truncation of long names/emails, the recorder's states. Include the screenshot paths in the report.

- [ ] **Step 4: Run everything**

`npm test` (lint clean, all pass) and `npm run test:e2e` (all checks ok).

- [ ] **Step 5: Commit**

```bash
git add src/renderer/common/base.css src/renderer/settings test/e2e/checks/30-settings.js test/e2e/checks/40-panel.js test/e2e/checks/70-account.js
git commit -m "feat(settings): a sidebar with your profile and Sign out, a shortcut you press instead of type, and a cleaner look"
```

(Add `src/renderer/common/ai-form.js` to the commit only if it changed.)

---

### Task 3: The same look for Welcome, Admin and the panel

**Files:**
- Modify: `src/renderer/onboarding/index.html`, `src/renderer/onboarding/onboarding.js` (the step dots only)
- Modify: `src/renderer/admin/index.html`, `src/renderer/admin/admin.css`
- Modify: `src/renderer/panel/index.html`, `src/renderer/panel/panel.css`
- Test: the e2e checks that touch these pages must keep passing unchanged (35, 40, 70, 75)

**Interfaces:** consumes Task 2's `base.css` classes (`.btn`, `.btn.primary`, `.btn.quiet`, `.switch`, `.segmented`, `.badge`, `.group`, `.group-row`, `.row-title`, `.note`, `.lead`, `.status`, `kbd`, tokens). All ids stay.

- [ ] **Step 1: Welcome** — a centred, airy layout on `--bg` with the steps in a card; a step indicator above the current step: an `<ol id="steps" class="steps" aria-label="Steps">` that `go(n)` fills with one `<li>` per step in `steps` (`class="done"` before `n`, `class="current"` at `n`, plain after), as dots with the current one elongated in the accent colour:

```js
function renderSteps(n) {
  $('steps').replaceChildren(...steps.map((name, i) => {
    const li = document.createElement('li');
    li.className = i < n ? 'done' : (i === n ? 'current' : '');
    li.setAttribute('aria-label', `Step ${i + 1} of ${steps.length}`);
    if (i === n) li.setAttribute('aria-current', 'step');
    return li;
  }));
}
```

(call `renderSteps(n)` at the end of `go(n)`, and put `<ol id="steps" class="steps" aria-label="Steps"></ol>` at the top of `<main>`). Buttons become `.btn` / `.btn.primary`; the sign-in step's button is large; the AI step's `#ai-note` uses `.note`.

- [ ] **Step 2: Admin** — the Free AI card's switches as `.group` rows (Free mode as a `.switch` row; Unlimited / Daily limit as a `.segmented` control or radio rows; the daily box and "own key" as indented rows), Provider and Model as rows, Save as `.btn.primary`; the users table with `--line-soft` row separators, a muted header, right-aligned "Today", and `.btn.small` Block/Unblock buttons; the "No AI key…" message as a `.note` in the error tint. Every id and the `input[name="limitMode"]` radios stay (75-admin uses them).

- [ ] **Step 3: Panel** — the shared tokens and buttons; the three tabs drawn as a `.segmented`-style control (keep the `nav.tabs > button[data-tab]` elements and the `.active` class the script toggles); primary actions `.btn.primary`; the error line uses the error tint with the "Open Settings" button as `.btn.small`. Layout, size and every id stay.

- [ ] **Step 4: Look at it** — capture Welcome (each step), Admin (with the fake server's data) and the panel (each tab, with an answer and with an error) in light and dark mode; fix what doesn't look professional; list the screenshots in the report.

- [ ] **Step 5: Run everything and commit**

`npm test` and `npm run test:e2e` — all pass.

```bash
git add src/renderer/onboarding src/renderer/admin src/renderer/panel
git commit -m "feat(ui): the Welcome, the Admin window and the panel share Settings' look"
```
