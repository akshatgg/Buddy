# Manual checklist

Phase 1 is the sections from The chat panel to Look and feel (the chat panel replaced the three tabs). Phase 2 is the section
"Phase 2: sign-in and free mode". The section "Settings: the sidebar and the
shortcut recorder" is the Settings polish, "Single-key shortcut" is the shortcut
that is one key tapped on its own, and the last one, "Feelings", is the buddy's
feelings: sleep, petting, shaking, sad, celebrate and listening.

Run Phase 1 before calling it done, and again after any change to
`src/native/`, `src/main/actions.js` or the panel. Run it with the installed
Buddy.app (`npm run dist:mac`, then "Install on your Mac" in the README), and use
a real API key. Accessibility and Screen Recording go to Buddy, not to your
terminal.

## Connect an AI
- [ ] Welcome → Connect an AI shows all four AIs; paste a Gemini key while Claude is chosen → Save key switches to Google Gemini and lists Gemini models.

## The chat panel
- [ ] Open the panel → it greets you by your first name ("Hi Akshat! What should we do?") and the box has the keyboard.
- [ ] TextEdit: select `i am go to market yesterday`, open the panel → the selection card shows it → press ↩ in the empty box → the fix replaces the selection, the panel stays hidden, the bubble says "Done! It's in TextEdit ✅".
- [ ] Open the panel again within 5 minutes → the same chat, with "✅ Put it in TextEdit" and Undo → Undo puts the old text back.
- [ ] TextEdit, empty line: `boss ko mail, kal chutti chahiye` → the mail goes in at the cursor (or, if the AI only shows it, Insert puts it there).
- [ ] Then `make it shorter` → the shorter mail takes the place of the first one (not a second copy).
- [ ] `what does "per my last email" mean?` → an answer with Copy only; nothing goes into the app. In Hinglish (`iska matlab kya hai`) the answer is in Hinglish.
- [ ] Gmail in Chrome, nothing selected, a draft with mistakes: `fix my English` → "📖 Read your text in Google Chrome" → the whole draft is replaced. Same in Safari.
- [ ] Gmail, a received mail open: `reply to this` → "👀 Looked at Google Chrome" → a reply. With the cursor in the reply box it goes in; with the cursor on the mail itself, it is copied ("Copied — press ⌘V") and Buddy does not say "Done!".
- [ ] `reply and send it` in WhatsApp Desktop → the reply goes in, then "Send it?" → Send → it is sent, the bubble says "Sent ✅", and Undo is gone. Not now → nothing is sent.
- [ ] Mail: write a reply, then `send it` → Send → Mail sends it (⌘⇧D). In an app Buddy doesn't know (Notes) → "I don't know how to send in Notes. Press Send yourself."
- [ ] Ask something, then click somewhere else while Buddy is thinking → nothing is typed into the app; the bubble says "Your answer is ready. Open me to see it."
- [ ] ✕ or Esc ends the chat: opening the panel again starts a new one. A click on the buddy does the same.
- [ ] After each paste, the clipboard still holds what it held before.
- [ ] Copy an image (in Preview or Finder), open the panel with nothing selected and close it, then paste in Notes → the image is still on the clipboard.

## Remembers you
- [ ] `mail to my boss Mr. Sharma, kal chutti chahiye` → "📝 Remembered: Your boss is Mr. Sharma." → the mail is to Mr. Sharma. Undo on that line forgets it.
- [ ] A new chat: `boss ko mail, I'm sick today` → the mail is to Mr. Sharma, with no [Name].
- [ ] Settings → Memory lists it; ✕ removes it; Add saves one by hand; "Forget everything" asks once more, then empties the list.
- [ ] `my ATM PIN is 4321` → nothing is remembered. Adding "My card number is 4111 1111 1111 1111" in Settings is refused.
- [ ] "Learn about me from chats" off → a chat saves nothing new, and what is saved is still used.

## Voice
- [ ] The first 🎤 (or the first opening with "Listen when the panel opens" on) → macOS asks for the microphone, the panel stays open → Allow → it listens.
- [ ] Say `boss ko mail likho, kal chutti chahiye` and stop → "Writing down what you said…" → the words appear and are sent. Also in English, and in Hindi.
- [ ] Say nothing → it stops quietly after about 8 seconds. Type a letter while it listens → it stops and nothing is sent.
- [ ] Settings → General → "Listen when the panel opens" off → the panel doesn't listen until 🎤 is pressed.
- [ ] Microphone refused in System Settings → 🎤 → "Allow the microphone in Settings." with Open Settings → Settings → Permissions shows the Microphone row.
- [ ] Without GROQ_API_KEY on the server → 🎤 → "Voice isn't set up yet."; the Admin window says "Voice needs GROQ_API_KEY in Vercel."

