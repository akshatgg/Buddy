# Buddy — the chat panel: one box, does it in the app, remembers you, voice — Design

Date: 2026-10-08
Status: approved by the owner (2026-10-08)
Builds on: Phase 1 (the panel's three tabs), Phase 2 (free mode through Buddy's server), Settings polish, the Windows
port, and the one-box design of 2026-10-08 (`git show e8aec99:docs/superpowers/specs/2026-10-08-buddy-one-box-voice-design.md`),
whose box and screen steps (§3) and voice (§4) this design takes over. Its §2 "one box, one answer" is replaced by the
chat below.

Who builds what (owner, 2026-10-08): this design is the panel's. The buddy's new feelings (listening, celebrate, sad,
…) have their own design and come after it; until then the panel calls only the moods that exist today.

## 1. Goal

Buddy behaves like a person you talk to. You ask anything, and it answers. You tell it to do something in the app that
is open ("reply to this mail", "fix my English", "make it shorter"), and it does it there. It talks your language,
remembers what you tell it about yourself, and listens when you speak. There are no tabs and no tone buttons.

## 2. The panel is a chat

- **Header** as today: the buddy's name · the app it came from, ⚙︎ and ✕.
- **Messages:** yours on the right, the buddy's on the left, newest at the bottom; the list scrolls.
- **Empty chat:** `Hi Akshat! What should we do?` (the first name of the signed-in person; `Hi! What should we do?`
  without one) and one line of examples: `“boss ko mail, kal chutti chahiye” · “fix this” · “what does this mean?”`.
- **Your selection:** when text was selected in the app, a card above the box: `Your selection: “first words…”` with ✕
  to leave it out. ↩ in an empty box then fixes the selection (as if the person had typed "fix this").
- **The box** at the bottom: placeholder `Tell me what to do…`; ↩ sends, ⇧↩ is a new line, nothing is sent while an
  input method is composing. A send button does the same. The 🎤 button sits in the box (§6).
- **While the buddy works:** a `Aarav is thinking…` line at the bottom; the box stays usable, but a second message waits
  until the answer has come.
- **The buddy's answers**, by what it did:

  | It… | Shows | Buttons |
  |---|---|---|
  | wrote something (a mail, a message, a reply) | a short line and the text | Insert, Copy |
  | fixed text | a short line, the text, up to 5 notes on the mistakes | Replace (or Insert for text typed into the box), Copy |
  | answered (a meaning, a translation, advice) | the answer | Copy |
  | did it in the app (§4) | `✅ Put it in Gmail` and the text | Undo, Copy |

- **Small lines** between messages say what happened: `👀 Looked at Gmail`, `📖 Read your text in Gmail`,
  `📝 Remembered: your boss is Mr. Sharma` (with Undo), `✅ Sent`.
- **Errors** show as a buddy line in red, with **Try again**, and **Open Settings** where the fix is there (as today).
- **The chat ends** when the person closes the panel (✕, Esc, the shortcut, a click on the buddy). When the panel only
  hid (a click somewhere else, or Buddy put text in the app), opening it again from the same app within 5 minutes shows
  the same chat, so "make it shorter" still works. Anything else starts a new chat.
- **Gone:** the three tabs, Formal / Friendly / Short (say "short" or "friendly" in the message), "Use the whole box",
  "New screenshot" and Try again on answers (say "try again").

## 3. How the buddy works out what to do

- One new AI request, `chat`. It carries: the message (≤ 1000 characters); the selection, or the text of the person's
  box on a second step (≤ 8000); the last 6 chat messages (each ≤ 2000); what the buddy knows about the person (§5);
  the app's name and the person's first name; on a second step only, a screenshot.
