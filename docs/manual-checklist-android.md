# Manual checklist: Android

What only a real phone can check. Build and install first ("Android" in the
README), with a real `android/cloud.properties`, and use a real Google account.
The free-mode items need the deployed server and the Admin window on the Mac.

## Welcome
- [ ] First launch: the Welcome starts with "Sign in with Google"; Next stays off until you are signed in.
- [ ] Each step asks for what it needs ("Show over other apps", notifications on Android 13+) and Next only goes on once it is given.
- [ ] The last step turns Buddy on: the head appears over the home screen and waves.

## The head
- [ ] Open Gmail, then WhatsApp: the head stays on top of both.
- [ ] Drag it: it follows your finger and snaps to the nearest side on release.
- [ ] It floats and blinks. Check on the 3D head: it looks right, and no light grey square shows behind it (seen once on the emulator, not reproduced).
- [ ] The head hides while Buddy's panel or Fix sheet is open, and comes back with the speech bubble after Copy.
- [ ] Drop the head on the ✕ at the bottom: Buddy turns off and the head goes.
- [ ] The notification's "Turn off" does the same (needs notifications allowed on Android 13+).
- [ ] Turn Buddy on, restart the phone: the head is back. Turn it off, restart: no head.

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
- [ ] Select text in any app → Share → Buddy → the panel opens on Fix with that text.
- [ ] Share a long text and an empty one: no crash; the empty one says there is nothing to fix.

## Check screen
Android asks "share your screen" every time. That is Android's rule.
- [ ] Gmail compose with mistakes → Check screen → choose "A single app" → a picture is taken and Check answers with "Has problems", a list and a corrected version → Copy works.
- [ ] Same with "Entire screen".
- [ ] Say no to the permission: Buddy says so plainly and does not crash.
- [ ] With a model that cannot see images: "This model can't read screenshots. Pick another in Settings." with Open Settings.

## Settings and sign-in
- [ ] Settings shows your name, email and photo. Sign out → the panel says "Sign in to use Buddy." with Open Settings. Sign in again works.
- [ ] Press Cancel on Google's page: Buddy says "You didn't finish signing in with Google. Try again."
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

## Look and battery
- [ ] Light and dark mode both look right: panel, Fix sheet, Settings, Welcome, bubble.
- [ ] Idle for ten minutes with the head showing: `adb shell top -b -n 1 | grep -i buddy` stays near 0% CPU, and Settings → Battery does not list Buddy as a heavy user.
- [ ] The head does not use CPU while the screen is off.
