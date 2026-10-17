'use strict';

/**
 * Buddy quits, whatever happens on the way. Electron's quit (app.quit, the menu bar's Quit, Update now, a log out, a
 * TERM signal) closes every window and emits will-quit only once none is left. A window made in between (a 'closed'
 * handler that asks for its page again, a click on the menu bar) is never closed by it, so will-quit never comes: the
 * update waiting on it never installs, and every later quit is ignored, as Electron thinks one is still under way.
 *
 *   - onQuit(fn): fn runs once, as the quit starts (before-quit), to stop whatever would make a window again.
 *   - A window made while Buddy quits is destroyed straight after it is made, so the quit can finish.
 *   - If will-quit has still not come `limitMs` after the quit started, the will-quit handlers run here (the update
 *     install in ipc/updates.js, main.js's clean up) and Buddy exits.
 */

const QUIT_LIMIT_MS = 10000; // a normal quit takes well under a second

function createQuitGuard({ app, limitMs = QUIT_LIMIT_MS, setTimer = setTimeout, clearTimer = clearTimeout, later = setImmediate }) {
  let quitting = false;
  let done = false; // will-quit came (from Electron or from here)
  let timer = null;
  const onQuit = [];

  app.on('before-quit', () => {
    if (quitting) return;
    quitting = true;
    for (const fn of onQuit) {
      try {
        fn();
      } catch (err) {
        console.error('[buddy] while quitting:', err);
      }
    }
    timer = setTimer(() => {
      if (done) return;
      console.warn('[buddy] the quit did not finish: quitting anyway');
      done = true;
      try {
        app.emit('will-quit', { preventDefault() {} });
      } finally {
        app.exit(0);
      }
    }, limitMs);
  });

  app.on('will-quit', () => {
    done = true;
    clearTimer(timer);
  });

  // Destroyed a moment later, not here: the code that made it is still setting it up.
  app.on('browser-window-created', (_event, win) => {
    if (!quitting || done) return;
    later(() => {
      if (!win.isDestroyed()) win.destroy();
    });
  });

  return {
    quitting: () => quitting,
    onQuit(fn) {
      onQuit.push(fn);
    },
  };
}

module.exports = { createQuitGuard, QUIT_LIMIT_MS };
