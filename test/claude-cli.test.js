'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { toolCall, summaryText, rows, inline, workingVerb, VERBS } = require('../src/renderer/panel/claude-cli.js');

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
