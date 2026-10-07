'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fromKeyEvent, heldSymbols, symbols, keyFor, isTap, tapKeys, tapValue } = require('../src/renderer/common/shortcut-keys');

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

// ---- Windows: Ctrl, Alt and Shift by name; the Windows key and Ctrl+Alt (AltGr) are Windows' own ----

const ShortcutKeys = require('../src/renderer/common/shortcut-keys');
const win = ShortcutKeys.forPlatform('win32');
const mac = ShortcutKeys.forPlatform('darwin');

test('forPlatform: the Mac set is the one the module gives by default, and each set has its default shortcut', () => {
  assert.deepStrictEqual(mac.symbols('Shift+Command+B'), symbols('Shift+Command+B'));
  assert.deepStrictEqual(fromKeyEvent(ev('KeyB', { metaKey: true })), mac.fromKeyEvent(ev('KeyB', { metaKey: true })));
  assert.strictEqual(mac.defaultShortcut, 'Alt+Space');
  assert.strictEqual(win.defaultShortcut, 'Ctrl+Shift+Space', 'the same spelling as platform.js, so a reset saves what a new install has');
  assert.strictEqual(ShortcutKeys.forPlatform(undefined).defaultShortcut, 'Alt+Space', 'not known yet: the Mac set');
});

test('on Windows a key with Ctrl or Alt is a shortcut, with key caps that say Ctrl, Alt and Shift', () => {
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyB', { ctrlKey: true, shiftKey: true })), { accelerator: 'Control+Shift+B', keys: ['Ctrl', 'Shift', 'B'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('Space', { ctrlKey: true, shiftKey: true })), { accelerator: 'Control+Shift+Space', keys: ['Ctrl', 'Shift', 'Space'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyK', { altKey: true, shiftKey: true })), { accelerator: 'Alt+Shift+K', keys: ['Alt', 'Shift', 'K'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('Enter', { ctrlKey: true })), { accelerator: 'Control+Return', keys: ['Ctrl', 'Enter'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('F9')), { accelerator: 'F9', keys: ['F9'] });
});

test('on Windows the modifiers held show by name, and a key needs Ctrl or Alt', () => {
  assert.deepStrictEqual(win.fromKeyEvent(ev('ControlLeft', { ctrlKey: true })), { held: ['Ctrl'] });
  assert.deepStrictEqual(win.heldSymbols(ev('ShiftLeft', { ctrlKey: true, shiftKey: true })), ['Ctrl', 'Shift']);
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyA', { shiftKey: true })), { refused: 'Hold Ctrl or Alt with the key.', held: ['Shift'] });
});

test('on Windows the Windows key and Ctrl+Alt are refused: Windows uses the one, and the other is AltGr on many keyboards', () => {
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyB', { metaKey: true })),
    { refused: 'Shortcuts with the Windows key belong to Windows. Use Ctrl or Alt.', held: ['Win'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyB', { ctrlKey: true, altKey: true })),
    { refused: 'Ctrl+Alt types letters on many keyboards (it is AltGr). Try Ctrl+Shift.', held: ['Ctrl', 'Alt'] });
  assert.deepStrictEqual(win.fromKeyEvent(ev('KeyB', { ctrlKey: true, altKey: true, shiftKey: true })).refused,
    'Ctrl+Alt types letters on many keyboards (it is AltGr). Try Ctrl+Shift.');
});

test("on Windows the shortcuts every app uses are refused, each named for what it does, and Alt+Space is the window's menu", () => {
  for (const [code, mods, message] of [
    ['KeyC', { ctrlKey: true }, 'Ctrl+C is used by every app (Copy). Pick another one.'],
    ['KeyV', { ctrlKey: true }, 'Ctrl+V is used by every app (Paste). Pick another one.'],
    ['KeyX', { ctrlKey: true }, 'Ctrl+X is used by every app (Cut). Pick another one.'],
    ['KeyZ', { ctrlKey: true }, 'Ctrl+Z is used by every app (Undo). Pick another one.'],
    ['KeyY', { ctrlKey: true }, 'Ctrl+Y is used by every app (Redo). Pick another one.'],
    ['KeyA', { ctrlKey: true }, 'Ctrl+A is used by every app (Select All). Pick another one.'],
    ['KeyS', { ctrlKey: true }, 'Ctrl+S is used by every app (Save). Pick another one.'],
    ['KeyW', { ctrlKey: true }, 'Ctrl+W is used by every app (Close). Pick another one.'],
    ['F4', { ctrlKey: true }, 'Ctrl+F4 is used by every app (Close). Pick another one.'],
    ['F4', { altKey: true }, 'Alt+F4 is used by every app (Close Window). Pick another one.'],
    ['Tab', { altKey: true }, 'Alt+Tab is used by every app (switching apps). Pick another one.'],
    ['Space', { altKey: true }, "Alt+Space is used by every app (a window's own menu). Pick another one."],
  ]) {
    assert.deepStrictEqual(win.fromKeyEvent(ev(code, mods)).refused, message, `${code} ${JSON.stringify(mods)}`);
  }
  assert.strictEqual(win.fromKeyEvent(ev('KeyC', { ctrlKey: true, shiftKey: true })).accelerator, 'Control+Shift+C', 'with another modifier it is free');
});

test('on Windows any saved accelerator shows by name, CommandOrControl as Ctrl, and Super or Meta as Win', () => {
  assert.deepStrictEqual(win.symbols('Ctrl+Shift+Space'), ['Ctrl', 'Shift', 'Space']);
  assert.deepStrictEqual(win.symbols('CommandOrControl+Shift+B'), ['Ctrl', 'Shift', 'B']);
  assert.deepStrictEqual(win.symbols('shift+control+alt+delete'), ['Ctrl', 'Alt', 'Shift', 'Del']);
  assert.deepStrictEqual(win.symbols('Super+K'), ['Win', 'K']);
  assert.deepStrictEqual(win.symbols('Alt+Return'), ['Alt', 'Enter']);
  assert.deepStrictEqual(win.symbols(''), []);
});

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
