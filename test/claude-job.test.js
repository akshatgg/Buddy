'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createJobs, lineFor, questionFor, ERRORS, MAX_JOB_MS, KILL_MS, ANSWER_MS, ASKS_PERMISSION } = require('../src/main/claude/job');
const { ENV_MARK } = require('../src/main/claude/find');

const PROJECT = { path: '/Users/me/code/my-app', name: 'my-app', found: true };
const RESULT = (fields = {}) => JSON.stringify({ type: 'result', subtype: 'success', is_error: false, result: 'I fixed it.', session_id: 's1', ...fields });
const TOOL = (name, input) => JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Let me look.' }, { type: 'tool_use', id: 't1', name, input }] } });
const tick = () => new Promise((resolve) => setImmediate(resolve));
// The shapes Claude Code 2.1.289 printed in the spike (tools/claude-permission-spike.js, Task 1).
const REQUEST = (id, name, input) => JSON.stringify({ type: 'control_request', request_id: id, request: { subtype: 'can_use_tool', tool_name: name, input } });
const RESPONSE = (id, response) => `${JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: id, response } })}\n`;

/** A fake child process: what the job writes to its stdin is kept in `written`; the test feeds its stdout. */
function fakeChild() {
  const child = new EventEmitter();
  child.pid = 4242;
  child.stdout = new PassThrough();
  child.stderr = new PassThrough();
  child.written = [];
  child.stdinEnded = false;
  child.stdin = { write: (text) => child.written.push(text), end: () => { child.stdinEnded = true; } };
  child.signals = [];
  child.kill = (signal) => child.signals.push(signal);
  child.say = (line) => child.stdout.write(`${line}\n`);
  child.exit = (code, signal = null) => child.emit('close', code, signal);
  return child;
}

function setup({ claudePath = '/opt/homebrew/bin/claude', env = { PATH: '/usr/bin', HOME: '/Users/me' } } = {}) {
  const spawned = [];
  const timers = [];
  const cancelled = [];
  const events = [];
  const jobs = createJobs({
    find: { find: () => claudePath, status: async () => ({ installed: Boolean(claudePath), loggedIn: true }) },
    projects: { found: () => [PROJECT], lastProject: () => null, setLastProject() {} },
    spawnImpl: (command, args, options) => {
      const child = fakeChild();
      spawned.push({ command, args, options, child });
      return child;
    },
    env,
    later: (fn, ms) => { const t = { fn, ms }; timers.push(t); return t; },
    cancelLater: (t) => cancelled.push(t),
  });
  const start = (fields = {}) => jobs.start({ project: PROJECT, task: 'Fix the login bug.', person: 'Akshat', model: 'sonnet', onEvent: (e) => events.push(e), ...fields });
  return { jobs, start, spawned, timers, cancelled, events, child: () => spawned.at(-1).child };
}

test('start runs claude in the project folder with the stream flags, the model, the name, and the mark in its environment', () => {
  const s = setup();
  s.start();
  const { command, args, options } = s.spawned[0];
  assert.strictEqual(command, '/opt/homebrew/bin/claude');
  assert.deepStrictEqual(args.slice(0, 7), ['-p', '--output-format', 'stream-json', '--input-format', 'stream-json', '--verbose', '--permission-mode']);
  assert.strictEqual(args[args.indexOf('--permission-mode') + 1], 'acceptEdits');
  assert.strictEqual(args[args.indexOf('--model') + 1], 'sonnet');
  assert.strictEqual(args[args.indexOf('--append-system-prompt') + 1],
    "The person's name is Akshat. When you are done, say in plain words, in at most five short lines, what you did and what is left.");
  assert.strictEqual(args[args.indexOf('--max-turns') + 1], '60');
  // Started through find.js's spawnClaude: the mark in its environment, and no console window on Windows.
  assert.deepStrictEqual(options, { cwd: '/Users/me/code/my-app', env: { PATH: '/usr/bin', HOME: '/Users/me', [ENV_MARK]: '1' }, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
});

test('an npm claude.cmd on Windows is started through cmd, every argument quoted on one line', () => {
  const s = setup({ claudePath: 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd' });
  s.start();
  const { command, args, options } = s.spawned[0];
  assert.deepStrictEqual(args, []);
  assert.strictEqual(options.shell, true);
  assert.ok(command.startsWith('"C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd" "-p" "--output-format" "stream-json"'), command);
  assert.ok(command.includes(`"The person's name is Akshat. When you are done, say in plain words, in at most five short lines, what you did and what is left."`));
  assert.ok(!command.includes('\n'));
});

test('the task is the first user message on stdin, and stdin stays open', () => {
  const s = setup();
  s.start();
  assert.deepStrictEqual(s.child().written, ['{"type":"user","message":{"role":"user","content":"Fix the login bug."}}\n']);
  assert.strictEqual(s.child().stdinEnded, false);
});

test('a model that is not one of the aliases, or none, becomes sonnet', () => {
  for (const model of [undefined, '', 'gpt-5', 'constructor']) {
    const s = setup();
    s.start({ model });
    assert.strictEqual(s.spawned[0].args[s.spawned[0].args.indexOf('--model') + 1], 'sonnet', String(model));
  }
  const s = setup();
  s.start({ model: 'opus' });
  assert.strictEqual(s.spawned[0].args[s.spawned[0].args.indexOf('--model') + 1], 'opus');
});

test('no claude command: start throws no_claude in its words, and nothing is spawned', () => {
  const s = setup({ claudePath: null });
  assert.throws(() => s.start(), { code: 'no_claude', message: ERRORS.no_claude });
  assert.strictEqual(s.spawned.length, 0);
});

test('each tool use in the stream becomes a live line; text and tool results are not shown', async () => {
  const s = setup();
  s.start();
  const c = s.child();
  c.say(JSON.stringify({ type: 'system', subtype: 'init', session_id: 's1' }));
  c.say(TOOL('Read', { file_path: '/Users/me/code/my-app/src/login.js' }));
  c.say(JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'const x = 1;' }] } }));
  c.say(TOOL('Bash', { command: 'npm test' }));
  c.say('not json at all');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'line', text: 'Reading src/login.js' }, { type: 'line', text: 'Running: npm test' }]);
});

