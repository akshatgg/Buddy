'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  newTally, tally, workerTokens, workerActivity, ownEnd, running, expire, viewOf, WORKERS_KEPT, RUNNING_KEPT,
} = require('../src/main/claude/usage');

const AT = '2026-10-17T10:00:00.000Z';
const U = (input, cacheWrite, cacheRead, output) => ({
  input_tokens: input, cache_creation_input_tokens: cacheWrite, cache_read_input_tokens: cacheRead, output_tokens: output,
});
const reply = (id, usage, content = [], extra = {}) => ({
  type: 'assistant', timestamp: AT, message: { id, model: 'claude-opus-5-5', role: 'assistant', content, usage }, ...extra,
});
const agent = (id, input, name = 'Agent') => reply(`m-${id}`, U(1, 0, 0, 1), [{ type: 'tool_use', id, name, input }]);
const result = (id, toolUseResult, isError = false, at = '2026-10-17T10:01:00.000Z') => ({
  type: 'user', timestamp: at, toolUseResult,
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', ...(isError ? { is_error: true } : {}) }] },
});
const noteText = (id, status, tokens, taskId = 'a1') => `<task-notification>\n<task-id>${taskId}</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n`
  + `<summary>Agent finished</summary>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>3</tool_uses>`
  + '<duration_ms>1000</duration_ms></usage>\n</task-notification>';
const notification = (id, status, tokens, at = '2026-10-17T10:05:00.000Z', taskId = 'a1') => ({
  type: 'user', timestamp: at, origin: { kind: 'task-notification' }, message: { role: 'user', content: noteText(id, status, tokens, taskId) },
});
// The same notification as the other carriers write it.
const asAttachment = (id, status, tokens, at = '2026-10-17T10:05:00.000Z', taskId = 'a1') => ({
  type: 'attachment', timestamp: at, attachment: { type: 'queued_command', prompt: noteText(id, status, tokens, taskId), origin: { kind: 'task-notification' } },
});
const asEnqueue = (id, status, tokens, at = '2026-10-17T10:05:00.000Z', taskId = 'a1') => ({
  type: 'queue-operation', operation: 'enqueue', timestamp: at, content: noteText(id, status, tokens, taskId),
});
const launched = (id, agentId, at = '2026-10-17T10:00:30.000Z') => result(id, { isAsync: true, status: 'async_launched', agentId }, false, at);
const sendMessage = (id, to) => reply(`m-${id}`, U(1, 0, 0, 1), [{ type: 'tool_use', id, name: 'SendMessage', input: { to, message: 'go on' } }]);

test('a reply is counted once, though Claude Code writes a line for each of its blocks', () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'text', text: 'hi' }])), true);
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }])), false);
  tally(t, reply('m2', U(1, 0, 1102, 20)));
  assert.deepStrictEqual(viewOf(t).stats, { model: 'claude-opus-5-5', input: 2205, output: 70, context: 1103 });
});

test("a sub-agent's own lines, Claude Code's synthetic replies and anything malformed leave the count alone", () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('s1', U(5, 5, 5, 5), [], { isSidechain: true })), false);
  assert.strictEqual(tally(t, { type: 'assistant', message: { id: 'syn', model: '<synthetic>', content: [], usage: U(0, 0, 0, 0) } }), false);
  assert.strictEqual(tally(t, 'nonsense'), false);
  assert.strictEqual(tally(t, { type: 'user', message: { content: 42 } }), false);
  assert.deepStrictEqual(viewOf(t), { stats: { model: null, input: 0, output: 0, context: 0 }, workers: [] });
});

test('a worker starts with an Agent tool_use and ends with its result, or later with its notification', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Fix the login bug', subagent_type: 'general-purpose' }));
  tally(t, agent('w2', { description: 'Write the tests' }));
  tally(t, agent('w3', { subagent_type: 'Explore' }, 'Task'));
  assert.deepStrictEqual(viewOf(t).workers.map((w) => [w.type, w.task, w.status]), [
    ['general-purpose', 'Fix the login bug', 'running'], ['general-purpose', 'Write the tests', 'running'], ['Explore', 'Explore', 'running'],
  ]);
  assert.deepStrictEqual(running(t), ['w1', 'w2', 'w3']);

  tally(t, result('w1', { status: 'completed', totalTokens: 4200 }));
  tally(t, result('w2', { isAsync: true, status: 'async_launched', agentId: 'a1' })); // in the background: still running
  tally(t, result('w3', {}, true));
  let w = viewOf(t).workers;
  assert.deepStrictEqual(w[0], {
    id: 'w1', type: 'general-purpose', task: 'Fix the login bug', activity: null, status: 'done', startedAt: Date.parse(AT), endedAt: Date.parse('2026-10-17T10:01:00.000Z'), tokens: 4200,
  });
  assert.strictEqual(w[1].status, 'running');
  assert.strictEqual(w[2].status, 'failed');

  assert.strictEqual(tally(t, notification('w2', 'completed', 86829)), true);
  w = viewOf(t).workers;
  assert.deepStrictEqual([w[1].status, w[1].tokens, w[1].endedAt], ['done', 86829, Date.parse('2026-10-17T10:05:00.000Z')]);
  assert.strictEqual(tally(t, notification('w2', 'completed', 1)), false, 'an ended worker stays as it ended');
});