## Safety and errors
- [ ] Cursor in a password field in Safari, in Chrome and in one native app (Notes → Lock Note asks for a password),
  open the panel → "I don't read password fields." and nothing is read.
- [ ] With the cursor still in that native password field, ask the panel to write something → it copies the answer ("Copied — press ⌘V") and types nothing into the field.
- [ ] Accessibility switched off for Buddy, then Insert → "Copied — press ⌘V" and the text is on the clipboard.
- [ ] Wi-Fi off → send a message → "Couldn't reach …" with Try again; the buddy looks sad for a moment.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."
- [ ] With no key saved, and again with a wrong key → send a message → the error comes with an "Open Settings" button; it opens Settings, and the panel steps aside.

## Always on
These apply to the installed Buddy.app: a development run never adds a login item.
- [ ] System Settings → General → Login Items: no stray "Electron" item from earlier development runs (remove it by hand if there is one).
- [ ] Buddy on → restart the Mac → the buddy is back, waving.
- [ ] Buddy off (menu bar → Turn off buddy) → restart → no buddy, and no Buddy login item.
- [ ] Turn off buddy → ⌥Space does nothing; turn it on → ⌥Space works again.
- [ ] With Buddy off, record a shortcut in Settings → Shortcut that another app owns → "⌥ … is taken. Try another one." (its keys first, e.g. "⌃ ⌥ K is taken. Try another one.") and nothing changes.
- [ ] ⌘Q while the panel is open does nothing; menu bar → Quit quits Buddy.
- [ ] In the panel's text boxes ⌘C, ⌘V, ⌘Z and ⌘A work. ⌘W closes Settings (and the Welcome window); in the panel it does nothing.
- [ ] After a rebuild and reinstall, Accessibility may need to be switched off and on again for Buddy; then Fix works.

## Look and feel
- [ ] Floats and blinks; the head follows the pointer; dragging snaps to the side; clicks beside the character reach the app underneath.
- [ ] Visible over a full-screen app and on every desktop (Space).
- [ ] Buddy's processes stay at a few % CPU while idle (Activity Monitor).
- [ ] Light and dark mode both look right (panel, Settings, Welcome, bubble).

## Phase 2: sign-in and free mode
Run with the installed Buddy.app built with a real `cloud.json`, against the deployed server.
- [ ] First launch: the Welcome starts with "Sign in with Google"; Next stays off until you are signed in; the browser tab says "Almost done" and "You can close this tab. Buddy is finishing signing you in."
- [ ] Press Sign in, close the Google tab, press Sign in again: a new Google page opens and signing in there works.
- [ ] Press Cancel on Google's page: Buddy says "You didn't finish signing in with Google. Try again." in the Welcome and in Settings.
- [ ] Settings: the profile at the top of the sidebar shows your name and email. Sign out (at the bottom of the sidebar) → the panel says "Sign in to use Buddy." with Open Settings. Sign in again works.
- [ ] Restart the Mac: still signed in.
- [ ] Signed in as akshatg9636@gmail.com, the menu bar has "Admin…"; signed in with another Google account, it does not.
- [ ] Sign in with a second Google account: no Admin… item in the menu bar, and the Admin window cannot be opened.
- [ ] Admin → Free mode on, Unlimited, Save. Reopen Settings: the AI card says "Free AI is on. No key needed." With no key saved, a chat in Gmail (`boss ko mail, kal chutti chahiye`) works.
- [ ] Admin → Daily limit 2, Save. The third Write says "You've used today's 2 free requests. They come back at midnight."
- [ ] Admin → also let users add their own key. With a key saved, the third Write still answers; with none, it says to add one, with Open Settings.
- [ ] Admin → Users lists you, and "Today" counts up. Block → Write says "Your free access is paused."; Unblock → it works again.
- [ ] Block yourself while signed in as the admin, then Unblock: the Admin window keeps working (blocking stops free answers only).
- [ ] Admin → Free mode off, Save. Settings shows the key form again, and a key saved earlier is still there.
- [ ] `what does this mean?` with a mail open, free mode on → Buddy looks at the screen and answers (the free model can read screenshots); it costs one free request, not two.
- [ ] Wi-Fi off with free mode on: send a message → a red line in the chat says "Couldn't reach Buddy's server. Check your internet.", with Try again, and the buddy is sad for a moment, then idle.
- [ ] With the server deliberately broken (for example FIREBASE_SERVICE_ACCOUNT removed and redeployed), using Buddy shows a server problem and nobody is signed out; put it back and redeploy.
- [ ] Firestore console: users/{uid} holds only email, name, joined, lastActive, blocked, usedDay and usedCount — no text.