test('a line split across two chunks of stdout is still read whole', async () => {
  const s = setup();
  s.start();
  const line = TOOL('Edit', { file_path: 'src/a.js' });
  s.child().stdout.write(line.slice(0, 20));
  await tick();
  s.child().stdout.write(`${line.slice(20)}\n`);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'line', text: 'Editing src/a.js' }]);
});

test('the result ends the job with its text once the process exits', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT({ result: '  I fixed login.js and the tests pass.\n' }));
  await tick();
  assert.deepStrictEqual(s.events, [], 'nothing until the process has exited');
  s.child().exit(0);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'done', text: 'I fixed login.js and the tests pass.' }]);
});

test('is_error, a non-zero exit, no result, or an empty result fail the job in plain words', async () => {
  const cases = [
    ['is_error', (c) => { c.say(RESULT({ is_error: true, subtype: 'error_during_execution', result: 'boom' })); c.exit(0); }],
    ['non-zero exit', (c) => { c.say(RESULT()); c.exit(1); }],
    ['no result', (c) => c.exit(0)],
    ['empty result', (c) => { c.say(RESULT({ result: '   ' })); c.exit(0); }],
    ['bad JSON result', (c) => { c.say('{"type":"result", oops'); c.exit(0); }],
  ];
  for (const [what, play] of cases) {
    const s = setup();
    s.start();
    play(s.child());
    await tick();
    assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'claude_failed', message: "Claude Code couldn't finish in my-app." }], what);
  }
});

test('the limit words fail the job as claude_limit, and an authentication error as claude_signed_out', async () => {
  for (const [text, code] of [
    ['You have reached your usage limit. Try again at 3pm.', 'claude_limit'],
    ['rate_limit: too many requests', 'claude_limit'],
    ['limit reached', 'claude_limit'],
    ['Not logged in. Please run /login.', 'claude_signed_out'],
    ['authentication_error: invalid token', 'claude_signed_out'],
  ]) {
    const s = setup();
    s.start();
    s.child().say(RESULT({ is_error: true, subtype: 'error_during_execution', result: text }));
    s.child().exit(1);
    await tick();
    assert.deepStrictEqual(s.events, [{ type: 'failed', code, message: ERRORS[code] }], text);
  }
});

test('a process that cannot start fails the job once', async () => {
  const s = setup();
  s.start();
  s.child().emit('error', Object.assign(new Error('spawn ENOENT'), { code: 'ENOENT' }));
  s.child().exit(-2);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'claude_failed', message: "Claude Code couldn't finish in my-app." }]);
});

test('stop sends SIGTERM, then SIGKILL 3 s later, and the job ends as stopped whatever the stream said', async () => {
  const s = setup();
  const job = s.start();
  job.stop();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM']);
  assert.strictEqual(s.child().stdinEnded, true);
  const kill = s.timers.find((t) => t.ms === KILL_MS);
  kill.fn();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM', 'SIGKILL']);
  s.child().say(RESULT());
  s.child().exit(null, 'SIGKILL');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'stopped' }]);
});

test('a process that exits on SIGTERM does not get the SIGKILL', async () => {
  const s = setup();
  const job = s.start();
  job.stop();
  s.child().exit(null, 'SIGTERM');
  await tick();
  const kill = s.timers.find((t) => t.ms === KILL_MS);
  assert.ok(s.cancelled.includes(kill));
  assert.deepStrictEqual(s.events, [{ type: 'stopped' }]);
});

