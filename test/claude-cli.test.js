'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  toolCall, summaryText, rows, inline, workingVerb, VERBS,
  tokenCount, modelName, elapsed, statusLine, workerList, command, suggestions, helpLines, costLines, COMMANDS,
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

test('the status line: the model, then tokens in and out; nothing before any reply', () => {
  assert.strictEqual(statusLine({ model: 'claude-opus-5-5', input: 1_234_567, output: 34_000 }), 'Opus 5.5 · 1.2M in · 34k out');
  assert.strictEqual(statusLine({ model: null, input: 0, output: 0 }), '');
  assert.strictEqual(statusLine(undefined), '');
});

test('workers: running ones and those that ended in the last 5 minutes, folded into one line above three', () => {
  const now = Date.parse('2026-10-17T10:10:00Z');
  const at = (s) => Date.parse(`2026-10-17T10:${s}Z`);
  const w = (id, status, startedAt, endedAt, tokens) => ({ id, task: `job ${id}`, status, startedAt, endedAt, tokens });
  const two = workerList([w('a', 'running', at('08:48'), null, 12_300), w('b', 'done', at('00:00'), at('01:00'), 0), w('c', 'failed', at('06:00'), at('07:00'), 900)], now);
  assert.deepStrictEqual(two.lines, [
    { id: 'a', status: 'running', text: 'job a · running · 1m 12s · 12.3k tokens' },
    { id: 'c', status: 'failed', text: 'job c · failed · 1m 0s · 900 tokens' },
  ]);
  assert.strictEqual(two.compact, false);
  const many = workerList([w('a', 'running', at('09:00'), null, 0), w('b', 'running', at('09:00'), null, 0), w('c', 'done', at('09:00'), at('09:30'), 0),
    w('d', 'stopped', at('09:00'), at('09:30'), 0)], now);
  assert.strictEqual(many.compact, true);
  assert.strictEqual(many.summary, '4 workers · 2 running · 1 done · 1 stopped');
  assert.deepStrictEqual(workerList(undefined, now), { lines: [], compact: false, summary: '0 workers' });
});

test('slash commands: a name and what follows it; a path is not one; "/" suggests them all', () => {
  assert.deepStrictEqual(command('/model Opus'), { name: 'model', arg: 'opus', known: true });
  assert.deepStrictEqual(command('  /clear '), { name: 'clear', arg: '', known: true });
  assert.deepStrictEqual(command('/compact now'), { name: 'compact', arg: 'now', known: false });
  assert.strictEqual(command('/Users/a/shop fix it'), null);
  assert.strictEqual(command('/'), null);
  assert.strictEqual(command('fix /model'), null);
  assert.deepStrictEqual(suggestions('/').map((c) => c.name), ['model', 'clear', 'stop', 'cost', 'help']);
  assert.deepStrictEqual(suggestions('/c').map((c) => c.name), ['clear', 'cost']);
  assert.deepStrictEqual(suggestions('/model opus'), []);
  assert.deepStrictEqual(suggestions('hi'), []);
});

test("the answers the page gives itself: help, an unknown command, and the session's tokens", () => {
  assert.deepStrictEqual(helpLines(), [...COMMANDS.map((c) => `/${c.name} · ${c.hint}`), 'Other / commands go to Claude Code.']);
  assert.strictEqual(helpLines()[0], '/model · pick the model: fable, opus, sonnet or haiku');
  assert.deepStrictEqual(costLines({ stats: { model: 'claude-opus-5-5', input: 1_200_000, output: 34_000 }, workers: [{ tokens: 100_000 }, { tokens: 20_000 }] }), [
    'Tokens so far: 1.2M in · 34k out', 'Model: Opus 5.5', 'Workers: 2 · 120k tokens', "Cost isn't in the session file. Type /cost in the terminal for it.",
  ]);
  assert.deepStrictEqual(costLines({}), ['Tokens so far: 0 in · 0 out', "Cost isn't in the session file. Type /cost in the terminal for it."]);
});
