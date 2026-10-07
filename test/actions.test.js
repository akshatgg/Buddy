'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { BuddyError } = require('../shared/errors');
const { createActions, COPIED } = require('../src/main/actions');
const { onPlatform } = require('./helpers/platform');

const APP = { pid: 7, bundleId: 'com.google.Chrome', name: 'Google Chrome' };
const MAIL = { pid: 8, bundleId: 'com.apple.mail', name: 'Mail' };

/** What the AI's `chat` request gives back, read from its JSON (parseChat): this shape, with these fields set. */
const reply = (fields = {}) => ({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], ...fields });

/**
 * createActions with fakes. `answers` are what the AI gives back, one per request, in order: a reply, an error it
 * fails with, or a function of the input. `facts` are what the memory already holds, and `refuse` what it will not
 * save. `sendKey` is what the send-key table says for the app (null: it does not know the app).
 */
function setup({
  lastApp = APP,
  replies = {},
  answers = [],
  ask,
  clipboard: givenClipboard,
  windows = false,
  name = 'Akshat',
  facts = [],
  refuse = [],
  sendKey = { key: 'return', modifiers: ['cmd'] },
} = {}) {
  const log = [];
  const helper = {
    lastApp,
    async call(cmd, args) {
      log.push(['helper', cmd, args]);
      const answer = replies[cmd];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(args) : answer || {};
    },
  };
  let time = 1_000_000;
  let visible = false;
  let justClosed = false;
  let hiddenAt = 0;
  const ui = {
    async showPanel(state) {
      visible = true;
      log.push(['showPanel', state]);
    },
    panelState: (state) => log.push(['state', state]),
    hidePanel() {
      if (visible) hiddenAt = time;
      visible = false;
      log.push(['hidePanel']);
    },
    isPanelVisible: () => visible,
    panelJustClosed: () => justClosed,
    panelHiddenAt: () => hiddenAt,
    panelWindowHandle: () => 4242,
    bubble: (text) => log.push(['bubble', text]),
    mood: (mood) => log.push(['mood', mood]),
    openSettings: (section) => log.push(['openSettings', section]),
  };
  const clipboard = givenClipboard || {
    text: null,
    writeText(text) {
      this.text = text;
    },
  };
  // The memory (memory.js): add() answers the saved fact, or null for one it refuses or already knows.
  let nextFact = 1;
  const memory = {
    saved: facts.map((text) => ({ id: `fact-${nextFact++}`, text })),
    facts() {
      return this.saved.map((f) => f.text);
    },
    add(text) {
      log.push(['remember', text]);
      if (refuse.includes(text) || this.facts().includes(text)) return null;
      const fact = { id: `fact-${nextFact++}`, text };
      this.saved.push(fact);
      return { ...fact };
    },
    remove(id) {
      log.push(['forget', id]);
      const before = this.saved.length;
      this.saved = this.saved.filter((f) => f.id !== id);
      return this.saved.length < before;
    },
  };
  const queue = [...answers];
  const ai = {
    ask: ask || (async (action, given) => {
      log.push(['ask', action, given]);
      const next = queue.length ? queue.shift() : reply({ text: 'An answer.' });
      if (next instanceof Error) throw next;
      const chat = typeof next === 'function' ? next(given) : next;
      return { text: JSON.stringify(chat), model: 'test-model', chat };
    }),
  };
  const timers = [];
  const cancelled = [];
  const actions = createActions({
    helper,
    clipboard,
    ui,
    store: { get: (key) => ({ buddyName: 'Aarav' })[key] },
    ai,
    memory,
    sendKeyFor: (app, platform) => {
      log.push(['sendKeyFor', app, platform]);
      return sendKey;
    },
    undoKey: (platform) => ({ key: 'z', modifiers: [platform === 'darwin' ? 'cmd' : 'ctrl'] }),
    userName: () => name,
    now: () => time,
    later: (fn, ms) => {
      const timer = { fn, ms };
      timers.push(timer);
      return timer;
    },
    cancelLater: (timer) => cancelled.push(timer),
    helperMovesFocus: windows,
    newline: windows ? '\r\n' : '\n',
    system: windows ? 'win32' : 'darwin',
  });
  return {
    actions,
    helper,
    log,
    clipboard,
    memory,
    timers,
    cancelled,
    setJustClosed: (v) => { justClosed = v; },
    wait: (ms) => { time += ms; },
    /** The panel hides the way a click somewhere else hides it: by itself, not through actions. */
    blur: () => ui.hidePanel(),
  };
}

const failure = (code, message = code) => new BuddyError(code, message);
const entries = (log, kind) => log.filter((e) => e[0] === kind);
const chatOf = (s) => s.actions.state().chat;
const lastItem = (s) => chatOf(s).at(-1);
const moods = (log) => entries(log, 'mood').map((e) => e[1]);
const asked = (log) => entries(log, 'ask').map((e) => e[2]);
/** What happened since `from`, by name: the panel, the helper's commands, the AI and the bubble (not moods or states). */
const steps = (log, from = 0) => log.slice(from)
  .filter((e) => ['showPanel', 'hidePanel', 'helper', 'ask', 'bubble', 'openSettings'].includes(e[0]))
  .map((e) => (e[0] === 'helper' ? e[1] : e[0]));
/** The AI's input for a message from the panel opened over Chrome, by Akshat, with nothing before it. */
const input = (fields) => ({ history: [], facts: [], appName: 'Google Chrome', userName: 'Akshat', step: 1, ...fields });

// Opening the panel

test('opening reads the selection first, then shows the greeting, the selection and an empty chat', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go home' } } });
  await s.actions.open();
  assert.deepStrictEqual(s.log[0], ['helper', 'captureSelection', { pid: 7, selectAll: false }]);
  assert.deepStrictEqual(entries(s.log, 'showPanel')[0][1], {
    buddyName: 'Aarav',
    appName: 'Google Chrome',
    greeting: 'Hi Akshat! What should we do?',
    notice: '',
    selection: 'me go home',
    busy: false,
    resumed: false,
    chat: [],
  });
});

