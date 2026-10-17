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
 *
 * Slash commands that act on the session (/model, /stop, /clear) come here too: the first and last are typed as Claude
 * Code's own, /stop is Esc.
 */

const { BuddyError } = require('../../../shared/errors');
const { MODELS } = require('./find');

const READ_EVERY_MS = 1000;
const LOOK_EVERY_MS = 1500; // a session on another computer, through the server
const GONE = 'That session is not running any more. Pick another one.';
const CLEAR_EVERY_MS = 500; // after /clear, Claude Code's new session is looked for this far apart…
const CLEAR_TRIES = 6; // …this many times
const CLEAR_TRIES_BUSY = 120; // …or this many when Claude was working: it takes /clear only when it is done (60 s)
const STOP_THERE = 'Stop it on that computer.';
const NO_SUCH_MODEL = (name) => `There is no model called ${name}. Try ${MODELS.slice(0, -1).join(', ')} or ${MODELS[MODELS.length - 1]}.`;

/**
 * `send(state)` gives the page a session's view; `clipboard` is Electron's (writeText). `remote` is { available(),
 * look(sessionId), send(sessionId, text), stop() } over cloud.js's calls, or null. The timers are passed in by the unit
 * tests. `saveModel(alias)` keeps a model picked with /model as Buddy's Claude Code model; `wait` is passed in by the unit tests.
 */
function createClaudeMode({
  live, terminal, clipboard, send, remote = null, saveModel = () => {}, wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  every = setInterval, stopEvery = clearInterval,
}) {
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

  /** The sessions running here, then those on the person's other computers (`remote`, with their `device`). */
  async function sessions() {
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
  }

  /** Show a session: its view as it is now, and from then on whenever it changes. */
  async function open(id) {
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
  }

  /**
   * Type `text` into the session's terminal and press Enter: { typed: true }. When Buddy cannot, the text is copied
   * and the answer is { typed: false, message } with what to do. For a session on another computer the words go to
   * that computer, which types them there: { typed: true, remote: true }.
   */
  async function talk(id, text) {
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
  }

  /** `/model <alias>`: Claude Code's own /model typed into the session (from its next message), and kept as Buddy's. */
  async function model(id, alias) {
    if (!MODELS.includes(alias)) throw new BuddyError('bad_request', NO_SUCH_MODEL(alias));
    const r = await talk(id, `/model ${alias}`);
    saveModel(alias); // the person's choice, also when the words were only copied
    return { ...r, model: alias };
  }

  /** `/stop`: Esc in the session's terminal. A session on another computer is stopped there. */
  async function stop(id) {
    if (openRemote && id === openId) throw new BuddyError('bad_request', STOP_THERE);
    const target = typeof id === 'string' ? live.target(id) : null;
    if (!target) throw new BuddyError('bad_request', GONE);
    await terminal.interrupt({ tty: target.tty });
    return { stopped: true };
  }

  /**
   * `/clear`: typed into the session. Claude Code then starts a new session (a new id and file) in the same terminal,
   * which is looked for by its tty and opened: { typed, session }. None found: the page goes back to the list (null).
   */
  async function clear(id) {
    if (openRemote && id === openId) {
      await remote.send(id, '/clear');
      close();
      return { typed: true, remote: true, session: null };
    }
    const target = typeof id === 'string' ? live.target(id) : null;
    if (!target) throw new BuddyError('bad_request', GONE);
    const busy = live.view(id)?.status === 'working';
    const before = new Set(live.list().map((s) => s.id)); // the new session is one not there yet
    const r = await talk(id, '/clear');
    if (!r.typed) return { ...r, session: null };
    for (let i = 0; i < (busy ? CLEAR_TRIES_BUSY : CLEAR_TRIES); i += 1) {
      await wait(CLEAR_EVERY_MS);
      if (openId !== id) return { typed: true, session: null }; // the person opened another session or left: theirs stays
      await live.discover();
      const next = live.list().find((s) => !before.has(s.id) && live.target(s.id)?.tty === target.tty);
      if (next) return { typed: true, ...(await open(next.id)) };
    }
    if (openId === id) close();
    return { typed: true, session: null };
  }

  return { sessions, open, close, talk, model, stop, clear, isOpen: () => openId !== null };
}

module.exports = { READ_EVERY_MS, LOOK_EVERY_MS, GONE, STOP_THERE, NO_SUCH_MODEL, createClaudeMode };
