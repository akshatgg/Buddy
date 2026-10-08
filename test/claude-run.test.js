'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { createRun, claudeError, WORDS } = require('../src/main/claude/run');
const { ENV_MARK } = require('../src/main/claude/find');

const DATA = '/Users/someone/Library/Application Support/Buddy';
const TMP = path.join(DATA, 'claude-tmp');
const SYSTEM_FILE = path.join(TMP, 'abc123.txt');
const IMAGE_FILE = path.join(TMP, 'abc123.jpg');
const CLAUDE = '/opt/homebrew/bin/claude';
const found = { find: () => CLAUDE };
const missing = { find: () => null };
const PROMPT = { system: 'You are Buddy.\nAnswer in JSON.', user: 'boss ko mail', model: 'sonnet' };
/** What claude prints for `result`, as one JSON object; `extra` overrides fields (is_error, subtype). */
const reply = (result, extra = {}) => JSON.stringify({
  type: 'result', subtype: 'success', is_error: false, result, session_id: 's1', stop_reason: 'end_turn',
  usage: { input_tokens: 500, output_tokens: 40 }, ...extra,
});
const REPLY_OK = reply('Dear Sir, I need leave tomorrow.');

/**
 * A fake `spawn`: one child per call, which takes the stdin text, then answers with `answer` ({ out, err, code }), or
 * hangs with 'hang'. `calls` gets { file, args, options, input, killed } for each.
 */
function fakeSpawn(answer, calls = []) {
  return (file, args, options) => {
    const child = new EventEmitter();
    child.stdin = new PassThrough();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    const call = { file, args, options, input: '', killed: false };
    calls.push(call);
    child.kill = () => {
      call.killed = true;
      setImmediate(() => child.emit('close', null));
    };
    child.stdin.on('data', (chunk) => { call.input += chunk; });
    child.stdin.on('end', () => {
      if (answer === 'hang') return;
      setImmediate(() => {
        if (answer.out) child.stdout.write(answer.out);
        if (answer.err) child.stderr.write(answer.err);
        child.stdout.end();
        child.stderr.end();
        child.emit('close', answer.code ?? 0);
      });
    });
    return child;
  };
}

/** A fake file system that remembers what was written (path -> { data, mode }) and every call. */
function fakeFs() {
  const files = new Map();
  const log = [];
  return {
    files,
    log,
    rmSync(p, options) {
      log.push(['rm', p, options]);
      for (const name of [...files.keys()]) if (name === p || name.startsWith(`${p}${path.sep}`)) files.delete(name);
    },
    mkdirSync: (p, options) => log.push(['mkdir', p, options]),
    writeFileSync(p, data, options) {
      files.set(p, { data, mode: options?.mode });
      log.push(['write', p, String(data), options?.mode]);
    },
  };
}

function setup({ find = found, answer = { out: REPLY_OK }, fs = fakeFs(), timeoutMs = 60_000 } = {}) {
  const calls = [];
  const run = createRun({
    find, dataDir: DATA, spawnImpl: fakeSpawn(answer, calls), env: { PATH: '/usr/bin', HOME: '/Users/someone' }, fsImpl: fs,
    timeoutMs, newName: () => 'abc123',
  });
  return { run, calls, fs };
}

test('the words of each failure, in plain English', () => {
  assert.deepStrictEqual(Object.keys(WORDS), ['no_claude', 'claude_signed_out', 'claude_limit', 'claude_failed', 'timeout']);
  const err = claudeError('claude_limit');
  assert.strictEqual(err.code, 'claude_limit');
  assert.strictEqual(err.message, 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
});

test('runPrompt: the command, its arguments, the environment mark, the data folder as cwd, and the user text on stdin', async () => {
  const { run, calls } = setup();
  const out = await run.runPrompt(PROMPT);
  assert.deepStrictEqual(out, { text: 'Dear Sir, I need leave tomorrow.', model: 'sonnet', usage: { inputTokens: 500, outputTokens: 40 } });
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].file, CLAUDE);
  assert.deepStrictEqual(calls[0].args, [
    '-p', '--output-format', 'json', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
    '--permission-prompts', 'none', '--model', 'sonnet', '--system-prompt-file', SYSTEM_FILE,
  ]);
  assert.ok(calls[0].args.every((a) => !a.includes('\n')), 'every argument stays on one line');
  assert.strictEqual(calls[0].input, 'boss ko mail');
  assert.strictEqual(calls[0].options.cwd, DATA);
  assert.strictEqual(calls[0].options.env[ENV_MARK], '1');
  assert.strictEqual(calls[0].options.env.PATH, '/usr/bin', 'the rest of the environment comes along');
  assert.strictEqual(calls[0].options.windowsHide, true);
});