## Settings: the sidebar and the shortcut recorder
Run with the installed Buddy.app, signed in with a real Google account. The keys are pressed for real.
- [ ] Settings → Shortcut, click the box: while it says "Press your shortcut…", ⌥ Space doesn't open the panel; Esc gives up and ⌥ Space works again.
- [ ] Hold ⇧ and ⌘ while it waits: they show as key caps, followed by a dashed cap; let go of them and it says "Press your shortcut…" again.
- [ ] ⌘ Space: Spotlight usually takes it first, and the box keeps waiting; if it reaches the box, it is refused ("⌘Space is used by every app (Spotlight). Pick another one."). Either way the shortcut stays ⌥ Space.
- [ ] ⌘C → "⌘C is used by every app (Copy). Pick another one." and the box keeps waiting; Esc → the line goes, and the box is not red.
- [ ] ⇧⌘B → "Saved ✓". In TextEdit, ⇧⌘B opens the panel and ⌥ Space no longer does. Reset to ⌥ Space → ⌥ Space opens it again; Reset once more says "Already ⌥ Space."
- [ ] The sidebar shows your Google photo, round. (Signed in before photos were kept, it shows your initials until you sign in again.)
- [ ] Sign out at the bottom of the sidebar → "Not signed in", and Sign in with Google in its place; Sign in with Google → finish in the browser → back in Settings, your name, email, photo and Sign out. The button doesn't jump when a line appears under it.
- [ ] Every window in light and dark mode (System Settings → Appearance): Settings (each section), the Welcome (each step), Admin, the panel (empty, a long chat, an error, "Send it?", listening) and the bubble.

## Releases and Update now

- [ ] Pushing a tag `vX.Y.Z` runs Actions → Release; every job is green and the release has `Buddy-arm64.dmg`, `Buddy-Setup-x64.exe`, `latest-mac.yml` and `latest.yml`.
- [ ] The website's Download for Mac gives `Buddy-arm64.dmg` of that release.
- [ ] With an older Buddy installed in Applications, opening it shows "Buddy X.Y.Z is available" once; Update now downloads, quits, swaps the app and opens the new one (Settings → General shows the new version).
- [ ] After that update, Settings opens on Permissions with the "Buddy was updated" note; Allow, switch Buddy on in System Settings, and copy/paste work again.
- [ ] The menu bar menu shows "Update now (Buddy X.Y.Z)" while a newer version is out, and "Updating… N%" after it is pressed.
- [ ] Check now with no internet says "Could not reach GitHub…" in plain words; switching off "Check for updates automatically" stops the launch dialog.
- [ ] Buddy run from the mounted DMG (not Applications) offers Download instead of Update now.

## Single-key shortcut

