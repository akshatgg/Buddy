# Hey Buddy: a listening face, and the answer in a small bubble (design)

Date: 2026-10-17. Mac (Electron, `src/`) and Android (Kotlin, `android/`). Owner-approved request.

## What the person sees

1. **The face.** They say "Hey <name>" (or "Hey Buddy"). Buddy says "Yes?" and, at the same moment, its face takes the
   *listening* look (head leaning in, eyes up). The look stays while they speak. When they stop, Buddy *thinks* while
   the words are written down and answered, then is happy (or sad on an error), as a typed chat is today.
   "Hey Buddy, call Mom" in one breath: no "Yes?"; listening while the rest is recorded (Android; on the Mac the request
   is already recorded when main hears of it), then thinking.
2. **No panel.** A hands-free request no longer opens the chat panel. Buddy speaks the answer, and a small speech bubble
   beside Buddy (under the notch when Buddy lives there) shows the answer's text, cut at a word with "…" past
   140 characters. The bubble stays while Buddy speaks and goes by itself 8 s after Buddy stops. A click/tap on the
   bubble, or on Buddy while it shows, opens the full chat on that same conversation (question, answer, cards).
3. **Questions too.** "To Mom: I'm late. Send it?" / "Call Prince?" show in the bubble while asked, and are answered by
   voice as today. Opening the chat from the bubble shows the card with its buttons. Safety rules are unchanged: only a
   yes (spoken or pressed) sends or calls; anything else is Not now.
4. **Errors** show in the bubble too: an error in the answer (no internet, the AI failed) and the wake loop's own lines
   (no internet while writing down, "I'm still on the last one…"). New: words written down as nothing show
   "I didn't catch that." in the bubble only (not said, so the quiet "say it again" behaviour stays).
5. **Unchanged:** typed chats, the panel's 🎤, a wake while the panel is already open (it goes into the open panel as
   today), the panel opened by the person (shortcut, click on Buddy with no bubble up, which resumes a recent chat as
   today).

## How it works

### Shared (`shared/voice-words.js`, ported in `voice/VoiceWords.kt`, cases in `voice-cases.json`)

- `BUBBLE_MAX = 140`, `BUBBLE_HIDE_MS = 8000`, `VOICE_LINES.didntCatch = "I didn't catch that."`.
- `bubbleLine(text)`: spaces collapsed, trimmed; longer than `BUBBLE_MAX` is cut at the last space (when past half),
  trailing punctuation dropped, and "…" added. Result is at most `BUBBLE_MAX` chars.
- `bubbleText(items)`: the answer as the bubble shows it: each buddy item's `say` and `text`, an error's text (the
  internet line for `network`/`timeout`), a done event without its emoji; joined by spaces, through `bubbleLine`.
  Unlike `spokenLines`, a long text is shown (cut), not dropped.

### Bubble contract (both apps)

- `speech(words)`: show `words` in the speech bubble and hold it (no hide timer). `speech(null)`: hold what is shown.
- `speechDone()`: the bubble goes `BUBBLE_HIDE_MS` later (a new `speech` cancels that).
- A spoken line in an off-screen wake chat: `speech(shown)` before, `speechDone()` after. The answer's lines show
  `bubbleText` of the answer for the first line and hold it for the rest; an answer with no spoken line (long text
  only) shows `bubbleText` and is released at once. A card's question, "Okay, not sent.", "Sent.", the unlock line,
  … show themselves.

### Mac

- **Quiet chat** (`actions.js`): `voice(words)` with the panel hidden opens the chat *without showing it*
  (`open({ show: false })`: selection read, chat resumed or new, `chat.quiet = true`, `chat.quietAt = now`). A quiet chat
  counts as "the person is with Buddy" (`present()`), so WhatsApp search, sends and calls work as with the panel open;
  `comeBack()` does not show the panel for it. `speak()` drives `ui.speech`/`ui.speechDone` for it.
  Opening the panel (bubble click, Buddy click, shortcut) on a quiet chat less than 5 min old shows that chat
  (`resumed`), and it is a normal chat from then on.
- **Speech bubble** (`bubble-window.js`): the existing bubble window gets a second mode: `speak(text|null, at)`,
  `release()`, `hide()`. Bigger box (`SPEECH = 280 × 110`), words wrap (4 lines), beside the floating buddy
  (`speechBounds`) or under the notch (`speechUnderNotch`). Clicks pass through except over the words (hover, like the
  buddy window); a click sends `bubble:click` → main hides the bubble and runs `onCall()` (actions.toggle → opens the
  quiet chat). The panel showing hides the bubble. `say()` (the 2.6 s line) is unchanged.
- **Face** (`wake.js`): new option `feel = { listening(on), mood(name), bubble(text) }` (main wires feelings and the
  speech bubble). After the voice/busy check: `listening(true)` with "Yes?", `listening(false)` when the request is in;
  `mood('thinking')` while written down; `idle` on nothing / busy, `sad` on an error; the busy and no-internet lines
  also go to `bubble`. `actions.talk()` takes over the mood from there as today.

### Android

- **Face**: new `Mood.LISTENING` (head tilt 0.14 and eyes up 0.25, eased in over 0.4 s, held). `WakeControl`: `Woke`
  → LISTENING (was THINKING), `Request` → THINKING before the hands-free turn. `PanelModel.askAloud` listens with
  LISTENING instead of THINKING (the comment there says the head had no listening face).
- **Speech bubble**: `BubbleEvent.Speech(text: String?)` and `BubbleEvent.SpeechDone`. `PanelModel(showSpoken = true)`
  (the hands-free model in `AppGraph`) sends them while it is not on screen, through one `aloud()` speak path.
  `SpeechBubble` gets `stay` (no timer), `keep()`, `release(ms)` and `spoken` (a hands-free bubble is up).
  `BubbleService` shows it with a tap that opens `HandsFreeChatActivity`; a head tap while `spoken` does the same.
- **The chat on screen**: `HandsFreeChatActivity` is `PanelActivity` on `AppGraph.handsFreeChat` (the hands-free
  `PanelModel`) instead of the panel's own model: same screen, it never starts a new chat on opening, and closing it
  ends that chat. `HandsFree` shows "I didn't catch that." when the words come back empty.

## Not doing (YAGNI)

- No new Mac mood or look change: the Mac's `listening` and `thinking` are reused as they are.
- No voice level on the face during the wake's own listening (the ear does not send levels).
- No change to the iPhone web app or Windows (Windows has no wake).

## Risks

- Mac: clicks on a `focusable: false` transparent window rely on the hover → `setIgnoreMouseEvents(false)` pattern that
  the buddy window already uses; check on device.
- Android: the hands-free chat on screen uses that model's hands (no screen picture, no step aside). Buttons that put
  text in another app may not work from it; message/call cards (the main hands-free case) do.
