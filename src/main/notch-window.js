'use strict';

/**
 * Buddy in the notch: a see-through window over the top of the screen, above the menu bar, whose page draws the
 * notch a little wider with an eye on each side (src/renderer/notch). It never takes focus, and clicks pass
 * through it except over the black shape: the page reports when the pointer is over it (notch:hover), as the
 * floating buddy's does. The window is one fixed size, reaching far past the notch on both sides, so it never
 * resizes: the page draws the smaller shape inside it. home.js shows it only on a Mac with a notch.
 *
 * The page shows Buddy one of two ways (Settings → Buddy → "In the notch", `look`): Buddy's own 3D face in the left wing,
 * or an eye in each wing. Either way the right wing has the status (Claude Code at work, done, needing the person) and
 * what Buddy says.
 */

const path = require('node:path');
const { REACH, DROP, WING, WING_HOVER, SAY_MAX, CORNER, notchWindowBounds } = require('./notch-geometry');

const CURSOR_MS = 66; // as the floating buddy's: about 15 updates a second
const RELOAD_MS = 60_000; // a page that crashed or did not load is reloaded, but no more often than this
const LOOKS = ['face', 'eyes']; // how Buddy shows in the notch; anything else is the face
// The statuses that stay until another replaces them; done and failed show for a moment only, so a page that loads
// later is not told them.
const LASTING_STATUS = ['working', 'needsYou'];

// The error code of a load that was cancelled rather than one that failed.
const ERR_ABORTED = -3;

