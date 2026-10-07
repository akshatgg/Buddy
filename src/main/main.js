'use strict';

/**
 * Buddy's main process. start() builds everything and hands back the pieces,
 * so the end-to-end test (test/e2e/smoke.js) can drive the real app with fakes
 * in place of the parts that touch the system.
 */

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const { app, clipboard, dialog, globalShortcut: systemShortcut, ipcMain, powerMonitor, safeStorage, screen, shell } = require('electron');
const { createStore } = require('./store');
const { createMemory } = require('./memory');
const { createSecrets } = require('./secrets');
const { loadCloudConfig } = require('./cloud-config');
const { createAccount } = require('./account');
const { createCloud } = require('./cloud');
const { createAi } = require('./ai');
const { Helper } = require('./helper');
const { loadCharacters } = require('./characters');
const { createBuddyWindow } = require('./buddy-window');
const { createBubbleWindow } = require('./bubble-window');
const { createPanelWindow } = require('./panel-window');
const { createSettingsWindows } = require('./settings-windows');
const { createMemory } = require('./memory');
const { installAppMenu } = require('./app-menu');
const { createActions } = require('./actions');
const { sendKeyFor, undoKey } = require('./send-keys');
const { createTray, updateMenuState } = require('./tray');
const { createPower, loginItemsFor } = require('./power');
const { createShortcut } = require('./shortcut');
const { createKeyWatch } = require('./key-watch');
const { registerBuddyIpc } = require('./ipc/buddy');
const { registerPanelIpc } = require('./ipc/panel');
const { registerSettingsIpc } = require('./ipc/settings');
const { registerAdminIpc } = require('./ipc/admin');
const { registerUpdatesIpc } = require('./ipc/updates');
const { createUpdater, installTarget, firstLaunchOfNewVersion } = require('./updates');
const { helperFile, windows: onWindows } = require('./platform');

// Buddy's own version, from the app's package.json (which is packed into the built app). Not app.getVersion(): when
// Electron runs a script (the end-to-end test) there is no app package.json for it to read, and it answers Electron's.
const VERSION = require('../../package.json').version;

function helperPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', helperFile)
    : path.join(__dirname, '..', '..', 'bin', helperFile);
}

/** A window's handle as a number (on Windows, its HWND), or null when there is no window. */
function windowHandle(win) {
  if (!win || win.isDestroyed()) return null;
  const handle = win.getNativeWindowHandle();
  return handle.length >= 8 ? Number(handle.readBigUInt64LE(0)) : handle.readUInt32LE(0);
}

