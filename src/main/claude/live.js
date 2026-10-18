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
const { newTally, tally, noteAgent, workerTokens, workerActivity, ownEnd, running, expire, viewOf } = require('./usage');

const KEEP = 500; // the items kept for a session: the newest
const WORKER_QUIET_MS = 10 * 60_000; // a running worker whose file has not grown this long is taken as stopped
const WORKER_TAIL = 256 * 1024; // a worker's file is read from this many bytes before its end, the first time
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
    const background = new Map(); // jobId → the background session of that job (a parked session's live one)
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
          if (typeof j.cwd !== 'string' || !isAlive(j.pid)) continue;
          // A background job is no session of the list. Only the one a parked session continues in is looked for.
          if (j.kind === 'bg' && typeof j.jobId === 'string') background.set(j.jobId, { ...j, dir });
          if (j.kind && j.kind !== 'interactive') continue;
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
      // A parked session goes on in a background job: the panel shows that one's file, not the old file that stopped.
      const parked = typeof j.parkedJobId === 'string' ? background.get(j.parkedJobId) : null;
      const live = parked && parked.cwd === j.cwd && parked.dir === j.dir && /^[\w-]{1,100}$/.test(parked.sessionId) ? parked : null; // the same project and config folder only
      s.parked = typeof j.parkedJobId === 'string' && !live; // parked and nowhere to follow: its workers are over
      const transcript = checkTranscript(path.join(j.dir, 'projects', projectFolder((live ?? j).cwd), `${(live ?? j).sessionId}.jsonl`), configDirs());
      if (live && transcript && transcript !== s.transcript) {
        s.transcript = transcript;
        s.offset = null; // read from the start
        s.rest = '';
        s.continued = false;
      } else if (!s.transcript && transcript) {
        s.transcript = transcript;
      }
      if (terminals[j.pid]) s.tty = terminals[j.pid];
      // Claude Code's own word for it, until a hook says more.
      const word = (live ?? j).status;
      if (!s.status || s.status === 'idle' || s.status === 'working') s.status = word === 'busy' ? 'working' : 'idle';
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

  /** Read what was added to the session's file since the last read. Answers whether anything shown changed. */
  async function readLines(s) {
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
        s.tally = newTally(); // the tokens and workers are counted again with the items
        s.agents = new Map(); // a worker's tool_use id → its own file: { file, offset, rest }
        s.metaSeen = new Set(); // the .meta.json files read
        s.quiet = new Map();
        s.continued = false;
        s.next = null;
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
      let touched = false; // the tokens or the workers changed
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
        if (entry?.type === 'continued-in' && typeof entry.continuedInSessionId === 'string' && /^[\w-]{1,100}$/.test(entry.continuedInSessionId)) {
          // The session goes on in another file (/continue, a parked session): follow it, its workers here are over.
          s.next = checkTranscript(path.join(path.dirname(s.transcript), `${entry.continuedInSessionId}.jsonl`), configDirs());
          s.continued = true;
          touched = true;
        }
        if (tally(s.tally, entry)) touched = true;
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
      return added > 0 || touched;
    } catch (err) {
      if (err.code !== 'ENOENT') console.warn('[buddy] could not read a Claude Code session:', err.code || err.name);
      return false;
    } finally {
      await handle?.close();
    }
  }

  /**
   * The whole lines added to a worker's file ({ file, offset, rest }) since the last read; none when it is not there.
   * The first time (`offset` null) only the last WORKER_TAIL bytes are read (a worker's file can be megabytes), and
   * `mtimeMs` says when the file last changed.
   */
  async function newLines(f) {
    let handle;
    try {
      handle = await fs.open(f.file, 'r');
      const { size, mtimeMs } = await handle.stat();
      f.mtimeMs = mtimeMs;
      if (f.offset === null) {
        f.offset = Math.max(0, size - WORKER_TAIL);
        f.skipFirst = f.offset > 0; // the read begins inside a line
        f.first = true;
      } else {
        f.first = false;
      }
      if (size < f.offset) {
        f.offset = 0; // the file was replaced: from its start
        f.rest = '';
        f.skipFirst = false;
      }
      if (size <= f.offset) return [];
      const length = Math.min(size - f.offset, READ_MAX);
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, f.offset);
      f.offset += bytesRead;
      const lines = (f.rest + buffer.subarray(0, bytesRead).toString('utf8')).split('\n');
      f.rest = lines.pop(); // a line still being written ends in the next read
      if (f.skipFirst) {
        lines.shift();
        f.skipFirst = false;
      }
      return lines;
    } catch {
      return [];
    } finally {
      await handle?.close();
    }
  }

  /**
   * The workers still running, from their own files: subagents/agent-<id>.jsonl next to the session's file, whose
   * agent-<id>.meta.json names the Agent tool_use it runs for and its type. From each file come its tokens, what it is
   * doing now and its own end. A worker whose file has been quiet too long is taken as stopped, counted from the file's
   * own last line (not from when Buddy first looked). Answers whether anything of a worker changed.
   */
  async function readWorkers(s) {
    const ids = running(s.tally);
    if (!ids.length || !s.transcript) return false;
    const over = s.status === 'ended' || s.continued || s.parked; // the session is over: its workers are too (after a last look at their files)
    if (over && s.status === 'ended') return expire(s.tally, ids, now());
    s.agents ??= new Map();
    s.metaSeen ??= new Set();
    s.quiet ??= new Map(); // a running worker's id → when it was last seen to do something
    const dir = path.join(s.transcript.slice(0, -'.jsonl'.length), 'subagents');
    let names = [];
    try {
      names = await fs.readdir(dir);
    } catch {
      // no worker has written yet
    }
    let changed = false;
    for (const name of names) {
      const m = /^agent-([\w-]{1,100})\.meta\.json$/.exec(name);
      if (!m || s.metaSeen.has(name)) continue;
      try {
        const meta = JSON.parse(await fs.readFile(path.join(dir, name), 'utf8'));
        s.metaSeen.add(name);
        if (typeof meta?.toolUseId !== 'string') continue;
        s.agents.set(meta.toolUseId, { file: path.join(dir, `agent-${m[1]}.jsonl`), offset: null, rest: '', handbacks: new Set() });
        if (noteAgent(s.tally, meta.toolUseId, m[1], meta.agentType)) changed = true;
      } catch {
        // being written: read again next time
      }
    }
    const stale = [];
    for (const id of ids) {
      const worker = s.tally.workers.get(id);
      if (!s.quiet.has(id)) s.quiet.set(id, worker?.startedAt ?? now()); // quiet since it started
      const f = s.agents.get(id);
      if (!f) {
        if (now() - s.quiet.get(id) > WORKER_QUIET_MS) stale.push(id);
        continue;
      }
      const fresh = await newLines(f);
      // The first look: its clock starts at the file's last line, so an old worker is not taken as busy for 10 minutes.
      if (f.first) {
        const stamp = Date.parse([...fresh].reverse().map((l) => /"timestamp":"([^"]+)"/.exec(l)?.[1]).find(Boolean));
        s.quiet.set(id, Number.isFinite(stamp) ? stamp : (f.mtimeMs ?? s.quiet.get(id)));
      } else if (fresh.length) {
        s.quiet.set(id, now());
      }
      // A worker resumed since its file was last read: quiet counts from then.
      const quietSince = Math.max(s.quiet.get(id), worker?.startedAt ?? 0);
      if (now() - quietSince > WORKER_QUIET_MS) stale.push(id);
      let usage = null;
      let activity = null;
      for (const line of fresh) {
        if (!(line.includes('"type":"assistant"') || line.includes('"tool_result"') || line.includes('"stop_reason"'))) continue;
        let e;
        try {
          e = JSON.parse(line);
        } catch {
          continue; // not a whole line
        }
        if (e?.type === 'assistant') {
          if (e.message?.usage) usage = e.message.usage;
          const blocks = Array.isArray(e.message?.content) ? e.message.content : [];
          const tool = blocks.find((b) => b?.type === 'tool_use');
          const words = blocks.find((b) => b?.type === 'text' && typeof b.text === 'string' && b.text.trim());
          if (tool) activity = toolLine(tool.name, tool.input);
          else if (words) activity = words.text.trim().split('\n')[0];
        }
        if (ownEnd(s.tally, id, e, f.handbacks)) changed = true;
      }
      if (usage && workerTokens(s.tally, id, usage)) changed = true;
      if (activity && workerActivity(s.tally, id, activity)) changed = true;
    }
    if (expire(s.tally, over ? ids : stale, now())) changed = true; // expire() leaves the ones that ended
    return changed;
  }

  /** Read what was added to the session's file and to its running workers' files. Answers whether anything changed. */
  async function readNew(s) {
    s.tally ??= newTally();
    let lines = await readLines(s);
    // The session went on in another file: the panel follows it (when it is there yet).
    for (let hops = 0; s.next && s.next !== s.transcript && hops < 3; hops += 1) {
      try {
        await fs.stat(s.next);
      } catch {
        break; // not written yet: this file's workers are over meanwhile (s.continued), and it is tried again
      }
      s.transcript = s.next;
      s.next = null;
      s.offset = null;
      s.rest = '';
      s.title = null;
      s.titleAt = 0;
      lines = (await readLines(s)) || true;
    }
    const workers = await readWorkers(s);
    return lines || workers;
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

  /** What the panel shows of a session: its name, status, whether Buddy can type into it, its items, its tokens and workers. */
  function view(id) {
    const s = sessions.get(id);
    if (!s) return null;
    return { id: s.id, name: s.name, title: s.title ?? null, status: s.status, canTalk: Boolean(s.tty), items: s.items, ...viewOf(s.tally ?? newTally()) };
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
