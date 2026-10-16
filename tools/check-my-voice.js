#!/usr/bin/env node
'use strict';

/**
 * The desktop check of "Only my voice": the real engine and the real model, no microphone. Never run by `npm test`.
 *
 *   node tools/check-my-voice.js [--model <onnx>] --say
 *   node tools/check-my-voice.js [--model <onnx>] --enroll a.wav b.wav c.wav d.wav e.wav --test x.wav ...
 *   npx electron tools/check-my-voice.js --say --utility     (the same, through the app's own utility process)
 *
 * WAVs are 16 kHz, mono, 16-bit. --say makes its own takes with macOS `say` (six voices, several speeds), enrols each
 * voice in turn and scores the other voices against it. It exits 1 (FAIL) when a voice's own score is below
 * MY_VOICE.match, or when more than 15% of the other voices' scores reach it. Nothing is written but temp files.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { MY_VOICE, createSetup, cosine, isMe } = require('../shared/my-voice');
const { makeEmbedder } = require('../src/main/voice-check-worker');

const VOICES = ['Aman', 'Rishi', 'Samantha', 'Karen', 'Daniel', 'Fred'];
const ENROLL_RATES = [150, 165, 180, 195, 210];
const TEST_RATES = [155, 170, 185, 200, 205, 160];
const SAY_TEXT = 'Hey Buddy';
const OTHER_RATE_LIMIT = 0.15;

/** The samples of a 16 kHz mono 16-bit WAV (RIFF/WAVE header checked, then the 44 header bytes skipped). */
function readWav(file) {
  const b = fs.readFileSync(file);
  if (b.length < 44 || b.toString('latin1', 0, 4) !== 'RIFF' || b.toString('latin1', 8, 12) !== 'WAVE') throw new Error(`${file}: not a WAV`);
  if (b.readUInt16LE(22) !== 1 || b.readUInt32LE(24) !== 16000 || b.readUInt16LE(34) !== 16) throw new Error(`${file}: needs 16 kHz, mono, 16-bit`);
  const bytes = b.subarray(44);
  return new Int16Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length - (bytes.length % 2)));
}

function arg(args, name) {
  const i = args.indexOf(name);
  return i < 0 ? null : args[i + 1];
}

function list(args, name) {
  const i = args.indexOf(name);
  if (i < 0) return [];
  const out = [];
  for (let k = i + 1; k < args.length && !args[k].startsWith('--'); k++) out.push(args[k]);
  return out;
}

/** An embedder: in this process, or (with --utility under Electron) through the app's voice check worker. */
async function openEmbedder(model, utility) {
  if (!utility) {
    const e = makeEmbedder(model);
    return { embed: async (pcm) => e.embed(pcm), close() {} };
  }
  const { app, utilityProcess } = require('electron');
  await app.whenReady();
  const child = utilityProcess.fork(path.join(__dirname, '..', 'src', 'main', 'voice-check-worker.js'), [model]);
  const waiting = new Map();
  let next = 1;
  child.on('message', (m) => {
    const w = waiting.get(m.id);
    if (!w) return;
    waiting.delete(m.id);
    if (m.error) w.reject(new Error(`worker: ${m.error}`)); else w.resolve(m.embedding);
  });
  return {
    embed: (pcm) => new Promise((resolve, reject) => {
      const id = next++;
      waiting.set(id, { resolve, reject });
      const copy = pcm.slice().buffer;
      child.postMessage({ id, pcm: copy });
    }),
    close() { child.kill(); },
  };
}

function say(dir, voice, rate) {
  const file = path.join(dir, `${voice}-${rate}.wav`);
  if (!fs.existsSync(file)) {
    execFileSync('say', ['-v', voice, '-r', String(rate), '--file-format=WAVE', '--data-format=LEI16@16000', '-o', file, SAY_TEXT]);
  }
  return readWav(file);
}

async function enroll(embedder, takes, print) {
  const setup = createSetup();
  let result = null;
  for (const take of takes) {
    result = setup.add(await embedder.embed(take));
    print(`  take -> ${result.step} (${result.count})`);
    if (result.step === 'done' || result.step === 'failed') break;
  }
  return result;
}

async function runSay(embedder) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-my-voice-'));
  let ok = true;
  let others = 0;
  let passes = 0;
  try {
    const emb = {};
    for (const v of VOICES) {
      emb[v] = {
        enroll: await Promise.all(ENROLL_RATES.map((r) => embedder.embed(say(dir, v, r)))),
        tests: await Promise.all(TEST_RATES.map((r) => embedder.embed(say(dir, v, r)))),
      };
    }
    for (const owner of VOICES) {
      const setup = createSetup();
      let done = null;
      for (const e of emb[owner].enroll) { done = setup.add(e); if (done.step === 'done') break; }
      if (!done || done.step !== 'done') { console.log(`${owner}: setup ${done && done.step} FAIL`); ok = false; continue; }
      const own = emb[owner].tests.map((t) => cosine(done.profile, t));
      const mean = own.reduce((a, b) => a + b, 0) / own.length;
      let top = -1;
      let topVoice = '';
      for (const other of VOICES.filter((x) => x !== owner)) {
        for (const t of emb[other].tests) {
          const c = cosine(done.profile, t);
          others += 1;
          if (isMe(done.profile, t)) passes += 1;
          if (c > top) { top = c; topVoice = other; }
        }
      }
      const bad = mean < MY_VOICE.match;
      if (bad) ok = false;
      console.log(`${owner.padEnd(9)} own ${mean.toFixed(3)} (min ${Math.min(...own).toFixed(3)})  highest other ${top.toFixed(3)} (${topVoice})${bad ? '  FAIL' : ''}`);
    }
    const rate = others ? passes / others : 0;
    console.log(`other voices reaching ${MY_VOICE.match}: ${passes}/${others} (${(rate * 100).toFixed(1)}%)`);
    if (rate > OTHER_RATE_LIMIT) ok = false;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  console.log(ok ? 'OK' : 'FAIL');
  return ok;
}

async function runFiles(embedder, enrollFiles, testFiles) {
  const done = await enroll(embedder, enrollFiles.map(readWav), console.log);
  if (!done || done.step !== 'done') { console.log('FAIL: setup did not finish'); return false; }
  for (const f of testFiles) {
    const c = cosine(done.profile, await embedder.embed(readWav(f)));
    console.log(`${path.basename(f)}  cosine ${c.toFixed(3)}  isMe ${c >= MY_VOICE.match}`);
  }
  return true;
}

async function main() {
  const args = process.argv.slice(2).filter((a) => a !== '.');
  const model = path.resolve(arg(args, '--model') || path.join(__dirname, '..', 'release', 'speaker-model', 'campplus-zh-en-advanced.onnx'));
  if (!fs.existsSync(model)) throw new Error(`no model at ${model} (pass --model <onnx>)`);
  const utility = args.includes('--utility') && Boolean(process.versions.electron);
  const embedder = await openEmbedder(model, utility);
  let ok;
  try {
    if (args.includes('--say')) ok = await runSay(embedder);
    else if (args.includes('--enroll')) ok = await runFiles(embedder, list(args, '--enroll'), list(args, '--test'));
    else throw new Error('usage: check-my-voice.js [--model <onnx>] (--say | --enroll a.wav ... --test x.wav ...)');
  } finally {
    embedder.close();
  }
  return ok;
}

main().then((ok) => {
  if (process.versions.electron) require('electron').app.exit(ok ? 0 : 1); else process.exit(ok ? 0 : 1);
}, (err) => {
  console.error(err.message);
  if (process.versions.electron) require('electron').app.exit(1); else process.exit(1);
});
