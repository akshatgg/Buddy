'use strict';

/**
 * Loads a module the way it loads on another system, for the parts of Buddy that read process.platform as they
 * load: a separate Node process, with process.platform set to `platform`, requires `file` and prints what
 * `pick(module)` returns. `pick` runs in that process, so it can use only what it is given.
 */

const { execFileSync } = require('node:child_process');

function onPlatform(platform, file, pick) {
  const script = [
    `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} });`,
    `const loaded = require(${JSON.stringify(file)});`,
    `process.stdout.write(JSON.stringify((${pick})(loaded)));`,
  ].join('\n');
  return JSON.parse(execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' }));
}

module.exports = { onPlatform };
