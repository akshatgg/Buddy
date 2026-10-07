# Buddy — single-key shortcut (tap ⌘, ⌥, ⌃, ⇧, fn or Caps Lock on its own) — Design

Date: 2026-10-07
Status: approved in chat ("Press once")
Builds on: `2026-10-07-buddy-settings-polish-design.md` (the shortcut recorder).

## 1. Goal

Let the person choose one key — or a few modifier keys together — as Buddy's shortcut, tapped on its own:
⌘, ⌥, ⌃, ⇧, fn (🌐), Caps Lock, or a chord such as ⇧ ⌘. Tapping it opens the panel from any app, and tapping it
again closes the panel, as the shortcut does today.

## 2. Behaviour

- **Recording:** in Settings → Shortcut, click the box and tap the key(s): press and let go, with no other key. It is
  saved at once, like any other shortcut. Combinations with a normal key (⇧ ⌘ B …) work as today. The hint under the
  box says: "Click the box, then press the keys you want, or tap one key like ⌘ or fn on its own. Esc cancels."
- **Opening Buddy:** a tap counts only when the key(s) go down and all come back up **within 0.5 s**, with **no other
  key and no mouse click** in between. So ⌘C, ⌘-click, ⇧ with a letter and ordinary typing never open Buddy, nor does a
  key held down longer.
- **Left and right are different keys:** "Right ⌥" is not "Left ⌥". The recorder saves the side that was tapped.
- **Caps Lock** is always tapped alone. macOS reports it once per press, so each press with no other modifier held is a
  tap; a second report within 0.4 s is the same press.
- **Display:** the box shows key caps with their side: **Left ⌘**, **Right ⌥**, **Left ⇧ Left ⌘**, **fn**,
  **⇪ Caps Lock**.
- **A note under the box** while a single-key shortcut is saved:
  - always: "Tap it on its own to open your buddy: press and let go, with no other key."
  - Caps Lock: "Caps Lock also turns capitals on and off when you tap it."
  - fn: "If fn also opens emoji or dictation, set “Press 🌐 key to” to “Do Nothing” in System Settings → Keyboard."
  - without Accessibility, in place of the first line and in red: "Buddy needs Accessibility to hear this key. Allow it
    in Permissions."
- **Permission:** Buddy hears the keys through the Accessibility permission it already asks for. Without it the
  shortcut can't work; once it is given, the shortcut starts working within 10 seconds, without restarting Buddy.
- Reserved combinations (⌘C …) stay refused. A single key is never "taken" by another app.

## 3. How it works

- **Saved value:** `Tap:` and the key names joined by `+`, in this order: `Fn`, `LeftControl`, `RightControl`,
  `LeftOption`, `RightOption`, `LeftShift`, `RightShift`, `LeftCommand`, `RightCommand`; or `CapsLock` alone
  (`Tap:RightOption`, `Tap:LeftShift+LeftCommand`, `Tap:Fn`, `Tap:CapsLock`). The format lives in
  `src/renderer/common/shortcut-keys.js` (`isTap`, `tapKeys`, `tapValue`, and `symbols` for the caps).
- **Mac helper (Swift):** a new command `watchKeys { on }` adds (or removes) a listen-only `CGEventTap` on the main run
  loop for modifier changes, key presses and mouse clicks. It reports
  `{"event": "keys", "kind": "flags", "keyCode": n, "flags": n, "t": ms}` for each modifier change (the raw flags,
  whose low bits say which side is down; `t` is milliseconds since the Mac started), and
  `{"event": "keys", "kind": "other"}` for a key or a click **only while a modifier is held**, never which key.
  Without Accessibility the command fails with `no_accessibility`. A tap that macOS switches off is switched back on.
  The Node side of the helper says `started` each time the helper (re)starts.
- **Tap detector (`src/main/modifier-tap.js`):** a pure state machine turning those reports into taps (keys pressed
  alone, all let go within 0.5 s, nothing else between; no other modifier still held at the end).
- **Key watch (`src/main/key-watch.js`):** tells the helper to listen only while a single-key shortcut is set or
  Settings is recording one; tells it again after the helper restarts; when the helper cannot listen, asks again every
  10 seconds; a tap of the shortcut opens the panel, and while Settings records, every tap goes to Settings instead.
- **Shortcut (`src/main/shortcut.js`):** `Tap:` values go to the key watch; everything else to Electron's global
  shortcuts, as today. Recording (`shortcut:pause`) also starts the key watch's recording, whose taps the main process
  sends to the Settings page (`shortcut:tap`); `shortcut:resume` stops it.

## 4. Testing

- Unit: the format (each key, order, malformed values, caps), the detector (alone, with a key, with a click, too
  slow, chords, left/right, keyboards without sides, a key held from before, fn, Caps Lock), the key watch (when it
  listens, recording, helper restart, retry), the shortcut module with `Tap:` values, `shortcut:pause`/`resume` with
  the key watch, the Settings window sending to its page, the helper's `started`.
- e2e (fake helper): record a single-key shortcut from the Settings page; tapped alone it opens the panel, with
  another key between it doesn't; Caps Lock shows its note; Reset gives ⌥ Space back and the helper stops listening.
- Manual: real ⌘, Right ⌥, ⇧⌘, fn and Caps Lock on the installed app; ⌘C and ⌘-click never open Buddy; the
  Accessibility note and recovery.
