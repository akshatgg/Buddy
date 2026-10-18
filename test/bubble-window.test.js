'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createBubbleWindow, BUTTONS_HOLD_MS } = require('../src/main/bubble-window');
const { BUBBLE_HIDE_MS } = require('../shared/voice-words');

const BUDDY = { x: 1336, y: 400, width: 96, height: 112 };
const AREA = { x: 0, y: 25, width: 1440, height: 875 };
const AT = { kind: 'beside', buddy: BUDDY, area: AREA };
const SPEECH_BOX = { x: 1336 - 280 - 8, y: 400, width: 280, height: 110 };

/** Just enough of BrowserWindow and ipcMain to see what the bubble window does. */
function setup(t, { pointer = null } = {}) {
  const made = [];
  class FakeWindow {
    constructor() {
      this.calls = [];
      this.sent = [];
      this.visible = false;
      this.webContents = { on() {}, setWindowOpenHandler() {}, send: (...a) => this.sent.push(a) };
      made.push(this);
    }

    loadFile() { return Promise.resolve(); }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    on() {}
    isDestroyed() { return false; }
    setIgnoreMouseEvents(...a) { this.calls.push(['ignore', ...a]); }
    setBounds(b) { this.calls.push(['bounds', b]); }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
  }
  const handlers = {};
  const ipcMain = { on: (channel, fn) => { handlers[channel] = fn; } };
  const clicks = [];
  const buttons = [];
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const bubble = createBubbleWindow({ ipcMain, onClick: () => clicks.push('click'), onButton: (name, token) => buttons.push(token === undefined ? name : `${name}:${token}`), cursor: () => pointer, BrowserWindow: FakeWindow });
  const fromPage = () => ({ sender: made[0].webContents });
  return { bubble, made, handlers, clicks, buttons, fromPage, win: () => made[0] };
}

test('speak shows the words in the speech box, taking clicks only over the words', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Paris.', AT);
  assert.deepStrictEqual(s.win().calls.slice(-2), [['ignore', true, { forward: true }], ['bounds', SPEECH_BOX]]);
  assert.deepStrictEqual(s.win().sent, [['bubble:text', 'Paris.', true]]);
  assert.strictEqual(s.win().visible, true);
});

test('release hides it BUBBLE_HIDE_MS later; null keeps the words up; a new speak cancels the hide', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Paris.', AT);
  s.bubble.release();
  await Promise.resolve();
  t.mock.timers.tick(BUBBLE_HIDE_MS - 1);
  assert.strictEqual(s.win().visible, true);
  await s.bubble.speak(null, AT);
  t.mock.timers.tick(BUBBLE_HIDE_MS);
  assert.strictEqual(s.win().visible, true, 'null held the words up');
  s.bubble.release();
  await Promise.resolve();
  await s.bubble.speak('Again.', AT);
  t.mock.timers.tick(BUBBLE_HIDE_MS);
  assert.strictEqual(s.win().visible, true, 'a new speak keeps it');
  s.bubble.release();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(BUBBLE_HIDE_MS);
  assert.strictEqual(s.win().visible, false);
});

test('hide hides at once; say is the short bubble that clicks go through', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Paris.', AT);
  s.bubble.hide();
  assert.strictEqual(s.win().visible, false);
  await s.bubble.say('Copied', BUDDY, AREA);
  assert.deepStrictEqual(s.win().sent.at(-1), ['bubble:text', 'Copied', false]);
  assert.deepStrictEqual(s.win().calls.filter((c) => c[0] === 'ignore').at(-1), ['ignore', true, {}]);
  s.handlers['bubble:click'](s.fromPage());
  assert.deepStrictEqual(s.clicks, [], 'a click on a short bubble is not for the chat');
});

test('hover IPC: over the words the window takes the pointer; off them it lets it through; a click opens the chat', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Paris.', AT);
  s.handlers['bubble:hover'](s.fromPage(), true);
  assert.deepStrictEqual(s.win().calls.at(-1), ['ignore', false, { forward: true }]);
  s.handlers['bubble:hover'](s.fromPage(), false);
  assert.deepStrictEqual(s.win().calls.at(-1), ['ignore', true, { forward: true }]);
  s.handlers['bubble:click'](s.fromPage());
  assert.deepStrictEqual(s.clicks, ['click']);
  s.handlers['bubble:click']({ sender: {} });
  assert.deepStrictEqual(s.clicks, ['click'], 'only from its own page');
});

