'use strict';

/**
 * Claude mode: the panel shows a Claude Code session from the person's terminal, from its start and as it goes on.
 * Claude Code keeps a small file for each session that is running (sessions/<pid>.json in its config folder: its id,
 * folder and name), and writes each session to a file of JSON lines (its "transcript", projects/<folder>/<id>.jsonl).
 * Every hook event Buddy hears (watch.js) also says which file, which folder and which terminal (tty). This module
 * keeps the sessions found either way, reads the lines of the one the panel shows, and turns them into items the page
 * draws: what the person typed, Claude's replies, the tools it ran and what they gave back. Nothing is saved: the
 * files are Claude Code's own.
 *
 * itemsOf() is a plain function over one line of the file; createLive is the thin layer over the files and the clock.
 */

const path = require('node:path');
const { needsYou } = require('./hooks');

const KEEP = 500; // the items kept for a session: the newest
const QUEUED_MAX = 20; // messages sent while Claude worked that are waiting for it, kept to know them when they reach it
const TITLE_READ = 512 * 1024; // a session's title is looked for in this much of the end of its file
const TITLE_EVERY_MS = 30_000; // and looked for again this often, as Claude Code renames a session as the work goes on
const TITLE_CHARS = 120;
const FIRST_READ = 16 * 1024 * 1024; // a very long session is read from this many bytes before its end, the first time
const READ_MAX = 16 * 1024 * 1024; // at most this much is read at once
const FORGET_AFTER_MS = 6 * 60 * 60 * 1000; // a session quiet for this long leaves the list
const RESULT_LINES = 8; // what a tool gave back: its first lines, cut to RESULT_CHARS
const RESULT_CHARS = 800;
const LINE_CHARS = 200; // a tool's own line (the command it ran, the file it read)
const TEXT_CHARS = 20_000; // a message or a reply longer than this is cut
// The status of a session after each hook event (watch.js EVENTS).
const STATUS_AFTER = {
  UserPromptSubmit: 'working',
  PreToolUse: 'working',
  PostToolUse: 'working',
  PermissionRequest: 'waiting',
  Notification: 'waiting',
  Stop: 'done',
  StopFailure: 'failed',
  SessionEnd: 'ended',
};
const TTY = /^(ttys?\d{1,4}|pts\/\d{1,4})$/; // a terminal's name, as ps prints it: ttys003 on the Mac, pts/2 on Linux

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const cut = (text, max) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

/** A file path shortened to its last two parts: src/main.js rather than the whole path. */
function shortPath(file) {
  if (typeof file !== 'string' || !file) return '';
  return file.split(/[\\/]/).filter(Boolean).slice(-2).join('/');
}

/** One line for a tool Claude Code ran: what it did, in a few words. */
function toolLine(name, input) {
  const i = isObject(input) ? input : {};
  const str = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
  let line;
  switch (name) {
    case 'Bash':
    case 'PowerShell':
      line = `$ ${str(i.command)}`;
      break;
    case 'Read':
    case 'Write':
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      line = `${name} ${shortPath(i.file_path || i.notebook_path)}`;
      break;
    case 'Grep':
    case 'Glob':
      line = `${name} ${str(i.pattern)}`;
      break;
    case 'WebFetch':
      line = `Fetch ${str(i.url)}`;
      break;
    case 'WebSearch':
      line = `Search ${str(i.query)}`;
      break;
    case 'Agent':
    case 'Task':
      line = `Agent: ${str(i.description) || str(i.subagent_type)}`;
      break;
    case 'TodoWrite':
      line = 'Updated the to-do list';
      break;
    default:
      line = typeof name === 'string' && name ? name : 'A tool';
  }
  return cut(line.trim(), LINE_CHARS);
}

/** The words of a tool's result (a string, or a list of blocks), its first lines only. */
function resultText(content) {
  let text = '';
  if (typeof content === 'string') text = content;
  else if (Array.isArray(content)) text = content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
  const lines = text.replace(/\r\n/g, '\n').trim().split('\n');
  const shown = lines.slice(0, RESULT_LINES).join('\n');
  const more = lines.length > RESULT_LINES ? `\n… ${lines.length - RESULT_LINES} more lines` : '';
  return cut(shown, RESULT_CHARS) + more;
}

/**
 * What the person typed, as the terminal shows it. A slash command comes as <command-name> tags: it shows as the
 * command. Other tagged text (Claude Code's own notes to itself, a command's output) is not something they typed.
 */
