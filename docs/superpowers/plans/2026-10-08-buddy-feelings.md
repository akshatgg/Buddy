# Buddy Feelings Implementation Plan

> **For agentic workers:** Tasks 1–4 run in parallel, each in its own worktree; their files do not overlap. Task 5
> joins them; Task 6 waits until the chat panel (built in another session) is merged. Each task is TDD: write the
> failing tests, make them pass, run the whole suite, commit.

**Goal:** the buddy sleeps, wakes, loves petting, gets dizzy, looks sad, fidgets, celebrates and listens, as
docs/superpowers/specs/2026-10-08-buddy-feelings-design.md describes.

**Architecture:** poses stay pure functions of time in `src/renderer/buddy/moods.js`; new pure modules find gestures
(`gestures.js`) and count down to sleep (`src/main/sleep.js`); `symbols.js` draws CSS-animated symbols over the canvas;
`art/build_buddies.py` adds five eye shapes to both models; `buddy.js` and `buddy-window.js` put it together.

**Tech Stack:** Electron 44, three.js (ES module page), plain JS (CommonJS in main/tests, ES modules in the buddy
page and its `.mjs` tests), `node --test`, ESLint, headless Blender 5 (Python) for the models.

## Global Constraints

- The owner's rule: no AI-assistant credit anywhere: no "Co-Authored-By" lines, and no mention of Claude or any
  assistant in commits, comments or docs. (The product's existing provider name "Claude (Anthropic)" in the code is
  fine.)
- Commit messages in this repo's style (`feat: …`, `fix: …`, `test: …`, `docs: …`, `art: …`), plain short English.
- Never run `npm start` or `npm run dist:*`; never post real key or mouse events to the system; leave no processes
  running (Blender, Electron). `npm test`, `npm run test:e2e` and `npm run build:buddies` are fine.
- Comments match the surrounding code: plain English, saying why. Follow the style of the file you are in.
- Mood names: `idle`, `thinking`, `happy`, `wave`, `wobble`, `sleepy` (= `sad`), `drowsy`, `asleep`, `wake`, `love`,
  `dizzy`, `sad`, `celebrate`, `listening`, and the fidgets `look`, `swing`, `hum`, `hop`. Unknown names end at once.
- Morph targets on `Face`, in this order: `blink`, `smile`, `mouthO`, `eyeLUp`, `eyeRUp`, `heart`, `swirl`, `sad`,
  `half`, `sleep`. Ear rims: the mesh `EarRims`. All of the new ones are optional for the app.
- Effects (symbols): `z` (asleep), `hearts` (love), `stars` (dizzy), `sparkles` (celebrate), `notes` (hum), `drop` (sad).
- Timings: drowsy at 60 s without use, asleep at 120 s; wake 1.2 s; love 2 s; dizzy 2 s; sad 2.5 s; celebrate 1.6 s;
  the yawn 1.6 s; fidgets every 15–25 s while idle, look 2 s, swing 1.5 s, hum 2 s, hop 0.8 s.
- Gestures: petting = 3 turns left/right within 1.5 s, each after ≥ 6 points of travel, pointer on the head, not
  pressed. Shaking = 4 turns (a stroke coming back on itself, in any direction, counted once) within 1 s, each
  after ≥ 24 points, while dragging.
- Frame rates: FPS 30, IDLE_FPS 15, REST_FPS 6, new SLEEP_FPS 4 (asleep). Drowsy: 30 during the yawn, else 15.
- The buddy window grows upward by 0.6 × the buddy's size; the buddy keeps its size and place; panel and bubble keep
  their places; a saved position keeps its bottom centre.

---

### Task 1: Five new eye shapes in both models (parallel)

**Files:** Modify `art/build_buddies.py`; regenerate `assets/buddies/boy-1.glb` and `assets/buddies/girl-1.glb` with
`npm run build:buddies` (do not change `assets/buddies/previews/*.png`; if the script always re-renders them, restore
them with `git checkout -- assets/buddies/previews`); modify `test/characters.test.js`.

**Interfaces:** Produces the morph targets `heart`, `swirl`, `sad`, `half`, `sleep` (after the existing five, in that
order) on the `Face` mesh of both `.glb` files, all starting at weight 0.