- The AI answers in JSON:
  `{"kind": "write"|"fix"|"answer"|"box"|"screen"|"send", "say": "…", "text": "…", "notes": ["…"], "doIt": true|false, "send": true|false, "remember": ["…"], "again": true|false}`
  - `send`: with `write` or `fix`, true when the person also asked to send it ("reply and send it").
  - `again`: with `write` or `fix`, true when the text is a new version of the last text the buddy wrote or fixed in
    this chat ("make it shorter"). When that text was put in the app and still has Undo, the new one takes its place.
  - `say`: one or two short friendly sentences to the person, in the language and script they wrote in (Hinglish gets
    Hinglish, in English letters).
  - `text`: the written or fixed text, in English unless the person asked for another language. Never invented facts:
    `[Name]`, `[Date]` placeholders, unless the buddy knows them (§5).
  - `notes`: for `fix`, up to 5 short notes on the mistakes.
  - `doIt`: true when the person told the buddy to do it ("reply to this", "fix my mail", "write it here"); false when
    they asked to see it ("what should I reply?", "how do I say…?").
  - `remember`: new facts about the person from this message (§5); usually empty.
  - `box`: the request is about the text the person is writing in their app and nothing was selected ("fix my
    English", "make it more polite"). Buddy reads everything in that box (the panel steps aside for a moment, as "Use
    the whole box" does today) and asks again with it. Replace then replaces the whole box.
  - `screen`: the request is about something on the screen the buddy has not been given ("what does this mean", "check
    my mail", "reply to this message"). Buddy takes a screenshot of the app's window (on the Mac with the Screen
    Recording permission) and asks again with it.
  - `send`: the person asked to send what the buddy put in the app (§4).
- At most one second step: a `box` or `screen` answer to it shows `I couldn't find it. Select the text and ask me
  again.` Nothing is read from the box or the screen for any other request.
- An answer that is not this JSON is shown as a written answer: the text with Insert and Copy.
- In free mode the first of the two requests is given back: one question costs one free request.
- The old requests (`write`, `fix`, `check`) stay in `shared/prompts.js` and on the server, so older copies of Buddy and
  the Android app keep working.

## 4. Does it in the app

- **`doIt` with text** (`write` or `fix`): Buddy puts the text in the app straight away, the way Insert and Replace do
  today (a selection is replaced; text read from the box replaces the whole box; otherwise it goes in at the cursor).
  The panel stays hidden afterwards, the buddy is happy and its bubble says `Done! It's in Gmail ✅`. Opening the panel
  again shows `✅ Put it in Gmail` with **Undo** and **Copy**.
- **It could not be put in** (no app, a password field, a terminal, an app run as administrator): the text is copied
  and the bubble says `Copied — press ⌘V` (Ctrl+V), as today.
- **Undo** brings the app forward and presses ⌘Z (Ctrl+Z on Windows) once.
- **Sending:** Buddy never sends by itself. When the message asked to send ("reply and send it", or "send it" later),
  the panel shows `Send it?` with **Send** and **Not now**. Send brings the app forward and presses the app's send key;
  the bubble says `Sent ✅`. Send keys are known for: Mail (⌘⇧D), Outlook (⌘↩ / Ctrl+↩), Gmail and Outlook in a browser
  (⌘↩ / Ctrl+↩, told by the window title), WhatsApp, Telegram, Slack, Discord, Teams, Messages, Signal (↩), in the app
  or in a browser tab. Anywhere else: `I don't know how to send in <app>. Press Send yourself.`
- The helper gets two commands: `press` (one allowed key with modifiers, into the app, refused where paste is refused)
  and `windowTitle` (the title of the app's front window).

## 5. Remembers you

- When a message says something useful about the person (their name, job, company, boss, team, city, signature, how
  they like to sign off), the AI puts it in `remember` as a short sentence ("Your boss is Mr. Sharma."). Buddy saves
  it and shows `📝 Remembered: …` with **Undo**.
- Never saved: passwords, PINs, OTPs, CVVs, bank, card or ID numbers. Buddy also refuses any fact with "password",
  "PIN", "OTP" or "CVV" in it, or with 12 or more digits.
- At most 50 facts, each ≤ 200 characters; the oldest goes when there are more; a fact already known is not saved again.
- Saved only on this computer (in Buddy's settings file). They go along with each request so that the AI can use them;
  in free mode they pass through Buddy's server, which never keeps or logs them.
- **Settings → Memory:** "What Buddy knows about you": the list with ✕ on each, a box to add one, **Forget everything**,
  and a switch `Learn about me from chats` (on by default; off, nothing new is saved, and what is saved is still used).

## 6. Voice

As in the one-box design §4 (e8aec99), with these points restated:

- **Engine:** Whisper (`whisper-large-v3-turbo`) on Groq through Buddy's server, `POST /api/transcribe`, with a short
  Hinglish-and-English example sentence as the prompt. The admin's `GROQ_API_KEY` in Vercel turns it on; without it
  `/api/config` says `voiceOn: false`, the panel does not listen, 🎤 says `Voice isn't set up yet.`, and the Admin
  window says `Voice needs GROQ_API_KEY in Vercel.`
- **Who:** anyone signed in and not blocked; not counted as free requests; no recording is kept; only the kind of a
  failure is logged.
- **Listening starts** when the panel opens (Settings → General: `Listen when the panel opens`, on by default), when the
  microphone is allowed and voice is on; 🎤 starts and stops it at any time.
- **While listening:** 🎤 glows, three bars follow the voice, the box says `Listening… speak now`.
- **It ends:** 1.5 s of quiet after speaking → `Writing down what you said…` → the words appear in the box and are sent.
  Nothing said for 8 s → it stops quietly. At most 60 s. Typing, 🎤, Esc or closing the panel stop it, and nothing is
  sent. Only a recording in which a voice was heard is sent. No words back: `I didn't catch that. Try again, or type.`
  Groq's limit: `Voice is busy right now. Type, or try again in a minute.`
- **Audio:** WebM/Opus from the panel, at most 2 MB, base64 in JSON.
- **Microphone:** Mac: a Microphone row in Settings → Permissions; the first 🎤 asks macOS; refused → `Allow the
  microphone in Settings.` with Open Settings; Info.plist `NSMicrophoneUsageDescription` "Buddy listens when you talk to
  it, to write down what you say."; the audio-input entitlement. Windows: blocked → `Turn on the microphone in Windows
  Settings → Privacy & security → Microphone.` with Open Settings.
- **For the buddy's feelings later:** main gets two hooks, `ui.listening(on)` and `ui.voiceLevel(0..1)` (about 10 times a
  second while listening), no-ops for now.

## 7. Like a person

- Moods: `thinking` while it works, `happy` when an answer came or it did something, `sleepy` after a network error,
  `idle` otherwise (only today's moods until the feelings design lands).
- It greets the person by first name; it chats in their language; the text it writes stays English unless asked.
- The bubble beside the buddy says what it did when the panel is hidden: `Done! It's in Gmail ✅`, `Sent ✅`,
  `Copied — press ⌘V`.

## 8. Mobile

The `chat` request, its JSON and the memory rules live in `shared/` and on the server, so the Android app (and the
iPhone app later) get the same answers. What each phone can do in other apps differs (Android: replace selected text;
iPhone: a Buddy keyboard); the phone apps take this up in their own designs.

## 9. Delivery

Two pull requests: (1) the chat panel, does it in the app, remembers you; (2) voice on top of it.

## 10. Testing

- Unit: the `chat` prompt and its reading (all kinds, bad JSON, missing fields, caps); the memory store (caps, refused
  facts, duplicates, the switch); the send-key table; the helper's `press` and `windowTitle` calls; actions: a written
  answer, `doIt` (insert, replace, whole box, copied instead), the `box` and `screen` steps and a second `box`/`screen`,
  remember and its Undo, Undo, Send it? and an unknown app, the resumed chat; panel IPC; the chat view (pure module);
  the server's `chat` (refund on box/screen) and `/api/transcribe`; `voiceOn` in `/api/config`; the voice timing; the
  microphone permission IPC; Settings memory IPC.
- e2e: a written answer → Insert; `doIt` → pasted, panel hidden; a `screen` step; remembered → Settings lists it;
  voice through Chromium's fake microphone.
- Manual: Gmail in Chrome (reply, send), WhatsApp, Mail, Notes, TextEdit; Hindi, English and Hinglish, typed and spoken;
  Windows: Outlook, WhatsApp, Notepad.

## 11. Out of scope

Clicking around in apps by itself, the buddy talking back, noticing mistakes by itself, chat history kept after the
chat ends, memory shared between devices, new moods (the feelings design).
