'use strict';

/**
 * Runs Claude Code once for one answer: the brain of "Claude Code on this computer" (spec
 * 2026-10-08-buddy-claude-code-brain-design.md, §4). One `claude -p` process a request, in safe mode with no tools
 * (Read alone, for a screenshot), so it answers like a plain model and never runs anything: the user text goes in on
 * stdin and one JSON object comes back on stdout. The system prompt goes in a file (arguments stay on one line, so an
 * npm claude.cmd on Windows can be started through cmd). Buddy's data folder is its working directory, every run is
 * started through find.js spawnClaude (marked BUDDY_CLAUDE_CODE=1, so the watch piece's hooks ignore it, and with no
 * window), and the process is killed when the request runs out of time or is abandoned.
 */

const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { BuddyError } = require('../../../shared/errors');
const { spawnClaude } = require('./find');

const TIMEOUT_MS = 60_000; // ai.js passes its AI_TIMEOUT_MS; this is the same, for a caller that passes none
// Under the data folder: the system prompt and a screenshot wait here, as files, while Claude Code reads them.
const TMP_DIR = 'claude-tmp';

// What Buddy says for each way a run can fail (spec §5). The first three are fixed in Settings → AI (actions.js
// AI_ERRORS); the chat offers Try again for the others.
const WORDS = {
  no_claude: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.",
  claude_signed_out: "Claude Code isn't signed in. Open a terminal, run claude, and sign in.",
  claude_limit: 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.',
  claude_failed: "Claude Code couldn't answer. Try again.",
  timeout: 'Claude Code took too long to answer. Try again.',
};
// How a failing run says what went wrong, in its result or on stderr: the plan's usage limit, or not being signed in.
const LIMIT_WORDS = /rate[ _-]?limit|usage limit|limit reached/i;
const AUTH_WORDS = /not logged in|not signed in|not authenticated|authentication|unauthori[sz]ed|invalid api key|\/login/i;

const claudeError = (code) => new BuddyError(code, WORDS[code]);

/** The error a failed run means: its own words say the limit (first) or signing in; anything else is "couldn't answer". */
function errorFor(said) {
  if (LIMIT_WORDS.test(said)) return claudeError('claude_limit');
  if (AUTH_WORDS.test(said)) return claudeError('claude_signed_out');
  return claudeError('claude_failed');
}

/** What an abandoned request means: its deadline passed (a timeout), or it was cancelled (passed through as it is). */
const stopReason = (signal) => (signal.reason?.name === 'TimeoutError' ? claudeError('timeout') : signal.reason);

/**
 * `find` is find.js's finder, `dataDir` Buddy's data folder (app.getPath('userData')). The rest are for the tests:
 * `spawnImpl` in place of spawn, `env` in place of process.env, `fsImpl` in place of fs, `newName` for the names of
 * the system prompt's and the screenshot's files.
 */
function createRun({
  find, dataDir, spawnImpl = spawn, env = process.env, fsImpl = fs, timeoutMs = TIMEOUT_MS,
  newName = () => crypto.randomBytes(8).toString('hex'),
}) {
  const tmpDir = path.join(dataDir, TMP_DIR);
  // Emptied at launch: a file a run left behind (Buddy quit while Claude Code was reading it) is not kept.
  try {
    fsImpl.rmSync(tmpDir, { recursive: true, force: true });
  } catch {
    // It cannot be removed right now: the next files are written beside what is there, and the next launch tries again.
  }

  /** A file only this user and Claude Code can see: 0600, in a folder of Buddy's own (0700). Its path is given. */
  function writeTemp(name, data) {
    fsImpl.mkdirSync(tmpDir, { recursive: true, mode: 0o700 });
    const file = path.join(tmpDir, name);
    fsImpl.writeFileSync(file, data, { mode: 0o600 });
    return file;
  }

  /** Start claude with `user` on its stdin and wait for it: { code, stdout, stderr }, or why it was stopped. */
  function start(file, args, user, signal) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) {
        reject(stopReason(signal));
        return;
      }
      let child;
      try {
        child = spawnClaude(spawnImpl, file, args, { cwd: dataDir, env, stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        reject(claudeError('claude_failed'));
        return;
      }
      let stdout = '';
      let stderr = '';
      let done = false;
      const finish = (settle, value) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        settle(value);
      };
      const stop = (err) => {
        child.kill();
        finish(reject, err);
      };
      const timer = setTimeout(() => stop(claudeError('timeout')), timeoutMs);
      const onAbort = () => stop(stopReason(signal));
      signal?.addEventListener('abort', onAbort, { once: true });
      child.stdout.on('data', (chunk) => { stdout += chunk; });
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.on('error', () => finish(reject, claudeError('claude_failed')));
      child.on('close', (code) => finish(resolve, { code, stdout, stderr }));
      child.stdin.on('error', () => {}); // it exited before reading its input: the exit says what happened
      child.stdin.end(user);
    });
  }

  /** The answer in claude's JSON, as a provider gives it, or the error a failing run means. */
  function read({ code, stdout, stderr }, model) {
    let j = null;
    try {
      j = JSON.parse(stdout);
    } catch {
      // No JSON: it failed before answering, and stderr says why, if anything does.
    }
    const result = typeof j?.result === 'string' ? j.result.trim() : '';
    if (j === null || code !== 0 || j.is_error === true || !result) {
      // The exit and the kind of failure go in the log; the words do not (they can hold the person's own text).
      console.warn(`[buddy] claude code exited ${code}${j?.is_error ? ' with an error' : ''}`);
      throw errorFor(`${result}\n${stderr}`);
    }
    return {
      text: result,
      model,
      usage: { inputTokens: j.usage?.input_tokens ?? 0, outputTokens: j.usage?.output_tokens ?? 0 },
    };
  }

  /**
   * One answer: { text, model, usage } as a provider's complete() gives it. The system prompt goes along as a file, and
   * `image` (base64 JPEG) as another that the user text points at; both are deleted when the run ends, however it ends.
   */
  async function runPrompt({ system, user, image = null, model, signal }) {
    const file = find.find();
    if (!file) throw claudeError('no_claude');
    if (signal?.aborted) throw stopReason(signal); // abandoned already: nothing is written or started
    const temp = [];
    try {
      const name = newName();
      let systemFile;
      let text = user;
      try {
        systemFile = writeTemp(`${name}.txt`, system);
        temp.push(systemFile);
        if (image) {
          const imageFile = writeTemp(`${name}.jpg`, Buffer.from(image, 'base64'));
          temp.push(imageFile);
          text = `${user}\n\nThe screenshot is the image file at ${imageFile}. Read it first.`;
        }
      } catch {
        throw claudeError('claude_failed'); // the data folder cannot be written to: no run can start
      }
      const args = [
        '-p', '--output-format', 'json', '--safe-mode', '--tools', image ? 'Read' : '', '--strict-mcp-config',
        '--no-session-persistence', '--permission-prompts', 'none', '--model', model, '--system-prompt-file', systemFile,
      ];
      if (image) args.push('--add-dir', tmpDir);
      return read(await start(file, args, text, signal), model);
    } finally {
      for (const p of temp) {
        try {
          fsImpl.rmSync(p, { force: true });
        } catch {
          // Left for the launch sweep.
        }
      }
    }
  }

  return { runPrompt };
}

module.exports = { createRun, claudeError, WORDS };
