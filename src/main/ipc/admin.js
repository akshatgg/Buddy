'use strict';

/**
 * IPC for the Admin window. Every call goes to Buddy's server, which decides whether the signed-in person is the
 * admin and refuses everyone else; the app only uses the server's answer to show the "Admin…" menu item.
 */

const { BuddyError } = require('../../../shared/errors');
const { PROVIDER_IDS } = require('../../../shared/providers');
const { guarded } = require('./result');

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

function registerAdminIpc({ ipcMain, windows, cloud }) {
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents, 'admin'));

  handle('admin:settings', () => cloud.admin.settings());

  handle('admin:save', async (patch) => {
    if (!isPlainObject(patch)) throw new BuddyError('bad_request', 'Those settings are not valid.');
    const saved = await cloud.admin.save(patch);
    // The admin's own app follows the new switches at once; every other app does on its next check. The save is done
    // whether or not this fetch works, so a failure is only logged (by its kind, as at launch), not handed to the page.
    cloud.settings({ force: true }).catch((err) => {
      console.warn('[buddy] could not fetch the free settings:', err.code || err.name);
    });
    return saved;
  });

  handle('admin:models', (provider) => {
    if (!PROVIDER_IDS.includes(provider)) throw new BuddyError('bad_request', 'Unknown AI provider.');
    return cloud.admin.models(provider);
  });

  handle('admin:users', () => cloud.admin.users());

  handle('admin:block', (uid, blocked) => {
    if (typeof uid !== 'string' || !uid || typeof blocked !== 'boolean') {
      throw new BuddyError('bad_request', 'Pick a user to block or unblock.');
    }
    return cloud.admin.block(uid, blocked);
  });
}

module.exports = { registerAdminIpc };