- Build each shape exactly the way `eye_shapes()` builds `open_eye`, `blink` and `smile`: the same vertices per eye
  (`EYE_RINGS` × `eye_loop()`), so they morph cleanly:
  - `heart`: a filled heart, the open eye's rings scaled from the centre (like `open_eye`) but along a heart outline
    of about the open eye's size; the point at the bottom.
  - `swirl`: a `stroke()` along a spiral from the eye's centre outward, about 1.5 turns, pen width about `BLINK_W`,
    filling about the open eye's size.
  - `sad`: the open oval with its top cut by a straight lid sloping down toward the OUTER side of each eye (so it is
    mirrored: build it per side, `side * x`), hiding about the top third at the outer corner and less at the inner one.
  - `half`: the open oval with its top half hidden by a level lid (points above the lid line pulled down onto it).
  - `sleep`: a thin `stroke()` (pen about `BLINK_W`) along a shallow arc curving down ("‿"), its sag about a third of
    `smile`'s depth, sitting about where the blink line sits: calm closed eyes.
- The mouth's vertices stay shut (on one point) in every new key, as they do in `blink` and `smile`.
- Each `.glb` stays under 1 MB.
- **Pictures for the owner:** add a `--faces` option (or a separate small script under `art/`) that renders, for each
  character, its head from the front with each face: open, `blink`, `smile`, `heart`, `swirl`, `sad`, `half`, `sleep`,
  side by side in one PNG per character, into `art/out/faces-<id>.png` (gitignored). Run it and report the paths.
- Test (`test/characters.test.js`): both `.glb` files list exactly the ten target names in order, and all start at rest.
- Commit: `art: five new eye shapes (heart, swirl, sad, half, sleep) in both buddies`.

### Task 2: Poses, frame rates and fidgets (parallel)

**Files:** Modify `src/renderer/buddy/moods.js`, `test/moods.test.mjs`.

**Interfaces (produced, exact):**
- `export const SLEEP_FPS = 4;` (next to FPS, IDLE_FPS, REST_FPS).
- `export const FIDGETS = ['look', 'swing', 'hum', 'hop'];`
- `moodPose(name, since, { level = 0 } = {})` returns a pose with every field of `REST`:
  `lift 0, scaleX 1, scaleY 1, headTilt 0, headPitch 0, headYaw 0, armL 0, armR 0, smile 0, mouthO 0,
  eyesClosed false, eyeL 0, eyeR 0, heart 0, swirl 0, sad 0, half 0, sleep 0, glow 1, ears 1, look 1, float 1,
  effect null, done false`.
  `headPitch` (radians, + tips the head forward/down) and `headYaw` (radians) add to the head's rotation; `glow` and
  `ears` multiply the eyes' and the ear rims' glow; `look` (0–1) scales how much the head follows the pointer;
  `float` scales the idle float; `effect` names the symbols to show (Global Constraints) or null.
- `isActive({ mood, since, pressing })`: true for a press, and for any mood but `idle`, `drowsy` (after its yawn) and
  `asleep`.
- `fpsFor({ mood, since, pressing, sinceLookChange, blinkSoon, sinceActive })`: `asleep` → SLEEP_FPS unless pressing;
  `drowsy` → FPS during the yawn (`since` < 1.6), else IDLE_FPS (a coming blink does not raise either: their eyes are
  not open); otherwise exactly today's rules.
- `blinkWeight(pose, blink)`: 1 when `eyesClosed`; 0 when any of `smile`, `heart`, `swirl`, `sad`, `half`, `sleep` is
  above 0; else `blink`.
- `createFidgeter(random = Math.random)` → `{ reset(t), take(t) }`: `reset(t)` schedules the next fidget at
  `t + 15 + random() * 10` (seconds); `take(t)` returns null before that, else a name from FIDGETS
  (`FIDGETS[Math.floor(random() * FIDGETS.length)]`) and schedules the next one from `t`.

**The poses** (keep `thinking`, `happy`, `wave`, `wobble` exactly as today; lengths from Global Constraints; shape
weights fade in over about 0.15–0.6 s and out over the last 0.2–0.3 s of a timed mood so they never snap):
- `sad` (and `sleepy`, the same pose): `sad` 1, head down (`headPitch` ≈ 0.18), arms down a little, one sigh (scaleY
  dips to about 0.97 around 1 s and back), `effect: 'drop'`, done at 2.5 s.
- `drowsy`: the yawn in the first 1.6 s (mouthO up to 1 and back, eyes shut from about 0.2 to 1.4 s, arms out a
  little), then `half` 1, `headPitch` ≈ 0.08, `float` 0.6; never done.
- `asleep`: `sleep` 1 (fade in over about 0.6 s), `headPitch` ≈ 0.22, breathing scaleY `1 + 0.02 sin(2π·since/4)`,
  `glow` 0.5, `ears` 0.5, `look` 0, `float` 0.5, `effect: 'z'`; never done.
