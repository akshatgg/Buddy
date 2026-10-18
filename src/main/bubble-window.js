'use strict';

/**
 * A short speech bubble beside the buddy ("Copied — press ⌘V", or Ctrl+V on Windows), whose clicks pass through it; and
 * the speech bubble of a hands-free answer (speak), bigger, which wraps and opens the chat on a click.
 */

const path = require('node:path');
const { BrowserWindow: ElectronWindow } = require('electron');
const { BUBBLE_HIDE_MS } = require('../../shared/voice-words');
const { BUBBLE, bubbleBounds, speechBounds } = require('./geometry');
const { speechUnderNotch } = require('./notch-geometry');
const { floatingType } = require('./platform');

const SHOW_MS = 2600;
const BUBBLE_BUTTONS = ['stop', 'yes', 'no', 'go-on'];
// A job's speech bubble with buttons stays up this long at most: longer than its longest wait (a hand-over, 120 s).
const BUTTONS_HOLD_MS = 130_000;

// The error code of a load that was cancelled rather than one that failed.
const ERR_ABORTED = -3;

function createBubbleWindow({ ipcMain = null, onClick = () => {}, onButton = () => {}, cursor = () => null, BrowserWindow = ElectronWindow } = {}) {
  let win = null;
  let ready = null;
  let timer = null;
  let speech = false; // the words up are a hands-free answer's (speak): they take the pointer, and a click opens the chat
  let held = false; // a job's words with buttons are up: release() and say() leave them (speak without buttons ends it)
  let showing = Promise.resolve(); // the last speak's show, which release() waits for

  /** Forget a window that is gone, so that the next say() builds a new one. */
  function forget(w) {
    if (win !== w) return;
    clearTimeout(timer); // its hide timer would otherwise reach into a window that no longer exists
    win = null;
    ready = null;
    speech = false;
    held = false;
  }

  /** Throw a window away because its page crashed or did not load, so that the next say() builds a new one. */
  function drop(w) {
    if (!w.isDestroyed()) w.destroy();
    forget(w);
  }

  function create() {
    const w = new BrowserWindow({
      ...BUBBLE,
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
        preload: path.join(__dirname, '..', 'preload', 'bubble.js'),
        sandbox: true,
        contextIsolation: true,
      },
    });
    win = w;
    w.setAlwaysOnTop(true, 'pop-up-menu');
    w.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    w.setIgnoreMouseEvents(true);
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    contents.on('will-navigate', (event) => event.preventDefault());
    contents.setWindowOpenHandler(() => ({ action: 'deny' })); // the page shows only its own content: no pop-ups either
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      console.error('[buddy] the bubble page failed to load:', code, description);
      // A cancelled load or a failure in a sub-frame leaves the page as it was: only a real failure drops the window.
      if (isMainFrame && code !== ERR_ABORTED) drop(w);
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the bubble page crashed:', details.reason);
      drop(w);
    });
    ready = w.loadFile(path.join(__dirname, '..', 'renderer', 'bubble', 'index.html')).catch((err) => {
      console.error('[buddy] could not load the bubble page:', err.message);
      drop(w); // the load failed, whether or not did-fail-load was emitted for it
    });
  }

  if (ipcMain) {
    const fromPage = (event) => Boolean(win) && event.sender === win.webContents;
    // Over the words of a speech bubble the window takes the pointer; elsewhere clicks go through, as for the buddy.
    ipcMain.on('bubble:hover', (event, over) => {
      if (fromPage(event) && speech) win.setIgnoreMouseEvents(over !== true, { forward: true });
    });
    ipcMain.on('bubble:click', (event) => {
      if (fromPage(event) && speech) onClick();
    });
    ipcMain.on('bubble:button', (event, name, token) => {
      if (fromPage(event) && speech && BUBBLE_BUTTONS.includes(name)) onButton(name, typeof token === 'string' ? token : undefined);
    });
  }

  /** Shows `text` at `bounds`; `asSpeech` for a hands-free answer's. Answers the window, or null when it went meanwhile. */
  async function show(text, bounds, asSpeech, buttons = [], token = null) {
    if (!win) create();
    const w = win;
    await ready;
    if (w !== win) return null; // the window was closed or dropped (a crash, a failed load) while its page was loading
    clearTimeout(timer);
    speech = asSpeech;
    // A pointer resting where the words appear sends no mouseenter: the window takes the pointer from the start then.
    const p = asSpeech ? cursor() : null;
    const under = Boolean(p) && p.x >= bounds.x && p.x < bounds.x + bounds.width && p.y >= bounds.y && p.y < bounds.y + bounds.height;
    w.setIgnoreMouseEvents(!under, asSpeech ? { forward: true } : {});
    w.setBounds(bounds);
    w.webContents.send('bubble:text', text, asSpeech, ...(buttons.length ? [buttons] : []), ...(buttons.length && token ? [token] : []));
    w.showInactive();
    return w;
  }

  return {
    window: () => win,
    /** Never rejects: whoever asks for a bubble cannot do anything about one that fails, so it is logged. */
    async say(text, buddyBounds, area) {
      try {
        if (held) return; // a job's question or Stop button is up: it wins
        const w = await show(text, bubbleBounds(buddyBounds, area), false);
        if (w) timer = setTimeout(() => w.hide(), SHOW_MS);
      } catch (err) {
        console.error('[buddy] could not show the bubble:', err);
      }
    },
    /**
     * A hands-free answer's words, held up until release(): beside the floating buddy, or under the notch (`at` is
     * home.panelAt()). Null keeps the words up. Never rejects.
     */
    async speak(text, at, buttons = [], token = null) {
      if (text === null) {
        if (speech && !held) clearTimeout(timer);
        return;
      }
      const bounds = at.kind === 'below' ? speechUnderNotch(at.notch, at.area, buttons.length > 0) : speechBounds(at.buddy, at.area, buttons.length > 0);
      showing = show(text, bounds, true, buttons, token)
        .then((w) => {
          held = Boolean(w) && buttons.length > 0;
          if (held) timer = setTimeout(() => { held = false; if (!w.isDestroyed()) w.hide(); }, BUTTONS_HOLD_MS);
        })
        .catch((err) => console.error('[buddy] could not show the speech bubble:', err));
      await showing;
    },
    /** Buddy stopped speaking: the speech bubble goes BUBBLE_HIDE_MS later (a new speak keeps it). */
    release() {
      showing.then(() => {
        if (!speech || !win || held) return; // a job's words with buttons wait for the job
        const w = win;
        clearTimeout(timer);
        timer = setTimeout(() => w.hide(), BUBBLE_HIDE_MS);
      });
    },
    /** The chat is on screen: its words are there now. */
    hide() {
      held = false;
      clearTimeout(timer);
      if (win && !win.isDestroyed()) win.hide();
    },
  };
}

module.exports = { createBubbleWindow, BUBBLE_BUTTONS, BUTTONS_HOLD_MS };
