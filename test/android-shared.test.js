'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const prompts = require('../shared/prompts');
const { PROVIDER_IDS } = require('../shared/providers');
const { buildShared, buildChatCases, TO, CASES_TO } = require('../tools/sync-android-shared');

test('android shared.json is up to date with shared/ (run `npm run sync:android` after changing shared/)', () => {
  assert.equal(fs.readFileSync(TO, 'utf8'), `${JSON.stringify(buildShared(), null, 2)}\n`);
});

test('shared.json holds every tone, the three system prompts and the refusals, as the app builds them', () => {
  const s = buildShared();
  assert.deepEqual(s.tones, Object.keys(prompts.TONES));
  for (const tone of s.tones) assert.equal(s.system.write[tone], prompts.buildPrompt('write', { instruction: 'x', tone }).system);
  assert.equal(s.system.fix, prompts.buildPrompt('fix', { text: 'x' }).system);
  assert.equal(s.check.defaultQuestion, 'Is my text okay?');
  assert.equal(`${s.check.questionPrefix}Q`, prompts.buildPrompt('check', { image: 'x', instruction: 'Q' }).user);
  assert.equal(s.messages.writeEmpty, 'Tell me what to write first.');
  assert.match(s.messages.tooLongText, /over 8000 characters/);
  assert.deepEqual(s.providers.map((p) => p.id), PROVIDER_IDS);
});

test('shared.json holds the chat: its system prompt, kinds, limits and refusals, as buildPrompt makes them', () => {
  const { chat } = buildShared();
  assert.equal(chat.system, prompts.buildPrompt('chat', { message: 'x' }).system);
  assert.deepEqual(chat.kinds, prompts.KINDS);
  assert.deepEqual(chat.limits, prompts.CHAT_LIMITS);
  assert.equal(chat.messages.empty, 'Tell me what to do first.');
  assert.equal(chat.messages.secondStepOnly, 'That can only come with the second step.');
  assert.match(chat.messages.tooLongMessage, /over 1000 characters/);
});

test('the chat cases the Kotlin port is checked against are up to date, and are what shared/prompts.js answers', () => {
  assert.equal(fs.readFileSync(CASES_TO, 'utf8'), `${JSON.stringify(buildChatCases(), null, 2)}\n`);
  const { prompts: asked, replies } = buildChatCases();
  assert.ok(asked.length >= 10 && replies.length >= 10);
  for (const c of asked) {
    if (c.error) assert.throws(() => prompts.buildPrompt('chat', c.input), { message: c.error.message });
    else assert.deepEqual(prompts.buildPrompt('chat', c.input), { system: prompts.buildPrompt('chat', { message: 'x' }).system, user: c.user, image: c.image });
  }
  for (const c of replies) assert.deepEqual(prompts.parseChat(c.raw), c.reply);
});
