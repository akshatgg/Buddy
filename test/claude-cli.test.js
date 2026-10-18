'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  toolCall, summaryText, rows, inline, workingVerb, VERBS,
  tokenCount, modelName, elapsed, statusLine, workerList, command, suggestions, helpLines, costLines, COMMANDS,
  EFFORTS, aliasOf, noSuchEffort, pickerOpen, pickerMove, pickerEffort, pickerPick, pickerApply,
} = require('../src/renderer/panel/claude-cli.js');

test("a tool's line is written as the terminal writes it, and the quiet ones know their group", () => {
  assert.deepStrictEqual(toolCall('$ npm test'), { name: 'Bash', arg: 'npm test', group: 'bash' });
  assert.deepStrictEqual(toolCall('Read src/main.js'), { name: 'Read', arg: 'src/main.js', group: 'read' });
  assert.deepStrictEqual(toolCall('Edit src/main.js'), { name: 'Update', arg: 'src/main.js', group: null });
  assert.deepStrictEqual(toolCall('MultiEdit a/b.js'), { name: 'Update', arg: 'a/b.js', group: null });
  assert.deepStrictEqual(toolCall('Write docs/x.md'), { name: 'Write', arg: 'docs/x.md', group: null });
  assert.deepStrictEqual(toolCall('Grep TODO'), { name: 'Search', arg: 'pattern: "TODO"', group: 'search' });
  assert.deepStrictEqual(toolCall('Glob **/*.js'), { name: 'Search', arg: 'pattern: "**/*.js"', group: 'search' });
  assert.deepStrictEqual(toolCall('Fetch https://x.dev'), { name: 'Fetch', arg: 'https://x.dev', group: 'web' });
  assert.deepStrictEqual(toolCall('Search electron tray'), { name: 'Web Search', arg: 'electron tray', group: 'web' });
  assert.deepStrictEqual(toolCall('Agent: Find the bug'), { name: 'Agent', arg: 'Find the bug', group: null });
  assert.deepStrictEqual(toolCall('Updated the to-do list'), { name: 'Update Todos', arg: '', group: null });
  assert.deepStrictEqual(toolCall('mcp__github__pr'), { name: 'mcp__github__pr', arg: '', group: null });
  assert.deepStrictEqual(toolCall(undefined), { name: 'Tool', arg: '', group: null });
});

test('the folded line counts each kind, as the terminal does', () => {
  assert.strictEqual(summaryText({ bash: 3 }), 'Ran 3 shell commands');
  assert.strictEqual(summaryText({ bash: 1, read: 2, search: 1, web: 1 }), 'Ran 1 shell command, read 2 files, searched for 1 pattern, fetched 1 page');
  assert.strictEqual(summaryText({ read: 1 }), 'Read 1 file');
  assert.strictEqual(summaryText({}), '');
});

test('rows: results go under their tool, quiet tools in a row fold into one, the rest show on their own', () => {
  const items = [
    { id: 1, kind: 'you', text: 'fix it' },
    { id: 2, kind: 'thinking', text: 'hmm' },
    { id: 3, kind: 'claude', text: 'Looking.' },
    { id: 4, kind: 'tool', text: '$ npm test' },
    { id: 5, kind: 'result', text: '3 failing', error: true },
    { id: 6, kind: 'tool', text: 'Read src/a.js' },
    { id: 7, kind: 'result', text: 'code' },
    { id: 8, kind: 'tool', text: 'Edit src/a.js' },
    { id: 9, kind: 'result', text: 'Updated' },
    { id: 10, kind: 'tool', text: '$ npm test' },
    { id: 11, kind: 'event', text: 'Stopped' },
    { id: 12, kind: 'result', text: 'a result with no tool before it' },
  ];
  const out = rows(items);
  assert.deepStrictEqual(out.map((r) => r.type), ['you', 'thinking', 'claude', 'summary', 'tool', 'summary', 'event', 'event']);
  assert.strictEqual(out[3].text, 'Ran 1 shell command, read 1 file');
  assert.strictEqual(out[3].error, true, 'one of them failed');
  assert.deepStrictEqual(out[3].tools.map((t) => [t.name, t.arg, t.results.map((r) => r.text)]), [['Bash', 'npm test', ['3 failing']], ['Read', 'src/a.js', ['code']]]);
  assert.deepStrictEqual([out[4].name, out[4].arg, out[4].results, out[4].error], ['Update', 'src/a.js', [{ text: 'Updated', error: false }], false]);
  assert.strictEqual(out[5].text, 'Ran 1 shell command', 'a new run after the edit');
  assert.strictEqual(out[6].text, 'Interrupted by user');
  assert.strictEqual(out[7].text, 'a result with no tool before it');
  assert.deepStrictEqual(rows(null), []);
  assert.deepStrictEqual(rows([null, 7, { id: 1, kind: 'you', text: 'hi' }]).map((r) => r.text), ['hi']);
});