test('a worker the person stopped, or that was killed, shows as stopped; a notification for nobody changes nothing', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Look around' }));
  tally(t, notification('w1', 'killed', 10));
  assert.strictEqual(viewOf(t).workers[0].status, 'stopped');
  assert.strictEqual(tally(t, notification('nobody', 'completed', 10)), false);
});

test("a running worker's tokens follow its newest reply; an ended one's stay", () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Look around' }));
  assert.strictEqual(workerTokens(t, 'w1', U(2, 300, 4000, 25)), true);
  assert.strictEqual(viewOf(t).workers[0].tokens, 4327);
  assert.strictEqual(workerTokens(t, 'w1', U(2, 300, 4000, 25)), false);
  tally(t, result('w1', { status: 'completed', totalTokens: 5000 }));
  assert.strictEqual(workerTokens(t, 'w1', U(9, 9, 9, 9)), false);
  assert.strictEqual(viewOf(t).workers[0].tokens, 5000);
  assert.strictEqual(workerTokens(t, 'nobody', U(1, 1, 1, 1)), false);
});

test(`only the newest ${WORKERS_KEPT} ended workers are kept, and a worker still running stays`, () => {
  const t = newTally();
  for (let i = 0; i < 25; i += 1) {
    tally(t, agent(`w${i}`, { description: `job ${i}` }));
    if (i > 0) tally(t, result(`w${i}`, { status: 'completed' }));
  }
  const ids = viewOf(t).workers.map((w) => w.id);
  assert.strictEqual(ids.length, WORKERS_KEPT + 1);
  assert.ok(ids.includes('w0') && ids.includes('w24') && !ids.includes('w4') && ids.includes('w5'));
});

test('every notification in one message ends its worker; Esc ends a worker as stopped, not failed', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  tally(t, agent('w2', { description: 'Two' }));
  tally(t, agent('w3', { description: 'Three' }));
  const both = notification('w1', 'completed', 10);
  both.message.content += notification('w2', 'failed', 20).message.content;
  assert.strictEqual(tally(t, both), true);
  assert.deepStrictEqual(viewOf(t).workers.map((w) => w.status), ['done', 'failed', 'running']);
  const esc = result('w3', {}, true);
  esc.message.content[0].content = '[Request interrupted by user for tool use]';
  tally(t, esc);
  assert.strictEqual(viewOf(t).workers[2].status, 'stopped');
});

test('usage lines with no message id are not merged into one reply', () => {
  const t = newTally();
  tally(t, reply(undefined, U(1, 0, 0, 1)));
  tally(t, reply(undefined, U(1, 0, 0, 1)));
  assert.deepStrictEqual(viewOf(t).stats, { model: 'claude-opus-5-5', input: 2, output: 2, context: 1 });
});

test('expire stops the workers that will not end by themselves', () => {
  const { expire } = require('../src/main/claude/usage');
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  assert.strictEqual(expire(t, ['w1', 'nobody'], 5000), true);
  assert.deepStrictEqual([viewOf(t).workers[0].status, viewOf(t).workers[0].endedAt], ['stopped', 5000]);
  assert.strictEqual(expire(t, ['w1'], 6000), false);
  assert.deepStrictEqual(running(t), []);
});