- [ ] Settings → Shortcut: click the box and tap Right ⌥ on its own → saved as "Right ⌥", with the note "Tap it on its own to open your buddy: press and let go, with no other key."
- [ ] In TextEdit, tap Right ⌥ → the panel opens; tap it again → it closes.
- [ ] Hold Right ⌥ for a second and let go → nothing. Type ⌥ with a letter (a special character) → nothing. ⌥-click → nothing. Tap Left ⌥ → nothing.
- [ ] A volume, brightness or play key, and scrolling, spoil a tap like any other key: with Right ⌥ recorded, ⌥ + volume up and ⇧ ⌥ + volume change the volume and do not open Buddy; with fn recorded, fn + F12 does not; with ⌃ or ⌥ recorded, ⌃- or ⌥-scrolling does not. A tap while a page is still gliding after a flick-scroll still opens Buddy.
- [ ] Record Left ⌘: ⌘C, ⌘V and ⌘-click in other apps never open Buddy; a ⌘ tap does.
- [ ] Record ⇧ and ⌘ tapped together → "Left ⇧ Left ⌘"; tapping both opens Buddy, ⇧ alone or ⌘ alone does not.
- [ ] Record fn → "fn" and the note about emoji and dictation; tapping fn opens Buddy (after setting "Press 🌐 key to" to "Do Nothing" if macOS opens emoji instead).
- [ ] With "Press 🌐 key to: Show Emoji & Symbols", click the box and tap fn: it is still saved as "fn" (the emoji picker may open and take the focus; close it), and the note says how to turn that off.
- [ ] Record Caps Lock → "⇪ Caps Lock" and its note; each press opens or closes Buddy once, and capitals toggle as the note says.
- [ ] While recording, press ⌘ and B together → saved as "⌘ B", not as a ⌘ tap.
- [ ] Buddy has Accessibility but is not in System Settings → Privacy & Security → Input Monitoring: the single key still works (macOS lets an app with Accessibility listen to the keys).
- [ ] With Buddy's Accessibility off, click the Shortcut box: the line under it says "Buddy needs Accessibility to hear a key tapped on its own. Allow it in Permissions.", and ⇧ ⌘ B can still be recorded.
- [ ] With a single key saved and working, turn Buddy's Accessibility off in System Settings and on again: the note turns red ("Buddy needs Accessibility to hear this key. Allow it in Permissions."), and within 10 seconds of turning it back on the key works again, without restarting Buddy.
- [ ] Quit the helper (`pkill buddy-helper`): within a few seconds the key works again.
- [ ] Quit and reopen Buddy with Right ⌥ saved: tapping it opens the panel without visiting Settings.
- [ ] Type in a password field (a browser's login form), then tap the key: it opens the panel.
- [ ] Sleep and wake the Mac: the key still works.
- [ ] Turn Buddy off (General): tapping the key does nothing; on again: it works.
- [ ] Reset to ⌥ Space: ⌥ Space works again and tapping the key does nothing.

## Feelings

Run with the installed Buddy, on the Mac and on Windows. "Left alone" means the panel is closed, the pointer is
elsewhere, and no answer is on its way.
- [ ] Left alone for a minute, the buddy yawns (mouth open, eyes shut, arms out a little), then its eyes stay half shut and it floats more slowly.
- [ ] A minute later it falls asleep: sleeping eyes ‿ ‿, head down, slow breathing, the glow of its eyes and ear rims dimmed. It no longer follows the pointer.
- [ ] Asleep, "z" letters rise above its head in bursts for its first 5 minutes: three letters, then a pause, a burst about every 12 seconds. After 5 minutes no more come, and it stays asleep (eyes shut, head down, slow breathing). They go when it wakes. With Buddy turned off or the screen locked meanwhile, none come back until it shows again, and none at all if it has then slept more than 5 minutes.
- [ ] Move the pointer onto the sleeping buddy → its eyes blink open, it stretches both arms up and gives a little shake, then it follows the pointer again. The shortcut (the panel opens) and a click wake it too.
- [ ] Open the panel and leave it open, untouched, for three minutes → the buddy neither gets drowsy nor fidgets. Close it → a minute later it yawns.
- [ ] Left alone and awake, it fidgets every 15 to 25 seconds: it looks around, swings its arms, hums (happy eyes, "♪" rising) or hops.
- [ ] Rub the pointer left and right over its head, not pressed, with a real mouse and again with the trackpad → heart eyes, small hearts rising, a gentle sway. Passing over it once, or resting on it, does nothing; so does rubbing while it thinks or listens.
- [ ] Grab it and shake it hard → it wobbles while held; let go → swirl eyes, stars circling, its head going round, then it shakes it off. An ordinary drag only snaps it to the side.
- [ ] Wi-Fi off → send a message → the buddy is sad for a moment (droopy eyes, head and arms down, one sigh, a small sweat drop), then idle. The same with a wrong key, and when today's free requests are used up.
- [ ] TextEdit: a fix that goes in ("Done! It's in TextEdit ✅") → the buddy jumps with happy eyes and both arms up, with sparkles. The same for Insert, and for Send ("Sent ✅"). When the text can only be copied ("Copied — press ⌘V"), it is only happy.
- [ ] Talk to the panel → the buddy tilts its head as if leaning in; its ear rims go dim while you are quiet and light up as you talk: a normal voice clearly brighter than at rest, a loud one brighter still. When you stop, it stops listening, then thinks about what you said.
- [ ] Press 🎤 while Buddy is still thinking about a message → it listens; when you stop, it goes back to thinking until the answer comes.
- [ ] Turn Buddy off, wait three minutes, turn it on → it wakes and waves.
- [ ] Both buddies at each size (small, medium, large): the eye shapes (heart, swirl, droopy, half shut, sleeping ‿) look right, and the symbols above the head are not cut off.
- [ ] Battery, the whole app, a few minutes each: the buddy asleep for more than 5 minutes first (the "z" letters have stopped), and awake at rest (the pointer resting on it, still, so that it neither fidgets nor falls asleep). On the Mac, Buddy, Buddy Helper (GPU) and Buddy Helper (Renderer) together, in Activity Monitor's CPU tab (how far their CPU Time goes up) or its Energy tab; on Windows, Buddy's processes in Task Manager. Asleep should then use less than awake at rest, about a quarter less on a Mac with a 60 Hz screen (the design, section 5); using as much or more is a bug. In its first 5 minutes, with the letters, it uses a little more than awake at rest, about a sixth.
