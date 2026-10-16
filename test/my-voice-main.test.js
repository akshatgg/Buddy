'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createMyVoice } = require('../src/main/my-voice');
const { profileJson, SPEAKER_MODEL } = require('../shared/my-voice');

const B64 = (n) => Buffer.alloc(n * 2).toString('base64'); // n samples of silence; the fake check decides the voice
const ME = Array.from({ length: 192 }, (_, i) => (i === 0 ? 1 : 0));
const OTHER = Array.from({ length: 192 }, (_, i) => (i === 1 ? 1 : 0));
const FILE = '/u/my-voice.json';
const tick = () => new Promise((r) => setImmediate(r));

function setup({ on = false, profile = null, modelReady = true, ensure = async () => {}, setupMs } = {}) {
  const data = { myVoiceOn: on };
  const store = { get: (k) => data[k], set: (o) => Object.assign(data, o) };
  const files = new Map();
  const modes = new Map();
  if (profile) files.set(FILE, JSON.stringify(profileJson(profile)));
  const fsImpl = {
    readFileSync: (f) => { if (!files.has(f)) throw new Error('ENOENT'); return files.get(f); },
    writeFileSync: (f, text, opts) => { files.set(f, text); if (opts?.mode) modes.set(f, opts.mode); },
    chmodSync: (f, mode) => { modes.set(f, mode); },
    renameSync: (a, b) => { files.set(b, files.get(a)); files.delete(a); modes.set(b, modes.get(a)); modes.delete(a); },
    rmSync: (f) => { files.delete(f); modes.delete(f); },
    existsSync: (f) => files.has(f),
  };
  const state = { problem: null };
  const calls = { embed: 0, warm: 0, close: 0 };
  const queue = [];
  const check = {
    embed: async () => { calls.embed += 1; return queue.length ? queue.shift() : null; },
    warm: () => { calls.warm += 1; },
    close: () => { calls.close += 1; },
  };
  const clips = { onClip: null, stopped: false, phrase: null };
  const wake = { clips: (phrase, onClip) => { clips.onClip = onClip; clips.phrase = phrase; return () => { clips.stopped = true; }; } };
  const removed = [];
  const model = { ready: () => modelReady, ensure, path: () => '/m.onnx', remove: () => { removed.push(1); } };
  check.problem = () => state.problem;
  const voice = createMyVoice({ store, file: FILE, fsImpl, model, check, wake, ...(setupMs ? { setupMs } : {}) });
  return { voice, removed, state, files, modes, store, clips, calls, lines: [], embedNext: (e) => queue.push(e), setModelReady: (v) => { modelReady = v; } };
}

test('off: everything is allowed, nothing is checked', async () => {
  const { voice, calls } = setup({ on: false });
  assert.strictEqual(await voice.allows(null), true);
  assert.strictEqual(calls.embed, 0);
});

test('on: only the owner passes; a short clip, a missing profile, or no embedding is a no', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { voice, files, embedNext } = setup({ on: true, profile: ME });
  embedNext(ME); assert.strictEqual(await voice.allows(B64(16000)), true);
  embedNext(OTHER); assert.strictEqual(await voice.allows(B64(16000)), false);
  assert.strictEqual(await voice.allows(B64(1000)), false, 'under 350 ms');
  assert.strictEqual(await voice.allows(B64(60000)), false, 'over 3 s');
  assert.strictEqual(await voice.allows(null), false);
  embedNext(null); assert.strictEqual(await voice.allows(B64(16000)), false);
  files.delete(FILE); voice.changed();
  embedNext(ME); assert.strictEqual(await voice.allows(B64(16000)), false, 'no profile');
});

test('on: only the code is logged, never the clip or the profile', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const { voice } = setup({ on: true, profile: ME });
  await voice.allows(B64(1000));
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] voice check:', 'short']]);
});

test('setup: five takes save the profile with mode 0600 and turn it on', async () => {
  const { voice, files, modes, store, clips, embedNext, lines } = setup({ on: false });
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  assert.strictEqual(clips.phrase, 'hey rahul');
  for (let i = 0; i < 5; i++) { embedNext(ME); await clips.onClip(B64(12000)); }
  assert.deepStrictEqual(await done, { ok: true, line: 'Done. Buddy now answers only your voice.' });
  assert.deepStrictEqual(JSON.parse(files.get(FILE)).profile, ME);
  assert.strictEqual(modes.get(FILE), 0o600);
  assert.strictEqual(files.has(`${FILE}.tmp`), false);
  assert.strictEqual(store.get('myVoiceOn'), true);
  assert.strictEqual(clips.stopped, true);
  assert.deepStrictEqual(lines, ['Say "Hey Rahul" 5 times. Wait for the tick each time.', 'Got it ✓ 1 of 5', 'Got it ✓ 2 of 5', 'Got it ✓ 3 of 5', 'Got it ✓ 4 of 5', 'Done. Buddy now answers only your voice.']);
});

test('setup: a short clip asks again and does not count', async () => {
  const { voice, clips, embedNext, lines, calls } = setup();
  voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  await clips.onClip(B64(1000));
  assert.strictEqual(calls.embed, 0, 'a short clip is not even embedded');
  embedNext(ME); await clips.onClip(B64(12000));
  assert.deepStrictEqual(lines.slice(1), ['I didn\'t get that. Say "Hey Rahul" again.', 'Got it ✓ 1 of 5']);
  voice.cancel();
});