test('a real end replaces an expired worker\'s guessed stop, but not a real one', () => {
  const { expire } = require('../src/main/claude/usage');
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  tally(t, agent('w2', { description: 'Two' }));
  expire(t, ['w1', 'w2'], 5000);
  tally(t, result('w1', { status: 'completed', totalTokens: 7 }));
  assert.deepStrictEqual(viewOf(t).workers[0], {
    id: 'w1', type: 'general-purpose', task: 'One', activity: null, status: 'done', startedAt: Date.parse(AT), endedAt: Date.parse('2026-10-17T10:01:00.000Z'), tokens: 7,
  });
  tally(t, notification('w2', 'killed', 3));
  tally(t, notification('w2', 'completed', 99));
  assert.deepStrictEqual([viewOf(t).workers[1].status, viewOf(t).workers[1].tokens], ['stopped', 3], 'a real stop stays');
});

test('a notification as an attachment, or as a queue enqueue, ends the worker; the other copies change nothing', () => {
  const t = newTally();
  tally(t, agent('toolu_1', { description: 'One' }));
  tally(t, agent('toolu_2', { description: 'Two' }));
  tally(t, launched('toolu_1', 'a1'));
  tally(t, launched('toolu_2', 'a2'));
  assert.strictEqual(tally(t, asAttachment('toolu_1', 'completed', 500)), true);
  assert.deepStrictEqual(viewOf(t).workers.map((w) => [w.status, w.tokens]), [['done', 500], ['running', 0]]);
  // The enqueue comes first in the real files; then a remove, and a user copy.
  assert.strictEqual(tally(t, asEnqueue('toolu_2', 'failed', 9, '2026-10-17T10:04:00.000Z', 'a2')), true);
  assert.strictEqual(viewOf(t).workers[1].status, 'failed');
  assert.strictEqual(tally(t, { type: 'queue-operation', operation: 'remove', timestamp: AT }), false);
  assert.strictEqual(tally(t, { type: 'queue-operation', operation: 'dequeue', timestamp: AT, content: noteText('toolu_2', 'completed', 1, 'a2') }), false);
  assert.strictEqual(tally(t, notification('toolu_2', 'failed', 9, AT, 'a2')), false);
  assert.strictEqual(tally(t, asAttachment('toolu_1', 'completed', 500)), false);
  assert.strictEqual(viewOf(t).workers[1].endedAt, Date.parse('2026-10-17T10:04:00.000Z'), 'the first copy set the time');
  // An attachment that is no queued command, or has no words, says nothing.
  assert.strictEqual(tally(t, { type: 'attachment', timestamp: AT, attachment: { type: 'hook_success', prompt: noteText('toolu_2', 'killed', 1) } }), false);
  assert.strictEqual(tally(t, { type: 'attachment', timestamp: AT, attachment: { type: 'queued_command', prompt: 7 } }), false);
});

test('a worker is matched by its task-id (the agent id) when the notification names another tool_use; SendMessage resumes it', () => {
  const t = newTally();
  tally(t, agent('toolu_1', { description: 'Look around', subagent_type: 'Explore' }));
  tally(t, launched('toolu_1', 'a1'));
  tally(t, notification('toolu_1', 'completed', 100, '2026-10-17T10:02:00.000Z'));
  assert.strictEqual(viewOf(t).workers[0].status, 'done');

  tally(t, sendMessage('toolu_9', 'a1'));
  const resumedAt = '2026-10-17T10:10:00.000Z';
  assert.strictEqual(tally(t, result('toolu_9', { success: true, message: 'Resuming agent a1', resumedAgentId: 'a1' }, false, resumedAt)), true);
  let [w] = viewOf(t).workers;
  assert.deepStrictEqual([w.status, w.endedAt, w.startedAt], ['running', null, Date.parse(resumedAt)]);

  // A replay of the first end changes nothing; the end of the resumed run names the SendMessage id and the same task-id.
  assert.strictEqual(tally(t, asEnqueue('toolu_1', 'completed', 100)), false);
  assert.strictEqual(tally(t, asEnqueue('toolu_9', 'completed', 300, '2026-10-17T10:12:00.000Z')), true);
  assert.strictEqual(tally(t, asAttachment('toolu_9', 'completed', 300, '2026-10-17T10:12:00.000Z')), false);
  assert.strictEqual(viewOf(t).workers.length, 1, 'still one worker');
  [w] = viewOf(t).workers;
  assert.deepStrictEqual([w.status, w.tokens, w.endedAt], ['done', 300, Date.parse('2026-10-17T10:12:00.000Z')]);
  assert.deepStrictEqual(Object.keys(w).sort(), ['activity', 'endedAt', 'id', 'startedAt', 'status', 'task', 'tokens', 'type'], 'agentId stays inside');
});

