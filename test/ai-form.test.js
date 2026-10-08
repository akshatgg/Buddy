'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { aiChoiceView, CLAUDE_DEFAULT_MODEL } = require('../src/renderer/common/ai-form.js');
const { DEFAULT_MODEL } = require('../src/main/claude/find');

const KEYED = { id: 'openai', label: 'OpenAI', keyUrl: 'https://platform.openai.com/api-keys', fallbackModels: ['gpt-4.1', 'gpt-4.1-mini'], hasKey: true, needsKey: true };
const STATUS = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max' };
const CLAUDE = {
  id: 'claude-code', label: 'Claude Code on this computer', keyUrl: 'https://claude.com/claude-code',
  fallbackModels: ['fable', 'opus', 'sonnet', 'haiku'], modelLabels: { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' },
  hasKey: true, needsKey: false, status: STATUS, line: { text: 'Claude Code: signed in as a@b.com (Max)', link: null },
};

test('an AI with a key: the key box, no line, and the models by their own names', () => {
  assert.deepStrictEqual(aiChoiceView(KEYED, { models: ['gpt-4.1', 'o3'], chosen: 'o3' }), {
    needsKey: true,
    lineText: '',
    lineKind: 'muted',
    link: null,
    options: [{ value: 'gpt-4.1', label: 'gpt-4.1', selected: false }, { value: 'o3', label: 'o3', selected: true }],
  });
  // An older snapshot without needsKey is an AI with a key.
  assert.strictEqual(aiChoiceView({ ...KEYED, needsKey: undefined }).needsKey, true);
});

test('Claude Code: the status line in place of the key box, green when signed in, and the models with their names', () => {
  const view = aiChoiceView(CLAUDE, { chosen: 'opus' });
  assert.deepStrictEqual(view, {
    needsKey: false,
    lineText: 'Claude Code: signed in as a@b.com (Max)',
    lineKind: 'good',
    link: null,
    options: [
      { value: 'fable', label: 'Fable', selected: false },
      { value: 'opus', label: 'Opus', selected: true },
      { value: 'sonnet', label: 'Sonnet', selected: false },
      { value: 'haiku', label: 'Haiku', selected: false },
    ],
  });
  // Without a saved alias (or with one that is not its own), Sonnet is shown chosen: it is the one ai.js uses.
  for (const chosen of [undefined, 'gpt-4.1']) {
    assert.deepStrictEqual(aiChoiceView(CLAUDE, { chosen }).options.filter((o) => o.selected).map((o) => o.value), ['sonnet']);
  }
  assert.strictEqual(CLAUDE_DEFAULT_MODEL, DEFAULT_MODEL, "the form's default is find.js's");
  // An AI with a key and no saved model: nothing is marked, and the list shows its first, which ai.js uses.
  assert.ok(aiChoiceView(KEYED).options.every((o) => !o.selected));
});

test('Claude Code not signed in, or not installed: the line is quiet, with the Get Claude Code link when it is missing', () => {
  const out = aiChoiceView({ ...CLAUDE, hasKey: false, line: { text: 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.', link: null } });
  assert.deepStrictEqual([out.lineKind, out.link], ['muted', null]);
  const link = { label: 'Get Claude Code', url: 'https://claude.com/claude-code' };
  const none = aiChoiceView({ ...CLAUDE, hasKey: false, line: { text: "Claude Code isn't installed on this computer.", link } });
  assert.deepStrictEqual([none.lineText, none.lineKind, none.link], ["Claude Code isn't installed on this computer.", 'muted', link]);
});
