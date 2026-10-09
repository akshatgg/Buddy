// Claude mode on the phone, without the page: the Claude Code sessions running on the person's computers, reached
// through Buddy's server (GET and POST /api/remote/phone, web/lib/remote.js), and one of them shown live. It does what
// the Android app's ClaudeModel.kt does: the session shown is looked at every 2 s, and only while it is in view (the
// Claude tab open and the app on screen); the computer sends its items only while it is looked at, and is told to stop
// (`stop`) when the person goes back to the list, leaves the tab or the app, or signs out. claude.js draws it.

export const POLL_MS = 2_000;
// A session's status, in the Mac panel's words (src/renderer/panel/panel.js).
export const STATUS = { working: 'working…', waiting: 'waiting for you', done: 'done', failed: 'hit a problem', idle: 'idle' };
export const OFFLINE = 'None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on.';
export const NONE = 'No Claude Code session is running on your computers.';
export const NO_TALK = "Buddy can't type into this terminal on that computer, so what you send there may not arrive.";
export const GONE = 'That session is not running any more. Pick another one.';
const FAILED = 'Something went wrong. Try again.';
// The ids the server takes (web/lib/remote.js): one that cannot be one is left out, so it is never asked for.
const SESSION_ID = /^[\w-]{1,100}$/;
const KINDS = ['you', 'claude', 'tool', 'result', 'event'];

const text = (value) => (typeof value === 'string' ? value.trim() : '');

function readSession(j) {
  if (!j || typeof j.id !== 'string' || !SESSION_ID.test(j.id)) return null;
  return { id: j.id, name: text(j.name) || 'Claude Code', title: text(j.title) || null, status: text(j.status) || 'idle', canTalk: j.canTalk === true, device: text(j.device) || null };
}

// A kind the phone does not know shows as a note, as on the Mac.
function readItem(j) {
  if (!j || !Number.isInteger(j.id) || typeof j.text !== 'string') return null;
  return { id: j.id, kind: KINDS.includes(j.kind) ? j.kind : 'event', text: j.text, error: j.error === true };
}

/** Only the first of each id: the lists are drawn by id. */
const firstOfEach = (list) => list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);

/**
 * One look (GET /api/remote/phone): { online, sessions, feed: { session, items } | null }, as Remote.kt reads it:
 * anything missing or odd is left out, so a strange answer shows less rather than breaking the tab.
 */
export function readLook(j) {
  const sessions = firstOfEach((Array.isArray(j?.sessions) ? j.sessions : []).map(readSession).filter(Boolean));
  const session = readSession(j?.feed);
  const feed = session ? { session, items: firstOfEach((Array.isArray(j.feed.items) ? j.feed.items : []).map(readItem).filter(Boolean)) } : null;
  return { online: j?.online === true, sessions, feed };
}

/** The sessions by computer, the computers in the order they first come: [{ device, sessions }]. */
export function byDevice(sessions) {
  const groups = [];
  for (const session of sessions) {
    let group = groups.find((g) => g.device === session.device);
    if (!group) {
      group = { device: session.device, sessions: [] };
      groups.push(group);
    }
    group.sessions.push(session);
  }
  return groups;
}

const messageOf = (err) => (typeof err?.message === 'string' && err.message && typeof err.code === 'string' ? err.message : FAILED);

const fresh = () => ({
  on: false, // in Claude mode: the tab was opened, signed in
  looking: false, // the sessions are being asked for
  online: null, // whether a computer shares (null: not known)
  sessions: [],
  listError: null, // why the list is not there, or a note over it (the session shown ended)
  session: null, // the session shown, or null while the list is
  items: null, // its items, null until its computer has sent them
  problem: null, // why the last look at it failed
  sending: false,
  boxError: null, // why the last words were not sent
});

/**
 * look(sessionId | null) answers readLook's shape; send(sessionId, text) and stop() are the POSTs. later and
 * cancelLater are the timers (setTimeout, clearTimeout); onChange(state) after every change.
 */
