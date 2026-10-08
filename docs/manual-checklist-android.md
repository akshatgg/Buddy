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
- [ ] The head hides while Buddy's panel or Fix sheet is open, and comes back with the speech bubble after Copy.
- [ ] Drop the head on the ✕ at the bottom: Buddy turns off and the head goes.
- [ ] The notification's "Turn off" does the same (needs notifications allowed on Android 13+).
- [ ] Turn Buddy on, restart the phone: the head is back. Turn it off, restart: no head.
- [ ] Android 15 or later: after `adb shell am kill com.akshatgg.buddy`, or when Android ends Buddy for memory, the head comes back only when you open the Buddy app.

## Write
- [ ] Tap the head → Write → `boss ko mail likho kal chutti chahiye` → Write → an email comes back.
- [ ] Copy → the speech bubble shows; paste into Gmail or WhatsApp gives the same text.

## Fix with Buddy
Android lets only some apps list text actions. Where "Fix with Buddy" is missing, use Share → Buddy.
- [ ] Chrome: select text in a page text box → the menu has "Fix with Buddy" → the sheet shows the fixed text → Replace puts it back in the box.
- [ ] Settings search box: select text → "Fix with Buddy" is in the menu and works.
- [ ] Gmail: if "Fix with Buddy" is not in the menu, that is Android 11+ hiding third-party text actions. Use Share → Buddy.
- [ ] Google Messages and WhatsApp: same. "Fix with Buddy" may be hidden; Share → Buddy works.
- [ ] A read-only text (a web page paragraph): the sheet offers Copy only.
- [ ] A Compose app, and Buddy's own text boxes: the sheet offers Copy, not Replace.
- [ ] Replace appears only in apps that wait for the fixed text (most View-based text boxes).
- [ ] Chrome's address bar: Replace does nothing, because the bar closes when the sheet opens. Copy works.
- [ ] After Replace, the clipboard still holds what it held before.

## Share
- [ ] Select text in any app → Share → Buddy → the Fix sheet opens with that text fixed, and offers Copy only.
- [ ] Share a long text and an empty one: no crash; the empty one says there is nothing to fix.

## Check screen
Android asks to share your screen every time. That is Android's rule. Buddy asks for the whole screen, so on Android 14+ there is no "A single app" choice.
- [ ] Gmail compose with mistakes → Check screen → allow it → a picture is taken and Check answers with "Has problems", a list and a corrected version → Copy works.
- [ ] Say no to the permission: Buddy says so plainly and does not crash.
- [ ] With a model that cannot see images: "This model can't read screenshots. Pick another in Settings." with Open Settings.

## Settings and sign-in
- [ ] Settings shows your initials in a circle, your name and email. Sign out → the panel says "Sign in to use Buddy." with Open Settings. Sign in again works.
- [ ] Press Cancel on Google's page: Buddy says "You didn't finish signing in with Google. Try again."
- [ ] A phone with no Google account: tap "Sign in with Google" and note what Google's picker does. If it offers no way to add one, Buddy says "Add a Google account to this phone, then try again."
- [ ] Restart the phone: still signed in.
- [ ] There is no Admin on the phone.

## Free mode
Set these in the Mac's Admin window, against the deployed server.
- [ ] Unlimited: Settings says "Free AI is on. No key needed." With no key saved, Write works.
- [ ] Daily limit 2: the third Write says "You've used today's 2 free requests. They come back at midnight."
- [ ] Users may add their own key: with a key saved, the third Write still answers; with none, it says to add one, with Open Settings.
- [ ] Blocked: Write says "Your free access is paused."; Unblock and it works again.
- [ ] Free mode off: Settings shows the key form again, and a key saved earlier is still there.
- [ ] Check screen with free mode on works.

## Errors
- [ ] Wi-Fi and mobile data off → Write says "Couldn't reach Buddy's server. Check your internet." and the head looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."
- [ ] With no key saved and free mode off → Write shows an error with Open Settings.

## Look where I type
- [ ] Settings → Buddy shows "Look where I type" after Size, with "The head turns toward the box you type in, in any app." and Turn on.
- [ ] Turn on shows the disclosure ("Buddy uses Android's Accessibility only to see where the text box you are typing in is…"); Not now closes it and nothing opens; Continue opens Android's Accessibility settings.
- [ ] Android's Accessibility list names it "Buddy: look where I type", with the same sentence. Turn it on there, go back: the row says "On. Buddy sees only where the box is, never what you type." and Turn off.
- [ ] Turn off opens Android's Accessibility settings; turn it off there, go back: the row says it is off again.
- [ ] With the head showing, tap a text box in WhatsApp, Gmail and Chrome's address bar: the head turns toward it (toward the cursor while typing), easing, never jumping. A box on the other side of the screen turns it the other way; one near the bottom tips it down.
- [ ] Stop typing: about 3 s later the head turns back to the front. Leave the app or open another window: it turns back at once.
- [ ] A password box (a sign-in page): the head does not turn.
- [ ] Typing in Buddy's own panel or Fix sheet: the head is hidden, and stays hidden.
- [ ] Battery: type for a few minutes with it on, then idle: `adb shell top -b -n 1 | grep -i buddy` stays near 0% CPU when nobody types, and Settings → Battery does not list Buddy as a heavy user.

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
- [ ] Light and dark mode both look right: panel, Fix sheet, Settings, Welcome, bubble.
- [ ] Idle for ten minutes with the head showing: `adb shell top -b -n 1 | grep -i buddy` stays near 0% CPU, and Settings → Battery does not list Buddy as a heavy user.
- [ ] The head does not use CPU while the screen is off.