test('inline: **bold**, `code` and a heading, as the terminal shows markdown; the rest as it is', () => {
  assert.deepStrictEqual(inline('the tax was **added twice** in `cart.js`.'), [
    { s: 'the tax was ', bold: false, code: false },
    { s: 'added twice', bold: true, code: false },
    { s: ' in ', bold: false, code: false },
    { s: 'cart.js', bold: false, code: true },
    { s: '.', bold: false, code: false },
  ]);
  assert.deepStrictEqual(inline('## Next steps'), [{ s: 'Next steps', bold: true, code: false }]);
  assert.deepStrictEqual(inline(''), [{ s: '', bold: false, code: false }]);
  assert.deepStrictEqual(inline('a ** b'), [{ s: 'a ** b', bold: false, code: false }]);
});

test('the working line keeps one verb for a turn', () => {
  assert.strictEqual(workingVerb(3), workingVerb(3));
  assert.ok(VERBS.map((v) => `${v}…`).includes(workingVerb(12345)));
  assert.strictEqual(workingVerb(undefined), `${VERBS[0]}…`);
});

test("Claude's markdown as the terminal shows it: headings, lists, code, and tables", () => {
  const { blocks } = require('../src/renderer/panel/claude-cli.js');
  assert.deepStrictEqual(blocks('## Plan\n- the `cart`\n  - and tax\n1. first\n\n```\nnpm test\n```\n| A | B |\n|---|:---:|\n| **x** | `y` |\nafter'), [
    { type: 'heading', text: 'Plan' },
    { type: 'bullet', depth: 0, marker: '•', text: 'the `cart`' },
    { type: 'bullet', depth: 1, marker: '•', text: 'and tax' },
    { type: 'bullet', depth: 0, marker: '1.', text: 'first' },
    { type: 'blank' },
    { type: 'code', lines: ['npm test'] },
    { type: 'table', header: ['A', 'B'], rows: [['x', 'y']] },
    { type: 'line', text: 'after' },
  ]);
  assert.deepStrictEqual(blocks('| not | a table |\nno rule under it').map((b) => b.type), ['line', 'line']);
});

test('a table is drawn with box lines, a line between rows, its widest columns wrapping to fit', () => {
  const { tableLines, wrap } = require('../src/renderer/panel/claude-cli.js');
  assert.deepStrictEqual(tableLines(['Idea', 'How'], [['Reply', 'Gives three ready replies to pick']], 30), [
    '┌───────┬────────────────────┐',
    '│ Idea  │ How                │',
    '├───────┼────────────────────┤',
    '│ Reply │ Gives three ready  │',
    '│       │ replies to pick    │',
    '└───────┴────────────────────┘',
  ]);
  assert.strictEqual(tableLines(['A'], [['x'.repeat(50)]], 200)[0].length, 54, 'room enough: nothing wraps');
  assert.deepStrictEqual(tableLines([], [], 40), []);
  assert.deepStrictEqual(wrap('abcdefg', 5), ['abcde', 'fg']);
});

