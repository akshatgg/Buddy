'use strict';

/**
 * A look at the agent's hands on this Mac, by hand: starts bin/buddy-helper, reads the tree of the app in front (click
 * into TextEdit or Finder within 3 seconds), prints its first 25 elements, takes a screenshot of the screen (size
 * only), then listens for Esc for 8 seconds. It sends no keys or clicks.
 *
 *   npm run build:native && node tools/agent-hands-smoke.js
 */

const path = require('node:path');
const { Helper } = require('../src/main/helper');
const { helperFile } = require('../src/main/platform');

const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

async function main() {
  const helper = new Helper({ binPath: path.join(__dirname, '..', 'bin', helperFile) });
  helper.on('esc', () => console.log('[smoke] Esc heard'));
  helper.on('took_over', () => console.log('[smoke] a key or click of yours'));
  helper.start();
  console.log('[smoke] click into the app to read within 3 seconds');
  await sleep(3000);
  const app = helper.lastApp || await helper.call('frontmost');
  console.log(`[smoke] reading ${app.name} (pid ${app.pid})`);
  const tree = await helper.call('axTree', { pid: app.pid, maxNodes: 400 });
  console.log(`[smoke] gen ${tree.gen}, window "${tree.title}", ${tree.nodes.length} elements, focused ${tree.focused}, secure ${tree.secureFocused}`);
  for (const n of tree.nodes.slice(0, 25)) console.log(`  ${'  '.repeat(Math.min(n.depth, 6))}${n.id} ${n.role} "${n.name}"${n.secure ? ' (password)' : ''}`);
  const shot = await helper.call('screenshotScreen', { pid: app.pid, maxEdge: 1280 });
  console.log(`[smoke] screenshot ${shot.width}x${shot.height}, origin ${JSON.stringify(shot.origin)}, ${shot.pointsPerPixel.toFixed(3)} points a pixel`);
  await helper.call('watchStop', { on: true });
  console.log('[smoke] press Esc, type a key and click somewhere in the next 8 seconds');
  await sleep(8000);
  await helper.call('watchStop', { on: false });
  helper.stop();
}

main().catch((err) => { console.error(`[smoke] failed: ${err.code}: ${err.message}`); process.exitCode = 1; });
