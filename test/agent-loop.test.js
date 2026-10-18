'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createAgentJob, goOnHeard, LOOP_LINES } = require('../shared/agent/loop');
const { el, fakeHands, brain, gate, step } = require('./helpers/agent-fakes');

const LIMITS = { maxSteps: 10, maxMs: 60_000, maxShots: 5 };
const SETTINGS_SCREEN = {
  app: { name: 'System Settings', id: 'com.apple.systempreferences' },
  elements: [el('e1', 'row', 'Appearance'), el('e2', 'row', 'Wi-Fi'), el('e3', 'row', 'Sound'), el('e4', 'row', 'Display'), el('e5', 'row', 'Focus')],
};
const APPEARANCE = { ...SETTINGS_SCREEN, elements: [el('e1', 'popup', 'Appearance'), el('e2', 'radio', 'Dark'), el('e3', 'radio', 'Light'), el('e4', 'text', 'Accent'), el('e5', 'text', 'Highlight')] };
const FILES = { elements: [el('e1', 'row', 'a.pdf'), el('e2', 'row', 'b.pdf'), el('e3', 'row', 'c'), el('e4', 'row', 'd'), el('e5', 'row', 'e')] };

function job({ replies, screens = { settings: SETTINGS_SCREEN, appearance: APPEARANCE, files: FILES }, start = 'settings', moves = {}, answers, limits = LIMITS, vision = true, now, handovers, exists, fail }) {
  const hands = fakeHands({ screens, start, moves, exists, fail });
  const b = brain(replies);
  const g = gate({ answers, handovers });
  const shown = [];
  const j = createAgentJob({ goal: 'Turn on dark mode', brain: b, hands, gate: g, show: (e) => shown.push(e), limits, vision, now, sleep: async () => {} });
  return { j, hands, b, g, shown };
}

test('a job that works: each step shown, acted, logged; done ends it with the summary', async () => {
  const s = job({
    replies: [step('Opening Appearance…', { type: 'click', id: 'e1' }), step('Choosing Dark…', { type: 'click', id: 'e2' }), step('', { type: 'done', summary: 'Dark mode is on.' })],
    moves: { 'settings:click:e1': 'appearance' },
  });
  const r = await s.j.run();
  assert.strictEqual(r.end, 'done');
  assert.strictEqual(r.line, 'Dark mode is on.');
  assert.deepStrictEqual(s.hands.acts, [{ type: 'click', id: 'e1' }, { type: 'click', id: 'e2' }]);
  assert.deepStrictEqual(s.shown.map((e) => e.text), ['Opening Appearance…', 'Choosing Dark…']);
  assert.deepStrictEqual(s.b.inputs[2].log, ['1. click e1 → ok', '2. click e2 → ok']);
  assert.strictEqual(s.b.inputs[0].step, 1);
  assert.strictEqual(s.b.inputs[0].maxSteps, 10);
});

test('a risky step asks with the device\'s question; yes acts, no is logged and not acted', async () => {
  const yes = job({ start: 'files', answers: ['yes'], replies: [step('Deleting…', { type: 'files', op: 'trash', path: '/Users/a/a.pdf' }), step('', { type: 'done', summary: 'Gone.' })] });
  await yes.j.run();
  assert.deepStrictEqual(yes.g.asked, [['ask', 'Move "a.pdf" to the Trash?']]);
  assert.strictEqual(yes.hands.acts.length, 1);
  const no = job({ start: 'files', answers: ['no'], replies: [step('Deleting…', { type: 'files', op: 'trash', path: '/Users/a/a.pdf' }), step('', { type: 'done', summary: 'Left it.' })] });
  await no.j.run();
  assert.strictEqual(no.hands.acts.length, 0);
  assert.deepStrictEqual(no.b.inputs[1].log, ['1. files trash "/Users/a/a.pdf" → the person said no']);
});

