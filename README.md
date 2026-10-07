# Buddy

A small 3D buddy that floats on top of every app on your Mac or Windows PC and
helps you write in English. It writes emails and messages for you, fixes your English and
checks what you wrote, then pastes the answer straight back into Gmail,
WhatsApp or wherever you were typing. Type to it in English, Hindi or Hinglish.

Design: `docs/superpowers/specs/2026-10-06-buddy-v1-mac-design.md`, and for Windows
`docs/superpowers/specs/2026-10-07-buddy-windows-design.md`

## Run it

Needs macOS 14 or later, Node 22 or later, and the Xcode command line tools (for `swiftc`).

    npm install
    npm start          # builds the Swift helper, then starts Buddy

The first run opens the Welcome window. In development, macOS gives
Accessibility and Screen Recording to the app you start Buddy from (your
terminal), so allow that app in System Settings → Privacy & Security.

## Install on your Mac

Only an installed app can start itself at login, and it gets its own
permissions. Build it once and put it in Applications (Apple Silicon only).
A build needs a valid `cloud.json` first, and fails without one (see
"Sign-in and free mode" below):

    npm run dist:mac

That builds the Swift helper, then the app, `release/mac-arm64/Buddy.app`, and a
disk image, `release/Buddy-arm64.dmg`. Open the `.dmg` and drag Buddy to
Applications, or copy `release/mac-arm64/Buddy.app` there yourself.

- **The first open.** The app is signed only with an ad-hoc signature, not by
  Apple, so macOS may stop it the first time. Open System Settings → Privacy &
  Security, scroll down to the line about Buddy and click **Open Anyway**.
  (Right-click → Open no longer gets past this on macOS 15 and later.) A copy
  you built on this Mac and did not download may open with no warning at all.
- **Permissions.** Allow Accessibility and Screen Recording for **Buddy**, not
  for your terminal. After you rebuild and reinstall, macOS may need them
  switched off and on again, because the ad-hoc signature changes with every
  build.
- **Always on.** In the installed app, turning the buddy on adds Buddy to your
  login items, and turning it off removes it. A development run (`npm start`)
  never adds a login item.
- **Trying a build safely.** Set `BUDDY_USER_DATA` to a folder and Buddy keeps
  its settings there, and never touches your login items:

      BUDDY_USER_DATA=$(mktemp -d) release/mac-arm64/Buddy.app/Contents/MacOS/Buddy

The app runs without Terminal and has no Dock icon; it lives in the menu bar.

## Android

Buddy also runs on Android 8.0 or later. A small 3D head floats over your apps.
Tap it for the panel: Write, Fix and Check screen, the same as on the Mac. Select
text in an app and choose **Fix with Buddy** to fix it in place, or use
Share → Buddy from any app. There is no Admin on the phone; the admin works from
the Mac. Sign-in and free mode use the same server.

Build it with Android Studio's JDK and SDK (platform android-37). Copy
`android/cloud.example.properties` to `android/cloud.properties` and fill it in:
`serverUrl` and `firebaseApiKey` are in the Mac's `cloud.json`, and
`googleWebClientId` is the Web client that Firebase made for Google sign-in.

    npm run android:build

Install the app on a phone with USB debugging on, or on an emulator:

    adb install -r android/app/build/outputs/apk/debug/app-debug.apk

Tests:

    npm run android:test

Tip: on some Macs Java needs `-Djava.net.preferIPv4Stack=true`. The npm scripts
already pass it.

`docs/manual-checklist-android.md` covers what only a real phone can check.

## Sign-in and free mode

Everyone signs in with Google. The admin (akshatg9636@gmail.com) gets
**Admin…** in the menu bar, to make Buddy free for everyone with the server's AI
key — unlimited or a number of requests a day — and to block people.

The server is in `web/` (Vercel + Firestore, project `buddy-7f8c2`); see
`web/README.md`. The app finds it, and signs in, with `cloud.json` at the
repository root. It is not in git: copy `cloud.example.json` and fill it in. A
build without a valid one fails (`build/afterPack.js`).

    npm run sync:web         # after changing shared/: the server keeps a copy in web/shared
    npm run test:firestore   # the server's database code against the Firestore emulator (needs the Firebase CLI (firebase) and Java 21 or newer)
    npm run deploy:server    # deploy the server

## On Windows

Needs Windows 10 (version 1903 or later) or Windows 11, 64-bit, and Node 22 or later.
The helper is built with the C# compiler that comes with Windows (.NET Framework 4.8),
so nothing else has to be installed.

    npm install
    npm run build:native          # builds the helper, bin\buddy-helper.exe
    node tools/helper-smoke.js    # checks the helper on its own, in 10 seconds
    npm start                     # builds the helper again, then starts Buddy

Quit Buddy (menu → Quit Buddy) before you start it again: Windows does not let the
running helper be replaced.

To install it, build the installer on Windows. As on the Mac, a build needs a valid
`cloud.json` first (see "Sign-in and free mode" above):

    npm run dist:win

