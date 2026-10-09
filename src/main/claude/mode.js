'use strict';

/**
 * Claude mode in the panel (live.js reads the sessions, terminal.js types into them). The page first asks which
 * sessions are running (sessions()), the person picks one (open(id)), and from then on the page gets that session's
 * whole view on 'panel:claude-state' whenever it changes: its file is read again every second while it is open, and at
 * once on each hook event. What the person sends (talk()) is typed into the session's terminal; where Buddy cannot type
 * into it, the words are copied instead and the answer says so.
 *
 * With `remote` (signed in), the list also has the sessions the person's other computers share (share.js, through
 * Buddy's server): such a session is looked at on the server every second and a half while it is open, and words for it
 * go to its computer, which types them there.
 */

const { BuddyError } = require('../../../shared/errors');

const READ_EVERY_MS = 1000;
const LOOK_EVERY_MS = 1500; // a session on another computer, through the server
const GONE = 'That session is not running any more. Pick another one.';

/**
 * `send(state)` gives the page a session's view; `clipboard` is Electron's (writeText). `remote` is { available(),
 * look(sessionId), send(sessionId, text), stop() } over cloud.js's calls, or null. The timers are passed in by the unit
 * tests.
 */
function createClaudeMode({ live, terminal, clipboard, send, remote = null, every = setInterval, stopEvery = clearInterval }) {
  let openId = null;
  let openRemote = null; // the other computer's session that is open: { id, name, status, canTalk, device }
  let timer = null;

  live.onChange((id) => {
    if (id === openId && !openRemote) send(live.view(id));
  });

  function stopReading() {
    if (timer) stopEvery(timer);
    timer = null;
  }

  /** The view of a session on another computer, from the server's answer: its items once that computer sent them. */
  function remoteView(session, feed) {
    const view = feed ?? { ...session, items: [] };
    return {
      id: session.id, name: view.name, title: view.title ?? session.title ?? null, status: view.status, canTalk: view.canTalk,
      device: session.device, remote: true, waiting: !feed, items: view.items,
    };
  }

  async function lookAt(id) {
    const r = await remote.look(id);
    const session = (r.sessions || []).find((s) => s.id === id);
    if (!session) throw new BuddyError('not_found', GONE);
    openRemote = session;
    return remoteView(session, r.feed);
  }

  function close() {
    if (openRemote) remote.stop().catch(() => {}); // the server lets the watch lapse by itself anyway
    openId = null;
    openRemote = null;
    stopReading();
  }

  return {
    /** The sessions running here, then those on the person's other computers (`remote`, with their `device`). */
    async sessions() {
      await live.discover();
      const here = live.list().map((s) => ({ ...s, remote: false }));
      if (!remote?.available()) return { sessions: here };
      try {
        const r = await remote.look(null);
        return { sessions: [...here, ...(r.sessions || []).map((s) => ({ ...s, remote: true }))] };
      } catch (err) {
        console.warn("[buddy] could not list the other computers' sessions:", err.code || err.message);
        return { sessions: here };
      }
    },

    /** Show a session: its view as it is now, and from then on whenever it changes. */
    async open(id) {
      if (typeof id !== 'string') throw new BuddyError('bad_request', GONE);
      close();
      if (live.view(id)) {
        openId = id;
        await live.refresh(id);
        timer = every(() => {
          if (openId && !openRemote) live.refresh(openId).catch(() => {});
        }, READ_EVERY_MS);
        timer.unref?.();
        return { session: live.view(id) };
      }
      if (!remote?.available()) throw new BuddyError('bad_request', GONE);
      const view = await lookAt(id);
      openId = id;
      timer = every(() => {
        if (openId !== id || !openRemote) return;
        lookAt(id).then((next) => {
          if (openId === id) send(next);
        }, (err) => {
          // Gone from its computer (or that computer stopped sharing): the page goes back to the list and says why.
          if (openId !== id || err.code !== 'not_found') return;
          close();
          send({ id, gone: true, message: err.message });
        });
      }, LOOK_EVERY_MS);
      timer.unref?.();
      return { session: view };
    },

    /** The page went back to the list, or the panel closed: no more reading. */
    close,

    /**
     * Type `text` into the session's terminal and press Enter: { typed: true }. When Buddy cannot, the text is copied
     * and the answer is { typed: false, message } with what to do. For a session on another computer the words go to
     * that computer, which types them there: { typed: true, remote: true }.
     */
    async talk(id, text) {
      if (openRemote && id === openId) {
        await remote.send(id, text);
        return { typed: true, remote: true };
      }
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

module.exports = { READ_EVERY_MS, LOOK_EVERY_MS, GONE, createClaudeMode };
