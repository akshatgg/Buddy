'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createAgentRunner, RUNNER_WAITS } = require('../src/main/agent/runner');
const { el, fakeHands } = require('./helpers/agent-fakes');

const SCREEN = { files: { elements: [el('e1', 'row', 'a.pdf'), el('e2', 'row', 'b'), el('e3', 'row', 'c'), el('e4', 'row', 'd'), el('e5', 'row', 'e')] } };
const TRASH = { say: '', action: { type: 'files', op: 'trash', path: '/a/a.pdf' } };
const DONE = { say: '', action: { type: 'done', summary: 'ok' } };
const settle = async () => { for (let i = 0; i < 30; i += 1) await new Promise((r) => { setImmediate(r); }); };

function setup({
  replies = [], info = { route: 'own', provider: 'anthropic', model: 'claude-sonnet-5-5', label: 'Claude', rank: 'best', vision: true },
  settings = { agentOn: true, agentAgreed: true }, perms = { accessibility: true, screenRecording: true }, heard = [], talk = true,
  locked = false, lock = null, waits = null, onAsk = () => {},
} = {}) {
  const log = [];
  const store = { get: (k) => settings[k], set: (patch) => { Object.assign(settings, patch); log.push(['store', patch]); } };
  const hands = fakeHands({ screens: SCREEN, start: 'files' });
  const queue = [...replies];
  const ai = {
    brainInfo: async () => { log.push(['brainInfo']); return info; },
    ask: async (action, input, opts = {}) => {
      log.push(['signal', opts.signal instanceof AbortSignal]);
      log.push(['ask', action, { step: input.step, jobId: input.jobId, platform: input.platform, screen: input.screen.split('\n')[0] }]);
      onAsk(input);
      const next = queue.shift() || { say: '', action: { type: 'stuck', reason: 'none' } };
      return { text: JSON.stringify(next), model: 'm' };
    },
  };
  const helper = { call: async (cmd, args) => { log.push(['helper', cmd, args]); return cmd === 'permissions' ? perms : { ok: true }; } };
  const talkBack = talk ? {
    say: async (t) => { log.push(['say', t]); },
    hear: async (verb) => { log.push(['hear', verb]); return heard.length ? heard.shift() : 'no'; },
    listen: async () => null,
    stop: () => log.push(['stopVoice']),
  } : null;
  const ui = { speech: (t, b) => log.push(['speech', t, b]), mood: (m) => log.push(['mood', m]) };
  const runner = createAgentRunner({
    ai, hands, helper, talkBack, ui, store,
    lock: lock || { locked: () => locked, onLocked: () => () => {} },
    memory: { facts: () => [] }, userName: () => 'Akshat', randomId: () => 'job-12345678',
    ...(waits ? { waits: { ...RUNNER_WAITS, ...waits } } : {}),
  });
  return { runner, log, hands, settings };
}

test('a job runs: thinking face, Esc watch on and off, each step shown with Stop, the AI asked with the job id', async () => {
  const s = setup({ replies: [{ say: 'Looking…', action: { type: 'scroll', dir: 'down' } }, { say: '', action: { type: 'done', summary: 'All done.' } }] });
  const r = await s.runner.start({ goal: 'Scroll down', spoken: false });
  assert.deepStrictEqual([r.end, r.line], ['done', 'All done.']);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'helper').map((l) => [l[1], l[2]]), [['permissions', undefined], ['watchStop', { on: true }], ['watchStop', { on: false }]]);
  assert.ok(s.log.some((l) => l[0] === 'mood' && l[1] === 'thinking'));
  assert.ok(s.log.some((l) => l[0] === 'speech' && l[1] === 'Looking…' && l[2].join() === 'stop'));
  assert.deepStrictEqual(s.log.find((l) => l[0] === 'ask')[2], { step: 1, jobId: 'job-12345678', platform: 'mac', screen: 'App: Finder' });
  assert.strictEqual(s.runner.running(), false);
});

test('switched off: no job; no Accessibility: an error with the Settings code', async () => {
  const off = setup({ settings: { agentOn: false, agentAgreed: true } });
  assert.deepStrictEqual(await off.runner.start({ goal: 'x' }), { end: 'off', line: 'Using your Mac is off. Turn it on in Settings → Permissions.', steps: [] });
  await assert.rejects(setup({ perms: { accessibility: false, screenRecording: false } }).runner.start({ goal: 'x' }), { code: 'no_accessibility' });
});

