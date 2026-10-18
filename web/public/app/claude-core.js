// Claude mode on the phone, without the page: the Claude Code sessions running on the person's computers, reached
// through Buddy's server (GET and POST /api/remote/phone, web/lib/remote.js), and one of them shown live. It does what
// the Android app's ClaudeModel.kt does: the session shown is looked at every 2 s, and only while it is in view (the
// Claude tab open and the app on screen); the computer sends its items only while it is looked at, and is told to stop
// (`stop`) when the person goes back to the list, leaves the tab or the app, or signs out. It also reads the session's
// status line (tokens, model) and workers, and runs the slash commands as the Mac panel's Claude mode does. claude.js
// draws it.

import ClaudeCli from './shared/claude-cli.js';

const {
  command, helpLines, costLines, rows, workerList, statusLine, workingVerb, MODEL_LABELS, EFFORTS, EFFORT_LABELS, noSuchEffort,
  pickerOpen, pickerMove, pickerEffort, pickerPick, pickerApply,
} = ClaudeCli;

export const POLL_MS = 2_000;
// A session's status, in the Mac panel's words (src/renderer/panel/panel.js).
export const STATUS = { working: 'working…', waiting: 'waiting for you', done: 'done', failed: 'hit a problem', idle: 'idle' };
export const OFFLINE = 'None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on.';
export const NONE = 'No Claude Code session is running on your computers.';
export const NO_TALK = "Buddy can't type into this terminal on that computer, so what you send there may not arrive.";
export const GONE = 'That session is not running any more. Pick another one.';
export const EFFORT_SET = (name) => `Effort set to ${name}. It works from your next message.`;
export const MODEL_SET = (name) => `Model set to ${name}. It works from your next message.`;
export const NO_SUCH_MODEL = (name) => `There is no model called ${name}. Try default, fable, opus, sonnet or haiku.`;
export const STOPPING = 'Asked your computer to press Esc in that terminal. That works when it runs in iTerm2.';
export const CLEARED = 'Started a new conversation there. Tap Look again in a few seconds to open it.';
const MODEL_IDS = ['default', ...Object.keys(MODEL_LABELS)]; // Claude Code's aliases: default, fable, opus, sonnet, haiku
const WORKER_STATUS = ['running', 'done', 'failed', 'stopped'];
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

// The caps the server keeps (web/lib/remote.js), so what is drawn is never longer than what it would send.
const MODEL_CHARS = 80;
const WORKER_ID_CHARS = 100;
const TASK_CHARS = 120;
const TYPE_CHARS = 40;
const ACTIVITY_CHARS = 80;
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const msOrNull = (value) => (Number.isFinite(value) ? value : null);

/** The session's tokens and model (the Mac's live.js stats), or null. */
function readStats(j) {
  if (!j || typeof j !== 'object' || Array.isArray(j)) return null;
  return { model: text(j.model).slice(0, MODEL_CHARS) || null, input: count(j.input), output: count(j.output), context: count(j.context) };
}

/** One worker Claude started, or null when it is not one. */
function readWorker(j) {
  if (!j || typeof j.id !== 'string' || !j.id || j.id.length > WORKER_ID_CHARS || !WORKER_STATUS.includes(j.status)) return null;
  const type = text(j.type);
  return {
    id: j.id,
    type: type && type.length <= TYPE_CHARS ? type : null, // an old Mac sends none
    task: text(j.task).slice(0, TASK_CHARS) || 'A worker',
    activity: text(j.activity).replace(/\s+/g, ' ').slice(0, ACTIVITY_CHARS) || null,
    status: j.status, startedAt: msOrNull(j.startedAt), endedAt: msOrNull(j.endedAt), tokens: count(j.tokens),
  };
}

/** Only the first of each id: the lists are drawn by id. */
const firstOfEach = (list) => list.filter((x, i) => list.findIndex((y) => y.id === x.id) === i);

/**
 * One look (GET /api/remote/phone): { online, sessions, feed: { session, items, stats, workers } | null }, as Remote.kt reads it:
 * anything missing or odd is left out, so a strange answer shows less rather than breaking the tab.
 */