test('after 30 minutes the job is stopped and fails with "too long"', async () => {
  const s = setup();
  s.start();
  const end = s.timers.find((t) => t.ms === MAX_JOB_MS);
  end.fn();
  assert.deepStrictEqual(s.child().signals, ['SIGTERM']);
  s.child().exit(null, 'SIGTERM');
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'failed', code: 'too_long', message: ERRORS.too_long }]);
});

test('the 30-minute timer is cancelled when the job ends by itself', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  assert.ok(s.cancelled.includes(s.timers.find((t) => t.ms === MAX_JOB_MS)));
});

test('nothing is reported after the end: a late line is dropped', async () => {
  const s = setup();
  s.start();
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  s.child().say(TOOL('Read', { file_path: 'x' }));
  s.child().exit(0);
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'done', text: 'I fixed it.' }]);
});

test('the live line for each tool', () => {
  const at = '/Users/me/code/my-app';
  assert.strictEqual(lineFor('Read', { file_path: `${at}/src/login.js` }, at), 'Reading src/login.js');
  assert.strictEqual(lineFor('Edit', { file_path: 'src/login.js' }, at), 'Editing src/login.js'); // a relative path, as it is
  assert.strictEqual(lineFor('Write', { file_path: `${at}/src/new.js` }, at), 'Writing src/new.js');
  assert.strictEqual(lineFor('Read', { file_path: '/etc/hosts' }, at), 'Reading /etc/hosts');
  assert.strictEqual(lineFor('Glob', { pattern: '**/*.js' }, at), 'Looking for "**/*.js"');
  assert.strictEqual(lineFor('Grep', { pattern: 'login' }, at), 'Looking for "login"');
  assert.strictEqual(lineFor('Bash', { command: 'npm test' }, at), 'Running: npm test');
  assert.strictEqual(lineFor('Bash', { command: `echo ${'x'.repeat(100)}` }, at), `Running: echo ${'x'.repeat(74)}…`); // the command cut to 80 characters, "…" included
  assert.strictEqual(lineFor('Bash', { command: 'git status\n&& git diff' }, at), 'Running: git status && git diff');
  assert.strictEqual(lineFor('WebFetch', { url: 'https://x.y' }, at), 'Searching the web');
  assert.strictEqual(lineFor('WebSearch', { query: 'x' }, at), 'Searching the web');
  assert.strictEqual(lineFor('TodoWrite', {}, at), 'Working…');
  assert.strictEqual(lineFor('Read', {}, at), 'Working…');
  assert.strictEqual(lineFor('Read', { file_path: 42 }, at), 'Working…');
});

test('the question for a permission request', () => {
  assert.strictEqual(questionFor('Bash', { command: 'npm test' }), 'Run npm test?');
  assert.strictEqual(questionFor('Bash', { command: `x ${'y'.repeat(100)}` }), `Run x ${'y'.repeat(77)}…?`);
  assert.strictEqual(questionFor('WebFetch', { url: 'https://x.y' }), 'Use WebFetch?');
  assert.strictEqual(questionFor('Bash', {}), 'Use Bash?');
});

test('the words of every error', () => {
  assert.strictEqual(ERRORS.no_claude, "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings.");
  assert.strictEqual(ERRORS.claude_signed_out, "Claude Code isn't signed in. Open a terminal, run claude, and sign in.");
  assert.strictEqual(ERRORS.claude_limit, 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
  assert.strictEqual(ERRORS.claude_failed('site'), "Claude Code couldn't finish in site.");
  assert.strictEqual(ERRORS.too_long, 'That took too long, so I stopped it.');
});

test('projects, the last pick and the status come through from the modules behind them', async () => {
  const s = setup();
  assert.deepStrictEqual(s.jobs.projects(), [PROJECT]);
  assert.strictEqual(s.jobs.lastProject(), null);
  assert.deepStrictEqual(await s.jobs.status(), { installed: true, loggedIn: true });
});

test('the job asks the person before a command, with --permission-prompts host', async () => {
  const s = setup();
  s.start();
  const { args } = s.spawned[0];
  assert.strictEqual(args[args.indexOf('--permission-prompts') + 1], 'host');
  // 2.1.289 sends the question to the host only with this too (the spike: without it, it denies on its own).
  assert.strictEqual(args[args.indexOf('--permission-prompt-tool') + 1], 'stdio');
  assert.ok(!args.includes('--allowedTools'));
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  await tick();
  assert.deepStrictEqual(s.events, [{ type: 'ask', requestId: 'r1', text: 'Run npm test?', what: 'npm test' }]);
});

test('Allow and No go back on stdin as the control response; a second answer to the same request is refused', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  s.child().say(REQUEST('r2', 'WebFetch', { url: 'https://x.y' }));
  await tick();
  assert.strictEqual(job.answer('r1', true), true);
  assert.strictEqual(job.answer('r2', false), true);
  assert.deepStrictEqual(s.child().written.slice(1), [
    RESPONSE('r1', { behavior: 'allow' }),
    RESPONSE('r2', { behavior: 'deny', message: 'The person said no.' }),
  ]);
  assert.strictEqual(job.answer('r1', true), false);
  assert.strictEqual(job.answer('nope', true), false);
  assert.strictEqual(s.child().written.length, 3);
});