test('tokens, the model and the time as the terminal writes them', () => {
  assert.deepStrictEqual([0, 980, 1000, 1234, 12345, 123456, 999_999, 1_200_000].map(tokenCount), ['0', '980', '1k', '1.2k', '12.3k', '123k', '1M', '1.2M']);
  assert.strictEqual(modelName('claude-opus-5-5'), 'Opus 5.5');
  assert.strictEqual(modelName('claude-haiku-4-5-20251001'), 'Haiku 4.5');
  assert.strictEqual(modelName('claude-sonnet-4-20250514'), 'Sonnet 4');
  assert.strictEqual(modelName('gpt-5'), 'gpt-5');
  assert.strictEqual(modelName(null), '');
  assert.deepStrictEqual([0, 12_400, 72_000, 3_900_000].map(elapsed), ['0s', '12s', '1m 12s', '1h 5m']);
});

test('the status line: the model, the newest reply\'s context and what came out; nothing before any reply', () => {
  assert.strictEqual(statusLine({ model: 'claude-opus-5-5', input: 232_668_833, output: 440_044, context: 301_124 }), 'Opus 5.5 · 301k context · 440k out');
  assert.strictEqual(statusLine({ model: 'claude-opus-5-5', input: 1_234_567, output: 34_000 }), 'Opus 5.5 · 1.2M in · 34k out', 'an old Mac sends no context');
  assert.strictEqual(statusLine({ model: 'claude-opus-5-5', input: 1_234_567, output: 34_000, context: 0 }), 'Opus 5.5 · 1.2M in · 34k out');
  assert.strictEqual(statusLine({ model: null, input: 0, output: 0 }), '');
  assert.strictEqual(statusLine(undefined), '');
});

const NOW = Date.parse('2026-10-17T10:10:00Z');
const at = (s) => Date.parse(`2026-10-17T10:${s}Z`);
const W = (id, status, startedAt, endedAt, tokens, extra = {}) => ({ id, type: 'general-purpose', task: `job ${id}`, status, startedAt, endedAt, tokens, ...extra });

test('a worker row: its type and task, what it does now, and its time and tokens', () => {
  const [row] = workerList([W('a', 'running', at('08:48'), null, 12_300, { activity: 'Read specs/design.md' })], NOW).running;
  assert.deepStrictEqual(row, {
    id: 'a', status: 'running', head: 'general-purpose  job a', activity: 'Read specs/design.md', tail: '1m 12s · 12.3k tokens', text: 'job a · running · 1m 12s · 12.3k tokens',
  });
  assert.strictEqual(workerList([W('a', 'running', at('09:00'), null, 0)], NOW).running[0].activity, 'Working…', 'nothing seen yet');
  assert.strictEqual(workerList([W('a', 'running', at('09:00'), null, 0, { activity: 'x'.repeat(200) })], NOW).running[0].activity.length, 80);
  // No description: the type is the task, and shows once. An old Mac sends no type: the task alone.
  assert.strictEqual(workerList([W('a', 'running', at('09:00'), null, 0, { type: 'Explore', task: 'Explore' })], NOW).running[0].head, 'Explore');
  assert.strictEqual(workerList([W('a', 'running', at('09:00'), null, 0, { type: undefined })], NOW).running[0].head, 'job a');
  const done = workerList([W('b', 'done', at('00:00'), at('09:30'), 900, { activity: 'stale' })], NOW).ended[0];
  assert.deepStrictEqual([done.activity, done.tail], ['', 'done · 9m 30s · 900 tokens']);
});