test('nobody signed in with a name: the greeting has no name', async () => {
  const s = setup({ name: '' });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].greeting, 'Hi! What should we do?');
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
      panelState() {},
      hidePanel() {},
      isPanelVisible: () => false,
      panelJustClosed: () => false,
      panelHiddenAt: () => 0,
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
  const shown = entries(s.log, 'showPanel')[0][1];
  assert.strictEqual(shown.notice, "I don't read password fields.");
  assert.strictEqual(shown.selection, '');
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
    assert.strictEqual(entries(s.log, 'showPanel')[0][1].notice, notice);
  }
  assert.strictEqual(warn.mock.callCount(), 0);
});

test('on Windows, an app run as administrator and keys still held are explained in their own words, not logged as problems', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  for (const [code, message] of [
    ['elevated', "That app runs as administrator, so I can't read from it."],
    ['keys_held', 'Let go of the keys, then try again.'],
  ]) {
    const s = setup({ replies: { captureSelection: failure(code, message) } });
    await s.actions.open();
    assert.strictEqual(entries(s.log, 'showPanel')[0][1].notice, message, code);
  }
  assert.strictEqual(warn.mock.callCount(), 0);
});

test('when the selection cannot be read for any other reason, the panel says so and the cause is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ replies: { captureSelection: failure('timeout', 'The Mac helper took too long.') } });
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel')[0][1].notice, "I couldn't read your selection — select it again or paste it here.");
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

// The same chat, or a new one

test('a panel that only hid, opened again from the same app within 5 minutes, shows the same chat with a fresh selection', async () => {
  let selected = 'me go home';
  const s = setup({ replies: { captureSelection: () => ({ text: selected }) }, answers: [reply({ kind: 'fix', text: 'I am going home.' })] });
  await s.actions.open();
  await s.actions.send('');
  const before = chatOf(s);
  assert.strictEqual(before.length, 2);
  s.blur();
  s.wait(4 * 60_000);
  selected = 'tomorow';
  await s.actions.open();
  const shown = entries(s.log, 'showPanel').at(-1)[1];
  assert.strictEqual(shown.resumed, true);
  assert.deepStrictEqual(shown.chat, before);
  assert.strictEqual(shown.selection, 'tomorow', 'the selection is read again at every opening');
});

test('a new chat after 5 minutes, from another app, or after the panel was closed', async () => {
  const cases = {
    'after 5 minutes': (s) => {
      s.blur();
      s.wait(5 * 60_000);
    },
    'from another app': (s) => {
      s.blur();
      s.helper.lastApp = MAIL;
    },
    'after closing (Esc, ✕, the shortcut, a click on the buddy)': (s) => s.actions.dismiss(),
  };
  for (const [what, leave] of Object.entries(cases)) {
    const s = setup();
    await s.actions.open();
    await s.actions.send('hello');
    assert.strictEqual(chatOf(s).length, 2);
    await leave(s);
    await s.actions.open();
    const shown = entries(s.log, 'showPanel').at(-1)[1];
    assert.deepStrictEqual([shown.resumed, shown.chat], [false, []], what);
  }
});

test('closing the panel ends the chat at once, and an answer still on its way is dropped', async () => {
  let answer;
  const s = setup({ ask: (action, given) => new Promise((resolve) => { answer = () => resolve({ text: '', chat: reply({ text: 'Dear Sir,', doIt: true }) }); s.log.push(['ask', action, given]); }) });
  await s.actions.open();
  const sending = s.actions.send('mail to my boss');
  await new Promise(setImmediate);
  await s.actions.dismiss();
  assert.deepStrictEqual(chatOf(s), []);
  answer();
  await sending;
  assert.deepStrictEqual(chatOf(s), [], 'nothing joins the new chat');
  assert.deepStrictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'paste'), [], 'and nothing is put in the app');
});

// Sending a message

test('a message goes to the AI with the selection, what Buddy knows and who asks, and the answer joins the chat', async () => {
  const s = setup({
    replies: { captureSelection: { text: 'me go home' } },
    facts: ['Your boss is Mr. Sharma.'],
    answers: [reply({ kind: 'fix', say: 'Fixed it!', text: 'I am going home.', notes: ['"me go" should be "I am going".'] })],
  });
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.send('  fix this please  '), {});
  assert.deepStrictEqual(entries(s.log, 'ask'), [[
    'ask', 'chat', input({ message: 'fix this please', selection: 'me go home', facts: ['Your boss is Mr. Sharma.'] }),
  ]]);
  const states = entries(s.log, 'state').map((e) => e[1]);
  assert.deepStrictEqual([states[0].busy, states[0].chat], [true, [{ id: 1, type: 'you', text: 'fix this please' }]], 'thinking');
  assert.deepStrictEqual(states.at(-1), {
    buddyName: 'Aarav',
    appName: 'Google Chrome',
    greeting: 'Hi Akshat! What should we do?',
    notice: '',
    selection: '', // the selection went with this message
    busy: false,
    resumed: false,
    chat: [
      { id: 1, type: 'you', text: 'fix this please' },
      { id: 2, type: 'buddy', say: 'Fixed it!', text: 'I am going home.', notes: ['"me go" should be "I am going".'], buttons: ['replace', 'copy'] },
    ],
  });
  assert.deepStrictEqual(s.actions.state(), states.at(-1));
  assert.deepStrictEqual(moods(s.log), ['thinking', 'happy']);
});

test('the request is sent with the AI timeout, and a request without a selection has none', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout', () => 'the 60 s signal');
  const calls = [];
  const s = setup({ ask: async (action, given, options) => { calls.push([action, given, options]); return { text: 'Hi', chat: reply({ text: 'Hi' }) }; } });
  await s.actions.open();
  await s.actions.send('say hi');
  assert.deepStrictEqual(timeout.mock.calls.map((c) => c.arguments), [[60_000]]);
  assert.deepStrictEqual(calls, [['chat', input({ message: 'say hi' }), { signal: 'the 60 s signal' }]]);
});

test('each request gets its own timeout', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout', () => ({}));
  const signals = [];
  const s = setup({ ask: async (action, given, { signal }) => { signals.push(signal); return { text: 'ok', chat: reply({ text: 'ok' }) }; } });
  await s.actions.open();
  await s.actions.send('a');
  await s.actions.send('b');
  assert.strictEqual(timeout.mock.callCount(), 2);
  assert.notStrictEqual(signals[0], signals[1]);
});

