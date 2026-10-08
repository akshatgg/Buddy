'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const {
  createFind, spawnClaude, PROVIDER_ID, ENV_MARK, MODELS, DEFAULT_MODEL, GET_URL,
} = require('../src/main/claude/find');

const HOME = '/Users/someone';
const MAC = { platform: 'darwin', home: HOME, env: { PATH: '/usr/bin:/bin' } };

/** A fake `spawn`: answers each command (by its last argument) with stdout text and an exit code, or hangs. */
function fakeSpawn(answers, calls = []) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => { child.killed = true; child.emit('exit', null, 'SIGTERM'); child.emit('close', null, 'SIGTERM'); };
    const answer = answers[args[args.length - 1]];
    if (answer !== 'hang') {
      setImmediate(() => {
        if (answer?.out) child.stdout.write(answer.out);
        child.stdout.end();
        child.emit('exit', answer?.code ?? 0);
        child.emit('close', answer?.code ?? 0);
      });
    }
    return child;
  };
}

const SIGNED_IN = JSON.stringify({ loggedIn: true, email: 'a@b.com', subscriptionType: 'max', configDirectory: `${HOME}/.claude` });

test('the constants the other pieces share', () => {
  assert.equal(PROVIDER_ID, 'claude-code');
  assert.equal(ENV_MARK, 'BUDDY_CLAUDE_CODE');
  assert.deepEqual(MODELS, ['fable', 'opus', 'sonnet', 'haiku']);
  assert.ok(MODELS.includes(DEFAULT_MODEL));
  assert.match(GET_URL, /^https:\/\//);
});

test('find: the first claude on PATH, then the usual folders on the Mac', () => {
  const seen = [];
  const found = createFind({ ...MAC, existsSync: (p) => { seen.push(p); return p === '/opt/homebrew/bin/claude'; } });
  assert.equal(found.find(), '/opt/homebrew/bin/claude');
  assert.deepEqual(seen.slice(0, 3), ['/usr/bin/claude', '/bin/claude', '/opt/homebrew/bin/claude']);
  const home = createFind({ ...MAC, existsSync: (p) => p === `${HOME}/.claude/local/claude` });
  assert.equal(home.find(), `${HOME}/.claude/local/claude`);
  const none = createFind({ ...MAC, existsSync: () => false });
  assert.equal(none.find(), null);
});

test('find: PATH comes first, so a person\'s own claude wins', () => {
  const f = createFind({ ...MAC, env: { PATH: '/me/bin' }, existsSync: (p) => p === '/me/bin/claude' || p === '/usr/local/bin/claude' });
  assert.equal(f.find(), '/me/bin/claude');
});

test('find: on Windows, claude.exe and claude.cmd in PATH and the install folders', () => {
  const env = { Path: 'C:\\tools', LOCALAPPDATA: 'C:\\Users\\me\\AppData\\Local', APPDATA: 'C:\\Users\\me\\AppData\\Roaming' };
  const seen = [];
  const f = createFind({ platform: 'win32', home: 'C:\\Users\\me', env, existsSync: (p) => { seen.push(p); return p.endsWith('npm\\claude.cmd'); } });
  assert.equal(f.find(), 'C:\\Users\\me\\AppData\\Roaming\\npm\\claude.cmd');
  assert.ok(seen.includes('C:\\tools\\claude.exe'));
  assert.ok(seen.includes('C:\\Users\\me\\AppData\\Local\\Programs\\Claude Code\\claude.exe'));
});

test('find: on Windows, the native installer\'s folder in the home folder (.local\\bin\\claude.exe)', () => {
  const f = createFind({ platform: 'win32', home: 'C:\\Users\\me', env: { Path: 'C:\\tools' }, existsSync: (p) => p === 'C:\\Users\\me\\.local\\bin\\claude.exe' });
  assert.equal(f.find(), 'C:\\Users\\me\\.local\\bin\\claude.exe');
});

test('find: on Windows, claude.exe anywhere wins over an npm claude.cmd earlier on PATH', () => {
  const env = { Path: 'C:\\npm', LOCALAPPDATA: 'C:\\L' };
  const f = createFind({ platform: 'win32', home: 'C:\\me', env, existsSync: (p) => p === 'C:\\npm\\claude.cmd' || p === 'C:\\L\\Programs\\Claude Code\\claude.exe' });
  assert.equal(f.find(), 'C:\\L\\Programs\\Claude Code\\claude.exe');
});

test('spawnClaude: marks the process, hides the window, and runs an npm shim through cmd with quoted arguments', () => {
  const calls = [];
  const fake = (file, args, options) => { calls.push({ file, args, options }); return {}; };
  spawnClaude(fake, '/bin/claude', ['-p', '--model', 'sonnet'], { env: { A: '1' }, cwd: '/tmp' });
  assert.deepEqual(calls[0].args, ['-p', '--model', 'sonnet']);
  assert.equal(calls[0].file, '/bin/claude');
  assert.deepEqual(calls[0].options.env, { A: '1', [ENV_MARK]: '1' });
  assert.equal(calls[0].options.windowsHide, true);
  assert.equal(calls[0].options.cwd, '/tmp');
  assert.equal(calls[0].options.shell, undefined);
  spawnClaude(fake, 'C:\\npm\\claude.CMD', ['--add-dir', 'C:\\Users\\A B\\x', 'say "hi" 100%'], { env: {} });
  assert.equal(calls[1].file, '"C:\\npm\\claude.CMD" "--add-dir" "C:\\Users\\A B\\x" "say ""hi"" 100"%""');
  assert.deepEqual(calls[1].args, []);
  assert.equal(calls[1].options.shell, true);
});

test('status: signed in, with the email, the plan, the version and the config folder', async () => {
  const calls = [];
  const f = createFind({
    ...MAC,
    existsSync: (p) => p === '/opt/homebrew/bin/claude',
    spawnImpl: fakeSpawn({ status: { out: SIGNED_IN }, '--version': { out: '2.1.289 (Claude Code)\n' } }, calls),
  });
  const s = await f.status();
  assert.deepEqual(s, {
    installed: true, loggedIn: true, email: 'a@b.com', plan: 'max', version: '2.1.289',
    path: '/opt/homebrew/bin/claude', configDirectory: `${HOME}/.claude`,
  });
  // Buddy's own runs are marked, so the watch piece's hooks ignore them; and no console window on Windows.
  for (const call of calls) {
    assert.equal(call.file, '/opt/homebrew/bin/claude');
    assert.equal(call.options.env[ENV_MARK], '1');
    assert.equal(call.options.windowsHide, true);
  }
  assert.deepEqual(calls.map((c) => c.args), [['auth', 'status'], ['--version']]);
});

test('status: not signed in (exit code 1 with JSON), and a command that answers nonsense', async () => {
  const out = JSON.stringify({ loggedIn: false });
  const f = createFind({ ...MAC, existsSync: () => true, spawnImpl: fakeSpawn({ status: { out, code: 1 }, '--version': { out: '2.1.289' } }) });
  const s = await f.status();
  assert.equal(s.installed, true);
  assert.equal(s.loggedIn, false);
  assert.equal(s.email, null);
  const odd = createFind({ ...MAC, existsSync: () => true, spawnImpl: fakeSpawn({ status: { out: 'boom', code: 1 }, '--version': { out: '' } }) });
  const o = await odd.status();
  assert.equal(o.installed, true);
  assert.equal(o.loggedIn, false);
  assert.equal(o.version, null);
});

test('status: not installed asks nothing', async () => {
  const calls = [];
  const f = createFind({ ...MAC, existsSync: () => false, spawnImpl: fakeSpawn({}, calls) });
  assert.deepEqual(await f.status(), {
    installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null,
  });
  assert.equal(calls.length, 0);
});

test('status: the answer is read once the output is closed, not at exit (stdout may still be open then)', async () => {
  const late = (file, args) => {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => {};
    const out = args[args.length - 1] === 'status' ? SIGNED_IN : '2.1.289';
    setImmediate(() => {
      child.emit('exit', 0); // the process is gone, its output not read yet
      setImmediate(() => {
        child.stdout.end(out);
        child.stdout.on('end', () => setImmediate(() => child.emit('close', 0)));
      });
    });
    return child;
  };
  const f = createFind({ ...MAC, existsSync: () => true, spawnImpl: late });
  const s = await f.status();
  assert.equal(s.loggedIn, true);
  assert.equal(s.version, '2.1.289');
});

test('status: a command that hangs is killed after the timeout and counts as not signed in', async () => {
  const f = createFind({ ...MAC, existsSync: () => true, spawnImpl: fakeSpawn({ status: 'hang', '--version': { out: '1' } }), statusTimeoutMs: 5 });
  const s = await f.status();
  assert.equal(s.installed, true);
  assert.equal(s.loggedIn, false);
});

test('status: the answer is kept for a minute, shared while it is on its way, and asked again with force', async () => {
  const calls = [];
  let t = 1000;
  const f = createFind({ ...MAC, existsSync: () => true, spawnImpl: fakeSpawn({ status: { out: SIGNED_IN }, '--version': { out: '1' } }, calls), now: () => t });
  const [a, b] = await Promise.all([f.status(), f.status()]);
  assert.equal(a, b);
  assert.equal(calls.length, 2);
  t += 30_000;
  await f.status();
  assert.equal(calls.length, 2);
  t += 31_000;
  await f.status();
  assert.equal(calls.length, 4);
  await f.status({ force: true });
  assert.equal(calls.length, 6);
});

test('status: a spawn that fails (the file went away) is not installed', async () => {
  const f = createFind({ ...MAC, existsSync: () => true, spawnImpl: () => { throw new Error('ENOENT'); } });
  const s = await f.status();
  assert.equal(s.installed, false);
});

test('line: the words for Settings', () => {
  const f = createFind({ ...MAC, existsSync: () => false });
  const none = f.line({ installed: false, loggedIn: false });
  assert.equal(none.text, "Claude Code isn't installed on this computer.");
  assert.deepEqual(none.link, { label: 'Get Claude Code', url: GET_URL });
  const out = f.line({ installed: true, loggedIn: false });
  assert.equal(out.text, 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.');
  assert.equal(out.link, null);
  assert.equal(f.line({ installed: true, loggedIn: true, email: 'a@b.com', plan: 'max' }).text, 'Claude Code: signed in as a@b.com (Max)');
  assert.equal(f.line({ installed: true, loggedIn: true, email: null, plan: 'pro' }).text, 'Claude Code: signed in (Pro)');
  assert.equal(f.line({ installed: true, loggedIn: true, email: 'a@b.com', plan: null }).text, 'Claude Code: signed in as a@b.com');
});

test('spawnClaude: kill() on an npm shim ends the whole tree, not only cmd.exe', () => {
  const killed = [];
  const child = { pid: 42, kill: () => killed.push('cmd only') };
  const out = spawnClaude(() => child, 'C:\\npm\\claude.cmd', ['-p'], {}, { killTree: (pid) => killed.push(pid) });
  out.kill('SIGTERM');
  assert.deepEqual(killed, [42]);
  const direct = { pid: 7, kill: () => killed.push('direct') };
  spawnClaude(() => direct, '/bin/claude', ['-p']).kill();
  assert.deepEqual(killed, [42, 'direct']);
});
