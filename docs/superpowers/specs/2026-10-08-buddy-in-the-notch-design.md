# Buddy in the notch — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08, "do it")
Builds on: the chat panel (`2026-10-08-buddy-chat-panel-design.md`) and voice. Mac only.

## 1. Goal

On a Mac with a notch, Buddy lives in the notch instead of floating at the screen edge: its eyes peek out on either
side of the camera, the notch looks a little wider and that is all. A click on it drops the chat down under the notch.
What Buddy says ("Done! It's in Gmail ✅") slides out beside the notch for a moment, the way the iPhone's Dynamic
Island shows things. Everything else (the chat, doing it in the app, memory, voice, the shortcut) is the same.

Macs without a notch, external screens and Windows keep the floating Buddy. The person can choose the floating Buddy
on a notch Mac too (Settings → Buddy → Where Buddy lives).

## 2. Where Buddy lives

- `home: 'notch' | 'floating'` in the store, default `'notch'`.
- Buddy is **in the notch** when all of these hold: the Mac, `home === 'notch'`, and a screen that is on now has a
  notch (the helper's `notch` command, §6). Otherwise Buddy **floats**, as today. This is looked at again when a screen
  is added or removed (the lid closed with an external screen: Buddy floats there; opened: back to the notch) and when
  the setting changes. The one that is not in use is hidden; "Show buddy" / "Hide buddy", "Turn off buddy", the pause
  on lock, the wave on start, the moods: all go to the one in use.
- **Settings → Buddy → "Where Buddy lives"**: a segmented choice, `In the notch` / `Floating`, shown only on a Mac
  that has a notch screen now. Status line under it as for Size.

## 3. The notch window

- A frameless, see-through, always-on-top window (a `panel`, above the menu bar: level `screen-saver`, visible on
  every space and over full-screen apps), never focused, no shadow, no taskbar. One per notch screen is not needed: a
  Mac has one built-in screen; the first notch screen is used.
- Closed, it is the notch's width plus a **wing** of 44 pt on each side, the notch's height, flush with the top of the
  screen and centred on the notch. The page draws one black shape over all of it: the notch's own rectangle plus the
  wings, with rounded bottom corners (radius 12), so the notch looks wider. (The notch itself shows nothing; the
  shape only has to match its black.)
- **Eyes:** the left eye in the left wing, the right eye in the right wing: two rounded white shapes, 10 × 14 pt,
  centred in the wing's height. They blink (every 3–6 s, 120 ms), look toward the pointer (up to 2 pt either way,
  from the pointer's place relative to the window's centre, sent by main as `buddy:cursor` is for the floating
  buddy), and change with the mood (§4).
- **Hover:** the wings grow to 56 pt over 180 ms and the eyes open a little wider; the pointer is a hand. Clicks on
  the window pass through except over the black shape (the page reports hover as the floating buddy does).
- **Click:** opens the chat panel (toggles it, as a click on the floating buddy does). The panel sits **under the
  notch**: centred on the notch, its top at the bottom of the menu bar (the work area's top), kept inside the work
  area; its size is the same as today.
- **Says something** (`bubble`): instead of the bubble window, the right wing grows to fit the text (up to 260 pt,
  one line, ellipsis) over 220 ms, shows it in white 13 px next to the right eye, holds it 2.6 s, then shrinks back.
  A new text replaces the old one and restarts the time.
- **Listening** (voice): the eyes open a little wider while the mood is `listening` (the buddy's feelings send it).
  Bars that follow the voice, as the panel's, come later, with the feelings.
- **Paused** (the screen locked, hidden): the page stops its timers, as the floating buddy's does.
- The page keeps nothing and loads nothing remote; CSP as the bubble page's.

## 4. Moods in the notch

The notch page has its own 2-D eyes, so every mood main sends is drawn by it; unknown moods look like `idle`.

| Mood | Eyes |
|---|---|
| `idle` | open, blinking, following the pointer |
| `thinking` | looking up and to the left, slow blink; a small dot pulses under the right eye |
| `happy` | closed as ^ ^ (arched) for 1.2 s, then idle |
| `celebrate` | ^ ^ and the wings bounce twice, then idle |
| `sad` | drooping (the outer tops lower, tilted) for 2.5 s, then idle |
| `sleepy` / `asleep` | half closed, slow blinks; `asleep`: closed as ‿ ‿ until another mood |
| `wave` | the right eye winks once |
| `listening` | slightly wider |

The buddy's new feelings (sleep, love, dizzy, bored) can be given notch looks later; they fall back to `idle` now.

## 5. Settings and the rest

- Settings → Buddy gains "Where Buddy lives" (§2). `settings:set` takes `home`, `'notch'` or `'floating'`, else
  `bad_request` "Unknown home.". The snapshot gains `home` and `hasNotch` (whether a notch screen is on now), so the
  page knows whether to show the choice.
- The tray menu is unchanged.
- Size (Settings → Buddy) does not apply in the notch.
- The floating buddy's positions are kept, so switching back puts it where it was.

## 6. The helper

`notch` (Mac): `{ notches: [{ screen: { x, y, width, height }, notch: { x, y, width, height } }] }`, one entry per
screen that has a notch (`NSScreen.safeAreaInsets.top > 0`, macOS 12+), in Electron's points: the origin at the
primary screen's top-left, y down. `screen` is the screen's frame; `notch` spans from `auxiliaryTopLeftArea.maxX` to
`auxiliaryTopRightArea.minX`, `safeAreaInsets.top` tall, at the top of the screen. An empty list on a Mac without one.
Main matches each entry's `screen` to an Electron display by its bounds. A helper that is not running or fails: no
notch, Buddy floats.

## 7. Testing

- Unit: the notch geometry (the window's bounds closed / hovered / saying for a given notch and screen; the panel
  under the notch, kept inside the work area; which display an entry is; the choice notch/floating from
  platform/home/notches); the eyes module (mood → shape over time, blink timing, pointer look, saying's width); the
  home switch (show/hide/mood go to the one in use; a display change re-chooses; the floating buddy's window is not
  made while in the notch); the Settings IPC (`home`, `hasNotch`); the helper's `notch` call.
- e2e (the fake helper answers `notch`): the notch window exists at the expected bounds and the buddy window is not
  shown; a click (the page's click) opens the panel under the notch; `bubble` shows the text in the page; the mood
  reaches the page; switching to floating shows the floating buddy and hides the notch window, and back.
- Manual (a MacBook with a notch): the look against the real notch in light and dark menu bars, over a full-screen
  app, with an external screen attached and the lid closed/opened, the panel under the notch, Hinglish mail end to
  end, the Settings switch both ways.

## 8. Out of scope

Windows, iPhone (Apple allows only a Live Activity in the Dynamic Island: for the iPhone app's design), dragging
Buddy out of the notch, a second notch screen, the 3-D head in the notch.