export function createClaude({ look, send, stop, later = setTimeout, cancelLater = clearTimeout, pollMs = POLL_MS, onChange = () => {} }) {
  let state = fresh();
  let generation = 0; // one more each time Claude mode ends: what was on its way for an earlier one is dropped
  let listing = null; // the list being asked for now: a token, or null
  let polling = null; // the looks at the session shown: { timer }, or null
  let inView = true;
  let wanted = null; // a session to open once the list comes (a notification's link)

  function set(patch) {
    state = { ...state, ...patch };
    onChange(state);
  }

  function stopWatching() {
    // Nothing to tell the person when this fails: the server stops the watch by itself when the phone stops looking.
    Promise.resolve().then(stop).catch(() => {});
  }

  function stopPolling() {
    if (!polling) return;
    cancelLater(polling.timer);
    polling = null;
  }

  /** The session shown is left: the looks stop, and so does its computer. */
  function leaveSession() {
    const watched = polling !== null || state.session !== null;
    stopPolling();
    if (watched) stopWatching();
  }

  /** "Look again", and "‹" from a session. `note` is said over the list (why the session shown went away). */
  function list(note = null) {
    leaveSession();
    const me = {};
    const mine = generation;
    listing = me;
    set({ session: null, items: null, problem: null, looking: true, listError: note });
    look(null).then((r) => {
      if (listing !== me || mine !== generation) return;
      listing = null;
      set({ looking: false, online: r.online, sessions: r.sessions, listError: note });
      if (wanted) {
        const id = wanted;
        wanted = null;
        if (r.sessions.some((s) => s.id === id)) open(id);
        else set({ listError: GONE });
      }
    }, (err) => {
      if (listing !== me || mine !== generation) return;
      listing = null;
      set({ looking: false, online: null, sessions: [], listError: note ?? messageOf(err) });
    });
  }

  /** Look at the session shown now, then every pollMs, while it is in view. */
  function poll() {
    const id = state.session?.id;
    if (!id || !inView || polling) return;
    const me = { timer: null };
    polling = me;
    const again = () => {
      if (polling === me) me.timer = later(step, pollMs);
    };
    async function step() {
      let r;
      try {
        r = await look(id);
      } catch (err) {
        if (polling !== me) return;
        if (err?.code === 'not_found') {
          // The session ended on its computer: back to the list, saying so.
          polling = null;
          list(err.message || GONE);
          return;
        }
        set({ problem: messageOf(err) });
        again();
        return;
      }
      if (polling !== me) return;
      if (!r.online) {
        // The computer stopped sharing: the list says so.
        polling = null;
        stopWatching();
        set({ session: null, items: null, problem: null, online: false, sessions: r.sessions, listError: null });
        return;
      }
      const feed = r.feed && r.feed.session.id === id ? r.feed : null;
      set(feed ? { session: feed.session, items: feed.items, problem: null } : { problem: null });
      again();
    }
    step();
  }

  /** A session picked from the list: it shows, and is looked at every pollMs. */
  function open(id) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session || !state.on || state.session) return;
    listing = null;
    set({ session, items: null, problem: null, looking: false, listError: null });
    poll();
  }

  return {
    get state() {
      return state;
    },

    /** Into Claude mode, on the list; with `openId` (a notification's link), that session opens once it is listed. */
    enter(openId = null) {
      if (openId) wanted = openId;
      if (state.on && !openId) return;
      inView = true;
      if (!state.on) set({ on: true });
      list();
    },

    /** Out of Claude mode (signed out): its work stops, and its computer's. */
    leave() {
      generation += 1;
      listing = null;
      wanted = null;
      leaveSession();
      state = fresh();
      onChange(state);
    },

    /** In view again: the session shown is looked at again, or the sessions asked for anew. */
    shown() {
      inView = true;
      if (!state.on) return;
      if (state.session) poll();
      else list();
    },

    /** Out of view (another tab, the app hidden): the phone stops looking, and the computer stops sending. */
    hidden() {
      inView = false;
      if (polling) {
        stopPolling();
        stopWatching();
      }
    },

    list: () => list(),
    open,

    /** Words to the session's terminal. Answers { ok: true }, or { ok: false, error } (the box gives them back). */
    async send(words) {
      const session = state.session;
      const typed = String(words ?? '').trim();
      if (!session || state.sending || !typed) return { ok: false, error: '' };
      const mine = generation;
      set({ sending: true, boxError: null });
      try {
        await send(session.id, typed);
        if (mine === generation) set({ sending: false });
        return { ok: true };
      } catch (err) {
        const error = messageOf(err);
        if (mine === generation) set({ sending: false, boxError: error });
        return { ok: false, error };
      }
    },
  };
}
