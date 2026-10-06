'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createActions, COPIED } = require('../src/main/actions');

function setup({ lastApp = { pid: 7, name: 'Google Chrome' }, replies = {}, ask, clipboard: givenClipboard } = {}) {
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
  const clipboard = givenClipboard || {
    text: null,
    writeText(text) {
      this.text = text;
    },
  };
  const timers = [];
  const cancelled = [];
  const actions = createActions({
    helper,
    clipboard,
    ui,
    store: { get: (key) => ({ buddyName: 'Aarav' })[key] },
    ai: { ask: ask || (async (action) => ({ text: `answer for ${action}` })) },
    later: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancelLater: (timer) => cancelled.push(timer),
  });
  return { actions, log, clipboard, timers, cancelled, setJustClosed: (v) => { justClosed = v; } };
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

test('opening again while the selection is still being read joins that opening', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const s = setup({ replies: { captureSelection: async () => { await gate; return { text: 'me go home' }; } } });
  const first = s.actions.open();
  const second = s.actions.open();
  assert.strictEqual(second, first);
  release();
  await first;
  assert.strictEqual(entries(s.log, 'helper').length, 1);
  assert.strictEqual(entries(s.log, 'showPanel').length, 1);

  await s.actions.open(); // the first one is over, so this is a new opening
  assert.strictEqual(entries(s.log, 'helper').length, 2);
  assert.strictEqual(entries(s.log, 'showPanel').length, 2);
});

test('an opening that fails does not block the next one', async () => {
  let broken = true;
  const actions = createActions({
    helper: { lastApp: null, call: async () => ({}) },
    clipboard: {},
    store: { get: () => undefined },
    ai: {},
    ui: {
      showPanel: async () => { if (broken) throw new Error('no window'); },
      hidePanel() {},
      isPanelVisible: () => false,
      panelJustClosed: () => false,
      bubble() {},
      mood() {},
    },
  });
  await assert.rejects(actions.open(), { message: 'no window' });
  broken = false;
  await actions.open();
});

test('a password field is not read, and the panel says so', async () => {
  const s = setup({ replies: { captureSelection: failure('secure_field', "I don't read password fields.") } });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].notice, "I don't read password fields.");
});

test('a password field and a missing permission are explained, not logged as problems', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const cases = [
    ['secure_field', "I don't read password fields.", "I don't read password fields."],
    [
      'no_accessibility',
      'Buddy needs Accessibility permission. Open Settings (⚙︎) to allow it.',
      'Allow Accessibility in Settings so I can read and paste your text.',
    ],
  ];
  for (const [code, message, notice] of cases) {
    const s = setup({ replies: { captureSelection: failure(code, message) } });
    await s.actions.open();
    const shown = entries(s.log, 'showPanel')[0][1];
    assert.strictEqual(shown.notice, notice);
    assert.strictEqual(shown.tab, 'write');
  }
  assert.strictEqual(warn.mock.callCount(), 0);
});

test('when the selection cannot be read for any other reason, the panel says so on the Fix tab and the cause is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ replies: { captureSelection: failure('timeout', 'The Mac helper took too long.') } });
  await s.actions.open();
  const shown = entries(s.log, 'showPanel')[0][1];
  assert.strictEqual(shown.notice, "I couldn't read your selection — select it again or paste it here.");
  assert.strictEqual(shown.tab, 'fix', 'where "paste it here" points');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] could not read the selection:', 'timeout']]);
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

// The panel holds the keyboard focus, so the helper's ⌘A and ⌘C would land in the panel itself.
// The panel steps aside while the box is read, and comes back either way.
const steps = (log, from) => log.slice(from).map((e) => (e[0] === 'helper' ? e[1] : e[0]));

test('"Use the whole box" hides the panel while it reads the app, then shows it again with the text', async () => {
  const s = setup({ replies: { captureSelection: (args) => ({ text: args.selectAll ? 'whole text' : 'me go' }) } });
  await s.actions.open();
  const from = s.log.length;
  assert.deepStrictEqual(await s.actions.wholeBox(), { text: 'whole text' });
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'captureSelection', 'showPanel']);
  assert.deepStrictEqual(s.log[from + 1], ['helper', 'captureSelection', { pid: 7, selectAll: true }]);
  assert.deepStrictEqual(s.log[from + 2][1], {
    buddyName: 'Aarav', appName: 'Google Chrome', selection: 'whole text', tab: 'fix', notice: '',
  });
  assert.strictEqual(s.actions.session().wholeBox, true);
});

