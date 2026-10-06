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

function createBuddyWindow({ store, screen, animate = true }) {
  let win = null;
  let ready = Promise.resolve();
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
    win.webContents.on('render-process-gone', () => win.reload());
    ready = win.loadFile(path.join(__dirname, '..', 'renderer', 'buddy', 'index.html'));
  }

  /** Send to the page once it has loaded, so a mood sent at launch is not lost. */
  function send(channel, value) {
    if (!win) return;
    ready
      .then(() => {
        if (!win.isDestroyed()) win.webContents.send(channel, value);
      })
      .catch(() => {});
  }

  function stopCursor() {
    clearInterval(cursorTimer);
    cursorTimer = null;
  }

  function startCursor() {
    stopCursor();
    cursorTimer = setInterval(() => {
      if (!win || !win.isVisible()) return;
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
      win.showInactive();
      send('buddy:pause', false);
      startCursor();
    },
    hide() {
      if (win) win.hide();
      send('buddy:pause', true);
      stopCursor();
    },
    isVisible: () => Boolean(win && win.isVisible()),
    bounds,
    display: () => screen.getDisplayMatching(bounds()),
    mood: (name) => send('buddy:mood', name),
    pause: (paused) => send('buddy:pause', paused),
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
