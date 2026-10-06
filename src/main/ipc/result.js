'use strict';

const { BuddyError } = require('../../../shared/errors');

/**
 * IPC answers never throw across the bridge (Electron would mangle the
 * message on the way). Handlers answer { ok: true, ...value } or
 * { ok: false, error: { code, message } }.
 *
 * Only a BuddyError's code and message reach the page: they are written for
 * the person using Buddy. Any other exception is a bug or a system failure
 * whose text would mean nothing to them (it can even hold a file path), so it
 * is logged here and the page is told to try again.
 */

function errorResult(err) {
  if (err instanceof BuddyError) return { ok: false, error: { code: err.code, message: err.message } };
  console.error('[buddy] unexpected error:', err);
  return { ok: false, error: { code: 'failed', message: 'Something went wrong. Try again.' } };
}

/** ipcMain.handle, but only for allowed senders, and with errors turned into results. */
function guarded(ipcMain, allowed) {
  return (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!allowed(event.sender)) return errorResult(new BuddyError('not_allowed', 'Not allowed.'));
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      return errorResult(err);
    }
  });
}

module.exports = { errorResult, guarded };
