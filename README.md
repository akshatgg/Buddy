# Buddy

A small 3D buddy that floats on top of every app on your Mac and helps you
write in English. It writes emails and messages for you, fixes your English and
checks what you wrote, then pastes the answer straight back into Gmail,
WhatsApp or wherever you were typing. Type to it in English, Hindi or Hinglish.

Design: `docs/superpowers/specs/2026-10-06-buddy-v1-mac-design.md`

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
disk image, `release/Buddy-<version>-arm64.dmg`. Open the `.dmg` and drag Buddy to
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

## Tests

    npm test           # lint and unit tests
    npm run test:e2e   # starts the real app with fakes and runs test/e2e/checks

The e2e briefly opens Buddy's windows on screen.

`docs/manual-checklist.md` covers what only a person can check.

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
