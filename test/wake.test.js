'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createWake, shouldListen, shownName } = require('../src/main/wake');
const { WAKE_LINES, WAKE_FLOOR, REQUEST } = require('../shared/voice-words');

const RAHUL = ['hey rahul', 'hey buddy'];
const ALL = {
  wakeOn: true, buddyOn: true, signedIn: true, voiceOn: true, mic: 'granted', modelReady: true,
  locked: false, asleep: false, panelListening: false, turn: false,
};

test('shouldListen: only when every rule holds', () => {
  assert.strictEqual(shouldListen(ALL), true);
  for (const [key, bad] of Object.entries({
    wakeOn: false, buddyOn: false, signedIn: false, voiceOn: false, mic: 'denied', modelReady: false,
    locked: true, asleep: true, panelListening: true, turn: true,
  })) assert.strictEqual(shouldListen({ ...ALL, [key]: bad }), false, key);
  assert.strictEqual(shouldListen({ ...ALL, mic: 'not-determined' }), false);
});

function setup(t, { name = 'Rahul', wakeOn = true, mic = 'granted', modelReady = true, missing = [], locked = false, signedIn = true, ensure = () => Promise.resolve(), voiceResult = {} } = {}) {
  if (!t.mock.timers._on) { t.mock.timers.enable({ apis: ['setTimeout'] }); t.mock.timers._on = true; }
  const data = { buddyName: name, wakeOn };
  const store = { get: (k) => data[k], set: (p) => Object.assign(data, p) };
  const log = [];
  const handlers = {};
  const ear = {
    keep: (on) => log.push(['keep', on]),
    wake: (args) => log.push(['wake', args]),
    close: () => log.push(['close']),
    on: (event, fn) => { handlers[event] = fn; },
  };
  const state = { mic, locked, signedIn, buddyOn: true, busy: false, asleepNow: false };
  const changes = [];
  const powerMonitor = new EventEmitter();
  const actions = { transcribe: async () => ({ text: 'call mom' }), voice: async (words) => { log.push(['voice', words]); return voiceResult; } };
  const model = { ready: () => modelReady, missing: () => new Set(missing), ensure };
  const lock = { locked: () => state.locked };
  const wake = createWake({
    store, ear, model, lock,
    microphone: { status: () => state.mic },
    power: { isOn: () => state.buddyOn },
    account: { isSignedIn: () => state.signedIn },
    cloud: { last: () => ({ voiceOn: true, blocked: false }) },
    powerMonitor, actions, talkBack: { say: async (line) => { log.push(['say', line]); } },
    busy: () => state.busy,
    onChange: (st) => changes.push(st),
    testMs: 10000,
  });
  const last = (kind) => log.filter((l) => l[0] === kind).at(-1);
  return { wake, log, handlers, powerMonitor, state, data, last, actions, changes };
}

test('refresh starts the loop with the phrase and keeps the ear window; switched off it stops and lets go', (t) => {
  const s = setup(t);
  s.wake.refresh();
  assert.deepStrictEqual(s.last('wake'), ['wake', { phrases: RAHUL, floor: WAKE_FLOOR, request: REQUEST, testOnly: false }]);
  assert.deepStrictEqual(s.last('keep'), ['keep', true]);
  s.data.wakeOn = false;
  s.wake.refresh();
  assert.deepStrictEqual(s.last('wake'), ['wake', null]);
  assert.deepStrictEqual(s.last('keep'), ['keep', false]);
});

test('off by default: nothing starts', (t) => {
  const s = setup(t, { wakeOn: null });
  s.wake.refresh();
  assert.strictEqual(s.last('wake'), undefined);
  assert.deepStrictEqual(s.wake.state().on, false);
});

test('a rename sends a new wake with the new phrase', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.data.buddyName = 'Anaya';
  s.wake.refresh();
  assert.strictEqual(s.last('wake')[1].phrases[0], 'hey anaya');
});

test('lock-screen and suspend stop the loop; unlock-screen and resume start it again', (t) => {
  const s = setup(t);
  s.wake.refresh();
  for (const [off, on] of [['lock-screen', 'unlock-screen'], ['suspend', 'resume']]) {
    s.powerMonitor.emit(off);
    assert.strictEqual(s.last('wake')[1], null, off);
    s.powerMonitor.emit(on);
    assert.strictEqual(s.last('wake')[1].phrases[0], 'hey rahul', on);
  }
});

test('the panel listening pauses it; done, it resumes', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.wake.panelListening(true);
  assert.strictEqual(s.last('wake')[1], null);
  s.wake.panelListening(false);
  assert.strictEqual(s.last('wake')[1].phrases[0], 'hey rahul');
});

test('a turn running pauses it until the turn ends', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.wake.turn(true);
  assert.strictEqual(s.last('wake')[1], null);
  s.wake.turn(false);
  assert.strictEqual(s.last('wake')[1].phrases[0], 'hey rahul');
});

test('a name the model lacks still listens, for the Buddy phrases, with a hint', (t) => {
  const s = setup(t, { name: 'Aarav', missing: ['aarav'] });
  s.wake.refresh();
  assert.deepStrictEqual(s.last('wake')[1].phrases, ['hey buddy']);
  assert.deepStrictEqual(s.last('keep'), ['keep', true]);
  assert.deepStrictEqual(s.wake.state(), { on: true, line: WAKE_LINES.listening('Aarav', false), hint: WAKE_LINES.cantListen('Aarav') });
});

test('a name the model hears: no hint; the name Buddy: no hint either', (t) => {
  const a = setup(t);
  a.wake.refresh();
  assert.strictEqual(a.wake.state().hint, undefined);
  const b = setup(t, { name: 'Buddy' });
  b.wake.refresh();
  assert.deepStrictEqual(b.last('wake')[1].phrases, ['hey buddy']);
  assert.deepStrictEqual(b.wake.state(), { on: true, line: WAKE_LINES.listening('Buddy', false) });
});