test("the chat so far goes along: the last messages, the buddy's as its line and its text, without the small lines", async () => {
  const s = setup({
    answers: [
      reply({ kind: 'answer', text: 'It means "leave".' }),
      reply({ say: 'Here it is.', text: 'Dear Sir,', remember: ['Your boss is Mr. Sharma.'] }),
      reply({ say: 'Shorter:', text: 'Sir,' }),
    ],
  });
  await s.actions.open();
  await s.actions.send('what does chutti mean?');
  await s.actions.send('mail to my boss Mr. Sharma');
  await s.actions.send('shorter');
  await s.actions.send('again');
  assert.deepStrictEqual(asked(s.log).at(-1), input({
    message: 'again',
    facts: ['Your boss is Mr. Sharma.'],
    history: [
      { from: 'you', text: 'what does chutti mean?' },
      { from: 'buddy', text: 'It means "leave".' },
      { from: 'you', text: 'mail to my boss Mr. Sharma' },
      { from: 'buddy', text: 'Here it is.\n\nDear Sir,' },
      { from: 'you', text: 'shorter' },
      { from: 'buddy', text: 'Shorter:\n\nSir,' },
    ],
  }));
});

test('only the last 6 messages go along', async () => {
  const s = setup();
  await s.actions.open();
  for (const message of ['one', 'two', 'three', 'four', 'five']) await s.actions.send(message);
  assert.deepStrictEqual(asked(s.log).at(-1).history, [
    { from: 'you', text: 'two' },
    { from: 'buddy', text: 'An answer.' },
    { from: 'you', text: 'three' },
    { from: 'buddy', text: 'An answer.' },
    { from: 'you', text: 'four' },
    { from: 'buddy', text: 'An answer.' },
  ]);
});

test('an empty message with text selected means "fix this"', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go home' } } });
  await s.actions.open();
  await s.actions.send('   ');
  assert.deepStrictEqual(asked(s.log), [input({ message: 'Fix this.', selection: 'me go home' })]);
  assert.deepStrictEqual(chatOf(s)[0], { id: 1, type: 'you', text: 'Fix this.' });
});

test('an empty message with nothing selected asks what to do, without asking the AI', async () => {
  const s = setup();
  await s.actions.open();
  assert.deepStrictEqual(await s.actions.send(''), {});
  assert.deepStrictEqual(asked(s.log), []);
  assert.deepStrictEqual(chatOf(s), [{ id: 1, type: 'error', text: 'Tell me what to do first.', code: 'bad_request', buttons: [] }]);
  assert.deepStrictEqual(moods(s.log), []);
});

test('a message or a selection that is too long is refused before it joins the chat, so that the page gives the words back', async () => {
  const s = setup({ replies: { captureSelection: { text: 'x'.repeat(8001) } } });
  await s.actions.open();
  await assert.rejects(s.actions.send('y'.repeat(1001)), {
    code: 'bad_request', message: 'That message is too long (over 1000 characters). Try a shorter one.',
  });
  await assert.rejects(s.actions.send('fix this'), {
    code: 'bad_request', message: 'Your selection is too long (over 8000 characters). Select less, or press ✕ to leave it out.',
  });
  await assert.rejects(s.actions.send(''), { code: 'bad_request' }, 'an empty message fixes the selection, which is too long');
  assert.deepStrictEqual([chatOf(s), asked(s.log), moods(s.log)], [[], [], []]);
  assert.strictEqual(s.actions.state().busy, false);

  // Up to the limits, and without the selection (✕), it goes.
  s.actions.dropSelection();
  await s.actions.send(` ${'y'.repeat(1000)} `);
  assert.strictEqual(asked(s.log).length, 1);
  const fits = setup({ replies: { captureSelection: { text: ` ${'x'.repeat(8000)}\n` } } });
  await fits.actions.open();
  await fits.actions.send('fix this');
  assert.strictEqual(asked(fits.log).length, 1);
});

test('one message at a time: a second one waits for the answer to the first', async () => {
  let answer;
  const s = setup({ ask: () => new Promise((resolve) => { answer = () => resolve({ text: 'Hi', chat: reply({ text: 'Hi' }) }); }) });
  await s.actions.open();
  const first = s.actions.send('say hi');
  await assert.rejects(s.actions.send('and bye'), { code: 'bad_request', message: 'Wait for my answer first.' });
  answer();
  await first;
  assert.deepStrictEqual(chatOf(s).map((item) => item.type), ['you', 'buddy']);
});

test('what each answer shows, and with which buttons', async () => {
  const cases = [
    ['a written text', '', reply({ say: 'Here you go.', text: 'Dear Sir,' }), ['insert', 'copy']],
    ['a fix of the selection', 'me go', reply({ kind: 'fix', text: 'I go.' }), ['replace', 'copy']],
    ['a fix of text typed in the chat', '', reply({ kind: 'fix', text: 'I go.' }), ['insert', 'copy']],
    ['a reply to the selection', 'Can you come?', reply({ text: 'Yes, I can.' }), ['insert', 'copy']],
    ['an answer', '', reply({ kind: 'answer', text: 'It means leave.' }), ['copy']],
    ['an answer with nothing to copy', '', reply({ kind: 'answer', say: 'Hi!', text: '' }), []],
  ];
  for (const [what, selected, answer, buttons] of cases) {
    const s = setup({ replies: { captureSelection: { text: selected } }, answers: [answer] });
    await s.actions.open();
    await s.actions.send('go');
    assert.deepStrictEqual(lastItem(s), { id: 2, type: 'buddy', say: answer.say, text: answer.text, notes: [], buttons }, what);
  }
});

test('an answer without its reading is shown as a written text', async () => {
  const s = setup({ ask: async () => ({ text: 'Dear Sir,', model: 'm' }) });
  await s.actions.open();
  await s.actions.send('mail');
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'buddy', say: '', text: 'Dear Sir,', notes: [], buttons: ['insert', 'copy'] });
});

test('Leave out the selection (✕): the next message goes without it', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go home' } } });
  await s.actions.open();
  assert.deepStrictEqual(s.actions.dropSelection(), {});
  assert.strictEqual(entries(s.log, 'state').at(-1)[1].selection, '');
  await s.actions.send('mail to my boss');
  assert.deepStrictEqual(asked(s.log), [input({ message: 'mail to my boss' })]);
});

