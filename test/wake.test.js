'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createWake, shouldListen } = require('../src/main/wake');
const { WAKE_LINES, WAKE_FLOOR, REQUEST } = require('../shared/voice-words');

const ALL = {
  wakeOn: true, buddyOn: true, signedIn: true, voiceOn: true, mic: 'granted', modelReady: true, nameOk: true,
  locked: false, asleep: false, panelListening: false, turn: false,
};

test('shouldListen: only when every rule holds', () => {
  assert.strictEqual(shouldListen(ALL), true);
  for (const [key, bad] of Object.entries({
    wakeOn: false, buddyOn: false, signedIn: false, voiceOn: false, mic: 'denied', modelReady: false, nameOk: false,
    locked: true, asleep: true, panelListening: true, turn: true,
  })) assert.strictEqual(shouldListen({ ...ALL, [key]: bad }), false, key);
  assert.strictEqual(shouldListen({ ...ALL, mic: 'not-determined' }), false);
});

function setup(t, { name = 'Rahul', wakeOn = true, mic = 'granted', modelReady = true, missing = [], locked = false, signedIn = true } = {}) {
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
  const state = { mic, locked, signedIn, buddyOn: true };
  const powerMonitor = new EventEmitter();
  const actions = { transcribe: async () => ({ text: 'call mom' }), voice: async (words) => { log.push(['voice', words]); } };
  const model = { ready: () => modelReady, missing: () => new Set(missing), ensure: () => Promise.resolve() };
  const lock = { locked: () => state.locked };
  const wake = createWake({
    store, ear, model, lock,
    microphone: { status: () => state.mic },
    power: { isOn: () => state.buddyOn },
    account: { isSignedIn: () => state.signedIn },
    cloud: { last: () => ({ voiceOn: true, blocked: false }) },
    powerMonitor, actions, talkBack: { say: async (line) => { log.push(['say', line]); } },
    testMs: 10000,
  });
  const last = (kind) => log.filter((l) => l[0] === kind).at(-1);
  return { wake, log, handlers, powerMonitor, state, data, last, actions };
}

test('refresh starts the loop with the phrase and keeps the ear window; switched off it stops and lets go', (t) => {
  const s = setup(t);
  s.wake.refresh();
  assert.deepStrictEqual(s.last('wake'), ['wake', { phrase: 'hey rahul', floor: WAKE_FLOOR, request: REQUEST, testOnly: false }]);
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
  assert.strictEqual(s.last('wake')[1].phrase, 'hey anaya');
});

test('lock-screen and suspend stop the loop; unlock-screen and resume start it again', (t) => {
  const s = setup(t);
  s.wake.refresh();
  for (const [off, on] of [['lock-screen', 'unlock-screen'], ['suspend', 'resume']]) {
    s.powerMonitor.emit(off);
    assert.strictEqual(s.last('wake')[1], null, off);
    s.powerMonitor.emit(on);
    assert.strictEqual(s.last('wake')[1].phrase, 'hey rahul', on);
  }
});

test('the panel listening pauses it; done, it resumes', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.wake.panelListening(true);
  assert.strictEqual(s.last('wake')[1], null);
  s.wake.panelListening(false);
  assert.strictEqual(s.last('wake')[1].phrase, 'hey rahul');
});

test('a turn running pauses it until the turn ends', (t) => {
  const s = setup(t);
  s.wake.refresh();
  s.wake.turn(true);
  assert.strictEqual(s.last('wake')[1], null);
  s.wake.turn(false);
  assert.strictEqual(s.last('wake')[1].phrase, 'hey rahul');
});

test('a name the model lacks: the can\'t listen line, and nothing listens', (t) => {
  const s = setup(t, { name: 'Aarav', missing: ['aarav'] });
  s.wake.refresh();
  assert.strictEqual(s.last('wake'), undefined);
  assert.deepStrictEqual(s.wake.state(), { on: false, line: WAKE_LINES.cantListen('Aarav') });
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
  assert.deepStrictEqual(s.wake.state(), { on: true, line: WAKE_LINES.listening('Rahul') });
});

test('a request with words calls actions.voice once; an empty one says the not-caught line', async (t) => {
  const s = setup(t);
  s.wake.refresh();
  await s.handlers.request({ audio: 'AAAA' });
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'voice'), [['voice', 'call mom']]);
  s.actions.transcribe = async () => ({ text: '  ' });
  await s.handlers.request({ audio: 'AAAA' });
  await s.handlers.request({ audio: null });
  assert.strictEqual(s.log.filter((l) => l[0] === 'voice').length, 1);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'say').map((l) => l[1]), [WAKE_LINES.notCaught('Rahul'), WAKE_LINES.notCaught('Rahul')]);
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
  assert.deepStrictEqual(s.last('wake')[1], { phrase: 'hey rahul', floor: WAKE_FLOOR, request: REQUEST, testOnly: true });
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
