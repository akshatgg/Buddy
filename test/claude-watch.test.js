'use strict';

const test = require('node:test');
const assert = require('node:assert');
const net = require('node:net');
const { createWatch, MOODS, OFF_LINE, FORGET_AFTER_MS, BODY_LIMIT, PORT_MIN, PORT_MAX } = require('../src/main/claude/watch');
const { BuddyError } = require('../shared/errors');

const TOKEN = 'f'.repeat(32);

/** A port nobody listens on right now. */
function freePort() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

/** A server that holds a port, so the watcher finds it taken. */
function hold(t, port) {
  return new Promise((resolve) => {
    const s = net.createServer();
    t.after(() => s.close());
    s.listen(port, '127.0.0.1', () => resolve(s));
  });
}

/** createWatch with a fake store, hooks, buddy and clock; the port comes from `ports`, in order. */
function setup(t, { stored = {}, ports, busy = () => false, hooksError = null, active } = {}) {
  const saved = { watchClaudeCode: false, claudeHookPort: null, claudeHookToken: null, ...stored };
  const store = { get: (key) => saved[key], set: (patch) => Object.assign(saved, patch) };
  const ui = { moods: [], bubbles: [], mood(name) { this.moods.push(name); }, bubble(text) { this.bubbles.push(text); } };
  const hooks = {
    installs: [], removes: 0,
    shown: () => '~/.claude/settings.json',
    fail: null, // set by a test: the error install throws from now on
    async install(opts) { const err = this.fail ?? hooksError; if (err) throw err; this.installs.push(opts); return true; },
    async remove() { if (hooksError) throw hooksError; this.removes += 1; return true; },
  };
  let clock = 1_000_000;
  const laters = [];
  const queue = [...ports];
  const watch = createWatch({
    store, find: {}, hooks, ui, chatBusy: busy, ...(active ? { active } : {}),
    now: () => clock,
    later: (fn, ms) => { const timer = { fn, ms }; laters.push(timer); return timer; },
    cancel: (timer) => { const i = laters.indexOf(timer); if (i >= 0) laters.splice(i, 1); },
    randomPort: () => queue.shift(),
    newToken: () => TOKEN,
  });
  t.after(() => watch.stop());
  const fire = () => { for (const timer of laters.splice(0)) timer.fn(); };
  return { watch, saved, ui, hooks, laters, fire, tick: (ms) => { clock += ms; } };
}

const post = (port, path, body, init = {}) => fetch(`http://127.0.0.1:${port}${path}`, { method: 'POST', body, ...init });
const event = (name, extra = {}) => JSON.stringify({ hook_event_name: name, session_id: 's1', cwd: '/x/my-app', ...extra });
const tick = () => new Promise((r) => setImmediate(r));

test('start picks a port, makes a token, saves both and installs the hooks with them', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port] });
  assert.deepStrictEqual(await watch.start(), { port });
  assert.strictEqual(saved.claudeHookPort, port);
  assert.strictEqual(saved.claudeHookToken, TOKEN);
  assert.deepStrictEqual(hooks.installs, [{ port, token: TOKEN }]);
  assert.strictEqual(saved.watchClaudeCode, false, 'start alone does not flip the switch');
  assert.deepStrictEqual(await watch.start(), { port }, 'started twice is started once');
  assert.strictEqual(hooks.installs.length, 1);
});

test('the port range, and the saved port and token are kept on the next launch', async (t) => {
  assert.ok(PORT_MIN === 49152 && PORT_MAX === 65535);
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [], stored: { claudeHookPort: port, claudeHookToken: 'a'.repeat(32) } });
  await watch.start();
  assert.strictEqual(saved.claudeHookPort, port);
  assert.strictEqual(saved.claudeHookToken, 'a'.repeat(32));
  assert.deepStrictEqual(hooks.installs, [{ port, token: 'a'.repeat(32) }], 'the hooks are checked on every launch');
});

