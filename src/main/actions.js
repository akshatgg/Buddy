'use strict';

/**
 * What happens when the user works with the panel, in the order the Mac needs:
 * grab their selection before the panel takes the screen, run the AI, and put
 * the answer back into the app they came from -- or on the clipboard when
 * that is not possible.
 */

const { BuddyError } = require('../../shared/errors');

const COPIED = 'Copied — press ⌘V';
const SLEEPY_MS = 5000;

function createActions({ helper, ai, clipboard, store, ui, later = setTimeout }) {
  let session = { app: null, selection: '', wholeBox: false };

  async function open() {
    const app = helper.lastApp;
    let selection = '';
    let notice = '';
    if (app) {
      try {
        const r = await helper.call('captureSelection', { pid: app.pid, selectAll: false });
        selection = r.text || '';
      } catch (err) {
        if (err.code === 'secure_field') notice = err.message;
        if (err.code === 'no_accessibility') notice = 'Allow Accessibility in Settings so I can read and paste your text.';
      }
    }
    session = { app, selection, wholeBox: false };
    await ui.showPanel({
      buddyName: store.get('buddyName') || 'Buddy',
      appName: app?.name || '',
      selection,
      tab: selection ? 'fix' : 'write',
      notice,
    });
  }

  async function toggle() {
    if (ui.isPanelVisible() || ui.panelJustClosed()) {
      ui.hidePanel();
      return;
    }
    await open();
  }

  async function wholeBox() {
    if (!session.app) throw new BuddyError('no_app', 'Click in the box you are writing in, then open me again.');
    const r = await helper.call('captureSelection', { pid: session.app.pid, selectAll: true });
    session = { ...session, selection: r.text || '', wholeBox: true };
    return { text: session.selection };
  }

  async function run(action, input) {
    ui.mood('thinking');
    try {
      const out = await ai.ask(action, input);
      ui.mood('happy');
      return out;
    } catch (err) {
      if (err.code === 'network') {
        ui.mood('sleepy');
        later(() => ui.mood('idle'), SLEEPY_MS);
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
      } catch {
        // Could not paste: fall back to the clipboard below.
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
