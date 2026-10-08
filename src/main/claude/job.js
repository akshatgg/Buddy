'use strict';

/**
 * One job for Claude Code: "fix the login bug in my-app" handed to `claude -p` in that project's folder, its stream
 * read line by line into a few events the chat shows (src/main/actions.js), its permission questions answered over its
 * stdin (Task 2a) and the whole thing stopped on Stop or after 30 minutes. Nothing of the project goes anywhere but
 * into the process: the log only ever names an error code and an exit code.
 *
 * The stream (`--output-format stream-json --verbose`) is one JSON object a line: `system` (init), `assistant` (text
 * and tool_use blocks), `user` (tool results), `control_request` (a permission question, with `--permission-prompts
 * host`) and last `result` ({ subtype, is_error, result }).
 */

const { spawn } = require('node:child_process');
const path = require('node:path');
const readline = require('node:readline');
const { BuddyError } = require('../../../shared/errors');
const { spawnClaude, MODELS, DEFAULT_MODEL } = require('./find');

// The words of piece 1's errors (the brain spec §5), kept here too: the brain's run.js belongs to another session.
const ERRORS = {
  no_claude: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.",
  claude_signed_out: "Claude Code isn't signed in. Open a terminal, run claude, and sign in.",
  claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.',
  claude_failed: (name) => `Claude Code couldn't finish in ${name}.`,
  too_long: 'That took too long, so I stopped it.',
};
const MAX_JOB_MS = 30 * 60_000; // no job runs longer than this
const ANSWER_MS = 10 * 60_000; // a permission question left open this long is denied (Task 2a)
const KILL_MS = 3000; // SIGKILL this long after SIGTERM, when the process has not gone by itself
const LINE_CHARS = 80; // a command is shown cut to this
// Whether the job asks the person before a command (Task 2a) or runs with a fixed allow list (Task 2b).
const ASKS_PERMISSION = true;
const SAID_NO = 'The person said no.';
const CANT_ASK = "Buddy can't ask the person here. Make a sensible choice and say what you chose in your summary.";
const LIMIT_WORDS = /rate_limit|usage limit|limit reached/i;
const SIGNED_OUT_WORDS = /not logged in|authentication_error|invalid api key|please run \/login/i;
const DONE_WORDS = 'When you are done, say in plain words, in at most five short lines, what you did and what is left.';
// The appended system prompt: one line (find.js's spawnClaude keeps every argument on one line), the name when known.
const SUMMARY = (person) => {
  const name = typeof person === 'string' ? person.replace(/\s+/g, ' ').trim() : '';
  return name ? `The person's name is ${name}. ${DONE_WORDS}` : DONE_WORDS;
};

