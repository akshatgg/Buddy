'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { createTerminal, oneLine, SCRIPT, NO_TERMINAL, NOT_ALLOWED, ONLY_MAC } = require('../src/main/claude/terminal');
const { createClaudeMode, GONE } = require('../src/main/claude/mode');

// ---- terminal.js: typing into the terminal ----

/** execFile as osascript answers: `out` is what the script prints, `fail` an error with stderr. */
function fakeRun({ out = 'iterm', fail = null } = {}) {
  const calls = [];
  const run = (file, args, options, done) => {
    calls.push({ file, args, options });
    if (fail) done(Object.assign(new Error('failed'), { code: 1 }), '', fail);
    else done(null, `${out}\n`, '');
  };
  return { run, calls };
}

test('the text goes to osascript as an argument, with the tty, never inside the script', async () => {
  const f = fakeRun();
  const r = await createTerminal({ platform: 'darwin', run: f.run }).type({ tty: 'ttys003', text: 'fix it"; do shell script "rm -rf ~' });
  assert.deepStrictEqual(r, { app: 'iterm' });
  assert.strictEqual(f.calls[0].file, '/usr/bin/osascript');
  assert.deepStrictEqual(f.calls[0].args, ['-e', SCRIPT, '/dev/ttys003', 'fix it"; do shell script "rm -rf ~']);
  assert.ok(!SCRIPT.includes('ttys003'));
});

test('line breaks become spaces, so that Enter is pressed once, at the end', () => {
  assert.strictEqual(oneLine('  first\nsecond\r\n\tthird  '), 'first second third');
});

test('where Buddy cannot type, it says so in words that tell the person what to do', async () => {
  const type = (opts, args) => createTerminal(opts).type(args);
  await assert.rejects(type({ platform: 'darwin', run: fakeRun({ out: 'none' }).run }, { tty: 'ttys003', text: 'hi' }), { code: 'no_terminal', message: NO_TERMINAL });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun({ fail: 'execution error: Not authorized to send Apple events to iTerm2. (-1743)' }).run }, { tty: 'ttys003', text: 'hi' }),
    { code: 'not_allowed', message: NOT_ALLOWED });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun({ fail: 'syntax error' }).run }, { tty: 'ttys003', text: 'hi' }), { code: 'no_terminal' });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun().run }, { tty: null, text: 'hi' }), { code: 'no_terminal' });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun().run }, { tty: '../../dev/x', text: 'hi' }), { code: 'no_terminal' });
  await assert.rejects(type({ platform: 'win32', run: fakeRun().run }, { tty: 'ttys003', text: 'hi' }), { code: 'no_terminal', message: ONLY_MAC });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun().run }, { tty: 'ttys003', text: ' \n ' }), { code: 'bad_request' });
  await assert.rejects(type({ platform: 'darwin', run: fakeRun().run }, { tty: 'ttys003', text: 'x'.repeat(4001) }), { code: 'bad_request' });
});

// ---- mode.js: the panel's Claude mode ----

function fakeLive() {
  const listeners = [];
  const views = { a: { id: 'a', name: 'shop', status: 'working', canTalk: true, items: [] } };
  const calls = [];
  return {
    calls,
    views,
    emit: (id) => listeners.forEach((fn) => fn(id)),
    onChange: (fn) => listeners.push(fn),
    discover: async () => calls.push('discover'),
    list: () => Object.values(views).map((v) => ({ id: v.id, name: v.name, status: v.status, canTalk: v.canTalk })),
    refresh: async (id) => calls.push(['refresh', id]),
    view: (id) => views[id] ?? null,
    target: (id) => (views[id] ? { tty: 'ttys001', name: views[id].name } : null),
  };
}

function setup({ typeFails = null, remote = null } = {}) {
  const live = fakeLive();
  const sent = [];
  const typed = [];
  const copied = [];
  const timers = [];
  const mode = createClaudeMode({
    live,
    terminal: {
      async type(args) {
        typed.push(args);
        if (typeFails) throw typeFails;
        return { app: 'iterm' };
      },
    },
    clipboard: { writeText: async (text) => copied.push(text) },
    send: (view) => sent.push(view),
    remote,
    every: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; },
    stopEvery: (t) => { t.on = false; },
  });
  return { live, mode, sent, typed, copied, timers };
}

test('the page lists the sessions, opens one, and is sent its changes while it is open', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.mode.sessions(), { sessions: [{ id: 'a', name: 'shop', status: 'working', canTalk: true, remote: false }] });
  assert.deepStrictEqual(s.live.calls, ['discover']);
  assert.deepStrictEqual(await s.mode.open('a'), { session: s.live.views.a });
  assert.deepStrictEqual(s.live.calls.slice(1), [['refresh', 'a']]);
  assert.strictEqual(s.timers.length, 1);
  assert.strictEqual(s.timers[0].ms, 1000, 'read again every second');
  s.timers[0].fn();
  assert.deepStrictEqual(s.live.calls.slice(2), [['refresh', 'a']]);

  s.live.emit('a');
  s.live.emit('b'); // another session: not shown
  assert.deepStrictEqual(s.sent, [s.live.views.a]);

  s.mode.close();
  assert.strictEqual(s.timers[0].on, false, 'closed: the reading stops');
  s.live.emit('a');
  assert.strictEqual(s.sent.length, 1, 'and nothing more is sent');
});

