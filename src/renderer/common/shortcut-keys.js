'use strict';
/* global module */
/* exported ShortcutKeys */

/**
 * Key presses into a shortcut, and a shortcut into key caps. A shortcut is an Electron accelerator ("Shift+Command+B",
 * "Alt+Space") or a key tapped on its own ("Tap:RightOption"): what Settings saves and the main process takes. The
 * Settings page loads this as a script; the main process requires it too (shortcut.js, key-watch.js, modifier-tap.js and
 * ipc/settings.js), and so do the unit tests (module.exports at the end). So it must stay free of the DOM and of
 * browser globals.
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

  /** The key caps for a shortcut, however it is spelled: "Shift+Command+B" and "cmd+shift+b" are both ['⇧', '⌘', 'B'], and "Tap:RightOption" is ['Right ⌥']. */
  function symbols(accelerator) {
    if (isTap(accelerator)) return (tapKeys(accelerator) || []).map((name) => TAP_KEYS.find((k) => k.name === name).cap);
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

  return { fromKeyEvent, heldSymbols, symbols, keyFor, isTap, tapKeys, tapValue };
})();

if (typeof module !== 'undefined') module.exports = ShortcutKeys;