/** `text` on one line, cut to `max` characters with "…". */
function cut(text, max = LINE_CHARS) {
  const flat = String(text).replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/** A file's path as shown: inside the project, relative to it; elsewhere, as it is. */
function shownPath(file, projectPath) {
  if (!projectPath || !path.isAbsolute(file)) return file;
  const relative = path.relative(projectPath, file);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative : file;
}

/** One short line for a tool Claude Code uses: what it reads, edits, writes, looks for or runs. */
function lineFor(name, input, projectPath) {
  const file = typeof input?.file_path === 'string' ? input.file_path : '';
  if (name === 'Read' && file) return `Reading ${shownPath(file, projectPath)}`;
  if (name === 'Edit' && file) return `Editing ${shownPath(file, projectPath)}`;
  if (name === 'Write' && file) return `Writing ${shownPath(file, projectPath)}`;
  if ((name === 'Glob' || name === 'Grep') && typeof input?.pattern === 'string') return `Looking for "${cut(input.pattern)}"`;
  if (name === 'Bash' && typeof input?.command === 'string') return `Running: ${cut(input.command)}`;
  if (name === 'WebFetch' || name === 'WebSearch') return 'Searching the web';
  return 'Working…';
}

/** The question the chat asks before a tool Claude Code may not use on its own: the command, or the tool's name. */
function questionFor(name, input) {
  if (name === 'Bash' && typeof input?.command === 'string' && input.command.trim()) return `Run ${cut(input.command)}?`;
  return `Use ${name}?`;
}

/** Which of piece 1's errors a failed result is, by its words. */
function codeFor(text) {
  if (LIMIT_WORDS.test(text)) return 'claude_limit';
  if (SIGNED_OUT_WORDS.test(text)) return 'claude_signed_out';
  return 'claude_failed';
}

/**
 * `find` is find.js's; `projects` is projects.js's; `spawnImpl`, `env` and the timers are the system's (the tests pass
 * their own). The arguments Claude Code is started with are in the plan (J4); Task 2a or 2b sets the permission ones.
 */
function createJobs({ find, projects, spawnImpl = spawn, env = process.env, later = setTimeout, cancelLater = clearTimeout }) {
  const live = new Set(); // the handles of the jobs still running, for stopAll
  function argsFor({ model, person }) {
    const alias = MODELS.includes(model) ? model : DEFAULT_MODEL;
    return [
      '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
      '--permission-mode', 'acceptEdits',
      // The permission questions come to Buddy as control_requests on stdout; 2.1.289 sends them only with the
      // stdio prompt tool as well (without it, it denies on its own: the plan's Task 1).
      '--permission-prompts', 'host', '--permission-prompt-tool', 'stdio',
      '--max-turns', '60', // accepted by 2.1.289, though not in its --help (the plan's Task 1)
      '--model', alias,
      '--append-system-prompt', SUMMARY(person),
    ];
  }

  /**
   * Start a job in `project` ({ path, name }). `onEvent` gets the events of J4, the last of them `done`, `failed` or
   * `stopped`, and nothing after that. Answers { stop(), answer(requestId, allow) }.
   */
  function start({ project, task, person, model, onEvent }) {
    const command = find.find();
    if (!command) throw new BuddyError('no_claude', ERRORS.no_claude);
    // spawnClaude marks the process (ENV_MARK), hides its window and runs an npm claude.cmd through cmd on Windows.
    const child = spawnClaude(spawnImpl, command, argsFor({ model, person }), {
      cwd: project.path,
      env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let result = null; // the stream's last `result`, read
    let ended = false;
    let stopping = null; // null, 'stop' (Stop in the chat) or 'too_long' (the 30 minutes)
    let kill = null;
    const timers = new Set();
    const open = new Map(); // requestId -> the timer that denies it after ANSWER_MS
    const handle = { stop: () => terminate('stop'), answer }; // what start answers

    const after = (fn, ms) => {
      const timer = later(() => {
        timers.delete(timer);
        fn();
      }, ms);
      timers.add(timer);
      return timer;
    };
    const emit = (event) => {
      if (!ended) onEvent(event);
    };
    const end = (event) => {
      if (ended) return;
      emit(event);
      ended = true;
      live.delete(handle);
      for (const timer of timers) cancelLater(timer);
      timers.clear();
    };

    /** The control response for one question, in the shape Claude Code 2.1.289 reads (the spike's). */
    function respond(requestId, allow, message = SAID_NO) {
      const response = allow ? { behavior: 'allow' } : { behavior: 'deny', message };
      child.stdin.write(`${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })}\n`);
    }

    /** Allow or No from the chat. False when that question is not open (answered, denied by time, or never asked). */
    function answer(requestId, allow) {
      const wait = open.get(requestId);
      if (wait === undefined || stopping || ended) return false; // its stdin is closed by now
      open.delete(requestId);
      cancelLater(wait);
      timers.delete(wait);
      respond(requestId, allow);
      return true;
    }

    /** Ends the process: SIGTERM, and SIGKILL when it is still there KILL_MS later. */
    function terminate(reason) {
      if (stopping) return;
      stopping = reason;
      child.stdin.end();
      child.kill('SIGTERM');
      kill = after(() => child.kill('SIGKILL'), KILL_MS);
    }

    function onLine(line) {
      if (ended) return;
      let message;
      try {
        message = JSON.parse(line);
      } catch {
        return; // claude prints the odd plain line too
      }
      if (message?.type === 'assistant') {
        const blocks = Array.isArray(message.message?.content) ? message.message.content : [];
        for (const block of blocks) {
          if (block?.type === 'tool_use') emit({ type: 'line', text: lineFor(block.name, block.input, project.path) });
        }
      } else if (message?.type === 'result') {
        result = { isError: message.is_error === true, text: typeof message.result === 'string' ? message.result.trim() : '' };
      } else if (message?.type === 'control_request' && message.request?.subtype === 'can_use_tool' && typeof message.request_id === 'string') {
        const id = message.request_id;
        const { tool_name: name, input } = message.request;
        // Claude Code's own questions to the person are not asked here: it is told to choose (the spec's out of scope).
        if (name === 'AskUserQuestion') {
          if (!stopping) respond(id, false, CANT_ASK);
          return;
        }
        // Nothing is answered without the person; a question left open for ANSWER_MS is denied, and the job goes on.
        open.set(id, after(() => {
          open.delete(id);
          if (!stopping) respond(id, false); // after Stop its stdin is closed, and the process is going anyway
          emit({ type: 'expired', requestId: id });
        }, ANSWER_MS));
        emit({ type: 'ask', requestId: id, text: questionFor(name, input), what: name === 'Bash' && typeof input?.command === 'string' && input.command.trim() ? cut(input.command) : name });
      }
    }

    child.stdin.on?.('error', () => {}); // a process that has gone closes its stdin: a late write is nothing to crash on
    readline.createInterface({ input: child.stdout }).on('line', onLine);
    readline.createInterface({ input: child.stderr }).on('line', () => {}); // read, so that a chatty process never blocks; never logged
    child.on('error', (err) => {
      console.warn('[buddy] claude could not run:', err.code);
      end({ type: 'failed', code: 'claude_failed', message: ERRORS.claude_failed(project.name) });
    });
    child.on('close', (code) => {
      if (kill) {
        cancelLater(kill);
        timers.delete(kill);
      }
      if (stopping === 'stop') return end({ type: 'stopped' });
      if (stopping === 'too_long') return end({ type: 'failed', code: 'too_long', message: ERRORS.too_long });
      if (result && !result.isError && code === 0 && result.text) return end({ type: 'done', text: result.text });
      console.warn('[buddy] claude job failed: exit', code);
      const failure = codeFor(result?.text || '');
      end({ type: 'failed', code: failure, message: failure === 'claude_failed' ? ERRORS.claude_failed(project.name) : ERRORS[failure] });
    });

    child.stdin.write(`${JSON.stringify({ type: 'user', message: { role: 'user', content: task } })}\n`);
    after(() => terminate('too_long'), MAX_JOB_MS);

    live.add(handle);
    return handle;
  }

  /** Stop every job still running: Buddy is quitting. */
  function stopAll() {
    for (const handle of live) handle.stop();
  }

  return {
    start,
    stopAll,
    projects: () => projects.found(),
    lastProject: () => projects.lastProject(),
    setLastProject: (p) => projects.setLastProject(p),
    status: () => find.status(),
  };
}

module.exports = { createJobs, lineFor, questionFor, ERRORS, MAX_JOB_MS, ANSWER_MS, KILL_MS, ASKS_PERMISSION };
