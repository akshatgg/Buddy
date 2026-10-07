# Buddy — feelings — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: the buddy character and its moods (Phase 1 spec, section 3: Characters).

## 1. Goal

The buddy feels alive. It falls asleep when it is not used and wakes up when it is, loves being petted, gets dizzy
when shaken, looks sad when something fails, fidgets when bored, celebrates when its text goes into the app, and
listens while the person talks. It works the same on the Mac and on Windows.

## 2. The feelings

| Feeling | When | What it looks like | How long |
|---|---|---|---|
| `drowsy` | 1 min without use | A yawn (mouth open, eyes shut, arms out a little), then half-closed eyes and a slower float | until asleep or used |
| `asleep` | 2 min without use | Sleeping eyes ◡ ◡, head down, slow breathing, "z" letters rising, the eyes' and ears' glow at half; it stops following the pointer | until used |
| `wake` | used while drowsy or asleep | Eyes blink open, both arms stretch up, a little shake | 1.2 s |
| `love` | the pointer rubbed back and forth over its head | Heart eyes, small hearts rising, a gentle sway | 2 s |
| `dizzy` | shaken fast while dragged, on release | Swirl eyes, stars circling above its head, the head circling, then it shakes it off | 2 s |
| `sad` | an error (no internet, the AI failed, the limit is reached) | Droopy eyes, head and arms down, one sigh, a small sweat drop | 2.5 s |
| `celebrate` | Buddy put text into the app | A jump with happy eyes, arms up, sparkles | 1.6 s |
| `listening` | the microphone is on | Head tilted as if leaning in, eyes a little up, the ear rims glowing brighter and dimmer with the voice | until the microphone stops |
| bored fidgets | awake and idle | One small action every 15–25 s: look around, swing the arms, hum (happy eyes, "♪" rising), a little hop | 0.8–2 s each |

- **Used** means: the panel is open (from the shortcut or a click), the pointer is on the buddy, it is pressed or
  dragged, or Buddy is doing something (any mood sent by the app). Moving the pointer elsewhere, typing in other apps or
  the pointer passing by do not count. Nothing counts down while the panel is open or the pointer is on the buddy.
- **Petting:** while the pointer is on the buddy's head (not pressed), 3 changes of direction left/right within 1.5 s,
  each at least 6 points of movement.
- **Shaking:** while dragging, 4 changes of direction (any direction: a stroke coming back on itself) within 1 s,
  each at least 24 points.
  It plays wobble while dragged, as today, and `dizzy` when let go.
- **Today's moods stay:** `thinking`, `happy` (the answer is ready), `wave` (Buddy turns on), `wobble` (grabbed),
  `idle`. `sleepy`, which the app sends today for "no internet", now means `sad`.
- **Unknown moods end at once** (back to `idle`), so a newer app or a typo never keeps the buddy drawing at full speed.
- **Blinking** happens only while the eyes are the plain open ovals; never on top of another eye shape.

## 3. New eye shapes (the models)

- Both characters get five new morph targets on the `Face` mesh, after the five they have, in this order: `heart`,
  `swirl`, `sad`, `half`, `sleep`. Each reshapes both eyes, like `blink` and `smile` do:
  - `heart`: each eye a filled heart.
  - `swirl`: each eye a glowing spiral stroke, about one and a half turns.
  - `sad`: each eye the open oval with its top cut by a lid that slopes down toward the outer side (mirrored per eye).
  - `half`: each eye the open oval with its top half hidden by a level lid.
  - `sleep`: each eye a thin, shallow arc curving down, like "‿": calm closed eyes, about as thin as the blink line.
- They are made by `art/build_buddies.py` (headless Blender, `npm run build:buddies`), so both buddies stay
  reproducible. Each `.glb` stays under 1 MB. The previews in `assets/buddies/previews/` do not change.
- **Pictures for the owner:** a render of each character's face with each eye shape, side by side, before the shapes
  are used in the app. The owner can ask for changes until the pull request is merged.
- **The character contract** (Phase 1 spec, section 3) gains, all optional, so an older model still loads: the morphs
  above, and the mesh `EarRims` (the glowing ear rims, already in both buddies) for the ear glow. A model without a
  morph shows the plain open eyes instead; one without `EarRims` has no ear glow.

## 4. Symbols

- Small symbols drawn by the buddy page, not by the model, in the buddy's glow colour (its `accent` in
  `assets/buddies/buddies.json`): "z" letters (`asleep`), hearts (`love`), stars circling (`dizzy`), sparkles
  (`celebrate`), "♪" notes (hum), a sweat drop (`sad`).
- They are page elements animated with CSS (so they stay smooth while the buddy draws few frames), placed from the
  head's position on screen, and removed when their feeling ends.
- **Room for them:** the buddy window grows upward by 0.6 × the buddy's size. The buddy keeps its size and its place on
  screen: the window's bottom centre stays where it was, also for a position saved before this change. The panel and
  the speech bubble keep their places next to the buddy. The extra space lets clicks through, as the rest of the window
  around the buddy does today.

## 5. Drawing and battery

- `asleep` draws 4 frames a second (the slow breathing needs no more), with no blinks and no head turning. That is
  less than today's resting buddy (6 frames a second plus blinks), so a sleeping buddy uses less battery than today.
- `drowsy` draws at the settling rate (15), the yawn at the full rate (30). Every other feeling draws at the full rate
  while it plays, as moods do today; fidgets only during their second or two.

## 6. How it fits together

- **The page** (`src/renderer/buddy/`): `moods.js` gains the poses (pure functions of time, as today), the fidget
  timing and the frame rates; `gestures.js` (new) finds petting and shaking in pointer movement; `symbols.js` and
  `symbols.css` (new) draw the symbols; `buddy.js` applies all of it to the model and the page.
- **Main** (`src/main/`): `sleep.js` (new) counts down to `drowsy` and `asleep` and sends `wake` on use; it is told
  about use by the buddy's IPC (pointer on it, press, drag, click), by every mood the app sends, and by the panel
  opening and closing. `buddy-window.js` gains `voiceLevel(level)` (IPC `buddy:voice-level`, 0 to 1).
- **The rest of the app** sends `celebrate` after Buddy puts text into the app, `sad` on an error, and `listening`
  while the microphone is on, with the voice level about 10 times a second. These calls are made where the panel's
  code already sends moods; the panel itself is not changed by this work.

## 7. Testing

- Unit: every new pose (its shape weights, its end, the glow), unknown moods ending, the frame rates (asleep 4,
  drowsy 15), blinking only on open eyes, the fidget timing, petting and shaking (real hand-like traces, and near
  misses that must not count), the sleep countdown (use, holds, wake), the window growing upward with the bottom centre
  kept, the panel and bubble places unchanged, `voiceLevel` reaching the page, the models' morph names and order.
- e2e: with short countdowns, the buddy goes drowsy, then asleep, and wakes when the pointer comes onto it; petting
  makes it `love`; a shaken drag makes it `dizzy` on release; a voice level reaches the page while `listening`;
  symbols appear and go.
- Manual: each feeling on the installed app, on the Mac and Windows; the eye shapes at all three sizes; a sleeping
  buddy's CPU use compared with today's resting buddy.

## 8. Out of scope

Sounds, more characters, the Android app's buddy, feelings that depend on the time of day or the battery, the buddy
moving around the screen by itself.
