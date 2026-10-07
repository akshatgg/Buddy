'use strict';

/**
 * The buddy itself: a small see-through window that floats over every app.
 *
 * It never takes focus (a panel on the Mac, a tool window on Windows, and focusable false), so clicking it leaves
 * the user's app in front -- which is what lets the panel paste back into it.
 * Clicks on its empty corners pass through to whatever is underneath: the
 * page reports when the pointer is over the character (buddy:hover), and only
 * then does the window stop ignoring the mouse.
 */

const path = require('node:path');
const { buddyWindowSize, buddyBox, windowAtBox, clampToArea, defaultBounds, snapToEdge, resizeAround } = require('./geometry');
const { floatingType } = require('./platform');

const CURSOR_MS = 66; // about 15 updates a second is plenty for a head turn
const MAX_CRASHES = 3; // this many page crashes within CRASH_WINDOW_MS and we stop reloading it
const CRASH_WINDOW_MS = 60_000;

// BrowserWindow can be passed in so tests can run without Electron; the real one is loaded only when none is.
function createBuddyWindow({ store, screen, animate = true, onGiveUp = () => {}, BrowserWindow = require('electron').BrowserWindow }) {
  let win = null;
  let loaded = false; // the page has finished loading, so it can take messages
  let pendingMood = null; // the latest mood sent while the page was not loaded
  let paused = false; // what a freshly loaded page is told
  let crashes = []; // when the page crashed, within the last CRASH_WINDOW_MS
  let drag = { dx: 0, dy: 0 };
  let cursorTimer = null;
  let lastCursor = null;

  // The window is the buddy's own box with room above it for the symbols (geometry.js). What is saved is the box's
  // top-left corner, which is also where a window from before the room was added had its own: so a position saved
  // then still puts the buddy where it was.
  function startBounds() {
    const size = buddyWindowSize(store.get('size'));
    const display = screen.getAllDisplays().find((d) => d.id === store.get('lastDisplayId'))
      || screen.getPrimaryDisplay();
    const saved = store.get('positions')[String(display.id)];
    const bounds = saved ? windowAtBox(saved, size) : defaultBounds(display.workArea, size);
    return clampToArea(bounds, display.workArea);
  }

  function create() {
    loaded = false;
    win = new BrowserWindow({
      ...startBounds(),
      type: floatingType,
      transparent: true,
      frame: false,
      hasShadow: false,
      resizable: false,
      focusable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      show: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'buddy.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.setIgnoreMouseEvents(true, { forward: true });
    const contents = win.webContents;
    // did-navigate fires when a navigation commits (the first load, a reload), so the old page is gone and the
    // new one is not ready. did-start-loading would also fire for a navigation that is refused (will-navigate
    // below), which is followed by no did-finish-load: loaded would then stay false and drop every message.
    contents.on('did-navigate', () => {
      loaded = false;
    });
    contents.on('did-finish-load', onLoaded);
    contents.on('did-fail-load', (_event, code, description) => {
      console.error('[buddy] the page failed to load:', code, description);
    });
    contents.on('render-process-gone', (_event, details) => onCrash(details));
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); // the page shows only its own content: no pop-ups either
    // A failure is reported by did-fail-load above; this only keeps it from going unhandled.
    win.loadFile(path.join(__dirname, '..', 'renderer', 'buddy', 'index.html')).catch(() => {});
  }

  /** Every load starts a page that knows nothing: not the pointer, not whether to animate, not the mood. */
  function onLoaded() {
    if (!win || win.isDestroyed()) return;
    loaded = true;
    lastCursor = null; // what was sent while it loaded was dropped, so send the pointer again even if it is still
    win.setIgnoreMouseEvents(true, { forward: true }); // a fresh page starts without hover
    send('buddy:pause', paused);
    if (pendingMood !== null) {
      send('buddy:mood', pendingMood);
      pendingMood = null;
    }
  }

  function onCrash(details) {
    if (!win || win.isDestroyed()) return;
    loaded = false;
    win.setIgnoreMouseEvents(true, { forward: true }); // a dead page cannot report that the pointer left
    console.error('[buddy] the page crashed:', details.reason);
    const now = Date.now();
    crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (crashes.length < MAX_CRASHES) win.reload();
    else giveUp();
  }

  /**
   * The page keeps crashing: stop reloading it and drop the window. Left in place it would be a blank patch that
   * still reports isVisible(), so the menu bar would offer "Hide buddy"; with no window, the next show() starts afresh.
   */
  function giveUp() {
    console.error(`[buddy] the page crashed ${MAX_CRASHES} times within a minute; not reloading it again`);
    stopCursor();
    win.destroy();
    win = null;
    loaded = false;
    paused = false;
    pendingMood = null;
    crashes = []; // a window made by a later show() gets its own reloads
    onGiveUp(); // the menu bar menu still offers "Hide buddy" until it is told
  }

  /**
   * Send to the page. While it is not loaded (launch, reload, after a crash)
   * only the latest mood is kept, to be sent once it is ready; the rest would
   * be stale by then, and onLoaded() tells the page whether to be paused.
   *
   * A page whose process has just died counts as not loaded too. Electron says
   * so (render-process-gone, then onCrash) a moment later, and the cursor timer
   * can fire in between. Sending then throws ("Render frame was disposed"), and
   * in the main process that is an uncaught error with a blocking dialog, so the
   * throw is caught here as well.
   */
  function send(channel, value) {
    if (!win || win.isDestroyed()) return;
    const contents = win.webContents;
    if (loaded && !contents.isDestroyed() && !contents.isCrashed()) {
      try {
        contents.send(channel, value);
        return;
      } catch (err) {
        console.warn('[buddy] the page could not be reached:', err.code || err.name);
      }
    }
    if (channel === 'buddy:mood') pendingMood = value;
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
      const b = buddyBox(win.getBounds()); // from the buddy's middle, not the middle of the window with its room above
      send('buddy:cursor', { dx: p.x - (b.x + b.width / 2), dy: p.y - (b.y + b.height / 2) });
    }, CURSOR_MS);
  }

  /** Save where the window `b` puts the buddy: its box's corner (see startBounds). */
  function remember(b) {
    const display = screen.getDisplayMatching(b);
    const box = buddyBox(b);
    store.set({
      positions: { ...store.get('positions'), [String(display.id)]: { x: box.x, y: box.y } },
      lastDisplayId: display.id,
    });
  }

  // Where the buddy is: its own box, without the room above it. The panel and the bubble go beside this, and the work
  // area is the one of the screen it is on. Dragging, snapping and keeping it on the screen move the whole window.
  const bounds = () => buddyBox(win ? win.getBounds() : startBounds());

  return {
    window: () => win,
    show() {
      if (!win) create();
      paused = false;
      win.showInactive();
      send('buddy:pause', false);
      startCursor();
    },
    hide() {
      paused = true;
      if (win) win.hide();
      send('buddy:pause', true);
      stopCursor();
    },
    isVisible: () => Boolean(win && win.isVisible()),
    bounds,
    display: () => screen.getDisplayMatching(bounds()),
    mood: (name) => send('buddy:mood', name),
    /**
     * How loud the voice is while the buddy listens, 0 to 1; anything that is not a number is silence. Sent about 10
     * times a second while the microphone is on, so one that a loading page misses is not kept: it is old at once.
     */
    voiceLevel(level) {
      send('buddy:voice-level', typeof level === 'number' ? Math.min(1, Math.max(0, level)) || 0 : 0);
    },
    pause(value) {
      paused = value;
      send('buddy:pause', value);
    },
    reloadModel: () => send('buddy:reload'),
    setHover(over) {
      if (win) win.setIgnoreMouseEvents(!over, { forward: true });
    },
    beginDrag(p) {
      const b = win.getBounds();
      drag = { dx: p.x - b.x, dy: p.y - b.y };
    },
    dragTo(p) {
      win.setPosition(Math.round(p.x - drag.dx), Math.round(p.y - drag.dy));
    },
    endDrag() {
      const b = win.getBounds();
      const target = snapToEdge(b, screen.getDisplayMatching(b).workArea);
      win.setBounds(target, animate);
      remember(target);
      drag = { dx: 0, dy: 0 };
    },
    resize() {
      if (!win) return;
      const b = win.getBounds();
      const next = resizeAround(b, buddyWindowSize(store.get('size')), screen.getDisplayMatching(b).workArea);
      win.setBounds(next);
      remember(next);
    },
    reclamp() {
      if (!win) return;
      const b = win.getBounds();
      const next = clampToArea(b, screen.getDisplayMatching(b).workArea);
      if (next.x !== b.x || next.y !== b.y) win.setBounds(next);
    },
  };
}

module.exports = { createBuddyWindow };