test('workers: running ones in full (8 at most), those that ended in the last 5 minutes folded into one line', () => {
  const some = workerList([
    W('a', 'running', at('08:48'), null, 12_300), W('b', 'running', at('09:00'), null, 0),
    W('c', 'done', at('09:00'), at('09:30'), 0), W('d', 'done', at('09:00'), at('09:31'), 0), W('e', 'failed', at('09:00'), at('09:40'), 0), W('f', 'stopped', at('09:00'), at('09:50'), 0),
    W('old', 'done', at('00:00'), at('01:00'), 0),
  ], NOW);
  assert.deepStrictEqual(some.running.map((r) => r.id), ['a', 'b']);
  assert.deepStrictEqual(some.ended.map((r) => r.id), ['c', 'd', 'e', 'f'], 'the one that ended long ago is not shown');
  assert.strictEqual(some.summary, '2 running · 2 done · 1 failed · 1 stopped');
  assert.strictEqual(some.unfolded, false);
  assert.strictEqual(workerList([W('a', 'running', at('08:48'), null, 0), W('b', 'done', at('09:00'), at('09:30'), 0)], NOW).unfolded, false, 'one still runs');
  assert.strictEqual(workerList([W('b', 'done', at('09:00'), at('09:30'), 0)], NOW).unfolded, true, 'none runs and there are few');
  assert.strictEqual(workerList(Array.from({ length: 4 }, (_, i) => W(`e${i}`, 'done', at('09:00'), at('09:30'), 0)), NOW).unfolded, false);

  const ten = workerList(Array.from({ length: 10 }, (_, i) => W(`r${i}`, 'running', at('09:00'), null, 0)), NOW);
  assert.deepStrictEqual([ten.running.length, ten.more, ten.summary], [8, 2, '10 running']);
  assert.deepStrictEqual(workerList(undefined, NOW), { running: [], more: 0, ended: [], unfolded: true, summary: '' });
});

test('slash commands: a name and what follows it; a path is not one; "/" suggests them all', () => {
  assert.deepStrictEqual(command('/model Opus'), { name: 'model', arg: 'opus', known: true });
  assert.deepStrictEqual(command('  /clear '), { name: 'clear', arg: '', known: true });
  assert.deepStrictEqual(command('/compact now'), { name: 'compact', arg: 'now', known: false });
  assert.strictEqual(command('/Users/a/shop fix it'), null);
  assert.strictEqual(command('/'), null);
  assert.strictEqual(command('fix /model'), null);
  assert.deepStrictEqual(suggestions('/').map((c) => c.name), ['model', 'effort', 'clear', 'stop', 'cost', 'help']);
  assert.deepStrictEqual(suggestions('/c').map((c) => c.name), ['clear', 'cost']);
  assert.deepStrictEqual(suggestions('/e').map((c) => c.name), ['effort']);
  assert.deepStrictEqual(command('/effort XHigh'), { name: 'effort', arg: 'xhigh', known: true });
  assert.deepStrictEqual(suggestions('/model opus'), []);
  assert.deepStrictEqual(suggestions('hi'), []);
});

test("the answers the page gives itself: help, an unknown command, and the session's tokens", () => {
  assert.deepStrictEqual(helpLines(), [...COMMANDS.map((c) => `/${c.name} · ${c.hint}`), 'Other / commands go to Claude Code.']);
  assert.strictEqual(helpLines()[0], '/model · pick the model: default, fable, opus, sonnet or haiku');
  assert.deepStrictEqual(costLines({ stats: { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 }, workers: [{ tokens: 100_000 }, { tokens: 20_000 }] }), [
    'Tokens so far: 1.2M in · 34k out', 'Model: Opus 5.5', 'Workers: 2 · 120k tokens', "Cost isn't in the session file. Type /cost in the terminal for it.",
  ]);
  assert.deepStrictEqual(costLines({ stats: { model: 'claude-opus-5-5', input: 232_668_833, output: 440_044, context: 301_124 }, workers: [] }).slice(0, 2),
    ['Context now: 301k · Out so far: 440k', 'Model: Opus 5.5']);
  assert.deepStrictEqual(costLines({}), ['Tokens so far: 0 in · 0 out', "Cost isn't in the session file. Type /cost in the terminal for it."]);
});

