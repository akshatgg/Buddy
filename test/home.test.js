'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createHome } = require('../src/main/home');
const { PANEL } = require('../src/main/geometry');

const PRIMARY = { id: 1, bounds: { x: 0, y: 0, width: 1470, height: 956 }, workArea: { x: 0, y: 32, width: 1470, height: 924 } };
const EXTERNAL = { id: 2, bounds: { x: 1470, y: -200, width: 2560, height: 1440 }, workArea: { x: 1470, y: -175, width: 2560, height: 1415 } };
const NOTCH = { x: 645, y: 0, width: 180, height: 32 };
const ENTRY = { screen: PRIMARY.bounds, notch: NOTCH };
const BUDDY = { x: 1336, y: 780, width: 96, height: 112 };

/**
 * createHome with fakes. `notches` is what the helper answers (an Error to fail); `displays` what Electron has;
 * `home` the setting. `calls` has everything done to the floating buddy, the notch window and the bubble, in order.
 */
function setup({ notches = [ENTRY], displays = [PRIMARY], home = 'notch', platform = 'darwin', extra = {} } = {}) {
  const calls = [];
  let floatingVisible = false;
  let notchVisible = false;
  const floating = {
    show() { calls.push(['floating.show']); floatingVisible = true; },
    hide() { calls.push(['floating.hide']); floatingVisible = false; },
    isVisible: () => floatingVisible,
    bounds: () => BUDDY,
    display: () => PRIMARY,
    mood: (name) => calls.push(['floating.mood', name]),
    pause: (value) => calls.push(['floating.pause', value]),
    reloadModel: () => calls.push(['floating.reloadModel']),
    setHover: (over) => calls.push(['floating.setHover', over]),
    beginDrag: (p) => calls.push(['floating.beginDrag', p]),
    dragTo: (p) => calls.push(['floating.dragTo', p]),
    endDrag: () => calls.push(['floating.endDrag']),
    resize: () => calls.push(['floating.resize']),
    reclamp: () => calls.push(['floating.reclamp']),
    window: () => 'the floating window',
    ...extra,
  };
  let shownAt = null;
  const notch = {
    show(rect, display) { calls.push(['notch.show', rect, display.id]); shownAt = rect; notchVisible = true; },
    hide() { calls.push(['notch.hide']); notchVisible = false; },
    isVisible: () => notchVisible,
    destroy: () => calls.push(['notch.destroy']),
    mood: (name) => calls.push(['notch.mood', name]),
    say: (text) => calls.push(['notch.say', text]),
    pause: (value) => calls.push(['notch.pause', value]),
    setHover: (over) => calls.push(['notch.setHover', over]),
    notch: () => shownAt,
    window: () => 'the notch window',
  };
  const bubble = { say: (text, bounds, area) => calls.push(['bubble.say', text, bounds, area]) };
  const settings = { home };
  const store = { get: (key) => settings[key], set: (patch) => Object.assign(settings, patch) };
  const helper = {
    async call(cmd) {
      calls.push(['helper', cmd]);
      if (notches instanceof Error) throw notches;
      return { notches };
    },
  };
  const screen = { getAllDisplays: () => displays };
  const h = createHome({ floating, notch, bubble, store, helper, screen, platform });
  return {
    home: h, calls, store, floating, notch,
    setNotches(list) { notches = list; },
    setDisplays(list) { displays = list; },
  };
}

test('before any refresh Buddy floats, and everything goes to the floating buddy', () => {
  const s = setup();
  assert.strictEqual(s.home.where(), 'floating');
  assert.strictEqual(s.home.hasNotch(), false);
  s.home.show();
  s.home.mood('wave');
  s.home.pause(true);
  s.home.hide();
  assert.deepStrictEqual(s.calls, [['floating.show'], ['floating.mood', 'wave'], ['floating.pause', true], ['floating.hide']]);
});