test('runPrompt: the system prompt goes in a file of its own (0600), deleted when the run ends', async () => {
  const fs = fakeFs();
  const { run } = setup({ fs });
  await run.runPrompt(PROMPT);
  assert.ok(fs.log.some(([op, p, options]) => op === 'mkdir' && p === TMP && options.recursive === true && options.mode === 0o700));
  assert.deepStrictEqual(fs.log.find(([op]) => op === 'write'), ['write', SYSTEM_FILE, PROMPT.system, 0o600]);
  assert.ok(fs.log.some(([op, p]) => op === 'rm' && p === SYSTEM_FILE), 'the file is deleted when the run ends');
  assert.strictEqual(fs.files.size, 0);
});

test('runPrompt: the system prompt file is deleted when the run fails too', async () => {
  for (const answer of [{ out: 'nope', code: 1 }, 'hang']) {
    const fs = fakeFs();
    const { run } = setup({ fs, answer, timeoutMs: 10 });
    await assert.rejects(run.runPrompt(PROMPT));
    assert.ok(fs.log.some(([op, p, , mode]) => op === 'write' && p === SYSTEM_FILE && mode === 0o600));
    assert.strictEqual(fs.files.size, 0, 'nothing is left behind');
  }
});

test('runPrompt: an npm claude.cmd on Windows is started through cmd, with every argument quoted (find.js spawnClaude)', async () => {
  const calls = [];
  const cmd = 'C:\\Users\\Some One\\AppData\\Roaming\\npm\\claude.cmd';
  const run = createRun({
    find: { find: () => cmd }, dataDir: DATA, spawnImpl: fakeSpawn({ out: REPLY_OK }, calls), env: {}, fsImpl: fakeFs(),
    newName: () => 'abc123',
  });
  await run.runPrompt(PROMPT);
  assert.strictEqual(calls[0].options.shell, true);
  assert.deepStrictEqual(calls[0].args, []);
  assert.ok(calls[0].file.startsWith(`"${cmd}" "-p" `), calls[0].file);
  assert.ok(calls[0].file.includes(`"--tools" "" `));
  assert.ok(calls[0].file.endsWith(`"--system-prompt-file" "${SYSTEM_FILE}"`));
  assert.strictEqual(calls[0].options.env[ENV_MARK], '1');
  assert.strictEqual(calls[0].options.windowsHide, true);
});

test('runPrompt: the command not found is no_claude, and nothing is started', async () => {
  const { run, calls, fs } = setup({ find: missing });
  await assert.rejects(run.runPrompt(PROMPT), { code: 'no_claude', message: WORDS.no_claude });
  assert.strictEqual(calls.length, 0);
  assert.deepStrictEqual(fs.log.slice(1), [], 'no file is written either');
});

test('runPrompt: is_error, an empty result, no JSON, a non-zero exit and a start that fails are claude_failed', async () => {
  const cases = [
    ['is_error', { out: reply('boom', { is_error: true, subtype: 'error' }) }],
    ['empty result', { out: reply('   ') }],
    ['no JSON', { out: 'Segmentation fault' }],
    ['non-zero exit', { out: REPLY_OK, code: 2 }],
    ['nothing at all', { out: '', code: 1 }],
  ];
  for (const [what, said] of cases) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_failed', message: WORDS.claude_failed }, what);
  }
  const fs = fakeFs();
  const cannotStart = createRun({ find: found, dataDir: DATA, fsImpl: fs, spawnImpl: () => { throw new Error('ENOENT'); } });
  await assert.rejects(cannotStart.runPrompt(PROMPT), { code: 'claude_failed' });
  assert.strictEqual(fs.files.size, 0, 'the system prompt file is deleted');
  const cannotWrite = createRun({ find: found, dataDir: DATA, fsImpl: { ...fakeFs(), writeFileSync() { throw new Error('ENOSPC'); } }, spawnImpl: fakeSpawn({ out: REPLY_OK }) });
  await assert.rejects(cannotWrite.runPrompt(PROMPT), { code: 'claude_failed' });
});

test('runPrompt: the limit words in the result or on stderr are claude_limit, before any other reading', async () => {
  for (const said of [
    { out: reply('Usage limit reached. Try again at 5pm.', { is_error: true }), code: 1 },
    { out: reply("You've hit your rate_limit for this session", { is_error: true }) },
    { out: '', err: 'Error: usage limit reached\n', code: 1 },
    { out: reply('Not logged in, and your usage limit is reached', { is_error: true }), code: 1 },
  ]) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_limit', message: WORDS.claude_limit });
  }
});