// Reading the box, or looking at the screen

test('a request about their text box: the panel steps aside while it is read, comes back on the same chat, and asks again with it', async () => {
  const s = setup({
    replies: { captureSelection: (args) => ({ text: args.selectAll ? 'me go home tomorow' : 'me go' }) },
    answers: [reply({ kind: 'box' }), reply({ kind: 'fix', say: 'Fixed.', text: 'I am going home tomorrow.' })],
  });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('fix my english');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'captureSelection', 'showPanel', 'ask']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'captureSelection', { pid: 7, selectAll: true }]);
  const back = entries(s.log, 'showPanel').at(-1)[1];
  assert.deepStrictEqual([back.resumed, back.busy], [true, true]);
  assert.deepStrictEqual(back.chat, [
    { id: 1, type: 'you', text: 'fix my english' },
    { id: 2, type: 'event', text: '📖 Read your text in Google Chrome', buttons: [] },
  ]);
  assert.deepStrictEqual(asked(s.log), [
    input({ message: 'fix my english', selection: 'me go' }),
    input({ message: 'fix my english', box: 'me go home tomorow', step: 2 }), // the selection is left out
  ]);
  assert.deepStrictEqual(lastItem(s), { id: 3, type: 'buddy', say: 'Fixed.', text: 'I am going home tomorrow.', notes: [], buttons: ['replace', 'copy'] });
  assert.deepStrictEqual(moods(s.log), ['thinking', 'happy'], 'thinking all the way through both steps');

  // Replace then replaces the whole box.
  await s.actions.act(3, 'replace');
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'I am going home tomorrow.', selectAll: true }]);
});

test('text read from the box and written again replaces the whole box too', async () => {
  const s = setup({
    replies: { captureSelection: (args) => ({ text: args.selectAll ? 'pls come' : '' }) },
    answers: [reply({ kind: 'box' }), reply({ text: 'Please come.' })],
  });
  await s.actions.open();
  await s.actions.send('make it polite');
  assert.deepStrictEqual(lastItem(s).buttons, ['replace', 'copy']);
});

test('an empty box: the panel comes back and says so, and the AI is not asked again', async () => {
  const s = setup({ replies: { captureSelection: { text: '' } }, answers: [reply({ kind: 'box' })] });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('fix my english');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'captureSelection', 'showPanel']);
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: 'That box looks empty.', code: 'empty_box', buttons: [] });
  assert.deepStrictEqual(moods(s.log), ['thinking', 'idle']);
  assert.strictEqual(s.actions.state().busy, false);
});

test('a box that cannot be read: the panel comes back with the reason and Try again', async () => {
  const s = setup({
    replies: { captureSelection: (args) => { if (args.selectAll) throw failure('secure_field', "I don't read password fields."); return { text: '' }; } },
    answers: [reply({ kind: 'box' })],
  });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('fix my english');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'captureSelection', 'showPanel']);
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: "I don't read password fields.", code: 'secure_field', buttons: ['retry'] });
  assert.strictEqual(entries(s.log, 'showPanel').at(-1)[1].resumed, true);
  assert.deepStrictEqual(moods(s.log), ['thinking', 'idle']);
});

test('with no app known, the box cannot be read and the panel stays where it is', async () => {
  const s = setup({ lastApp: null, answers: [reply({ kind: 'box' })] });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('fix my english');
  assert.deepStrictEqual(steps(s.log, from), ['ask']);
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: 'Click in the box you are writing in, then open me again.', code: 'no_app', buttons: [] });
});

test('while the box is being read, the shortcut and a click on the buddy do nothing', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const s = setup({
    replies: { captureSelection: (args) => (args.selectAll ? gate.then(() => ({ text: 'whole text' })) : { text: '' }) },
    answers: [reply({ kind: 'box' })],
  });
  await s.actions.open();
  const from = s.log.length;
  const sending = s.actions.send('fix my english');
  while (!entries(s.log, 'hidePanel').length) await new Promise(setImmediate);
  await s.actions.toggle(); // the panel is hidden on purpose, so this would open it a second time
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'captureSelection']);
  release();
  await sending;
  assert.deepStrictEqual(steps(s.log, from).slice(0, 4), ['ask', 'hidePanel', 'captureSelection', 'showPanel']);
  const after = s.log.length;
  await s.actions.toggle(); // the panel is back, so this closes it
  assert.deepStrictEqual(steps(s.log, after), ['hidePanel']);
});

test('a request about the screen: Buddy looks at the app and asks again with the picture', async () => {
  const s = setup({
    replies: { captureSelection: { text: 'Kal milte hain' }, screenshot: { image: 'base64-jpeg' } },
    answers: [reply({ kind: 'screen' }), reply({ kind: 'answer', text: 'It says: see you tomorrow.' })],
  });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('what is this?');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'screenshot', 'ask']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'screenshot', { pid: 7 }]);
  assert.deepStrictEqual(asked(s.log)[1], input({ message: 'what is this?', selection: 'Kal milte hain', image: 'base64-jpeg', step: 2 }));
  assert.deepStrictEqual(chatOf(s).map((item) => [item.type, item.text]), [
    ['you', 'what is this?'],
    ['event', '👀 Looked at Google Chrome'],
    ['buddy', 'It says: see you tomorrow.'],
  ]);
});

test('a screenshot that cannot be taken shows why, with Open Settings for the permission', async () => {
  const message = 'Buddy needs Screen Recording permission for Check screen. Open Settings (⚙︎) to allow it.';
  const s = setup({ replies: { screenshot: failure('no_screen_recording', message) }, answers: [reply({ kind: 'screen' })] });
  await s.actions.open();
  await s.actions.send('check my mail');
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: message, code: 'no_screen_recording', buttons: ['retry', 'settings'] });
  await s.actions.act(2, 'settings');
  assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['openSettings', 'permissions']]);
});