test('when the whole box cannot be read, the panel comes back with the reason, and Replace stays on the selection', async () => {
  const s = setup({
    replies: {
      captureSelection: (args) => {
        if (args.selectAll) throw failure('secure_field', "I don't read password fields.");
        return { text: 'me go home' };
      },
    },
  });
  await s.actions.open();
  const from = s.log.length;
  await assert.rejects(s.actions.wholeBox(), { code: 'secure_field' });
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'captureSelection', 'showPanel']);
  assert.deepStrictEqual(s.log[from + 2][1], {
    buddyName: 'Aarav', appName: 'Google Chrome', selection: 'me go home', tab: 'fix', notice: "I don't read password fields.",
  });
  assert.strictEqual(s.actions.session().wholeBox, false);
  assert.strictEqual(s.actions.session().selection, 'me go home');
  await s.actions.insert('fixed', 'replace');
  assert.strictEqual(entries(s.log, 'helper').at(-1)[2].selectAll, false);
});

test('an empty box comes back as an empty box, with a notice', async () => {
  const s = setup({ replies: { captureSelection: { text: '' } } });
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.wholeBox(), { text: '' });
  assert.deepStrictEqual(entries(s.log, 'showPanel').at(-1)[1], {
    buddyName: 'Aarav', appName: 'Google Chrome', selection: '', tab: 'fix', notice: 'That box looks empty.',
  });
});

test('with no app known, "Use the whole box" leaves the panel alone', async () => {
  const s = setup({ lastApp: null });
  await s.actions.open();
  const from = s.log.length;
  await assert.rejects(s.actions.wholeBox(), { code: 'no_app' });
  assert.deepStrictEqual(steps(s.log, from), []);
});

test('while the whole box is being read, the shortcut and a click on the buddy do nothing', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const s = setup({
    replies: { captureSelection: (args) => (args.selectAll ? gate.then(() => ({ text: 'whole text' })) : { text: 'me go' }) },
  });
  await s.actions.open();
  const from = s.log.length;
  const reading = s.actions.wholeBox();
  await s.actions.toggle(); // the panel is hidden on purpose, so this would open it a second time
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'captureSelection']);
  release();
  await reading;
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'captureSelection', 'showPanel']);
});

test('the shortcut works again once the whole-box read is over, whether it worked or failed', async () => {
  for (const works of [true, false]) {
    const s = setup({
      replies: {
        captureSelection: (args) => {
          if (args.selectAll && !works) throw failure('timeout', 'The Mac helper took too long.');
          return { text: 'me go' };
        },
      },
    });
    await s.actions.open();
    if (works) await s.actions.wholeBox();
    else await assert.rejects(s.actions.wholeBox(), { code: 'timeout' });
    const from = s.log.length;
    await s.actions.toggle(); // the panel is back on screen, so this closes it
    assert.deepStrictEqual(steps(s.log, from), ['hidePanel'], works ? 'after a read that worked' : 'after a read that failed');
  }
});

test('opening again forgets the whole box', async () => {
  const s = setup({ replies: { captureSelection: (args) => ({ text: args.selectAll ? 'whole text' : 'me go' }) } });
  await s.actions.open();
  await s.actions.wholeBox();
  assert.strictEqual(s.actions.session().wholeBox, true);
  await s.actions.open();
  assert.strictEqual(s.actions.session().wholeBox, false);
  await s.actions.insert('fixed', 'replace');
  assert.strictEqual(entries(s.log, 'helper').at(-1)[2].selectAll, false);
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

test('a new request cancels the pending "sleepy, then idle" timer', async () => {
  let offline = true;
  const s = setup({ ask: async () => { if (offline) throw failure('network'); return { text: 'ok' }; } });
  await assert.rejects(s.actions.run('fix', { text: 'x' }), { code: 'network' });
  assert.strictEqual(s.timers.length, 1);
  assert.strictEqual(s.cancelled.length, 0);
  offline = false;
  await s.actions.run('fix', { text: 'x' });
  assert.strictEqual(s.cancelled.length, 1);
  assert.strictEqual(s.cancelled[0], s.timers[0]);
});

test('insert closes the panel and pastes at the cursor in the app it came from', async () => {
  const s = setup();
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.insert('Dear Sir,', 'insert'), { pasted: true });
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'Dear Sir,', selectAll: false }]);
  const hidden = s.log.findIndex((e) => e[0] === 'hidePanel');
  const pasted = s.log.findIndex((e) => e[0] === 'helper' && e[1] === 'paste');
  assert.ok(hidden >= 0, 'the panel is hidden');
  assert.ok(hidden < pasted, 'and it is hidden before the paste');
});