test('runPrompt: a run that fails for want of signing in is claude_signed_out', async () => {
  for (const said of [
    { out: reply('Not logged in · Please run /login', { is_error: true }), code: 1 },
    { out: '', err: 'Error: authentication_error: invalid API key\n', code: 1 },
    { out: '', err: 'Unauthorized\n', code: 1 },
  ]) {
    const { run } = setup({ answer: said });
    await assert.rejects(run.runPrompt(PROMPT), { code: 'claude_signed_out', message: WORDS.claude_signed_out });
  }
});

test('runPrompt: a run that takes too long is killed and is a timeout', async () => {
  const { run, calls } = setup({ answer: 'hang', timeoutMs: 10 });
  await assert.rejects(run.runPrompt(PROMPT), { code: 'timeout', message: WORDS.timeout });
  assert.strictEqual(calls[0].killed, true);
});

test('runPrompt: the signal kills the run: a deadline is a timeout, a cancel is passed through as it is', async () => {
  const timed = setup({ answer: 'hang' });
  await assert.rejects(timed.run.runPrompt({ ...PROMPT, signal: AbortSignal.timeout(10) }), { code: 'timeout' });
  assert.strictEqual(timed.calls[0].killed, true);

  const cancelled = setup({ answer: 'hang' });
  const controller = new AbortController();
  const pending = cancelled.run.runPrompt({ ...PROMPT, signal: controller.signal });
  setTimeout(() => controller.abort(), 5);
  await assert.rejects(pending, (err) => err.name === 'AbortError');
  assert.strictEqual(cancelled.calls[0].killed, true);
  assert.strictEqual(cancelled.fs.files.size, 0, 'the system prompt file is deleted');

  const already = setup({ answer: 'hang' });
  const done = new AbortController();
  done.abort();
  await assert.rejects(already.run.runPrompt({ ...PROMPT, signal: done.signal }), (err) => err.name === 'AbortError');
  assert.strictEqual(already.calls.length, 0, 'nothing is started for a request already abandoned');
  assert.strictEqual(already.fs.files.size, 0);
});

test('runPrompt: a screenshot goes as a file of its own (0600), Read is the one tool, and the text says where it is', async () => {
  const fs = fakeFs();
  const { run, calls } = setup({ fs });
  const image = Buffer.from('jpeg bytes').toString('base64');
  await run.runPrompt({ ...PROMPT, image });
  const args = calls[0].args;
  assert.deepStrictEqual(args.slice(args.indexOf('--tools'), args.indexOf('--tools') + 2), ['--tools', 'Read']);
  assert.deepStrictEqual(args.slice(-2), ['--add-dir', TMP]);
  assert.strictEqual(calls[0].input, `boss ko mail\n\nThe screenshot is the image file at ${IMAGE_FILE}. Read it first.`);
  assert.ok(fs.log.some(([op, p, options]) => op === 'mkdir' && p === TMP && options.recursive === true && options.mode === 0o700));
  assert.deepStrictEqual(fs.log.find(([op, p]) => op === 'write' && p === IMAGE_FILE), ['write', IMAGE_FILE, 'jpeg bytes', 0o600]);
  assert.ok(fs.log.some(([op, p]) => op === 'rm' && p === IMAGE_FILE), 'the file is deleted when the run ends');
  assert.strictEqual(fs.files.size, 0);
});

test('runPrompt: the screenshot file is written with mode 0600 and deleted when the run fails too', async () => {
  const fs = fakeFs();
  const { run } = setup({ fs, answer: { out: 'nope', code: 1 } });
  await assert.rejects(run.runPrompt({ ...PROMPT, image: 'aGk=' }), { code: 'claude_failed' });
  assert.ok(fs.log.some(([op, p, , mode]) => op === 'write' && p === IMAGE_FILE && mode === 0o600));
  assert.strictEqual(fs.files.size, 0, 'nothing is left behind');
});

test('createRun empties the screenshot folder at launch, and does not mind it not being there', () => {
  const fs = fakeFs();
  fs.files.set(path.join(TMP, 'old.jpg'), { data: 'x' });
  setup({ fs });
  assert.deepStrictEqual(fs.log[0], ['rm', TMP, { recursive: true, force: true }]);
  assert.strictEqual(fs.files.size, 0);
  const failing = { ...fakeFs(), rmSync() { throw new Error('EPERM'); } };
  assert.doesNotThrow(() => setup({ fs: failing }));
});

test('runPrompt: without a screenshot, the system prompt file is the only file touched', async () => {
  const fs = fakeFs();
  const { run } = setup({ fs });
  await run.runPrompt(PROMPT);
  assert.deepStrictEqual(fs.log.slice(1).map(([op, p]) => [op, p]), [['mkdir', TMP], ['write', SYSTEM_FILE], ['rm', SYSTEM_FILE]]);
});