function typedText(text) {
  const t = text.trim();
  if (!t) return null;
  if (t.startsWith('<command-name>')) {
    const name = /<command-name>([^<]*)<\/command-name>/.exec(t)?.[1]?.trim() || '';
    const args = /<command-args>([^<]*)<\/command-args>/.exec(t)?.[1]?.trim() || '';
    return name ? `${name}${args ? ` ${args}` : ''}` : null;
  }
  if (t.startsWith('<') || t.startsWith('Caveat:')) return null;
  return cut(t, TEXT_CHARS);
}

/**
 * The items one line of the transcript makes: { kind, text } with kind 'you' (they typed it), 'claude' (Claude's
 * reply), 'thinking' (Claude's thinking before it, as the terminal shows it folded), 'tool' (a tool it ran), 'result' (what
 * that gave back; `error` when it failed) or 'event' (stopped by the person). A subagent's lines and Claude Code's own
 * notes make none, nor does a thinking with no words (Claude Code keeps only its signature at times).
 */
function itemsOf(entry) {
  if (!isObject(entry) || entry.isSidechain === true || entry.isMeta === true) return [];
  const content = entry.message?.content;
  if (entry.type === 'user') {
    if (typeof content === 'string') {
      if (content.startsWith('[Request interrupted')) return [{ kind: 'event', text: 'Stopped' }];
      const text = typedText(content);
      return text ? [{ kind: 'you', text }] : [];
    }
    if (!Array.isArray(content)) return [];
    return content.flatMap((block) => {
      if (block?.type === 'tool_result') {
        const text = resultText(block.content);
        return text ? [{ kind: 'result', text, ...(block.is_error === true ? { error: true } : {}) }] : [];
      }
      if (block?.type === 'text' && typeof block.text === 'string') {
        if (block.text.startsWith('[Request interrupted')) return [{ kind: 'event', text: 'Stopped' }];
        const text = typedText(block.text);
        return text ? [{ kind: 'you', text }] : [];
      }
      return [];
    });
  }
  if (entry.type === 'assistant' && Array.isArray(content)) {
    return content.flatMap((block) => {
      if (block?.type === 'text' && typeof block.text === 'string' && block.text.trim()) {
        return [{ kind: 'claude', text: cut(block.text.trim(), TEXT_CHARS) }];
      }
      if (block?.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
        return [{ kind: 'thinking', text: cut(block.thinking.trim(), TEXT_CHARS) }];
      }
      if (block?.type === 'tool_use') return [{ kind: 'tool', text: toolLine(block.name, block.input) }];
      return [];
    });
  }
  return [];
}

/**
 * What one line says of a message the person sent while Claude worked. Claude Code queues it ("Press up to edit queued
 * messages") and writes no message of the person's then: { queued: text } when it was queued; later, either a message
 * of theirs with the same words (it waited for the turn to end) or { delivered: text } (an attachment: it went into the
 * turn under way, and no message of theirs is ever written for it). Null for any other line.
 */
function queueOf(entry) {
  if (!isObject(entry) || entry.isSidechain === true) return null;
  if (entry.type === 'queue-operation' && entry.operation === 'enqueue' && typeof entry.content === 'string') {
    const text = typedText(entry.content);
    return text ? { queued: text } : null;
  }
  const a = entry.type === 'attachment' && isObject(entry.attachment) ? entry.attachment : null;
  if (a?.type === 'queued_command' && typeof a.prompt === 'string' && a.origin?.kind === 'human' && (a.commandMode ?? 'prompt') === 'prompt') {
    const text = typedText(a.prompt);
    return text ? { delivered: text } : null;
  }
  return null;
}

/**
 * The title Claude Code gave the session (as its terminal tab shows it: "Fix the login bug"), from the newest
 * "ai-title" line in `text`; null when there is none.
 */
function titleIn(text) {
  let title = null;
  for (const m of text.matchAll(/"type":"ai-title","aiTitle":("(?:[^"\\]|\\.)*")/g)) {
    try {
      title = JSON.parse(m[1]);
    } catch {
      // half a line, at the edge of what was read
    }
  }
  return typeof title === 'string' && title.trim() ? cut(title.trim(), TITLE_CHARS) : null;
}

/** The transcript file a hook named, if it is a .jsonl file inside Claude Code's config folder; null otherwise. */
function checkTranscript(file, configDirs) {
  if (typeof file !== 'string' || !path.isAbsolute(file) || path.extname(file) !== '.jsonl') return null;
  const resolved = path.resolve(file);
  return configDirs.some((dir) => resolved.startsWith(path.resolve(dir) + path.sep)) ? resolved : null;
}

/** Claude Code's name for a project folder under projects/: the path with every character but a letter or digit as -. */
const projectFolder = (cwd) => cwd.replace(/[^A-Za-z0-9]/g, '-');

/** Whether a process is running (signal 0 only asks). */
function alive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}

