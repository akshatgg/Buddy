# Buddy releases and Update now — Design

Date: 2026-10-07
Status: agreed in chat ("push a tag, everything updates; Update now in the app"; Mac and Windows now,
Android and iOS later)

## 1. Goal

The owner pushes a version tag. GitHub Actions builds the Mac and Windows apps, checks them, and publishes a
GitHub Release. Every installed Buddy finds the new version, and one click on **Update now** installs it and
opens Buddy again. The website's download buttons always give the newest release (they use
`releases/latest/download/<file>`), so nothing else changes per release.

Android and iOS are out of scope: they will update through their app stores when they exist.

This builds on the `windows` branch merged into master (the Windows app and its C# helper) and follows Loupe
(`~/projects/loupe`), which already ships this way: a custom updater on GitHub Releases that works with an
ad-hoc signed Mac app (no Apple Developer ID needed), and electron-builder's NSIS installer on Windows.

## 2. Cutting a release

    git tag v1.2.0 && git push origin v1.2.0        # or: npm run release:patch / :minor / :major

- Tags are `vX.Y.Z` (or `X.Y.Z`). A two-part tag like `v1.2` means `1.2.0`, and leading zeros are dropped
  (`1.00` means `1.0.0`). Anything else fails the run with a plain message ("Use three numbers, like v1.2.0").
  The release is always published as `v<version>` (a pushed `1.00` becomes the release `v1.0.0`), because
  installed copies read the version from the release's tag. A version with a dash (`1.3.0-beta.1`) is a
  pre-release, which installed copies and the website skip.
- The tag is the version. The workflow sets `package.json`'s version to it inside the build (so the app,
  the installers and the manifests all say the same), without needing a commit first.
- **Actions → Release → Run workflow** does the same from the GitHub website: type a version to publish, or
  leave it blank to build and test without publishing. A version that already has a release is refused.
- `npm run release:patch` (and `:minor`, `:major`) bump `package.json`, commit, tag and push in one go.

## 3. The workflow (`.github/workflows/release.yml`)

| Job | Runner | Does |
|---|---|---|
| prepare | ubuntu | decides the version and whether to publish |
| macos | macos-15 (Apple Silicon) | `cloud.json` from the secret; `npm ci`; `npm test`; Swift helper; `electron-builder --mac` → `Buddy-arm64.dmg`; checks the DMG (mounts it, `codesign --verify`); writes `latest-mac.yml`; smoke-tests Update now |
| windows | windows-2022 | `cloud.json` from the secret; `npm ci`; C# helper; `electron-builder --win` → `Buddy-Setup-x64.exe`; writes `latest.yml`; installs it silently, checks the app and helper landed, uninstalls; smoke-tests Update now |
| release | ubuntu | publishes `vX.Y.Z` with `Buddy-arm64.dmg`, `Buddy-Setup-x64.exe`, `latest-mac.yml`, `latest.yml` and install notes |

A failed check in any job stops the release: nothing is published half-built.

`.github/workflows/ci.yml`: on every push to master and every pull request, `npm test` and the Swift helper
build on macOS, and the C# helper build on Windows.

Secrets (Settings → Secrets and variables → Actions):

- `BUDDY_CLOUD_JSON` — required: the contents of `cloud.json` (a build without it fails, as it does locally).
- Optional, later: `CSC_LINK`, `CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID`
  (Developer ID signing and notarization, already wired in `electron-builder.config.js`); `WIN_CSC_LINK`,
  `WIN_CSC_KEY_PASSWORD` (Windows signing). Without them the Mac app is ad-hoc signed ("Open Anyway" once) and
  the Windows installer is unsigned (SmartScreen: "More info" → "Run anyway" once).

## 4. Installer names

`electron-builder.config.js`: `dmg.artifactName: 'Buddy-${arch}.${ext}'` and
`nsis.artifactName: 'Buddy-Setup-${arch}.${ext}'`, so every release has the same file names and
`releases/latest/download/…` always works. `latest-mac.yml` / `latest.yml` (written by
`tools/latest-yml.js`) carry each file's version, sha512 and size.

## 5. Update now in the app (`src/main/updates.js`, from Loupe)

Free of Electron, so it is unit tested with a fake `fetch`:

- **Check**: `GET https://api.github.com/repos/akshatgg/Buddy/releases/latest`, compare versions (semver).
  On launch, then every hour while Buddy runs, when "Check for updates automatically" is on (default on).
- **Download**: the installer for this computer and its manifest; the file is kept only if its sha512 matches.
  Progress is shown. A download that stalls for a minute stops with a plain error.
- **Install**
  - Windows: the verified NSIS installer runs silently as Buddy quits (`/S --updated --force-run`) and opens
    Buddy again.
  - Mac: `Buddy.app` is copied out of the verified DMG and checked (`codesign --verify`, its version), then a
    small script swaps it in once Buddy has quit and opens it again. If the swap fails, the old app is put
    back. Where Buddy can't replace itself (run from the DMG, or not writable) it says a new version exists
    and opens the download instead.
- **Install on quit**: an update that is downloaded but not installed goes in the next time Buddy quits.

Where it shows:

- **Settings → General**, under the version: "Buddy 1.1.0", status (Up to date / Downloading 40% /
  Ready / the error in plain words), **Check now**, **Update now**, the "Check for updates automatically" switch,
  and a link to what's new (the release page).
- **Menu bar / tray menu**: "Update now (Buddy 1.2.0)" while a newer version exists.
- **A dialog, once per launch**, when the automatic check finds a newer version: "Buddy 1.2.0 is available.
  You have 1.1.0." with **Update now** and **Later**.

Errors are plain: "Could not reach GitHub. Check your internet connection and try again.", "GitHub is getting
too many requests right now. Try again in an hour.", "The downloaded update did not match its checksum, so it
was discarded."

## 6. Permissions after a Mac update

An ad-hoc signed app is a new app to macOS after every update, so its Accessibility and Screen Recording
switches stop applying. The swap script clears the stale entries (`tccutil reset All com.akshatgg.buddy`), as
Loupe does. On the first launch of a new version, if Accessibility is not allowed, Buddy opens Settings on the
permissions part with the line "Buddy was updated. macOS asks for Accessibility again after an update." A
Developer ID signed app (later) keeps its permissions and skips this.

## 7. Testing

- `test/updates.test.js`: versions, the manifest format both ways, download verification (good file, tampered
  file, stall), install kinds, the updater's states with a fake fetch, the Mac swap script's arguments.
- `test/latest-yml.test.js`: the manifest writer reads back through the app's parser.
- The workflow's own checks on real runners: DMG signature, silent Windows install, and `tools/smoke-update.js`
  (download → verify → install → relaunch, against a local server standing in for GitHub).
- `npm test` stays green on the Mac. The first real release is the end-to-end check; the owner tests Update now
  on Windows with the second one.
