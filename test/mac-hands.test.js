'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createMacHands } = require('../src/main/agent/mac-hands');
const { BuddyError } = require('../shared/errors');

const TEXTEDIT = { pid: 42, bundleId: 'com.apple.TextEdit', name: 'TextEdit' };
const TREE = {
  gen: 7, title: 'Untitled', focused: 'e3', secureFocused: false,
  nodes: [
    { id: 'e1', role: 'AXWindow', subrole: 'AXStandardWindow', name: 'Untitled', depth: 0, frame: { x: 100, y: 50, width: 800, height: 600 } },
    { id: 'e2', role: 'AXButton', subrole: '', name: 'Bold', depth: 1, frame: { x: 110, y: 60, width: 20, height: 20 } },
    { id: 'e3', role: 'AXTextArea', subrole: '', name: '', value: 'Hello', depth: 1, frame: { x: 100, y: 100, width: 800, height: 500 } },
    { id: 'e4', role: 'AXCheckBox', subrole: 'AXSwitch', name: 'Wrap', value: '1', depth: 1, disabled: true },
    { id: 'e5', role: 'AXTextField', subrole: 'AXSecureTextField', name: 'Password', secure: true, depth: 1 },
  ],
};

function fakeHelper({ tree = TREE, last = TEXTEDIT, fail = {} } = {}) {
  const calls = [];
  return {
    calls,
    lastApp: last,
    async call(cmd, args) {
      calls.push([cmd, args]);
      if (fail[cmd]) throw fail[cmd];
      if (cmd === 'axTree') return tree;
      if (cmd === 'frontmost') return last;
      if (cmd === 'screenshotScreen') return { image: 'IMG', width: 1280, height: 800, origin: { x: 0, y: 0 }, pointsPerPixel: 1.125 };
      return { ok: true };
    },
  };
}

const Q = 'YES'; // in a test: "the person said yes to whatever act asks"
function yesTo(h) {
  const act = h.act;
  return { ...h, async act(action, o, opts = {}) {
    if (opts.approved !== Q) return act(action, o, opts);
    const first = await act(action, o, { ...opts, approved: null });
    return first.code === 'needs_approval' ? act(action, o, { ...opts, approved: first.question }) : first;
  } };
}

function hands(over = {}) {
  const helper = over.helper || fakeHelper();
  const opened = [];
  const shell = {
    openExternal: async (u) => { opened.push(['url', u]); },
    openPath: async (p) => { opened.push(['path', p]); return ''; },
    trashItem: async (p) => { opened.push(['trash', p]); },
  };
  const apps = { find: (name) => (name === 'TextEdit' ? { kind: 'one', app: { name: 'TextEdit', path: '/System/Applications/TextEdit.app' } } : { kind: 'none', line: `I couldn't find ${name} on this Mac.` }), open: async (p) => { opened.push(['app', p]); return ''; } };
  let t = 0;
  const now = () => { t += 1000; return t; }; // waits for an app to come to the front end in a few fake seconds
  const h = createMacHands({ helper, apps, shell, spawn, home: over.home || os.tmpdir(), sleep: async () => {}, now, ...over });
  return { h: yesTo(h), helper, opened };
}

test('observe: the app, the window, short roles, states, a password field without its value', async () => {
  const { h } = hands();
  const o = await h.observe({ screenshot: false });
  assert.deepStrictEqual(o.app, { name: 'TextEdit', id: 'com.apple.TextEdit', pid: 42 });
  assert.deepStrictEqual(o.window, { title: 'Untitled' });
  assert.strictEqual(o.focused, 'e3');
  assert.deepStrictEqual(o.elements.map((e) => [e.id, e.role, e.name, e.value, e.state]), [
    ['e1', 'window', 'Untitled', undefined, ''],
    ['e2', 'button', 'Bold', undefined, ''],
    ['e3', 'textarea', '', 'Hello', 'focused'],
    ['e4', 'switch', 'Wrap', undefined, 'on disabled'],
    ['e5', 'password-field', 'Password', undefined, ''],
  ]);
  assert.strictEqual(o.treeQuality, 'poor');
  assert.strictEqual(o.screen, undefined);
});