/** The terminal of each process, from ps: { pid: 'ttys003' }. None on Windows, or when ps fails. */
function defaultTtys(pids) {
  if (process.platform === 'win32' || !pids.length) return Promise.resolve({});
  return new Promise((resolve) => {
    require('node:child_process').execFile('ps', ['-o', 'pid=,tty=', '-p', pids.join(',')], { timeout: 3000 }, (err, stdout) => {
      const out = {};
      for (const line of String(stdout || '').split('\n')) {
        const [pid, tty] = line.trim().split(/\s+/);
        if (pid && tty && TTY.test(tty)) out[pid] = tty;
      }
      resolve(out);
    });
  });
}

/**
 * The sessions and the reading. `configDirs()` lists Claude Code's config folders (where sessions/ and projects/ are);
 * `fs` is node:fs's promises API, `isAlive` and `ttys` look at processes: all passed in by the unit tests. onChange(fn)
 * is told the id of a session whose items or status changed.
 */
function createLive({ configDirs, fs = require('node:fs').promises, now = Date.now, isAlive = alive, ttys = defaultTtys }) {
  const sessions = new Map(); // id → { id, name, folder, transcript, tty, status, lastEvent, offset, rest, items, nextId }
  const listeners = new Set();
  const reading = new Map(); // id → the read under way, so two never overlap

  const changed = (id) => {
    for (const fn of listeners) fn(id);
  };

  /** A hook event: the session is added or updated. `event` is watch.js parseEvent's, with `tty` from its header. */
  function hear(event) {
    const id = event.sessionId;
    const s = sessions.get(id) ?? { id, offset: null, rest: '', items: [], nextId: 1 };
    s.name = event.folder;
    s.cwd = event.cwd || s.cwd || '';
    const transcript = checkTranscript(event.transcript, configDirs());
    if (transcript && transcript !== s.transcript) {
      s.transcript = transcript;
      s.offset = null; // a new file (a resumed session can move): read it from the start
      s.rest = '';
      s.items = [];
    }
    if (typeof event.tty === 'string' && TTY.test(event.tty)) s.tty = event.tty;
    // A notification that needs nothing (an idle session, hooks.js needsYou) does not make the session wait for the person.
    const counts = event.name !== 'Notification' || needsYou(event);
    s.status = (counts ? STATUS_AFTER[event.name] : null) ?? s.status ?? 'idle';
    s.lastEvent = now();
    sessions.set(id, s);
    changed(id);
  }

  /**
   * The sessions running now, from Claude Code's sessions/ folder: each interactive one whose process is alive is added
   * (or kept up to date), with its transcript, its name and its terminal. A session found this way that has stopped
   * running is taken off the list. Failures leave the list as it was.
   */
  async function discover() {
    const found = [];
    for (const dir of configDirs()) {
      let names;
      try {
        names = await fs.readdir(path.join(dir, 'sessions'));
      } catch {
        continue;
      }
      for (const name of names.filter((n) => /^\d+\.json$/.test(n))) {
        try {
          const j = JSON.parse(await fs.readFile(path.join(dir, 'sessions', name), 'utf8'));
          if (!isObject(j) || !Number.isInteger(j.pid) || typeof j.sessionId !== 'string' || !/^[\w-]{1,100}$/.test(j.sessionId)) continue;
          if (typeof j.cwd !== 'string' || (j.kind && j.kind !== 'interactive') || !isAlive(j.pid)) continue;
          found.push({ ...j, dir });
        } catch {
          // a file being written, or not one of these: skipped
        }
      }
    }
    const terminals = await ttys(found.map((j) => j.pid)).catch(() => ({}));
    const running = new Set();
    for (const j of found) {
      running.add(j.sessionId);
      const s = sessions.get(j.sessionId) ?? { id: j.sessionId, offset: null, rest: '', items: [], nextId: 1, lastEvent: j.updatedAt || now() };
      s.name = typeof j.name === 'string' && j.name ? j.name : path.basename(j.cwd) || 'your project';
      s.cwd = j.cwd;
      s.pid = j.pid;
      const transcript = checkTranscript(path.join(j.dir, 'projects', projectFolder(j.cwd), `${j.sessionId}.jsonl`), configDirs());
      if (!s.transcript && transcript) s.transcript = transcript;
      if (terminals[j.pid]) s.tty = terminals[j.pid];
      // Claude Code's own word for it, until a hook says more.
      if (!s.status || s.status === 'idle' || s.status === 'working') s.status = j.status === 'busy' ? 'working' : 'idle';
      sessions.set(s.id, s);
    }
    for (const [id, s] of sessions) if (s.pid && !running.has(id)) sessions.delete(id);
    await Promise.all([...sessions.values()].map(readTitle));
  }

  /** The sessions, newest first, without the ones quiet for FORGET_AFTER_MS or ended. */
  function list() {
    const at = now();
    for (const [id, s] of sessions) if (at - s.lastEvent >= FORGET_AFTER_MS && !s.pid) sessions.delete(id);
    return [...sessions.values()]
      .filter((s) => s.status !== 'ended')
      .sort((a, b) => b.lastEvent - a.lastEvent)
      .map((s) => ({ id: s.id, name: s.name, title: s.title ?? null, status: s.status, canTalk: Boolean(s.tty) }));
  }

  /** Look for the session's title at the end of its file, at most every TITLE_EVERY_MS. */
  async function readTitle(s) {
    if (!s.transcript || (s.titleAt && now() - s.titleAt < TITLE_EVERY_MS)) return;
    s.titleAt = now();
    let handle;
    try {
      handle = await fs.open(s.transcript, 'r');
      const { size } = await handle.stat();
      const length = Math.min(size, TITLE_READ);
      const buffer = Buffer.alloc(length);
      await handle.read(buffer, 0, length, size - length);
      s.title = titleIn(buffer.toString('utf8')) ?? s.title ?? null;
    } catch {
      // no file yet, or it went: the title stays as it was
    } finally {
      await handle?.close();
    }
  }

  /** Read what was added to the session's file since the last read. Answers whether new items came. */
  async function readNew(s) {
    if (!s.transcript) return false;
    let handle;
    try {
      handle = await fs.open(s.transcript, 'r');
      const { size } = await handle.stat();
      if (s.offset === null || size < s.offset) {
        // First read (or the file was replaced): from FIRST_READ before the end, from the start of a whole line.
        s.offset = Math.max(0, size - FIRST_READ);
        s.rest = '';
        s.skipFirst = s.offset > 0;
        s.items = [];
        s.queued = [];
      }
      if (size === s.offset) return false;
      const length = Math.min(size - s.offset, READ_MAX);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, s.offset);
      s.offset += bytesRead;
      const lines = (s.rest + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      s.rest = lines.pop(); // a line still being written ends in the next read
      if (s.skipFirst) {
        lines.shift(); // the read began inside a line
        s.skipFirst = false;
      }
      let added = 0;
      const title = titleIn(lines.join('\n'));
      if (title) s.title = title;
      for (const line of lines) {
        if (!line.trim()) continue;
        let entry;
        try {
          entry = JSON.parse(line);
        } catch {
          continue;
        }
        // A message sent while Claude worked shows the moment it is queued, as the terminal shows it; when it reaches
        // Claude later, it is not shown again.
        const queue = queueOf(entry);
        const delivered = (text) => {
          const at = s.queued.indexOf(text);
          if (at >= 0) s.queued.splice(at, 1);
          return at >= 0;
        };
        if (queue?.queued) s.queued = [...s.queued, queue.queued].slice(-QUEUED_MAX);
        const items = queue?.queued ? [{ kind: 'you', text: queue.queued }]
          : queue?.delivered ? (delivered(queue.delivered) ? [] : [{ kind: 'you', text: queue.delivered }])
            : itemsOf(entry).filter((item) => item.kind !== 'you' || !delivered(item.text));
        for (const item of items) {
          s.items.push({ id: s.nextId++, ...item });
          added += 1;
        }
      }
      if (s.items.length > KEEP) s.items.splice(0, s.items.length - KEEP);
      return added > 0;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[buddy] could not read a Claude Code session:', err.code || err.name);
      return false;
    } finally {
      await handle?.close();
    }
  }

  /** Read the session's new lines (one read at a time); onChange hears of it when items came. */
  async function refresh(id) {
    const s = sessions.get(id);
    if (!s) return;
    if (reading.has(id)) return reading.get(id);
    const run = readNew(s).then((added) => {
      if (added) changed(id);
    }).finally(() => reading.delete(id));
    reading.set(id, run);
    return run;
  }

  /** What the panel shows of a session: its name, status, whether Buddy can type into it, and its items. */
  function view(id) {
    const s = sessions.get(id);
    if (!s) return null;
    return { id: s.id, name: s.name, title: s.title ?? null, status: s.status, canTalk: Boolean(s.tty), items: s.items };
  }

  return {
    hear,
    discover,
    list,
    refresh,
    view,
    /** The terminal (tty) a session runs in, and its folder: for typing into it. */
    target: (id) => {
      const s = sessions.get(id);
      return s ? { tty: s.tty || null, name: s.name } : null;
    },
    onChange(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

module.exports = { KEEP, FIRST_READ, TTY, STATUS_AFTER, QUEUED_MAX, shortPath, toolLine, resultText, typedText, itemsOf, queueOf, checkTranscript, projectFolder, titleIn, createLive };
