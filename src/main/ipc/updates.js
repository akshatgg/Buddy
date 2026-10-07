'use strict';

const { BuddyError } = require('../../../shared/errors');
const { guarded } = require('./result');
const { RELEASES_PAGE, CHECK_INTERVAL_MS } = require('../updates');

/**
 * Update now (from Loupe's src/main/ipc/updates.js): the Settings window's calls, the menu bar item, and the one
 * dialog Buddy shows by itself, when the check it makes on opening (and every hour while it runs) finds a newer
 * version.
 *
 *   updates:state             -> the updater's state (updates.js createUpdater)
 *   updates:check             -> checks now, answers the new state
 *   updates:install           -> Update now: installs and opens Buddy again (as soon as the download is ready), or
 *                                opens the release page where Buddy cannot update itself
 *   updates:open-release-page -> what's new, in the browser
 *   updates:set-auto          -> "Check for updates automatically" on or off
 *   'updates:changed' (event) -> sent to the Settings window on every change (main.js)
 *
 * Calls answer { ok, ... } like every Settings call (ipc/result.js), and only `allowed` senders may make them.
 * isBusy(): the panel is open. A download that finishes then does not restart Buddy under the person; Update now
 * stays there to click.
 */
function registerUpdatesIpc({ ipcMain, electron, getUpdater, allowed, store, isBusy = () => false }) {
  const { app, shell, dialog } = electron;
  const handle = guarded(ipcMain, allowed);
  // Created on first use: it asks Electron for the app's temp folder, which a unit test's Electron has not got.
  const updater = new Proxy({}, { get: (_target, key) => getUpdater()[key] });

  const openReleasePage = () => shell.openExternal(updater.state().latest?.url ?? RELEASES_PAGE);

  // The update is started from will-quit, not here: quitting first closes Buddy's windows and lets everything finish
  // (main.js's own will-quit lets go of the shortcut and stops the helper, in the same moment), and only then does an
  // installer or the Mac's swap script take over.
  let relaunch = false;
  const restartToUpdate = () => {
    if (!updater.installsItself() || updater.state().status !== 'ready') return;
    relaunch = true;
    app.quit();
  };

  // Update now. Where Buddy installs itself it never just waits: a ready update restarts Buddy, anything else is
  // remembered and, unless a download is already running, checked for again (updates.js requestInstall), so a release
  // out since the last check is found too.
  function updateNow() {
    const s = updater.state();
    if (updater.installsItself()) {
      if (s.status === 'ready') restartToUpdate();
      else updater.requestInstall();
    } else if (s.status === 'available') {
      openReleasePage();
    } else {
      updater.check();
    }
  }

  handle('updates:state', () => updater.state());
  handle('updates:check', () => updater.check());
  handle('updates:install', () => {
    updateNow();
    return updater.state();
  });
  handle('updates:open-release-page', async () => {
    await openReleasePage();
  });
  handle('updates:set-auto', (on) => {
    if (typeof on !== 'boolean') throw new BuddyError('bad_request', 'Automatic checks must be on or off.');
    store.set({ checkForUpdates: on });
    if (on) autoCheck();
    return { checkForUpdates: on };
  });

  // The dialog, at most once per launch, for a check Buddy made by itself. "Check now" in Settings is already on
  // screen, so it does not add one.
  let announce = false;
  let announced = false;

  async function announceUpdate(s) {
    const { version } = s.latest;
    const options = updater.installsItself()
      ? {
        detail: `You have ${s.currentVersion}. Update now installs it and opens Buddy again`
          + `${s.status === 'ready' ? '' : ' once it has downloaded'}. Later, it installs the next time Buddy quits.`,
        buttons: ['Update now', 'Later'],
        actions: [updateNow, () => {}],
      }
      : {
        detail: `You have ${s.currentVersion}. Download the new version and replace the one in your Applications folder.`,
        buttons: ['Download', 'Later'],
        actions: [openReleasePage, () => {}],
      };
    // Buddy has no Dock icon: on the Mac it must come forward, or the dialog opens behind the app in front.
    if (process.platform === 'darwin') app.focus?.({ steal: true });
    const { response } = await dialog.showMessageBox({
      type: 'info', message: `Buddy ${version} is available`, detail: options.detail,
      buttons: options.buttons, defaultId: 0, cancelId: options.buttons.length - 1,
    });
    options.actions[response]?.();
  }

  // main.js calls this on every state change.
  function stateChanged(s) {
    if (s.status === 'ready' && s.pending && !isBusy()) restartToUpdate();
    if (!announce) return;
    if (s.latest && ['available', 'downloading', 'ready'].includes(s.status)) {
      announce = false;
      announced = true;
      announceUpdate(s).catch((err) => console.error('[buddy] could not show the update dialog:', err));
    } else if (s.status === 'current' || s.status === 'error') {
      announce = false;
    }
  }

  async function autoCheck() {
    announce = !announced;
    try {
      const state = await updater.autoCheck();
      if (!state) announce = false;
      if (state?.status === 'error') console.warn('[buddy] update check failed:', state.error);
    } catch (err) {
      announce = false;
      console.error('[buddy] update check failed:', err);
    }
  }

  // Each time Buddy opens (with the setting on), and every hour after that while it runs.
  function launchCheck() {
    const timer = setInterval(autoCheck, CHECK_INTERVAL_MS);
    timer.unref?.();
    return autoCheck();
  }

  // Install on quit: an update that was downloaded and checked but not installed yet goes in as Buddy closes, and
  // opens Buddy again afterwards when the person chose Update now.
  // If the update cannot start (its download was cleaned away, say) after Update now, Buddy opens again by itself:
  // the person asked for Buddy to come back, and that was the installer's job.
  app.on('will-quit', () => {
    let started = false;
    try {
      started = updater.install({ relaunch });
    } catch (err) {
      console.error('[buddy] could not start the update:', err);
    }
    if (relaunch && !started) app.relaunch();
  });

  return { launchCheck, stateChanged, updateNow };
}

module.exports = { registerUpdatesIpc };