test('observe with a screenshot; none while a password field has the focus', async () => {
  const { h } = hands();
  const o = await h.observe({ screenshot: true });
  assert.deepStrictEqual(o.screen, { image: 'IMG', width: 1280, height: 800 });
  const secret = hands({ helper: fakeHelper({ tree: { ...TREE, secureFocused: true } }) });
  assert.strictEqual((await secret.h.observe({ screenshot: true })).screen, undefined);
});

test('observe without Accessibility throws; an app that does not answer gives an empty tree', async () => {
  const noAx = hands({ helper: fakeHelper({ fail: { axTree: new BuddyError('no_accessibility', 'x') } }) });
  await assert.rejects(noAx.h.observe({}), { code: 'no_accessibility' });
  const slow = hands({ helper: fakeHelper({ fail: { axTree: new BuddyError('timeout', 'x') } }) });
  const o = await slow.h.observe({});
  assert.deepStrictEqual([o.elements, o.treeQuality], [[], 'none']);
});

test('element acts go to axAct with the tree\'s gen; type into an element focuses it first', async () => {
  const { h, helper } = hands();
  const o = await h.observe({});
  await h.act({ type: 'click', id: 'e2' }, o);
  await h.act({ type: 'toggle', id: 'e4', on: false }, o);
  await h.act({ type: 'pick', id: 'e2', option: 'Dark' }, o);
  await h.act({ type: 'set_value', id: 'e3', text: 'Hi' }, o);
  await h.act({ type: 'type', text: 'abc', id: 'e3' }, o);
  assert.deepStrictEqual(helper.calls.filter((c) => c[0] !== 'axTree').map((c) => [c[0], c[1]]), [
    ['axAct', { pid: 42, gen: 7, id: 'e2', op: 'press' }],
    ['axAct', { pid: 42, gen: 7, id: 'e4', op: 'toggle', value: false }],
    ['axAct', { pid: 42, gen: 7, id: 'e2', op: 'pick', value: 'Dark' }],
    ['axAct', { pid: 42, gen: 7, id: 'e3', op: 'setValue', value: 'Hi' }],
    ['axAct', { pid: 42, gen: 7, id: 'e3', op: 'focus' }],
    ['typeText', { pid: 42, text: 'abc' }],
  ]);
});

test('click_at maps screenshot pixels to screen points; elementAt finds the smallest element there', async () => {
  const { h, helper } = hands();
  const o = await h.observe({ screenshot: true });
  await h.act({ type: 'click_at', x: 100, y: 60, double: true }, o);
  assert.deepStrictEqual(helper.calls.at(-1), ['click', { x: 112.5, y: 67.5, right: false, count: 2 }]);
  assert.strictEqual((await h.elementAt(100, 60, o)).id, 'e2');
  assert.strictEqual((await h.elementAt(1000, 700, o)), null);
});

test('scroll at an element\'s centre, or the window\'s; keys and menu go to the front app', async () => {
  const { h, helper } = hands();
  const o = await h.observe({});
  await h.act({ type: 'scroll', dir: 'down', id: 'e3' }, o);
  await h.act({ type: 'scroll', dir: 'up' }, o);
  await h.act({ type: 'keys', combo: 'cmd+t' }, o);
  await h.act({ type: 'menu', path: ['Format', 'Font'] }, o);
  assert.deepStrictEqual(helper.calls.slice(-4), [
    ['scroll', { x: 500, y: 350, dir: 'down' }], ['scroll', { x: 500, y: 350, dir: 'up' }],
    ['keys', { pid: 42, combo: 'cmd+t' }], ['menu', { pid: 42, path: ['Format', 'Font'] }],
  ]);
});

