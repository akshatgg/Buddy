'use strict';
const { execFileSync, spawnSync } = require('child_process');
const path = require('path');
const asar = require('@electron/asar');

// What the buddy page imports from three.js's examples through its import map (src/renderer/buddy/index.html).
// electron-builder leaves an `examples` folder out of node_modules on its own; the file set in
// electron-builder.config.js puts these back. A package without them has no robot.
const REQUIRED_IN_ASAR = [
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
];

/** The names in `required` that the asar at `asarPath` does not hold. */
function missingFromAsar(asarPath, required = REQUIRED_IN_ASAR) {
  // The listing's entries look like "/node_modules/three/build/three.module.js".
  const held = new Set(
    asar.listPackage(asarPath, { isPack: false }).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
  );
  return required.filter((name) => !held.has(name));
}

/**
 * Ad-hoc sign the macOS bundle after packaging.
 *
 * Without this, the app reports as **damaged** on any Mac that downloads it —
 * not the usual "unidentified developer" warning, but a hard refusal with only
 * a "Move to Bin" button.
 *
 * The cause is that `mac.identity: null` tells electron-builder to skip signing
 * altogether. The Electron binary inside still carries its own ad-hoc
 * signature, so the finished bundle ends up claiming to be signed while its
 * seal describes different contents:
 *
 *     Identifier = Electron
 *     code has no resources but signature indicates they must be present
 *
 * Gatekeeper reads that as tampering. Signing the assembled bundle here — with
 * the real bundle identifier — produces a consistent seal, so the app is merely
 * unsigned-by-an-unknown-developer, which users can get past.
 *
 * arm64 Macs additionally refuse to execute any binary with no signature at
 * all, so this is not optional on Apple Silicon.
 *
 * None of this replaces notarisation. It makes the app installable; a Developer
 * ID would make it open without ceremony.
 *
 * The Swift helper (Contents/Resources/bin/buddy-helper) is not "nested code"
 * to codesign: it sits in Resources, so the seal records it as a file and it
 * keeps the ad-hoc signature the Swift linker gave it, which arm64 accepts. It
 * is checked below, because a bundle without it still verifies, and Buddy would
 * then run with no way to copy, paste or see the screen.
 *
 * Before any of that, and whoever signs, the package is checked for the files the
 * buddy page cannot show the robot without (REQUIRED_IN_ASAR): the build fails
 * when they are missing.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);

  // However the bundle is signed: an app.asar without three.js's loader would install, open and show nothing.
  const missing = missingFromAsar(path.join(appPath, 'Contents', 'Resources', 'app.asar'));
  if (missing.length > 0) {
    throw new Error(
      `app.asar is missing ${missing.join(' and ')}, so the installed Buddy would show no robot. ` +
      "The file set for three.js's examples in electron-builder.config.js is what brings them in."
    );
  }
  console.log('  • app.asar holds the three.js loader and environment');

  // With a certificate electron-builder signs the bundle itself, after this hook.
  if (context.packager.platformSpecificBuildOptions.identity !== null) return;

  const bundleId = context.packager.appInfo.id;

  console.log(`  • ad-hoc signing  ${appName} as ${bundleId}`);

  execFileSync('codesign', [
    '--force',
    '--deep',
    '--sign', '-',
    '--identifier', bundleId,
    appPath,
  ], { stdio: 'inherit' });

  // Fail the build rather than ship something that will be called damaged.
  execFileSync('codesign', ['--verify', '--strict', '--deep', appPath], { stdio: 'inherit' });

  // Fails when the helper is missing (run `npm run build:native` first) or was changed after sealing.
  const helper = path.join(appPath, 'Contents', 'Resources', 'bin', 'buddy-helper');
  execFileSync('codesign', ['--verify', '--strict', helper], { stdio: 'inherit' });

  // codesign describes a signature on stderr.
  const info = spawnSync('codesign', ['-dv', appPath], { encoding: 'utf8' }).stderr;
  console.log(`  • signature verified (${(info.match(/Identifier=(\S+)/) || [])[1]})`);
};

exports.REQUIRED_IN_ASAR = REQUIRED_IN_ASAR;
exports.missingFromAsar = missingFromAsar;