test('a taken port: another is picked, saved, and the hooks are written with it', async (t) => {
  const taken = await freePort();
  await hold(t, taken);
  const other = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [other], stored: { claudeHookPort: taken, claudeHookToken: TOKEN } });
  assert.deepStrictEqual(await watch.start(), { port: other });
  assert.strictEqual(saved.claudeHookPort, other);
  assert.deepStrictEqual(hooks.installs, [{ port: other, token: TOKEN }]);
});

test('when no port can be opened, start fails in plain words', async (t) => {
  const taken = await freePort();
  await hold(t, taken);
  const { watch } = setup(t, { ports: Array(20).fill(taken) });
  await assert.rejects(watch.start(), { name: 'BuddyError', code: 'claude_watch', message: "I couldn't open a port for Claude Code's hooks. Try again." });
});

test('only POST /claude-code/<token> is heard; the rest is 404; a big body is dropped', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  assert.strictEqual((await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'))).status, 204);
  assert.strictEqual((await post(port, '/claude-code/wrong', event('Stop'))).status, 404);
  assert.strictEqual((await post(port, '/other', event('Stop'))).status, 404);
  assert.strictEqual((await fetch(`http://127.0.0.1:${port}/claude-code/${TOKEN}`)).status, 404, 'GET is not heard');
  const big = JSON.stringify({ hook_event_name: 'Stop', session_id: 's1', pad: 'x'.repeat(BODY_LIMIT) });
  await post(port, `/claude-code/${TOKEN}`, big).catch(() => {}); // the socket may be closed under it
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking'], 'the big Stop never reached the sessions');
});

test('a session\'s events move the buddy', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  const send = (name, extra) => post(port, `/claude-code/${TOKEN}`, event(name, extra));
  await send('UserPromptSubmit');
  await send('PreToolUse', { tool_name: 'Read' });
  await send('PermissionRequest', { tool_name: 'Bash' });
  await send('PreToolUse', { tool_name: 'Bash' });
  await send('Stop');
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave', 'thinking', 'celebrate']);
  assert.deepStrictEqual(ui.bubbles, ['Claude Code needs you in my-app', 'Claude Code is done in my-app']);
  await post(port, `/claude-code/${TOKEN}`, 'not json');
  await post(port, `/claude-code/${TOKEN}`, JSON.stringify({ hook_event_name: 'SubagentStop', session_id: 's1' }));
  await tick();
  assert.strictEqual(ui.moods.length, 4, 'what is not an event does nothing');
});

test('while the chat is thinking, moods wait; the picture is sent once the chat is done', async (t) => {
  const port = await freePort();
  let busy = true;
  const { watch, ui, fire, laters } = setup(t, { ports: [port], busy: () => busy });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await post(port, `/claude-code/${TOKEN}`, event('PermissionRequest'));
  await tick();
  assert.deepStrictEqual(ui.moods, [], 'held');
  assert.deepStrictEqual(ui.bubbles, ['Claude Code needs you in my-app'], 'the words still go');
  assert.ok(laters.some((timer) => timer.ms === 500), 'it looks again shortly');
  fire();
  assert.deepStrictEqual(ui.moods, [], 'still busy');
  busy = false;
  fire();
  assert.deepStrictEqual(ui.moods, ['wave'], 'the current picture, once');
  fire();
  assert.deepStrictEqual(ui.moods, ['wave']);
});