export function readLook(j) {
  const sessions = firstOfEach((Array.isArray(j?.sessions) ? j.sessions : []).map(readSession).filter(Boolean));
  const session = readSession(j?.feed);
  const feed = session ? {
    session,
    items: firstOfEach((Array.isArray(j.feed.items) ? j.feed.items : []).map(readItem).filter(Boolean)),
    stats: readStats(j.feed.stats),
    workers: firstOfEach((Array.isArray(j.feed.workers) ? j.feed.workers : []).map(readWorker).filter(Boolean)),
  } : null;
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
  stats: null, // the session's tokens and model (its status line)
  workers: [], // the workers Claude started
  notes: [], // answers to slash commands, at the end of the session: [{ id, text }]
  picker: null, // the /model picker while it is open (ClaudeCli.pickerOpen), or null
  effort: null, // the effort picked for the session shown in this run (the phone cannot read the computer's), or null
  problem: null, // why the last look at it failed
  sending: false,
  boxError: null, // why the last words were not sent
});

/**
 * look(sessionId | null) answers readLook's shape; send(sessionId, text), interrupt(sessionId) and stop() are the POSTs. later and
 * cancelLater are the timers (setTimeout, clearTimeout); onChange(state) after every change.
 */
export function createClaude({ look, send, interrupt = async () => {}, stop, later = setTimeout, cancelLater = clearTimeout, pollMs = POLL_MS, onChange = () => {} }) {
  let state = fresh();
  let generation = 0; // one more each time Claude mode ends: what was on its way for an earlier one is dropped
  let listing = null; // the list being asked for now: a token, or null
  let polling = null; // the looks at the session shown: { timer }, or null
  let inView = true;
  let wanted = null; // a session to open once the list comes (a notification's link)
  let nextNote = 1;
  const efforts = new Map(); // the effort picked for each session in this run: Claude Code's own cannot be read

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
    set({ session: null, items: null, stats: null, workers: [], notes: [], picker: null, problem: null, looking: true, listError: note });
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
      set(feed ? { session: feed.session, items: feed.items, stats: feed.stats ?? null, workers: feed.workers ?? [], problem: null } : { problem: null });
      again();
    }
    step();
  }

  /** A session picked from the list: it shows, and is looked at every pollMs. */
  function open(id) {
    const session = state.sessions.find((s) => s.id === id);
    if (!session || !state.on || state.session) return;
    listing = null;
    set({ session, items: null, stats: null, workers: [], notes: [], picker: null, effort: efforts.get(id) ?? null, problem: null, looking: false, listError: null });
    poll();
  }

  /** An answer to a slash command, at the end of the session. */
  function note(words) {
    set({ notes: [...state.notes, { id: nextNote++, text: words }] });
    return { ok: true };
  }

  /** /model and /effort alone: the picker opens, on the session's model and the effort picked here (focus: 'model' or 'effort'). */
  function openPicker(focus) {
    set({ picker: pickerOpen({ stats: state.stats, savedEffort: state.effort, focus }) });
    return { ok: true };
  }

  /** `go()` sends something for the session shown: the box waits meanwhile, and hears why when it fails. */
  async function deliver(go) {
    const mine = generation;
    set({ sending: true, boxError: null });
    try {
      await go();
      if (mine === generation) set({ sending: false });
      return { ok: true };
    } catch (err) {
      const error = messageOf(err);
      if (mine === generation) set({ sending: false, boxError: error });
      return { ok: false, error };
    }
  }

  /** One of Buddy's slash commands (ClaudeCli.command): answered here, or sent to the session's computer. */
  async function runCommand(cmd, session) {
    const still = () => state.session?.id === session.id;
    if (cmd.name === 'help') return note(helpLines().join('\n'));
    if (cmd.name === 'cost') return note(costLines({ stats: state.stats, workers: state.workers }).join('\n'));
    if (cmd.name === 'model' || cmd.name === 'effort') set({ picker: null });
    if (cmd.name === 'model') {
      if (!cmd.arg) return openPicker('model');
      if (!MODEL_IDS.includes(cmd.arg)) return note(NO_SUCH_MODEL(cmd.arg));
      const r = await deliver(() => send(session.id, `/model ${cmd.arg}`));
      if (r.ok && still()) note(MODEL_SET(cmd.arg === 'default' ? 'Default' : MODEL_LABELS[cmd.arg]));
      return r;
    }
    if (cmd.name === 'effort') {
      if (!cmd.arg) return openPicker('effort');
      if (!EFFORTS.includes(cmd.arg)) return note(noSuchEffort(cmd.arg));
      const r = await deliver(() => send(session.id, `/effort ${cmd.arg}`));
      if (r.ok) {
        efforts.set(session.id, cmd.arg);
        if (still()) set({ effort: cmd.arg });
      }
      if (r.ok && still()) note(EFFORT_SET(EFFORT_LABELS[cmd.arg]));
      return r;
    }
    if (cmd.name === 'stop') {
      const r = await deliver(() => interrupt(session.id));
      if (r.ok && still()) note(STOPPING);
      return r;
    }
    if (cmd.name === 'clear') {
      // Claude Code starts a new session (a new id) in that terminal, so this one is left for the list.
      const r = await deliver(() => send(session.id, '/clear'));
      if (r.ok && still()) list(CLEARED);
      return r;
    }
    return deliver(() => send(session.id, `/${cmd.name}${cmd.arg ? ` ${cmd.arg}` : ''}`)); // any other: Claude Code's, as typed
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

    /** The picker's moves (↑↓ the model, ←→ the effort, a tap on a row), closing it, and Enter: /model and /effort for what changed. */
    pickerMove(dir) {
      if (state.picker) set({ picker: pickerMove(state.picker, dir) });
    },
    pickerEffort(dir) {
      if (state.picker) set({ picker: pickerEffort(state.picker, dir) });
    },
    pickerPick(choice) {
      if (state.picker) set({ picker: pickerPick(state.picker, choice) });
    },
    pickerClose() {
      if (state.picker) set({ picker: null });
    },
    async pickerApply() {
      const session = state.session;
      if (!state.picker || !session || state.sending) return { ok: false, error: '' };
      const { commands, note: words } = pickerApply(state.picker);
      set({ picker: null });
      const done = [];
      for (const c of commands) {
        const r = await deliver(() => send(session.id, `/${c.name} ${c.arg}`));
        if (!r.ok) {
          if (done.length && state.session?.id === session.id) note(`${done.join(' · ')} was set, but ${c.name} was not.`); // the first went, the second did not
          return r;
        }
        done.push(c.name === 'model' ? `Model: ${c.arg === 'default' ? 'Default' : MODEL_LABELS[c.arg]}` : `Effort: ${EFFORT_LABELS[c.arg]}`);
        if (c.name === 'effort') {
          efforts.set(session.id, c.arg);
          if (state.session?.id === session.id) set({ effort: c.arg });
        }
      }
      if (state.session?.id === session.id) note(words);
      return { ok: true };
    },

    /** Words (or a slash command) for the session shown. Answers { ok: true }, or { ok: false, error } (the box gives them back). */
    async send(words) {
      const session = state.session;
      const typed = String(words ?? '').trim();
      if (!session || state.sending || !typed) return { ok: false, error: '' };
      const cmd = command(typed);
      // A / command that is not Buddy's goes to Claude Code as typed, as on the Mac.
      if (cmd?.known) return runCommand(cmd, session);
      if (state.picker) set({ picker: null }); // sending something else puts the picker away
      return deliver(() => send(session.id, typed));
    },
  };
}

/**
 * What the session shows, top to bottom, as the Mac panel draws it (panel.js drawClaude): the terminal's rows, the
 * workers, the working verb (the same for the whole turn), whether Claude waits, the status line, and whether the
 * screen must redraw every second (a worker runs: its time moves).
 */
export function screen(state, now) {
  const items = Array.isArray(state.items) ? state.items : [];
  const workers = Array.isArray(state.workers) ? state.workers : [];
  const asked = [...items].reverse().find((item) => item.kind === 'you');
  const status = state.session?.status;
  return {
    rows: rows(items),
    workers: workerList(workers, now),
    working: status === 'working' ? workingVerb(asked?.id ?? 0) : null,
    waiting: status === 'waiting',
    line: statusLine(state.stats),
    ticking: workers.some((w) => w.status === 'running'),
  };
}
