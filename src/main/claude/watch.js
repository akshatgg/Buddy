'use strict';

/**
 * Buddy watches Claude Code (spec 2026-10-08-buddy-claude-code-watch-design.md §4). The hooks in Claude Code's
 * settings.json (hooks.js) POST each event to a small HTTP server here, on 127.0.0.1 only, at a port and a token kept
 * in Buddy's settings. The events move a map of sessions, and the sessions move the buddy: thinking while any works,
 * celebrate when one is done, a wave and a bubble when one waits for the person, sad when one fails, idle when nothing
 * is left. The rules are plain functions over the state (apply, forget), the server is a thin layer around them.
 *
 * MOODS is the one place the mood names live (the buddy's feelings, src/renderer/buddy/moods.js).
 */

const http = require('node:http');
const crypto = require('node:crypto');
const { BuddyError } = require('../../../shared/errors');

const MOODS = Object.freeze({ working: 'thinking', done: 'celebrate', needsYou: 'wave', failed: 'sad', idle: 'idle' });
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'Notification'];
const FORGET_AFTER_MS = 30 * 60 * 1000; // a session with no event for this long is forgotten
const OFF_LINE = "Buddy adds a few small hooks to Claude Code's settings so it hears when Claude Code starts, finishes or needs you.";
// A working session with no event for this long is taken as stopped: Claude Code sends no hook when the person presses
// Esc. Real work sends PreToolUse and PostToolUse often, so only a long silent think shows idle (and thinks again after).
const QUIET_MS = 5 * 60 * 1000;
const FORGET_EVERY_MS = 60 * 1000; // how often quiet sessions are looked for
// The moods that stay on the buddy until another replaces them; celebrate, wave and sad end by themselves.
const STAYS = [MOODS.working];
const HOLD_EVERY_MS = 500; // how often a held mood looks whether the chat is done
const BODY_LIMIT = 64 * 1024; // an event bigger than this is not read
const PORT_MIN = 49152; // the port is picked here: the range systems keep for short-lived use
const PORT_MAX = 65535;
const PORT_TRIES = 10;
const PATH_PREFIX = '/claude-code/';
const CANT_LISTEN = "I couldn't open a port for Claude Code's hooks. Try again.";
const CANT_WRITE = "I couldn't change Claude Code's settings file, so I didn't turn this on.";

const defaultLater = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
};
const defaultRandomPort = () => crypto.randomInt(PORT_MIN, PORT_MAX + 1);
const defaultToken = () => crypto.randomBytes(16).toString('hex');

/** The last part of a folder's path, Mac or Windows; 'your project' when there is none. */
function folderName(cwd) {
  return cwd.replace(/[\\/]+$/, '').split(/[\\/]/).pop() || 'your project';
}

/** The event a hook sent (Claude Code's JSON on its stdin), or null for anything that is not one of ours. */
function parseEvent(text) {
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (Object.prototype.toString.call(json) !== '[object Object]') return null;
  if (!EVENTS.includes(json.hook_event_name) || typeof json.session_id !== 'string' || !json.session_id) return null;
  const str = (value) => (typeof value === 'string' ? value : '');
  return {
    name: json.hook_event_name, sessionId: json.session_id, folder: folderName(str(json.cwd)), matcher: str(json.matcher), error: str(json.error),
    cwd: str(json.cwd), transcript: str(json.transcript_path), // for Claude mode (live.js)
    tool: str(json.tool_name), // PreToolUse and PostToolUse: what Claude Code is doing, for the notch's status
  };
}

/** The terminal a hook said Claude Code runs in (its X-Buddy-Tty header, hooks.js), or '' when it did not say. */
function ttyOf(headers) {
  const value = typeof headers?.['x-buddy-tty'] === 'string' ? headers['x-buddy-tty'].trim() : '';
  return /^(ttys?\d{1,4}|pts\/\d{1,4})$/.test(value) ? value : '';
}

// What Claude Code is doing, by the tool it uses, in the words the notch shows (statusOf). Any other tool is 'working'.
const DOING = Object.freeze({
  Edit: 'editing code', MultiEdit: 'editing code', NotebookEdit: 'editing code', Write: 'writing code',
  Read: 'reading code', LS: 'reading code', Grep: 'searching code', Glob: 'searching code',
  Bash: 'running a command', WebFetch: 'reading the web', WebSearch: 'searching the web',
  Task: 'using helpers', Agent: 'using helpers', TodoWrite: 'planning',
});
const THINKING = 'thinking';

