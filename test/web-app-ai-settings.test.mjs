// Buddy on iPhone: Settings → AI's words and model list (web/public/app/ai-settings.js).

import test from 'node:test';
import assert from 'node:assert';
import { keyLine, modelList, NO_KEY_YET } from '../web/public/app/ai-settings.js';

test('a saved key shows only its last 4 characters, and the AI it was switched to', () => {
  assert.strictEqual(keyLine(''), NO_KEY_YET);
  assert.strictEqual(keyLine('9876'), 'Key saved ✓ (ends in 9876)');
  assert.strictEqual(keyLine('9876', 'Groq'), 'That key is for Groq, so I switched to Groq. Key saved ✓ (ends in 9876)');
});

test('the model in use is always in the list, first when the list does not have it', () => {
  assert.deepStrictEqual(modelList(['a', 'b'], 'b'), ['a', 'b']);
  assert.deepStrictEqual(modelList(['a', 'b'], 'old'), ['old', 'a', 'b']);
});
