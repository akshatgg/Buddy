'use strict';

/**
 * A first check of the native helper on a new computer, before Buddy itself: starts bin/buddy-helper (bin\buddy-helper.exe
 * on Windows), asks it ping, frontmost and permissions, and prints its answers and the apps it says are in front for
 * 10 seconds. Click between a few apps meanwhile: each one should be named. It sends no keys and leaves the
 * clipboard alone.
 *
 *   npm run build:native
 *   node tools/helper-smoke.js
 */

const path = require('node:path');
const { Helper } = require('../src/main/helper');
const { helperFile } = require('../src/main/platform');

const WATCH_MS = 10_000;

async function main() {
  const binPath = path.join(__dirname, '..', 'bin', helperFile);
  console.log(`[smoke] starting ${binPath}`);
  const helper = new Helper({ binPath });
  helper.on('frontApp', (app) => console.log(`[smoke] in front: ${app.name || '(no name)'} (${app.bundleId}, pid ${app.pid})`));
  helper.start();
  let failed = false;
  for (const cmd of ['ping', 'frontmost', 'permissions']) {
    try {
      console.log(`[smoke] ${cmd}: ${JSON.stringify(await helper.call(cmd))}`);
    } catch (err) {
      console.log(`[smoke] ${cmd} failed: ${err.code}: ${err.message}`);
      failed = true;
    }
  }
  console.log(`[smoke] now click between a few apps for ${WATCH_MS / 1000} seconds; each one should be named above`);
  await new Promise((resolve) => setTimeout(resolve, WATCH_MS));
  helper.stop();
  console.log(failed ? '[smoke] the helper did not answer everything: see above' : '[smoke] the helper answers');
  process.exitCode = failed ? 1 : 0;
}

main();