/** The words for a tool Claude Code uses: 'editing code', 'running a command', … */
function doingOf(tool = '') {
  if (Object.hasOwn(DOING, tool)) return DOING[tool];
  return String(tool).startsWith('mcp__') ? 'using tools' : 'working';
}

const newState = () => ({ sessions: {}, overall: 'idle', mood: MOODS.idle });
const working = (sessions) => Object.values(sessions).filter((s) => s.working).length;
const needing = (sessions) => Object.values(sessions).some((s) => s.needsYou);
/** " (1 still working)" for the bubble, when other sessions still work. */
const still = (sessions) => (working(sessions) ? ` (${working(sessions)} still working)` : '');
const isRateLimit = (event) => event.matcher === 'rate_limit' || event.error === 'rate_limit';

/**
 * The whole picture after an event (`name`, null for forget): a need beats work (the person must act), work beats the
 * rest. With nothing working and nothing needed, a Stop is done and a StopFailure failed; done and failed then stay
 * until something else happens, and anything else is idle.
 */
function overallOf(sessions, previous, name) {
  if (needing(sessions)) return 'needsYou';
  if (working(sessions)) return 'working';
  if (name === 'Stop') return 'done';
  if (name === 'StopFailure') return 'failed';
  return previous.overall === 'done' || previous.overall === 'failed' ? previous.overall : 'idle';
}

/**
 * The status the notch shows beside Buddy (notch-window.js status), or null: what the one working session is doing,
 * how many work, that one needs the person, or that the work is done or failed. Done and failed have no words: the
 * bubble says those, and the notch shows them for a moment only. `session` is the session a click on it opens in
 * Claude mode (the one that needs the person, or the only one working), or null for the list.
 */
function statusOf(sessions, overall) {
  const ids = (test) => Object.keys(sessions).filter((id) => test(sessions[id]));
  if (overall === 'needsYou') return { kind: 'needsYou', text: 'Claude needs you', session: ids((s) => s.needsYou)[0] };
  if (overall === 'working') {
    const busy = ids((s) => s.working);
    const text = busy.length > 1 ? `${busy.length} Claudes working` : `Claude · ${sessions[busy[0]].doing ?? THINKING}`;
    return { kind: 'working', text, session: busy.length === 1 ? busy[0] : null };
  }
  if (overall === 'done' || overall === 'failed') return { kind: overall, text: '', session: null };
  return null;
}

/**
 * The last step of apply and forget: the whole picture, and its mood whenever that differs from the mood last decided.
 * `moment` is an event's own mood, sent even when it is the same (a new need's wave, a failure's sad).
 */
function settle(sessions, previous, name, moment, bubble) {
  const overall = overallOf(sessions, previous, name);
  const mood = moment ?? (MOODS[overall] !== previous.mood ? MOODS[overall] : null);
  const out = { state: { sessions, overall, mood: mood ?? previous.mood }, status: statusOf(sessions, overall) };
  if (mood) out.mood = mood;
  if (bubble) out.bubble = bubble;
  return out;
}

/** One event → the next state, and the mood and bubble to show for it, if any. Pure: `state` is not changed. */
function apply(state, event, now) {
  const sessions = { ...state.sessions };
  const id = event.sessionId;
  const before = sessions[id] ?? { working: false, needsYou: false, name: event.folder, lastEvent: now, needTold: false };
  const wasWorking = working(sessions) > 0;
  const s = { ...before, name: event.folder, lastEvent: now };
  let moment = null;
  let bubble = null;
  switch (event.name) {
    case 'UserPromptSubmit':
    case 'PreToolUse':
    case 'PostToolUse':
      // What it does: a new prompt is thought about; a tool says what it does until the next one (a PostToolUse keeps
      // it, or the words would flicker between each tool and 'thinking').
      sessions[id] = {
        ...s, working: true, needsYou: false, needTold: false,
        doing: event.name === 'UserPromptSubmit' ? THINKING : event.name === 'PreToolUse' ? doingOf(event.tool) : s.doing ?? THINKING,
      };
      if (!before.working && wasWorking) bubble = `${working(sessions)} sessions working`;
      break;
    case 'PermissionRequest':
    case 'Notification':
      sessions[id] = { ...s, working: false, needsYou: true, needTold: true };
      if (!before.needTold) {
        moment = MOODS.needsYou;
        bubble = `Claude Code needs you in ${s.name}${still(sessions)}`;
      }
      break;
    case 'Stop':
      sessions[id] = { ...s, working: false, needsYou: false };
      bubble = `Claude Code is done in ${s.name}${still(sessions)}`;
      break;
    case 'StopFailure':
      sessions[id] = { ...s, working: false, needsYou: false };
      moment = MOODS.failed;
      bubble = isRateLimit(event) ? "Claude Code's limit is reached" : `Claude Code hit a problem in ${s.name}${still(sessions)}`;
      break;
    case 'SessionEnd':
      delete sessions[id];
      break;
    default:
      break;
  }
  return settle(sessions, state, event.name, moment, bubble);
}

