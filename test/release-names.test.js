'use strict';

// The installers' names never change from one release to the next, so the website's
// releases/latest/download/<name> links and Update now always find them.

const test = require('node:test');
const assert = require('node:assert');
const config = require('../electron-builder.config.js');
const { MAC_DMGS, WINDOWS_INSTALLER } = require('../src/main/updates');

const named = (pattern, arch, ext) => pattern.replace('${arch}', arch).replace('${ext}', ext);

test('the Mac build is the DMG Update now and the website download', () => {
  assert.strictEqual(named(config.dmg.artifactName, 'arm64', 'dmg'), MAC_DMGS.arm64);
});

test('the Windows build is the installer Update now and the website download', () => {
  assert.strictEqual(named(config.nsis.artifactName, 'x64', 'exe'), WINDOWS_INSTALLER);
});