test('a never step is refused and the AI is told why; a password field is never typed into', async () => {
  const s = job({ screens: { login: { secureFocused: true, elements: [el('e1', 'password-field', 'Password')] } }, start: 'login', replies: [step('Typing…', { type: 'type', text: 'hunter2' }), step('', { type: 'stuck', reason: 'Needs a password.' })] });
  const r = await s.j.run();
  assert.strictEqual(s.hands.acts.length, 0);
  assert.match(s.b.inputs[1].log[0], /not allowed: I don't type into password fields/);
  assert.strictEqual(r.end, 'stuck');
});

test('stale element ids and click_at without a screenshot are refused without acting', async () => {
  const s = job({ replies: [step('', { type: 'click', id: 'e99' }), step('', { type: 'click_at', x: 1, y: 1 }), step('', { type: 'done', summary: 'ok' })], vision: false });
  await s.j.run();
  assert.strictEqual(s.hands.acts.length, 0);
  assert.match(s.b.inputs[1].log[0], /e99 is not on the screen now/);
  assert.match(s.b.inputs[2].log[1], /needs a screenshot first/);
});

test('look asks for a screenshot on the next step; a poor tree gets one by itself; none for a blind model', async () => {
  const s = job({ replies: [step('', { type: 'look' }), step('', { type: 'done', summary: 'ok' })] });
  await s.j.run();
  assert.deepStrictEqual(s.hands.looks, [false, false, true]);
  const poor = job({ screens: { canvas: { elements: [el('e1', 'webarea', '')] } }, start: 'canvas', replies: [step('', { type: 'done', summary: 'ok' })] });
  await poor.j.run();
  assert.deepStrictEqual(poor.hands.looks, [false, true]);
  const blind = job({ screens: { canvas: { elements: [el('e1', 'webarea', '')] } }, start: 'canvas', vision: false, replies: [step('', { type: 'look' }), step('', { type: 'done', summary: 'ok' })] });
  await blind.j.run();
  assert.deepStrictEqual(blind.hands.looks, [false, false]);
});

test('the step limit ends the job with how far it got', async () => {
  const replies = Array.from({ length: 5 }, (_, i) => step(`Step ${i + 1}…`, { type: 'scroll', dir: i % 2 ? 'up' : 'down' }));
  const s = job({ replies, limits: { ...LIMITS, maxSteps: 3 } });
  const r = await s.j.run();
  assert.strictEqual(r.end, 'limit');
  assert.strictEqual(r.line, "I couldn't finish in 3 steps. I got as far as: Step 1, Step 2, Step 3.");
});

test('the time limit ends the job', async () => {
  let t = 0;
  const s = job({ replies: [step('A…', { type: 'scroll', dir: 'down' }), step('B…', { type: 'scroll', dir: 'up' })], now: () => { t += 40_000; return t; } });
  const r = await s.j.run();
  assert.strictEqual(r.end, 'limit');
});

test('two bad replies in a row: stuck; one bad reply is retried with the reason', async () => {
  const one = job({ replies: ['not json', step('', { type: 'done', summary: 'ok' })] });
  assert.strictEqual((await one.j.run()).end, 'done');
  assert.match(one.b.inputs[1].note, /JSON/);
  const two = job({ replies: ['nope', 'still nope'] });
  const r = await two.j.run();
  assert.strictEqual(r.end, 'stuck');
  assert.match(r.line, new RegExp(LOOP_LINES.badReplies.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
});

test('three failed acts in a row, or the same act on the same screen three times: stuck', async () => {
  const fails = job({ replies: [1, 2, 3].map(() => step('', { type: 'click', id: 'e3' })), fail: ['settings:click:e3'] });
  assert.match((await fails.j.run()).line, /Three steps in a row did not work/);
  const same = job({ replies: [1, 2, 3].map(() => step('', { type: 'click', id: 'e3' })) });
  assert.match((await same.j.run()).line, /I keep trying the same thing/);
});

test('stop during the AI call ends at once with "Stopped." and nothing more is acted', async () => {
  const s = job({ replies: [(input, signal) => new Promise((resolve, reject) => { signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))); setImmediate(() => s.j.stop('esc')); })] });
  const r = await s.j.run();
  assert.deepStrictEqual([r.end, r.line], ['stopped', 'Stopped.']);
  assert.strictEqual(s.hands.acts.length, 0);
});

