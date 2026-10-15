#!/usr/bin/env node
'use strict';

/**
 * Makes Buddy's voice-model release files. Takes the public upstream Vosk model zip (downloaded, or given with
 * --from <zip>), checks it has the acoustic model and the words list, and writes into release/voice-model/:
 * the zip as it is (Android) and the same folder as a .tar.gz (the Mac; vosk-browser reads that). Prints each file's
 * SHA-256 and size for shared/voice-model.js. It does not publish anything: the owner does that.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const NAME = 'vosk-model-small-en-in-0.4';
const UPSTREAM = `https://alphacephei.com/vosk/models/${NAME}.zip`;
const CHECK = ['haan', 'nahi', 'na', 'ha', "don't", 'aarav', 'anaya', 'rahul', 'priya'];
const OUT = path.join(__dirname, '..', 'release', 'voice-model');

function sha256(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Asks the model itself which of CHECK it does not know (Vosk's vosk_model_find_word), in a throwaway Python venv. */
function missingWords(dir) {
  try {
    const venv = path.join(OUT, '.venv');
    const py = path.join(venv, 'bin', 'python');
    if (!fs.existsSync(py)) execFileSync('python3', ['-m', 'venv', venv], { stdio: 'ignore' });
    execFileSync(py, ['-m', 'pip', 'install', '-q', 'vosk'], { stdio: 'ignore' });
    const code = 'import sys,json\nfrom vosk import Model, SetLogLevel\nSetLogLevel(-1)\nm=Model(sys.argv[1])\n'
      + 'print(json.dumps([w for w in json.loads(sys.argv[2]) if m.vosk_model_find_word(w) == -1]))';
    const out = execFileSync(py, ['-c', code, dir, JSON.stringify(CHECK)], { encoding: 'utf8' }).trim().split('\n').pop();
    return `missing: [${JSON.parse(out).map((w) => `'${w}'`).join(', ')}],`;
  } catch {
    return 'unknown';
  }
}

async function main() {
  const from = process.argv.indexOf('--from') > -1 ? process.argv[process.argv.indexOf('--from') + 1] : null;
  fs.mkdirSync(OUT, { recursive: true });
  const zip = path.join(OUT, `${NAME}.zip`);
  if (from) {
    fs.copyFileSync(from, zip);
  } else {
    const res = await fetch(UPSTREAM, { redirect: 'follow' });
    if (!res.ok) fail(`download failed: ${res.status} ${UPSTREAM}`);
    fs.writeFileSync(zip, Buffer.from(await res.arrayBuffer()));
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-voice-model-'));
  try {
    execFileSync('unzip', ['-q', zip, '-d', temp]);
    const dir = path.join(temp, NAME);
    if (!fs.existsSync(path.join(dir, 'am', 'final.mdl'))) fail(`${NAME}/am/final.mdl is missing from the zip`);
    const tgz = path.join(OUT, `${NAME}.tar.gz`);
    // gzip -n leaves the clock out, so the same model always gives the same file and SHA-256.
    execFileSync('sh', ['-c', 'tar -cf - -C "$1" "$2" | gzip -n > "$3"', 'sh', temp, NAME, tgz]);

    for (const f of [zip, tgz]) console.log(`${path.basename(f).padEnd(34)} ${sha256(f)}  ${fs.statSync(f).size}`);
    console.log(`paste into VOICE_MODEL (shared/voice-model.js):  ${missingWords(dir)}`);
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((e) => fail(String(e && e.message || e)));