- `wake`: eyes shut until 0.25 s, then open; arms stretch up (to about 2.4) with scaleY up to about 1.06 between 0.25
  and 0.85 s; a little head shake from 0.85 s that fades; done at 1.2 s.
- `love`: `heart` 1, a gentle sway (headTilt ≈ 0.1 sin(4·since)), `effect: 'hearts'`, done at 2 s.
- `dizzy`: `swirl` 1; the head circles (headTilt and headPitch on sin and cos of about 9·since) until 1.6 s, then a
  quick fading head shake on `headYaw` while `swirl` fades out; `effect: 'stars'`, done at 2 s.
- `celebrate`: a jump (lift up to about 0.15 in the first 0.6 s, a small squash on landing), `smile` 1, arms up
  fading, `effect: 'sparkles'`, done at 1.6 s.
- `listening`: headTilt ≈ 0.14, headPitch ≈ −0.04, eyeL = eyeR ≈ 0.15, `ears` = 1 + 1.5·level, `look` 0.5; never
  done.
- `look` (2 s): headYaw sweeps one way, then the other, back to 0, `look` 0 meanwhile. `swing` (1.5 s): the arms
  swing opposite each other, fading. `hum` (2 s): `smile` 1, a gentle sway, `effect: 'notes'`. `hop` (0.8 s): one small
  hop (lift ≈ 0.06) with a squash. All done at their lengths.
- `idle`: REST. Any other name: `{ ...REST, done: true }`.

**Tests** (in `test/moods.test.mjs`, alongside the existing ones, which must keep passing): each timed mood's `done`
at its length and not before; `asleep`/`drowsy`/`listening` never done; every pose carries every REST field; the
right shape weight and effect per mood; `sleepy` equals `sad`; an unknown name is done at once; `ears` follows
`level`; SLEEP_FPS for asleep (also with a blink coming), 30 then 15 for drowsy, 30 for a press while asleep;
`isActive` per mood; `blinkWeight` is 0 for each eye shape; the fidgeter's schedule with a fixed `random`.

Commit: `feat: the buddy's new poses, sleeping frame rate and fidgets`.

### Task 3: Symbols (parallel)

**Files:** Create `src/renderer/buddy/symbols.js` (ES module), `src/renderer/buddy/symbols.css`,
`test/symbols.test.mjs`.

**Interfaces (produced, exact):**
- `export const EFFECTS = ['z', 'hearts', 'stars', 'sparkles', 'notes', 'drop'];`
- `export function particlesFor(effect)` → an array of `{ kind, delay, x, y, scale }` (pure, for tests): `kind` one
  of `'z' | 'heart' | 'star' | 'sparkle' | 'note' | 'drop'`; `delay` in seconds; `x`, `y` the start offset from the
  head's top centre in head widths (+x right, +y down); `scale` relative to the base size. An unknown effect → `[]`.
