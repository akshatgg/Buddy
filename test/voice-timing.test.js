'use strict';

const test = require('node:test');
const assert = require('node:assert');
const {
  createVoiceTiming, levelOf, recordingMime, listensOnOpen, SPEECH_LEVEL, QUIET_MS, MIN_SPEECH_MS, NOTHING_MS, MAX_MS,
} = require('../src/renderer/panel/voice-timing.js');

const LOUD = 0.2;
const QUIET = 0.01;

/**
 * Feeds a timing a level every 100 ms, as the panel does, from `from` up to and including `to`: `level(ms)` says how
 * loud it was then. Answers what each feed answered, by its ms.
 */
function run(timing, from, to, level) {
  const out = new Map();
  for (let ms = from; ms <= to; ms += 100) out.set(ms, timing.feed(typeof level === 'function' ? level(ms) : level, ms));
  return out;
}

test('the numbers are the ones agreed', () => {
  assert.strictEqual(SPEECH_LEVEL, 0.06);
  assert.strictEqual(QUIET_MS, 1500);
  assert.strictEqual(MIN_SPEECH_MS, 300);
  assert.strictEqual(NOTHING_MS, 8000);
  assert.strictEqual(MAX_MS, 60000);
});

test('it keeps listening while the person speaks', () => {
  const timing = createVoiceTiming();
  const out = run(timing, 100, 5000, LOUD);
  assert.ok([...out.values()].every((answer) => answer === 'listen'));
  assert.strictEqual(timing.heardVoice(), true);
});

test('1.5 s of quiet after speaking ends it: done', () => {
  const timing = createVoiceTiming();
  // A second and a half of quiet first, then speech from 1.6 s to 2.5 s, then quiet.
  const out = run(timing, 100, 4000, (ms) => (ms > 1500 && ms <= 2500 ? LOUD : QUIET));
  assert.strictEqual(out.get(2500), 'listen');
  assert.strictEqual(out.get(3900), 'listen'); // 1.4 s of quiet
  assert.strictEqual(out.get(4000), 'done'); // 1.5 s of quiet
  assert.strictEqual(timing.heardVoice(), true);
});

test('a pause shorter than 1.5 s between words does not end it', () => {
  const timing = createVoiceTiming();
  const words = (ms) => (ms <= 1000 || (ms > 2300 && ms <= 3000) ? LOUD : QUIET); // 1.3 s pause from 1.1 s to 2.3 s
  const out = run(timing, 100, 4500, words);
  assert.ok([...out.entries()].filter(([ms]) => ms < 4500).every(([, answer]) => answer === 'listen'));
  assert.strictEqual(out.get(4500), 'done');
});

test('a level just at the speech level counts as speech; one just under it does not', () => {
  const loud = createVoiceTiming();
  run(loud, 100, 300, SPEECH_LEVEL);
  assert.strictEqual(loud.heardVoice(), true);
  const quiet = createVoiceTiming();
  run(quiet, 100, 3000, SPEECH_LEVEL - 0.001);
  assert.strictEqual(quiet.heardVoice(), false);
});

test('too little speech is noise: a short sound does not end it, and it is not a voice', () => {
  const timing = createVoiceTiming();
  // 200 ms of sound (a click, a cough), then quiet.
  const out = run(timing, 100, 7900, (ms) => (ms > 1000 && ms <= 1200 ? LOUD : QUIET));
  assert.ok([...out.values()].every((answer) => answer === 'listen'));
  assert.strictEqual(timing.heardVoice(), false);
  // Nothing more said by 8 s: it stops quietly.
  assert.strictEqual(timing.feed(QUIET, 8000), 'nothing');
  assert.strictEqual(timing.heardVoice(), false);
});

test('speech is counted all together: short sounds that add up to 300 ms are a voice', () => {
  const timing = createVoiceTiming();
  const bursts = (ms) => ([1000, 1200, 1400].includes(ms) ? LOUD : QUIET); // three sounds of 100 ms
  const out = run(timing, 100, 2900, bursts);
  assert.strictEqual(timing.heardVoice(), true);
  assert.strictEqual(out.get(2800), 'listen');
  assert.strictEqual(out.get(2900), 'done'); // 1.5 s after the last one
});

test('nothing said for 8 s: nothing', () => {
  const timing = createVoiceTiming();
  const out = run(timing, 100, 8000, QUIET);
  assert.strictEqual(out.get(7900), 'listen');
  assert.strictEqual(out.get(8000), 'nothing');
  assert.strictEqual(timing.heardVoice(), false);
});

test('a word begun just before 8 s is heard out', () => {
  const timing = createVoiceTiming();
  const out = run(timing, 100, 9800, (ms) => (ms >= 7900 && ms <= 8300 ? LOUD : QUIET));
  assert.strictEqual(out.get(8000), 'listen');
  assert.strictEqual(out.get(8100), 'listen');
  assert.strictEqual(timing.heardVoice(), true);
  assert.strictEqual(out.get(9700), 'listen');
  assert.strictEqual(out.get(9800), 'done');
});

