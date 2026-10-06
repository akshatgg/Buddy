'use strict';

/**
 * What happens when the user works with the panel, in the order the system needs:
 * grab their selection before the panel takes the screen, run the AI, and put
 * the answer back into the app they came from -- or on the clipboard when
 * that is not possible. The panel holds the keyboard focus while it is open, so
 * it steps aside whenever the helper has to read from or type into that app.
 */

const { BuddyError } = require('../../shared/errors');
const { AI_TIMEOUT_MS } = require('./ai');
const platform = require('./platform');

const COPIED = `Copied — press ${platform.pasteKeys}`;
const SLEEPY_MS = 5000;
const EMPTY_BOX = 'That box looks empty.';
const UNREADABLE = "I couldn't read your selection — select it again or paste it here.";

/**
 * `helperMovesFocus` and `newline` are the system's (platform.js); tests pass either system's. On Windows `ui` also
 * has panelWindowHandle(): the panel window's handle, for the helper to bring it forward.
 */
function createActions({
  helper,
  ai,
  clipboard,
  store,
  ui,
  later = setTimeout,
  cancelLater = clearTimeout,
  helperMovesFocus = platform.helperMovesFocus,
  newline = platform.newline,
}) {
  let session = { app: null, selection: '', wholeBox: false };
  let opening = null; // the open() in progress, if any
  let capturing = false; // wholeBox() is reading the app, with the panel hidden on purpose
  let sleepy = null; // the pending "back to idle" timer after a network error, if any

  /** Text as it goes on the clipboard, with the system's line breaks. */
  const forClipboard = (text) => (newline === '\n' ? text : text.replace(/\r?\n/g, newline));

  /** What the panel opens with: the buddy's name, the app it came from, the text, and the tab and notice to show. */
  function panelState({ selection, tab, notice }) {
    return {
      buddyName: store.get('buddyName') || 'Buddy',
      appName: session.app?.name || '',
      selection,
      tab,
      notice,
    };
  }

  async function openPanel() {
    const app = helper.lastApp;
    let selection = '';
    let notice = '';
    let tab = 'write';
    if (app) {
      try {
        const r = await helper.call('captureSelection', { pid: app.pid, selectAll: false });
        selection = r.text || '';
        if (selection) tab = 'fix';
      } catch (err) {
        if (err.code === 'secure_field') {
          notice = err.message;
        } else if (err.code === 'no_accessibility') {
          notice = 'Allow Accessibility in Settings so I can read and paste your text.';
        } else {
          console.warn('[buddy] could not read the selection:', err.code);
          notice = UNREADABLE;
          tab = 'fix'; // the notice says to paste the text here, and that is the Fix box
        }
      }
    }
    session = { app, selection, wholeBox: false };
    await showPanel(panelState({ selection, tab, notice }));
  }

  /**
   * Show the panel. On Windows it may open without the keyboard, which then stays in the person's app, where their
   * text is still selected: the helper, which Windows lets bring a window to the front, brings the panel forward.
   */
  async function showPanel(state) {
    await ui.showPanel(state);
    if (!helperMovesFocus) return;
    const hwnd = ui.panelWindowHandle();
    if (hwnd === null) return;
    try {
      await helper.call('focusWindow', { hwnd });
    } catch (err) {
      console.warn('[buddy] could not bring the panel forward:', err.code);
    }
  }

  /**
   * Close the panel: Esc, its close button, the shortcut, or a click on the buddy. macOS gives the keyboard back to
   * the app below by itself; Windows leaves it with the hidden panel, so there the helper brings that app back.
   */
  async function dismiss() {
    ui.hidePanel();
    if (!helperMovesFocus || !session.app) return;
    try {
      await helper.call('activate', { pid: session.app.pid });
    } catch (err) {
      console.warn('[buddy] could not switch back to the app:', err.code);
    }
  }

  /** One opening at a time: asking again while the selection is still being read joins the one in progress. */
  function open() {
    if (!opening) {
      opening = openPanel().finally(() => {
        opening = null;
      });
    }
    return opening;
  }

  async function toggle() {
    if (capturing) return; // the panel is hidden on purpose while the box is read, and comes back by itself
    if (ui.isPanelVisible()) {
      await dismiss();
      return;
    }
    if (ui.panelJustClosed()) return; // the click that closed it (on the Mac, by taking its focus) must not reopen it
    await open();
  }

  /**
   * Read everything in the box the user was writing in. The panel has the keyboard
   * focus, so the helper's ⌘A and ⌘C (Ctrl+A and Ctrl+C on Windows) would land in
   * the panel itself (and bringing the app forward would blur it): it is hidden while
   * the box is read, and shown again either way, with the text or with the reason it
   * could not be read. Until it is back, toggle() does nothing: a click on the buddy
   * would open a second panel.
   */
  async function wholeBox() {
    const app = session.app;
    if (!app) throw new BuddyError('no_app', 'Click in the box you are writing in, then open me again.');
    capturing = true;
    try {
      return await readWholeBox(app);
    } finally {
      capturing = false;
    }
  }

  async function readWholeBox(app) {
    const before = session.selection;
    ui.hidePanel();
    let state;
    try {
      const r = await helper.call('captureSelection', { pid: app.pid, selectAll: true });
      const text = r.text || '';
      session = { ...session, selection: text, wholeBox: true };
      state = panelState({ selection: text, tab: 'fix', notice: text ? '' : EMPTY_BOX });
      return { text };
    } catch (err) {
      state = panelState({ selection: before, tab: 'fix', notice: err.message });
      throw err;
    } finally {
      await showPanel(state);
    }
  }

  async function run(action, input) {
    if (sleepy !== null) {
      cancelLater(sleepy); // it would flip a busy or happy buddy back to idle
      sleepy = null;
    }
    ui.mood('thinking');
    try {
      const out = await ai.ask(action, input, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
      ui.mood('happy');
      return out;
    } catch (err) {
      if (err.code === 'network') {
        ui.mood('sleepy');
        sleepy = later(() => {
          sleepy = null;
          ui.mood('idle');
        }, SLEEPY_MS);
      } else {
        ui.mood('idle');
      }
      throw err;
    }
  }

  async function screenshot() {
    if (!session.app) throw new BuddyError('no_app', 'Open me from the app you want me to check.');
    return helper.call('screenshot', { pid: session.app.pid });
  }

  /** mode: 'insert' at the cursor, 'replace' what the text came from, 'replaceAll' of the box. */
  async function insert(text, mode) {
    ui.hidePanel();
    if (session.app) {
      const selectAll = mode === 'replaceAll' || (mode === 'replace' && session.wholeBox);
      try {
        await helper.call('paste', { pid: session.app.pid, text, selectAll });
        return { pasted: true };
      } catch (err) {
        // Could not paste: fall back to the clipboard below.
        console.warn('[buddy] paste failed, copied instead:', err.code);
      }
    }
    // Electron's clipboard writes are asynchronous: say "copied" only once the text is there.
    await clipboard.writeText(forClipboard(text));
    ui.bubble(COPIED);
    return { copied: true };
  }

  async function copy(text) {
    await clipboard.writeText(forClipboard(text));
    ui.bubble('Copied');
    return { copied: true };
  }

  return { open, toggle, dismiss, wholeBox, run, screenshot, insert, copy, session: () => session };
}

module.exports = { createActions, COPIED, SLEEPY_MS };