test('the first job asks once, heard with the "do" words; yes is remembered; no declines', async () => {
  const yes = setup({ settings: { agentOn: true, agentAgreed: false }, heard: ['yes'], replies: [DONE] });
  await yes.runner.start({ goal: 'x', spoken: true });
  assert.strictEqual(yes.settings.agentAgreed, true);
  assert.match(yes.log.find((l) => l[0] === 'say')[1], /I will click and type in your apps for you/);
  assert.deepStrictEqual(yes.log.filter((l) => l[0] === 'hear').map((l) => l[1]), ['do']);
  const no = setup({ settings: { agentOn: true, agentAgreed: false }, heard: ['no'] });
  assert.strictEqual((await no.runner.start({ goal: 'x', spoken: true })).end, 'declined');
});

test('a weak AI is warned about first; a weak free AI with no other way cannot run jobs', async () => {
  const weak = setup({ info: { route: 'own', provider: 'groq', model: 'llama', label: 'Groq', rank: 'weak', vision: true }, heard: ['no'] });
  assert.strictEqual((await weak.runner.start({ goal: 'x', spoken: true })).end, 'declined');
  assert.match(weak.log.find((l) => l[0] === 'say')[1], /^Your AI is Groq\./);
  await assert.rejects(setup({ info: { route: 'free', rank: 'weak', label: "Buddy's free AI", vision: true } }).runner.start({ goal: 'x' }), { code: 'free_no_agent' });
});

test('a risky step is asked in the bubble with Yes / No; a press of Yes acts', async () => {
  const s = setup({ replies: [{ ...TRASH, say: 'Deleting…' }, { say: '', action: { type: 'done', summary: 'Gone.' } }] });
  const running = s.runner.start({ goal: 'delete a.pdf', spoken: false });
  await settle();
  assert.ok(s.log.some((l) => l[0] === 'speech' && l[1] === 'Move "a.pdf" to the Trash?' && l[2].join() === 'yes,no'));
  s.runner.button('yes');
  const r = await running;
  assert.strictEqual(r.end, 'done');
  assert.deepStrictEqual(s.hands.acts, [{ type: 'files', op: 'trash', path: '/a/a.pdf' }]);
});

test('a spoken job asks out loud and hears the answer with the "do" words', async () => {
  const s = setup({ heard: ['yes'], replies: [TRASH, { say: '', action: { type: 'done', summary: 'Gone.' } }] });
  const r = await s.runner.start({ goal: 'delete a.pdf', spoken: true });
  assert.strictEqual(r.end, 'done');
  assert.ok(s.log.some((l) => l[0] === 'say' && l[1] === 'Move "a.pdf" to the Trash?'));
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'hear').map((l) => l[1]), ['do']);
  assert.strictEqual(s.hands.acts.length, 1);
});

test('a typed job: the AI\'s question waits for the answer typed in the chat; a typed yes answers a risky step', async () => {
  const s = setup({ replies: [{ say: '', action: { type: 'ask_user', question: 'Which file?' } }, TRASH, DONE] });
  const running = s.runner.start({ goal: 'delete the file', spoken: false });
  await settle();
  assert.ok(s.log.some((l) => l[0] === 'speech' && l[1] === 'Which file? Click here to type your answer.' && l[2].join() === 'stop'));
  assert.strictEqual(s.runner.reply('the PDF'), true);
  await settle();
  assert.ok(s.log.some((l) => l[0] === 'speech' && l[1] === 'Move "a.pdf" to the Trash?'));
  assert.strictEqual(s.runner.reply('haan kar do'), true);
  const r = await running;
  assert.strictEqual(r.end, 'done');
  assert.deepStrictEqual(s.hands.acts, [{ type: 'files', op: 'trash', path: '/a/a.pdf' }]);
  assert.strictEqual(s.runner.reply('hello'), false, 'nothing waits now');
  assert.ok(!s.log.some((l) => l[0] === 'say'), 'a typed job says nothing out loud');
});

test('Stop (button, Esc or voice) ends the job; the question waiting is a no', async () => {
  const s = setup({ replies: [TRASH] });
  const running = s.runner.start({ goal: 'x', spoken: false });
  await settle();
  assert.strictEqual(s.runner.running(), true);
  s.runner.button('stop');
  const r = await running;
  assert.deepStrictEqual([r.end, r.line], ['stopped', 'Stopped.']);
  assert.strictEqual(s.hands.acts.length, 0);
});