test('setup: an odd fifth take is asked again', async () => {
  const { voice, clips, embedNext, lines, store } = setup();
  voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  for (const e of [ME, ME, ME, ME, OTHER]) { embedNext(e); await clips.onClip(B64(12000)); }
  assert.strictEqual(lines.at(-1), 'That one sounded different. Say "Hey Rahul" again.');
  assert.strictEqual(store.get('myVoiceOn'), false);
  voice.cancel();
});

test('setup: too many odd takes fail and save nothing', async () => {
  const { voice, clips, embedNext, files, store, lines } = setup();
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  // Takes that disagree with one another: one direction each, so every round has odd ones.
  const dir = (i) => Array.from({ length: 192 }, (_, k) => (k === i ? 1 : 0));
  for (let i = 0; i < 40 && !clips.stopped; i++) { embedNext(dir(i % 192)); await clips.onClip(B64(12000)); }
  const result = await done;
  assert.deepStrictEqual(result, { ok: false, line: "I couldn't learn your voice. Try again somewhere quiet." });
  assert.strictEqual(files.has(FILE), false);
  assert.strictEqual(store.get('myVoiceOn'), false);
  assert.strictEqual(clips.stopped, true);
});

test('setup: the 90 s timeout saves nothing and leaves it off', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { voice, clips, files, store } = setup();
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul' });
  await tick();
  t.mock.timers.tick(90000);
  assert.deepStrictEqual(await done, { ok: false, line: "I didn't hear you. Try again." });
  assert.strictEqual(files.has(FILE), false);
  assert.strictEqual(store.get('myVoiceOn'), false);
  assert.strictEqual(clips.stopped, true);
});

test('setup: a model that cannot be had says so', async () => {
  const { voice, lines } = setup({ modelReady: false, ensure: async () => { throw Object.assign(new Error('x'), { code: 'model_failed' }); } });
  const result = await voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  assert.deepStrictEqual(result, { ok: false, line: "Couldn't get the voice check ready. Check the internet and try again." });
  assert.strictEqual(lines[0], 'Getting the voice check ready (28 MB)…');
});

test('cancel() mid-setup saves nothing and says nothing more', async () => {
  const { voice, clips, embedNext, files, store, lines } = setup();
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  embedNext(ME); await clips.onClip(B64(12000));
  voice.cancel();
  assert.deepStrictEqual(await done, { ok: false, line: '' });
  assert.strictEqual(files.has(FILE), false);
  assert.strictEqual(store.get('myVoiceOn'), false);
  assert.strictEqual(clips.stopped, true);
  assert.deepStrictEqual(lines, ['Say "Hey Rahul" 5 times. Wait for the tick each time.', 'Got it ✓ 1 of 5']);
  assert.strictEqual(voice.state().setting, false);
});

test('a second setup call answers the running one', async () => {
  const { voice } = setup();
  const a = voice.setup({ name: 'Rahul', phrase: 'hey rahul' });
  const b = voice.setup({ name: 'Rahul', phrase: 'hey rahul' });
  assert.strictEqual(a, b);
  voice.cancel();
  await a;
});

test('off() deletes the file, sets false, closes the check', async () => {
  const { voice, files, store, calls } = setup({ on: true, profile: ME });
  voice.off();
  assert.strictEqual(files.has(FILE), false);
  assert.strictEqual(store.get('myVoiceOn'), false);
  assert.strictEqual(calls.close, 1);
  assert.strictEqual(await voice.allows(null), true, 'off again: everything allowed');
});

test('state: on with a usable profile, a profile of another model, a missing model', () => {
  const ok = setup({ on: true, profile: ME });
  assert.deepStrictEqual(ok.voice.state(), { on: true, line: 'On. Buddy answers only you.', tone: null, setting: false });
  const other = setup({ on: true, profile: ME });
  other.files.set(FILE, JSON.stringify({ ...profileJson(ME), model: 'f'.repeat(64) }));
  other.voice.changed();
  assert.deepStrictEqual(other.voice.state(), { on: true, line: 'Set up Only my voice again.', tone: 'error', setting: false });
  const nomodel = setup({ on: true, profile: ME, modelReady: false });
  assert.strictEqual(nomodel.voice.state().line, 'Set up Only my voice again.');
  assert.strictEqual(setup().voice.state().on, false);
  assert.strictEqual(SPEAKER_MODEL.dim, 192);
});

test('setup: a model that will not load is deleted and said so, not "I didn\'t get that"', async () => {
  const { voice, clips, state, removed, lines } = setup();
  const done = voice.setup({ name: 'Rahul', phrase: 'hey rahul', onLine: (l) => lines.push(l) });
  await tick();
  state.problem = 'load';
  await clips.onClip(B64(12000)); // the fake check answers null
  assert.deepStrictEqual(await done, { ok: false, line: "Couldn't get the voice check ready. Check the internet and try again." });
  assert.strictEqual(removed.length, 1);
  assert.strictEqual(clips.stopped, true);
});

test('a check that cannot load the model deletes it too', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const { voice, state, removed } = setup({ on: true, profile: ME });
  state.problem = 'load';
  assert.strictEqual(await voice.allows(B64(16000)), false);
  assert.strictEqual(removed.length, 1);
});
