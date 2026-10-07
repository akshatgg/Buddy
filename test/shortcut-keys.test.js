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