test('a second request for the box or the screen: Buddy could not find it', async () => {
  for (const kinds of [['box', 'screen'], ['screen', 'box'], ['box', 'box']]) {
    const s = setup({
      replies: { captureSelection: (args) => ({ text: args.selectAll ? 'some text' : '' }), screenshot: { image: 'jpeg' } },
      answers: kinds.map((kind) => reply({ kind })),
    });
    await s.actions.open();
    await s.actions.send('do it');
    assert.strictEqual(asked(s.log).length, 2, kinds.join(' then '));
    assert.deepStrictEqual(lastItem(s), {
      id: 3, type: 'error', text: "I couldn't find it. Select the text and ask me again.", code: 'not_found', buttons: [],
    }, kinds.join(' then '));
    assert.deepStrictEqual(moods(s.log), ['thinking', 'idle']);
  }
});

// Remembering

test('what the AI learned about the person is saved and shown, with Undo, which forgets it again', async () => {
  const s = setup({
    refuse: ['My PIN is 1234.'],
    answers: [reply({ kind: 'answer', say: 'Nice to meet you!', text: '', remember: ['Your name is Akshat.', 'My PIN is 1234.', 'You work at Acme.'] })],
  });
  await s.actions.open();
  await s.actions.send('I am Akshat from Acme, my PIN is 1234');
  assert.deepStrictEqual(entries(s.log, 'remember').map((e) => e[1]), ['Your name is Akshat.', 'My PIN is 1234.', 'You work at Acme.']);
  assert.deepStrictEqual(chatOf(s), [
    { id: 1, type: 'you', text: 'I am Akshat from Acme, my PIN is 1234' },
    { id: 2, type: 'event', text: '📝 Remembered: Your name is Akshat.', buttons: ['undo'] },
    { id: 3, type: 'event', text: '📝 Remembered: You work at Acme.', buttons: ['undo'] },
    { id: 4, type: 'buddy', say: 'Nice to meet you!', text: '', notes: [], buttons: [] },
  ]);
  assert.deepStrictEqual(await s.actions.act(3, 'undo'), {});
  assert.deepStrictEqual(entries(s.log, 'forget'), [['forget', 'fact-2']]);
  assert.deepStrictEqual(s.memory.facts(), ['Your name is Akshat.']);
  assert.deepStrictEqual(chatOf(s)[2], { id: 3, type: 'event', text: 'Okay, I forgot that.', buttons: [] });
  assert.deepStrictEqual(entries(s.log, 'hidePanel'), [], 'the panel stays open');
});

// Doing it in the app

test('"do it": the text goes in at the cursor, the panel stays hidden, and the bubble says so', async () => {
  const s = setup({ answers: [reply({ say: 'Done!', text: 'Dear Sir,', doIt: true })] });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('write a mail to my boss here');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'paste', 'bubble']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'Dear Sir,', selectAll: false }]);
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', "Done! It's in Google Chrome ✅"]]);
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'buddy', say: 'Done!', text: 'Dear Sir,', notes: [], buttons: ['undo', 'copy'] },
    { id: 3, type: 'event', text: '✅ Put it in Google Chrome', buttons: [] },
  ]);
  assert.deepStrictEqual(moods(s.log), ['thinking', 'happy']);
  assert.strictEqual(s.actions.state().busy, false);
});

test('"do it" on the selection replaces it, and on the box replaces the whole box', async () => {
  const selection = setup({ replies: { captureSelection: { text: 'me go' } }, answers: [reply({ kind: 'fix', text: 'I go.', doIt: true })] });
  await selection.actions.open();
  await selection.actions.send('');
  assert.deepStrictEqual(entries(selection.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'I go.', selectAll: false }]);

  const box = setup({
    replies: { captureSelection: (args) => ({ text: args.selectAll ? 'me go' : '' }) },
    answers: [reply({ kind: 'box' }), reply({ kind: 'fix', text: 'I go.', doIt: true })],
  });
  await box.actions.open();
  await box.actions.send('fix my english');
  assert.deepStrictEqual(entries(box.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: 'I go.', selectAll: true }]);
});

test('an answer only (no "do it"), or a "do it" with nothing written, puts nothing in the app', async () => {
  for (const answer of [reply({ kind: 'answer', text: 'It means leave.', doIt: true }), reply({ say: 'Hmm?', text: '', doIt: true }), reply({ text: 'Dear Sir,' })]) {
    const s = setup({ answers: [answer] });
    await s.actions.open();
    await s.actions.send('go');
    assert.deepStrictEqual(entries(s.log, 'hidePanel'), [], JSON.stringify(answer));
    assert.deepStrictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'paste'), []);
  }
});

test('when the text cannot go in, it is copied: the bubble and the chat say to paste it', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ replies: { paste: failure('not_frontmost') }, answers: [reply({ text: 'Dear Sir,', doIt: true, send: true })] });
  await s.actions.open();
  await s.actions.send('write and send it');
  assert.strictEqual(s.clipboard.text, 'Dear Sir,');
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', COPIED]]);
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'buddy', say: '', text: 'Dear Sir,', notes: [], buttons: ['insert', 'copy'] },
    { id: 3, type: 'event', text: COPIED, buttons: [] },
  ], 'and no "Send it?": nothing was put in');
  assert.deepStrictEqual(entries(s.log, 'showPanel').length, 1, 'the panel stays hidden');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] paste failed, copied instead:', 'not_frontmost']]);
});

test('with no app known, "do it" copies the text', async () => {
  const s = setup({ lastApp: null, answers: [reply({ text: 'Dear Sir,', doIt: true })] });
  await s.actions.open();
  await s.actions.send('write it');
  assert.deepStrictEqual(steps(s.log, 1), ['ask', 'hidePanel', 'bubble']);
  assert.strictEqual(s.clipboard.text, 'Dear Sir,');
});

test('"reply and send it": once the text is in, the panel comes back and asks "Send it?"', async () => {
  const s = setup({ answers: [reply({ text: 'Thanks, see you!', doIt: true, send: true })] });
  await s.actions.open();
  const from = s.log.length;
  await s.actions.send('reply thanks and send it');
  assert.deepStrictEqual(steps(s.log, from), ['ask', 'hidePanel', 'paste', 'bubble', 'showPanel']);
  const back = entries(s.log, 'showPanel').at(-1)[1];
  assert.deepStrictEqual([back.resumed, back.busy], [true, false]);
  assert.deepStrictEqual(back.chat.at(-1), { id: 4, type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] });
});