test('at 60 s it is too long', () => {
  const talking = createVoiceTiming();
  const out = run(talking, 100, MAX_MS, LOUD);
  assert.strictEqual(out.get(MAX_MS - 100), 'listen');
  assert.strictEqual(out.get(MAX_MS), 'too-long');
  assert.strictEqual(talking.heardVoice(), true); // so the panel sends it, like done

  // Talking with pauses that are always too short to end it.
  const pauses = createVoiceTiming();
  const out2 = run(pauses, 100, MAX_MS, (ms) => (ms % 2000 < 1000 ? LOUD : QUIET));
  assert.strictEqual(out2.get(MAX_MS - 100), 'listen');
  assert.strictEqual(out2.get(MAX_MS), 'too-long');
});

test('quiet after speech at 60 s is done rather than too long', () => {
  const timing = createVoiceTiming();
  run(timing, MAX_MS - 2000, MAX_MS - 1500, LOUD);
  assert.strictEqual(timing.feed(QUIET, MAX_MS), 'done');
});

test('once it has ended, it stays ended', () => {
  const done = createVoiceTiming();
  run(done, 100, 500, LOUD);
  assert.strictEqual(done.feed(QUIET, 2000), 'done');
  assert.strictEqual(done.feed(LOUD, 2100), 'done');
  assert.strictEqual(done.feed(QUIET, 9000), 'done');

  const nothing = createVoiceTiming();
  assert.strictEqual(nothing.feed(QUIET, 8000), 'nothing');
  assert.strictEqual(nothing.feed(LOUD, 8100), 'nothing');
  assert.strictEqual(nothing.heardVoice(), false);
});

test('a long gap with no levels is not taken for that much speech', () => {
  const timing = createVoiceTiming();
  assert.strictEqual(timing.feed(LOUD, 3000), 'listen'); // the first level, 3 s in (the page was busy)
  assert.strictEqual(timing.heardVoice(), false);
  timing.feed(LOUD, 3100);
  assert.strictEqual(timing.heardVoice(), true);
});

test('a level that is not a number is quiet', () => {
  const timing = createVoiceTiming();
  for (let ms = 100; ms <= 1000; ms += 100) assert.strictEqual(timing.feed(Number.NaN, ms), 'listen');
  assert.strictEqual(timing.feed(undefined, 1100), 'listen');
  assert.strictEqual(timing.heardVoice(), false);
});

test('a fresh timing has heard nothing', () => {
  assert.strictEqual(createVoiceTiming().heardVoice(), false);
});

test('the level is the loudness of the samples (their RMS), 0 to 1', () => {
  assert.strictEqual(levelOf(new Float32Array(0)), 0);
  assert.strictEqual(levelOf(new Float32Array(128)), 0);
  assert.strictEqual(levelOf(Float32Array.from([0.5, -0.5, 0.5, -0.5])), 0.5);
  assert.ok(Math.abs(levelOf(Float32Array.from([0.3, 0, -0.3, 0])) - Math.sqrt(0.045)) < 1e-6);
  assert.strictEqual(levelOf(Float32Array.from([2, -2])), 1); // clipped samples say no more than "as loud as it goes"
  assert.strictEqual(levelOf(null), 0);
});

test("the recording's type is written the way the server takes it", () => {
  assert.strictEqual(recordingMime('audio/webm;codecs=opus'), 'audio/webm;codecs=opus');
  assert.strictEqual(recordingMime('audio/webm; codecs=opus'), 'audio/webm;codecs=opus');
  assert.strictEqual(recordingMime('Audio/WebM;Codecs="opus"'), 'audio/webm;codecs=opus');
  assert.strictEqual(recordingMime('audio/ogg;codecs=opus'), 'audio/ogg;codecs=opus');
  assert.strictEqual(recordingMime('audio/mp4'), 'audio/mp4');
  assert.strictEqual(recordingMime('audio/wav'), 'audio/wav');
  // A kind of recording the server takes, with codecs it doesn't list: the kind alone.
  assert.strictEqual(recordingMime('audio/mp4;codecs=mp4a.40.2'), 'audio/mp4');
  assert.strictEqual(recordingMime('audio/webm;codecs=pcm'), 'audio/webm');
  // Nothing said (a browser that tells it only once it records), or something unknown: what Chromium records.
  assert.strictEqual(recordingMime(''), 'audio/webm');
  assert.strictEqual(recordingMime(undefined), 'audio/webm');
  assert.strictEqual(recordingMime('video/x-matroska;codecs=opus'), 'audio/webm');
});

test('the panel listens by itself when it opens only with voice on, the setting on and the microphone allowed', () => {
  const voice = { on: true, auto: true, mic: 'granted', system: 'darwin' };
  assert.strictEqual(listensOnOpen(voice), true);
  assert.strictEqual(listensOnOpen({ ...voice, mic: 'unknown', system: 'win32' }), true); // Windows does not ask per app
  assert.strictEqual(listensOnOpen({ ...voice, on: false }), false);
  assert.strictEqual(listensOnOpen({ ...voice, auto: false }), false);
  for (const mic of ['denied', 'not-determined', 'restricted', undefined]) assert.strictEqual(listensOnOpen({ ...voice, mic }), false, mic);
  assert.strictEqual(listensOnOpen(undefined), false); // a main process that says nothing about voice
  assert.strictEqual(listensOnOpen({ on: 'yes', auto: 1, mic: 'granted' }), false);
});