test('refresh asks the helper, and on a Mac with a notch that wants it Buddy moves into the notch', async () => {
  const s = setup();
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch']], 'nothing shown yet: nothing to move');
  assert.strictEqual(s.home.where(), 'notch');
  assert.strictEqual(s.home.hasNotch(), true);
  s.home.show();
  assert.deepStrictEqual(s.calls.slice(1), [['notch.show', NOTCH, 1]], 'the floating window is never made');
  assert.strictEqual(s.home.isVisible(), true);
  s.home.mood('happy');
  s.home.pause(true);
  s.home.pause(false);
  s.home.hide();
  assert.deepStrictEqual(s.calls.slice(2), [['notch.mood', 'happy'], ['notch.pause', true], ['notch.pause', false], ['notch.hide']]);
  assert.strictEqual(s.home.isVisible(), false);
});

test('what Buddy says goes beside the notch when it lives there, and into the bubble beside the floating buddy otherwise', async () => {
  const s = setup();
  s.home.say('Copied — press ⌘V');
  assert.deepStrictEqual(s.calls, [['bubble.say', 'Copied — press ⌘V', BUDDY, PRIMARY.workArea]]);
  await s.home.refresh();
  s.home.say('Done! It\'s in Gmail ✅');
  assert.deepStrictEqual(s.calls.at(-1), ['notch.say', 'Done! It\'s in Gmail ✅']);
});

test('panelAt says where the panel goes: under the notch, or beside the floating buddy', async () => {
  const s = setup();
  assert.deepStrictEqual(s.home.panelAt(), { kind: 'beside', buddy: BUDDY, area: PRIMARY.workArea });
  await s.home.refresh();
  assert.deepStrictEqual(s.home.panelAt(), { kind: 'below', notch: NOTCH, area: PRIMARY.workArea });
  assert.deepStrictEqual(PANEL, { width: 360, height: 480 }, 'the panel keeps its size (panelUnderNotch, Task C)');
});

test('Buddy floats on Windows, on a Mac without a notch, when the person chose Floating, and when the helper fails', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const [why, options] of [
    ['Windows', { platform: 'win32' }],
    ['no notch', { notches: [] }],
    ['Floating chosen', { home: 'floating' }],
    ['the helper failed', { notches: new Error('helper_down') }],
    ['no setting at all', { home: null }],
  ]) {
    const s = setup(options);
    await s.home.refresh();
    assert.strictEqual(s.home.where(), 'floating', why);
    s.home.show();
    assert.deepStrictEqual(s.calls.at(-1), ['floating.show'], why);
  }
  assert.strictEqual((await (async () => { const s = setup({ home: 'floating' }); await s.home.refresh(); return s.home.hasNotch(); })()), true,
    'a notch screen is on even when the person chose Floating');
  const failed = setup({ notches: new Error('helper_down') });
  await failed.home.refresh();
  assert.strictEqual(failed.home.hasNotch(), false);
});

test('a notch screen the helper names that Electron does not have does not count', async () => {
  const s = setup({ notches: [{ screen: { x: 5000, y: 0, width: 1470, height: 956 }, notch: NOTCH }] });
  await s.home.refresh();
  assert.strictEqual(s.home.where(), 'floating');
  assert.strictEqual(s.home.hasNotch(), false);
});

test('refresh while shown: the lid closed with an external screen puts Buddy afloat there, opened again puts it back in the notch', async () => {
  const s = setup();
  await s.home.refresh();
  s.home.show();
  s.calls.length = 0;

  s.setNotches([]); // the lid is closed: the built-in screen is off
  s.setDisplays([EXTERNAL]);
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch'], ['notch.hide'], ['floating.show']]);
  assert.strictEqual(s.home.where(), 'floating');
  assert.strictEqual(s.home.isVisible(), true);
  s.calls.length = 0;

  s.setNotches([ENTRY]); // opened again
  s.setDisplays([PRIMARY, EXTERNAL]);
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch'], ['floating.hide'], ['notch.show', NOTCH, 1]]);
  assert.strictEqual(s.home.where(), 'notch');
  assert.strictEqual(s.home.isVisible(), true);
});

