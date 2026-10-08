'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createFeelings, buddyLevel, NORMAL_VOICE, LISTEN_END_MS } = require('../src/main/feelings');
const { createSleep, DROWSY_MS, ASLEEP_MS } = require('../src/main/sleep');

/**
 * Fake timers: nothing runs until `advance` says that much time has gone by. Then each timer that comes due runs at its
 * time, the earliest first, and so do the timers set meanwhile.
 */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map(); // id → { at, fn }
  return {
    later(fn, ms) {
      timers.set(nextId, { at: now + ms, fn });
      return nextId++;
    },
    cancelLater(id) {
      timers.delete(id);
    },
    advance(ms) {
      const end = now + ms;
      for (;;) {
        const due = [...timers].filter(([, timer]) => timer.at <= end).sort(([a, x], [b, y]) => x.at - y.at || a - b)[0];
        if (!due) break;
        const [id, timer] = due;
        timers.delete(id);
        now = timer.at;
        timer.fn();
      }
      now = end;
    },
  };
}

/**
 * The feelings with a fake buddy window and a fake sleep countdown, which both write to one log, in order. `busy` is
 * whether Buddy is still waiting for the answer to a message (a test can change it on `state`).
 */
function setup({ busy = false } = {}) {
  const log = [];
  const clock = fakeClock();
  const state = { busy };
  const buddy = {
    mood: (name) => log.push(['mood', name]),
    panelOpen: (open) => log.push(['panelOpen', open]),
    micOn: (on) => log.push(['micOn', on]),
    voiceLevel: (level) => log.push(['voiceLevel', level]),
  };
  const sleep = {
    poke: () => log.push(['poke']),
    hold: (reason, on) => log.push(['hold', reason, on]),
  };
  const feelings = createFeelings({ buddy, sleep, busy: () => state.busy, later: clock.later, cancelLater: clock.cancelLater });
  return { feelings, log, clock, state };
}

/**
 * The feelings with the real sleep countdown (sleep.js), both on one fake clock, wired as main wires them: the
 * countdown's own moods go straight to the buddy. `moods` is every mood the buddy was sent, in order. `busy` is as in
 * setup().
 */
function withSleep({ busy = false } = {}) {
  const clock = fakeClock();
  const moods = [];
  const buddy = { mood: (name) => moods.push(name), panelOpen() {}, micOn() {}, voiceLevel() {} };
  const sleep = createSleep({ onMood: (name) => buddy.mood(name), later: clock.later, cancelLater: clock.cancelLater });
  const feelings = createFeelings({ buddy, sleep, busy: () => busy, later: clock.later, cancelLater: clock.cancelLater });
  return { feelings, sleep, clock, moods };
}

const moodsIn = (log) => log.filter((e) => e[0] === 'mood').map((e) => e[1]);
/** The moods the buddy was sent and what it was told about the microphone, in order: 'listening', 'mic on', … */
const shown = (log) => log.filter((e) => e[0] === 'mood' || e[0] === 'micOn').map((e) => (e[0] === 'mood' ? e[1] : `mic ${e[1] ? 'on' : 'off'}`));

// Moods from the app

test('every mood the app sends is a use: the sleep countdown hears it first, held while Buddy thinks, then the buddy', () => {
  const s = setup();
  for (const name of ['wave', 'thinking', 'happy', 'celebrate', 'sad', 'idle']) s.feelings.mood(name);
  assert.deepStrictEqual(s.log, [
    ['poke'], ['hold', 'busy', false], ['mood', 'wave'],
    ['poke'], ['hold', 'busy', true], ['mood', 'thinking'],
    ['poke'], ['hold', 'busy', false], ['mood', 'happy'],
    ['poke'], ['hold', 'busy', false], ['mood', 'celebrate'],
    ['poke'], ['hold', 'busy', false], ['mood', 'sad'],
    ['poke'], ['hold', 'busy', false], ['mood', 'idle'],
  ]);
});

// The reviewer's case: a message sent, the panel hidden 5 s later, and the answer 70 s after the message.
test('a long thinking with the panel hidden does not let the buddy doze; drowsy comes a minute after the answer', () => {
  const s = withSleep();
  s.feelings.panel(true);
  s.feelings.mood('thinking');
  s.clock.advance(5_000);
  s.feelings.panel(false);
  s.clock.advance(65_000);
  assert.deepStrictEqual(s.moods, ['thinking'], 'not drowsy 70 s on: Buddy is still working');
  s.feelings.mood('happy');
  s.clock.advance(DROWSY_MS - 1);
  assert.deepStrictEqual(s.moods, ['thinking', 'happy']);
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods, ['thinking', 'happy', 'drowsy']);
});

