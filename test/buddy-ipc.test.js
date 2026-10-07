'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerBuddyIpc } = require('../src/main/ipc/buddy');
const { loadCharacters } = require('../src/main/characters');

const characters = loadCharacters();

// `sleep: true` gives it a sleep countdown that records what it is told, in `told`.
function setup({ sleep = false, buddyId = 'boy-1' } = {}) {
  const handlers = {};
  const register = (channel, fn) => {
    handlers[channel] = fn;
  };
  const page = { name: 'the buddy page' };
  const calls = [];
  const told = [];
  const buddy = {
    window: () => ({ webContents: page }),
    setHover: (over) => calls.push(['setHover', over]),
    beginDrag: (p) => calls.push(['beginDrag', p]),
    dragTo: (p) => calls.push(['dragTo', p]),
    endDrag: () => calls.push(['endDrag']),
  };
  registerBuddyIpc({
    ipcMain: { on: register, handle: register },
    buddy,
    characters,
    store: { get: (key) => (key === 'buddyId' ? buddyId : undefined) },
    onClick: () => calls.push(['click']),
    ...(sleep && {
      sleep: {
        poke: () => told.push(['poke']),
        hold: (reason, on) => told.push(['hold', reason, on]),
      },
    }),
  });
  return { handlers, calls, told, fromPage: { sender: page }, fromElsewhere: { sender: {} } };
}

test('drag messages with finite numbers move the window', () => {
  const { handlers, calls, fromPage } = setup();
  handlers['buddy:drag-start'](fromPage, { x: 10, y: 20 });
  handlers['buddy:drag-move'](fromPage, { x: 300.5, y: -4 });
  assert.deepStrictEqual(calls, [['beginDrag', { x: 10, y: 20 }], ['dragTo', { x: 300.5, y: -4 }]]);
});

test('drag messages that are not two finite numbers are ignored', () => {
  const { handlers, calls, fromPage } = setup();
  const bad = [{ x: NaN, y: 1 }, { x: Infinity, y: 1 }, { x: 1, y: -Infinity }, { x: '5', y: 1 }, { x: 1 }, {}, null, undefined, 'x'];
  for (const point of bad) {
    handlers['buddy:drag-start'](fromPage, point);
    handlers['buddy:drag-move'](fromPage, point);
  }
  assert.deepStrictEqual(calls, []);
});

test('only the buddy page may send drag messages', () => {
  const { handlers, calls, fromElsewhere } = setup();
  handlers['buddy:drag-start'](fromElsewhere, { x: 1, y: 2 });
  handlers['buddy:drag-move'](fromElsewhere, { x: 1, y: 2 });
  assert.deepStrictEqual(calls, []);
});

test('a click on the buddy calls onClick, and only the buddy page may send one', () => {
  const { handlers, calls, fromPage, fromElsewhere } = setup();
  handlers['buddy:click'](fromElsewhere);
  assert.deepStrictEqual(calls, []);
  handlers['buddy:click'](fromPage);
  assert.deepStrictEqual(calls, [['click']]);
});

test("buddy:model answers the character's model and its accent, the colour of its symbols", () => {
  for (const c of characters.list) {
    const { handlers, fromPage } = setup({ buddyId: c.id });
    const reply = handlers['buddy:model'](fromPage);
    assert.deepStrictEqual(Object.keys(reply), ['bytes', 'accent']);
    assert.ok(reply.bytes.equals(characters.modelBytes(c.id)), `${c.id}: its model`);
    assert.strictEqual(reply.accent, c.accent, `${c.id}: its accent`);
    assert.match(reply.accent, /^#[0-9a-f]{6}$/i);
  }
});

test('only the buddy page may ask for the model', () => {
  const { handlers, fromElsewhere } = setup();
  assert.throws(() => handlers['buddy:model'](fromElsewhere), /not allowed/);
});

test('the pointer on the buddy and a press hold the sleep countdown, and a click is a use', () => {
  const { handlers, calls, told, fromPage } = setup({ sleep: true });
  handlers['buddy:hover'](fromPage, true);
  assert.deepStrictEqual(told, [['hold', 'hover', true]], 'the pointer came onto the buddy');
  told.length = 0;

  handlers['buddy:drag-start'](fromPage, { x: 10, y: 20 });
  handlers['buddy:drag-move'](fromPage, { x: 30, y: 20 });
  handlers['buddy:drag-end'](fromPage);
  assert.deepStrictEqual(told, [['hold', 'drag', true], ['hold', 'drag', false]], 'pressed and dragged, then let go');
  told.length = 0;

  handlers['buddy:drag-start'](fromPage, { x: 10, y: 20 });
  handlers['buddy:click'](fromPage);
  assert.deepStrictEqual(told, [['hold', 'drag', true], ['hold', 'drag', false], ['poke']], 'pressed and let go without moving: a click');
  told.length = 0;

  handlers['buddy:hover'](fromPage, false);
  assert.deepStrictEqual(told, [['hold', 'drag', false], ['hold', 'hover', false]], 'the pointer left');
  assert.deepStrictEqual(calls.map(([name]) => name), ['setHover', 'beginDrag', 'dragTo', 'endDrag', 'beginDrag', 'click', 'setHover'],
    'and the window does what it always did');
});

// The page sends nothing when it loses the pointer in the middle of a press that has not moved (no drag-end, no click).
// It reports the pointer leaving only between presses, so by then the press is over.
test('a press cut short holds the countdown no longer than the pointer stays on the buddy', () => {
  const { handlers, told, fromPage } = setup({ sleep: true });
  handlers['buddy:hover'](fromPage, true);
  handlers['buddy:drag-start'](fromPage, { x: 10, y: 20 });
  handlers['buddy:hover'](fromPage, false);
  assert.deepStrictEqual(told.slice(-2), [['hold', 'drag', false], ['hold', 'hover', false]]);
});

test('a press at a point that is not two numbers holds nothing', () => {
  const { handlers, told, fromPage } = setup({ sleep: true });
  handlers['buddy:drag-start'](fromPage, { x: NaN, y: 1 });
  assert.deepStrictEqual(told, []);
});

test('messages from elsewhere tell the sleep countdown nothing', () => {
  const { handlers, told, fromElsewhere } = setup({ sleep: true });
  handlers['buddy:hover'](fromElsewhere, true);
  handlers['buddy:drag-start'](fromElsewhere, { x: 1, y: 2 });
  handlers['buddy:drag-end'](fromElsewhere);
  handlers['buddy:click'](fromElsewhere);
  handlers['buddy:hover'](fromElsewhere, false);
  assert.deepStrictEqual(told, []);
});

test('without a sleep countdown every message works as before', () => {
  const { handlers, calls, fromPage } = setup();
  handlers['buddy:hover'](fromPage, 1);
  handlers['buddy:drag-start'](fromPage, { x: 1, y: 2 });
  handlers['buddy:drag-end'](fromPage);
  handlers['buddy:click'](fromPage);
  handlers['buddy:hover'](fromPage, 0);
  assert.deepStrictEqual(calls, [['setHover', true], ['beginDrag', { x: 1, y: 2 }], ['endDrag'], ['click'], ['setHover', false]]);
});