test('refresh while hidden keeps Buddy hidden, whichever home it moves to', async () => {
  const s = setup();
  await s.home.refresh();
  s.home.show();
  s.home.hide();
  s.calls.length = 0;
  s.store.set({ home: 'floating' });
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch']], 'nothing is on screen, so nothing is hidden or shown');
  assert.strictEqual(s.home.isVisible(), false);
  s.home.show();
  assert.deepStrictEqual(s.calls.at(-1), ['floating.show']);
});

test('refresh with nothing changed does nothing to the windows', async () => {
  const s = setup();
  await s.home.refresh();
  s.home.show();
  s.calls.length = 0;
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch']]);
});

test('the notch moved (another screen is the primary one now): the notch window is shown again where it is', async () => {
  const s = setup();
  await s.home.refresh();
  s.home.show();
  s.calls.length = 0;
  const moved = { x: 645, y: 200, width: 180, height: 32 };
  s.setNotches([{ screen: { x: 0, y: 200, width: 1470, height: 956 }, notch: moved }]);
  s.setDisplays([{ ...PRIMARY, bounds: { x: 0, y: 200, width: 1470, height: 956 } }]);
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch'], ['notch.hide'], ['notch.show', moved, 1]]);
  assert.deepStrictEqual(s.home.panelAt().notch, moved);
});

test('the Settings switch: Floating hides the notch and shows the floating buddy, and back', async () => {
  const s = setup();
  await s.home.refresh();
  s.home.show();
  s.calls.length = 0;
  s.store.set({ home: 'floating' });
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch'], ['notch.hide'], ['floating.show']]);
  s.calls.length = 0;
  s.store.set({ home: 'notch' });
  await s.home.refresh();
  assert.deepStrictEqual(s.calls, [['helper', 'notch'], ['floating.hide'], ['notch.show', NOTCH, 1]]);
});

test('everything else the floating buddy does is reached through home as it is, including what is added to it later', async () => {
  const s = setup({ extra: { extra: (a, b) => ['extra', a, b], panelOpen: (open) => ['panelOpen', open] } });
  await s.home.refresh(); // in the notch: these still go to the floating buddy
  s.home.reloadModel();
  s.home.setHover(true);
  s.home.beginDrag({ x: 1, y: 2 });
  s.home.dragTo({ x: 3, y: 4 });
  s.home.endDrag();
  s.home.resize();
  s.home.reclamp();
  assert.deepStrictEqual(s.calls.slice(1), [
    ['floating.reloadModel'], ['floating.setHover', true], ['floating.beginDrag', { x: 1, y: 2 }], ['floating.dragTo', { x: 3, y: 4 }],
    ['floating.endDrag'], ['floating.resize'], ['floating.reclamp'],
  ]);
  assert.deepStrictEqual(s.home.bounds(), BUDDY);
  assert.strictEqual(s.home.display(), PRIMARY);
  assert.strictEqual(s.home.window(), 'the floating window');
  assert.deepStrictEqual(s.home.extra(1, 2), ['extra', 1, 2]);
  assert.deepStrictEqual(s.home.panelOpen(true), ['panelOpen', true]);
  assert.strictEqual(s.home.notchWindow(), s.notch);
});

test('a helper that fails is logged by kind, and Buddy floats', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const err = Object.assign(new Error("Buddy's helper is not running."), { code: 'helper_down' });
  const s = setup({ notches: err });
  await s.home.refresh();
  assert.strictEqual(s.home.where(), 'floating');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] could not ask about the notch:', 'helper_down']]);
});

test('a helper answer with no list in it is no notch', async () => {
  const s = setup();
  s.setNotches(undefined);
  await s.home.refresh();
  assert.strictEqual(s.home.where(), 'floating');
});
