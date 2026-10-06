'use strict';

/**
 * What differs between the Mac and Windows, in one place. Everything else in Buddy is the same on both.
 * The module holds the values for the system Buddy runs on; forPlatform() gives either set, for the tests.
 */

function forPlatform(platform) {
  const windows = platform === 'win32';
  return {
    windows,
    // The buddy, the bubble and the panel stay out of the Dock or the taskbar and out of the app switcher: they are
    // panels on the Mac and tool windows on Windows.
    floatingType: windows ? 'toolbar' : 'panel',
    // On Windows ⌥Space (Alt+Space) opens every window's own menu, and PowerToys Run and Copilot use it too.
    defaultShortcut: windows ? 'Ctrl+Shift+Space' : 'Alt+Space',
    // The keys that paste, as the person is told to press them.
    pasteKeys: windows ? 'Ctrl+V' : '⌘V',
    // The native helper in bin/: Swift on the Mac (src/native/BuddyHelper.swift), C# on Windows (src/native/windows).
    helperFile: windows ? 'buddy-helper.exe' : 'buddy-helper',
    // macOS hands the keyboard to the panel when it opens and back to the app below when it closes. Windows does
    // neither reliably (it decides which program may take the front), so there the helper moves it (actions.js).
    helperMovesFocus: windows,
    // Line breaks in what Buddy puts on the clipboard: every Windows app understands \r\n, not all of them \n.
    newline: windows ? '\r\n' : '\n',
  };
}

module.exports = { forPlatform, ...forPlatform(process.platform) };
