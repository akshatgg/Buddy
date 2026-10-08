'use strict';

/**
 * Finds Claude Code on this computer and asks it whether it is signed in. The common ground of the three Claude Code
 * pieces (spec 2026-10-08-buddy-claude-code-brain-design.md, §2): the brain runs it, the drive piece runs it in a
 * project, the watch piece hooks into it, and Settings → Claude Code shows the status line from here.
 *
 * Electron does not get the shell's PATH on the Mac, so after PATH the usual install folders are looked in too.
 * `status()` runs `claude auth status` (JSON, exit code 1 when not signed in) and `claude --version`; the answer is
 * kept for a minute, so Settings and the AI route never wait on it twice in a row.
 */

const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');
const { spawn } = require('node:child_process');

const PROVIDER_ID = 'claude-code'; // the provider id saved in Buddy's settings for "Claude Code on this computer"
const ENV_MARK = 'BUDDY_CLAUDE_CODE'; // set to '1' on every Claude Code process Buddy starts; the watch hooks skip those
const MODELS = ['fable', 'opus', 'sonnet', 'haiku']; // Claude Code's own model aliases
const MODEL_LABELS = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' };
const DEFAULT_MODEL = 'sonnet';
const GET_URL = 'https://claude.com/claude-code';

const CACHE_MS = 60_000;
const STATUS_TIMEOUT_MS = 10_000;

const NOT_INSTALLED = Object.freeze({
  installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null,
});

/** Where the claude command may be, in the order to look: PATH first, so the person's own copy wins. */
function candidates({ env, platform, home }) {
  const windows = platform === 'win32';
  const names = windows ? ['claude.exe', 'claude.cmd'] : ['claude'];
  const dirs = (env.PATH || env.Path || '').split(windows ? ';' : ':').filter(Boolean);
  if (windows) {
    dirs.push(path.win32.join(home, '.local', 'bin')); // the native installer's claude.exe
    if (env.LOCALAPPDATA) dirs.push(path.win32.join(env.LOCALAPPDATA, 'Programs', 'Claude Code'));
    if (env.APPDATA) dirs.push(path.win32.join(env.APPDATA, 'npm'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(home, '.local', 'bin'), path.join(home, '.claude', 'local'), path.join(home, '.npm-global', 'bin'));
  }
  const join = windows ? path.win32.join : path.join;
  // Every folder for claude.exe before any claude.cmd: the native build starts directly, an npm shim only through cmd.
  return names.flatMap((name) => dirs.map((dir) => join(dir, name)));
}

/** One argument quoted for cmd.exe: in double quotes, with inner quotes doubled and % kept from being expanded. */
const cmdQuote = (arg) => `"${String(arg).replace(/"/g, '""').replace(/%/g, '"%"')}"`;

/**
 * Start Claude Code. An npm shim on Windows (claude.cmd) cannot be spawned directly (Node refuses .cmd files without a
 * shell since 20.12), so it goes through cmd.exe with every argument quoted. Arguments must stay on one line: long or
 * multi-line text (a system prompt) goes in a file (--system-prompt-file) or on stdin. Every process Buddy starts is
 * marked with ENV_MARK, and never opens a console window on Windows. Used by find.js, run.js and job.js.
 */
function spawnClaude(spawnImpl, file, args, options = {}, { killTree = defaultKillTree } = {}) {
  const env = { ...(options.env || process.env), [ENV_MARK]: '1' };
  const opts = { ...options, env, windowsHide: true };
  if (/\.cmd$/i.test(file)) {
    const child = spawnImpl([file, ...args].map(cmdQuote).join(' '), [], { ...opts, shell: true });
    // Killing cmd.exe would leave Claude Code (its child) running: kill() takes the whole tree down instead.
    const kill = child.kill?.bind(child);
    child.kill = (signal) => {
      if (child.pid) killTree(child.pid);
      else if (kill) kill(signal);
      return true;
    };
    return child;
  }
  return spawnImpl(file, args, opts);
}

/** End a process and everything it started, on Windows (taskkill /T). */
function defaultKillTree(pid) {
  try {
    spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' }).on('error', () => {});
  } catch {
    // Already gone, or taskkill is missing: nothing more to do.
  }
}

const text = (v) => (typeof v === 'string' && v.trim() ? v.trim() : null);
const capital = (s) => s.charAt(0).toUpperCase() + s.slice(1);

function createFind({
  env = process.env,
  platform = process.platform,
  home = os.homedir(),
  spawnImpl = spawn,
  existsSync = fs.existsSync,
  now = Date.now,
  statusTimeoutMs = STATUS_TIMEOUT_MS,
} = {}) {
  let cached = null; // { at, status }
  let pending = null; // the status on its way, shared by everyone who asks meanwhile

  function find() {
    return candidates({ env, platform, home }).find((p) => existsSync(p)) ?? null;
  }

  /** Run the command once and give its stdout, or null when it fails, hangs or cannot start. */
  function run(file, args) {
    return new Promise((resolve) => {
      let child;
      try {
        child = spawnClaude(spawnImpl, file, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
      } catch {
        resolve(null);
        return;
      }
      let out = '';
      let done = false;
      const finish = (value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(value);
      };
      const timer = setTimeout(() => {
        child.kill();
        finish(null);
      }, statusTimeoutMs);
      child.stdout.on('data', (chunk) => { out += chunk; });
      child.stderr?.on('data', () => {});
      child.on('error', () => finish(null));
      child.on('close', () => finish(out)); // close, not exit: at exit its output may not all be read yet
    });
  }

  async function ask() {
    const file = find();
    if (!file) return { ...NOT_INSTALLED };
    const [auth, version] = await Promise.all([run(file, ['auth', 'status']), run(file, ['--version'])]);
    if (auth === null && version === null) return { ...NOT_INSTALLED }; // it could not even start
    let j = null;
    try {
      j = JSON.parse(auth);
    } catch {
      // Not signed in, or an older Claude Code that answers in words.
    }
    const loggedIn = j?.loggedIn === true;
    return {
      installed: true,
      loggedIn,
      email: loggedIn ? text(j.email) : null,
      plan: loggedIn ? text(j.subscriptionType) : null,
      version: text(version)?.split(/\s+/)[0] ?? null,
      path: file,
      configDirectory: text(j?.configDirectory),
    };
  }

  function status({ force = false } = {}) {
    if (!force && cached && now() - cached.at < CACHE_MS) return Promise.resolve(cached.status);
    if (!force && pending) return pending;
    pending = ask().then((s) => {
      cached = { at: now(), status: s };
      pending = null;
      return s;
    });
    return pending;
  }

  /** The status line for Settings: what to say, and a link to get Claude Code when it is missing. */
  function line(s) {
    if (!s?.installed) return { text: "Claude Code isn't installed on this computer.", link: { label: 'Get Claude Code', url: GET_URL } };
    if (!s.loggedIn) return { text: 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.', link: null };
    const who = s.email ? ` as ${s.email}` : '';
    const plan = s.plan ? ` (${capital(s.plan)})` : '';
    return { text: `Claude Code: signed in${who}${plan}`, link: null };
  }

  return { find, status, line };
}

module.exports = { createFind, spawnClaude, PROVIDER_ID, ENV_MARK, MODELS, MODEL_LABELS, DEFAULT_MODEL, GET_URL };