test('"send it" later asks "Send it?" too', async () => {
  const s = setup({ answers: [reply({ kind: 'send', say: 'Sending.' })] });
  await s.actions.open();
  await s.actions.send('send it');
  assert.deepStrictEqual(chatOf(s), [
    { id: 1, type: 'you', text: 'send it' },
    { id: 2, type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] },
  ]);
});

// The buttons

async function askedToSend(options = {}) {
  const s = setup({ answers: [reply({ kind: 'send' })], replies: { windowTitle: { title: 'Inbox - Gmail' } }, ...options });
  await s.actions.open();
  await s.actions.send('send it');
  return s;
}

test('Send: Buddy finds the send key for the app and its window, steps aside and presses it', async () => {
  const s = await askedToSend();
  const from = s.log.length;
  assert.deepStrictEqual(await s.actions.act(2, 'send'), {});
  assert.deepStrictEqual(steps(s.log, from), ['windowTitle', 'hidePanel', 'press', 'bubble']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-2), ['helper', 'windowTitle', { pid: 7 }]);
  assert.deepStrictEqual(entries(s.log, 'sendKeyFor'), [['sendKeyFor', { ...APP, title: 'Inbox - Gmail' }, 'darwin']]);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'press', { pid: 7, key: 'return', modifiers: ['cmd'] }]);
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', 'Sent ✅']]);
  assert.deepStrictEqual(chatOf(s)[1], { id: 2, type: 'event', text: '✅ Sent', buttons: [] });
  assert.strictEqual(moods(s.log).at(-1), 'happy');
});

test('a second press of Send while the first is under way is refused: one send, not two', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const s = await askedToSend({ replies: { windowTitle: () => gate.then(() => ({ title: '' })) } });
  const first = s.actions.act(2, 'send');
  await assert.rejects(s.actions.act(2, 'send'), { code: 'bad_request' });
  release();
  await first;
  assert.strictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'press').length, 1);
});

test("Send in an app whose send key Buddy doesn't know: it says to press Send, and presses nothing", async () => {
  const s = await askedToSend({ sendKey: null });
  await s.actions.act(2, 'send');
  assert.deepStrictEqual(chatOf(s)[1], {
    id: 2, type: 'buddy', say: "I don't know how to send in Google Chrome. Press Send yourself.", text: '', notes: [], buttons: [],
  });
  assert.deepStrictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'press'), []);
  assert.deepStrictEqual(entries(s.log, 'hidePanel'), []);
});

test('Send when the window title cannot be read goes by the app alone', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = await askedToSend({ replies: { windowTitle: failure('timeout') } });
  await s.actions.act(2, 'send');
  assert.deepStrictEqual(entries(s.log, 'sendKeyFor')[0][1], { ...APP, title: '' });
  assert.deepStrictEqual(chatOf(s)[1].text, '✅ Sent');
});

test('Send that cannot press the key: the panel comes back with the reason, and the question stays', async () => {
  const s = await askedToSend({ replies: { windowTitle: { title: '' }, press: failure('secure_field', "I don't type into password fields.") } });
  await s.actions.act(2, 'send');
  assert.deepStrictEqual(chatOf(s).slice(1), [
    { id: 2, type: 'question', text: 'Send it?', buttons: ['send', 'not-now'] },
    { id: 3, type: 'error', text: "I don't type into password fields.", code: 'secure_field', buttons: [] },
  ]);
  assert.strictEqual(entries(s.log, 'showPanel').at(-1)[1].resumed, true);
});

test('Not now: nothing is sent', async () => {
  const s = await askedToSend();
  await s.actions.act(2, 'not-now');
  assert.deepStrictEqual(chatOf(s)[1], { id: 2, type: 'event', text: 'Okay, not sent.', buttons: [] });
  assert.deepStrictEqual(entries(s.log, 'helper').filter((e) => ['windowTitle', 'press'].includes(e[1])), []);
});

test('Undo on text Buddy put in the app presses ⌘Z there once, and the Undo button goes', async () => {
  const s = setup({ answers: [reply({ text: 'Dear Sir,', doIt: true })] });
  await s.actions.open();
  await s.actions.send('write it here');
  await s.actions.open(); // the panel opens again on the same chat
  const from = s.log.length;
  await s.actions.act(2, 'undo');
  assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'press', 'bubble']);
  assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'press', { pid: 7, key: 'z', modifiers: ['cmd'] }]);
  assert.deepStrictEqual(entries(s.log, 'bubble').at(-1), ['bubble', 'Undone']);
  assert.deepStrictEqual(chatOf(s)[1].buttons, ['copy']);
});

test('on Windows Undo presses Ctrl+Z', async () => {
  const s = setup({ windows: true, answers: [reply({ text: 'Dear Sir,', doIt: true })] });
  await s.actions.open();
  await s.actions.send('write it here');
  await s.actions.act(2, 'undo');
  assert.deepStrictEqual(entries(s.log, 'helper').filter((e) => e[1] === 'press'), [['helper', 'press', { pid: 7, key: 'z', modifiers: ['ctrl'] }]]);
});

test('an Undo that cannot press the key: the panel comes back with the reason', async () => {
  const s = setup({ replies: { press: failure('not_frontmost', 'Could not switch back to that app.') }, answers: [reply({ text: 'Dear Sir,', doIt: true })] });
  await s.actions.open();
  await s.actions.send('write it here');
  await s.actions.act(2, 'undo');
  assert.deepStrictEqual(chatOf(s)[1].buttons, ['undo', 'copy']);
  assert.deepStrictEqual(lastItem(s), { id: 4, type: 'error', text: 'Could not switch back to that app.', code: 'not_frontmost', buttons: [] });
  assert.strictEqual(entries(s.log, 'showPanel').at(-1)[1].resumed, true);
});

test('Insert and Replace put an answer in the app as "do it" does', async () => {
  for (const [selected, answer, button, selectAll] of [
    ['', reply({ text: 'Dear Sir,' }), 'insert', false],
    ['me go', reply({ kind: 'fix', text: 'I go.' }), 'replace', false],
  ]) {
    const s = setup({ replies: { captureSelection: { text: selected } }, answers: [answer] });
    await s.actions.open();
    await s.actions.send('go');
    const from = s.log.length;
    await s.actions.act(2, button);
    assert.deepStrictEqual(steps(s.log, from), ['hidePanel', 'paste', 'bubble'], button);
    assert.deepStrictEqual(entries(s.log, 'helper').at(-1), ['helper', 'paste', { pid: 7, text: answer.text, selectAll }], button);
    assert.deepStrictEqual(chatOf(s).slice(1), [
      { id: 2, type: 'buddy', say: '', text: answer.text, notes: [], buttons: ['undo', 'copy'] },
      { id: 3, type: 'event', text: '✅ Put it in Google Chrome', buttons: [] },
    ], button);
  }
});

