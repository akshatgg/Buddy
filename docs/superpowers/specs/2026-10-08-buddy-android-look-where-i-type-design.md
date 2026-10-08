# Buddy for Android: look where I type — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: Buddy for Android (`2026-10-07-buddy-android-design.md`), the desktop buddy's head following the pointer
(`src/renderer/buddy/moods.js` `lookAt`).

## 1. Goal

On the desktop the buddy's head turns toward the mouse pointer. On a phone there is no pointer, so the floating head
turns toward where the person is typing: when they tap a text box in any app, or type in it, the head looks at it.

## 2. A known risk, chosen by the owner

The Android design (§1) chose "no Accessibility service" because Google Play has restricted Accessibility since
2026-01-28. This feature needs one: no other way lets an app know where a text box is in another app. The owner chose
it on 2026-10-08, knowing this. Play publishing is out of scope for Buddy today; before publishing, the Play
Accessibility declaration (and the in-app disclosure in §3) must be filed and may be refused. Everything else in
Buddy works without this service.

## 3. What the person sees

- **Settings** (the app's Settings screen) gets a row in the buddy's part, after Size: **Look where I type**, with a
  line under it and a button.
  - Off: `The head turns toward the box you type in, in any app.` and **Turn on**.
  - On: `On. Buddy sees only where the box is, never what you type.` and **Turn off** (opens Android's Accessibility
    settings, where it is turned off; Android lets no app turn its own service off).
  - The row reads the real state each time the screen shows (the service enabled in Android's settings).
- **Turn on** first shows a dialog (Google's "prominent disclosure"), title `Look where I type`, text:
  `Buddy uses Android's Accessibility only to see where the text box you are typing in is on the screen, so that the
  head can look at it. It never reads what you type, and nothing leaves your phone.` Buttons **Continue** (opens
  Android's Accessibility settings, `Settings.ACTION_ACCESSIBILITY_SETTINGS`) and **Not now**.
- In Android's Accessibility list the service is named `Buddy: look where I type`, with the same sentence as its
  description.
- **The head:** while the buddy is on screen and the service is on:
  - A text box gets the focus, its text changes, or its cursor moves → the head turns toward the cursor when Android
    gives the cursor's place on screen, else toward the middle of the box.
  - 3 s after the last such event, or when the box loses the focus or another window comes up, the head turns back to
    the front.
  - Password boxes (`isPassword`) are skipped: no turn.
  - The turn eases in and out (about 0.25 s), never jumps.
  - While a sheet (the panel or a Fix sheet) is open the head is hidden anyway; nothing changes there.

## 4. How it works

- **`LookService`** (`bubble/LookService.kt`), an `AccessibilityService` declared in the manifest with
  `android.permission.BIND_ACCESSIBILITY_SERVICE`, and `res/xml/look_service.xml`:
  `accessibilityEventTypes="typeViewFocused|typeViewTextChanged|typeViewTextSelectionChanged|typeWindowStateChanged"`,
  `canRetrieveWindowContent="true"` (needed for the box's bounds), `accessibilityFeedbackType="feedbackGeneric"`,
  `notificationTimeout="100"`, no `packageNames` (every app), `isAccessibilityTool="false"`.
- For each event it takes `event.source`; if the node is editable and not a password, it reads
  `getBoundsInScreen`, and for the cursor, when the text selection end is known and the API allows it
  (API 26+, `refreshWithExtraData(EXTRA_DATA_TEXT_CHARACTER_LOCATION_KEY, …)` for the one character before the cursor),
  that character's bounds. It never calls `getText`, never stores or logs anything, and recycles nodes as Android
  asks. Events from Buddy's own package are ignored.
- **`Look`** (`bubble/Look.kt`), pure and unit-tested: from a box (rect) and an optional cursor (rect) to the point to
  look at (the cursor's centre, else the box's centre); and from that point and the head's centre on screen to the
  turn, with the desktop's numbers in dp: `yaw = clamp(dx / 600, -0.45, 0.45)`, `pitch = clamp(dy / 500, -0.2, 0.25)`
  (dx, dy in dp, from the head's centre); and the easing.
- **The bus:** `BubbleBus` gains `BubbleEvent.LookAt(x, y)` (screen px) and `BubbleEvent.LookAway`. `BubbleService`
  turns them into the head's target, using the head's place on screen, and runs the 3 s return.
- **The head:** `Pose` gains `pitch`; `HeadRenderer` rotates the head about X by it (with the yaw, as the desktop does);
  `HeadView` keeps a look target that eases toward the asked turn. While the head is turning it draws at least at the
  idle rate (15 fps), as it does for the picker's turn; at rest the rates do not change.
- **Settings:** `SettingsModel` reads whether the service is enabled (`Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES`
  holds Buddy's component) when the screen resumes.

## 5. Testing

- Unit (JVM, `npm run android:test`): `Look` (the point from a box with and without a cursor, the clamps, dp, the
  easing), the event filter (editable, password, own package, the window change) through a small pure function, the
  bus events, the 3 s return (with a fake clock), `Pose.pitch` default 0, the Settings row's state from the secure
  setting string.
- Emulator (`Pixel_7`): build and install (`npm run android:build`), enable the service with
  `adb shell settings put secure enabled_accessibility_services <component>` and `accessibility_enabled 1`, open a
  text box in an app (Messages or the browser), tap and type, and see the head turn (screenshot). The buddy may need
  the owner's sign-in first: if so, stop and ask; never sign in for the owner.
- Manual (`docs/manual-checklist-android.md`, a new section): the disclosure, turning on and off, typing in a few apps
  (WhatsApp, Gmail, Chrome), a password box, the return after 3 s, battery while typing.

## 6. Out of scope

Reading or helping with the typed text through this service (it is only for the look), iPhone, Play publishing.