test('a session that is gone cannot be opened or talked to', async () => {
  const s = setup();
  await assert.rejects(s.mode.open('zzz'), { code: 'bad_request', message: GONE });
  await assert.rejects(s.mode.open(7), { code: 'bad_request' });
  await assert.rejects(s.mode.talk('zzz', 'hi'), { code: 'bad_request', message: GONE });
});

test("what the person sends is typed into the session's terminal", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.mode.talk('a', 'run the tests'), { typed: true });
  assert.deepStrictEqual(s.typed, [{ tty: 'ttys001', text: 'run the tests' }]);
  assert.deepStrictEqual(s.copied, []);
});

test('where Buddy cannot type into the terminal, the words are copied and the answer says what to do', async () => {
  const s = setup({ typeFails: new BuddyError('no_terminal', NO_TERMINAL) });
  assert.deepStrictEqual(await s.mode.talk('a', 'run the tests'), { typed: false, message: NO_TERMINAL });
  assert.deepStrictEqual(s.copied, ['run the tests']);
  const empty = setup({ typeFails: new BuddyError('bad_request', 'Type something first.') });
  await assert.rejects(empty.mode.talk('a', ''), { code: 'bad_request' });
  assert.deepStrictEqual(empty.copied, [], 'nothing to copy');
});

// ---- sessions on the person's other computers ----

const PC_SESSION = { id: 'r1', name: 'api', status: 'waiting', canTalk: true, device: 'Office PC' };
/** The server as the remote calls see it: `answers` for look, in order (an Error is thrown). */
function fakeRemote({ answers = [], signedIn = true } = {}) {
  const calls = [];
  return {
    calls,
    available: () => signedIn,
    async look(id) {
      calls.push(['look', id]);
      const next = answers.length > 1 ? answers.shift() : answers[0];
      if (next instanceof Error) throw next;
      return next;
    },
    async send(id, text) { calls.push(['send', id, text]); },
    async stop() { calls.push(['stop']); },
  };
}

test("the list has this computer's sessions, then the other computers' ones with their names", async () => {
  const remote = fakeRemote({ answers: [{ online: true, sessions: [PC_SESSION], feed: null }] });
  const s = setup({ remote });
  const { sessions } = await s.mode.sessions();
  assert.deepStrictEqual(sessions.map((x) => [x.id, x.remote, x.device]), [['a', false, undefined], ['r1', true, 'Office PC']]);
  assert.deepStrictEqual(remote.calls, [['look', null]]);
  const out = setup({ remote: fakeRemote({ signedIn: false }) });
  assert.deepStrictEqual((await out.mode.sessions()).sessions.map((x) => x.id), ['a'], 'signed out: only this computer');
});

test('the server out of reach: the list still has this computer\'s sessions', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({ remote: fakeRemote({ answers: [new BuddyError('network', 'offline')] }) });
  assert.deepStrictEqual((await s.mode.sessions()).sessions.map((x) => x.id), ['a']);
});

test("another computer's session: waiting until its items come, then looked at every 1.5 s; words go to it", async () => {
  const items = [{ id: 1, kind: 'claude', text: 'Hi' }];
  const remote = fakeRemote({ answers: [
    { online: true, sessions: [PC_SESSION], feed: null },
    { online: true, sessions: [PC_SESSION], feed: { ...PC_SESSION, items } },
  ] });
  const s = setup({ remote });
  const { session } = await s.mode.open('r1');
  assert.deepStrictEqual(session, { id: 'r1', name: 'api', title: null, status: 'waiting', canTalk: true, device: 'Office PC', remote: true, waiting: true, items: [] });
  assert.strictEqual(s.timers[0].ms, 1500);
  s.timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(s.sent.at(-1).items, items);
  assert.strictEqual(s.sent.at(-1).waiting, false);

  assert.deepStrictEqual(await s.mode.talk('r1', 'go on'), { typed: true, remote: true });
  assert.deepStrictEqual(remote.calls.at(-1), ['send', 'r1', 'go on']);
  assert.deepStrictEqual(s.typed, [], 'nothing typed on this computer');

  s.mode.close();
  assert.deepStrictEqual(remote.calls.at(-1), ['stop'], 'the server is told the watching stopped');
  assert.strictEqual(s.timers[0].on, false);
});

test("another computer's session that ends: the page is told, with why, and the looking stops", async () => {
  const remote = fakeRemote({ answers: [
    { online: true, sessions: [PC_SESSION], feed: null },
    new BuddyError('not_found', GONE),
  ] });
  const s = setup({ remote });
  await s.mode.open('r1');
  s.timers[0].fn();
  await new Promise((r) => setImmediate(r));
  assert.deepStrictEqual(s.sent.at(-1), { id: 'r1', gone: true, message: GONE });
  assert.strictEqual(s.timers[0].on, false);
  await assert.rejects(s.mode.open('zzz'), { code: 'not_found' }, 'not in the list: gone');
});