test('every way a thinking ends lets go of the countdown: the answer, a celebrate, an error, the chat closed', () => {
  // happy or idle for the answer (a text put in the app celebrates instead, and nothing comes after it), sad for an
  // error, and idle when the chat is closed or Buddy turned off.
  for (const end of ['happy', 'idle', 'celebrate', 'sad']) {
    const s = withSleep();
    s.feelings.mood('thinking');
    s.feelings.mood('thinking'); // tried again: one hold, which one end lets go of
    s.clock.advance(10 * ASLEEP_MS);
    assert.deepStrictEqual(s.moods, ['thinking', 'thinking'], `${end}: not drowsy while thinking`);
    s.feelings.mood(end);
    s.clock.advance(DROWSY_MS);
    assert.deepStrictEqual(s.moods, ['thinking', 'thinking', end, 'drowsy'], end);
  }
});

test('the thinking a listening goes back to, while Buddy waits for its answer, holds the countdown too', () => {
  const s = withSleep({ busy: true });
  s.feelings.listening(true);
  s.feelings.listening(false);
  s.clock.advance(10 * ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['listening', 'thinking'], 'not drowsy while Buddy waits for the answer');
  s.feelings.mood('happy');
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['listening', 'thinking', 'happy', 'drowsy']);
});

test('a sleeping buddy wakes first and then shows the mood the app sent, and the countdown starts again from it', () => {
  const s = withSleep();
  s.clock.advance(ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep']);
  s.feelings.mood('happy');
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake', 'happy'], 'the mood comes last, so it is what shows');
  assert.strictEqual(s.sleep.state(), 'awake');
  s.clock.advance(DROWSY_MS - 1);
  assert.deepStrictEqual(s.moods.slice(4), []);
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods.slice(4), ['drowsy']);
});

test('the app sending moods now and then keeps the buddy awake', () => {
  const s = withSleep();
  for (let i = 0; i < 10; i += 1) {
    s.clock.advance(DROWSY_MS - 1);
    s.feelings.mood(i % 2 ? 'thinking' : 'happy');
  }
  assert.deepStrictEqual(s.moods.filter((name) => ['drowsy', 'asleep', 'wake'].includes(name)), []);
});

// The panel

test('the panel open holds the sleep countdown and tells the page; closed, it lets go and tells the page', () => {
  const s = setup();
  s.feelings.panel(true);
  s.feelings.panel(false);
  assert.deepStrictEqual(s.log, [['hold', 'panel', true], ['panelOpen', true], ['hold', 'panel', false], ['panelOpen', false]]);
});