test('signed out, or the microphone refused: a line, nothing listens', (t) => {
  const a = setup(t, { signedIn: false });
  a.wake.refresh();
  assert.strictEqual(a.wake.state().line, WAKE_LINES.signIn);
  assert.strictEqual(a.last('wake'), undefined);
  const b = setup(t, { mic: 'denied' });
  b.wake.refresh();
  assert.strictEqual(b.wake.state().line, 'Allow the microphone in Settings.');
});

test('listening: the state says so', (t) => {
  const s = setup(t);
  s.wake.refresh();
  assert.deepStrictEqual(s.wake.state(), { on: true, line: WAKE_LINES.listening('Rahul', true) });
});

test('a request with words calls actions.voice once; an empty one stays silent', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'voice'), [['voice', 'call mom']]);
  s.actions.transcribe = async () => ({ text: '  ' });
  await s.handlers.request({ audio: 'AAAA' });
  await s.handlers.request({ audio: null });
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 1);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'say'), []);
});

test('no internet while writing it down: the internet line, and nothing is sent', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.actions.transcribe = async () => { const e = new Error('x'); e.code = 'network'; throw e; };
  await s.handlers.request({ audio: 'AAAA' });
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 0);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'say').map((l) => l[1]), ["I can't reach the internet right now."]);
});

test('a wake heard while off does nothing', async (t) => {
  const s = setup(t, { wakeOn: false });
  await s.handlers.request({ audio: 'AAAA' });
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 0);
});

test('test() counts the wakes heard in 10 s, then goes back to the normal loop', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  const p = s.wake.test();
  assert.deepStrictEqual(s.last('wake')[1], { phrases: RAHUL, floor: WAKE_FLOOR, request: REQUEST, testOnly: true });
  s.handlers.woke();
  s.handlers.woke();
  s.handlers.request({ audio: 'AAAA' }); // never acted on in a test
  t.mock.timers.tick(10000);
  assert.strictEqual(await p, 2);
  assert.strictEqual(s.last('wake')[1].testOnly, false);
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 0);
});

test('test(onHeard) tells each wake as it is heard', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  const heard = [];
  const p = s.wake.test((n) => heard.push(n));
  s.handlers.woke();
  s.handlers.woke();
  t.mock.timers.tick(10000);
  await p;
  assert.deepStrictEqual(heard, [1, 2]);
});

const BUSY_LINE = "I'm still on the last one. Ask me again in a moment.";
const says = (s) => s.log.filter((l) => l[0] === 'say').map((l) => l[1]);

test('busy chat: a request is not transcribed and not dropped silently, Buddy says so', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  let transcribed = 0;
  s.actions.transcribe = async () => { transcribed += 1; return { text: 'call mom' }; };
  s.state.busy = true;
  await s.handlers.request({ audio: 'AAAA' });
  assert.strictEqual(transcribed, 0);
  assert.deepStrictEqual(says(s), [BUSY_LINE]);
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 0);
});

test('a spoken turn running: a request gets the busy line too', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.wake.turn(true);
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(says(s), [BUSY_LINE]);
});

test('the chat got busy while the words were written down: the busy line, not silence', async (t) => {
  const s = setup(t, { voiceResult: { busy: true } });
  s.wake.refresh();
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(says(s), [BUSY_LINE]);
});

test('a failed model download: the switch goes off, the ears-failed line shows, toggling retries', async (t) => {
  let fail = true;
  const s = setup(t, { modelReady: false, ensure: () => (fail ? Promise.reject(new Error('x')) : Promise.resolve()) });
  s.wake.refresh();
  await new Promise((r) => setImmediate(r));
  assert.strictEqual(s.data.wakeOn, false);
  assert.deepStrictEqual(s.wake.state(), { on: false, line: WAKE_LINES.earsFailed });
  assert.ok(s.changes.length > 0, 'Settings is told');
  // retry: the person turns it on again
  fail = false;
  s.data.wakeOn = true;
  s.wake.refresh();
  assert.strictEqual(s.wake.state().line, WAKE_LINES.gettingEars);
});

test('download progress and finish are pushed to Settings', async (t) => {
  let report;
  let done;
  const s = setup(t, {
    modelReady: false,
    ensure: ({ onProgress } = {}) => { report = onProgress; return new Promise((r) => { done = r; }); },
  });
  s.wake.refresh();
  report(40);
  assert.strictEqual(s.changes.at(-1).percent, 40);
  assert.strictEqual(s.wake.state().percent, 40);
  const before = s.changes.length;
  done();
  await new Promise((r) => setImmediate(r));
  assert.ok(s.changes.length > before);
});

test('asleep with the switch on: the ear window is kept (no 37 MB re-send on waking)', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.powerMonitor.emit('suspend');
  assert.deepStrictEqual(s.last('keep'), ['keep', true]);
  assert.strictEqual(s.log.some((l) => l[0] === 'close'), false);
  assert.strictEqual(s.last('wake')[1], null);
  s.powerMonitor.emit('resume');
  assert.strictEqual(s.last('wake')[1].phrases[0], 'hey rahul');
});

test('shownName: three words at most, the same as are listened for', () => {
  assert.strictEqual(shownName('Rahul'), 'Rahul');
  assert.strictEqual(shownName('Mary Anne Smith'), 'Mary Anne Smith');
  assert.strictEqual(shownName('Sir Reginald Of Wessex'), 'Sir Reginald Of');
  assert.strictEqual(shownName('Mary-Anne Smith Jones'), 'Mary Anne Smith');
});