// BrowserWindow can be passed in so tests can run without Electron; the real one is loaded only when none is.
function createNotchWindow({ screen, look = () => 'face', BrowserWindow = require('electron').BrowserWindow }) {
  let win = null;
  let loaded = false; // the page has finished loading, so it can take messages
  let pendingMood = null; // the latest mood sent while the page was not loaded
  let paused = false; // what a freshly loaded page is told
  let shown = null; // what show() was last given: { notch, display }, so that notch() can say which notch is shown
  let lastReload = null; // when the page was last reloaded after a crash or a failed load
  let reloadTimer = null;
  let cursorTimer = null;
  let lastCursor = null;
  // What a freshly loaded page is told again, as the floating buddy's window does: a sleep that lasts (drowsy, asleep),
  // whether the panel is open and the microphone on, and a status that lasts.
  let sleepy = null;
  let panelOpen = false;
  let micOn = false;
  let status = null;
  let hovered = false; // the page said the pointer is on the shape, and has not said it left
  const hoverLost = []; // told when the pointer can no longer be said to leave: the window hid, went or reloads

  /** What the page needs to draw the shape: the notch's size, and the design's measures. */
  const layout = (notch) => ({
    notchWidth: notch.width, notchHeight: notch.height, reach: REACH, drop: DROP, wing: WING, wingHover: WING_HOVER, sayMax: SAY_MAX, corner: CORNER,
    look: LOOKS.includes(look()) ? look() : 'face',
  });

  /** Forget a window that is gone, so that the next show() builds a new one. */
  /** The page can no longer say the pointer left (hidden, gone, reloading): say it for it. */
  function loseHover() {
    if (!hovered) return;
    hovered = false;
    for (const fn of hoverLost) fn();
  }

  function forget(w) {
    if (win !== w) return;
    loseHover();
    stopCursor();
    clearTimeout(reloadTimer);
    reloadTimer = null;
    win = null;
    loaded = false;
    paused = false;
    pendingMood = null;
    shown = null;
  }

  function create() {
    loaded = false;
    const w = new BrowserWindow({
      ...notchWindowBounds(shown.notch),
      type: 'panel',
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      // macOS keeps every window below the menu bar, whatever its level, unless told the window may go past the screen.
      enableLargerThanScreen: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'notch.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win = w;
    w.setAlwaysOnTop(true, 'screen-saver'); // above the menu bar, which 'floating' is not
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setIgnoreMouseEvents(true, { forward: true });
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    // did-navigate fires when a navigation commits (the first load, a reload), so the old page is gone and the
    // new one is not ready (see buddy-window.js for why not did-start-loading).
    contents.on('did-navigate', () => {
      loaded = false;
    });
    contents.on('did-finish-load', onLoaded);
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      console.error('[buddy] the notch page failed to load:', code, description);
      // A cancelled load or a failure in a sub-frame leaves the page as it was: only a real failure reloads it.
      if (isMainFrame && code !== ERR_ABORTED) reloadLater();
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the notch page crashed:', details.reason);
      reloadLater();
    });
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); // the page shows only its own content: no pop-ups either
    w.loadFile(path.join(__dirname, '..', 'renderer', 'notch', 'index.html')).catch((err) => {
      // did-fail-load above says what to do about it; this only keeps the failure from going unhandled.
      console.error('[buddy] could not load the notch page:', err.message);
    });
  }

  /** Every load starts a page that knows nothing: not the layout, not the pointer, not whether to animate, not the mood. */
  function onLoaded() {
    if (!win || win.isDestroyed()) return;
    loaded = true;
    lastCursor = null; // what was sent while it loaded was dropped, so send the pointer again even if it is still
    win.setIgnoreMouseEvents(true, { forward: true }); // a fresh page starts without hover
    if (shown) send('notch:layout', layout(shown.notch));
    send('notch:pause', paused);
    send('notch:panel-open', panelOpen);
    send('notch:mic-on', micOn);
    if (status) send('notch:status', status);
    if (pendingMood !== null) {
      send('notch:mood', pendingMood);
      pendingMood = null;
    } else if (sleepy) {
      send('notch:mood', sleepy);
    }
  }

  /** The page crashed or did not load: reload it, at most once a minute. Nothing else is done about it. */
  function reloadLater() {
    if (!win || win.isDestroyed()) return;
    loaded = false;
    win.setIgnoreMouseEvents(true, { forward: true }); // a dead page cannot report that the pointer left
    loseHover();
    const reload = () => {
      reloadTimer = null;
      if (!win || win.isDestroyed()) return;
      lastReload = Date.now();
      win.reload();
    };
    const wait = lastReload === null ? 0 : Math.max(0, RELOAD_MS - (Date.now() - lastReload));
    clearTimeout(reloadTimer);
    if (wait === 0) reload();
    else reloadTimer = setTimeout(reload, wait);
  }

  /**
   * Send to the page. While it is not loaded (a reload after a crash, say) only the latest mood is kept, to be sent
   * once it is ready: a say would be stale by then, and onLoaded() tells the page the layout and whether to be paused.
   * A page whose process has just died counts as not loaded too, and a send that throws because of it is caught here,
   * as in the floating buddy's window.
   */
  function send(channel, value) {
    if (!win || win.isDestroyed()) return;
    const contents = win.webContents;
    if (loaded && !contents.isDestroyed() && !contents.isCrashed()) {
      try {
        contents.send(channel, value);
        return;
      } catch (err) {
        console.warn('[buddy] the notch page could not be reached:', err.code || err.name);
      }
    }
    if (channel === 'notch:mood') pendingMood = value;
  }

  function stopCursor() {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }

  function startCursor() {
    stopCursor();
    cursorTimer = setInterval(() => {
      if (!win || win.isDestroyed() || !win.isVisible()) return;
      const p = screen.getCursorScreenPoint();
      if (lastCursor && p.x === lastCursor.x && p.y === lastCursor.y) return;
      lastCursor = p;
      const b = win.getBounds();
      send('notch:cursor', { dx: p.x - (b.x + b.width / 2), dy: p.y - (b.y + b.height / 2) });
    }, CURSOR_MS);
  }

  return {
    window: () => win,
    /** Over `notch` (a rectangle in screen points) on `display`; the window is made the first time. */
    show(notch, display) {
      shown = { notch, display };
      if (!win) create();
      paused = false;
      win.setBounds(notchWindowBounds(notch));
      send('notch:layout', layout(notch));
      win.showInactive();
      send('notch:pause', false);
      startCursor();
    },
    hide() {
      paused = true;
      loseHover();
      if (win) win.hide();
      send('notch:pause', true);
      stopCursor();
    },
    isVisible: () => Boolean(win && win.isVisible()),
    /** Throw the window away (home.js, when Buddy leaves the notch for good); the next show() makes a new one. */
    destroy() {
      const w = win;
      if (!w) return;
      if (!w.isDestroyed()) w.destroy(); // its 'closed' forgets it; if that does not come, forget it here
      forget(w);
    },
    /** A mood for the page. Drowsy and asleep are kept for a page that loads meanwhile, as in buddy-window.js. */
    mood(name) {
      sleepy = name === 'drowsy' || name === 'asleep' ? name : null;
      send('notch:mood', name);
    },
    /** Claude Code's status beside Buddy: { kind: working | needsYou | done | failed, text }, or null for none. */
    status(next) {
      const ok = next && typeof next === 'object' && typeof next.kind === 'string';
      const value = ok ? { kind: next.kind, text: typeof next.text === 'string' ? next.text : '' } : null;
      status = value && LASTING_STATUS.includes(value.kind) ? value : null;
      send('notch:status', value);
    },
    /** As the floating buddy's: the face listens while the microphone is on, and does not fidget while the panel is open. */
    panelOpen(open) {
      panelOpen = Boolean(open);
      send('notch:panel-open', panelOpen);
    },
    micOn(on) {
      micOn = Boolean(on);
      send('notch:mic-on', micOn);
    },
    voiceLevel(level) {
      send('notch:voice-level', typeof level === 'number' ? Math.min(1, Math.max(0, level)) || 0 : 0);
    },
    /** The character changed (Settings): the face loads it again. */
    reloadModel: () => send('notch:reload'),
    /** The look changed (Settings → Buddy → "In the notch"): the page draws the shape again for it. */
    relayout() {
      if (shown) send('notch:layout', layout(shown.notch));
    },
    say: (text) => send('notch:say', text),
    pause(value) {
      paused = value;
      send('notch:pause', value);
    },
    setHover(over) {
      hovered = Boolean(over);
      if (win) win.setIgnoreMouseEvents(!over, { forward: true });
    },
    /** `fn` is told when the pointer is taken off the shape for the page: the window hid, went or reloads. */
    onHoverLost(fn) {
      hoverLost.push(fn);
    },
    /** The notch the window is shown over, or null. */
    notch: () => (shown ? shown.notch : null),
  };
}

module.exports = { createNotchWindow, LOOKS };
