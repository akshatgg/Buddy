'use strict';

/**
 * Claude mode in the panel (live.js reads the sessions, terminal.js types into them). The page first asks which
 * sessions are running (sessions()), the person picks one (open(id)), and from then on the page gets that session's
 * whole view on 'panel:claude-state' whenever it changes: its file is read again every second while it is open, and at
 * once on each hook event. What the person sends (talk()) is typed into the session's terminal; where Buddy cannot type
 * into it, the words are copied instead and the answer says so.
 */

const { BuddyError } = require('../../../shared/errors');

const READ_EVERY_MS = 1000;
const GONE = 'That session is not running any more. Pick another one.';

/**
 * `send(state)` gives the page a session's view; `clipboard` is Electron's (writeText). The timers are passed in by
 * the unit tests.
 */
function createClaudeMode({ live, terminal, clipboard, send, every = setInterval, stopEvery = clearInterval }) {
  let openId = null;
  let timer = null;

  live.onChange((id) => {
    if (id === openId) send(live.view(id));
  });

  function stopReading() {
    if (timer) stopEvery(timer);
    timer = null;
  }

  return {
    /** The sessions running now, newest first ({ id, name, status, canTalk }). */
    async sessions() {
      await live.discover();
      return { sessions: live.list() };
    },

    /** Show a session: its view as it is now, and from then on whenever it changes. */
    async open(id) {
      if (typeof id !== 'string' || !live.view(id)) throw new BuddyError('bad_request', GONE);
      openId = id;
      stopReading();
      await live.refresh(id);
      timer = every(() => {
        if (openId) live.refresh(openId).catch(() => {});
      }, READ_EVERY_MS);
      timer.unref?.();
      return { session: live.view(id) };
    },

    /** The page went back to the list, or the panel closed: no more reading. */
    close() {
      openId = null;
      stopReading();
    },

    /**
     * Type `text` into the session's terminal and press Enter: { typed: true }. When Buddy cannot, the text is copied
     * and the answer is { typed: false, message } with what to do.
     */
    async talk(id, text) {
      const target = typeof id === 'string' ? live.target(id) : null;
      if (!target) throw new BuddyError('bad_request', GONE);
      try {
        await terminal.type({ tty: target.tty, text });
        return { typed: true };
      } catch (err) {
        if (!(err instanceof BuddyError) || err.code === 'bad_request') throw err;
        await clipboard.writeText(String(text));
        return { typed: false, message: err.message };
      }
    },

    isOpen: () => openId !== null,
  };
}

module.exports = { READ_EVERY_MS, GONE, createClaudeMode };
