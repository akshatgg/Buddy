'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { parseStep, describe, MAC_ABILITIES, ACTION_TYPES, STEP_LIMITS } = require('../shared/agent/actions');

const reply = (action, extra = {}) => JSON.stringify({ say: 'Clicking Appearance…', thought: 'It is there.', action, ...extra });

test('a good step is read: say, thought and one action', () => {
  const step = parseStep(reply({ type: 'click', id: 'e12' }));
  assert.deepStrictEqual(step, { ok: true, say: 'Clicking Appearance…', thought: 'It is there.', risky: false, action: { type: 'click', id: 'e12' } });
});

test('fences and words around the JSON are forgiven', () => {
  const step = parseStep('Sure!\n```json\n' + reply({ type: 'look' }) + '\n```');
  assert.strictEqual(step.ok, true);
  assert.deepStrictEqual(step.action, { type: 'look' });
});

test('say is cut to 60 characters and thought to 200; risky only when true', () => {
  const step = parseStep(JSON.stringify({ say: 'x'.repeat(100), thought: 'y'.repeat(300), risky: 'yes', action: { type: 'look' } }));
  assert.strictEqual(step.say.length, STEP_LIMITS.say);
  assert.strictEqual(step.thought.length, STEP_LIMITS.thought);
  assert.strictEqual(step.risky, false);
  assert.strictEqual(parseStep(JSON.stringify({ say: '', risky: true, action: { type: 'look' } })).risky, true);
});

test('not JSON, no action, an unknown type or a missing field is a bad step with a reason for the AI', () => {
  assert.match(parseStep('I will click it').error, /JSON/);
  assert.match(parseStep(JSON.stringify({ say: 'hi' })).error, /action/);
  assert.match(parseStep(reply({ type: 'fly' })).error, /fly/);
  assert.match(parseStep(reply({ type: 'click' })).error, /id/);
  assert.match(parseStep(reply({ type: 'click', id: 'button 3' })).error, /id/);
  assert.match(parseStep(reply({ type: 'files', op: 'shred', path: '/tmp/a' })).error, /op/);
  assert.match(parseStep(reply({ type: 'scroll', dir: 'sideways' })).error, /dir/);
  assert.match(parseStep(reply({ type: 'toggle', id: 'e1', on: 'yes' })).error, /on/);
  assert.match(parseStep(reply({ type: 'menu', path: [] })).error, /path/);
});

test('an action the device cannot do is a bad step', () => {
  assert.match(parseStep(reply({ type: 'run', command: 'ls' }), { abilities: ['click', 'look'] }).error, /run/);
});

test('fields are cut to their limits; only known fields are kept; wait is at most 3 seconds', () => {
  const step = parseStep(reply({ type: 'type', text: 'a'.repeat(5000), id: 'e3', extra: 1 }));
  assert.strictEqual(step.action.text.length, STEP_LIMITS.text);
  assert.deepStrictEqual(Object.keys(step.action).sort(), ['id', 'text', 'type']);
  assert.strictEqual(parseStep(reply({ type: 'wait', ms: 99999 })).action.ms, 3000);
  assert.deepStrictEqual(parseStep(reply({ type: 'click_at', x: 10.6, y: '20' })).action, { type: 'click_at', x: 11, y: 20 });
  assert.deepStrictEqual(parseStep(reply({ type: 'drag', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } })).action, { type: 'drag', from: { x: 1, y: 2 }, to: { x: 3, y: 4 } });
});

test('the Mac can do every action type', () => {
  assert.deepStrictEqual([...MAC_ABILITIES].sort(), Object.keys(ACTION_TYPES).sort());
});

test('describe gives a short line for the log', () => {
  assert.strictEqual(describe({ type: 'click', id: 'e12' }), 'click e12');
  assert.strictEqual(describe({ type: 'open_app', name: 'Safari' }), 'open_app "Safari"');
  assert.strictEqual(describe({ type: 'files', op: 'trash', path: '/Users/a/x.txt' }), 'files trash "/Users/a/x.txt"');
  assert.strictEqual(describe({ type: 'keys', combo: 'cmd+t' }), 'keys "cmd+t"');
  assert.strictEqual(describe({ type: 'click_at', x: 5, y: 6 }), 'click_at 5,6');
  assert.strictEqual(describe({ type: 'menu', path: ['File', 'Export…'] }), 'menu "File > Export…"');
});