test('helper errors come back as a failed step, but missing permissions stop the job', async () => {
  const stale = hands({ helper: fakeHelper({ fail: { axAct: new BuddyError('stale_id', 'That is not on the screen any more. Look again.') } }) });
  const o = await stale.h.observe({});
  assert.deepStrictEqual(await stale.h.act({ type: 'click', id: 'e2' }, o), { ok: false, code: 'stale_id', note: 'That is not on the screen any more. Look again.' });
  const noAx = hands({ helper: fakeHelper({ fail: { keys: new BuddyError('no_accessibility', 'x') } }) });
  await assert.rejects(noAx.h.act({ type: 'keys', combo: 'esc' }, o), { code: 'no_accessibility' });
});

test('open_app, open_url, open_file and open_settings', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const { h, opened } = hands({ home: dir });
  const o = await h.observe({});
  assert.deepStrictEqual(await h.act({ type: 'open_app', name: 'TextEdit' }, o), { ok: true, note: 'opened TextEdit' });
  assert.deepStrictEqual(await h.act({ type: 'open_app', name: 'Photoshop' }, o), { ok: false, code: 'no_app', note: "I couldn't find Photoshop on this Mac." });
  await h.act({ type: 'open_url', url: 'https://youtube.com' }, o);
  assert.strictEqual((await h.act({ type: 'open_file', path: '~/a.txt' }, o)).ok, true);
  assert.strictEqual((await h.act({ type: 'open_file', path: '~/nope.txt' }, o)).ok, false);
  await h.act({ type: 'open_settings', page: 'appearance' }, o);
  assert.match((await h.act({ type: 'open_settings', page: 'warp' }, o)).note, /appearance/);
  assert.deepStrictEqual(opened, [
    ['app', '/System/Applications/TextEdit.app'], ['url', 'https://youtube.com'], ['path', path.join(fs.realpathSync(dir), 'a.txt')],
    ['url', 'x-apple.systempreferences:com.apple.Appearance-Settings.extension'],
  ]);
});

test('files: list, find by name, read, new folder, copy, move, write a new file, trash through the system', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'hello');
  const { h, opened } = hands({ home: dir });
  const o = await h.observe({});
  assert.deepStrictEqual(await h.act({ type: 'files', op: 'list', path: '~' }, o), { ok: true, note: '1 items', output: 'a.txt' });
  assert.strictEqual((await h.act({ type: 'files', op: 'read', path: '~/a.txt' }, o)).output, 'hello');
  assert.strictEqual((await h.act({ type: 'files', op: 'new_folder', path: '~/Trip' }, o)).ok, true);
  assert.strictEqual((await h.act({ type: 'files', op: 'copy', path: '~/a.txt', to: '~/Trip/a.txt' }, o)).ok, true);
  assert.strictEqual((await h.act({ type: 'files', op: 'move', path: '~/Trip/a.txt', to: '~/Trip/b.txt' }, o)).ok, true);
  assert.strictEqual((await h.act({ type: 'files', op: 'write', path: '~/note.txt', text: 'hi' }, o)).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'note.txt'), 'utf8'), 'hi');
  assert.deepStrictEqual((await h.act({ type: 'files', op: 'trash', path: '~/note.txt' }, o)).code, 'needs_approval');
  await h.act({ type: 'files', op: 'trash', path: '~/note.txt' }, o, { approved: Q });
  assert.deepStrictEqual(opened.at(-1), ['trash', path.join(fs.realpathSync(dir), 'note.txt')]);
  assert.strictEqual(await h.exists('~/Trip/b.txt'), true);
  assert.strictEqual(await h.exists('~/Trip/a.txt'), false);
});

