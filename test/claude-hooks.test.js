'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { HOOK_EVENTS, hookCommand, isBuddyHook, withHooks, withoutHooks } = require('../src/main/claude/hooks');

const PORT = 51234;
const TOKEN = '0123456789abcdef0123456789abcdef';
const MAC = { port: PORT, token: TOKEN, platform: 'darwin' };
const URL = `http://127.0.0.1:${PORT}/claude-code/${TOKEN}`;
const EVENTS = ['UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'Stop', 'StopFailure', 'SessionEnd', 'PermissionRequest', 'Notification'];

// The owner's own settings.json, in short: a status command on several events, and other settings around it.
const STATUS = '/Users/akshat/.config/iterm2/cc-status';
const OWNER = Object.freeze({
  model: 'opus',
  permissions: { allow: ['Bash(npm test)'] },
  hooks: {
    UserPromptSubmit: [{ hooks: [{ type: 'command', command: STATUS }] }],
    PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: STATUS }] }],
    Stop: [{ hooks: [{ type: 'command', command: STATUS }] }],
  },
});

test('the Mac command sends the event to Buddy, skips Buddy\'s own runs, and always exits 0', () => {
  assert.strictEqual(
    hookCommand(MAC),
    `[ -n "$BUDDY_CLAUDE_CODE" ] || curl -s -m 2 -X POST -H "X-Buddy-Tty: $(ps -o tty= -p $PPID 2>/dev/null)" --data-binary @- ${URL} >/dev/null 2>&1; exit 0`,
  );
});

test('the Windows command is the same bash command: Claude Code runs hooks in Git Bash there, never in cmd', () => {
  assert.strictEqual(hookCommand({ ...MAC, platform: 'win32' }), hookCommand(MAC));
});

test('the real command, run by bash with Buddy not listening, exits 0 (a non-zero exit would block Claude Code)', { skip: process.platform === 'win32' }, async () => {
  const { spawnSync } = require('node:child_process');
  const net = require('node:net');
  // A port nobody listens on: take a free one, then let it go.
  const port = await new Promise((resolve) => {
    const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); });
  });
  const env = { ...process.env };
  delete env.BUDDY_CLAUDE_CODE;
  const r = spawnSync('/bin/bash', ['-c', hookCommand({ port, token: TOKEN, platform: 'darwin' })], { input: '{"hook_event_name":"Stop"}', env, timeout: 10000 });
  assert.strictEqual(r.status, 0, String(r.stderr));
  const marked = spawnSync('/bin/bash', ['-c', hookCommand({ port, token: TOKEN, platform: 'win32' })], { input: '{}', env: { ...env, BUDDY_CLAUDE_CODE: '1' }, timeout: 10000 });
  assert.strictEqual(marked.status, 0, String(marked.stderr));
});

// A hook of the person's own that runs a script from a folder named claude-code.
const PERSON_PY = 'python3 ~/src/claude-code/examples/hooks/x.py';

test('a Buddy hook is known by its exact shape: the mark and Buddy\'s local URL with a token', () => {
  assert.strictEqual(isBuddyHook({ type: 'command', command: hookCommand(MAC) }), true);
  assert.strictEqual(isBuddyHook({ type: 'command', command: hookCommand({ port: 60001, token: 'f'.repeat(32) }) }), true);
  assert.strictEqual(isBuddyHook({ type: 'command', command: STATUS }), false);
  assert.strictEqual(isBuddyHook({ type: 'prompt', prompt: 'say /claude-code/' }), false);
  assert.strictEqual(isBuddyHook({ type: 'command', command: PERSON_PY }), false, 'the person\'s own hook in a claude-code folder');
  assert.strictEqual(isBuddyHook({ type: 'command', command: `curl ${URL}` }), false, 'no mark');
  assert.strictEqual(isBuddyHook({ type: 'command', command: `BUDDY_CLAUDE_CODE curl ${URL}0` }), false, 'not a 32-character token');
  assert.strictEqual(isBuddyHook(null), false);
});

