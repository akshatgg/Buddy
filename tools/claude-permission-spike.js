'use strict';

/**
 * Proves, on this Mac's Claude Code, whether Buddy can answer Claude Code's permission questions over stdin: starts
 * `claude -p` with stream-json in and out and `--permission-prompts host` in an empty temporary folder, asks it to run
 * one harmless shell command (node printing a number), prints every line that goes in or out, and answers the first `control_request`
 * (`can_use_tool`) with an allow. What to look for is in docs/superpowers/plans/2026-10-08-buddy-claude-code-drive.md,
 * Task 1. It uses a few turns of the signed-in plan. Claude Code is started the way the app starts it (spawnClaude).
 *
 *   node tools/claude-permission-spike.js            # answers the request with the nested shape (the default)
 *   node tools/claude-permission-spike.js --flat     # answers with the flat shape, if the nested one is ignored
 *   node tools/claude-permission-spike.js --max-turns # also passes --max-turns 60, to see whether 2.1.289 takes it
 *   node tools/claude-permission-spike.js --stdio-tool # also passes --permission-prompt-tool stdio (the Agent SDK's way
 *                                                      # to have the questions sent to the host over stdout)
 *   node tools/claude-permission-spike.js --stdio-tool --deny # answers No ("The person said no.") instead of allow
 */

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const readline = require('node:readline');
const { createFind, spawnClaude } = require('../src/main/claude/find');

// Not `echo`: Claude Code runs read-only commands like echo without asking, so the command must be one it asks about.
const TASK = 'Run the shell command `node -e "console.log(40 + 2)"` with the Bash tool and tell me exactly what it printed. Do nothing else.';
const GIVE_UP_MS = 120_000;
const flat = process.argv.includes('--flat');
const withTurns = process.argv.includes('--max-turns');
const stdioTool = process.argv.includes('--stdio-tool');
const deny = process.argv.includes('--deny');

const claude = createFind().find();
if (!claude) {
  console.log('[spike] no claude command on this computer');
  process.exit(1);
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-spike-'));
const args = [
  '-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose',
  '--permission-mode', 'acceptEdits', '--permission-prompts', 'host', '--model', 'sonnet',
  ...(withTurns ? ['--max-turns', '60'] : []),
  ...(stdioTool ? ['--permission-prompt-tool', 'stdio'] : []),
];
console.log(`[spike] cwd ${dir}`);
console.log(`[spike] ${claude} ${args.join(' ')}`);
const child = spawnClaude(spawn, claude, args, { cwd: dir, env: process.env, stdio: ['pipe', 'pipe', 'pipe'] });

function send(object) {
  const line = `${JSON.stringify(object)}\n`;
  process.stdout.write(`>> ${line}`);
  child.stdin.write(line);
}

let answered = false;
readline.createInterface({ input: child.stdout }).on('line', (line) => {
  console.log(`<< ${line}`);
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return; // not JSON: shown above, nothing to answer
  }
  if (message.type === 'control_request' && message.request?.subtype === 'can_use_tool' && !answered) {
    answered = true;
    const id = message.request_id;
    const response = deny ? { behavior: 'deny', message: 'The person said no.' } : { behavior: 'allow' };
    send(flat
      ? { type: 'control_response', request_id: id, subtype: 'success', response }
      : { type: 'control_response', response: { subtype: 'success', request_id: id, response } });
  }
  if (message.type === 'result') {
    console.log(`[spike] result: is_error=${message.is_error} subtype=${message.subtype}`);
    child.stdin.end();
  }
});
readline.createInterface({ input: child.stderr }).on('line', (line) => console.log(`!! ${line}`));
child.on('close', (code, signal) => {
  console.log(`[spike] exited: code=${code} signal=${signal} answered=${answered}`);
  fs.rmSync(dir, { recursive: true, force: true });
});
child.on('error', (err) => console.log(`[spike] could not start claude: ${err.code}`));

send({ type: 'user', message: { role: 'user', content: TASK } });
setTimeout(() => {
  console.log('[spike] giving up after 120 s: SIGTERM');
  child.kill('SIGTERM');
}, GIVE_UP_MS).unref();