test('stop while a question waits: the step is not acted', async () => {
  const g = { asked: [], async ask() { s.j.stop('voice'); return 'yes'; }, async askUser() { return null; }, async handover() { return false; } };
  const s = job({ start: 'files', replies: [step('', { type: 'files', op: 'trash', path: '/a/a.pdf' })] });
  s.j = createAgentJob({ goal: 'x', brain: s.b, hands: s.hands, gate: g, show: () => {}, limits: LIMITS, sleep: async () => {} });
  const r = await s.j.run();
  assert.strictEqual(r.end, 'stopped');
  assert.strictEqual(s.hands.acts.length, 0);
});

test('stop with reason locked says the screen locked', async () => {
  const s = job({ replies: [() => { s.j.stop('locked'); return step('', { type: 'look' }); }] });
  assert.strictEqual((await s.j.run()).line, LOOP_LINES.locked);
});

test('pause (you took over) waits for go on: yes goes on, no stops', async () => {
  let s;
  s = job({ handovers: [true], replies: [() => { s.j.pause(); return step('A…', { type: 'scroll', dir: 'down' }); }, step('', { type: 'done', summary: 'ok' })] });
  assert.strictEqual((await s.j.run()).end, 'done');
  assert.deepStrictEqual(s.g.asked, [['handover', LOOP_LINES.tookOver]]);
  assert.strictEqual(s.g.handoverOptions[0].tookOver, true, 'the gate waits 30 s for a take-over, not 2 minutes');
  s = job({ handovers: [false], replies: [() => { s.j.pause(); return step('A…', { type: 'scroll', dir: 'down' }); }] });
  assert.strictEqual((await s.j.run()).end, 'stopped');
});

test('a job that reaches a password app ends at once, before the AI sees the screen', async () => {
  const s = job({
    screens: { pw: { app: { name: '1Password', id: 'com.1password.1password' }, elements: [el('e1', 'button', 'Unlock')] } },
    start: 'pw',
    replies: [step('', { type: 'click', id: 'e1' })],
  });
  const r = await s.j.run();
  assert.deepStrictEqual([r.end, r.line], ['stuck', LOOP_LINES.passwordApp]);
  assert.deepStrictEqual([s.b.inputs.length, s.hands.acts.length, s.hands.looks], [0, 0, [false]]);
});

test('refused steps count as failures; the same declined step three times is the same thing', async () => {
  const login = { login: { secureFocused: true, elements: [el('e1', 'password-field', 'Password')] } };
  const refused = job({ screens: login, start: 'login', replies: [1, 2, 3].map(() => step('', { type: 'type', text: 'hunter2' })) });
  assert.match((await refused.j.run()).line, /Three steps in a row did not work/);
  assert.strictEqual(refused.hands.acts.length, 0);
  const trash = step('', { type: 'files', op: 'trash', path: '/a/a.pdf' });
  const declined = job({ start: 'files', answers: ['no', 'no', 'no'], replies: [trash, trash, trash] });
  assert.match((await declined.j.run()).line, /I keep trying the same thing/);
  assert.strictEqual(declined.hands.acts.length, 0);
});

test('stop during an act aborts it through the job\'s signal (a running command is killed)', async () => {
  const s = job({ replies: [step('', { type: 'run', command: 'ls' })] });
  let aborted = false;
  s.hands.act = (action, observation, { signal }) => new Promise((resolve) => {
    signal.addEventListener('abort', () => { aborted = true; resolve({ ok: false, code: 'stopped', note: 'Stopped.' }); });
    setImmediate(() => s.j.stop('esc'));
  });
  const r = await s.j.run();
  assert.deepStrictEqual([r.end, r.line, aborted], ['stopped', 'Stopped.', true]);
});