test('the person\'s own hook in a claude-code folder survives on and off; old Buddy entries are still replaced', () => {
  const mine = { hooks: { PreToolUse: [{ hooks: [{ type: 'command', command: PERSON_PY }] }] } };
  const on = withHooks(mine, MAC);
  assert.deepStrictEqual(on.hooks.PreToolUse[0], mine.hooks.PreToolUse[0]);
  assert.strictEqual(on.hooks.PreToolUse.length, 2);
  assert.deepStrictEqual(withoutHooks(on), mine);
  const old = withHooks(mine, { port: 50000, token: 'a'.repeat(32) });
  const moved = withHooks(old, MAC);
  assert.strictEqual(moved.hooks.PreToolUse.length, 2);
  assert.deepStrictEqual(moved.hooks.PreToolUse[0], mine.hooks.PreToolUse[0]);
  assert.ok(!JSON.stringify(moved).includes(':50000/'), 'the old Buddy entry is gone');
});

test('on: one entry on each of the seven events, after the entries already there, and nothing else changes', () => {
  const out = withHooks(OWNER, MAC);
  assert.deepStrictEqual(Object.keys(out.hooks).sort(), [...EVENTS].sort());
  for (const [event, matcher] of HOOK_EVENTS) {
    const entries = out.hooks[event];
    const mine = entries[entries.length - 1];
    assert.deepStrictEqual(mine, {
      ...(matcher ? { matcher } : {}),
      hooks: [{ type: 'command', command: hookCommand(MAC), timeout: 3 }],
    }, event);
  }
  assert.deepStrictEqual(out.hooks.PreToolUse[0], OWNER.hooks.PreToolUse[0], 'the owner\'s Bash status hook stays first');
  assert.strictEqual(out.hooks.Stop.length, 2);
  assert.strictEqual(out.hooks.SessionEnd.length, 1);
  assert.strictEqual(out.model, 'opus');
  assert.deepStrictEqual(out.permissions, OWNER.permissions);
  assert.strictEqual(out.hooks.Notification[0].matcher, 'permission_prompt|agent_needs_input|elicitation_dialog', 'not idle_prompt: an idle session needs nothing');
  assert.ok(!('matcher' in out.hooks.Stop[1]), 'Stop has no matcher');
});

test('on twice is the same as once, and a new port replaces the old entries', () => {
  const once = withHooks(OWNER, MAC);
  assert.deepStrictEqual(withHooks(once, MAC), once);
  const moved = withHooks(once, { ...MAC, port: 60000 });
  assert.strictEqual(moved.hooks.Stop.length, 2);
  assert.ok(moved.hooks.Stop[1].hooks[0].command.includes(':60000/'));
  assert.ok(!JSON.stringify(moved).includes(`:${PORT}/`), 'the old port is gone');
});

test('on works on a file with no hooks, and on an empty file', () => {
  const out = withHooks({ model: 'opus' }, MAC);
  assert.strictEqual(out.model, 'opus');
  assert.strictEqual(Object.keys(out.hooks).length, 8);
  assert.strictEqual(Object.keys(withHooks({}, MAC).hooks).length, 8);
});

test('off leaves the file as it was, as JSON', () => {
  assert.deepStrictEqual(withoutHooks(withHooks(OWNER, MAC)), OWNER);
  assert.deepStrictEqual(withoutHooks(withHooks({ model: 'opus' }, MAC)), { model: 'opus' });
  assert.deepStrictEqual(withoutHooks(withHooks({}, MAC)), {});
  assert.deepStrictEqual(withoutHooks(OWNER), OWNER, 'nothing to remove: nothing changes');
});

test('off removes only Buddy\'s hook from an entry that holds others too', () => {
  const shared = {
    hooks: { Stop: [{ hooks: [{ type: 'command', command: STATUS }, { type: 'command', command: hookCommand(MAC) }] }] },
  };
  assert.deepStrictEqual(withoutHooks(shared), { hooks: { Stop: [{ hooks: [{ type: 'command', command: STATUS }] }] } });
});

test('neither on nor off changes the object it was given', () => {
  const input = structuredClone(OWNER);
  withHooks(input, MAC);
  withoutHooks(withHooks(input, MAC));
  assert.deepStrictEqual(input, OWNER);
});

test('a hooks value that is not an object is left alone by off and replaced by on', () => {
  assert.deepStrictEqual(withoutHooks({ hooks: 'odd' }), { hooks: 'odd' });
  assert.strictEqual(Object.keys(withHooks({ hooks: 'odd' }, MAC).hooks).length, 8);
});

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHooks, CANT_READ } = require('../src/main/claude/hooks');

