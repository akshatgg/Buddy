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
permissions. Build it once and put it in Applications (Apple Silicon only):

    npm run dist:mac

That builds the Swift helper, then the app, `release/mac-arm64/Buddy.app`, and a
disk image, `release/Buddy-<version>-arm64.dmg`. Open the `.dmg` and drag Buddy to
Applications, or copy `release/mac-arm64/Buddy.app` there yourself.

- **The first open.** The app is signed only with an ad-hoc signature, not by
  Apple, so macOS stops it the first time. Right-click Buddy → Open, or go to
  System Settings → Privacy & Security → Open Anyway.
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