test('a rename asks whether its new name exists in the file\'s own folder', async () => {
  const s = job({ start: 'files', replies: [step('', { type: 'files', op: 'rename', path: '/Users/a/Trip/a.txt', to: 'b.txt' }), step('', { type: 'done', summary: 'ok' })] });
  const seen = [];
  s.hands.exists = async (p, options) => { seen.push([p, options]); return false; };
  await s.j.run();
  assert.ok(seen.length >= 1);
  for (const one of seen) assert.deepStrictEqual(one, ['b.txt', { from: '/Users/a/Trip/a.txt' }]);
});

test('handover and ask_user go to the gate and their answers into the log', async () => {
  const s = job({ handovers: [true], replies: [step('', { type: 'handover', why: 'Please type your password yourself.' }), step('', { type: 'ask_user', question: 'Which file?' }), step('', { type: 'done', summary: 'ok' })] });
  await s.j.run();
  assert.deepStrictEqual(s.g.asked, [['handover', 'Please type your password yourself.'], ['askUser', 'Which file?']]);
  assert.deepStrictEqual(s.b.inputs[2].log, ['1. handover "Please type your password yourself." → the person did it', '2. ask_user "Which file?" → no answer']);
});

test('a run result goes to the next step as lastOutput', async () => {
  const s = job({ replies: [step('', { type: 'run', command: 'ls' }), step('', { type: 'done', summary: 'ok' })] });
  await s.j.run();
  assert.strictEqual(s.b.inputs[1].lastOutput, 'file1\nfile2');
});

test('an AI error ends the job as an error carrying it', async () => {
  const err = Object.assign(new Error('Add your API key in Settings first.'), { code: 'no_key' });
  const r = await job({ replies: [err] }).j.run();
  assert.strictEqual(r.end, 'error');
  assert.strictEqual(r.error, err);
});

test('the log keeps the last 12 steps and says how many earlier ones are hidden', async () => {
  const replies = Array.from({ length: 14 }, (_, i) => step('', { type: 'wait', ms: i }));
  replies.push(step('', { type: 'done', summary: 'ok' }));
  const s = job({ replies, limits: { ...LIMITS, maxSteps: 20 } });
  await s.j.run();
  const log = s.b.inputs[14].log;
  assert.strictEqual(log.length, 13);
  assert.strictEqual(log[0], '(2 earlier steps not shown)');
});

test('goOnHeard knows "go on" in English and Hinglish', () => {
  for (const t of ['go on', 'Okay, continue', 'ho gaya', 'done', 'chalo aage']) assert.strictEqual(goOnHeard(t), true, t);
  for (const t of ['', 'wait', 'no', null]) assert.strictEqual(goOnHeard(t), false, String(t));
});

test('a safe step the hands want approved is asked once, then acted with that exact question approved', async () => {
  const s = job({ start: 'files', answers: ['yes'], replies: [step('', { type: 'click', id: 'e1' }), step('', { type: 'done', summary: 'ok' })] });
  const real = s.hands.act.bind(s.hands);
  let first = true;
  s.hands.act = async (a, o, opts) => {
    if (first) { first = false; return { ok: false, code: 'needs_approval', note: 'x', question: 'Really?' }; }
    return real(a, o, opts);
  };
  await s.j.run();
  assert.deepStrictEqual(s.g.asked, [['ask', 'Really?']]);
  assert.strictEqual(s.hands.actOptions[0].approved, 'Really?');
});

test('approval does not carry over: the next step is asked again', async () => {
  const trash = (n) => step('', { type: 'files', op: 'trash', path: `/Users/a/${n}.pdf` });
  const s = job({ start: 'files', answers: ['yes', 'yes'], replies: [trash('a'), trash('b'), step('', { type: 'done', summary: 'ok' })] });
  await s.j.run();
  assert.strictEqual(s.g.asked.length, 2);
  assert.deepStrictEqual(s.hands.actOptions.map((o) => o.approved), ['Move "a.pdf" to the Trash?', 'Move "b.pdf" to the Trash?']);
});