test('a SendMessage that could not resume, or only queued its words, leaves the worker as it was', () => {
  const t = newTally();
  tally(t, agent('toolu_1', { description: 'One' }));
  tally(t, agent('toolu_2', { description: 'Two' }));
  tally(t, launched('toolu_1', 'a1'));
  tally(t, launched('toolu_2', 'a2'));
  tally(t, notification('toolu_1', 'completed', 1));
  tally(t, sendMessage('toolu_8', 'a1'));
  tally(t, sendMessage('toolu_9', 'a2'));
  assert.strictEqual(tally(t, result('toolu_8', { success: false, message: 'a1 could not be resumed: No transcript found', resumedAgentId: 'a1' })), false);
  assert.strictEqual(tally(t, result('toolu_9', { success: true, message: 'Message queued for delivery to a2 at its next tool round.' })), false);
  assert.deepStrictEqual(viewOf(t).workers.map((w) => w.status), ['done', 'running']);
  assert.strictEqual(tally(t, result('toolu_7', { success: true, resumedAgentId: 'a1' })), false, 'a result of no SendMessage we know');
  // Resuming one that already runs changes nothing.
  tally(t, result('toolu_9', { success: true, resumedAgentId: 'a2' }));
  assert.strictEqual(viewOf(t).workers[1].startedAt, Date.parse(AT));
});

test(`no more than ${RUNNING_KEPT} workers show as running: the oldest are taken as stopped, until a real end says otherwise`, () => {
  const t = newTally();
  const total = RUNNING_KEPT + 5;
  for (let i = 0; i < total; i += 1) {
    tally(t, agent(`toolu_${i}`, { description: `job ${i}` }));
    tally(t, launched(`toolu_${i}`, `a${i}`));
  }
  assert.strictEqual(running(t).length, RUNNING_KEPT);
  const w = viewOf(t).workers;
  assert.deepStrictEqual(w.slice(0, 5).map((x) => x.status), Array(5).fill('stopped'));
  assert.deepStrictEqual(w.slice(5).map((x) => x.status), Array(RUNNING_KEPT).fill('running'));
  assert.strictEqual(tally(t, asEnqueue('toolu_2', 'completed', 8, AT, 'a2')), true);
  assert.strictEqual(viewOf(t).workers[2].status, 'done');
  assert.strictEqual(running(t).length, RUNNING_KEPT);
});

test("the status line's context is the newest reply's whole input; the input stays the sum", () => {
  const t = newTally();
  tally(t, reply('m1', U(1, 100, 1000, 5)));
  assert.strictEqual(viewOf(t).stats.context, 1101);
  tally(t, reply('m2', U(1, 50, 1200, 7)));
  const { stats } = viewOf(t);
  assert.deepStrictEqual([stats.context, stats.input, stats.output], [1251, 2352, 12]);
  tally(t, reply('s', U(9, 9, 9, 9), [], { isSidechain: true }));
  assert.strictEqual(viewOf(t).stats.context, 1251, "a worker's reply is not the session's context");
});

test('type and task: the description is the task, the type is the subagent type, else general-purpose', () => {
  const t = newTally();
  tally(t, agent('a', { description: 'Fix  X\nnow', subagent_type: 'Explore' }));
  tally(t, agent('b', { description: 'Fix Y' }));
  tally(t, agent('c', { subagent_type: 'Plan' }));
  tally(t, agent('d', {}));
  tally(t, agent('e', { description: 'Z', subagent_type: 'x'.repeat(60) }));
  assert.deepStrictEqual(viewOf(t).workers.map((w) => [w.type, w.task]), [
    ['Explore', 'Fix X now'], ['general-purpose', 'Fix Y'], ['Plan', 'Plan'], ['general-purpose', 'general-purpose'], ['general-purpose', 'Z'],
  ]);
});

