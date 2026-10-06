'use strict';

/**
 * The buddy itself: a small see-through window that floats over every app.
 *
 * It never takes focus (type 'panel', focusable false), so clicking it leaves
 * the user's app in front -- which is what lets the panel paste back into it.
 * Clicks on its empty corners pass through to whatever is underneath: the
 * page reports when the pointer is over the character (buddy:hover), and only
 * then does the window stop ignoring the mouse.
 */

const path = require('node:path');
const { BrowserWindow } = require('electron');
const { buddyWindowSize, clampToArea, defaultBounds, snapToEdge, resizeAround } = require('./geometry');

const CURSOR_MS = 66; // about 15 updates a second is plenty for a head turn
const MAX_CRASHES = 3; // this many page crashes within CRASH_WINDOW_MS and we stop reloading it
const CRASH_WINDOW_MS = 60_000;

function createBuddyWindow({ store, screen, animate = true }) {
  let win = null;
  let loaded = false; // the page has finished loading, so it can take messages
  let pendingMood = null; // the latest mood sent while the page was not loaded
  let paused = false; // what a freshly loaded page is told
  let crashes = []; // when the page crashed, within the last CRASH_WINDOW_MS
  let drag = { dx: 0, dy: 0 };
  let cursorTimer = null;
  let lastCursor = null;

  function startBounds() {
    const size = buddyWindowSize(store.get('size'));
    const display = screen.getAllDisplays().find((d) => d.id === store.get('lastDisplayId'))
      || screen.getPrimaryDisplay();
    const saved = store.get('positions')[String(display.id)];
    const bounds = saved ? { x: saved.x, y: saved.y, ...size } : defaultBounds(display.workArea, size);
    return clampToArea(bounds, display.workArea);
  }

  function create() {
    loaded = false;
    win = new BrowserWindow({
      ...startBounds(),
      type: 'panel',
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
    // A failure is reported by did-fail-load above; this only keeps it from going unhandled.
    win.loadFile(path.join(__dirname, '..', 'renderer', 'buddy', 'index.html')).catch(() => {});
  }

  /** Every load starts a page that knows nothing: not the pointer, not whether to animate, not the mood. */
  function onLoaded() {
    if (win.isDestroyed()) return;
    loaded = true;
    win.setIgnoreMouseEvents(true, { forward: true }); // a fresh page starts without hover
    send('buddy:pause', paused);
    if (pendingMood !== null) {
      send('buddy:mood', pendingMood);
      pendingMood = null;
    }
  }

  function onCrash(details) {
    if (win.isDestroyed()) return;
    loaded = false;
    win.setIgnoreMouseEvents(true, { forward: true }); // a dead page cannot report that the pointer left
    console.error('[buddy] the page crashed:', details.reason);
    const now = Date.now();
    crashes = [...crashes.filter((t) => now - t < CRASH_WINDOW_MS), now];
    if (crashes.length < MAX_CRASHES) {
      win.reload();
    } else {
      console.error(`[buddy] the page crashed ${MAX_CRASHES} times within a minute; not reloading it again`);
    }
  }

  /**
   * Send to the page. While it is not loaded (launch, reload, after a crash)
   * only the latest mood is kept, to be sent once it is ready; the rest would
   * be stale by then, and onLoaded() tells the page whether to be paused.
   */
  function send(channel, value) {
    if (!win || win.isDestroyed()) return;
    if (loaded) win.webContents.send(channel, value);
    else if (channel === 'buddy:mood') pendingMood = value;
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
      send('buddy:cursor', { dx: p.x - (b.x + b.width / 2), dy: p.y - (b.y + b.height / 2) });
    }, CURSOR_MS);
  }

  function remember(b) {
    const display = screen.getDisplayMatching(b);
    store.set({
      positions: { ...store.get('positions'), [String(display.id)]: { x: b.x, y: b.y } },
      lastDisplayId: display.id,
    });
  }

  const bounds = () => (win ? win.getBounds() : startBounds());

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
