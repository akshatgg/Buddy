# "Hey Buddy, message Rahul on WhatsApp": hands-free messages

Date: 2026-10-15. Asked by the owner: "If I say hey buddy just open the WhatsApp and message friends … not picking my
phone, so it will do it", and "if I say the name of the buddy it will also listen, like hey rahul, whatever the name I
put". Approved: "so do it".

Decisions the owner made:

- **Devices:** Android and Mac, together. (Windows and iPhone later.)
- **Before sending:** Buddy says the message out loud and asks "Send it?"; it sends only on "yes".
- **Wake word:** free, on the device. It is "Hey" + the buddy's own name from Settings (`buddyName`), so a buddy named
  Rahul wakes on "Hey Rahul", and a rename takes effect at once.

## What the person sees

1. The phone is on the table (or the Mac is open). They say: **"Hey Rahul, message Priya on WhatsApp: I'm running
   late."** Hindi and Hinglish work too ("Hey Rahul, Priya ko WhatsApp karo ki main late hoon").
2. The buddy shows its listening face, and records until they stop talking.
3. Buddy opens WhatsApp in Priya's chat with the text in the box, and says out loud: **"To Priya Sharma: I'm running
   late. Send it?"**
4. **"Yes"** (or "haan", "send") → Buddy presses Send and says **"Sent."** **"No"** (or "nahi", "cancel"), or 8 seconds
   of nothing → Buddy says "Okay, not sent." The text stays in WhatsApp's box, unsent.

The same message can be typed into the chat panel ("message Priya on WhatsApp I'm late"). Then the panel shows the
card **To Priya Sharma: I'm running late [Send] [Cancel]** instead of asking out loud.

## Changes after reading the code (2026-10-15, same day)

- **Ask first, then open.** Buddy finds the person, asks "To Priya Sharma: … Send it?", and only on yes opens the chat,
  checks its name, puts the text in and presses Send, in one go. Nothing is left half-done in WhatsApp when the answer
  is no. This replaces "opens WhatsApp … then says" in step 3 above.
- **"Which Priya?" is answered in words**, typed or said ("Priya Sharma"), not with buttons. The words go back to the
  brain like any message, which gives a fuller name.
- **Android finds the number through WhatsApp's own contact rows** (`ContactsContract.Data` with mime type
  `vnd.android.cursor.item/vnd.com.whatsapp.profile`, or `…w4b.profile` for WhatsApp Business). Their `data1` is
  `<number>@s.whatsapp.net`, so no number formatting is needed.
- **Mac WhatsApp, found on the owner's Mac (WhatsApp 26.41):** the search box is `TokenizedSearchBar_TextView`, chat
  list rows are buttons inside `ChatListView_TableView` whose description starts with the chat name, the open chat's
  name is the description of `NavigationBar_HeaderViewButton`, and the message box is `ChatBar_ComposerTextView`. With
  its window closed, the menu item WhatsApp → "Open main window" brings it back. Descriptions start with U+200E (a
  left-to-right mark), which is stripped.
- **Locked phone or Mac moves to PR 2.** In PR 1 the person is typing in the panel, so the device is unlocked.

## Three pieces, three PRs

Each PR works on its own and ships in a release.

| PR | What it adds | Usable how |
|---|---|---|
| 1 | The `message` action: find the chat, put the text in, Send/Cancel card | Typed in the chat panel |
| 2 | Talking back + yes/no by voice | The panel's 🎤, then hands-free from there |
| 3 | The wake word "Hey <name>" | Fully hands-free |

## 1. The `message` action (PR 1)

### The brain

`shared/prompts.js`: `KINDS` gets `'message'`. A message answer is
`{ kind: 'message', app: 'whatsapp', to: 'Priya', text: "I'm running late", say }`:

- `to` is the name as the person said it. `text` is the message in the language they asked for. Buddy fixes the
  English only when they asked it to ("in good English").
- `app` is only `'whatsapp'` for now. When they name another app, the answer is `kind: 'answer'` with "I can only
  message on WhatsApp for now."
- `parseChat` checks the new fields: an empty `to` or `text` turns it into an `answer` asking for the missing part
  ("Who should I send it to?").
- `SYSTEM.chat` gets a short rule for when to answer `message`: they ask to message, text or tell someone something on
  WhatsApp.
- Android reads the same rules through `shared.json` (`tools/sync-android-shared.js`), and its parse
  (`ai/ChatPrompt.kt`) learns the same kind. The prompt tests on both sides cover the new kind.

### Android: find the friend through the phone's contacts

New `message/` package:

