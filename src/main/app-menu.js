'use strict';

/**
 * Buddy's application menu. Buddy lives in the menu bar and has no menu bar of its own to show, but this menu still
 * decides what the keys do while one of its windows has the focus. Electron's default menu would have Cmd+Q quit
 * Buddy and Cmd+W close any focused window, the panel included. This one has only:
 *   - the Edit roles, so that cut, copy, paste, select all and undo work in the text boxes of the panel and Settings;
 *   - Cmd+W, which closes the focused Settings or Welcome window and nothing else;
 *   - no Cmd+Q: Buddy is quit only from the menu bar's "Quit".
 *
 * Windows gets no menu at all. There a menu shows as a bar inside the Settings and Welcome windows, the text boxes
 * have their Ctrl keys without one, and with none there is no Ctrl+W or Ctrl+R to close or reload a window.
 */

function buildAppMenuTemplate({ closeWindow }) {
  return [
    // macOS takes the first menu for the application menu. Its usual items (About, Hide, Quit) are not needed, and
    // leaving them out is what keeps Quit, and Cmd+Q, away.
    { label: 'Buddy', submenu: [] },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'Window',
      submenu: [{ label: 'Close Window', accelerator: 'CommandOrControl+W', click: (_item, win) => closeWindow(win) }],
    },
  ];
}

/** `windows` is the Settings and Welcome windows (settings-windows.js); Menu can be passed in so that tests need no Electron. */
function installAppMenu({ windows, Menu = require('electron').Menu, platform = process.platform }) {
  if (platform === 'win32') {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = buildAppMenuTemplate({
    closeWindow(win) {
      if (win && !win.isDestroyed() && windows.owns(win.webContents)) win.close();
    },
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

module.exports = { buildAppMenuTemplate, installAppMenu };