const HOME = '/Users/someone';

/** A fake fs over a Map of path → text, and createHooks on it (writes land in the Map, through `write`, not writeAtomic). */
function fakeHooks({ files = {}, configDirectory = null, file = null } = {}) {
  const disk = new Map(Object.entries(files));
  const fakeFs = {
    existsSync: (p) => disk.has(p),
    readFileSync: (p) => { if (!disk.has(p)) throw new Error('ENOENT'); return disk.get(p); },
    copyFileSync: (from, to) => disk.set(to, disk.get(from)),
    realpathSync: (p) => p,
    statSync: () => ({ mode: 0o100644 }),
    chmodSync: () => {},
  };
  const asked = [];
  const find = { status: async () => { asked.push(1); return { installed: true, configDirectory }; } };
  const writes = [];
  const hooks = createHooks({
    find, home: HOME, file, fs: fakeFs, platform: 'darwin',
    write: (p, text) => { writes.push(p); disk.set(p, text); },
  });
  return { hooks, disk, writes, asked };
}

const DEFAULT_FILE = `${HOME}/.claude/settings.json`;
const read = (disk, p) => JSON.parse(disk.get(p));

test('the file is Claude Code\'s own config folder, else ~/.claude, and the test\'s own file wins', async () => {
  assert.strictEqual(await fakeHooks().hooks.settingsFile(), DEFAULT_FILE);
  assert.strictEqual(await fakeHooks({ configDirectory: '/elsewhere/claude' }).hooks.settingsFile(), '/elsewhere/claude/settings.json');
  const own = fakeHooks({ configDirectory: '/elsewhere/claude', file: '/tmp/e2e/settings.json' });
  assert.strictEqual(await own.hooks.settingsFile(), '/tmp/e2e/settings.json');
  assert.deepStrictEqual(own.asked, [], 'Claude Code is not asked when the file is given');
});

test('shown() is the file with the home folder as ~', async () => {
  const { hooks } = fakeHooks();
  assert.strictEqual(hooks.shown(), '~/.claude/settings.json');
  const far = fakeHooks({ configDirectory: '/elsewhere/claude' });
  await far.hooks.settingsFile();
  assert.strictEqual(far.hooks.shown(), '/elsewhere/claude/settings.json');
});

test('install writes the merged file and keeps a copy from before, once', async () => {
  const before = JSON.stringify(OWNER, null, 4);
  const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: before } });
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), withHooks(OWNER, MAC));
  assert.strictEqual(disk.get(`${DEFAULT_FILE}.before-buddy`), before, 'the backup is the file as it was');
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  // The same again: nothing to write. Another port: written, and the backup is still the first copy.
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), false);
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  assert.strictEqual(await hooks.install({ port: 60000, token: TOKEN }), true);
  assert.strictEqual(disk.get(`${DEFAULT_FILE}.before-buddy`), before);
});

test('install on a missing file makes it, with Buddy\'s hooks only and no backup', async () => {
  const { hooks, disk } = fakeHooks();
  assert.strictEqual(await hooks.install({ port: PORT, token: TOKEN }), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), withHooks({}, MAC));
  assert.strictEqual(disk.has(`${DEFAULT_FILE}.before-buddy`), false);
});

test('remove puts the file back as JSON, and does nothing to a file without Buddy\'s hooks', async () => {
  const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: JSON.stringify(withHooks(OWNER, MAC)) } });
  assert.strictEqual(await hooks.remove(), true);
  assert.deepStrictEqual(read(disk, DEFAULT_FILE), OWNER);
  assert.strictEqual(await hooks.remove(), false);
  assert.deepStrictEqual(writes, [DEFAULT_FILE]);
  const none = fakeHooks();
  assert.strictEqual(await none.hooks.remove(), false);
  assert.strictEqual(none.disk.size, 0, 'no file is made just to remove nothing');
});

