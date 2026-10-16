#!/usr/bin/env node
'use strict';

/**
 * Makes Buddy's voice-check release file: the upstream CAM++ model (shared/my-voice.js SPEAKER_MODEL.upstream, or
 * --from <file>), checked against the SHA-256 Buddy expects, copied to release/speaker-model/<file>. Prints the command
 * that publishes it. It does not publish anything: the owner does that.
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { SPEAKER_MODEL } = require('../shared/my-voice');

const OUT = path.join(__dirname, '..', 'release', 'speaker-model');

async function main() {
  const from = process.argv.indexOf('--from') > -1 ? process.argv[process.argv.indexOf('--from') + 1] : null;
  fs.mkdirSync(OUT, { recursive: true });
  const file = path.join(OUT, SPEAKER_MODEL.file);
  if (from) fs.copyFileSync(from, file);
  else {
    const res = await fetch(SPEAKER_MODEL.upstream, { redirect: 'follow' });
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  }
  const sha = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  const bytes = fs.statSync(file).size;
  if (sha !== SPEAKER_MODEL.sha256 || bytes !== SPEAKER_MODEL.bytes) {
    fs.rmSync(file, { force: true });
    throw new Error(`not the expected model: ${sha} ${bytes}`);
  }
  console.log(`${SPEAKER_MODEL.file}  ${sha}  ${bytes}`);
  console.log(`publish (owner): gh release create ${SPEAKER_MODEL.tag} "${file}" --repo akshatgg/Buddy --title "Voice check model 1" `
    + '--notes "3D-Speaker CAM++ zh-en common-advanced (Apache 2.0), from sherpa-onnx. Used by Only my voice." --latest=false');
}

main().catch((e) => { console.error(String(e && e.message || e)); process.exit(1); });
