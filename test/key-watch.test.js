'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { createKeyWatch, RETRY_MS } = require('../src/main/key-watch');

const tick = () => new Promise((resolve) => setImmediate(resolve));
const change = (keyCode, flags, t) => ({ kind: 'flags', keyCode, flags, t });
// Right ⌥ and left ⌘ tapped at `t`: down, then up 100 ms later. The flags say the kind of key and its side.
const rightOption = (t) => [change(61, 0x80040, t), change(61, 0, t + 100)];
const leftCommand = (t) => [change(55, 0x100008, t), change(55, 0, t + 100)];

/**
 * A key watch with a fake helper (it records each call; `failing` is the code its watchKeys fails with) and fake timers.
 * `warnings` is what the key watch logged, one [message, code] for each.
 */
function setup(t, { failing = null } = {}) {
  const warnings = [];
  t.mock.method(console, 'warn', (...args) => warnings.push(args));
  const helper = new EventEmitter();
  helper.calls = [];
  helper.failing = failing;
  helper.call = async (cmd, args) => {
    helper.calls.push([cmd, args]);
    if (helper.failing) throw Object.assign(new Error('no'), { code: helper.failing });
    return { watching: args.on };
  };
  const presses = [];
  const timers = new Map();
  let nextTimer = 1;
  const watch = createKeyWatch({
    helper,
    onPress: () => presses.push('open'),
    later: (fn, ms) => {
      timers.set(nextTimer, { fn, ms });
      return nextTimer++;
    },
    cancelLater: (id) => timers.delete(id),
  });
  const press = (...events) => {
    for (const event of events.flat()) helper.emit('keys', event);
  };
  const told = () => helper.calls.map(([, args]) => args.on);
  /** Fire the one timer that is waiting, as if its time had come. */
  const fireTimer = () => {
    const [[id, timer]] = [...timers];
    timers.delete(id);
    timer.fn();
  };
  return { helper, watch, presses, timers, press, told, fireTimer, warnings };
}

test('the helper listens only while a single-key shortcut is set', async (t) => {
  const s = setup(t);
  await tick();
  assert.deepStrictEqual(s.told(), [], 'nothing to listen for yet');
  assert.strictEqual(s.watch.setShortcut('Tap:RightOption'), true);
  await tick();
  assert.deepStrictEqual(s.helper.calls, [['watchKeys', { on: true }]]);
  assert.strictEqual(s.watch.setShortcut(null), true);
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
});

test('a tap of the shortcut opens the panel; another key, or the shortcut with a key, does not', (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  s.press(rightOption(1000));
  assert.deepStrictEqual(s.presses, ['open']);
  s.press(leftCommand(2000));
  s.press([change(61, 0x80040, 3000), { kind: 'other' }, change(61, 0, 3100)]);
  assert.deepStrictEqual(s.presses, ['open'], 'nothing more');
});

test('a shortcut saved with its keys in another order is the same shortcut', (t) => {
  const s = setup(t);
  assert.strictEqual(s.watch.setShortcut('Tap:LeftCommand+LeftShift'), true);
  s.press([change(55, 0x100008, 1000), change(56, 0x12000a, 1050), change(55, 0x20002, 1100), change(56, 0, 1150)]);
  assert.deepStrictEqual(s.presses, ['open']);
});

test('a single-key shortcut that is not well formed is refused, and nothing changes', async (t) => {
  const s = setup(t);
  assert.strictEqual(s.watch.setShortcut('Tap:Bogus'), false);
  await tick();
  assert.deepStrictEqual(s.helper.calls, []);
});

test('while Settings records, every tap goes to Settings and none opens the panel', (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  const heard = [];
  s.watch.startRecording((value) => heard.push(value));
  s.press(rightOption(1000), leftCommand(2000));
  assert.deepStrictEqual(heard, ['Tap:RightOption', 'Tap:LeftCommand']);
  assert.deepStrictEqual(s.presses, []);
  s.watch.stopRecording();
  s.press(rightOption(3000));
  assert.deepStrictEqual(s.presses, ['open'], 'after recording, the shortcut opens the panel again');
});

