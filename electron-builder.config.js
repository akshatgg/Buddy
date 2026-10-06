'use strict';

/**
 * Build configuration.
 *
 * A JS config rather than a block in package.json because signing has to adapt
 * to what credentials are present. With certificates in the environment the
 * build signs and notarises; without them it falls back to an ad-hoc signature
 * that still installs. Adding certificates later needs no code change.
 *
 * ── The three tiers a user can experience ───────────────────────────────────
 *
 *   1. BROKEN      "Buddy is damaged and can't be opened."
 *                  A hard refusal with only "Move to Bin". This is what an
 *                  inconsistent signature produces, and it is not bypassable.
 *                  Prevented by build/afterPack.js, which signs the assembled
 *                  bundle so its seal matches its contents.
 *
 *   2. UNSIGNED    "cannot be opened because it is from an unidentified
 *                  developer." Bypassable: right-click → Open, or
 *                  System Settings → Privacy & Security → Open Anyway.
 *                  This is where the project sits with no certificates.
 *
 *   3. SIGNED      No warning at all. Requires the Apple Developer Program
 *                  (99 USD/year). There is no free path to this; it is vendor
 *                  policy, not configuration.
 *
 * ── Turning on tier 3 ───────────────────────────────────────────────────────
 *
 *   CSC_LINK                     base64 .p12, or a file path
 *   CSC_KEY_PASSWORD             its password
 *   APPLE_ID                     Apple ID for notarisation
 *   APPLE_APP_SPECIFIC_PASSWORD  app-specific password
 *   APPLE_TEAM_ID                team identifier
 *
 * In CI these are repository secrets; nothing here needs editing.
 *
 * ── What Buddy needs from the installed app ─────────────────────────────────
 *
 * Only an installed bundle can keep itself on across restarts: the login item
 * (app.setLoginItemSettings) registers the running bundle, and in development
 * that is node_modules/electron/dist/Electron.app. The bundle also gets its own
 * Accessibility and Screen Recording permissions, under the name "Buddy".
 */

const hasMacCert = Boolean(process.env.CSC_LINK);
const canNotarize = Boolean(
  process.env.APPLE_ID && process.env.APPLE_APP_SPECIFIC_PASSWORD && process.env.APPLE_TEAM_ID
);

module.exports = {
  appId: 'com.akshatgg.buddy',
  productName: 'Buddy',
  copyright: 'Copyright (c) 2026 akshatgg',
  directories: { output: 'release', buildResources: 'build' },
  // Buddy has no native Node modules, so there is nothing to rebuild.
  npmRebuild: false,
  // What runs: the app's code (shared/ is required by the main process) and its assets.
  // The production dependencies (three.js) come along automatically. Not art/, docs/,
  // test/ or tools/.
  files: [
    'src/**/*',
    'shared/**/*',
    'assets/**/*',
    'package.json',
    // electron-builder never copies an `examples` folder out of a package in node_modules, and
    // no pattern in this list can bring it back. The buddy page imports from three.js's examples
    // through its import map (src/renderer/buddy/index.html): the glTF loader and the studio
    // environment, with the helpers the loader imports. Without them the page shows no robot.
    // A file set copies from the folder itself, which skips that rule.
    {
      from: 'node_modules/three/examples/jsm',
      to: 'node_modules/three/examples/jsm',
      filter: ['loaders/GLTFLoader.js', 'environments/RoomEnvironment.js', 'utils/*.js'],
    },
  ],
  afterPack: 'build/afterPack.js',

  mac: {
    category: 'public.app-category.productivity',
    // arm64 only: the Swift helper is built for arm64 (see build:native in package.json).
    target: [{ target: 'dmg', arch: ['arm64'] }],
    icon: 'build/icon.png',

    // null means "do not sign" — afterPack then applies a consistent ad-hoc
    // signature. With a certificate present, let electron-builder sign properly
    // and afterPack steps aside.
    identity: hasMacCert ? undefined : null,

    // Notarisation without a Developer ID certificate fails the build, so it is
    // only requested when both are available.
    notarize: hasMacCert && canNotarize ? { teamId: process.env.APPLE_TEAM_ID } : false,

    hardenedRuntime: hasMacCert,
    gatekeeperAssess: false,
    entitlements: 'build/entitlements.mac.plist',
    entitlementsInherit: 'build/entitlements.mac.plist',

    extendInfo: {
      // Accessory app: no Dock icon, no app-switcher entry. Buddy lives in the
      // menu bar and as the floating character.
      LSUIElement: true,
    },
    // The Swift helper (src/native/BuddyHelper.swift, built by `npm run build:native`).
    // main.js's helperPath() looks for it at process.resourcesPath/bin/buddy-helper.
    extraResources: [{ from: 'bin', to: 'bin', filter: ['buddy-helper'] }],
  },

  dmg: {
    title: 'Buddy ${version}',
    contents: [
      { x: 140, y: 200, type: 'file' },
      { x: 400, y: 200, type: 'link', path: '/Applications' },
    ],
  },
};