test('a session quiet for 30 minutes is forgotten by the minute timer', async (t) => {
  const port = await freePort();
  const { watch, ui, laters, fire, tick: advance } = setup(t, { ports: [port] });
  await watch.start();
  assert.ok(laters.some((timer) => timer.ms === 60_000), 'it looks every minute');
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await post(port, `/claude-code/${TOKEN}`, event('PermissionRequest'));
  await tick();
  advance(FORGET_AFTER_MS - 1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave'], 'a wait is not ended by the quiet time');
  advance(1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave'], 'forgotten without an idle: the wave ended by itself');
  assert.ok(laters.some((timer) => timer.ms === 60_000), 'and keeps looking');
  await post(port, `/claude-code/${TOKEN}`, event('PermissionRequest'));
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave', 'wave'], 'the session was forgotten: its next need is new and waves again');
});

test('a working session quiet for 5 minutes goes idle by the minute timer (Esc sends no hook)', async (t) => {
  const port = await freePort();
  const { watch, ui, fire, tick: advance } = setup(t, { ports: [port] });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await tick();
  advance(5 * 60 * 1000 - 1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking']);
  advance(1);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle']);
});

test('stop closes the port, forgets the sessions, and goes idle only if the watcher moved the buddy', async (t) => {
  const port = await freePort();
  const { watch, ui, laters } = setup(t, { ports: [port] });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await tick();
  watch.stop();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle']);
  assert.deepStrictEqual(laters, [], 'no timers left');
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'the port is closed');
  watch.stop();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle'], 'stopped twice is stopped once');
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('Stop'));
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'idle', 'celebrate'], 'started again from no sessions: s1 is new, Stop with nothing working celebrates');
  const quiet = setup(t, { ports: [await freePort()] });
  await quiet.watch.start();
  quiet.watch.stop();
  assert.deepStrictEqual(quiet.ui.moods, [], 'the buddy was never moved: nothing to put back');
});

test('setOn saves the switch; on starts and off stops and removes the hooks; the line says which', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port] });
  assert.deepStrictEqual(watch.status(), { on: false, line: OFF_LINE });
  assert.deepStrictEqual(await watch.setOn(true), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' });
  assert.strictEqual(saved.watchClaudeCode, true);
  assert.strictEqual((await post(port, `/claude-code/${TOKEN}`, event('Stop'))).status, 204);
  assert.deepStrictEqual(await watch.setOn(false), { on: false, line: OFF_LINE });
  assert.strictEqual(saved.watchClaudeCode, false);
  assert.strictEqual(hooks.removes, 1);
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')));
});

test('a settings file Buddy cannot read: on fails with its words and stays off; a launch keeps listening and the line says so', async (t) => {
  const words = "I couldn't read Claude Code's settings file, so I didn't change it.";
  const port = await freePort();
  const bad = setup(t, { ports: [port], hooksError: new BuddyError('claude_settings', words) });
  await assert.rejects(bad.watch.setOn(true), { code: 'claude_settings', message: words });
  assert.strictEqual(bad.saved.watchClaudeCode, false);
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'nothing listens');
  const launched = setup(t, { ports: [await freePort()], stored: { watchClaudeCode: true }, hooksError: new BuddyError('claude_settings', words) });
  const { port: p } = await launched.watch.start();
  assert.strictEqual((await post(p, `/claude-code/${TOKEN}`, event('Stop'))).status, 204, 'hooks put there by hand still work');
  assert.deepStrictEqual(launched.watch.status(), { on: true, line: words });
});

test('the moods it sends are only the ones in MOODS', async (t) => {
  const port = await freePort();
  const { watch, ui } = setup(t, { ports: [port] });
  await watch.start();
  for (const name of ['UserPromptSubmit', 'Notification', 'PreToolUse', 'StopFailure', 'UserPromptSubmit', 'Stop']) {
    await post(port, `/claude-code/${TOKEN}`, event(name));
  }
  await tick();
  for (const mood of ui.moods) assert.ok(Object.values(MOODS).includes(mood), mood);
});