test('a pointer resting where the words appear: the window takes it from the start', async (t) => {
  const s = setup(t, { pointer: { x: SPEECH_BOX.x + 10, y: SPEECH_BOX.y + 10 } });
  await s.bubble.speak('Paris.', AT);
  assert.deepStrictEqual(s.win().calls.filter((c) => c[0] === 'ignore').at(-1), ['ignore', false, { forward: true }]);
});

test('speak with buttons sends them; a known button pressed in a speech bubble reaches onButton', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Delete 3 files? Say yes or no.', AT, ['yes', 'no']);
  assert.deepStrictEqual(s.win().sent.at(-1), ['bubble:text', 'Delete 3 files? Say yes or no.', true, ['yes', 'no']]);
  s.handlers['bubble:button'](s.fromPage(), 'yes');
  s.handlers['bubble:button'](s.fromPage(), 'launch');
  s.handlers['bubble:button']({ sender: {} }, 'no');
  assert.deepStrictEqual(s.buttons, ['yes']);
  s.bubble.hide();
  await s.bubble.say('Copied', BUDDY, AREA);
  s.handlers['bubble:button'](s.fromPage(), 'stop');
  assert.deepStrictEqual(s.buttons, ['yes'], 'not while the short bubble shows');
});

test('a job\'s words with buttons stay up: release and the short bubble leave them; at most BUTTONS_HOLD_MS', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Delete 3 files? Say yes or no.', AT, ['yes', 'no']);
  s.bubble.release();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(BUBBLE_HIDE_MS + 60_000);
  assert.strictEqual(s.win().visible, true, 'a minute later the question is still up');
  await s.bubble.say('Copied', BUDDY, AREA);
  assert.deepStrictEqual(s.win().sent.at(-1), ['bubble:text', 'Delete 3 files? Say yes or no.', true, ['yes', 'no']], 'the short bubble waits');
  t.mock.timers.tick(BUTTONS_HOLD_MS);
  assert.strictEqual(s.win().visible, false, 'never forever');
});

test('the job\'s end line, without buttons, ends the hold: it goes BUBBLE_HIDE_MS after release', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Opening Settings…', AT, ['stop']);
  await s.bubble.speak('Dark mode is on.', AT);
  s.bubble.release();
  await Promise.resolve();
  await Promise.resolve();
  t.mock.timers.tick(BUBBLE_HIDE_MS);
  assert.strictEqual(s.win().visible, false);
});

test('words with buttons get a taller box, so the buttons fit; without, the usual box', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Delete 3 files? Say yes or no.', AT, ['yes', 'no']);
  assert.deepStrictEqual(s.win().calls.filter((c) => c[0] === 'bounds').at(-1), ['bounds', { ...SPEECH_BOX, height: 160 }]);
  await s.bubble.speak('Done.', AT);
  assert.deepStrictEqual(s.win().calls.filter((c) => c[0] === 'bounds').at(-1), ['bounds', SPEECH_BOX]);
});

test('hide ends the hold (the short bubble shows again); speak(null) keeps the hold timer', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Go on?', AT, ['go-on']);
  await s.bubble.speak(null, AT);
  t.mock.timers.tick(BUTTONS_HOLD_MS);
  assert.strictEqual(s.win().visible, false, 'null left the hold timer running');
  await s.bubble.speak('Go on?', AT, ['go-on']);
  s.bubble.hide();
  await s.bubble.say('Copied', BUDDY, AREA);
  assert.deepStrictEqual(s.win().sent.at(-1), ['bubble:text', 'Copied', false]);
});

test('speak with a token sends it after the buttons; the button press comes back with it', async (t) => {
  const s = setup(t);
  await s.bubble.speak('Delete?', AT, ['yes', 'no'], 'tok-1');
  assert.deepStrictEqual(s.win().sent.at(-1), ['bubble:text', 'Delete?', true, ['yes', 'no'], 'tok-1']);
  s.handlers['bubble:button'](s.fromPage(), 'yes', 'tok-1');
  assert.deepStrictEqual(s.buttons, ['yes:tok-1']);
});