That makes `release\Buddy Setup <version>.exe`. Run it: it installs Buddy for you
(no administrator needed) and opens it.

- **The first open.** The installer is not signed, so Windows may say "Windows
  protected your PC". Click **More info**, then **Run anyway**.
- **No permissions.** Windows asks for none, so the Welcome goes from signing in
  and picking a buddy straight to connecting an AI (or to the end, when free mode
  covers you).
- **The shortcut** is **Ctrl+Shift+Space** (on Windows, Alt+Space opens every
  window's own menu). A key tapped on its own (the Mac's single-key shortcut) is not
  offered on Windows.
- **The menu** is the buddy's icon in the corner of the taskbar (it may be under the
  ^ arrow). A left or a right click opens it.
- **Always on.** As on the Mac, only the installed Buddy starts itself with Windows.
- **Not on Windows:** Buddy does not read from or type into a terminal (Ctrl+C there
  would stop what is running), VS Code's included, and Windows does not let it type
  into an app that runs as administrator. There the answer is copied instead: press
  Ctrl+V. It cannot tell the terminal of a JetBrains IDE (IntelliJ, PyCharm) from the
  editor, so do not open Buddy from one.
- **Passwords.** Buddy reads no password field, and nothing a password manager copies
  (KeePass copies a password on Ctrl+C).
- **If Microsoft Defender stops the helper** (it is not signed, and it sends keys
  like a person does), allow it in Windows Security → Protection history.
- **If `npm run dist:win` says "Cannot create symbolic link"**, turn on Developer Mode
  (Settings → System → For developers) and run it again.
- **Trying a build safely.** `BUDDY_USER_DATA` works the same way (in PowerShell):

      $env:BUDDY_USER_DATA = "$env:TEMP\buddy-trial"
      .\release\win-unpacked\Buddy.exe

## Releases and Update now

Push a version tag and GitHub Actions does the rest (`.github/workflows/release.yml`): it builds and checks the Mac
DMG and the Windows installer, then publishes a GitHub Release with `Buddy-arm64.dmg`, `Buddy-Setup-x64.exe` and
their update manifests (`latest-mac.yml`, `latest.yml`).

    git tag v1.2.0 && git push origin v1.2.0    # or: npm run release:patch (or :minor, :major)

Tags have three numbers (`v1.2.0`; `v1.2` means `1.2.0`), and a new one must be higher than the latest release.
After a release, master's `package.json` is set to it. Actions → Release → Run workflow does the same from the
website, and with no version it only builds and tests. The build needs the repository secret `BUDDY_CLOUD_JSON` (the
contents of `cloud.json`).

Only Buddy as installed updates itself: a development run, a trial run with `BUDDY_USER_DATA`, a copy run from
`release/` (or anywhere outside an Applications folder on the Mac) never replaces itself. Every installed Buddy then
finds the new version (on launch and every hour, unless switched off in Settings →
General) and offers **Update now** in Settings, in the menu bar menu and in a dialog once per launch. The download is
checked against its sha512 before anything is installed. On Windows the installer runs silently as Buddy quits; on
the Mac the new Buddy.app is copied out of the DMG, checked, and swapped in once Buddy has quit. Because the Mac app
is ad-hoc signed, macOS asks for Accessibility again after each update, and Settings opens on Permissions to say so.
The website's download buttons always give the newest release. Design:
`docs/superpowers/specs/2026-10-07-buddy-releases-and-updates-design.md`.

## Website

The download site, https://buddywrites.vercel.app, is plain HTML in `web/public/` (home page, privacy page,
`style.css`, `site.js`) and is deployed with the server (`npm run deploy:server`). Its download buttons use
`https://github.com/akshatgg/Buddy/releases/latest/download/<file>`, so a new release needs no change to the site;
`site.js` adds the version and size, and offers Windows once a release has `Buddy-Setup-x64.exe`.
Design: `docs/superpowers/specs/2026-10-07-buddy-website-design.md`.

    tools/make-site-images.sh        # the buddies, icons and favicons, from assets/ and build/icon.png
    tools/make-site-images.sh --og   # also the link preview, web/public/og.png (needs Google Chrome)

## Tests

    npm test           # lint and unit tests
    npm run test:e2e   # starts the real app with fakes and runs test/e2e/checks

The e2e briefly opens Buddy's windows on screen. Both run on the Mac and on Windows.

`docs/manual-checklist.md` (Mac) and `docs/manual-checklist-windows.md` cover what
only a person can check.

## Characters

The buddies are built in Blender from `art/build_buddies.py`:

    npm run build:buddies

Every `.glb` keeps the same contract (nodes Root, Head, ArmL, ArmR; mesh Face
with morph targets blink, smile, mouthO, eyeLUp, eyeRUp), and `test/characters.test.js`
checks it.

The app icon, `build/icon.png`, is the first buddy on a soft plate. Blender renders
the robot (`art/render_icon.py`) and a small Swift tool sets it on the plate
(`build/MakeIcon.swift`):

    npm run build:icon