test('needs_approval is asked at most twice; a no on the new question is declined', async () => {
  const s = job({ answers: ['yes', 'no'], replies: [step('', { type: 'click', id: 'e1' }), step('', { type: 'done', summary: 'ok' })] });
  let n = 0;
  s.hands.act = async () => ({ ok: false, code: 'needs_approval', note: 'x', question: `Q${++n}?` });
  await s.j.run();
  assert.deepStrictEqual(s.g.asked, [['ask', 'Q1?'], ['ask', 'Q2?']]);
  assert.match(s.b.inputs[1].log[0], /the person said no/);
  const endless = job({ answers: ['yes', 'yes', 'yes'], replies: [step('', { type: 'click', id: 'e1' }), step('', { type: 'done', summary: 'ok' })] });
  let m = 0;
  endless.hands.act = async () => ({ ok: false, code: 'needs_approval', note: 'x', question: `Q${++m}?` });
  await endless.j.run();
  assert.strictEqual(endless.g.asked.length, 2);
  assert.match(endless.b.inputs[1].log[0], /not allowed/);
});

test('helper and hands codes become failures or refusals the AI can read', async () => {
  for (const [code, kind] of [['refused', 'not allowed'], ['timeout', 'failed'], ['bad_key', 'failed'], ['bad_url', 'failed'], ['bad_query', 'failed'], ['focus_unknown', 'failed'], ['secure_field', 'failed'], ['stale_id', 'failed'], ['focus_failed', 'failed'], ['press_failed', 'failed']]) {
    const s = job({ replies: [step('', { type: 'click', id: 'e1' }), step('', { type: 'done', summary: 'ok' })] });
    s.hands.act = async () => ({ ok: false, code, note: `note ${code}` });
    await s.j.run();
    assert.strictEqual(s.b.inputs[1].log[0], `1. click e1 → ${kind}: note ${code}`, code);
  }
});

test('a password app is never photographed, even when the AI asked to look', async () => {
  const s = job({ screens: { pw: { app: { name: '1Password', id: 'com.1password.1password' }, elements: [] } }, start: 'pw', replies: [] });
  await s.j.run();
  assert.deepStrictEqual(s.hands.looks, [false]);
});

test('wait honours the stop at once', async () => {
  const s = job({ replies: [step('', { type: 'wait', ms: 3000 })] });
  const slow = createAgentJob({ goal: 'x', brain: s.b, hands: s.hands, gate: s.g, show: () => {}, limits: LIMITS, sleep: () => new Promise(() => {}) });
  setTimeout(() => slow.stop('esc'), 10);
  const r = await slow.run();
  assert.strictEqual(r.end, 'stopped');
});

test('an error shows a fixed line and the code, never the error message', async () => {
  const err = Object.assign(new Error('secret screen text'), { code: 'no_key' });
  const r = await job({ replies: [err] }).j.run();
  assert.strictEqual(r.line, 'Something went wrong (no_key).');
  assert.ok(!r.line.includes('secret'));
  const plain = await job({ replies: [new Error('secret')] }).j.run();
  assert.strictEqual(plain.line, 'Something went wrong.');
});

test('the question asked is for the canonical action the hands resolved', async () => {
  const s = job({ start: 'files', answers: ['yes'], replies: [step('', { type: 'files', op: 'trash', path: '/Users/a/link.pdf' }), step('', { type: 'done', summary: 'ok' })] });
  s.hands.canonical = async (a) => ({ ...a, path: '/Users/a/real.pdf' });
  await s.j.run();
  assert.deepStrictEqual(s.g.asked, [['ask', 'Move "real.pdf" to the Trash?']]);
});

test('the time limit is checked after a step, before the next', async () => {
  let t = 0;
  const times = [0, 0, 0, 100_000];
  const s = job({ replies: [step('A…', { type: 'scroll', dir: 'down' }), step('', { type: 'done', summary: 'ok' })], now: () => (t < times.length ? times[t++] : 100_000) });
  const r = await s.j.run();
  assert.strictEqual(r.end, 'limit');
});
