'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { newTally, tally, workerTokens, running, viewOf, WORKERS_KEPT } = require('../src/main/claude/usage');

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
const notification = (id, status, tokens, at = '2026-10-17T10:05:00.000Z') => ({
  type: 'user', timestamp: at, origin: { kind: 'task-notification' },
  message: {
    role: 'user',
    content: `<task-notification>\n<task-id>a1</task-id>\n<tool-use-id>${id}</tool-use-id>\n<status>${status}</status>\n`
      + `<summary>Agent finished</summary>\n<usage><subagent_tokens>${tokens}</subagent_tokens><tool_uses>3</tool_uses>`
      + '<duration_ms>1000</duration_ms></usage>\n</task-notification>',
  },
});

test('a reply is counted once, though Claude Code writes a line for each of its blocks', () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'text', text: 'hi' }])), true);
  assert.strictEqual(tally(t, reply('m1', U(2, 100, 1000, 50), [{ type: 'tool_use', id: 'x', name: 'Bash', input: {} }])), false);
  tally(t, reply('m2', U(1, 0, 1102, 20)));
  assert.deepStrictEqual(viewOf(t).stats, { model: 'claude-opus-5-5', input: 2205, output: 70 });
});

test("a sub-agent's own lines, Claude Code's synthetic replies and anything malformed leave the count alone", () => {
  const t = newTally();
  assert.strictEqual(tally(t, reply('s1', U(5, 5, 5, 5), [], { isSidechain: true })), false);
  assert.strictEqual(tally(t, { type: 'assistant', message: { id: 'syn', model: '<synthetic>', content: [], usage: U(0, 0, 0, 0) } }), false);
  assert.strictEqual(tally(t, 'nonsense'), false);
  assert.strictEqual(tally(t, { type: 'user', message: { content: 42 } }), false);
  assert.deepStrictEqual(viewOf(t), { stats: { model: null, input: 0, output: 0 }, workers: [] });
});

test('a worker starts with an Agent tool_use and ends with its result, or later with its notification', () => {
  const t = newTally();
  tally(t, agent('w1', { description: 'Fix the login bug', subagent_type: 'general-purpose' }));
  tally(t, agent('w2', { description: 'Write the tests' }));
  tally(t, agent('w3', { subagent_type: 'Explore' }, 'Task'));
  assert.deepStrictEqual(viewOf(t).workers.map((w) => [w.task, w.status]), [
    ['Fix the login bug', 'running'], ['Write the tests', 'running'], ['Explore', 'running'],
  ]);
  assert.deepStrictEqual(running(t), ['w1', 'w2', 'w3']);

  tally(t, result('w1', { status: 'completed', totalTokens: 4200 }));
  tally(t, result('w2', { isAsync: true, status: 'async_launched', agentId: 'a1' })); // in the background: still running
  tally(t, result('w3', {}, true));
  let w = viewOf(t).workers;
  assert.deepStrictEqual(w[0], {
    id: 'w1', task: 'Fix the login bug', status: 'done', startedAt: Date.parse(AT), endedAt: Date.parse('2026-10-17T10:01:00.000Z'), tokens: 4200,
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

test(`only the newest ${WORKERS_KEPT} workers are kept, never one still running`, () => {
  const t = newTally();
  for (let i = 0; i < 25; i += 1) tally(t, agent(`w${i}`, { description: `job ${i}` }));
  for (let i = 1; i < 25; i += 1) tally(t, result(`w${i}`, { status: 'completed' }));
  const ids = viewOf(t).workers.map((w) => w.id);
  assert.strictEqual(ids.length, WORKERS_KEPT);
  assert.ok(ids.includes('w0') && ids.includes('w24') && !ids.includes('w5'));
});
