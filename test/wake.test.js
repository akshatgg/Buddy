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

function setup(t, { name = 'Rahul', wakeOn = true, mic = 'granted', modelReady = true, missing = [], locked = false, signedIn = true, ensure = () => Promise.resolve(), voiceResult = {}, myVoice = null } = {}) {
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
  const mv = myVoice;
  const said = [];
  const wake = createWake({
    store, ear, model, lock,
    myVoice: mv ? { on: () => mv.on, allows: async (p) => mv.allow(p), warm: () => log.push(['warm']) } : null,
    microphone: { status: () => state.mic },
    power: { isOn: () => state.buddyOn },
    account: { isSignedIn: () => state.signedIn },
    cloud: { last: () => ({ voiceOn: true, blocked: false }) },
    powerMonitor, actions, talkBack: { say: async (line) => { said.push(line); log.push(['say', line]); } },
    busy: () => state.busy,
    onChange: (st) => changes.push(st),
    testMs: 10000,
  });
  const last = (kind) => log.filter((l) => l[0] === kind).at(-1);
  return { wake, log, handlers, powerMonitor, state, data, last, actions, changes, talk: { said } };
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

// ---- Only my voice ----

test('only my voice: someone else gets silence, and nothing is written down', async (t) => {
  const { handlers, log, actions, talk } = setup(t, { myVoice: { on: true, allow: () => false } });
  let transcribed = 0;
  actions.transcribe = async () => { transcribed += 1; return { text: 'call mom' }; };
  await handlers.request({ audio: 'UklGRg==', phrase: 'AAAA' });
  assert.strictEqual(transcribed, 0);
  assert.ok(!log.some(([k]) => k === 'voice'));
  assert.strictEqual(talk.said.length, 0, 'not even the busy line');
});

test('only my voice: the refusal comes before the busy line', async (t) => {
  const s = setup(t, { myVoice: { on: true, allow: () => false } });
  s.state.busy = true;
  await s.handlers.request({ audio: 'UklGRg==', phrase: 'AAAA' });
  assert.strictEqual(s.talk.said.length, 0);
});

test('only my voice: the owner goes through as before, and the check sees the phrase', async (t) => {
  const seen = [];
  const { handlers, log } = setup(t, { myVoice: { on: true, allow: (p) => { seen.push(p); return true; } } });
  await handlers.request({ audio: 'UklGRg==', phrase: 'AAAA' });
  assert.deepStrictEqual(seen, ['AAAA']);
  assert.ok(log.some(([k, w]) => k === 'voice' && w === 'call mom'));
});

test('only my voice off: no check at all', async (t) => {
  let asked = 0;
  const { handlers, log } = setup(t, { myVoice: { on: false, allow: () => { asked += 1; return false; } } });
  await handlers.request({ audio: 'UklGRg==', phrase: null });
  assert.strictEqual(asked, 0);
  assert.ok(log.some(([k]) => k === 'voice'));
});

test('only my voice on: the check process is warmed when the loop starts listening', (t) => {
  const s = setup(t, { myVoice: { on: true, allow: () => true } });
  s.wake.refresh();
  assert.strictEqual(s.log.filter(([k]) => k === 'warm').length, 1);
});

test('clips: the ear listens for the one phrase in test mode and hands each clip over', async (t) => {
  const { wake, handlers, log } = setup(t, {});
  const got = [];
  const stop = wake.clips('hey rahul', (p) => got.push(p));
  assert.deepStrictEqual(log.filter(([k]) => k === 'wake').pop()[1].phrases, ['hey rahul']);
  assert.strictEqual(log.filter(([k]) => k === 'wake').pop()[1].testOnly, true);
  handlers.woke({ phrase: 'AAAA' });
  assert.deepStrictEqual(got, ['AAAA']);
  stop();
  assert.deepStrictEqual(log.filter(([k]) => k === 'wake').pop()[1].phrases, RAHUL);
  assert.strictEqual(log.filter(([k]) => k === 'wake').pop()[1].testOnly, false);
});

test('clips: Test it answers 0 at once, a request is ignored, and a wake is not counted as a test', async (t) => {
  const s = setup(t, {});
  const stop = s.wake.clips('hey rahul', () => {});
  assert.strictEqual(await s.wake.test(), 0);
  await s.handlers.request({ audio: 'AAAA', phrase: 'AAAA' });
  assert.strictEqual(s.log.filter(([k]) => k === 'voice').length, 0);
  assert.deepStrictEqual(s.talk.said, []);
  stop();
});

test('test it with only my voice on: an allowed wake counts, a refused one is "not you"', async (t) => {
  const s = setup(t, { myVoice: { on: true, allow: (p) => p === 'ME' } });
  s.wake.refresh();
  const heard = [];
  let notYou = 0;
  const p = s.wake.test((n) => heard.push(n), () => { notYou += 1; });
  await s.handlers.woke({ phrase: 'ME' });
  await s.handlers.woke({ phrase: 'THEM' });
  await s.handlers.woke({ phrase: null });
  t.mock.timers.tick(10000);
  assert.strictEqual(await p, 1);
  assert.deepStrictEqual(heard, [1]);
  assert.strictEqual(notYou, 2);
});

test('test it with only my voice on: a refusal that comes after the test ended is not reported', async (t) => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const s = setup(t, { myVoice: { on: true, allow: () => gate.then(() => false) } });
  s.wake.refresh();
  let notYou = 0;
  const p = s.wake.test(() => {}, () => { notYou += 1; });
  const woke = s.handlers.woke({ phrase: 'X' });
  t.mock.timers.tick(10000);
  await p;
  release();
  await woke;
  assert.strictEqual(notYou, 0);
});
