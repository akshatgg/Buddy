'use strict';

const path = require('node:path');
const { BuddyError } = require('../../../shared/errors');
const { writeAtomic } = require('../store');
const { ENV_MARK } = require('./find'); // in every Buddy command: Buddy's own runs carry it and send nothing

/**
 * Buddy's hooks in Claude Code's settings.json (spec 2026-10-08-buddy-claude-code-watch-design.md §3). Seven small
 * command hooks, one on each event Buddy listens for, POST the event's JSON to Buddy's local port (watch.js). Each
 * command always exits 0, so it never blocks or slows Claude Code, and when Buddy is not running nothing happens.
 * Buddy's own Claude Code runs carry BUDDY_CLAUDE_CODE=1 (find.js ENV_MARK) and send nothing.
 *
 * withHooks / withoutHooks are plain functions over the file's JSON: the person's own hooks stay exactly as they were,
 * Buddy's entries are known by their exact shape (isBuddyHook). createHooks is the thin file layer around them.
 */

// The events Buddy listens for, and the matcher each entry carries (null: none, which Claude Code reads as every
// tool, every error). Notification is narrowed to the kinds that mean "Claude Code is waiting for you".
const HOOK_EVENTS = Object.freeze([
  ['UserPromptSubmit', null],
  ['PreToolUse', null],
  ['PostToolUse', null], // a tool that finished: a long run (npm test) still counts as work (watch.js QUIET_MS)
  ['Stop', null],
  ['StopFailure', null],
  ['SessionEnd', null],
  ['PermissionRequest', null],
  ['Notification', 'permission_prompt|idle_prompt|agent_needs_input'],
]);
const MARK = '/claude-code/'; // the path of Buddy's local URL
// With ENV_MARK, how Buddy's entries are told from the person's own: any port and token, so old entries are replaced.
const BUDDY_URL = /http:\/\/127\.0\.0\.1:\d+\/claude-code\/[0-9a-f]{32}(?![0-9a-zA-Z])/;
const HOOK_TIMEOUT_S = 3;
const BACKUP_SUFFIX = '.before-buddy';
const NEW_FILE_MODE = 0o600;
const CANT_READ = "I couldn't read Claude Code's settings file, so I didn't change it.";

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/**
 * The shell command of a Buddy hook: curl the event (stdin) to Buddy, unless this is one of Buddy's own runs. The same
 * on every platform: Claude Code runs hook commands in bash (Git Bash on Windows), never in cmd.exe. On a Windows
 * machine without Git Bash it runs them in PowerShell, where this fails without blocking (watching does not work there).
 */
function hookCommand({ port, token }) {
  const url = `http://127.0.0.1:${port}${MARK}${token}`;
  return `[ -n "$${ENV_MARK}" ] || curl -s -m 2 -X POST --data-binary @- ${url} >/dev/null 2>&1; exit 0`;
}

/** Buddy's exact shape: the mark of its own runs, and its local URL with a 32-character token. */
function isBuddyHook(hook) {
  if (!isPlainObject(hook) || typeof hook.command !== 'string') return false;
  return hook.command.includes(ENV_MARK) && BUDDY_URL.test(hook.command);
}

const hasBuddyHook = (entry) => isPlainObject(entry) && Array.isArray(entry.hooks) && entry.hooks.some(isBuddyHook);

/** The JSON without Buddy's entries: an entry emptied by that goes, an event emptied by that goes, nothing else moves. */
function withoutHooks(json) {
  const out = structuredClone(json);
  if (!isPlainObject(out.hooks)) return out;
  let removedAny = false;
  for (const [event, entries] of Object.entries(out.hooks)) {
    if (!Array.isArray(entries) || !entries.some(hasBuddyHook)) continue;
    removedAny = true;
    const rest = entries.flatMap((entry) => {
      if (!hasBuddyHook(entry)) return [entry];
      const hooks = entry.hooks.filter((hook) => !isBuddyHook(hook));
      return hooks.length ? [{ ...entry, hooks }] : [];
    });
    if (rest.length) out.hooks[event] = rest;
    else delete out.hooks[event];
  }
  if (removedAny && Object.keys(out.hooks).length === 0) delete out.hooks;
  return out;
}

/** The JSON with Buddy's entries for this port and token, after whatever the person has on each event. */
function withHooks(json, { port, token, platform }) {
  const out = withoutHooks(json);
  const hooks = isPlainObject(out.hooks) ? out.hooks : {};
  const command = hookCommand({ port, token, platform });
  for (const [event, matcher] of HOOK_EVENTS) {
    const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
    hooks[event] = [...entries, { ...(matcher ? { matcher } : {}), hooks: [{ type: 'command', command, timeout: HOOK_TIMEOUT_S }] }];
  }
  out.hooks = hooks;
  return out;
}

/**
 * The file layer: which settings.json (Claude Code's own config folder, from `claude auth status`, else ~/.claude;
 * `file` wins when given, which is how the end-to-end test keeps away from the real one), a copy before the first
 * change, and whole-file writes. `fs` and `write` are passed in by the unit tests.
 */
function createHooks({ find, home, file = null, fs = require('node:fs'), write = writeAtomic, platform = process.platform }) {
  let lastFile = file || path.join(home, '.claude', 'settings.json');

  async function settingsFile() {
    if (file) return file;
    const dir = (await find.status())?.configDirectory || path.join(home, '.claude');
    lastFile = path.join(dir, 'settings.json');
    return lastFile;
  }

  /** The file as Settings names it: the home folder shortened to ~. */
  function shown() {
    const inHome = lastFile.startsWith(home) && /^[\\/]/.test(lastFile.slice(home.length));
    return inHome ? `~${lastFile.slice(home.length)}` : lastFile;
  }

  /** The file's JSON; {} when there is no file; a file Buddy cannot read as an object is never touched. */
  function read(target) {
    if (!fs.existsSync(target)) return {};
    try {
      const json = JSON.parse(fs.readFileSync(target, 'utf8'));
      if (!isPlainObject(json)) throw new Error('not an object');
      return json;
    } catch {
      throw new BuddyError('claude_settings', CANT_READ);
    }
  }

  /**
   * Write `after` when it differs from `before`; the first write keeps a copy of the file as it was, next to the path
   * the person uses. A symlinked file stays a symlink (the file it points to is written, its temp file beside it) and
   * keeps its mode; a new file is made NEW_FILE_MODE.
   */
  function save(target, before, after) {
    if (JSON.stringify(before) === JSON.stringify(after)) return false;
    const exists = fs.existsSync(target);
    const real = exists ? fs.realpathSync(target) : target;
    const mode = exists ? fs.statSync(real).mode & 0o777 : NEW_FILE_MODE;
    const backup = `${target}${BACKUP_SUFFIX}`;
    if (exists && !fs.existsSync(backup)) {
      fs.copyFileSync(real, backup);
      fs.chmodSync(backup, mode);
    }
    write(real, `${JSON.stringify(after, null, 2)}\n`, mode);
    fs.chmodSync(real, mode); // the umask may have narrowed the mode the new file was made with
    return true;
  }

  async function change(update) {
    const target = await settingsFile();
    const before = read(target);
    return save(target, before, update(before));
  }

  return {
    settingsFile,
    shown,
    install: ({ port, token }) => change((json) => withHooks(json, { port, token, platform })),
    remove: () => change(withoutHooks),
  };
}

module.exports = { HOOK_EVENTS, CANT_READ, hookCommand, isBuddyHook, withHooks, withoutHooks, createHooks };
