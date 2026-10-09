// Buddy on iPhone: Settings → Admin's form logic (web/public/app/admin-core.js), the Mac's Admin window's.

import test from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import * as core from '../web/public/app/admin-core.js';

const PROVIDERS = [
  { id: 'anthropic', label: 'Claude (Anthropic)', hasKey: false, fallbackModels: ['claude-haiku-4-5-20251001'] },
  { id: 'openai', label: 'OpenAI', hasKey: true, fallbackModels: ['gpt-4.1-mini'] },
  { id: 'gemini', label: 'Google Gemini', hasKey: false, fallbackModels: ['gemini-flash-latest'] },
  { id: 'groq', label: 'Groq', hasKey: true, fallbackModels: ['llama-3.3-70b-versatile'] },
];
const config = (fields = {}) => ({
  enabled: true, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'openai', model: 'gpt-4.1-mini', clawdLook: 'head', ...fields,
});

test("the words are the Mac Admin window's", () => {
  const mac = fs.readFileSync(new URL('../src/renderer/admin/index.html', import.meta.url), 'utf8')
    + fs.readFileSync(new URL('../src/renderer/admin/admin.js', import.meta.url), 'utf8');
  for (const name of ['NO_KEYS', 'VOICE_ON', 'VOICE_OFF', 'LOADING_MODELS', 'USUAL_MODELS', 'SAVING', 'SAVED', 'CLAWD_SAVED']) {
    assert.ok(mac.includes(core[name]), `${name}: "${core[name]}" is not the Mac's`);
  }
});

test('only providers with a key on the server can be picked, plus the saved one', () => {
  assert.deepStrictEqual(core.formView({ config: config(), providers: PROVIDERS }).providers, [
    { value: 'openai', label: 'OpenAI', selected: true },
    { value: 'groq', label: 'Groq', selected: false },
  ]);
  assert.deepStrictEqual(core.formView({ config: config({ provider: 'gemini' }), providers: PROVIDERS }).providers.map((p) => p.label), [
    'OpenAI', 'Google Gemini (no key on the server)', 'Groq',
  ]);
});

test('no key on the server: the note, and free mode cannot be switched on (only off)', () => {
  const none = PROVIDERS.map((p) => ({ ...p, hasKey: false }));
  const off = core.formView({ config: config({ enabled: false }), providers: none });
  assert.deepStrictEqual([off.noKeys, off.enabledLocked], [true, true]);
  assert.strictEqual(core.formView({ config: config({ enabled: true }), providers: none }).enabledLocked, false);
  assert.strictEqual(core.formView({ config: config(), providers: PROVIDERS }).noKeys, false);
});

test('the form as a patch: the daily box and own key only for a daily limit', () => {
  const form = { enabled: true, daily: '50', own: true, provider: 'groq', model: 'llama-3.3-70b-versatile' };
  assert.deepStrictEqual(core.readForm({ ...form, limitMode: 'daily' }), {
    enabled: true, limitMode: 'daily', provider: 'groq', model: 'llama-3.3-70b-versatile', dailyRequests: 50, allowOwnKey: true,
  });
  assert.deepStrictEqual(core.readForm({ ...form, limitMode: 'unlimited', daily: 'oops' }), {
    enabled: true, limitMode: 'unlimited', provider: 'groq', model: 'llama-3.3-70b-versatile',
  });
  assert.strictEqual(core.readForm({ ...form, limitMode: undefined }).limitMode, 'daily');
  assert.strictEqual(core.dailyShown('daily'), true);
  assert.strictEqual(core.dailyShown('unlimited'), false);
});

test('the models, the voice line, the users', () => {
  assert.deepStrictEqual(core.modelOptions(['a', 'b'], 'b').map((o) => o.selected), [false, true]);
  assert.deepStrictEqual(core.modelOptions(['a'], 'old').map((o) => o.value), ['old', 'a'], 'the saved model stays in the list');
  assert.strictEqual(core.modelsNote({ live: true }), '');
  assert.strictEqual(core.modelsNote({ live: false, warning: "Couldn't load…" }), '');
  assert.strictEqual(core.modelsNote({ live: false }), core.USUAL_MODELS);
  assert.deepStrictEqual(core.voiceLine(true), { text: 'Voice is on.', kind: 'muted' });
  assert.deepStrictEqual(core.voiceLine(false), { text: 'Voice needs GROQ_API_KEY in Vercel.', kind: 'note' });
  assert.strictEqual(core.lastActiveText(null), 'never');
  assert.strictEqual(core.lastActiveText('2026-10-09T10:00:00.000Z'), new Date('2026-10-09T10:00:00.000Z').toLocaleString());
  assert.strictEqual(core.usersText(1), '1 user');
  assert.strictEqual(core.usersText(0), '0 users');
});
