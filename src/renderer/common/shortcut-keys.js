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
  const KEY_SYMBOL = {
    Return: '↩', Tab: '⇥', Backspace: '⌫', Delete: '⌦', Up: '↑', Down: '↓', Left: '←', Right: '→', Escape: 'Esc',
  };
  // Other spellings Electron accepts for the same modifier (and Enter for Return).
  const ALIASES = {
    Cmd: 'Command', CommandOrControl: 'Command', CmdOrCtrl: 'Command', Ctrl: 'Control', Option: 'Alt', AltGr: 'Alt',
    Enter: 'Return',
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

  /** The key caps for an accelerator: "Shift+Command+B" -> ['⇧', '⌘', 'B']. */
  function symbols(accelerator) {
    const parts = String(accelerator || '').split('+').map((p) => p.trim()).filter(Boolean)
      .map((p) => (Object.hasOwn(ALIASES, p) ? ALIASES[p] : p));
    const key = parts.pop();
    if (!key) return [];
    const mods = MODIFIERS.filter((m) => parts.includes(m.name)).map((m) => m.symbol);
    const shown = Object.hasOwn(KEY_SYMBOL, key) ? KEY_SYMBOL[key] : (key.length === 1 ? key.toUpperCase() : key);
    return [...mods, shown];
  }

  /**
   * What a keydown means while a shortcut is being recorded:
   *   { held }                only modifiers so far (their symbols, to show)
   *   { accelerator, keys }   a complete shortcut, ready to save
   *   { refused, held }       a key that cannot make a shortcut this way: why, in plain words
   */
  function fromKeyEvent(e) {
    const mods = MODIFIERS.filter((m) => e[m.prop]);
    const held = mods.map((m) => m.symbol);
    if (MODIFIER_CODE.test(String(e.code || ''))) return { held };
    const key = keyFor(e.code);
    if (!key) return { refused: "That key can't be part of a shortcut.", held };
    const functionKey = /^F\d+$/.test(key);
    const strong = mods.some((m) => m.name !== 'Shift');
    if (!strong && !functionKey) return { refused: 'Hold ⌘, ⌥ or ⌃ with the key.', held };
    const accelerator = [...mods.map((m) => m.name), key].join('+');
    return { accelerator, keys: symbols(accelerator) };
  }

  return { fromKeyEvent, symbols, keyFor };
})();

if (typeof module !== 'undefined') module.exports = ShortcutKeys;