test('the /model picker opens on the current model (the session\'s, else the saved one, else Default) and effort', () => {
  assert.strictEqual(aliasOf('claude-opus-5-5'), 'opus');
  assert.strictEqual(aliasOf('claude-sonnet-4-5-20250929'), 'sonnet');
  assert.strictEqual(aliasOf('gpt-4'), null);
  const p = pickerOpen({ stats: { model: 'claude-opus-5-5' }, savedModel: 'haiku', savedEffort: 'high' });
  assert.deepStrictEqual(p.rows.map((r) => r.alias), ['default', 'opus', 'sonnet', 'fable', 'haiku']);
  assert.deepStrictEqual([p.current, p.index, p.effort, p.focus], ['opus', 1, 'high', 'model']);
  assert.strictEqual(p.rows[1].name, 'Opus 5.5', 'the real name where it is known');
  assert.strictEqual(p.rows[1].hint, 'Most capable, for complex work');
  const saved = pickerOpen({ savedModel: 'haiku', savedEffort: 'bogus', focus: 'effort' });
  assert.deepStrictEqual([saved.current, saved.index, saved.effort, saved.focus], ['haiku', 4, null, 'effort']);
  assert.strictEqual(pickerOpen({}).current, 'default');
  assert.strictEqual(pickerOpen({ savedModel: 'gpt' }).current, 'default');
});

test('the picker moves: up and down round the models, left and right along the efforts (ends stop)', () => {
  let p = pickerOpen({ savedModel: 'default', savedEffort: 'xhigh' });
  assert.strictEqual(pickerMove(p, -1).index, 4, 'up from the first goes round');
  p = pickerMove(pickerMove(p, 1), 1);
  assert.strictEqual(p.index, 2);
  p = pickerEffort(p, 1);
  assert.strictEqual(p.effort, 'max');
  assert.strictEqual(pickerEffort(p, 1).effort, 'max', 'stops at Max');
  assert.strictEqual(pickerEffort(pickerOpen({ savedEffort: 'low' }), -1).effort, 'low', 'stops at Low');
  assert.strictEqual(pickerEffort(pickerOpen({}), 1).effort, 'medium', 'none chosen: lands on Medium');
  assert.strictEqual(pickerPick(p, { model: 'haiku', effort: 'low' }).index, 4);
  assert.strictEqual(pickerPick(p, { model: 'gpt', effort: 'huge' }).index, 2, 'only the listed ones');
  assert.strictEqual(pickerPick(p, { effort: 'huge' }).effort, 'max');
});

test('Enter on the picker types /model for a changed model and /effort for a changed effort, and says so', () => {
  const open = pickerOpen({ stats: { model: 'claude-opus-5-5' }, savedEffort: 'medium' });
  assert.deepStrictEqual(pickerApply(pickerEffort(pickerMove(open, 1), 1)), {
    commands: [{ name: 'model', arg: 'sonnet' }, { name: 'effort', arg: 'high' }], note: 'Model: Sonnet · Effort: High',
  });
  assert.deepStrictEqual(pickerApply(pickerEffort(open, 1)).commands, [{ name: 'effort', arg: 'high' }]);
  assert.deepStrictEqual(pickerApply(pickerMove(open, -1)), { commands: [{ name: 'model', arg: 'default' }], note: 'Model: Default · Effort: Medium' });
  assert.deepStrictEqual(pickerApply(open), { commands: [], note: 'No change. Model: Opus · Effort: Medium' });
  assert.deepStrictEqual(pickerApply(pickerOpen({ savedModel: 'haiku' })), { commands: [], note: 'No change. Model: Haiku' });
});

test('/effort: the five levels, and words that list them for any other', () => {
  assert.deepStrictEqual(EFFORTS, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.strictEqual(noSuchEffort('huge'), 'There is no effort level called huge. Try low, medium, high, xhigh or max.');
  assert.ok(helpLines().includes('/effort · how hard Claude thinks: low, medium, high, xhigh or max'));
});
