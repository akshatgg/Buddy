'use strict';

/**
 * The menu bar icon (on Windows, the icon in the taskbar corner) and its menu, rebuilt whenever the buddy is turned
 * on/off or shown/hidden.
 */

const path = require('node:path');
const electron = require('electron');

const ASSETS = path.join(__dirname, '..', '..', 'assets');

/** The icon's file, and whether it is a template image. */
function trayIcon(platform) {
  return platform === 'win32'
    // Windows does not recolour tray icons, and its taskbar can be dark or light: a coloured face, at every scale.
    ? { file: path.join(ASSETS, 'trayWindows.ico'), template: false }
    // macOS recolours a template image for light and dark menu bars (trayTemplate@2x.png is picked up on Retina).
    : { file: path.join(ASSETS, 'trayTemplate.png'), template: true };
}

function buildMenuTemplate({ buddyOn, visible, isAdmin = false }, handlers) {
  return [
    { label: visible ? 'Hide buddy' : 'Show buddy', enabled: buddyOn, click: () => handlers.setVisible(!visible) },
    // Only for the admin; the server refuses the admin's calls to anyone else whatever the menu shows.
    ...(isAdmin ? [{ label: 'Admin…', click: () => handlers.openAdmin() }] : []),
    { label: 'Settings…', click: () => handlers.openSettings() },
    { type: 'separator' },
    { label: buddyOn ? 'Turn off buddy' : 'Turn on buddy', click: () => handlers.setBuddyOn(!buddyOn) },
    { type: 'separator' },
    { label: 'Quit Buddy', click: () => handlers.quit() },
  ];
}

/** Tray, Menu and nativeImage can be passed in so that tests need no Electron. */
function createTray({
  getState,
  handlers,
  platform = process.platform,
  Tray = electron.Tray,
  Menu = electron.Menu,
  nativeImage = electron.nativeImage,
}) {
  const icon = trayIcon(platform);
  const image = nativeImage.createFromPath(icon.file);
  if (icon.template) image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Buddy');
  // Windows opens a tray icon's menu on a right click only; the person may well click with the left button.
  if (platform === 'win32') tray.on('click', () => tray.popUpContextMenu());

  function refresh() {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(getState(), handlers)));
  }
  refresh();
  return { refresh, tray };
}

module.exports = { createTray, buildMenuTemplate, trayIcon };
