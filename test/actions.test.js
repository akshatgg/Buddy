'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createActions, COPIED } = require('../src/main/actions');

function setup({ lastApp = { pid: 7, name: 'Google Chrome' }, replies = {}, ask } = {}) {
  const log = [];
  const helper = {
    lastApp,
    async call(cmd, args) {
      log.push(['helper', cmd, args]);
      const reply = replies[cmd];
      if (reply instanceof Error) throw reply;
      return typeof reply === 'function' ? reply(args) : reply || {};
    },
  };
  let visible = false;
  let justClosed = false;
  const ui = {
    async showPanel(state) {
      visible = true;
      log.push(['showPanel', state]);
    },
    hidePanel() {
      visible = false;
      log.push(['hidePanel']);
    },
    isPanelVisible: () => visible,
    panelJustClosed: () => justClosed,
    bubble: (text) => log.push(['bubble', text]),
    mood: (name) => log.push(['mood', name]),
  };
  const clipboard = {
    text: null,
    writeText(text) {
      this.text = text;
    },
  };
  const timers = [];
  const actions = createActions({
    helper,
    clipboard,
    ui,
    store: { get: (key) => ({ buddyName: 'Aarav' })[key] },
    ai: { ask: ask || (async (action) => ({ text: `answer for ${action}` })) },
    later: (fn, ms) => timers.push({ fn, ms }),
  });
  return { actions, log, clipboard, timers, setJustClosed: (v) => { justClosed = v; } };
}

const failure = (code, message = code) => Object.assign(new Error(message), { code });
const entries = (log, kind) => log.filter((e) => e[0] === kind);

test('opening takes the selection first and starts on Fix', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go home' } } });
  await s.actions.open();
  assert.deepStrictEqual(s.log[0], ['helper', 'captureSelection', { pid: 7, selectAll: false }]);
  assert.deepStrictEqual(entries(s.log, 'showPanel')[0][1], {
    buddyName: 'Aarav', appName: 'Google Chrome', selection: 'me go home', tab: 'fix', notice: '',
  });
});

test('with nothing selected it starts on Write', async () => {
  const s = setup({ replies: { captureSelection: { text: '' } } });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].tab, 'write');
});

test('with no app known it opens without asking the helper', async () => {
  const s = setup({ lastApp: null });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'helper').length, 0);
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].appName, '');
});

test('a password field is not read, and the panel says so', async () => {
  const s = setup({ replies: { captureSelection: failure('secure_field', "I don't read password fields.") } });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].notice, "I don't read password fields.");
});

test('toggle closes an open panel, and a panel that just closed stays closed', async () => {
  const s = setup();
  await s.actions.toggle();
  await s.actions.toggle();
  assert.strictEqual(entries(s.log, 'hidePanel').length, 1);
  s.setJustClosed(true);
  await s.actions.toggle();
  assert.strictEqual(entries(s.log, 'showPanel').length, 1);
});

test('"Use the whole box" selects all, and Replace then replaces all', async () => {
  const s = setup({ replies: { captureSelection: (args) => ({ text: args.selectAll ? 'whole text' : '' }) } });
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.wholeBox(), { text: 'whole text' });
  await s.actions.insert('fixed', 'replace');
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'fixed', selectAll: true }]);
});

test('run shows thinking, then happy', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.actions.run('write', { instruction: 'x' }), { text: 'answer for write' });
  assert.deepStrictEqual(entries(s.log, 'mood').map((e) => e[1]), ['thinking', 'happy']);
});

test('no internet makes the buddy sleepy for a while', async () => {
  const s = setup({ ask: async () => { throw failure('network'); } });
  await assert.rejects(s.actions.run('fix', { text: 'x' }), { code: 'network' });
  assert.deepStrictEqual(entries(s.log, 'mood').map((e) => e[1]), ['thinking', 'sleepy']);
  assert.strictEqual(s.timers[0].ms, 5000);
  s.timers[0].fn();
  assert.deepStrictEqual(entries(s.log, 'mood').at(-1), ['mood', 'idle']);
});

test('other errors put the buddy back to idle', async () => {
  const s = setup({ ask: async () => { throw failure('bad_key'); } });
  await assert.rejects(s.actions.run('fix', { text: 'x' }), { code: 'bad_key' });
  assert.deepStrictEqual(entries(s.log, 'mood').map((e) => e[1]), ['thinking', 'idle']);
});

test('insert closes the panel and pastes at the cursor in the app it came from', async () => {
  const s = setup();
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.insert('Dear Sir,', 'insert'), { pasted: true });
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'Dear Sir,', selectAll: false }]);
  assert.ok(s.log.findIndex((e) => e[0] === 'hidePanel') < s.log.findIndex((e) => e[1] === 'paste'));
});

test('replaceAll selects the whole box first', async () => {
  const s = setup();
  await s.actions.open();
  await s.actions.insert('All new', 'replaceAll');
  assert.strictEqual(entries(s.log, 'helper').at(-1)[2].selectAll, true);
});

test('when pasting fails, the answer goes to the clipboard', async () => {
  const s = setup({ replies: { paste: failure('not_frontmost') } });
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.insert('Hello', 'insert'), { copied: true });
  assert.strictEqual(s.clipboard.text, 'Hello');
  assert.deepStrictEqual(entries(s.log, 'bubble')[0], ['bubble', COPIED]);
});

test('copy puts it on the clipboard and says so', () => {
  const s = setup();
  assert.deepStrictEqual(s.actions.copy('Hi'), { copied: true });
  assert.strictEqual(s.clipboard.text, 'Hi');
  assert.deepStrictEqual(entries(s.log, 'bubble')[0], ['bubble', 'Copied']);
});

test('screenshot and whole box need an app to work on', async () => {
  const s = setup({ lastApp: null });
  await s.actions.open();
  await assert.rejects(s.actions.screenshot(), { code: 'no_app' });
  await assert.rejects(s.actions.wholeBox(), { code: 'no_app' });
});