test('Copy puts the text on the clipboard and says so, and the panel stays open', async () => {
  const s = setup({ answers: [reply({ text: 'Dear Sir,' })] });
  await s.actions.open();
  await s.actions.send('mail');
  await s.actions.act(2, 'copy');
  assert.strictEqual(s.clipboard.text, 'Dear Sir,');
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', 'Copied']]);
  assert.deepStrictEqual(entries(s.log, 'hidePanel'), []);
});

test('a button that is not on that item, or an item that is not there, is refused', async () => {
  const s = setup({ answers: [reply({ kind: 'answer', text: 'It means leave.' })] });
  await s.actions.open();
  await s.actions.send('meaning?');
  for (const [id, button] of [[2, 'insert'], [2, 'send'], [1, 'copy'], [9, 'copy'], ['2', 'copy'], [2, 'constructor']]) {
    await assert.rejects(s.actions.act(id, button), { code: 'bad_request' }, `${id} ${button}`);
  }
  assert.strictEqual(s.clipboard.text, null);
});

// Errors

test('an AI error shows in the chat with Try again, and Open Settings when the fix is there', async (t) => {
  const errorLog = t.mock.method(console, 'error', () => {});
  const cases = [
    [failure('no_key', 'Add your API key in Settings first.'), ['retry', 'settings']],
    [failure('bad_key', 'Your Claude key was rejected. Check it in Settings.'), ['retry', 'settings']],
    [failure('signed_out', 'Sign in to use Buddy.'), ['retry', 'settings']],
    [failure('need_key', 'Add your own key.'), ['retry', 'settings']],
    [failure('rate_limited', 'Claude is busy right now. Try again in a minute.'), ['retry']],
    [failure('network', "Couldn't reach Claude. Check your internet."), ['retry']],
    [failure('bad_request', 'That is too long (over 1000 characters). Try a shorter one.'), []],
  ];
  for (const [err, buttons] of cases) {
    const s = setup({ answers: [err] });
    await s.actions.open();
    await s.actions.send('mail');
    assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: err.message, code: err.code, buttons }, err.code);
    assert.strictEqual(s.actions.state().busy, false);
  }
  // Anything else is a bug or a system failure, whose own words would mean nothing to the person: it is logged.
  const s = setup({ answers: [new TypeError('x is not a function')] });
  await s.actions.open();
  await s.actions.send('mail');
  assert.deepStrictEqual(lastItem(s), { id: 2, type: 'error', text: 'Something went wrong. Try again.', code: 'failed', buttons: ['retry'] });
  assert.strictEqual(errorLog.mock.callCount(), 1);
});

test('Try again sends the same message again, in place of the error', async () => {
  const s = setup({
    replies: { captureSelection: { text: 'me go' } },
    answers: [failure('rate_limited', 'Busy.'), reply({ kind: 'fix', text: 'I go.' })],
  });
  await s.actions.open();
  await s.actions.send('');
  assert.deepStrictEqual(lastItem(s).type, 'error');
  assert.deepStrictEqual(await s.actions.act(2, 'retry'), {});
  assert.deepStrictEqual(asked(s.log), [input({ message: 'Fix this.', selection: 'me go' }), input({ message: 'Fix this.', selection: 'me go' })]);
  assert.deepStrictEqual(chatOf(s), [
    { id: 1, type: 'you', text: 'Fix this.' },
    { id: 3, type: 'buddy', say: '', text: 'I go.', notes: [], buttons: ['replace', 'copy'] },
  ]);
});

test('Open Settings goes to the AI section for a key, model or free-mode problem, and to the start otherwise', async () => {
  for (const [code, section] of [['no_key', 'ai'], ['free_off', 'ai'], ['bad_model', 'ai'], ['signed_out', undefined], ['not_set_up', undefined]]) {
    const s = setup({ answers: [failure(code, 'Fix it in Settings.')] });
    await s.actions.open();
    await s.actions.send('mail');
    await s.actions.act(2, 'settings');
    assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['openSettings', section]], code);
  }
});

test('the panel only stepped aside for Settings: opening it again shows the same chat', async () => {
  const s = setup({ answers: [failure('no_key', 'Add your API key in Settings first.')] });
  await s.actions.open();
  await s.actions.send('mail');
  await s.actions.act(2, 'settings');
  await s.actions.open();
  assert.strictEqual(entries(s.log, 'showPanel').at(-1)[1].chat.length, 2);
});

// Moods

test('no internet makes the buddy sleepy for a while', async () => {
  const s = setup({ answers: [failure('network', "Couldn't reach Claude.")] });
  await s.actions.open();
  await s.actions.send('mail');
  assert.deepStrictEqual(moods(s.log), ['thinking', 'sleepy']);
  assert.strictEqual(s.timers[0].ms, 5000);
  s.timers[0].fn();
  assert.deepStrictEqual(moods(s.log).at(-1), 'idle');
});

test('other errors put the buddy back to idle, an answer that takes too long too: it is not "no internet"', async () => {
  for (const err of [failure('bad_key'), failure('timeout', 'Claude took too long to answer. Try again.')]) {
    const s = setup({ answers: [err] });
    await s.actions.open();
    await s.actions.send('mail');
    assert.deepStrictEqual(moods(s.log), ['thinking', 'idle'], err.code);
    assert.strictEqual(s.timers.length, 0, 'no "sleepy for a while" timer');
  }
});

test('a new message cancels the pending "sleepy, then idle" timer', async () => {
  const s = setup({ answers: [failure('network'), reply({ text: 'ok' })] });
  await s.actions.open();
  await s.actions.send('mail');
  assert.strictEqual(s.timers.length, 1);
  assert.strictEqual(s.cancelled.length, 0);
  await s.actions.send('mail');
  assert.deepStrictEqual(s.cancelled, [s.timers[0]]);
});