test('the switch turned on while Buddy is off is saved, and nothing listens until Buddy is on', async (t) => {
  const port = await freePort();
  let on = false;
  const { watch, saved, hooks } = setup(t, { ports: [port], active: () => on });
  assert.deepStrictEqual(await watch.setOn(true), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' });
  assert.strictEqual(saved.watchClaudeCode, true);
  assert.deepStrictEqual(hooks.installs, [], 'no hooks and no port while Buddy is off');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/claude-code/${TOKEN}`, { method: 'POST', body: '{}' }));
  on = true;
  assert.deepStrictEqual(await watch.start(), { port });
  assert.deepStrictEqual(hooks.installs, [{ port, token: TOKEN }]);
});

const CANT_WRITE = "I couldn't change Claude Code's settings file, so I didn't turn this on.";
const eacces = () => Object.assign(new Error('EACCES: permission denied'), { code: 'EACCES' });

test('a hooks write that fails for any reason: on fails in plain words, nothing listens, and the next on really installs', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port, port] });
  hooks.fail = eacces();
  await assert.rejects(watch.setOn(true), { name: 'BuddyError', code: 'claude_settings', message: CANT_WRITE });
  assert.strictEqual(saved.watchClaudeCode, false);
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'the server was closed');
  await assert.rejects(watch.setOn(true), { message: CANT_WRITE }, 'still failing: not "Watching."');
  assert.strictEqual(saved.watchClaudeCode, false);
  hooks.fail = null;
  assert.deepStrictEqual(await watch.setOn(true), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' });
  assert.deepStrictEqual(hooks.installs, [{ port, token: TOKEN }]);
  assert.strictEqual((await post(port, `/claude-code/${TOKEN}`, event('Stop'))).status, 204);
});

test('start with the server already up puts the hooks in again when the last try failed', async (t) => {
  const port = await freePort();
  const { watch, hooks } = setup(t, { ports: [port], stored: { watchClaudeCode: true } });
  hooks.fail = eacces();
  assert.deepStrictEqual(await watch.start(), { port }, 'a launch keeps listening');
  assert.deepStrictEqual(watch.status(), { on: true, line: CANT_WRITE });
  hooks.fail = null;
  assert.deepStrictEqual(await watch.start(), { port });
  assert.deepStrictEqual(hooks.installs, [{ port, token: TOKEN }], 'tried again');
  assert.deepStrictEqual(watch.status(), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' });
  await watch.start();
  assert.strictEqual(hooks.installs.length, 1, 'not again once it worked');
  const p2 = await freePort();
  const launched = setup(t, { ports: [p2], stored: { watchClaudeCode: true } });
  launched.hooks.fail = eacces();
  await launched.watch.start();
  launched.hooks.fail = null;
  assert.deepStrictEqual(await launched.watch.setOn(true), { on: true, line: 'Watching. Hooks are in ~/.claude/settings.json.' }, 'on from Settings after a failed launch');
  assert.strictEqual(launched.hooks.installs.length, 1);
});

test('on and off flipped together: the second waits for the first, and it ends off with no port and no hooks', async (t) => {
  const port = await freePort();
  const { watch, saved, hooks } = setup(t, { ports: [port] });
  const [on, off] = await Promise.all([watch.setOn(true), watch.setOn(false)]);
  assert.strictEqual(on.on, true);
  assert.deepStrictEqual(off, { on: false, line: OFF_LINE });
  assert.strictEqual(saved.watchClaudeCode, false);
  assert.strictEqual(hooks.installs.length, 1);
  assert.strictEqual(hooks.removes, 1, 'removed after they were put in');
  await assert.rejects(post(port, `/claude-code/${TOKEN}`, event('Stop')), 'nothing listens');
  hooks.fail = eacces();
  const results = await Promise.allSettled([watch.setOn(true), watch.setOn(false)]);
  assert.strictEqual(results[0].status, 'rejected', 'a failed on');
  assert.strictEqual(results[1].status, 'fulfilled', 'the off after a failed on still runs');
  assert.strictEqual(saved.watchClaudeCode, false);
});

test('idle is sent only to end a mood that stays (thinking, sleepy): a wave or a happy ends by itself, and a dozing buddy is not woken', async (t) => {
  const port = await freePort();
  const { watch, ui, fire, tick: advance } = setup(t, { ports: [port] });
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('UserPromptSubmit'));
  await post(port, `/claude-code/${TOKEN}`, event('PermissionRequest'));
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave']);
  advance(FORGET_AFTER_MS);
  fire();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave'], 'the wait is forgotten without a mood: the wave ended long ago');
  watch.stop();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave'], 'stop does not wake it either');
  await watch.start();
  await post(port, `/claude-code/${TOKEN}`, event('Stop'));
  await post(port, `/claude-code/${TOKEN}`, event('SessionEnd'));
  await tick();
  assert.deepStrictEqual(ui.moods, ['thinking', 'wave', 'celebrate'], 'no idle after celebrate');
});