- **`WhatsAppContacts`** asks Android's contacts (`ContactsContract`) for people whose name contains `to`, and keeps
  only those with a WhatsApp number (a raw contact of account type `com.whatsapp`). Matching ignores case and accents.
  An exact first name or full name ranks first.
  - **One match:** use it.
  - **2–4 matches:** ask "Which Priya: Priya Sharma or Priya Verma?" The person says the surname, or "the first one".
    Typed in the panel, these are buttons.
  - **More than 4, or none:** "I couldn't find Priya on WhatsApp in your contacts."
  - The number is made full with Android's `PhoneNumberUtils.formatNumberToE164(number, simCountry)`.
- This needs the **Contacts** permission. Buddy asks for it the first time a message is needed, with one line saying
  why. Saying no gives "I need your contacts to find Priya. You can allow it in Settings."
- **`WhatsAppOpener`** opens `https://api.whatsapp.com/send?phone=<E164>&text=<text>` with `setPackage("com.whatsapp")`.
  If that app is not there, it uses `com.whatsapp.w4b` (WhatsApp Business). With neither: "WhatsApp isn't on this
  phone."
- **`LookService`** (the Accessibility service Buddy already has) learns two things for WhatsApp only:
  - Read the open chat's name (the header node, `com.whatsapp:id/conversation_contact_name`).
  - Press Send (`com.whatsapp:id/send`, or else the node whose description is "Send").
  - Before pressing Send, it checks that the chat name is the chosen contact. If it is not, Buddy does not send:
    "That opened the wrong chat, so I didn't send it."
  - If the Accessibility service is off, the text is still in the box: "It's ready in WhatsApp. Turn on Buddy in
    Accessibility so I can press Send for you."
- **Locked phone** (`KeyguardManager.isKeyguardLocked`): "Unlock your phone and I'll send it to Priya." Buddy waits up
  to 60 s for `ACTION_USER_PRESENT`, then carries on. After that it gives up: "I didn't send it."

### Mac: search inside WhatsApp

The person's contacts are usually not on the Mac, so Buddy uses WhatsApp's own search:

1. Open or bring forward the WhatsApp app (`net.whatsapp.WhatsApp`, through the helper).
2. Press WhatsApp's search keys, type `to`, and open the first result.
3. Read the open chat's name with Accessibility. This is a new helper command in `src/native/BuddyHelper.swift` (the
   header text of WhatsApp's chat view).
4. If the name does not contain `to` (ignoring case), stop: "I couldn't find Priya in WhatsApp." Nothing is typed.
5. Paste `text` into the message box (the paste path Buddy already uses) and wait for the yes.
6. "Yes" presses Enter, as `src/main/send-keys.js` already knows for WhatsApp.

- The exact keys for search, and the Accessibility path to the chat header, are found on the owner's Mac in the first
  task of the plan. They are kept in one table in a new `src/main/whatsapp-mac.js`, so a WhatsApp update means
  changing one place.
- WhatsApp Web in a browser is not used for this. If the desktop app is not installed: "Install WhatsApp for Mac and
  I can message from here."
- Mac locked or asleep: "Unlock your Mac and I'll send it." It waits 60 s, as on Android.

### In the chat panel (both devices)

A `message` answer shows a card: **To <full name>: <text>**, with **[Send]** and **[Cancel]** buttons. Send runs the
steps above. A wrong-chat or no-contact result shows as Buddy's reply in the chat. The panel never sends without the
Send button.

## 2. Talking back and yes/no by voice (PR 2)

- **Speaking:** Android uses `TextToSpeech`. The Mac uses `speechSynthesis` in a small hidden window (the "ear" window,
  below), with the system's voice. Buddy speaks only in the voice flow, never for typed chats.