test('nothing counts down while the panel is open; it wakes a sleeping buddy, and the count starts when it closes', () => {
  const s = withSleep();
  s.clock.advance(ASLEEP_MS);
  s.feelings.panel(true);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake']);
  s.clock.advance(10 * ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake'], 'not drowsy, however long it stays open');
  s.feelings.panel(false);
  s.clock.advance(DROWSY_MS);
  assert.deepStrictEqual(s.moods, ['drowsy', 'asleep', 'wake', 'drowsy']);
});

// The microphone

test('while the panel listens the buddy listens, knows the microphone is on, and nothing counts down', () => {
  const s = setup();
  s.feelings.listening(true);
  assert.deepStrictEqual(s.log, [['hold', 'voice', true], ['poke'], ['hold', 'busy', false], ['mood', 'listening'], ['micOn', true]]);
  s.log.length = 0;
  s.feelings.listening(false);
  assert.deepStrictEqual(s.log, [['hold', 'voice', false]], 'still listening for a moment');
  s.clock.advance(LISTEN_END_MS - 1);
  assert.deepStrictEqual(s.log, [['hold', 'voice', false]]);
  s.clock.advance(1);
  assert.deepStrictEqual(s.log, [['hold', 'voice', false], ['micOn', false]], 'then it hears the microphone is off, and is idle');
});

test('↩ while listening stops it and sends the message: the buddy goes from listening straight to thinking', () => {
  const s = setup();
  s.feelings.listening(true);
  s.feelings.listening(false);
  s.feelings.mood('thinking');
  s.clock.advance(10 * LISTEN_END_MS);
  assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', 'thinking', 'mic off'], 'thinking before the microphone is off: never idle in between');
});

test('a listening that stops while Buddy is still waiting for an answer goes back to thinking at once', () => {
  const s = setup({ busy: true });
  s.feelings.listening(true);
  s.feelings.listening(false);
  assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', 'thinking', 'mic off']);
  s.clock.advance(10 * LISTEN_END_MS);
  assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', 'thinking', 'mic off']);
});

test('a mood the app sends while the panel listens plays, and the microphone stays on until the panel stops', () => {
  for (const name of ['happy', 'sad', 'celebrate', 'thinking']) {
    const s = setup();
    s.feelings.listening(true);
    s.feelings.mood(name); // an earlier message's answer, an error, a text put in the app, a message tried again
    s.clock.advance(10 * LISTEN_END_MS);
    assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', name], `${name}: the buddy goes back to listening after it`);
    s.feelings.listening(false);
    s.clock.advance(LISTEN_END_MS);
    assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', name, 'mic off'], `${name}: no idle from here, it plays out`);
  }
});

test('a mood in the moment after the panel stops listening comes first, and then the microphone is off', () => {
  const s = setup();
  s.feelings.listening(true);
  s.feelings.listening(false);
  s.clock.advance(LISTEN_END_MS - 1);
  s.feelings.mood('happy');
  s.clock.advance(10 * LISTEN_END_MS);
  assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', 'happy', 'mic off'], 'and only once');
});

test('main says the listening stopped whenever it hides the panel: only a change counts', () => {
  const s = setup();
  s.feelings.mood('thinking');
  s.log.length = 0;
  s.feelings.listening(false); // the panel steps aside for Buddy to read the box, while it thinks
  s.clock.advance(10 * LISTEN_END_MS);
  assert.deepStrictEqual(s.log, [], 'thinking goes on, and the countdown hears nothing');
  s.feelings.listening(true);
  s.feelings.listening(true);
  assert.deepStrictEqual(moodsIn(s.log), ['listening'], 'listening once');
  assert.deepStrictEqual(s.log.filter((e) => e[0] === 'hold' && e[1] === 'voice'), [['hold', 'voice', true]]);
});

test('listening again before the buddy heard that it stopped keeps it listening, the microphone on', () => {
  const s = setup();
  s.feelings.listening(true);
  s.feelings.listening(false);
  s.feelings.listening(true);
  s.clock.advance(10 * LISTEN_END_MS);
  assert.deepStrictEqual(shown(s.log), ['listening', 'mic on', 'listening', 'mic on']);
});

test('the panel and the voice hold the countdown each for itself: it starts again once both have let go', () => {
  const s = withSleep();
  s.feelings.panel(true);
  s.feelings.listening(true);
  s.feelings.panel(false);
  s.clock.advance(10 * ASLEEP_MS);
  assert.deepStrictEqual(s.moods, ['listening'], 'still listening: not drowsy');
  s.feelings.listening(false);
  s.clock.advance(DROWSY_MS - 1);
  assert.deepStrictEqual(s.moods, ['listening'], 'the buddy is idle again (the page does that: it hears the microphone is off)');
  s.clock.advance(1);
  assert.deepStrictEqual(s.moods, ['listening', 'drowsy'], 'a minute after the panel stopped listening');
});

// The voice level

test('the voice level: a normal voice is the middle, twice as loud three quarters, and it never reaches the top', () => {
  assert.strictEqual(NORMAL_VOICE, 0.1);
  assert.strictEqual(buddyLevel(0), 0);
  assert.strictEqual(buddyLevel(NORMAL_VOICE), 0.5);
  assert.strictEqual(buddyLevel(2 * NORMAL_VOICE), 0.75);
  assert.ok(Math.abs(buddyLevel(0.05) - 0.29) < 0.01, 'a quiet voice');
  assert.ok(Math.abs(buddyLevel(0.4) - 0.94) < 0.01, 'a loud one');
  assert.ok(buddyLevel(1) > 0.99 && buddyLevel(1) < 1, 'the loudest');
  assert.ok(buddyLevel(0.003) < 0.03, 'a quiet room stays dark');
  for (let rms = 0; rms < 1; rms += 0.01) assert.ok(buddyLevel(rms + 0.01) > buddyLevel(rms), `louder is brighter at ${rms}`);
});

test('a voice level that is not a number is silence, and one out of range stays between 0 and 1', () => {
  for (const [given, level] of [[-0.2, 0], [Infinity, 1], [-Infinity, 0], [NaN, 0], ['0.1', 0], [undefined, 0], [null, 0]]) {
    assert.strictEqual(buddyLevel(given), level, String(given));
  }
});

test('voiceLevel sends the buddy the level it shows', () => {
  const s = setup();
  s.feelings.voiceLevel(NORMAL_VOICE);
  s.feelings.voiceLevel(0);
  assert.deepStrictEqual(s.log, [['voiceLevel', 0.5], ['voiceLevel', 0]]);
});
