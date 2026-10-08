'use strict';

// The Homebrew cask (brew install --cask akshatgg/tap/buddy) must name the DMG
// the release publishes, with its sha256, and match what the build makes.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const config = require('../electron-builder.config.js');
const { MAC_DMGS } = require('../src/main/updates');
const { renderCask, writeCask } = require('../tools/homebrew-cask');

const SHA = 'a'.repeat(64);

test('the cask downloads the release DMG and checks its sha256', () => {
  const cask = renderCask({ version: '1.2.3', sha256: SHA });
  assert.match(cask, /^cask "buddy" do$/m);
  assert.match(cask, /^ {2}version "1\.2\.3"$/m);
  assert.match(cask, new RegExp(`^ {2}sha256 "${SHA}"$`, 'm'));
  // The release workflow tags v<version>, and the DMG keeps one name in every release.
  assert.ok(cask.includes(`url "https://github.com/akshatgg/Buddy/releases/download/v#{version}/${MAC_DMGS.arm64}"`));
});

test('the cask matches the Mac build', () => {
  const cask = renderCask({ version: '1.2.3', sha256: SHA });
  assert.match(cask, /^ {2}app "Buddy\.app"$/m);
  assert.strictEqual(config.productName, 'Buddy');
  assert.ok(cask.includes(`uninstall quit: "${config.appId}"`));
  // Apple Silicon only, macOS 14 (Sonoma) or later -- as the DMG is built.
  assert.deepStrictEqual(config.mac.target.flatMap((t) => t.arch), ['arm64']);
  assert.match(cask, /^ {2}depends_on arch: :arm64$/m);
  assert.strictEqual(config.mac.minimumSystemVersion, '14.0');
  assert.match(cask, /^ {2}depends_on macos: :sonoma$/m);
  // Buddy updates itself, so brew upgrade leaves it alone, and a brew install opens without Open Anyway.
  assert.match(cask, /^ {2}auto_updates true$/m);
  assert.ok(cask.includes('"-dr", "com.apple.quarantine", "{{appdir}}/Buddy.app"'));
});

test('only a release version and a real sha256 make a cask', () => {
  for (const version of ['1.3.0-beta.1', 'v1.2.3', '1.2', '', undefined]) {
    assert.throws(() => renderCask({ version, sha256: SHA }), /Not a release version/, String(version));
  }
  for (const sha256 of ['', 'A'.repeat(64), 'a'.repeat(63), undefined]) {
    assert.throws(() => renderCask({ version: '1.2.3', sha256 }), /Not a sha256/, String(sha256));
  }
});

test('the cask carries the sha256 of the DMG it is given', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-cask-'));
  try {
    const dmg = path.join(dir, MAC_DMGS.arm64);
    fs.writeFileSync(dmg, 'not really a disk image');
    const out = path.join(dir, 'buddy.rb');
    const text = await writeCask({ version: '2.0.0', dmg, out });
    const sha = crypto.createHash('sha256').update('not really a disk image').digest('hex');
    assert.ok(text.includes(`sha256 "${sha}"`));
    assert.strictEqual(fs.readFileSync(out, 'utf8'), text);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a bad version fails before anything is downloaded', async () => {
  await assert.rejects(writeCask({ version: undefined }), /Not a release version/);
});