- `export function createSymbols(root, { color })` → `{ place({ x, y, size }), play(effect), stop() }`:
  `root` is a container element over the canvas; `place` gives the head's top centre in CSS pixels and the head's
  width in CSS pixels; `play(effect)` replaces whatever is showing with that effect's particles; `stop()` removes
  everything. Looping effects (`z`, `stars`) repeat until replaced or stopped; the others play once and remove their
  elements when their animation ends. `color` is a CSS colour (the buddy's accent), set as the CSS variable `--glow`
  on `root`.
- The look: small (about 0.18 × head width, at least 6 px), soft, in `--glow` with a faint glow (drop-shadow), drawn
  as inline SVG (heart, star, four-point sparkle, eighth note, drop) or text (`z`, bold, rounded system font).
  `z`: three letters rising up and to the right from above the head, growing and fading, staggered, looping.
  `hearts`: three hearts popping up near the head and fading. `stars`: three stars circling in a flat ellipse just
  above the head, looping. `sparkles`: five or six sparkles bursting out around the head and fading. `notes`: two
  notes rising beside the head. `drop`: one sweat drop beside the head sliding down a little and fading.
- All motion is CSS keyframes in `symbols.css` (transform and opacity only), so it stays smooth while the page draws
  few frames. `pointer-events: none` on everything. With `prefers-reduced-motion: reduce` the symbols fade in and out
  without moving.
- Tests (`test/symbols.test.mjs`, pure parts only): EFFECTS; each effect's particle count and kinds; delays staggered
  for `z`; unknown → `[]`; offsets keep particles within about one head width of the head.

Commit: `feat: floating symbols for the buddy's feelings`.

### Task 4: Gestures and the sleep countdown (parallel)

**Files:** Create `src/renderer/buddy/gestures.js` (ES module), `test/gestures.test.mjs`, `src/main/sleep.js`
(CommonJS), `test/sleep.test.js`.

**Interfaces (produced, exact):**
- `export function createPetDetector({ turns = 3, withinMs = 1500, step = 6 } = {})` → `{ feed(x, t), reset() }`:
  `x` the pointer's screen x in points, `t` in ms. A turn is a change of direction after at least `step` points of
  travel in the previous direction (small jitter under `step` is not a turn and not travel). `feed` returns true once
  when `turns` turns fall within `withinMs` (from the first of them to the last), then starts counting afresh.
- `export function createShakeDetector({ turns = 4, withinMs = 1000, step = 24 } = {})` → `{ feed(x, y, t), reset() }`:
  the same on both axes (a turn on either axis counts).
- `src/main/sleep.js`: `const DROWSY_MS = 60_000; const ASLEEP_MS = 120_000;`
  `createSleep({ onMood, later = setTimeout, cancelLater = clearTimeout, drowsyMs = DROWSY_MS, asleepMs = ASLEEP_MS })`
  → `{ poke(), hold(reason, on), state() }`; exports `{ createSleep, DROWSY_MS, ASLEEP_MS }`.
  - `state()` is `'awake' | 'drowsy' | 'asleep'`; it starts `'awake'` with the countdown running.
  - The countdown runs from the last use while nothing holds: at `drowsyMs` → state `drowsy`, `onMood('drowsy')`; at
    `asleepMs` (from the same start) → state `asleep`, `onMood('asleep')`.
  - `poke()`: a use. If drowsy or asleep → `onMood('wake')`, state `awake`. Restarts the countdown (unless held).
  - `hold(reason, true)`: like a poke, then no countdown while any reason holds. `hold(reason, false)`: drops that
    reason; when none is left, the countdown starts again from now. Holding the same reason twice is one hold.
- Tests: hand-like traces (a pointer rubbing back and forth at ~10 points per sample, 16 ms apart) that count; near
  misses that must not (2 turns; turns spread over more than the window; jitter under the step; slow drags); the shake
  on either axis; `reset`. The countdown with fake timers: drowsy then asleep; poke restarts; poke while asleep sends
  `wake` once; holds (two reasons, released in turn) stop and restart it; holding while asleep wakes.

Commit: `feat: petting and shaking gestures, and the buddy's sleep countdown`.

### Task 5: Put it together (after Tasks 1–4 are merged into `feelings`)

**Files:** Modify `src/renderer/buddy/buddy.js`, `src/renderer/buddy/index.html`, `src/preload/buddy.js`,
`src/main/buddy-window.js`, `src/main/ipc/buddy.js`, `src/main/characters.js` (if the accent is not yet available),
`src/main/geometry.js`; tests: `test/buddy-window.test.js`, `test/buddy-ipc.test.js`, `test/geometry.test.js`, new e2e
check `test/e2e/checks/15-buddy-feelings.js` (the harness loads every file in that folder by itself). **Not**
`src/main/main.js` or `test/e2e/smoke.js`: the other session is changing them (owner's rule: wait until it says
done). Their lines move to Task 6.

- The page applies every pose field (head pitch/yaw/tilt with `look`, `float`, the five new morphs, `glow` on the
  Face's glowing materials and `ears` on `EarRims`'s, from their loaded intensities), `blinkWeight(pose, …)`,
  `fpsFor`/`isActive` with `since`, the fidgeter (only while `idle`; reset whenever the mood changes), petting
  (pointer on the Head's meshes, not pressed → `love`), shaking (during a drag → `dizzy` on release instead of
  `idle`), the voice level (`buddy:voice-level` → smoothed → `moodPose(…, { level })`), and the symbols (a container
  over the canvas; `place` from the projected top of the Head on load and resize; `play` each time a mood with an
  `effect` starts (also when the same mood starts again), `stop` when a mood without one starts; colour = the character's accent, which `buddy:model` now returns as `{ bytes, accent }`).
  Expose `window.__buddyMood` (the mood's name) for the e2e test.
- Notes from Tasks 2 and 4 (their reports are in ~/projects/buddy/.superpowers/sdd/feelings/):
  - Ease from one mood's pose to the next over about 0.2 s (blend every numeric pose field from the pose shown when the
    mood changed), so wake-from-drowsy, wobble-to-dizzy and any mood cut short never jump in one frame.
  - Smooth the voice level that arrives about 10 times a second before passing it as `level`.
  - Fidgets draw at the full rate while they play, but must not restart the 10 s settling rate afterwards: leave the
    FIDGETS out of the page's `lastActive`. Otherwise a fidget every ~20 s keeps an awake buddy near 12 frames a second
    instead of today's 6 (Task 2's review).
  - Pass `since` to `isActive` and `fpsFor`; call `fidgeter.reset(t)` whenever the mood changes and on any use.
  - Pet detector: feed `screenX` only while the pointer is on the Head and not pressed; `reset()` when it leaves the
    head or a press starts; ignore a detection while `love` is playing. Shake detector: feed `screenX`/`screenY` while
    dragging; `reset()` when a drag starts.
  - `createSleep` with its default timers keeps real 60 s / 120 s timers alive: tests that build one pass fake timers.
  - Symbols (Task 3's report and review): `place()` takes the top centre of the Head's bounding box (the sprout or
    bow included) and its width (the ears included), in CSS pixels; call it on load and resize only (the keyframes
    read its values, so calling it every frame restyles running animations). `index.html` must link `symbols.css`:
    one-shot symbols remove themselves on `animationend`. `play()` starts together with the mood.
  - The `z` letters exist only about 4.9 s of every 12 s cycle (then a rest with nothing animating): an e2e check
    must look right after `asleep` starts.
  - The sleep countdown's own moods (`drowsy`, `asleep`, `wake`) must not count as use: only the app's moods and the
    buddy's IPC poke it (Task 6 wires the app's moods). Its `onMood` runs from a timer, so it must not throw when the
    buddy window is gone (buddy-window's `mood()` already ignores a missing window; keep it that way).
- Main: `buddy-window.js` gains `voiceLevel(level)` (clamped 0–1, sent on `buddy:voice-level`, never queued for a
  page that is loading); `registerBuddyIpc` takes an optional `sleep` (default: one whose `poke` and `hold` do
  nothing) and tells it about use: `hold('hover', over)`, `hold('drag', true|false)`, `poke()` on click.
- The window grows upward (Global Constraints): `buddyWindowSize` adds 0.6 × size to the height; `buddy.bounds()`
  keeps returning the old rectangle (the buddy's own box at the bottom of the window), so the panel and the bubble
  are placed as before; dragging, snapping and clamping use the real window; a saved position from before keeps its
  bottom centre. The camera frames the model at the same size and place within that bottom box.
- e2e (`ctx.buddy` is the buddy window object; moods can be sent with `ctx.buddy.mood(name)`): `asleep` shows the
  sleeping look and its symbols, and a later mood replaces it; petting traces (page input events, as
  14-buddy-click.js sends them) → `love`; a shaken drag → `dizzy` after release; `ctx.buddy.voiceLevel()` reaches the
  page during `listening`; a symbol element appears with `love` and is gone after it.

Commit(s): `feat: the buddy shows its feelings` (plus `test: …` if separate).

### Task 6: Connect to the panel (after the chat panel is merged to master)

**Files:** `src/main/actions.js`, `src/main/main.js`, `test/e2e/smoke.js` (only if needed), a new e2e check for
sleeping, `docs/manual-checklist.md`, `README.md`.

- Rebase `feelings` on master first, keeping every change from the chat panel. Then in `main.js`:
  `createSleep({ onMood: (m) => buddy.mood(m), ...options.sleep })`, passed to `registerBuddyIpc`; poke before each
  `buddy.mood('wave')`; `options.sleep` (short countdowns) for the e2e check: drowsy → asleep → the pointer on the
  buddy wakes it (`wake` then `idle`). Then: `celebrate` after Buddy puts text into the app (a paste, not a copy);
  `sad` instead of `sleepy` on errors (and its back-to-idle timer goes: `sad` ends by itself); every app mood pokes
  the sleep countdown; the panel open → `hold('panel', true)`, closed → `hold('panel', false)`; the chat panel's
  `ui.listening(on)` → `hold('voice', on)` and `buddy.mood(on ? 'listening' : 'idle')`; `ui.voiceLevel(level)` →
  `buddy.voiceLevel(level)`. Tests for each in the existing actions/main tests.
- The page cannot see the panel: tell it when the panel opens and closes, so the buddy does not fidget while the
  person is using the panel (Task 5's review, M2). Add a small `buddy` method and IPC for it, next to `voiceLevel`.
- For the PR text (owner's calls): petting does not cut short `thinking` or `listening`; a buddy saved within 0.6 × its
  size of the top of the screen starts that much lower, because the taller window must stay on screen.
- Docs: a "Feelings" section in `docs/manual-checklist.md` (the design's section 7 manual list); README's buddy
  description if it lists moods.
