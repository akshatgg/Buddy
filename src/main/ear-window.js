'use strict';

/**
 * Buddy's ear: a hidden window whose page speaks (speechSynthesis), listens (the microphone, only while a command
 * runs) and recognises yes or no on the device (vosk). Made on first use, closed `idleMs` after the last call (unless
 * kept), made again after a crash. Main sends the page `ear:do` { id, cmd, args } and `ear:stop`; the page answers
 * `ear:done` { id, result }, accepted only from this window's own page. Commands: say, hear, listen (ear.js).
 */

const path = require('node:path');
const { MY_VOICE } = require('../../shared/my-voice');

const ERR_ABORTED = -3; // a load that was cancelled rather than one that failed
const CALL_LIMIT_MS = 120000; // a page that never answers is gone, whatever else
// The longest phrase clip taken (MY_VOICE.maxPhraseMs of 16 kHz PCM16 as base64); a longer one is not a clip.
const MAX_PHRASE_CHARS = Math.ceil((MY_VOICE.maxPhraseMs * 16 * 2) / 3) * 4;

const phraseOf = (v) => (typeof v === 'string' && v.length <= MAX_PHRASE_CHARS ? v : null);

function createEarWindow({ BrowserWindow, ipcMain, idleMs = 120000, model = null }) {
  let win = null;
  let ready = null;
  let idleTimer = null;
  let kept = false;
  let nextId = 1;
  const pending = new Map(); // id -> { resolve, timer }
  const listeners = { woke: [], request: [], gone: [] }; // main's ears on the wake loop (wake.js)
  let wakeArgs = null; // what the page was last told to listen for, sent again to a page made after a crash

  const mine = (sender) => Boolean(win) && !win.isDestroyed() && sender === win.webContents;

  function settle(id, result) {
    const p = pending.get(id);
    if (!p) return;
    pending.delete(id);
    clearTimeout(p.timer);
    p.resolve(result);
    if (!pending.size) armIdle();
  }

  function goneAll() {
    for (const id of [...pending.keys()]) settle(id, { gone: true });
  }

  function goneOne(id) {
    stopPage();
    settle(id, { gone: true });
  }

  function stopPage() {
    if (win && !win.isDestroyed()) {
      try {
        win.webContents.send('ear:stop');
      } catch {
        /* the page is gone */
      }
    }
  }


  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = null;
    if (kept || pending.size || !win) return;
    idleTimer = setTimeout(() => close(), idleMs);
  }

  function forget(w) {
    if (win !== w) return;
    clearTimeout(idleTimer);
    win = null;
    ready = null;
    goneAll();
    if (wakeArgs) for (const fn of listeners.gone) fn(); // the loop's page is gone
  }

  function drop(w) {
    if (!w.isDestroyed()) w.destroy();
    forget(w);
  }

  function create() {
    const w = new BrowserWindow({
      width: 200,
      height: 100,
      show: false,
      skipTaskbar: true,
      focusable: false,
      webPreferences: {
        preload: path.join(__dirname, '..', 'preload', 'ear.js'),
        sandbox: true,
        contextIsolation: true,
        backgroundThrottling: false,
      },
    });
    win = w;
    w.on('closed', () => forget(w));
    const contents = w.webContents;
    contents.on('will-navigate', (event) => event.preventDefault?.());
    contents.setWindowOpenHandler(() => ({ action: 'deny' }));
    contents.on('did-fail-load', (_event, code, description, _url, isMainFrame) => {
      console.error('[buddy] the ear page failed to load:', code, description);
      if (isMainFrame && code !== ERR_ABORTED) drop(w);
    });
    contents.on('render-process-gone', (_event, details) => {
      console.error('[buddy] the ear page crashed:', details?.reason);
      drop(w);
    });
    ready = w.loadFile(path.join(__dirname, '..', 'renderer', 'ear', 'index.html')).catch((err) => {
      console.error('[buddy] could not load the ear page:', err.message);
      drop(w);
    });
  }

  function close() {
    if (win && !win.isDestroyed()) win.close();
  }

  // The always-on wake loop (ear.js): the page says it heard the phrase, and sends the request that followed.
  ipcMain.on('ear:woke', (event, msg) => {
    if (mine(event?.sender)) for (const fn of listeners.woke) fn({ phrase: phraseOf(msg?.phrase) });
  });
  ipcMain.on('ear:request', (event, msg) => {
    if (!mine(event?.sender)) return;
    const audio = msg && typeof msg.audio === 'string' && msg.audio ? msg.audio : null;
    const phrase = phraseOf(msg?.phrase);
    for (const fn of listeners.request) fn({ audio, phrase });
  });

  ipcMain.on('ear:done', (event, msg) => {
    if (!mine(event?.sender) || !msg) return;
    settle(msg.id, msg.result && typeof msg.result === 'object' ? msg.result : {});
  });

  // The page asks for the model's bytes (to make its recognizer); nothing else gets them.
  ipcMain.handle('ear:model', async (event) => {
    try {
      if (!mine(event?.sender) || !model || !model.ready()) return {};
      const buf = await model.bytes();
      return { bytes: buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
    } catch {
      return {};
    }
  });

  return {
    window: () => win,
    close,
    keep(on) {
      kept = Boolean(on);
      if (kept) {
        clearTimeout(idleTimer);
        idleTimer = null;
      } else armIdle();
    },
    stop: stopPage,
    /** Listens for events from the wake loop: 'woke' ({ phrase }), 'request' ({ audio, phrase }; audio may be null; phrase is base64 PCM16 of the wake phrase or null) and 'gone' (the window went while the loop ran). */
    on(event, fn) {
      if (listeners[event]) listeners[event].push(fn);
    },
    /**
     * Starts the always-on wake loop ({ phrases, floor, testOnly }) or, with null, ends it. It runs beside the commands:
     * the page pauses it while one runs and goes on after. Only a window made for the loop (or already there) is used:
     * ending the loop never makes one.
     */
    async wake(args) {
      wakeArgs = args;
      if (!args && !win) return;
      try {
        clearTimeout(idleTimer);
        idleTimer = null;
        if (!win) create();
        const w = win;
        await ready;
        if (w !== win || wakeArgs !== args) return;
        w.webContents.send('ear:wake', args);
      } catch (err) {
        console.error('[buddy] the ear:', err.message);
      }
    },
    /** Never rejects: a page that is gone answers { gone: true }. */
    async call(cmd, args) {
      clearTimeout(idleTimer);
      idleTimer = null;
      try {
        if (!win) create();
        const w = win;
        const id = nextId++;
        const answer = new Promise((resolve) => {
          pending.set(id, { resolve, timer: setTimeout(() => goneOne(id), CALL_LIMIT_MS) });
        });
        await ready;
        if (w !== win) return answer; // dropped while loading: goneAll has answered it
        w.webContents.send('ear:do', { id, cmd, args });
        return await answer;
      } catch (err) {
        console.error('[buddy] the ear:', err.message);
        goneAll();
        return { gone: true };
      }
    },
  };
}

module.exports = { createEarWindow };