test('a file that is not JSON is left alone, and the switch is told why', async () => {
  for (const text of ['{ "hooks": [1,], }', '[]', '"a string"']) {
    const { hooks, disk, writes } = fakeHooks({ files: { [DEFAULT_FILE]: text } });
    await assert.rejects(hooks.install({ port: PORT, token: TOKEN }), { name: 'BuddyError', code: 'claude_settings', message: CANT_READ });
    await assert.rejects(hooks.remove(), { code: 'claude_settings' });
    assert.strictEqual(disk.get(DEFAULT_FILE), text);
    assert.deepStrictEqual(writes, []);
    assert.strictEqual(disk.has(`${DEFAULT_FILE}.before-buddy`), false, 'no backup of a file that was not changed');
  }
});

test('the same bash command goes into the file on Windows', async () => {
  const disk = new Map();
  const hooks = createHooks({
    find: { status: async () => ({ configDirectory: null }) }, home: 'C:\\Users\\someone', platform: 'win32',
    fs: { existsSync: (p) => disk.has(p), readFileSync: (p) => disk.get(p), copyFileSync: () => {}, chmodSync: () => {} },
    write: (p, text) => disk.set(p, text),
  });
  await hooks.install({ port: PORT, token: TOKEN });
  const file = [...disk.keys()][0];
  assert.ok(file.endsWith(path.join('.claude', 'settings.json')));
  assert.ok(disk.get(file).includes('[ -n \\"$BUDDY_CLAUDE_CODE\\" ] || curl'));
  assert.ok(!disk.get(file).includes('exit /b'));
});

test('with the real fs, the file is written whole through writeAtomic and no temporary file is left', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(OWNER));
  const hooks = createHooks({ find: { status: async () => { throw new Error('not asked'); } }, home: dir, file, platform: 'darwin' });
  await hooks.install({ port: PORT, token: TOKEN });
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), withHooks(OWNER, MAC));
  assert.ok(fs.readFileSync(file, 'utf8').endsWith('}\n'), 'pretty, with a last newline');
  assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
  assert.strictEqual(fs.readFileSync(`${file}.before-buddy`, 'utf8'), JSON.stringify(OWNER));
  await hooks.remove();
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(file, 'utf8')), OWNER);
});

test('a settings.json that is a symlink stays one, and the file it points to gets the hooks', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const real = path.join(dir, 'dotfiles', 'claude-settings.json');
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, JSON.stringify(OWNER), { mode: 0o640 });
  fs.chmodSync(real, 0o640);
  const file = path.join(dir, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.symlinkSync(real, file);
  const hooks = createHooks({ find: { status: async () => ({}) }, home: dir, file, platform: 'darwin' });
  await hooks.install({ port: PORT, token: TOKEN });
  assert.ok(fs.lstatSync(file).isSymbolicLink(), 'still a symlink');
  assert.strictEqual(fs.readlinkSync(file), real);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')), withHooks(OWNER, MAC));
  assert.strictEqual(fs.statSync(real).mode & 0o777, 0o640, 'the mode is kept');
  assert.strictEqual(fs.existsSync(`${real}.tmp`), false);
  assert.strictEqual(fs.existsSync(`${file}.tmp`), false);
  const backup = `${file}.before-buddy`;
  assert.strictEqual(fs.readFileSync(backup, 'utf8'), JSON.stringify(OWNER), 'the backup is next to the path the person uses');
  assert.strictEqual(fs.statSync(backup).mode & 0o777, 0o640, 'with the same mode');
  await hooks.remove();
  assert.ok(fs.lstatSync(file).isSymbolicLink());
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(real, 'utf8')), OWNER);
});

test('a 0600 settings.json stays 0600, and a new one is made 0600', { skip: process.platform === 'win32' }, async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-hooks-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'claude', 'settings.json');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(OWNER));
  fs.chmodSync(file, 0o600);
  const hooks = createHooks({ find: { status: async () => ({}) }, home: dir, file, platform: 'darwin' });
  await hooks.install({ port: PORT, token: TOKEN });
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  assert.strictEqual(fs.statSync(`${file}.before-buddy`).mode & 0o777, 0o600);
  await hooks.remove();
  assert.strictEqual(fs.statSync(file).mode & 0o777, 0o600);
  const fresh = path.join(dir, 'new', 'settings.json');
  await createHooks({ find: { status: async () => ({}) }, home: dir, file: fresh, platform: 'darwin' }).install({ port: PORT, token: TOKEN });
  assert.strictEqual(fs.statSync(fresh).mode & 0o777, 0o600);
});
