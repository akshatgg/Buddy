'use strict';
const test = require('node:test');
const assert = require('node:assert');
const {
  SPEAKER_MODEL, MY_VOICE, MY_VOICE_LINES, unit, cosine, meanUnit, oddTakes, isMe, phraseSpan, createSetup,
  profileJson, readProfile, setupPhrase,
} = require('../shared/my-voice');

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} vs ${b}`);
// Two-dimensional voices are enough for the sums: a voice is a direction.
const at = (deg) => [Math.cos((deg * Math.PI) / 180), Math.sin((deg * Math.PI) / 180)];

test('the model and the numbers are the ones the spec fixed', () => {
  assert.strictEqual(SPEAKER_MODEL.sha256, 'aa3cfc16963a10586a9393f5035d6d6b57e98d358b347f80c2a30bf4f00ceba2');
  assert.strictEqual(SPEAKER_MODEL.bytes, 28281164);
  assert.strictEqual(SPEAKER_MODEL.dim, 192);
  assert.match(SPEAKER_MODEL.url, /^https:\/\/github\.com\/akshatgg\/Buddy\/releases\/download\/speaker-model-1\/campplus-zh-en-advanced\.onnx$/);
  assert.deepStrictEqual(
    { match: MY_VOICE.match, agree: MY_VOICE.agree, takes: MY_VOICE.takes, extraTakes: MY_VOICE.extraTakes },
    { match: 0.5, agree: 0.45, takes: 5, extraTakes: 3 },
  );
});

test('unit and cosine', () => {
  assert.deepStrictEqual(unit([3, 4]), [0.6, 0.8]);
  for (const bad of [[], [0, 0], [NaN, 1], [Infinity, 0], null, undefined]) assert.strictEqual(unit(bad), null);
  near(cosine([1, 0], [5, 0]), 1);
  near(cosine(at(0), at(60)), 0.5);
  assert.strictEqual(cosine([1, 0], [1, 0, 0]), -1);
  assert.strictEqual(cosine([0, 0], [1, 0]), -1);
  assert.strictEqual(cosine(Float32Array.from([1, 0]), [1, 0]), 1, 'typed arrays work');
});

test('meanUnit: the direction in the middle', () => {
  near(cosine(meanUnit([at(-10), at(10)]), at(0)), 1);
  assert.strictEqual(meanUnit([]), null);
  assert.strictEqual(meanUnit([[1, 0], [1, 0, 0]]), null);
});

test('isMe: at or above 0.50 is the owner', () => {
  assert.strictEqual(isMe(at(0), at(60)), true, 'exactly 0.50 passes');
  assert.strictEqual(isMe(at(0), at(61)), false);
  assert.strictEqual(isMe(null, at(0)), false);
  assert.strictEqual(isMe(at(0), null), false);
  assert.strictEqual(isMe(at(0), [1, 0, 0]), false, 'another size');
});

test('oddTakes: a take far from the others is odd', () => {
  assert.deepStrictEqual(oddTakes([at(0), at(5), at(-5), at(3), at(-2)]), []);
  assert.deepStrictEqual(oddTakes([at(0), at(5), at(-5), at(3), at(90)]), [4]);
  assert.deepStrictEqual(oddTakes([at(0)]), [], 'one take has nothing to agree with');
});

test('phraseSpan: padded, from zero, capped, and refused when too short', () => {
  assert.deepStrictEqual(phraseSpan(1.0, 1.6), { from: 14400, to: 27200 });
  assert.deepStrictEqual(phraseSpan(0.05, 0.6), { from: 0, to: 11200 }, 'never before the recognizer began');
  assert.deepStrictEqual(phraseSpan(0, 5), { from: 0, to: 48000 }, 'at most 3 s');
  assert.strictEqual(phraseSpan(1.0, 1.3), null, 'under 350 ms of phrase');
  assert.strictEqual(phraseSpan(1.0, 1.0), null);
  assert.strictEqual(phraseSpan(NaN, 1), null);
});

test('setup: five good takes make the profile', () => {
  const s = createSetup();
  assert.deepStrictEqual(s.add(at(0)), { step: 'more', count: 1 });
  assert.deepStrictEqual(s.add(null), { step: 'again', count: 1 }, 'a refused take asks again, and does not count');
  for (const [i, d] of [[2, 4], [3, -4], [4, 2]]) assert.deepStrictEqual(s.add(at(d)), { step: 'more', count: i });
  const done = s.add(at(-2));
  assert.strictEqual(done.step, 'done');
  assert.strictEqual(done.count, 5);
  near(cosine(done.profile, at(0)), 1, 1e-3);
  assert.strictEqual(s.add(at(0)).step, 'done', 'over is over');
});

test('setup: an odd take is dropped and asked again; too many odd ones fail', () => {
  const s = createSetup();
  for (const d of [0, 4, -4, 2]) s.add(at(d));
  assert.deepStrictEqual(s.add(at(120)), { step: 'odd', count: 4 });
  assert.strictEqual(s.add(at(1)).step, 'done');

  const f = createSetup();
  for (const d of [0, 4, -4, 2]) f.add(at(d));
  assert.strictEqual(f.add(at(120)).step, 'odd');
  assert.strictEqual(f.add(at(-120)).step, 'odd');
  assert.strictEqual(f.add(at(150)).step, 'odd');
  assert.deepStrictEqual(f.add(at(-150)), { step: 'failed', count: 4 }, 'a fourth odd take is one too many');
});

test('the profile file: only the current model, the right size, finite numbers', () => {
  const p = Array.from({ length: 192 }, (_, i) => (i === 0 ? 1 : 0));
  const json = profileJson(p, '2026-10-16T00:00:00.000Z');
  assert.deepStrictEqual(json, { v: 1, model: SPEAKER_MODEL.sha256, dim: 192, profile: p, at: '2026-10-16T00:00:00.000Z' });
  assert.deepStrictEqual(readProfile(JSON.parse(JSON.stringify(json))), p);
  assert.strictEqual(readProfile({ ...json, model: 'x' }), null);
  assert.strictEqual(readProfile({ ...json, v: 2 }), null);
  assert.strictEqual(readProfile({ ...json, profile: p.slice(1), dim: 191 }), null);
  assert.strictEqual(readProfile({ ...json, profile: [...p.slice(1), 'a'] }), null);
  assert.strictEqual(readProfile(null), null);
  assert.strictEqual(readProfile('nope'), null);
});

test('the setup phrase is the name when the model can hear it, else Hey Buddy', () => {
  assert.strictEqual(setupPhrase('Rahul', []), 'hey rahul');
  assert.strictEqual(setupPhrase('Priya', ['priya']), 'hey buddy');
  assert.strictEqual(setupPhrase('', []), 'hey buddy');
});

test('the copy, word for word', () => {
  assert.strictEqual(MY_VOICE_LINES.label, 'Only my voice');
  assert.strictEqual(MY_VOICE_LINES.about, 'Buddy answers only you. Your voice stays on this device.');
  assert.strictEqual(MY_VOICE_LINES.gettingModel, 'Getting the voice check ready (28 MB)…');
  assert.strictEqual(MY_VOICE_LINES.modelFailed, "Couldn't get the voice check ready. Check the internet and try again.");
  assert.strictEqual(MY_VOICE_LINES.start('Rahul'), 'Say "Hey Rahul" 5 times. Wait for the tick each time.');
  assert.strictEqual(MY_VOICE_LINES.got(2), 'Got it ✓ 2 of 5');
  assert.strictEqual(MY_VOICE_LINES.again('Rahul'), 'I didn\'t get that. Say "Hey Rahul" again.');
  assert.strictEqual(MY_VOICE_LINES.odd('Buddy'), 'That one sounded different. Say "Hey Buddy" again.');
  assert.strictEqual(MY_VOICE_LINES.done, 'Done. Buddy now answers only your voice.');
  assert.strictEqual(MY_VOICE_LINES.failed, "I couldn't learn your voice. Try again somewhere quiet.");
  assert.strictEqual(MY_VOICE_LINES.timedOut, "I didn't hear you. Try again.");
  assert.strictEqual(MY_VOICE_LINES.on, 'On. Buddy answers only you.');
  assert.strictEqual(MY_VOICE_LINES.setUpAgain, 'Set up Only my voice again.');
  assert.strictEqual(MY_VOICE_LINES.notYou, "That didn't sound like you.");
  assert.strictEqual(MY_VOICE_LINES.redo, 'Set up again');
});