/**
 * Drop the sessions quiet for FORGET_AFTER_MS or more, and stop counting a working one quiet for QUIET_MS as working;
 * idle when that leaves nothing to wait for. A session that needs the person keeps waiting.
 */
function forget(state, now) {
  const sessions = Object.fromEntries(Object.entries(state.sessions)
    .filter(([, s]) => now - s.lastEvent < FORGET_AFTER_MS)
    .map(([id, s]) => [id, s.working && now - s.lastEvent >= QUIET_MS ? { ...s, working: false } : s]));
  return settle(sessions, state, null, null, null);
}

/**
 * The server and the switch. `ui` is main.js's { mood(name), bubble(text) }; `chatBusy()` says the panel's chat has a
 * message in flight, whose moods win: a mood that comes then waits, and the picture is sent once the chat is done.
 * `onEvent` hears every event, with the terminal it came from (`tty`): Claude mode follows the sessions with it.
 * The clock, the timers, the port pick and the token are passed in by the unit tests.
 */
function createWatch({
  store, hooks, ui, chatBusy = () => false, active = () => true, onEvent = () => {},
  now = Date.now, later = defaultLater, cancel = clearTimeout, randomPort = defaultRandomPort, newToken = defaultToken,
}) {
  let server = null;
  let token = null;
  let state = newState();
  let error = null; // the words of a hooks failure kept for the Settings line; set while the last install failed
  let lastMood = null; // the last mood this watcher sent, so stop() knows whether to put the buddy back
  let lastStatus = null; // the last status sent to the notch, as JSON, so the same one is not sent again
  let forgetTimer = null;
  let holdTimer = null;

  /**
   * Every mood the app sends counts as a use of the buddy (it wakes a dozing one), so idle goes out only to end a mood
   * that stays until replaced (thinking). A celebrate, a wave or a sad ends by itself, and an idle after it would only
   * wake the buddy, for instance when a session left waiting is forgotten in the night.
   */
  function send(mood) {
    const was = lastMood;
    lastMood = mood;
    if (mood === MOODS.idle && !STAYS.includes(was)) return;
    ui.mood(mood);
  }

  /** Once the chat is done, the picture as it is now; until then, look again shortly. */
  function waitForChat() {
    if (holdTimer) return;
    holdTimer = later(() => {
      holdTimer = null;
      if (!server) return;
      if (chatBusy()) {
        waitForChat();
        return;
      }
      send(MOODS[state.overall]);
      state = { ...state, mood: MOODS[state.overall] };
    }, HOLD_EVERY_MS);
  }

  /** The notch's status, when it changed. Unlike a mood it does not wait for the chat: it is not on the buddy's face. */
  function sendStatus(next) {
    const json = JSON.stringify(next);
    if (json === lastStatus) return;
    lastStatus = json;
    ui.status?.(next);
  }

  function show({ mood, bubble, status: next }) {
    if (next !== undefined) sendStatus(next);
    if (bubble) ui.bubble(bubble);
    if (!mood) return;
    if (chatBusy()) waitForChat();
    else send(mood);
  }

  function take(text, tty = '') {
    const event = parseEvent(text);
    if (!event) return;
    const r = apply(state, event, now());
    state = r.state;
    show(r);
    try {
      onEvent({ ...event, tty });
    } catch (err) {
      console.warn('[buddy] Claude mode could not take an event:', err.message);
    }
  }

  /** Only Claude Code's hooks are heard: the path carries the token. The hook is answered before anything is done. */
  function onRequest(req, res) {
    if (req.method !== 'POST' || req.url !== PATH_PREFIX + token) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > BODY_LIMIT) {
        chunks.length = 0;
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      res.statusCode = 204;
      res.end();
      take(Buffer.concat(chunks).toString('utf8'), ttyOf(req.headers));
    });
    req.on('error', () => {});
  }

  function listen(port) {
    return new Promise((resolve, reject) => {
      const s = http.createServer(onRequest);
      s.once('error', reject);
      s.listen(port, '127.0.0.1', () => {
        s.off('error', reject);
        s.on('error', (err) => console.warn('[buddy] the Claude Code hooks server failed:', err.code || err.message));
        resolve(s);
      });
    });
  }

  function tick() {
    const r = forget(state, now());
    state = r.state;
    show(r);
  }

  function schedule() {
    forgetTimer = later(() => {
      forgetTimer = null;
      if (!server) return;
      tick();
      schedule();
    }, FORGET_EVERY_MS);
  }

  /** Put the hooks in place for this port. Any failure is kept as words (`error`), never thrown. */
  async function install(port) {
    try {
      await hooks.install({ port, token });
      error = null;
    } catch (err) {
      error = err instanceof BuddyError ? err.message : CANT_WRITE;
    }
  }

  /** Listen (the saved port, or a new one when it is taken), then put the hooks in place for it. */
  async function start() {
    if (server) {
      const port = store.get('claudeHookPort');
      if (error) await install(port); // the last try failed: try again
      return { port };
    }
    token = store.get('claudeHookToken');
    if (typeof token !== 'string' || !/^[0-9a-f]{32}$/.test(token)) {
      token = newToken();
      store.set({ claudeHookToken: token });
    }
    const saved = store.get('claudeHookPort');
    let port = Number.isInteger(saved) && saved >= PORT_MIN && saved <= PORT_MAX ? saved : randomPort();
    let s = null;
    for (let tries = 0; tries < PORT_TRIES && !s; tries += 1) {
      try {
        s = await listen(port);
      } catch (err) {
        if (err.code !== 'EADDRINUSE' && err.code !== 'EACCES') throw err;
        port = randomPort();
      }
    }
    if (!s) throw new BuddyError('claude_watch', CANT_LISTEN);
    server = s;
    state = newState();
    error = null;
    if (port !== saved) store.set({ claudeHookPort: port });
    await install(port); // on a failure the server stays up: hooks put there by hand still reach it
    schedule();
    return { port };
  }

  function stop() {
    if (!server) return;
    server.closeAllConnections?.();
    server.close();
    server = null;
    cancel(forgetTimer);
    cancel(holdTimer);
    forgetTimer = null;
    holdTimer = null;
    state = newState();
    sendStatus(null);
    if (STAYS.includes(lastMood)) ui.mood(MOODS.idle);
    lastMood = null;
  }

  function line() {
    if (error) return error;
    if (store.get('watchClaudeCode') === true) return `Watching. Hooks are in ${hooks.shown()}.`;
    return OFF_LINE;
  }

  const status = () => ({ on: store.get('watchClaudeCode') === true, line: line() });

  let switching = Promise.resolve(); // setOn calls, one after another: a second waits for the first to finish
  function setOn(on) {
    const next = switching.then(() => switchTo(on));
    switching = next.catch(() => {});
    return next;
  }

  /**
   * The switch. On: nothing is saved until the port and the hooks are in place. While Buddy is off (`active()` false)
   * it is only saved, and Buddy starts watching when it is turned on. Off: the hooks go too.
   */
  async function switchTo(on) {
    if (on && !active()) {
      store.set({ watchClaudeCode: true });
    } else if (on) {
      await start();
      if (error) {
        const words = error;
        stop();
        throw new BuddyError('claude_settings', words);
      }
      store.set({ watchClaudeCode: true });
    } else {
      stop();
      store.set({ watchClaudeCode: false });
      error = null;
      await hooks.remove();
    }
    return status();
  }

  return { start, stop, setOn, status, tick };
}

module.exports = { MOODS, DOING, doingOf, statusOf, FORGET_AFTER_MS, QUIET_MS, OFF_LINE, BODY_LIMIT, PORT_MIN, PORT_MAX, folderName, parseEvent, ttyOf, newState, apply, forget, createWatch };