test('Replace on a selection replaces just that selection', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go home' } } });
  await s.actions.open();
  await s.actions.insert('I am going home', 'replace');
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'I am going home', selectAll: false }]);
});

test('replaceAll selects the whole box first', async () => {
  const s = setup();
  await s.actions.open();
  await s.actions.insert('All new', 'replaceAll');
  assert.strictEqual(entries(s.log, 'helper').at(-1)[2].selectAll, true);
});

test('when pasting fails, the answer goes to the clipboard', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({ replies: { paste: failure('not_frontmost') } });
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.insert('Hello', 'insert'), { copied: true });
  assert.strictEqual(s.clipboard.text, 'Hello');
  assert.deepStrictEqual(entries(s.log, 'bubble')[0], ['bubble', COPIED]);
});

test('a failed paste is logged with its cause before the clipboard takes over', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ replies: { paste: failure('not_frontmost') } });
  await s.actions.open();
  await s.actions.insert('Hello', 'insert');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] paste failed, copied instead:', 'not_frontmost']]);
});

test('copy puts it on the clipboard and says so', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.actions.copy('Hi'), { copied: true });
  assert.strictEqual(s.clipboard.text, 'Hi');
  assert.deepStrictEqual(entries(s.log, 'bubble')[0], ['bubble', 'Copied']);
});

/** Electron's clipboard (from Electron 44): writeText answers a promise. This one is settled by hand. */
function asyncClipboard() {
  const clipboard = {
    text: null,
    writes: [],
    writeText(text) {
      return new Promise((resolve, reject) => {
        clipboard.writes.push({
          done() {
            clipboard.text = text;
            resolve();
          },
          fail: reject,
        });
      });
    },
  };
  return clipboard;
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test('insert says the answer was copied only once it is on the clipboard', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const clipboard = asyncClipboard();
  const s = setup({ replies: { paste: failure('not_frontmost') }, clipboard });
  await s.actions.open();
  let answered = false;
  const inserting = s.actions.insert('Hello', 'insert').then((r) => {
    answered = true;
    return r;
  });
  await tick();
  assert.strictEqual(clipboard.writes.length, 1, 'the answer is being written to the clipboard');
  assert.strictEqual(answered, false, 'insert has not answered yet');
  assert.strictEqual(entries(s.log, 'bubble').length, 0, 'and the bubble does not say "Copied" yet');
  clipboard.writes[0].done();
  assert.deepStrictEqual(await inserting, { copied: true });
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', COPIED]]);
});

test('a clipboard that cannot be written makes insert fail instead of saying it copied', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const clipboard = asyncClipboard();
  const s = setup({ replies: { paste: failure('not_frontmost') }, clipboard });
  await s.actions.open();
  const inserting = s.actions.insert('Hello', 'insert');
  await tick();
  clipboard.writes[0].fail(new Error('the pasteboard is busy'));
  await assert.rejects(inserting, { message: 'the pasteboard is busy' });
  assert.strictEqual(entries(s.log, 'bubble').length, 0);
});

test('copy says "Copied" only once the text is on the clipboard', async () => {
  const clipboard = asyncClipboard();
  const s = setup({ clipboard });
  let answered = false;
  const copying = Promise.resolve(s.actions.copy('Hi')).then((r) => {
    answered = true;
    return r;
  });
  await tick();
  assert.strictEqual(answered, false, 'copy has not answered yet');
  assert.strictEqual(entries(s.log, 'bubble').length, 0, 'and the bubble does not say "Copied" yet');
  clipboard.writes[0].done();
  assert.deepStrictEqual(await copying, { copied: true });
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', 'Copied']]);
});

test('a clipboard that cannot be written makes copy fail instead of saying it copied', async () => {
  const clipboard = asyncClipboard();
  const s = setup({ clipboard });
  const copying = Promise.resolve(s.actions.copy('Hi'));
  clipboard.writes[0].fail(new Error('the pasteboard is busy'));
  await assert.rejects(copying, { message: 'the pasteboard is busy' });
  assert.strictEqual(entries(s.log, 'bubble').length, 0);
});

test('screenshot and whole box need an app to work on', async () => {
  const s = setup({ lastApp: null });
  await s.actions.open();
  await assert.rejects(s.actions.screenshot(), { code: 'no_app' });
  await assert.rejects(s.actions.wholeBox(), { code: 'no_app' });
});
