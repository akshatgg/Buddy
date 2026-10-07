'use strict';
/* global module */
/* exported ShortcutKeys */

/**
 * Key presses into a shortcut, and a shortcut into key caps. A shortcut is an Electron accelerator
 * ("Shift+Command+B", "Alt+Space", "Control+Shift+Space"): what Settings saves and the main process registers. The
 * Settings page loads this as a script; the unit tests require it (module.exports at the end).
 *
 * ShortcutKeys itself is the Mac's set; ShortcutKeys.forPlatform('win32') is Windows', where the modifiers are named
 * (Ctrl, Alt, Shift), the Windows key belongs to Windows, and Ctrl+Alt is AltGr on many keyboards.
 */
const ShortcutKeys = (() => {
  // Keys that only modify: pressing one of them alone is not a shortcut yet.
  const MODIFIER_CODE = /^(Meta|Control|Alt|Shift)(Left|Right)$|^(OS|CapsLock|Fn|FnLock)/;
  const NAMED = {
    Space: 'Space', Enter: 'Return', NumpadEnter: 'Return', Tab: 'Tab', Backspace: 'Backspace', Delete: 'Delete',
    ArrowUp: 'Up', ArrowDown: 'Down', ArrowLeft: 'Left', ArrowRight: 'Right',
    Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'",
    Comma: ',', Period: '.', Slash: '/', Backquote: '`',
  };

  // Electron ignores case in an accelerator ("cmd+shift+b" works), and a shortcut typed into the old Shortcut box is
  // saved as it was typed. So the tables of spellings and key caps are in lower case, and a word is looked up in lower
  // case.
  const MAC = {
    // The modifiers in the Mac's order: ⌃ ⌥ ⇧ ⌘.
    modifiers: [
      { prop: 'ctrlKey', name: 'Control', symbol: '⌃' },
      { prop: 'altKey', name: 'Alt', symbol: '⌥' },
      { prop: 'shiftKey', name: 'Shift', symbol: '⇧' },
      { prop: 'metaKey', name: 'Command', symbol: '⌘' },
    ],
    // How a key looks on its key cap (Enter is another name for Return, Esc for Escape).
    keySymbol: {
      return: '↩', enter: '↩', tab: '⇥', backspace: '⌫', delete: '⌦', up: '↑', down: '↓', left: '←', right: '→',
      escape: 'Esc', esc: 'Esc', space: 'Space',
    },
    // Every spelling Electron takes for a modifier, and the name used for it above (Super and Meta are ⌘ on a Mac).
    modifierSpelling: {
      control: 'Control', ctrl: 'Control',
      alt: 'Alt', option: 'Alt', altgr: 'Alt',
      shift: 'Shift',
      command: 'Command', cmd: 'Command', commandorcontrol: 'Command', cmdorctrl: 'Command', super: 'Command', meta: 'Command',
    },
    // Shortcuts that every app uses, and what they do there (⌘Tab and ⌘Space are the Mac's own). Taken by Buddy, the key
    // would stop doing that in every app.
    reserved: {
      'Command+C': 'Copy', 'Command+V': 'Paste', 'Command+X': 'Cut', 'Command+Z': 'Undo', 'Shift+Command+Z': 'Redo',
      'Command+A': 'Select All', 'Command+Q': 'Quit', 'Command+W': 'Close Window', 'Command+S': 'Save', 'Command+H': 'Hide',
      'Command+M': 'Minimise', 'Command+Tab': 'switching apps', 'Command+Space': 'Spotlight',
    },
    joiner: '', // ⇧⌘Z
    needModifier: 'Hold ⌘, ⌥ or ⌃ with the key.',
    refuse: () => null,
    defaultShortcut: 'Alt+Space',
  };

  const WINDOWS = {
    // Ctrl, Alt, Shift, as Windows writes them. The Windows key is listed only to show it while held: it is refused.
    modifiers: [
      { prop: 'ctrlKey', name: 'Control', symbol: 'Ctrl' },
      { prop: 'altKey', name: 'Alt', symbol: 'Alt' },
      { prop: 'shiftKey', name: 'Shift', symbol: 'Shift' },
      { prop: 'metaKey', name: 'Super', symbol: 'Win' },
    ],
    keySymbol: {
      return: 'Enter', enter: 'Enter', tab: 'Tab', backspace: 'Backspace', delete: 'Del', up: '↑', down: '↓', left: '←',
      right: '→', escape: 'Esc', esc: 'Esc', space: 'Space',
    },
    // CommandOrControl is Ctrl on Windows; Command, Super and Meta are the Windows key.
    modifierSpelling: {
      control: 'Control', ctrl: 'Control', commandorcontrol: 'Control', cmdorctrl: 'Control',
      alt: 'Alt', option: 'Alt', altgr: 'Alt',
      shift: 'Shift',
      command: 'Super', cmd: 'Super', super: 'Super', meta: 'Super',
    },
    // Alt+Space opens every window's own menu (and PowerToys Run uses it), as platform.js says.
    reserved: {
      'Control+C': 'Copy', 'Control+V': 'Paste', 'Control+X': 'Cut', 'Control+Z': 'Undo', 'Control+Y': 'Redo',
      'Control+A': 'Select All', 'Control+S': 'Save', 'Control+W': 'Close', 'Control+F4': 'Close',
      'Alt+F4': 'Close Window', 'Alt+Tab': 'switching apps', 'Alt+Space': "a window's own menu",
    },
    joiner: '+', // Ctrl+Z
    needModifier: 'Hold Ctrl or Alt with the key.',
    refuse(e) {
      if (e.metaKey) return 'Shortcuts with the Windows key belong to Windows. Use Ctrl or Alt.';
      // AltGr arrives as Ctrl and Alt held together, and with a key it types a character on many keyboards.
      if (e.ctrlKey && e.altKey) return 'Ctrl+Alt types letters on many keyboards (it is AltGr). Try Ctrl+Shift.';
      return null;
    },
    // The same spelling as platform.js's defaultShortcut, so a reset saves what a new install starts with.
    defaultShortcut: 'Ctrl+Shift+Space',
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

  function make(set) {
    /** The modifier a word of an accelerator stands for ("cmd" -> "Command"), or null when it is none. */
    function modifierNamed(word) {
      const spelling = word.toLowerCase();
      return Object.hasOwn(set.modifierSpelling, spelling) ? set.modifierSpelling[spelling] : null;
    }

    /** How a key looks on its key cap: Return is ↩ (Enter on Windows), f12 is F12, b is B. A key with no cap of its own is left as it was written. */
    function keyCap(key) {
      const spelling = key.toLowerCase();
      if (Object.hasOwn(set.keySymbol, spelling)) return set.keySymbol[spelling];
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
      const mods = set.modifiers.filter((m) => named.includes(m.name)).map((m) => m.symbol);
      return [...mods, keyCap(key)];
    }

    /** The symbols of the modifiers a key event says are held, in the system's order. A keyup says what is still held. */
    function heldSymbols(e) {
      return set.modifiers.filter((m) => e[m.prop]).map((m) => m.symbol);
    }

    /**
     * What a keydown means while a shortcut is being recorded:
     *   { held }                only modifiers so far (their symbols, to show)
     *   { accelerator, keys }   a complete shortcut, ready to save
     *   { refused, held }       a key that cannot make a shortcut this way: why, in plain words
     */
    function fromKeyEvent(e) {
      const mods = set.modifiers.filter((m) => e[m.prop]);
      const held = heldSymbols(e);
      if (MODIFIER_CODE.test(String(e.code || ''))) return { held };
      const key = keyFor(e.code);
      if (!key) return { refused: "That key can't be part of a shortcut.", held };
      const own = set.refuse(e);
      if (own) return { refused: own, held };
      const functionKey = /^F\d+$/.test(key);
      const strong = mods.some((m) => m.name !== 'Shift');
      if (!strong && !functionKey) return { refused: set.needModifier, held };
      const accelerator = [...mods.map((m) => m.name), key].join('+');
      if (Object.hasOwn(set.reserved, accelerator)) {
        const keys = [...held, key].join(set.joiner); // ⌘Tab, Alt+Tab: the key by its name
        return { refused: `${keys} is used by every app (${set.reserved[accelerator]}). Pick another one.`, held };
      }
      return { accelerator, keys: symbols(accelerator) };
    }

    return { fromKeyEvent, heldSymbols, symbols, keyFor, defaultShortcut: set.defaultShortcut };
  }

  const mac = make(MAC);
  const windows = make(WINDOWS);
  /** The set for `platform` ('darwin' or 'win32', as the settings say); the Mac's until it is known. */
  const forPlatform = (platform) => (platform === 'win32' ? windows : mac);
  return { ...mac, forPlatform };
})();

if (typeof module !== 'undefined') module.exports = ShortcutKeys;
