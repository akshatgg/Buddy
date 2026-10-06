'use strict';

/**
 * Buddy's main process. start() builds everything and hands back the pieces,
 * so the end-to-end test (test/e2e/smoke.js) can drive the real app with fakes
 * in place of the parts that touch the system.
 */

const path = require('node:path');
const { app, clipboard, globalShortcut: systemShortcut, ipcMain, powerMonitor, safeStorage, screen } = require('electron');
const { createStore } = require('./store');
const { createSecrets } = require('./secrets');
const { createAi } = require('./ai');
const { Helper } = require('./helper');
const { loadCharacters } = require('./characters');
const { createBuddyWindow } = require('./buddy-window');
const { createBubbleWindow } = require('./bubble-window');
const { createPanelWindow } = require('./panel-window');
const { createSettingsWindows } = require('./settings-windows');
const { createActions } = require('./actions');
const { createTray } = require('./tray');
const { createPower, loginItemsFor } = require('./power');
const { createShortcut } = require('./shortcut');
const { registerBuddyIpc } = require('./ipc/buddy');
const { registerPanelIpc } = require('./ipc/panel');
const { registerSettingsIpc } = require('./ipc/settings');

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'buddy-helper')
    : path.join(__dirname, '..', '..', 'bin', 'buddy-helper');
}

async function start(options = {}) {
  if (options.singleInstance !== false && !app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  await app.whenReady();
  if (app.dock) app.dock.hide();
  app.on('window-all-closed', () => {}); // a menu bar app: closing windows must not quit it

  const userData = app.getPath('userData');
  const store = createStore({ file: path.join(userData, 'settings.json') });
  const secrets = createSecrets({ file: path.join(userData, 'keys.json'), safeStorage });
  const ai = createAi({ store, secrets });
  const helper = options.helper || new Helper({ binPath: helperPath() });
  helper.start();
  // The end-to-end test passes its own, so that it never grabs the person's real shortcut.
  const globalShortcut = options.globalShortcut || systemShortcut;

  const characters = loadCharacters();
  let tray = null;
  const buddy = createBuddyWindow({
    store,
    screen,
    animate: options.animate !== false,
    onGiveUp: () => tray?.refresh(), // the page crashed again and again, and the window is gone: the menu must say so
  });
  const bubble = createBubbleWindow();
  const panel = createPanelWindow();
  const windows = createSettingsWindows({ app });
  const openSettings = () => windows.open('settings');

  const actions = createActions({
    helper,
    ai,
    // The end-to-end test passes its own, so that it never reads or overwrites the person's real clipboard.
    clipboard: options.clipboard || clipboard,
    store,
    ui: {
      showPanel: (state) => panel.show(state, buddy.bounds(), buddy.display().workArea),
      hidePanel: () => panel.hide(),
      isPanelVisible: () => panel.isVisible(),
      panelJustClosed: () => panel.justClosed(),
      bubble: (text) => bubble.say(text, buddy.bounds(), buddy.display().workArea),
      mood: (name) => buddy.mood(name),
    },
  });
  const onCall = () => {
    // The shortcut is let go while Buddy is off. This is the second guard, for a press that was already on its way.
    if (!power.isOn()) return;
    actions.toggle().catch((err) => console.error('[buddy] could not open the panel', err));
  };

  // The shortcut is taken only while Buddy is on: it opens the panel, and the panel reads the person's selection.
  const shortcut = createShortcut({ globalShortcut, onPress: onCall });
  function takeShortcut() {
    const accelerator = store.get('shortcut');
    if (!shortcut.register(accelerator)) console.warn(`[buddy] could not register the shortcut ${accelerator}`);
  }

  const power = createPower({
    store,
    // None in a development run, which would register Electron.app; the end-to-end test passes its own.
    loginItems: options.loginItems || loginItemsFor(app),
    onChange(on) {
      if (on) {
        takeShortcut();
        buddy.show();
        buddy.mood('wave');
      } else {
        shortcut.unregister();
        panel.hide();
        buddy.hide();
      }
      tray.refresh();
    },
  });

  tray = createTray({
    getState: () => ({ buddyOn: power.isOn(), visible: buddy.isVisible() }),
    handlers: {
      setVisible(visible) {
        if (visible) buddy.show();
        else buddy.hide();
        tray.refresh();
      },
      openSettings,
      setBuddyOn: (on) => power.setOn(on),
      quit: () => app.quit(),
    },
  });

  registerBuddyIpc({ ipcMain, buddy, characters, store, onClick: onCall });
  registerPanelIpc({ ipcMain, panel, actions, openSettings });
  registerSettingsIpc({
    ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut,
    onFinishOnboarding() {
      windows.close('onboarding');
      buddy.reloadModel();
      power.setOn(true);
    },
  });

  app.on('second-instance', openSettings);
  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    helper.stop();
  });

  powerMonitor.on('lock-screen', () => buddy.pause(true));
  powerMonitor.on('unlock-screen', () => {
    if (buddy.isVisible()) buddy.pause(false);
  });
  screen.on('display-removed', () => buddy.reclamp());
  screen.on('display-metrics-changed', () => buddy.reclamp());

  if (store.get('onboarded')) {
    power.syncAtLaunch();
    if (power.isOn()) {
      takeShortcut();
      buddy.show();
      buddy.mood('wave');
    }
  } else {
    windows.open('onboarding');
  }
  tray.refresh();

  return { store, secrets, ai, helper, characters, buddy, bubble, panel, windows, actions, power, tray, shortcut };
}

module.exports = { start };