test("a worker's own file: its end (a reply that ends the turn, or its SubagentHandback answered), and nothing from before a resume", () => {
  const own = (stop, content, at = '2026-10-17T10:03:00.000Z') => ({ type: 'assistant', timestamp: at, message: { id: 'x', role: 'assistant', stop_reason: stop, content } });
  const toolResult = (id, at = '2026-10-17T10:03:00.000Z') => ({ type: 'user', timestamp: at, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok' }] } });
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  tally(t, agent('w2', { description: 'Two' }));
  tally(t, agent('w3', { description: 'Three' }));
  const handbacks = new Set();
  assert.strictEqual(ownEnd(t, 'w1', own(null, [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }]), handbacks), null, 'a tool to run: going on');
  assert.strictEqual(ownEnd(t, 'w1', own('tool_use', [{ type: 'tool_use', id: 'u1', name: 'Read', input: {} }]), handbacks), null);
  assert.strictEqual(ownEnd(t, 'w1', own('end_turn', [{ type: 'text', text: 'All done.' }]), handbacks), 'done');
  assert.deepStrictEqual([viewOf(t).workers[0].status, viewOf(t).workers[0].endedAt], ['done', Date.parse('2026-10-17T10:03:00.000Z')]);
  assert.strictEqual(ownEnd(t, 'w1', own('end_turn', [{ type: 'text', text: 'again' }]), handbacks), null, 'ended already');

  assert.strictEqual(ownEnd(t, 'w2', own('tool_use', [{ type: 'tool_use', id: 'hb', name: 'SubagentHandback', input: { message: 'x' } }]), handbacks), null);
  assert.strictEqual(ownEnd(t, 'w2', toolResult('other'), handbacks), null);
  assert.strictEqual(ownEnd(t, 'w2', toolResult('hb'), handbacks), 'done');

  // A worker resumed at 10:10: its older end_turn line (10:03) says nothing.
  tally(t, launched('w3', 'a3'));
  tally(t, notification('w3', 'completed', 1, '2026-10-17T10:04:00.000Z', 'a3'));
  tally(t, sendMessage('toolu_9', 'a3'));
  tally(t, result('toolu_9', { success: true, resumedAgentId: 'a3' }, false, '2026-10-17T10:10:00.000Z'));
  assert.strictEqual(ownEnd(t, 'w3', own('end_turn', [{ type: 'text', text: 'old' }]), handbacks), null);
  assert.strictEqual(ownEnd(t, 'w3', own('end_turn', [{ type: 'text', text: 'new' }], '2026-10-17T10:11:00.000Z'), handbacks), 'done');
  // An expired guess is replaced by a real end.
  const t2 = newTally();
  tally(t2, agent('w1', { description: 'One' }));
  expire(t2, ['w1'], 5000);
  assert.strictEqual(ownEnd(t2, 'w1', own('end_turn', [{ type: 'text', text: 'x' }]), new Set()), 'done');
  assert.strictEqual(viewOf(t2).workers[0].status, 'done');
});

test("a running worker's activity is one line cut to 80 characters; an ended worker keeps none changing", () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  assert.strictEqual(workerActivity(t, 'w1', 'Read specs/design.md'), true);
  assert.strictEqual(workerActivity(t, 'w1', 'Read specs/design.md'), false);
  assert.strictEqual(workerActivity(t, 'w1', ''), false);
  assert.strictEqual(workerActivity(t, 'w1', `Looking at\n${'y'.repeat(200)}`), true);
  const { activity } = viewOf(t).workers[0];
  assert.ok(activity.length <= 80 && !activity.includes('\n'));
  assert.strictEqual(workerActivity(t, 'nobody', 'x'), false);
  tally(t, notification('w1', 'completed', 1));
  assert.strictEqual(workerActivity(t, 'w1', 'late'), false);
});

test('trimming ended workers drops real ends first, never one that was only guessed stopped', () => {
  const t = newTally();
  tally(t, agent('g', { description: 'Guessed' }));
  expire(t, ['g'], 5000);
  for (let i = 0; i < WORKERS_KEPT + 3; i += 1) {
    tally(t, agent(`w${i}`, { description: `job ${i}` }));
    tally(t, result(`w${i}`, { status: 'completed' }));
  }
  const ids = viewOf(t).workers.map((w) => w.id);
  assert.ok(ids.includes('g'), 'the guess stays');
  assert.strictEqual(ids.length, WORKERS_KEPT);
  assert.ok(!ids.includes('w0') && ids.includes('w22'));
  assert.strictEqual(tally(t, notification('g', 'completed', 4)), true, 'and its real end still lands');
});

test('a SubagentHandback that answered with an error does not end the worker', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'One' }));
  const handbacks = new Set();
  ownEnd(t, 'w1', { type: 'assistant', timestamp: AT, message: { stop_reason: 'tool_use', content: [{ type: 'tool_use', id: 'hb', name: 'SubagentHandback', input: {} }] } }, handbacks);
  const failed = { type: 'user', timestamp: AT, message: { content: [{ type: 'tool_result', tool_use_id: 'hb', is_error: true, content: 'no' }] } };
  assert.strictEqual(ownEnd(t, 'w1', failed, handbacks), null);
  assert.strictEqual(viewOf(t).workers[0].status, 'running');
});
