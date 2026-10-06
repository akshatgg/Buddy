'use strict';

/** The menu bar icon and its menu, rebuilt whenever the buddy is turned on/off or shown/hidden. */

const path = require('node:path');
const { Menu, Tray, nativeImage } = require('electron');

const ICON = path.join(__dirname, '..', '..', 'assets', 'trayTemplate.png');

function buildMenuTemplate({ buddyOn, visible }, handlers) {
  return [
    { label: visible ? 'Hide buddy' : 'Show buddy', enabled: buddyOn, click: () => handlers.setVisible(!visible) },
    { label: 'Settings…', click: () => handlers.openSettings() },
    { type: 'separator' },
    { label: buddyOn ? 'Turn off buddy' : 'Turn on buddy', click: () => handlers.setBuddyOn(!buddyOn) },
    { type: 'separator' },
    { label: 'Quit Buddy', click: () => handlers.quit() },
  ];
}

function createTray({ getState, handlers }) {
  const image = nativeImage.createFromPath(ICON); // picks up trayTemplate@2x.png on Retina screens
  image.setTemplateImage(true);
  const tray = new Tray(image);
  tray.setToolTip('Buddy');

  function refresh() {
    tray.setContextMenu(Menu.buildFromTemplate(buildMenuTemplate(getState(), handlers)));
  }
  refresh();
  return { refresh, tray };
}

module.exports = { createTray, buildMenuTemplate };
