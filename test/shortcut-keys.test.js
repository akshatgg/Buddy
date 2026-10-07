'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { fromKeyEvent, symbols, keyFor } = require('../src/renderer/common/shortcut-keys');

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