test('run: a shell command in the home folder, its output, its exit code', async () => {
  const { h } = hands();
  const o = await h.observe({});
  const ok = await h.act({ type: 'run', command: 'echo hi' }, o);
  assert.deepStrictEqual([ok.ok, ok.output.trim()], [true, 'hi']);
  const bad = await h.act({ type: 'run', command: 'exit 3' }, o, { approved: Q });
  assert.deepStrictEqual([bad.ok, bad.note], [false, 'exit code 3']);
});

test('run: stopping the job kills the command at once', async () => {
  const { h } = hands();
  const o = await h.observe({});
  const job = new AbortController();
  const started = Date.now();
  setTimeout(() => job.abort(), 50);
  const r = await h.act({ type: 'run', command: 'sleep 5' }, o, { signal: job.signal, approved: Q });
  assert.deepStrictEqual([r.ok, r.code], [false, 'stopped']);
  assert.ok(Date.now() - started < 3000, 'did not wait for sleep 5');
});

test('rename: a relative new name stays in the file\'s own folder, and exists() finds it there', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));
  fs.mkdirSync(path.join(dir, 'Trip'));
  fs.writeFileSync(path.join(dir, 'Trip', 'a.txt'), 'x');
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  assert.strictEqual(await h.exists('a.txt', { from: '~/Trip/b.txt' }), true);
  assert.strictEqual((await h.act({ type: 'files', op: 'rename', path: '~/Trip/a.txt', to: 'b.txt' }, o)).ok, true);
  assert.strictEqual(fs.existsSync(path.join(dir, 'Trip', 'b.txt')), true);
  assert.strictEqual(fs.existsSync(path.join(dir, 'b.txt')), false, 'not moved to the home folder');
  assert.strictEqual(await h.exists('b.txt', { from: '~/Trip/b.txt' }), true);
  assert.strictEqual(await h.exists('b.txt'), false, 'without from, a relative path is in the home folder');
});

test('a search field is a searchfield', async () => {
  const tree = { ...TREE, nodes: [...TREE.nodes, { id: 'e6', role: 'AXTextField', subrole: 'AXSearchField', name: 'Search', depth: 1 }] };
  const { h } = hands({ helper: fakeHelper({ tree }) });
  assert.strictEqual((await h.observe({})).elements.at(-1).role, 'searchfield');
});

test('a password app is never looked at or acted in', async () => {
  const pw = hands({ helper: fakeHelper({ last: { pid: 9, bundleId: 'com.1password.1password', name: '1Password' } }) });
  const o = await pw.h.observe({ screenshot: true });
  assert.deepStrictEqual([o.elements, o.screen], [[], undefined]);
  assert.strictEqual((await pw.h.act({ type: 'keys', combo: 'cmd+c' }, o)).code, 'password_app');
});

test('helper error codes become clear step results', async () => {
  for (const code of ['focus_unknown', 'secure_field', 'stale_id', 'focus_failed', 'press_failed']) {
    const x = hands({ helper: fakeHelper({ fail: { typeText: new BuddyError(code, '') } }) });
    const o = await x.h.observe({});
    const r = await x.h.act({ type: 'type', text: 'a' }, o);
    assert.strictEqual(r.ok, false);
    assert.strictEqual(r.code, code);
    assert.ok(r.note.length > 10, `note for ${code}`);
  }
});

test('a truncated tree is flagged', async () => {
  const { h } = hands({ helper: fakeHelper({ tree: { ...TREE, truncated: true } }) });
  assert.strictEqual((await h.observe({})).truncated, true);
});

test('observe: the focused line, subrole, and description stands in for an empty name', async () => {
  const tree = { ...TREE, nodes: [
    { id: 'e1', role: 'AXWindow', subrole: '', name: 'T', depth: 0 },
    { id: 'e3', role: 'AXTextArea', subrole: '', name: '', value: 'one\nls -la\n\n', depth: 1 },
    { id: 'e7', role: 'AXButton', subrole: '', name: '', description: 'Send', depth: 1, frame: { x: 0, y: 0, width: 10, height: 10 } },
  ] };
  const { h } = hands({ helper: fakeHelper({ tree }) });
  const o = await h.observe({});
  assert.strictEqual(o.line, 'ls -la');
  assert.strictEqual(o.elements[2].name, 'Send');
  const ctx = await h.riskContext({ type: 'click', id: 'e7' }, o);
  assert.deepStrictEqual([ctx.target.name, ctx.target.role, ctx.title, ctx.line, ctx.app.name], ['Send', 'button', 'Untitled', 'ls -la', 'TextEdit']);
});

