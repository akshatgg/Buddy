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
permissions. Build it once and put it in Applications (Apple Silicon only):

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

## On Windows

Needs Windows 10 (version 1903 or later) or Windows 11, 64-bit, and Node 22 or later.
The helper is built with the C# compiler that comes with Windows (.NET Framework 4.8),
so nothing else has to be installed.

    npm install
    npm start          # builds the helper, bin\buddy-helper.exe, then starts Buddy

To install it, build the installer on Windows:

    npm run dist:win

That makes `release\Buddy Setup <version>.exe`. Run it: it installs Buddy for you
(no administrator needed) and opens it.

- **The first open.** The installer is not signed, so Windows may say "Windows
  protected your PC". Click **More info**, then **Run anyway**.
- **No permissions.** Windows asks for none, so the Welcome goes from picking a
  buddy straight to connecting an AI.
- **The shortcut** is **Ctrl+Shift+Space** (on Windows, Alt+Space opens every
  window's own menu).
- **The menu** is the buddy's icon in the corner of the taskbar (it may be under the
  ^ arrow). A left or a right click opens it.
- **Always on.** As on the Mac, only the installed Buddy starts itself with Windows.
- **Not on Windows:** Buddy does not read from or type into a terminal (Ctrl+C there
  would stop what is running), and Windows does not let it type into an app that runs
  as administrator. There the answer is copied instead: press Ctrl+V.
- **Trying a build safely.** `BUDDY_USER_DATA` works the same way (in PowerShell):

      $env:BUDDY_USER_DATA = "$env:TEMP\buddy-trial"
      .\release\win-unpacked\Buddy.exe

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
