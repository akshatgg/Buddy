'use strict';

/**
 * IPC answers never throw across the bridge (Electron would mangle the
 * message on the way). Handlers answer { ok: true, ...value } or
 * { ok: false, error: { code, message } }.
 */

function errorResult(err) {
  return { ok: false, error: { code: err?.code || 'failed', message: err?.message || 'Something went wrong.' } };
}

/** ipcMain.handle, but only for allowed senders, and with errors turned into results. */
function guarded(ipcMain, allowed) {
  return (channel, fn) => ipcMain.handle(channel, async (event, ...args) => {
    if (!allowed(event.sender)) return errorResult({ code: 'not_allowed', message: 'Not allowed.' });
    try {
      return { ok: true, ...(await fn(...args)) };
    } catch (err) {
      return errorResult(err);
    }
  });
}

module.exports = { errorResult, guarded };
