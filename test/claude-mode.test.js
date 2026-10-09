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

function setup({ typeFails = null } = {}) {
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
    every: (fn, ms) => { const t = { fn, ms, on: true }; timers.push(t); return t; },
    stopEvery: (t) => { t.on = false; },
  });
  return { live, mode, sent, typed, copied, timers };
}

test('the page lists the sessions, opens one, and is sent its changes while it is open', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.mode.sessions(), { sessions: [{ id: 'a', name: 'shop', status: 'working', canTalk: true }] });
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