async function start(options = {}) {
  if (options.singleInstance !== false && !app.requestSingleInstanceLock()) {
    app.quit();
    return null;
  }
  // Windows names the login item by this id and gives Buddy's windows to it; the installer's shortcut carries the same
  // one (appId in electron-builder.config.js).
  if (onWindows) app.setAppUserModelId('com.akshatgg.buddy');
  await app.whenReady();
  if (app.dock) app.dock.hide();
  app.on('window-all-closed', () => {}); // a menu bar (or tray) app: closing windows must not quit it

  const userData = app.getPath('userData');
  const store = createStore({ file: path.join(userData, 'settings.json') });
  // What Buddy knows about the person (memory.js), kept in the settings file: the panel's chat learns it, Settings shows it.
  const memory = createMemory({ store });
  const secrets = createSecrets({ file: path.join(userData, 'keys.json'), safeStorage });
  // The end-to-end test passes its own account and server, so that it never signs in to Google or calls the real
  // server, and its own cloud.json values, so that it does not depend on this Mac's.
  const cloudConfig = options.cloudConfig === undefined ? loadCloudConfig() : options.cloudConfig;
  const account = options.account || createAccount({
    file: path.join(userData, 'account.json'),
    safeStorage,
    config: cloudConfig,
    openBrowser: (url) => shell.openExternal(url),
  });
  const cloud = options.cloud || createCloud({ config: cloudConfig, account, store });
  const ai = createAi({ store, secrets, cloud, account });
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
  const openSettings = (section) => windows.open('settings', section ? { section } : undefined);
  // What Buddy knows about the person (memory.js). Settings → Memory shows it, and follows each change.
  const memory = createMemory({ store });
  memory.onChange((list) => windows.send('settings', 'memory:changed', list));

  // Update now (updates.js, ipc/updates.js). Only Buddy as installed updates itself: a development run, a trial run
  // (BUDDY_USER_DATA, index.js) and a copy outside the install folder only say where the new version is, and the first
  // two never check by itself (updates.js installTarget).
  let updatesIpc = null;
  const target = installTarget({ platform: process.platform, packaged: app.isPackaged, trial: options.trial === true, execPath: process.execPath });
  const updater = createUpdater({
    currentVersion: VERSION,
    platform: target.platform,
    fetchImpl: (...args) => fetch(...args),
    downloadDir: path.join(app.getPath('temp'), 'buddy-updates'),
    getSettings: () => store.all(),
    patchSettings: (patch) => store.set(patch),
    bundle: target.bundle,
    spawn,
    runCommand: promisify(execFile),
    onChange(state) {
      updatesIpc?.stateChanged(state);
      windows.send('settings', 'updates:changed', state);
      tray?.refresh();
    },
  });
  // The first launch after an update: on the Mac, macOS asks for the permissions again (see the end of start()).
  const justUpdated = firstLaunchOfNewVersion(store, VERSION);
  installAppMenu({ windows }); // Edit keys in the text boxes, Cmd+W for Settings, Welcome and Admin, and no Cmd+Q (none on Windows)

  const actions = createActions({
    helper,
    ai,
    // The end-to-end test passes its own, so that it never reads or overwrites the person's real clipboard.
    clipboard: options.clipboard || clipboard,
    store,
    memory,
    sendKeyFor,
    undoKey,
    // The panel greets the person by their first name, and the AI knows it.
    userName: () => (account.user()?.name || '').trim().split(/\s+/)[0],
    ui: {
      showPanel: (state) => panel.show(state, buddy.bounds(), buddy.display().workArea),
      panelState: (state) => panel.send('panel:state', state),
      hidePanel: () => panel.hide(),
      isPanelVisible: () => panel.isVisible(),
      panelJustClosed: () => panel.justClosed(),
      panelHiddenAt: () => panel.hiddenAt(),
      panelWindowHandle: () => windowHandle(panel.window()), // for the helper on Windows (actions.js)
      openSettings,
      bubble: (text) => bubble.say(text, buddy.bounds(), buddy.display().workArea),
      mood: (name) => buddy.mood(name),
      // For the buddy's feelings, which have their own design: voice (the next step) will say when the panel listens
      // (listening(on)) and how loud the person speaks (voiceLevel(0..1), about 10 times a second). Nothing uses them yet.
      listening() {},
      voiceLevel() {},
    },
  });
  const onCall = () => {
    // The shortcut is let go while Buddy is off. This is the second guard, for a press that was already on its way.
    if (!power.isOn()) return;
    actions.toggle().catch((err) => console.error('[buddy] could not open the panel', err));
  };

  // The shortcut is taken only while Buddy is on: it opens the panel, and the panel reads the person's selection. A key
  // tapped on its own ("Tap:RightOption") is heard through the helper; any other shortcut is registered with the system.
  const keyWatch = createKeyWatch({ helper, onPress: onCall });
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress: onCall });
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

  // "Admin…" is in the menu for the admin only: the server says who that is (and refuses the admin's calls to
  // anyone else, whatever the menu shows).
  const trayState = () => ({
    buddyOn: power.isOn(),
    visible: buddy.isVisible(),
    isAdmin: account.isSignedIn() && cloud.last()?.isAdmin === true,
    update: updateMenuState(updater.state()),
  });
  tray = createTray({
    getState: trayState,
    handlers: {
      setVisible(visible) {
        if (visible) buddy.show();
        else buddy.hide();
        tray.refresh();
      },
      openSettings,
      openAdmin: () => windows.open('admin'),
      setBuddyOn: (on) => power.setOn(on),
      updateNow: () => updatesIpc.updateNow(),
      quit: () => app.quit(),
    },
  });

  // Whenever the person changes (signed out, or someone else signed in), their free-mode settings are forgotten, so
  // that the next person does not inherit them (or the admin's menu). Signing out also closes the Admin window.
  let uid = account.user()?.uid ?? null;
  account.onChange(() => {
    const current = account.user()?.uid ?? null;
    if (current !== uid) {
      uid = current;
      cloud.forget();
    }
    if (!account.isSignedIn()) windows.close('admin');
    tray.refresh();
  });
  cloud.onChange(() => tray.refresh());

  registerBuddyIpc({ ipcMain, buddy, characters, store, onClick: onCall });
  registerPanelIpc({ ipcMain, panel, actions, openSettings });
  const settingsIpc = registerSettingsIpc({
    ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, keyWatch,
    account, cloud, memory, canSignIn: Boolean(cloudConfig),
    version: VERSION,
    justUpdated,
    onFinishOnboarding() {
      windows.close('onboarding');
      buddy.reloadModel();
      power.setOn(true);
    },
  });
  // Settings lets go of the shortcut while it records a new one: a recording cut short by closing Settings gives it back.
  windows.onClosed((kind) => {
    if (kind === 'settings') settingsIpc.resumeShortcut();
  });
  registerAdminIpc({ ipcMain, windows, cloud });
  updatesIpc = registerUpdatesIpc({
    ipcMain,
    electron: { app, shell, dialog },
    getUpdater: () => updater,
    allowed: (webContents) => windows.owns(webContents, 'settings'),
    store,
    // While the panel is open, a finished download does not restart Buddy under the person: Update now waits.
    isBusy: () => panel.isVisible(),
  });

  app.on('second-instance', () => openSettings()); // Electron passes the event first: it must not become a section
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

  // This person's free-mode settings, fetched once at launch, so that Settings and the menu are up to date.
  if (account.isSignedIn()) {
    cloud.settings({ force: true }).catch((err) => console.warn('[buddy] could not fetch the free settings:', err.code || err.name));
  }

  if (store.get('onboarded')) {
    power.syncAtLaunch();
    if (power.isOn()) {
      takeShortcut();
      buddy.show();
      buddy.mood('wave');
    }
    // Nobody can use Buddy signed out: Settings has the Sign in button.
    if (!account.isSignedIn()) openSettings();
  } else {
    windows.open('onboarding');
  }
  tray.refresh();

  // After an update on the Mac, macOS has forgotten Buddy's permissions (an ad-hoc signed app is a new app to it, and
  // the update cleared its old entries): Settings opens on them and says why.
  if (justUpdated && process.platform === 'darwin' && store.get('onboarded')) {
    helper.call('permissions').then((granted) => {
      if (!granted?.accessibility) openSettings('permissions');
    }).catch((err) => console.warn('[buddy] could not check the permissions after the update:', err.code || err.name));
  }
  if (target.platform !== 'development') updatesIpc.launchCheck();

  return { store, secrets, memory, account, cloud, ai, helper, characters, buddy, bubble, panel, windows, actions, power, tray, trayState, shortcut, updater };
}

module.exports = { start };
