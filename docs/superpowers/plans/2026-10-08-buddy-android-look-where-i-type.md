# Buddy for Android: look where I type — Plan

Date: 2026-10-08
Spec: `docs/superpowers/specs/2026-10-08-buddy-android-look-where-i-type-design.md`
Branch: `android-look`

Each task: a failing JVM test first (`npm run android:test`), then the code, then the tests again, then a commit. The
pure logic lives in plain Kotlin (`bubble/Look.kt`); the Android-bound parts (the service, the renderer, the view, the
Settings row) stay thin and are checked by the build and on the emulator.

## Task 1: the head can tip up and down (`Pose.pitch`)

- `bubble/Moods.kt`: `Pose` gains `pitch: Float = 0f` (radians, positive tips the face down, as the Mac's
  `headPitch`), last in the list so every existing `Pose(...)` stays valid.
- `bubble/HeadRenderer.kt`: `setPose` rotates the head about X by `pose.pitch`, about the same pivot as the tilt and
  the turn.
- Test (`MoodsTest`): every mood's pose has pitch 0 (so no mood changes).

## Task 2: where to look, and how far to turn (`Look`)

- `bubble/Look.kt`: `Look.point(box, cursor)`: the cursor's centre when there is one and it lies in the box, else the
  box's centre. `Look.turn(x, y, headX, headY, density)`: the Mac's `lookAt` in dp, `yaw = clamp(dx / 600, -0.45,
  0.45)`, `pitch = clamp(dy / 500, -0.2, 0.25)`.
- `LookEase`: eases from where the head is turned now to a new turn over 0.25 s (smoothstep), so a new target in the
  middle of a turn starts from where it is, never jumps; says whether it is still moving.
- Tests (`LookTest`): the point with and without a cursor, a cursor outside the box, the clamps, dp (the same px turn
  half as far at density 2), the easing's ends, middle and retarget.

## Task 3: which events turn the head (`LookFilter`)

- `bubble/Look.kt`: `LookFilter.action(type, fromBuddy, fromKeyboard, editable, password)` → LOOK, AWAY or NONE.
  Focus, text and cursor events on an editable, non-password box look; the focus going to something that is not a
  box, a password box, or another window coming up (not the keyboard's) look away; Buddy's own events and anything
  else change nothing.
- Tests (`LookTest`).

## Task 4: the bus events and the 3 s return

- `bubble/BubbleBus.kt`: `BubbleEvent.LookAt(x, y)` (screen px) and `BubbleEvent.LookAway`; `BubbleBus.lookAt`,
  `BubbleBus.lookAway`.
- `bubble/Look.kt`: `LookHold(clock)`: remembers the last LookAt; `target()` is it until 3 s after, then null;
  `msLeft()` says when to check again; `away()` clears it.
- Tests (`BubbleBusTest`: the events reach a collector; `LookTest`: the return with a fake clock).

## Task 5: the head turns (`HeadView`, `BubbleService`)

- `HeadView.look(yaw, pitch)` (`@MainThread`): sets the ease's target and wakes the loop; `tick` adds the eased turn
  to the pose, and draws at least at IDLE_FPS while the ease moves (as the picker turn). Focus fix, `@MainThread` and
  the `LinkageError` catch stay as they are.
- `BubbleService` collects LookAt / LookAway: turns the point into a turn from the head's window centre, runs the 3 s
  return with a coroutine, never touches the head's visibility (a sheet keeps it hidden).
- `Moods.fpsFor` untouched; at rest the rates do not change.
- Checked by the build; the easing and timing are covered by tasks 2 and 4.

## Task 6: the service (`LookService`)

- `bubble/LookService.kt`: an `AccessibilityService`; per event: own package, the keyboard's package, then
  `event.source` → editable / password → `LookFilter`; on LOOK, `getBoundsInScreen`, and the cursor character's
  bounds through `refreshWithExtraData(EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY)` when the node offers it; then
  `BubbleBus.lookAt`. Never `getText`; nodes recycled before API 33.
- `res/xml/look_service.xml`, the manifest entry with `BIND_ACCESSIBILITY_SERVICE`, the strings (label and
  description).
- `LookSetting.enabled(secureValue, packageName, className)`: parses `ENABLED_ACCESSIBILITY_SERVICES` (full and short
  component forms, any case). Tests (`LookTest`).

## Task 7: the Settings row and the disclosure

- `SettingsState.lookOn`, read through an injected `lookEnabled: () -> Boolean` on `reload()` / `resumed()`.
- `SettingsScreen`: "Look where I type" row after Size, the two lines and Turn on / Turn off, the disclosure dialog
  (Continue / Not now), `openAccessibilitySettings()` in `ui/common/Permissions.kt`.
- `MainActivity` wires the reader. Test (`SettingsModelTest`): the row's state follows the reader on resume.

## Task 8: docs and the emulator

- The Android design's "No Accessibility service" line, the README's Android section, a section in
  `docs/manual-checklist-android.md`.
- `npm run android:build`; the emulator check as the spec says, if the buddy is already set up there.
