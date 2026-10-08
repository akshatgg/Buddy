# Manual checklist: Android

What only a real phone can check. Build and install first ("Android" in the
README), with a real `android/cloud.properties`, and use a real Google account.
The free-mode items need the deployed server and the Admin window on the Mac.

## Welcome
- [ ] First launch: the Welcome starts with "Sign in with Google"; Next stays off until you are signed in.
- [ ] Only signing in holds Next back. On "Let Buddy float", Allow opens Android's "Display over other apps" screen (and Android 13+ asks for notifications, or Skip); Next goes on either way.
- [ ] Leave "Display over other apps" off and tap "Start my buddy" on the last step: Buddy goes back to "Let Buddy float" with the note "Let Buddy float: allow Display over other apps." Allow it, then "Start my buddy" works.
- [ ] The last step turns Buddy on: the head appears over the home screen and waves.

## The head
- [ ] Open Gmail, then WhatsApp: the head stays on top of both.
- [ ] Drag it: it follows your finger and snaps to the nearest side on release.
- [ ] It floats and blinks, and the 3D head looks right.
- [ ] No grey square, ever: with the head showing, type on a keyboard (Bluetooth or USB, or the computer's keyboard in the emulator), press Tab and the arrow keys, then open and close the panel. No light grey square shows over or around the head.
- [ ] The head hides while Buddy's panel or a Fix with Buddy chat is open, and comes back with the speech bubble after Copy.
- [ ] Drop the head on the ✕ at the bottom: Buddy turns off and the head goes.
- [ ] The notification's "Turn off" does the same (needs notifications allowed on Android 13+).
- [ ] Turn Buddy on, restart the phone: the head is back. Turn it off, restart: no head.
- [ ] Android 15 or later: after `adb shell am kill com.akshatgg.buddy`, or when Android ends Buddy for memory, the head comes back only when you open the Buddy app.

## The chat
Install over the signed-in Buddy with `adb install -r` (never uninstall: the sign-in is on the phone).
- [ ] Tap the head: the panel shows the buddy's name and the app (`Aarav · WhatsApp`), ⚙︎ and ✕, `Hi <first name>! What should we do?` and the three examples, and the box `Tell me what to do…`.
- [ ] `boss ko mail likho kal chutti chahiye` → send: your message on the right, `Aarav is thinking…`, the head thinks, then an email on the left with Copy and Share (Insert too with "Buddy can type for you" on); the head is happy.
- [ ] A second message while it thinks: the send button is off until the answer comes.
- [ ] `make it shorter`: a shorter version of the same mail (the chat so far went with it).
- [ ] `kal ka matlab kya hai?`: an answer in Hinglish with Copy only.
- [ ] `send it`: "I can't press Send on Android. Press Send yourself."
- [ ] Copy: the panel goes behind the app and the head says "Copied — long-press the box and tap Paste"; paste gives the same text. Share opens Android's share sheet without Buddy in it.
- [ ] `my boss is Mr. Sharma`: `📝 Remembered: …` with Undo (once the memory branch is in); Undo says "Okay, I forgot that."
- [ ] Wi-Fi and mobile data off: a red line "Couldn't reach Buddy's server. Check your internet." with Try again; the head is sleepy. Back online, Try again answers in place of the red line.
- [ ] ✕, Back, or a tap outside the card: the panel closes; the next tap on the head starts a new chat.
- [ ] Rotate the phone with an answer showing: the same chat is there.

## Buddy types for you
With "Buddy can type for you" on (see below).
- [ ] WhatsApp: tap the message box, type `hi`, tap the head, `reply to him that I will come at 5, write it here` → the panel goes away, the text is in the box after `hi`, the head says "Done! It's in WhatsApp ✅" and is happy.
- [ ] Tap the head again (within 5 minutes): the same chat, with `✅ Put it in WhatsApp`, and Undo and Copy on the text. Undo: the box says `hi` again, and the head says "Undone".
- [ ] `make it more polite` right after: the new version takes the old one's place in the box (not added after it).
- [ ] Type `i am go to office tomorow` in Gmail's body, open the panel, `fix my English`: `📖 Read your text`, then the fixed text with Replace; with "fix it here" it goes in at once and replaces the whole box.
- [ ] After more than 5 minutes, or from another app, the head opens a new chat.
- [ ] A password box (a sign-in page): `write my password here` never fills it: the text is copied instead.
- [ ] Turn the service off and ask `fix my English`: "Turn on "Buddy can type for you" in Settings to let me read your box." with Open Settings, which opens Settings at Buddy.
- [ ] Service off, `write a reply here`: the text is copied, the panel goes behind the app, and the head says how to paste it.

## The screen step
Android asks to share your screen every time. That is Android's rule. Buddy asks for the whole screen, so on Android 14+ there is no "A single app" choice.
- [ ] Open a mail in Gmail, the panel, `what does this mean?` → allow it → `👀 Looked at the screen`, then the answer.
- [ ] Say no to Android's question: "I need a picture of your screen for that. Ask me again and allow it."
- [ ] With Buddy off (a Fix with Buddy chat): "I need Buddy on to look at your screen. Turn it on in Settings." with Open Settings.
- [ ] With a model that cannot see images: "This model can't read screenshots. Pick another in Settings." with Open Settings.

## Fix with Buddy
Android lets only some apps list text actions. Where "Fix with Buddy" is missing, use Share → Buddy.
- [ ] Chrome: select text in a page text box → the menu has "Fix with Buddy" → the chat opens with `Your selection: “…”` → send with an empty box → the fixed text with Replace → Replace puts it back in the box and the chat closes.
- [ ] ✕ on the selection card: the next message goes without it.
- [ ] Settings search box: select text → "Fix with Buddy" is in the menu and works.
- [ ] Gmail: if "Fix with Buddy" is not in the menu, that is Android 11+ hiding third-party text actions. Use Share → Buddy.
- [ ] Google Messages and WhatsApp: same. "Fix with Buddy" may be hidden; Share → Buddy works.
- [ ] A read-only text (a web page paragraph): no Replace (Copy and Share; Insert with the service on).
- [ ] A Compose app, and Buddy's own text boxes: no Replace through the app (the service may still put it in).
- [ ] Chrome's address bar: Replace does nothing, because the bar closes when the chat opens. Copy works.
- [ ] After Replace, the clipboard still holds what it held before.

## Share
- [ ] Select text in any app → Share → Buddy → the chat opens with it as the selection; an empty box fixes it.
- [ ] Share a long text (over 8000 characters): "Your selection is too long (over 8000 characters). Press ✕ to leave it out." under the box; no crash.
- [ ] Share again while the chat is open: a new chat with the new text.

## Settings and sign-in
- [ ] Settings shows your initials in a circle, your name and email. Sign out → a message in the panel says "Sign in to use Buddy." with Open Settings. Sign in again works.
- [ ] Press Cancel on Google's page: Buddy says "You didn't finish signing in with Google. Try again."
- [ ] A phone with no Google account: tap "Sign in with Google" and note what Google's picker does. If it offers no way to add one, Buddy says "Add a Google account to this phone, then try again."
- [ ] Restart the phone: still signed in.
- [ ] There is no Admin on the phone.

## Free mode
Set these in the Mac's Admin window, against the deployed server.
- [ ] Unlimited: Settings says "Free AI is on. No key needed." With no key saved, the chat answers.
- [ ] Daily limit 2: the third message says "You've used today's 2 free requests. They come back at midnight."
- [ ] Users may add their own key: with a key saved, the third message still answers; with none, it says to add one, with Open Settings.
- [ ] Blocked: a message says "Your free access is paused."; Unblock and it works again.
- [ ] Free mode off: Settings shows the key form again, and a key saved earlier is still there.
- [ ] The screen step and the box step with free mode on work, and each question counts once (the first step is given back).

## Errors
- [ ] Wi-Fi and mobile data off → a message says "Couldn't reach Buddy's server. Check your internet." and the head looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."
- [ ] With no key saved and free mode off → a message shows an error with Open Settings.

## Buddy can type for you (and look where I type)
- [ ] Settings → Buddy shows "Buddy can type for you" after Size, with "Lets Buddy put its text into the box you are typing in, read that box when you ask, and look at it." and Turn on.
- [ ] Turn on shows the disclosure ("Buddy uses Android's Accessibility to see where the box you are typing in is, so that the head can look at it; to read the text in that box only when you ask Buddy to fix it; …"); Not now closes it and nothing opens; Continue opens Android's Accessibility settings.
- [ ] Android's Accessibility list names it "Buddy can type for you", with the same words in one sentence. Turn it on there, go back: the row says "On. Buddy reads or writes only the box you ask it about, and only when you ask." and Turn off.
- [ ] Turn off opens Android's Accessibility settings; turn it off there, go back: the row says it is off again.
- [ ] With the head showing, tap a text box in WhatsApp, Gmail and Chrome's address bar: the head turns toward it (toward the cursor while typing), easing, never jumping. A box on the other side of the screen turns it the other way; one near the bottom tips it down.
- [ ] Stop typing: about 3 s later the head turns back to the front. Leave the app or open another window: it turns back at once.
- [ ] A password box (a sign-in page): the head does not turn.
- [ ] Typing in Buddy's own panel or a Fix with Buddy chat: the head is hidden, and stays hidden.
- [ ] The head's quarter-second turn toward a box is smooth (30 frames a second while it turns).
- [ ] Battery: type for a few minutes with it on, then idle: `adb shell top -b -n 1 | grep -i buddy` stays near 0% CPU when nobody types, and Settings → Battery does not list Buddy as a heavy user.

## Memory
- [ ] Settings shows "What Buddy knows about you" after the Buddy part, with "Buddy learns these from your chats. They stay on this phone." and, on a new install, "Nothing yet. Tell Buddy about yourself in a chat, or add something here."
- [ ] Type "My boss is Mr. Sharma." in the add box and tap Add (or Done on the keyboard): it shows in the list, the box empties, and "Saved ✓" shows for a few seconds. Add stays off while the box is empty.
- [ ] Add "my boss is mr. sharma." again: "I already know that." Add "My ATM PIN is 1234." or a 16-digit card number: "I can't save that. Passwords, PINs, OTPs and long numbers are never saved." and the text stays in the box.
- [ ] The box takes no more than 200 characters (paste a long text: it is cut).
- [ ] ✕ on a fact forgets it at once. TalkBack reads it as "Forget: …".
- [ ] Forget everything (shown only when there is something) asks "Forget all N things?" ("Forget the 1 thing?" for one). Cancel, or tapping outside, keeps them; Forget empties the list and says "Buddy forgot everything."
- [ ] "Learn about me from chats" is on on a new install. Turn it off: "Saved ✓"; force-stop the app and open it again: still off. With it off, a fact typed in Settings is still saved.
- [ ] With the chat panel: tell Buddy "my boss is Mr. Sharma": the chat says "📝 Remembered: …" and the fact shows in Settings (open Settings meanwhile: it appears without leaving). With learning off, nothing new is saved from a chat, and what is known is still used.
- [ ] The facts are not on the Mac, and the Mac's are not here: memory stays on each device.
- [ ] Force-stop the app and restart the phone: the facts are all still there, oldest first.

## Voice
- [ ] First press of 🎤 in the panel: Android asks for the microphone. Allow: 🎤 turns into ■ and Buddy records.
- [ ] Refused (or "Don't allow" chosen earlier): "Buddy needs the microphone to hear you. Allow it in Settings." with Open Settings, which opens Buddy's page in Android's settings; allow it there, go back, and 🎤 records.
- [ ] Without GROQ_API_KEY in Vercel (`/api/config` says `voiceOn: false`): 🎤 says "Voice isn't set up yet." and nothing records.
- [ ] Say a Hinglish sentence ("Kal mujhe chutti chahiye, please write a mail to my boss"), press ■: a small spinner, then the words appear in the box in English letters, not sent until you send them.
- [ ] Say nothing and press ■ at once: "I didn't catch that. Try again, or type."
- [ ] Keep talking: at 60 s it stops by itself and the words appear as with ■.
- [ ] Close the panel while recording: the microphone stops (the green dot goes away) and nothing appears.
- [ ] Wi-Fi and mobile data off, then ■: "Couldn't reach Buddy's server. Check your internet."
- [ ] No recording is left: after each of the above, `adb shell run-as com.akshatgg.buddy ls cache` shows no `voice-*.m4a`.

## Look and battery
- [ ] Light and dark mode both look right: the chat (messages, red lines, the selection card), Settings, Welcome, bubble.
- [ ] Idle for ten minutes with the head showing: `adb shell top -b -n 1 | grep -i buddy` stays near 0% CPU, and Settings → Battery does not list Buddy as a heavy user.
- [ ] The head does not use CPU while the screen is off.