test('a question left open for 10 minutes is denied by the job itself, and the chat hears that', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'rm -rf build' }));
  await tick();
  const wait = s.timers.find((t) => t.ms === ANSWER_MS);
  wait.fn();
  assert.deepStrictEqual(s.child().written.at(-1), RESPONSE('r1', { behavior: 'deny', message: 'The person said no.' }));
  assert.deepStrictEqual(s.events.at(-1), { type: 'expired', requestId: 'r1' });
  assert.strictEqual(job.answer('r1', true), false, 'answered already');
});

test('an answer in time cancels the 10-minute deny, and the end cancels the ones still waiting', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  s.child().say(REQUEST('r2', 'Bash', { command: 'npm run build' }));
  await tick();
  const [first, second] = s.timers.filter((t) => t.ms === ANSWER_MS);
  job.answer('r1', true);
  assert.ok(s.cancelled.includes(first));
  s.child().say(RESULT());
  s.child().exit(0);
  await tick();
  assert.ok(s.cancelled.includes(second));
});

test('a control request of another kind, or without an id, is left alone', async () => {
  const s = setup();
  s.start();
  s.child().say(JSON.stringify({ type: 'control_request', request_id: 'r9', request: { subtype: 'initialize' } }));
  s.child().say(JSON.stringify({ type: 'control_request', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: {} } }));
  await tick();
  assert.deepStrictEqual(s.events, []);
});

test('the job says it asks permission', () => {
  assert.strictEqual(ASKS_PERMISSION, true);
});

test('after Stop, or after the end, an answer is refused and nothing more is written to the closed stdin', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('r1', 'Bash', { command: 'npm test' }));
  await tick();
  job.stop();
  assert.strictEqual(job.answer('r1', true), false);
  assert.strictEqual(s.child().written.length, 1);
  s.child().exit(null, 'SIGTERM');
  await tick();
  assert.strictEqual(job.answer('r1', true), false);
  assert.strictEqual(s.child().written.length, 1);
});

test('nobody signed in with a name: the system prompt leaves the name out, and a name is one line', () => {
  const s = setup();
  s.start({ person: '' });
  const { args } = s.spawned[0];
  assert.strictEqual(args[args.indexOf('--append-system-prompt') + 1], 'When you are done, say in plain words, in at most five short lines, what you did and what is left.');
  const odd = setup();
  odd.start({ person: ' Ak\nshat ' });
  assert.ok(odd.spawned[0].args[odd.spawned[0].args.indexOf('--append-system-prompt') + 1].startsWith("The person's name is Ak shat. When"));
});

test('stopAll (Buddy quits) sends SIGTERM to every job still running, and nothing to one that has ended', async () => {
  const s = setup();
  s.start();
  const ended = s.child();
  s.start();
  const running = s.child();
  ended.say(RESULT());
  await tick();
  ended.exit(0);
  s.jobs.stopAll();
  assert.deepStrictEqual(running.signals, ['SIGTERM']);
  assert.strictEqual(running.stdinEnded, true);
  assert.deepStrictEqual(ended.signals, []);
  running.exit(null, 'SIGTERM');
  s.jobs.stopAll();
  assert.deepStrictEqual(running.signals, ['SIGTERM'], 'gone: not told again');
});

test('AskUserQuestion is denied at once, with words that tell Claude Code to choose, and the person is not asked', async () => {
  const s = setup();
  const job = s.start();
  s.child().say(REQUEST('q1', 'AskUserQuestion', { questions: [{ question: 'Which style?', options: [] }] }));
  await tick();
  assert.deepStrictEqual(s.events, [], 'no question in the chat');
  assert.deepStrictEqual(s.child().written.slice(1), [
    RESPONSE('q1', { behavior: 'deny', message: "Buddy can't ask the person here. Make a sensible choice and say what you chose in your summary." }),
  ]);
  assert.ok(!s.timers.some((t) => t.ms === ANSWER_MS), 'nothing left waiting');
  assert.strictEqual(job.answer('q1', true), false, 'not open');
});