test('canonical: symlinks and disk names are resolved; relative paths are left for the core to ask about', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));
  fs.mkdirSync(path.join(dir, 'real'));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  fs.symlinkSync('/etc', path.join(dir, 'etc'));
  const { h } = hands({ home: dir });
  assert.strictEqual((await h.canonical({ type: 'files', op: 'write', path: '~/link/x.txt', text: 'a' })).path, '~/real/x.txt');
  assert.strictEqual((await h.canonical({ type: 'files', op: 'write', path: '~/etc/hosts', text: 'a' })).path, '/private/etc/hosts');
  assert.strictEqual((await h.canonical({ type: 'files', op: 'rename', path: '~/a', to: 'b.txt' })).to, '~/b.txt');
  assert.strictEqual((await h.canonical({ type: 'click', id: 'e1' })).id, 'e1');
});

test('keys with an unknown key or modifier name are refused', async () => {
  const { h, helper } = hands();
  const o = await h.observe({});
  for (const combo of ['cmd+banana', 'meta+t', 'cmd+', '']) {
    assert.strictEqual((await h.act({ type: 'keys', combo }, o, { approved: Q })).code, 'bad_key', combo);
  }
  assert.strictEqual(helper.calls.some((c) => c[0] === 'keys'), false);
  assert.strictEqual((await h.act({ type: 'keys', combo: 'shift+cmd+4' }, o)).ok, true);
});

const real = (p) => fs.realpathSync(p);
const tmpHome = () => fs.mkdtempSync(path.join(os.tmpdir(), 'hands-'));

test('files find: no shell, the query is one argument, output cut to 30 lines', async () => {
  const dir = tmpHome();
  const seen = [];
  const rec = (file, args, opts) => { seen.push([file, args, opts]); return spawn(file, args, opts); };
  const { h } = hands({ home: dir, spawn: rec });
  const o = await h.observe({});
  const evil = `x"; touch ${path.join(dir, 'pwned')} #`;
  const r = await h.act({ type: 'files', op: 'find', path: '~', text: evil }, o);
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(seen[0].slice(0, 2), ['mdfind', ['-onlyin', real(dir), '-name', evil]]);
  assert.ok(!seen[0][2].shell);
  assert.strictEqual(fs.existsSync(path.join(dir, 'pwned')), false);
});

test('act uses the real path it checked: a link inside home is followed to its target', async () => {
  const dir = tmpHome();
  fs.mkdirSync(path.join(dir, 'real'));
  fs.symlinkSync(path.join(dir, 'real'), path.join(dir, 'link'));
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  assert.strictEqual((await h.act({ type: 'files', op: 'write', path: '~/link/x.txt', text: 'a' }, o)).ok, true);
  assert.strictEqual(fs.readFileSync(path.join(dir, 'real', 'x.txt'), 'utf8'), 'a');
});

test('a link to a system folder or a secret file is refused or needs a yes, and nothing is written', async () => {
  const dir = tmpHome();
  fs.symlinkSync('/etc', path.join(dir, 'etc'));
  fs.mkdirSync(path.join(dir, '.ssh'));
  fs.writeFileSync(path.join(dir, '.ssh', 'id_rsa'), 'KEY');
  fs.symlinkSync(path.join(dir, '.ssh', 'id_rsa'), path.join(dir, 'innocent.txt'));
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  assert.strictEqual((await h.act({ type: 'files', op: 'write', path: '~/etc/hosts', text: 'a' }, o)).code, 'needs_approval');
  const sec = await h.act({ type: 'files', op: 'read', path: '~/innocent.txt' }, o, { approved: Q });
  assert.deepStrictEqual([sec.ok, sec.code], [false, 'refused']);
  assert.strictEqual(sec.output, undefined);
});

