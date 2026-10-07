'use strict';
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const asar = require('@electron/asar');
const { parseCloudConfig } = require('../src/main/cloud-config');

// What the installed app cannot do without, checked in app.asar: what the buddy page imports from three.js's examples
// through its import map (src/renderer/buddy/index.html) -- electron-builder leaves an `examples` folder out of
// node_modules on its own, and the file set in electron-builder.config.js puts these back -- and cloud.json, without
// which nobody can sign in (it is not in git: copy cloud.example.json and fill it in).
const REQUIRED_IN_ASAR = [
  'node_modules/three/examples/jsm/loaders/GLTFLoader.js',
  'node_modules/three/examples/jsm/environments/RoomEnvironment.js',
  'cloud.json',
];

// What the build says about a packed cloud.json that the app would refuse (see cloudConfigProblem).
const CLOUD_CONFIG_NOT_VALID =
  'cloud.json in the app is not valid: it needs serverUrl (https), firebaseApiKey, googleClientId and ' +
  'googleClientSecret (see cloud.example.json).';

/** The names in `required` that the asar at `asarPath` does not hold. */
function missingFromAsar(asarPath, required = REQUIRED_IN_ASAR) {
  // The listing's entries look like "/node_modules/three/build/three.module.js".
  const held = new Set(
    asar.listPackage(asarPath, { isPack: false }).map((entry) => entry.replace(/\\/g, '/').replace(/^\//, ''))
  );
  return required.filter((name) => !held.has(name));
}

/**
 * What is wrong with the cloud.json packed in the asar at `asarPath`: null when the app would accept it (the rules it
 * applies when it starts, parseCloudConfig), the build's message when it would not. An asar with no cloud.json at all
 * also gives null: naming that is missingFromAsar's job (REQUIRED_IN_ASAR), and the build checks it first.
 */
function cloudConfigProblem(asarPath) {
  if (missingFromAsar(asarPath, ['cloud.json']).length > 0) return null;
  const text = asar.extractFile(asarPath, 'cloud.json').toString('utf8');
  return parseCloudConfig(text) ? null : CLOUD_CONFIG_NOT_VALID;
}

/**
 * Fails the build when the app.asar at `asarPath` lacks what the installed app cannot do without, or holds a
 * cloud.json the app would refuse. Both the Mac and the Windows package are checked this way, however they are signed.
 */
function requirePackedFiles(asarPath) {
  // An app.asar without three.js's loader would install, open and show nothing, and one without cloud.json would open
  // and never let anyone sign in.
  const missing = missingFromAsar(asarPath);
  if (missing.length > 0) {
    throw new Error(
      `app.asar is missing ${missing.join(' and ')}. Without three.js's loader and environment the installed Buddy ` +
      "shows no robot (the file set for three.js's examples in electron-builder.config.js brings them in); without " +
      'cloud.json nobody can sign in (copy cloud.example.json to cloud.json and fill it in).'
    );
  }
  console.log('  • app.asar holds the three.js loader and environment, and cloud.json');

  // Being there is not enough: a cloud.json that is damaged or incomplete, or whose server is not https, installs and
  // opens, and then every sign-in says this copy is not set up. The app's own rules, applied to the packed file.
  const problem = cloudConfigProblem(asarPath);
  if (problem) throw new Error(problem);
  console.log('  • cloud.json is in app.asar and valid');
}

/**
 * The Windows package (release/win-unpacked): the same check of app.asar, and the C# helper in resources\bin.
 * Without the helper Buddy would install and run, with no way to copy, paste or see the screen. Nothing is signed:
 * Buddy has no Windows code-signing certificate yet, so SmartScreen asks once ("More info", then "Run anyway").
 */
function checkWindowsPackage(appOutDir) {
  const resources = path.join(appOutDir, 'resources');
  requirePackedFiles(path.join(resources, 'app.asar'));
  const helper = path.join(resources, 'bin', 'buddy-helper.exe');
  if (!fs.existsSync(helper)) {
    throw new Error(`${helper} is missing. Build it on Windows with \`npm run build:native\` (\`npm run dist:win\` does that first).`);
  }
  console.log('  • resources\\bin holds buddy-helper.exe');
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
 * Before any of that, and whoever signs, the package is checked for what the
 * installed app cannot do without (REQUIRED_IN_ASAR: the files the buddy page
 * cannot show the robot without, and cloud.json, which sign-in needs) and for a
 * cloud.json that is valid (cloudConfigProblem): the build fails when one is
 * missing or not valid. The Windows package gets the same check, and one for its C# helper
 * (checkWindowsPackage); nothing on Windows is signed.
 */
exports.default = async function afterPack(context) {
  if (context.electronPlatformName === 'win32') {
    checkWindowsPackage(context.appOutDir);
    return;
  }
  if (context.electronPlatformName !== 'darwin') return;

  const appName = `${context.packager.appInfo.productFilename}.app`;
  const appPath = path.join(context.appOutDir, appName);
  requirePackedFiles(path.join(appPath, 'Contents', 'Resources', 'app.asar'));

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
exports.cloudConfigProblem = cloudConfigProblem;
exports.checkWindowsPackage = checkWindowsPackage;
