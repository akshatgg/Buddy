'use strict';

// Writes the Homebrew cask for a Mac release: Casks/buddy.rb in the
// akshatgg/homebrew-tap repository, which is what makes
//
//   brew install --cask akshatgg/tap/buddy
//
// work. Homebrew checks the download against the sha256 in the cask, so each
// release needs its own; the release workflow writes it from the DMG it built
// and pushes it to the tap. By hand:
//
//   node tools/homebrew-cask.js --version 1.0.0 --dmg release/Buddy-arm64.dmg --out buddy.rb
//   node tools/homebrew-cask.js --version 1.0.0 --out buddy.rb     (hashes the released DMG on GitHub)
//
// Without --out it prints the cask.

const crypto = require('node:crypto');
const fs = require('node:fs');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { MAC_DMGS, BUNDLE_ID, parseVersion } = require('../src/main/updates');

const REPO = 'akshatgg/Buddy';

// A release Homebrew installs: three plain numbers, as in the release's tag
// (v<version>). Pre-releases (1.3.0-beta.1) never go to the tap.
function checkVersion(version) {
  const v = parseVersion(version);
  if (!v || v.pre.length || version !== `${v.major}.${v.minor}.${v.patch}`) {
    throw new Error(`Not a release version: ${JSON.stringify(version)}`);
  }
}

// Homebrew ADDS com.apple.quarantine to what it installs. The app is ad-hoc
// signed, not notarized (that needs a paid Apple Developer ID), so with the
// flag set macOS refuses the first open until Open Anyway is clicked in System
// Settings. The postflight clears it, which is the same permission that
// button grants. Buddy updates itself (Update now), hence auto_updates: brew
// upgrade leaves it to do so.
function renderCask({ version, sha256 }) {
  checkVersion(version);
  if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error(`Not a sha256: ${JSON.stringify(sha256)}`);
  return `# Homebrew cask for Buddy -- written by tools/homebrew-cask.js in
# github.com/${REPO} for every release; edit that, not this file.
#
#   brew install --cask akshatgg/tap/buddy
#
# Homebrew ADDS com.apple.quarantine to casks. The postflight clears it, which
# is the same permission System Settings -> Privacy & Security -> Open Anyway
# grants by hand: the app is ad-hoc signed, not notarized (that needs a paid
# Apple Developer ID).

cask "buddy" do
  version "${version}"
  sha256 "${sha256}"

  url "https://github.com/${REPO}/releases/download/v#{version}/${MAC_DMGS.arm64}"
  name "Buddy"
  desc "3D buddy that writes, fixes and checks your English in any app"
  homepage "https://buddywrites.vercel.app/"

  livecheck do
    url :url
    strategy :github_latest
  end

  auto_updates true
  depends_on arch: :arm64
  depends_on macos: :sonoma

  app "Buddy.app"

  postflight_steps do
    run "/usr/bin/xattr",
        args:         ["-dr", "com.apple.quarantine", "{{appdir}}/Buddy.app"],
        must_succeed: false
  end

  uninstall quit: "${BUNDLE_ID}"

  zap trash: [
    "~/Library/Application Support/Buddy",
    "~/Library/Caches/${BUNDLE_ID}",
    "~/Library/HTTPStorages/${BUNDLE_ID}",
    "~/Library/Preferences/${BUNDLE_ID}.plist",
    "~/Library/Saved Application State/${BUNDLE_ID}.savedState",
  ]
end
`;
}

async function sha256OfFile(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), hash);
  return hash.digest('hex');
}

async function sha256OfUrl(url) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${res.status} downloading ${url}`);
  const hash = crypto.createHash('sha256');
  await pipeline(Readable.fromWeb(res.body), hash);
  return hash.digest('hex');
}

function args(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) out[argv[i].replace(/^--/, '')] = argv[i + 1];
  return out;
}

async function writeCask({ version, dmg, out }) {
  checkVersion(version);
  const sha256 = dmg
    ? await sha256OfFile(dmg)
    : await sha256OfUrl(`https://github.com/${REPO}/releases/download/v${version}/${MAC_DMGS.arm64}`);
  const text = renderCask({ version, sha256 });
  if (out) fs.writeFileSync(out, text);
  return text;
}

if (require.main === module) {
  const { version, dmg, out } = args(process.argv.slice(2));
  writeCask({ version, dmg, out }).then((text) => {
    if (out) console.log(`wrote ${out}`);
    console.log(text);
  }, (err) => {
    console.error(err.message);
    process.exit(1);
  });
}

module.exports = { renderCask, writeCask };