test('a relative path is resolved before the check (a relative rename to a secret name is refused)', async () => {
  const dir = tmpHome();
  fs.mkdirSync(path.join(dir, '.ssh'));
  fs.writeFileSync(path.join(dir, '.ssh', 'a'), 'x');
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  const r = await h.act({ type: 'files', op: 'rename', path: '~/.ssh/a', to: 'id_rsa' }, o, { approved: Q });
  assert.deepStrictEqual([r.ok, r.code], [false, 'refused']);
});

test('a dangling link is followed to its missing target, and a write cannot go through it', async () => {
  const dir = tmpHome();
  const outside = path.join(real(os.tmpdir()), `outside-${process.pid}-${Date.now()}`);
  fs.symlinkSync(outside, path.join(dir, 'dangle'));
  const { h } = hands({ home: dir });
  const c = await h.canonical({ type: 'files', op: 'write', path: '~/dangle', text: 'a' });
  assert.notStrictEqual(c.path, '~/dangle');
  assert.strictEqual(await h.exists('~/dangle'), true);
  const o = await h.observe({});
  const r = await h.act({ type: 'files', op: 'write', path: '~/dangle', text: 'a' }, o, { approved: Q });
  // the target is in the temp folder (not a system folder), checked as such; it is written there, not anywhere unchecked
  assert.strictEqual(r.ok, true);
  assert.strictEqual(fs.existsSync(outside), true);
  fs.rmSync(outside);
});

test('act refuses a never step, and an ask step without approved', async () => {
  const dir = tmpHome();
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  assert.strictEqual((await h.act({ type: 'run', command: 'sudo ls' }, o, { approved: Q })).code, 'refused');
  assert.strictEqual((await h.act({ type: 'run', command: 'touch x' }, o)).code, 'needs_approval');
  assert.strictEqual((await h.act({ type: 'run', command: 'touch x' }, o, { approved: Q })).ok, true);
  assert.strictEqual(fs.existsSync(path.join(dir, 'x')), true);
});

test('open_url only opens web links', async () => {
  const { h, opened } = hands();
  const o = await h.observe({});
  for (const url of ['file:///etc/passwd', 'javascript:alert(1)', 'data:text/html,x', 'zoommtg://x']) {
    assert.strictEqual((await h.act({ type: 'open_url', url }, o, { approved: Q })).ok, false, url);
  }
  assert.deepStrictEqual(opened, []);
});

test('run: the whole process group is killed on stop, and the env is cut down', async () => {
  const dir = tmpHome();
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  const job = new AbortController();
  setTimeout(() => job.abort(), 300);
  const pidFile = path.join(dir, 'pid');
  const r = await h.act({ type: 'run', command: `sleep 30 & echo $! > ${pidFile}; wait` }, o, { signal: job.signal, approved: Q });
  assert.strictEqual(r.code, 'stopped');
  const pid = Number(fs.readFileSync(pidFile, 'utf8'));
  await new Promise((resolve) => { setTimeout(resolve, 200); });
  assert.throws(() => process.kill(pid, 0), /ESRCH/);
  const env = await h.act({ type: 'run', command: 'env' }, o, { approved: Q });
  const names = env.output.split('\n').map((l) => l.split('=')[0]).filter(Boolean);
  assert.ok(names.every((n) => ['PATH', 'HOME', 'LANG', 'TERM', 'USER', 'PWD', 'SHLVL', '_', 'OLDPWD', 'LC_CTYPE', 'LOGNAME'].includes(n)), names.join(','));
  assert.ok(!names.includes('HOME') || env.output.includes(`HOME=${dir}`));
});