test('recording has the helper listen even with no single-key shortcut, and stop after', async (t) => {
  const s = setup(t);
  s.watch.startRecording(() => {});
  await tick();
  s.watch.stopRecording();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
  s.watch.stopRecording();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false], 'stopping twice tells it nothing more');
});

test('quick changes leave the helper told the last of them', async (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  s.watch.setShortcut(null);
  s.watch.setShortcut('Tap:Fn');
  await tick();
  await tick();
  assert.strictEqual(s.told().at(-1), true);
  s.press([change(63, 0x800000, 1000), change(63, 0, 1100)]);
  assert.deepStrictEqual(s.presses, ['open']);
});

test('a change made while the helper is being told is told right after', async (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  s.watch.setShortcut(null); // before the helper has answered the first
  await tick();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
});

test("a change made right behind the helper's answer is not lost", async (t) => {
  const s = setup(t);
  s.watch.setShortcut('Tap:RightOption');
  // This runs right after the answer has been taken: after the last time the key watch looked for a change, and before
  // the call is marked as done.
  Promise.resolve().then(() => s.watch.setShortcut(null));
  await tick();
  await tick();
  assert.deepStrictEqual(s.told(), [true, false]);
});

test('a helper that restarts is told again; with nothing to listen for, it is told nothing', async (t) => {
  const s = setup(t);
  s.helper.emit('started');
  await tick();
  assert.deepStrictEqual(s.told(), []);
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  s.helper.emit('started');
  await tick();
  assert.deepStrictEqual(s.told(), [true, true]);
});

test('when the helper cannot listen, it is asked again every 10 seconds until it can', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  assert.deepStrictEqual([...s.timers.values()].map((timer) => timer.ms), [RETRY_MS]);
  s.fireTimer(); // 10 seconds later, still no Accessibility
  await tick();
  assert.strictEqual(s.timers.size, 1, 'asked again later');
  s.helper.failing = null; // the permission is given
  s.fireTimer();
  await tick();
  assert.deepStrictEqual(s.told(), [true, true, true]);
  assert.strictEqual(s.timers.size, 0, 'listening: nothing more to ask');
  s.press(rightOption(1000));
  assert.deepStrictEqual(s.presses, ['open']);
});

test('a helper that keeps failing is logged once, and again only after it has worked in between', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  const logged = ['[buddy] could not listen for the shortcut key:', 'no_accessibility'];
  assert.deepStrictEqual(s.warnings, [logged]);
  s.fireTimer();
  await tick();
  s.fireTimer();
  await tick();
  assert.deepStrictEqual(s.warnings, [logged], 'not again every 10 seconds');
  assert.strictEqual(s.timers.size, 1, 'but it is still asked again');
  s.helper.failing = null; // the permission is given
  s.fireTimer();
  await tick();
  assert.strictEqual(s.timers.size, 0);
  s.helper.failing = 'no_accessibility'; // and taken away again
  s.helper.emit('started');
  await tick();
  assert.deepStrictEqual(s.warnings, [logged, logged], 'it worked in between, so this is news');
  assert.strictEqual(s.timers.size, 1);
});

test('a failure that comes when nothing is wanted any more is not logged, and not asked again', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  s.watch.setShortcut(null); // before the helper has answered
  await tick();
  await tick();
  assert.deepStrictEqual(s.told(), [true], 'and it is told nothing more');
  assert.deepStrictEqual(s.warnings, []);
  assert.strictEqual(s.timers.size, 0);
});

test('asking again stops when the shortcut is no longer a single key', async (t) => {
  const s = setup(t, { failing: 'no_accessibility' });
  s.watch.setShortcut('Tap:RightOption');
  await tick();
  assert.strictEqual(s.timers.size, 1);
  s.watch.setShortcut(null);
  assert.strictEqual(s.timers.size, 0);
});