// The clipboard

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

test('"Copied — press ⌘V" is said only once the text is on the clipboard', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const clipboard = asyncClipboard();
  const s = setup({ replies: { paste: failure('not_frontmost') }, clipboard, answers: [reply({ text: 'Hello' })] });
  await s.actions.open();
  await s.actions.send('hi');
  let answered = false;
  const inserting = s.actions.act(2, 'insert').then((r) => {
    answered = true;
    return r;
  });
  while (!clipboard.writes.length) await tick();
  assert.strictEqual(answered, false, 'insert has not answered yet');
  assert.strictEqual(entries(s.log, 'bubble').length, 0, 'and the bubble does not say "Copied" yet');
  clipboard.writes[0].done();
  assert.deepStrictEqual(await inserting, {});
  assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', COPIED]]);
});

test('a clipboard that cannot be written makes Insert fail instead of saying it copied', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const clipboard = asyncClipboard();
  const s = setup({ replies: { paste: failure('not_frontmost') }, clipboard, answers: [reply({ text: 'Hello' })] });
  await s.actions.open();
  await s.actions.send('hi');
  const inserting = s.actions.act(2, 'insert');
  while (!clipboard.writes.length) await tick();
  clipboard.writes[0].fail(new Error('the pasteboard is busy'));
  await assert.rejects(inserting, { message: 'the pasteboard is busy' });
  assert.strictEqual(entries(s.log, 'bubble').length, 0);
});

test('Copy says "Copied" only once the text is on the clipboard, and fails when it cannot be written', async () => {
  for (const works of [true, false]) {
    const clipboard = asyncClipboard();
    const s = setup({ clipboard, answers: [reply({ text: 'Hi' })] });
    await s.actions.open();
    await s.actions.send('hi');
    const copying = s.actions.act(2, 'copy');
    while (!clipboard.writes.length) await tick();
    assert.strictEqual(entries(s.log, 'bubble').length, 0);
    if (works) {
      clipboard.writes[0].done();
      await copying;
      assert.deepStrictEqual(entries(s.log, 'bubble'), [['bubble', 'Copied']]);
    } else {
      clipboard.writes[0].fail(new Error('the pasteboard is busy'));
      await assert.rejects(copying, { message: 'the pasteboard is busy' });
      assert.strictEqual(entries(s.log, 'bubble').length, 0);
    }
  }
});

test('the "copied" bubble names the keys that paste: ⌘V on the Mac, Ctrl+V on Windows', () => {
  const file = path.join(__dirname, '..', 'src', 'main', 'actions.js');
  assert.strictEqual(onPlatform('darwin', file, (m) => m.COPIED), 'Copied — press ⌘V');
  assert.strictEqual(onPlatform('win32', file, (m) => m.COPIED), 'Copied — press Ctrl+V');
});

test('on Windows what goes on the clipboard has Windows line breaks, which every Windows app understands', async () => {
  const s = setup({ windows: true, lastApp: null, answers: [reply({ text: 'Dear Sir,\nThanks.\r\nBye' }), reply({ text: 'a\nb', doIt: true })] });
  await s.actions.open();
  await s.actions.send('mail');
  await s.actions.act(2, 'copy');
  assert.strictEqual(s.clipboard.text, 'Dear Sir,\r\nThanks.\r\nBye');
  await s.actions.send('another');
  assert.strictEqual(s.clipboard.text, 'a\r\nb');
});

test('on the Mac the clipboard gets the text as it is', async () => {
  const s = setup({ lastApp: null, answers: [reply({ text: 'a\nb' })] });
  await s.actions.open();
  await s.actions.send('mail');
  await s.actions.act(2, 'copy');
  assert.strictEqual(s.clipboard.text, 'a\nb');
});

// The keyboard on Windows

test('on Windows, closing the panel hands the keyboard back to the app it was opened from: Windows leaves it with the hidden panel', async () => {
  const s = setup({ windows: true });
  await s.actions.toggle();
  await s.actions.toggle();
  assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['helper', 'activate', { pid: 7 }]]);
  await s.actions.open();
  await s.actions.dismiss(); // Esc and the close button
  assert.deepStrictEqual(s.log.slice(-2), [['hidePanel'], ['helper', 'activate', { pid: 7 }]]);
});

test('on Windows, with no app known there is nothing to hand the keyboard back to', async () => {
  const s = setup({ windows: true, lastApp: null });
  await s.actions.open();
  await s.actions.dismiss();
  assert.deepStrictEqual(s.log.slice(-1), [['hidePanel']]);
});

test('on Windows, a hand-back or a bring-forward that fails is logged, not thrown', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ windows: true, replies: { activate: failure('not_frontmost'), focusWindow: failure('not_frontmost') } });
  await assert.doesNotReject(s.actions.open());
  await assert.doesNotReject(s.actions.dismiss());
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [
    ['[buddy] could not bring the panel forward:', 'not_frontmost'],
    ['[buddy] could not switch back to the app:', 'not_frontmost'],
  ]);
});

test('on Windows the helper brings the panel forward once it is shown, and again each time it comes back', async () => {
  const s = setup({
    windows: true,
    replies: { captureSelection: (args) => ({ text: args.selectAll ? 'me go' : '' }) },
    answers: [reply({ kind: 'box' }), reply({ kind: 'fix', text: 'I go.', doIt: true, send: true })],
  });
  await s.actions.open();
  await s.actions.send('fix and send it');
  const shown = s.log.flatMap((e, i) => (e[0] === 'showPanel' ? [i] : []));
  assert.strictEqual(shown.length, 3);
  for (const i of shown) assert.deepStrictEqual(s.log[i + 1], ['helper', 'focusWindow', { hwnd: 4242 }]);
});

test('on the Mac the panel takes and gives back the keyboard by itself: no activate, no focusWindow', async () => {
  const s = setup({ replies: { captureSelection: { text: 'me go' } }, answers: [reply({ kind: 'box' })] });
  await s.actions.toggle();
  await s.actions.send('fix');
  await s.actions.toggle();
  await s.actions.open();
  await s.actions.dismiss();
  // The selection at each opening, and the box once.
  assert.deepStrictEqual(entries(s.log, 'helper').map((e) => e[1]), ['captureSelection', 'captureSelection', 'captureSelection']);
});
