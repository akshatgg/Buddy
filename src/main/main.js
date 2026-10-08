'use strict';

/**
 * Buddy's main process. start() builds everything and hands back the pieces,
 * so the end-to-end test (test/e2e/smoke.js) can drive the real app with fakes
 * in place of the parts that touch the system.
 */

const path = require('node:path');
const { execFile, spawn } = require('node:child_process');
const { promisify } = require('node:util');
const {
  app, clipboard, dialog, globalShortcut: systemShortcut, ipcMain, powerMonitor, safeStorage, screen, shell, systemPreferences,
} = require('electron');
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
const { createNotchWindow } = require('./notch-window');
const { createHome } = require('./home');
const { createPanelWindow } = require('./panel-window');
const { createSettingsWindows } = require('./settings-windows');
const { installAppMenu } = require('./app-menu');
const { createActions } = require('./actions');
const { sendKeyFor, undoKey } = require('./send-keys');
const { createTray, updateMenuState } = require('./tray');
const { createPower, loginItemsFor } = require('./power');
const { createShortcut } = require('./shortcut');
const { createKeyWatch } = require('./key-watch');
const { registerBuddyIpc } = require('./ipc/buddy');
const { registerNotchIpc } = require('./ipc/notch');
const { registerPanelIpc, createMicrophone } = require('./ipc/panel');
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
  // Whether macOS lets Buddy use the microphone, for the panel's voice ('unknown' on Windows, which does not ask per
  // app). The end-to-end test passes its own systemPreferences, so that it never asks this Mac.
  const microphone = createMicrophone({ systemPreferences: options.systemPreferences || systemPreferences });
  // The end-to-end test passes its own, so that it never grabs the person's real shortcut.
  const globalShortcut = options.globalShortcut || systemShortcut;

  const characters = loadCharacters();
  let tray = null;
  const floating = createBuddyWindow({
    store,
    screen,
    animate: options.animate !== false,
    onGiveUp: () => tray?.refresh(), // the page crashed again and again, and the window is gone: the menu must say so
  });
  const bubble = createBubbleWindow();
  // Buddy as the rest of main sees it: in the notch (on a Mac with one) or the floating buddy, whichever is in use.
  const buddy = createHome({ floating, notch: createNotchWindow({ screen }), bubble, store, helper, screen });
  helper.on('started', () => buddy.refresh()); // a helper that was down or slow at launch: ask again
  const panel = createPanelWindow({
    // Its page crashed or did not load, or its window was closed: a listening there is over, and the page cannot say so.
    onGone: () => ui.listening(false),
  });
  const windows = createSettingsWindows({ app });
  const openSettings = (section) => windows.open('settings', section ? { section } : undefined);
  // Settings → Memory follows each change to what Buddy knows about the person.
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

  // What actions.js (and, for voice, ipc/panel.js) does with the panel, the bubble and the buddy.
  const ui = {
    showPanel: (state) => panel.show(state, buddy.panelAt()),
    panelState: (state) => panel.send('panel:state', state),
    hidePanel() {
      panel.hide();
      ui.listening(false); // a listening ends with the panel (the page says so too, a moment later)
    },
    isPanelVisible: () => panel.isVisible(),
    panelJustClosed: () => panel.justClosed(),
    panelHiddenAt: () => panel.hiddenAt(),
    panelWindowHandle: () => windowHandle(panel.window()), // for the helper on Windows (actions.js)
    openSettings,
    bubble: (text) => buddy.say(text),
    mood: (name) => buddy.mood(name),
    // For the buddy's feelings, which have their own design: when the panel listens (listening(on), from its page; and
    // false when main hides the panel or its page is gone) and how loud the person speaks (voiceLevel(0..1), about 10
    // times a second). Nothing uses them yet.
    listening() {},
    voiceLevel() {},
  };
  const actions = createActions({
    helper,
    ai,
    // The end-to-end test passes its own, so that it never reads or overwrites the person's real clipboard.
    clipboard: options.clipboard || clipboard,
    store,
    memory,
    sendKeyFor,
    undoKey,
    // Buddy's server writes down what was said into the panel, for someone signed in.
    cloud,
    signedIn: () => account.isSignedIn(),
    // Whether the panel may listen: voice is on for this person (the server has a Groq key, and they are not blocked),
    // "Listen when the panel opens" (Settings → General), and the microphone.
    voice: () => ({
      on: account.isSignedIn() && cloud.last()?.voiceOn === true && cloud.last()?.blocked !== true,
      auto: store.get('listenOnOpen') === true,
      mic: microphone.status(),
    }),
    // The panel greets the person by their first name, and the AI knows it.
    userName: () => (account.user()?.name || '').trim().split(/\s+/)[0],
    ui,
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
        // Through actions, as closing the panel does: the chat ends, and an answer still on its way does nothing.
        actions.dismiss().catch((err) => console.error('[buddy] could not close the panel', err));
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
  registerNotchIpc({ ipcMain, notch: buddy.notchWindow(), onClick: onCall });
  registerPanelIpc({ ipcMain, panel, actions, openSettings, microphone, ui, shell });
  const settingsIpc = registerSettingsIpc({
    ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, keyWatch,
    account, cloud, memory, microphone, canSignIn: Boolean(cloudConfig),
    home: buddy, // Settings → Buddy → Where Buddy lives: whether there is a notch, and moving Buddy when it changes
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
  // A screen that came or went: the notch may have gone with the lid, or come back (home.js).
  screen.on('display-added', () => buddy.refresh());
  screen.on('display-removed', () => {
    buddy.reclamp();
    buddy.refresh();
  });
  // A screen whose size, scale or work area changed: the notch may be elsewhere now, or gone (home.js).
  screen.on('display-metrics-changed', (_event, _display, changed) => {
    buddy.reclamp();
    if (changed.includes('bounds') || changed.includes('scaleFactor') || changed.includes('workArea')) buddy.refresh();
  });

  // This person's free-mode settings, fetched once at launch, so that Settings and the menu are up to date.
  if (account.isSignedIn()) {
    cloud.settings({ force: true }).catch((err) => console.warn('[buddy] could not fetch the free settings:', err.code || err.name));
  }

  await buddy.refresh(); // where Buddy lives, before it is first shown
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

  return {
    store, secrets, memory, account, cloud, ai, helper, characters, buddy, bubble, panel, windows, actions, power, tray, trayState, shortcut, updater,
    home: buddy, // the same object as buddy, by the name the e2e checks for the notch use
  };
}

module.exports = { start };