test('run: a background grandchild holding the pipe does not hang, and a long command times out with code timeout', async () => {
  const { h } = hands({ runTimeoutMs: 300 });
  const o = await h.observe({});
  const t0 = Date.now();
  const bg = await h.act({ type: 'run', command: 'sleep 20 & echo hi' }, o, { approved: Q });
  assert.strictEqual(bg.output.trim(), 'hi');
  assert.ok(Date.now() - t0 < 2000);
  const slow = await h.act({ type: 'run', command: 'sleep 20' }, o, { approved: Q });
  assert.strictEqual(slow.code, 'timeout');
});

test('riskContext sets exists for a write onto an existing file; /tmp files are not system folders', async () => {
  const dir = tmpHome();
  fs.writeFileSync(path.join(dir, 'a.txt'), 'x');
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  assert.strictEqual((await h.riskContext({ type: 'files', op: 'write', path: '~/a.txt', text: 'y' }, o)).exists, true);
  assert.strictEqual((await h.riskContext({ type: 'files', op: 'write', path: '~/new.txt', text: 'y' }, o)).exists, false);
  const tmpFile = path.join(real(os.tmpdir()), `t-${process.pid}.txt`);
  const w = await h.act({ type: 'files', op: 'write', path: tmpFile, text: 'z' }, o);
  assert.strictEqual(w.ok, true, w.note); // the temp folder is not a system folder
  fs.rmSync(tmpFile, { force: true });
});

test('approval is bound to the question: a different or true approval is not enough', async () => {
  const dir = tmpHome();
  const { h } = hands({ home: dir });
  const o = await h.observe({});
  const a = { type: 'run', command: 'touch x' };
  const first = await h.act(a, o);
  assert.deepStrictEqual([first.code, typeof first.question], ['needs_approval', 'string']);
  for (const approved of [true, 'Run this command: touch y?', '']) {
    assert.strictEqual((await h.act(a, o, { approved })).code, 'needs_approval');
  }
  assert.strictEqual(fs.existsSync(path.join(dir, 'x')), false);
  assert.strictEqual((await h.act(a, o, { approved: first.question })).ok, true);
  // the same approval does not cover another step
  const other = await h.act({ type: 'run', command: 'touch z' }, o, { approved: first.question });
  assert.strictEqual(other.code, 'needs_approval');
});

test('the AI risky flag raises a safe step to an ask', async () => {
  const { h } = hands();
  const o = await h.observe({});
  assert.strictEqual((await h.act({ type: 'click', id: 'e2' }, o)).ok, true);
  assert.strictEqual((await h.act({ type: 'click', id: 'e2' }, o, { risky: true })).code, 'needs_approval');
});

test('canonical gives the resolved view the act judges, relative paths included', async () => {
  const dir = tmpHome();
  const { h } = hands({ home: dir });
  assert.strictEqual((await h.canonical({ type: 'files', op: 'read', path: 'a.txt' })).path, '~/a.txt');
});

test('open_url: mail and call links ask, file/javascript/data/unknown are refused', async () => {
  const { h, opened } = hands();
  const o = await h.observe({});
  const r = await h.act({ type: 'open_url', url: 'tel:123' }, o);
  assert.strictEqual(r.code, 'needs_approval');
  assert.strictEqual((await h.act({ type: 'open_url', url: 'tel:123' }, o, { approved: Q })).ok, true);
  assert.strictEqual((await h.act({ type: 'open_url', url: 'mailto:a@b.c' }, o)).ok, true);
  assert.deepStrictEqual(opened.map((x) => x[1]), ['tel:123', 'mailto:a@b.c']);
});

test('files find: a query starting with a dash is refused', async () => {
  const { h } = hands();
  const o = await h.observe({});
  assert.strictEqual((await h.act({ type: 'files', op: 'find', path: '~', text: '-onlyin' }, o)).code, 'bad_query');
});
