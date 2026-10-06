'use strict';

/**
 * What happens when the user works with the panel, in the order the Mac needs:
 * grab their selection before the panel takes the screen, run the AI, and put
 * the answer back into the app they came from -- or on the clipboard when
 * that is not possible. The panel holds the keyboard focus while it is open, so
 * it steps aside whenever the helper has to read from or type into that app.
 */

const { BuddyError } = require('../../shared/errors');

const COPIED = 'Copied — press ⌘V';
const SLEEPY_MS = 5000;
const EMPTY_BOX = 'That box looks empty.';
const UNREADABLE = "I couldn't read your selection — select it again or paste it here.";

function createActions({ helper, ai, clipboard, store, ui, later = setTimeout, cancelLater = clearTimeout }) {
  let session = { app: null, selection: '', wholeBox: false };
  let opening = null; // the open() in progress, if any
  let capturing = false; // wholeBox() is reading the app, with the panel hidden on purpose
  let sleepy = null; // the pending "back to idle" timer after a network error, if any

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
    if (app) {
      try {
        const r = await helper.call('captureSelection', { pid: app.pid, selectAll: false });
        selection = r.text || '';
      } catch (err) {
        if (err.code === 'secure_field') {
          notice = err.message;
        } else if (err.code === 'no_accessibility') {
          notice = 'Allow Accessibility in Settings so I can read and paste your text.';
        } else {
          console.warn('[buddy] could not read the selection:', err.code);
          notice = UNREADABLE;
        }
      }
    }
    session = { app, selection, wholeBox: false };
    await ui.showPanel(panelState({ selection, tab: selection ? 'fix' : 'write', notice }));
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
    if (ui.isPanelVisible() || ui.panelJustClosed()) {
      ui.hidePanel();
      return;
    }
    await open();
  }

  /**
   * Read everything in the box the user was writing in. The panel has the keyboard
   * focus, so the helper's ⌘A and ⌘C would land in the panel itself (and bringing the
   * app forward would blur it): it is hidden while the box is read, and shown again
   * either way, with the text or with the reason it could not be read. Until it is
   * back, toggle() does nothing: a click on the buddy would open a second panel.
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
      await ui.showPanel(state);
    }
  }

  async function run(action, input) {
    if (sleepy !== null) {
      cancelLater(sleepy); // it would flip a busy or happy buddy back to idle
      sleepy = null;
    }
    ui.mood('thinking');
    try {
      const out = await ai.ask(action, input);
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
    clipboard.writeText(text);
    ui.bubble(COPIED);
    return { copied: true };
  }

  function copy(text) {
    clipboard.writeText(text);
    ui.bubble('Copied');
    return { copied: true };
  }

  return { open, toggle, wholeBox, run, screenshot, insert, copy, session: () => session };
}

module.exports = { createActions, COPIED, SLEEPY_MS };