- **The voice flow:** after a recording (today the panel's 🎤, from PR 3 also the wake word), the words go to the brain
  as a chat message. For a `message` answer the flow goes: find the chat, then say "To X: … Send it?", then listen for
  the answer.
- **Hearing yes/no:** on the device, with the same Vosk recognizer as the wake word, limited to a short word list:
  yes, yeah, haan, ha, send, okay / no, nahi, na, cancel, don't, stop. If it hears none of them in 8 s, that counts as
  no. No server call is made, so the answer is quick and works on slow internet.
- Other answers keep working as today: Buddy says `say` out loud and shows the reply in the panel.
- PR 2 is where Vosk and its model first come in (see section 3). PR 3 only adds the always-on listening.

## 3. "Hey <name>" (PR 3)

### The recognizer

- **Vosk** (Apache 2.0), offline, with the small Indian-English model `vosk-model-small-en-in` (about 36 MB).
  - Android: `com.alphacephei:vosk-android`.
  - Mac: `vosk-browser` (WebAssembly) in the hidden ear window, which uses `getUserMedia`.
- The model is **not** in the installers. It downloads in the background the first time Buddy asks "Send it?" out loud,
  or when the wake-word switch is turned on. It comes from a Buddy GitHub release asset (so Buddy does not depend on
  someone else's server) and is checked against a SHA-256 that is fixed in the code. Until it is there, the yes/no
  answer is recorded and written down by `/api/transcribe` instead, then matched against the same word list.
- The recognizer runs with a **grammar**: only `"hey <name>"` and `[unk]` (anything else). Vosk matches only those
  words, so the name typed in Settings works at once, with no training and no recordings.
- **The name:** `buddyName`, lowercased, letters and spaces only, at most 3 words. If a word is not in the model's word
  list (shipped as `words.txt` with the model), Settings says: "Buddy can't listen for 'Xyzzy'. Try another spelling."
  The wake word stays off until the name works.
- **"Hey" is required**, so the name said in a normal conversation does not wake Buddy. A wake is accepted only on a
  final result that is exactly the phrase. The confidence floor is tuned with the owner's recordings (see Testing).
- After a wake, the same microphone stream records the request until 1.2 s of silence (at most 20 s), and the
  recording goes to `/api/transcribe` as today.

### Settings

- **Listen for "Hey <name>"**: a switch, off by default. The line under it says: "Your microphone stays on. Nothing
  leaves this device until you say 'Hey <name>'."
- **Test it**: listens for 10 s and shows "Heard you ✓" for each wake.
- A rename updates the switch's label and the grammar at once.

### Android

- `BubbleService` gets `foregroundServiceType` **`microphone`** added (and `FOREGROUND_SERVICE_MICROPHONE`). The
  switch can only be turned on with the app open. That is Android's rule for starting the microphone.
- After the phone restarts, Android does not let a service start the microphone by itself (`BootReceiver` cannot), so
  the bubble shows "Tap me to listen again" until Buddy is opened once.
- The microphone is shared: while another app records or is in a call, Buddy stops listening and starts again after.
- Android shows its green mic dot while listening. This cannot be hidden.

### Mac

- The ear window is hidden, has no taskbar entry, and is made only while the switch is on. The Mac shows its orange
  mic dot while listening.
- It pauses while the Mac is locked or asleep (`powerMonitor`) and while the panel's own 🎤 is recording.

### Battery and CPU

The grammar keeps Vosk's search small. The target is under 5% of one core on the owner's Mac and under 4% battery per
hour on the owner's phone, measured in the plan. If either is missed, a cheap voice check (only start Vosk on sound
above the room's noise level) is added before shipping.

## Errors, all said out loud in the voice flow

| When | Buddy says |
|---|---|
| No internet (transcribe or brain) | "I can't reach the internet right now." |
| Didn't catch the request | "I didn't catch that. Say 'Hey <name>' and try again." |
| Contact not found / too many | "I couldn't find Priya on WhatsApp in your contacts." |
| Contacts permission refused | "I need your contacts to find Priya. You can allow it in Settings." |
| WhatsApp not installed | "WhatsApp isn't on this phone." / "Install WhatsApp for Mac and I can message from here." |
| Locked | "Unlock your phone and I'll send it to Priya." |
| Wrong chat opened | "That opened the wrong chat, so I didn't send it." |
| No yes in 8 s | "Okay, not sent." |
| Accessibility off (Android) | "It's ready in WhatsApp. Turn on Buddy in Accessibility so I can press Send for you." |
| Free mode used up / no key | The chat's existing message for it, spoken. |

## Privacy

- Nothing is recorded or sent before the wake phrase. The wake check runs on the device.
- After the wake, the request recording goes to Buddy's server for transcribing, exactly as the 🎤 does today. It is
  not kept.
- Contacts are read on the phone only, to find the one person. No contact list leaves the phone, and none is
  remembered.
- Buddy never sends without a clear yes (spoken or the Send button).

## Testing

- **Unit (Node):** `parseChat` for `message` (missing `to`/`text`, other apps); the yes/no word matcher; the name →
  grammar and word-list check; the voice flow state machine (wake → record → brain → find → ask → yes/no/timeout →
  send), with fakes for every device part.
- **Unit (Android, JVM):** contact matching and ranking, E.164, the choose-one question, the opener's URL and fallback,
  the LookService chat-name check and Send press against recorded WhatsApp node trees, and the locked wait.
- **Mac e2e:** the panel's message card with a fake helper (Send/Cancel, wrong chat, not installed).
- **Wake word:** the owner records "Hey <name>" 20 times and 10 minutes of normal talk and TV, on each device. The
  target is at least 18/20 heard and at most 1 false wake per hour of talk. These recordings stay local and are not
  committed.
- **Real check, on the owner's devices with a test contact:** the full flow on Android (unlocked, locked, Accessibility
  off) and on the Mac. This is the gate before each PR is merged, because a real message is sent.

## Not in this

Windows, iPhone, other apps (Telegram, SMS, calls), reading messages out loud, voice replies to Buddy's other answers
beyond `say`, and sending without a yes.