test('one job at a time', async () => {
  const s = setup({ replies: [TRASH] });
  const first = s.runner.start({ goal: 'x' });
  await settle();
  await assert.rejects(s.runner.start({ goal: 'y' }), /I'm busy with a job/);
  s.runner.stop('person');
  await first;
});

test('a locked screen at the start: the job stops before it acts', async () => {
  const s = setup({ locked: true, replies: [{ say: '', action: { type: 'scroll', dir: 'down' } }] });
  const r = await s.runner.start({ goal: 'x' });
  assert.deepStrictEqual([r.end, r.line], ['stopped', 'The screen locked, so I stopped.']);
  assert.strictEqual(s.hands.acts.length, 0);
});

test('the screen locking during a job stops it at once; the runner stops listening after', async () => {
  let onLock = null;
  const lock = { locked: () => false, onLocked: (fn) => { onLock = fn; return () => { onLock = null; }; } };
  const s = setup({ lock, replies: [TRASH] });
  const running = s.runner.start({ goal: 'x' });
  await settle();
  onLock(); // powerMonitor 'lock-screen' while the question waits
  const r = await running;
  assert.deepStrictEqual([r.end, r.line], ['stopped', 'The screen locked, so I stopped.']);
  assert.strictEqual(s.hands.acts.length, 0);
  assert.strictEqual(onLock, null);
});

test('took over: ignored while Buddy asks something', async () => {
  const s = setup({ replies: [TRASH, TRASH] });
  const running = s.runner.start({ goal: 'x' });
  await settle();
  s.runner.tookOver(); // a question is open: the person is answering it
  s.runner.button('no'); // the first question: no; the second one waits
  await settle();
  s.runner.stop('person');
  const r = await running;
  assert.strictEqual(r.end, 'stopped');
  assert.ok(!s.log.some((l) => l[0] === 'speech' && /You took over/.test(l[1])));
});

test('took over: the job waits RUNNER_WAITS.tookOver (30 s) for "go on", then stops', async () => {
  assert.strictEqual(RUNNER_WAITS.tookOver, 30_000);
  assert.strictEqual(RUNNER_WAITS.handover, 120_000);
  const s = setup({
    waits: { tookOver: 5 },
    onAsk: (input) => { if (input.step === 1) s.runner.tookOver(); },
    replies: [{ say: 'A…', action: { type: 'scroll', dir: 'down' } }, DONE],
  });
  const r = await s.runner.start({ goal: 'x', spoken: false });
  assert.strictEqual(r.end, 'stopped');
  assert.ok(s.log.some((l) => l[0] === 'speech' && /^You took over\./.test(l[1]) && l[2].join() === 'go-on,stop'));
  assert.strictEqual(s.log.filter((l) => l[0] === 'ask').length, 1, 'no step ran after the wait ran out');
});

test('no AI route: a plain line for each reason, no job starts', async () => {
  for (const reason of ['signed_out', 'blocked', 'network', 'no_key']) {
    const s = setup({ info: { route: null, reason } });
    await assert.rejects(s.runner.start({ goal: 'x' }), (err) => err.code === reason && err.message.length > 10 && !/undefined/.test(err.message));
    assert.strictEqual(s.runner.running(), false);
    assert.ok(!s.log.some((l) => l[0] === 'ask'));
  }
});

test('the AI is chosen once for the whole job, and each step gets a signal', async () => {
  const s = setup({ replies: [{ say: '', action: { type: 'scroll', dir: 'down' } }, { say: '', action: { type: 'scroll', dir: 'up' } }, DONE] });
  const r = await s.runner.start({ goal: 'x' });
  assert.strictEqual(r.end, 'done');
  assert.strictEqual(s.log.filter((l) => l[0] === 'brainInfo').length, 1);
  assert.deepStrictEqual(s.log.filter((l) => l[0] === 'signal').map((l) => l[1]), [true, true, true]);
});

test('button presses and typed words with nothing waiting are dropped', async () => {
  const s = setup({ replies: [DONE] });
  s.runner.button('yes');
  s.runner.button('go-on');
  assert.strictEqual(s.runner.reply('yes'), false);
  const r = await s.runner.start({ goal: 'x' });
  assert.strictEqual(r.end, 'done');
  s.runner.button('yes');
  assert.strictEqual(s.runner.running(), false);
});

test('reassert puts a pending question back after another line took the bubble', async () => {
  const s = setup({ replies: [TRASH] });
  const running = s.runner.start({ goal: 'x', spoken: false });
  await settle();
  const before = s.log.filter((l) => l[0] === 'speech').length;
  s.runner.reassert();
  const last = s.log.filter((l) => l[0] === 'speech').pop();
  assert.strictEqual(s.log.filter((l) => l[0] === 'speech').length, before + 1);
  assert.deepStrictEqual([last[1], last[2].join()], ['Move "a.pdf" to the Trash?', 'yes,no']);
  s.runner.stop('person');
  await running;
  const n = s.log.length;
  s.runner.reassert();
  assert.strictEqual(s.log.length, n, 'nothing waits: nothing shown');
});
