# Buddy on Windows — Design

Date: 2026-10-07
Status: agreed in chat ("A. A small C# program", "implement the whole code; I'll test it myself")
Builds on: `2026-10-06-buddy-v1-mac-design.md`. Everything there holds on Windows unless this document
says otherwise.

## 1. Goal

The same Buddy on Windows 10 and 11 (64-bit): the floating buddy, the panel (Write / Fix / Check
screen), paste-back into the app the person was typing in, own keys for the four AIs, Settings,
Welcome, always on. This is Phase 1's feature set. Phase 2 (free mode, Google sign-in, admin) is
added to both apps afterwards; its server and most of its app code are shared.

One codebase: the Electron app is the same files on both systems. What differs lives in
`src/main/platform.js` and in the native helper.

### Out of scope

A code-signing certificate (the installer is unsigned for now), an ARM64 build (x64 runs on
Windows on ARM through emulation), showing the buddy on every virtual desktop, auto-update, Phase 2.

## 2. What the person sees on Windows

| | Mac | Windows |
|---|---|---|
| Welcome | Pick a buddy → Accessibility → Screen Recording → Connect an AI | Pick a buddy → Connect an AI (Windows asks for no permissions) |
| Settings | Permissions card | No Permissions card |
| Always on | "…comes back every time your Mac starts" | "…comes back every time your PC starts" |
| Default shortcut | ⌥Space | **Ctrl+Shift+Space** (Alt+Space opens every window's own menu on Windows, and PowerToys Run and Copilot use it) |
| Paste fallback bubble | "Copied — press ⌘V" | "Copied — press Ctrl+V" |
| Panel: press the main button | ⌘↩ | Ctrl+Enter (⌘↩ still works on the Mac) |
| Menu | Menu bar icon | Icon in the taskbar corner (it may sit under the ^ arrow); left or right click opens the same menu |
| App menu | Buddy's own (Edit keys, ⌘W, no ⌘Q) | None: text boxes have Ctrl+C/V/X/Z/A without one, and there is no menu bar in Settings |
| Install | `.dmg` | `Buddy Setup <version>.exe`: installs for the current user without questions, then starts Buddy |
| First open | Gatekeeper → Open Anyway | SmartScreen → More info → Run anyway |

The floating windows (buddy, bubble, panel) are tool windows on Windows, so they stay out of the
taskbar and Alt+Tab, as the Mac's panels stay out of the Dock and ⌘Tab.

## 3. The Windows helper (`src/native/windows/*.cs`)

Same job and same protocol as `BuddyHelper.swift`: one JSON object per line on stdin and stdout,
the same commands, replies and error codes, so `src/main/helper.js` and `src/main/actions.js` do
not change. It is built to `bin/buddy-helper.exe`.

Written in C# 5 for .NET Framework 4.8, which every Windows 10 (1903+) and 11 has, so the C#
compiler that comes with Windows builds it and nothing has to be installed. ASCII only, because that
compiler reads a file in the PC's own code page.

| File | What |
|---|---|
| `Program.cs` | the protocol: requests on a worker thread, the message loop on the main thread |
| `Commands.cs` | `captureSelection`, `paste`, `screenshot` |
| `Front.cs` | which app is in front, bringing it back, terminals, apps run as administrator |
| `KeyInput.cs` | Ctrl+A/C/V and the arrow key, held modifiers |
| `ClipboardStore.cs` | saving and restoring the clipboard, Buddy's own short-lived write |
| `SecureField.cs` | the password-field check |
| `WindowCapture.cs` | the screenshot |
| `Native.cs` | the Windows functions it calls |

| Command / event | Windows |
|---|---|
| event `frontApp` | `SetWinEventHook(EVENT_SYSTEM_FOREGROUND)`. Not reported: Buddy's own windows, and the shell (taskbar, Start, Alt+Tab, the desktop). `name` is the program's own description ("Google Chrome"); for Store apps, the window title. `bundleId` is the program's file name. The helper remembers each program's last window in front, for activation and screenshots. |
| `permissions` | `{ accessibility: true, screenRecording: true }`; the two `request…` commands answer `{ granted: true }` |
| activation (all commands) | Already in front within 250 ms → done. Else restore if minimised, send an empty input event (Windows lets the program that sent the last input bring a window forward), `SetForegroundWindow`; else attach to the foreground thread's input and try again. Each try waits 400 ms. |
| `captureSelection` | As on the Mac with Ctrl instead of ⌘: password check, save the clipboard, optional Ctrl+A, Ctrl+C, wait up to 300 ms for the clipboard to change, read the text, Right arrow after a whole-box read, put the clipboard back only if it changed. |
| `paste` | As on the Mac: password check, save the clipboard, write the text, optional Ctrl+A, Ctrl+V, wait 500 ms, always put the clipboard back. |
| `screenshot` | `PrintWindow(PW_RENDERFULLCONTENT)` of the program's window (only that window, as on the Mac), cropped to its visible frame, long edge at most 1568 px, JPEG quality 80. A minimised window → `no_window`. |
| `activate { pid }` (Windows only) | Hands the keyboard back to the person's app when the panel closes (Esc, ✕, the shortcut, a click on the buddy). Electron hides a window on Windows without activating another, so the hidden panel would keep the keyboard. |
| `focusWindow { hwnd }` (Windows only) | Brings the panel forward right after it opens, when Windows did not let Buddy take the front: otherwise the person's keys would still go to their app, where their text is selected (and Ctrl+Enter sends a Gmail draft). Only Buddy's own windows. |

Details that are new on Windows:

- **Keys the person still holds.** The shortcut fires while its keys are down, and Ctrl+C with
  Shift held is Ctrl+Shift+C (the inspector in Chrome). Before Ctrl+A/C/V the helper waits up to
  3 s for every key to be let go (input-method keys aside, which can read as down while their mode
  is on). It never lets go of one on the person's behalf: the keyboard would keep repeating the
  shortcut's Space with nothing held with it, typing spaces over their text. Keys still held after
  3 s → `keys_held`, and nothing is sent; the panel says to let go of the keys.
- **Clipboard.** Saved and restored in every memory format with the Win32 clipboard API (pictures
  through their DIB form, Office drawings through `CopyEnhMetaFile`; OLE's own `DataObject` and
  `Ole Private Data` are left out, as they point at the app that copied). Buddy's own temporary text
  has Windows line breaks and carries `ExcludeClipboardContentFromMonitorProcessing`,
  `CanIncludeInClipboardHistory = 0` and `CanUploadToCloudClipboard = 0`, so it never shows up in
  Win+V, the cloud clipboard or clipboard managers (the Mac's transient type). Restores carry the two
  "Can…" formats too, so Win+V does not get the person's old clipboard again after each use. The
  helper's writes are owned by a message-only window on its message-loop thread. The person's own
  selection, copied by their app, does enter Win+V: that cannot be helped.
- **What a password manager copies** (marked `ExcludeClipboardContentFromMonitorProcessing` or
  `Clipboard Viewer Ignore`) is never read: KeePass copies the selected entry's password on Ctrl+C,
  though no password field has the focus. → `secure_field`, and the clipboard is put back. The marks
  are looked for once the helper has the clipboard open, so once the app that copied is done (the
  clipboard's count goes up while it is still adding formats). The "Can…" formats alone are not
  taken as secret: Chrome's incognito windows put them on every copy.
- **Password fields.** UI Automation's `IsPassword` on the focused element, given up after 1 s;
  when it cannot tell, the read goes on (as on the Mac).
- **Terminals**, known by their window (Windows Terminal, the console, Git Bash, ConEmu, PuTTY), by
  their program (Alacritty, WezTerm, Tabby, Hyper, KiTTY, MobaXterm, PowerShell ISE …) or by the
  focused field (xterm.js inside VS Code). Ctrl+C there stops the running program when nothing is
  selected, so it is never sent: the panel opens empty, and "Use the whole box" says it can't read a
  terminal. Paste is refused (a terminal runs every line), so the answer is copied instead. JetBrains
  IDEs' terminal cannot be told apart (README).
- **Apps run as administrator.** Windows drops keys sent to them without saying so, which would
  lose the answer or make a box look empty. Reading and pasting are refused with `elevated`: the
  panel says why, and an answer is copied instead.
- **Focus back to Buddy.** Windows lets only the program that sent the last input event bring a
  window forward, and takes that back at the person's next key. After reading, once the keys are up,
  the helper sends an input event that does nothing and calls `AllowSetForegroundWindow` for Buddy;
  `focusWindow` then makes sure.
- **Nothing waits on another app's window**: `ShowWindowAsync`, `SetWindowPos(SWP_ASYNCWINDOWPOS)`,
  and no `AttachThreadInput` with a hung thread. If a call still takes too long, `helper.js` stops
  the helper and starts a fresh one (on the Mac too), so one hung app cannot leave every later call
  waiting. Reading and pasting get 10 s, other calls 5 s.
- Per-monitor DPI aware, so window sizes and screenshots are in real pixels. Lines go out through a
  writer thread, so the message loop never waits for Buddy to read a large reply.
- `tools/helper-smoke.js` checks the helper on its own (ping, frontmost, permissions, the apps in
  front) before any UI test.

## 4. The app

| Part | Change |
|---|---|
| `src/main/platform.js` | new: floating window type, default shortcut, paste keys, helper file name, whether the helper moves the focus, line breaks |
| `src/main/store.js` | default shortcut from `platform.js` |
| `src/main/actions.js` | "Copied — press Ctrl+V" on Windows; `dismiss()` closes the panel and, on Windows, calls `activate`; on Windows `focusWindow` after the panel shows; Windows line breaks on the clipboard |
| `src/main/ipc/panel.js` | Esc and ✕ close the panel through `actions.dismiss()` |
| `src/main/{buddy,bubble,panel}-window.js` | window type from `platform.js` |
| `src/main/main.js` | helper file name; `app.setAppUserModelId('com.akshatgg.buddy')` on Windows (the login item's name) |
| `src/main/app-menu.js` | no application menu on Windows |
| `src/main/tray.js` | Windows icon (`assets/trayWindows.ico`); a left click opens the menu too |
| `src/main/settings-windows.js` | `app.focus({ steal })` on the Mac only (on Windows it focuses the process's first window, which can be the buddy) |
| `src/main/ipc/settings.js` | `platform` in the snapshot |
| `src/main/secrets.js` | Windows wording when the key store is not available |
| `src/main/helper.js` | "Buddy's helper" in its messages; `windowsHide`; a call that times out stops the helper, which then starts afresh; 10 s for reading and pasting |
| Welcome, Settings, panel, `base.css` | as in §2; Segoe UI in the font list |
| `tools/build-native.js` | `npm run build:native` builds the helper for the system it runs on (swiftc or csc) |
| `package.json` | `build:native` runs that script; `dist:win`; the test globs in double quotes, which cmd.exe also reads as quotes |
| `.gitattributes` | LF line endings in every checkout, Windows included |
| `tools/make-tray-icon.js` | also writes the Windows tray icon |
| `tools/helper-smoke.js` | new: checks the helper on its own |
| `electron-builder.config.js`, `build/afterPack.js` | `win` (NSIS, x64, the helper as an extra resource); afterPack checks the Windows package for the three.js files and the helper |
| `test/e2e` | runs on both: the shortcut and app menu checks follow the platform |

## 5. Testing

- Unit tests (`npm test`) for every JavaScript change, for both platforms where it differs; they run
  on the Mac and on Windows.
- The C# helper is compiled on the Mac with the .NET SDK against the .NET Framework 4.8 reference
  assemblies in C# 5 mode, to catch mistakes. It is not run there.
- On Windows, by the owner: `npm test`, `npm run test:e2e`, and `docs/manual-checklist-windows.md`
  with `npm start` and with the installed app.
- Not yet known, to be seen in that test: whether PrintWindow draws every app (some GPU-drawn
  windows, and old apps Windows stretches at 125–150 %, may come out partly black).
