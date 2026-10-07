# Manual checklist

Phase 1 is the sections from Paste-back to Look and feel. Phase 2 is the section
"Phase 2: sign-in and free mode". The section "Settings: the sidebar and the
shortcut recorder" is the Settings polish, and the last one, "Single-key shortcut",
is the shortcut that is one key tapped on its own.

Run Phase 1 before calling it done, and again after any change to
`src/native/`, `src/main/actions.js` or the panel. Run it with the installed
Buddy.app (`npm run dist:mac`, then "Install on your Mac" in the README), and use
a real API key. Accessibility and Screen Recording go to Buddy, not to your
terminal.

## Connect an AI
- [ ] Welcome → Connect an AI shows all four AIs; paste a Gemini key while Claude is chosen → Save key switches to Google Gemini and lists Gemini models.

## Paste-back
- [ ] TextEdit: select `i am go to market yesterday`, click the buddy → Fix tab shows it → Fix → Replace replaces it.
- [ ] TextEdit, empty line: ⌥Space → Write → `boss ko mail likho kal chutti chahiye` → Write → Insert puts the email at the cursor.
- [ ] Gmail in Chrome, nothing selected: ⌥Space → Fix → Use the whole box → Fix → Replace replaces the whole body.
- [ ] Gmail in Safari: same as above.
- [ ] WhatsApp Desktop: select a Hinglish message, ⌥Space → Fix → Replace gives an English message in the box (not sent).
- [ ] Gmail and WhatsApp Desktop: Fix → Use the whole box, close the panel and type a letter → the draft is not replaced, and the caret is at its end.
- [ ] ⌥Space with a selection in WhatsApp and in Chrome → Fix shows the selection.
- [ ] Notes and Mail: Write → Insert works.
- [ ] After each paste, the clipboard still holds what it held before.
- [ ] Copy an image (in Preview or Finder), open the panel with nothing selected and close it, then paste in Notes → the image is still on the clipboard.

## Check screen
- [ ] Gmail compose with mistakes → Check screen → the thumbnail shows the Chrome window → Check shows "Has problems", a list and a corrected version → Copy works.
- [ ] With a model that cannot see images (Groq `llama-3.3-70b-versatile`): Check → "This model can't read screenshots. Pick another in Settings." with an "Open Settings" button.

## Safety and errors
- [ ] Cursor in a password field in Safari, in Chrome and in one native app (Notes → Lock Note asks for a password),
  open the panel → "I don't read password fields." and nothing is read.
- [ ] With the cursor still in that native password field, Write something in the panel → Insert copies the answer ("Copied — press ⌘V") and types nothing into the field.
- [ ] Accessibility switched off for Buddy, then Insert → "Copied — press ⌘V" and the text is on the clipboard.
- [ ] Wi-Fi off → Write → "Couldn't reach …"; the buddy looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."
- [ ] With no key saved, and again with a wrong key → Write → the error comes with an "Open Settings" button; it opens Settings, and the panel steps aside.

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
- [ ] Admin → Free mode on, Unlimited, Save. Reopen Settings: the AI card says "Free AI is on. No key needed." With no key saved, Write → Insert in Gmail works.
- [ ] Admin → Daily limit 2, Save. The third Write says "You've used today's 2 free requests. They come back at midnight."
- [ ] Admin → also let users add their own key. With a key saved, the third Write still answers; with none, it says to add one, with Open Settings.
- [ ] Admin → Users lists you, and "Today" counts up. Block → Write says "Your free access is paused."; Unblock → it works again.
- [ ] Block yourself while signed in as the admin, then Unblock: the Admin window keeps working (blocking stops free answers only).
- [ ] Admin → Free mode off, Save. Settings shows the key form again, and a key saved earlier is still there.
- [ ] Check screen with free mode on works (the free model can read screenshots).
- [ ] Wi-Fi off with free mode on: Write says "Couldn't reach Buddy's server. Check your internet." and the buddy looks sleepy.
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
- [ ] Every window in light and dark mode (System Settings → Appearance): Settings (each section), the Welcome (each step), Admin, the panel (each tab, with an answer and with an error) and the bubble.

## Single-key shortcut

- [ ] Settings → Shortcut: click the box and tap Right ⌥ on its own → saved as "Right ⌥", with the note "Tap it on its own to open your buddy: press and let go, with no other key."
- [ ] In TextEdit, tap Right ⌥ → the panel opens; tap it again → it closes.
- [ ] Hold Right ⌥ for a second and let go → nothing. Type ⌥ with a letter (a special character) → nothing. ⌥-click → nothing. Tap Left ⌥ → nothing.
- [ ] Record Left ⌘: ⌘C, ⌘V and ⌘-click in other apps never open Buddy; a ⌘ tap does.
- [ ] Record ⇧ and ⌘ tapped together → "Left ⇧ Left ⌘"; tapping both opens Buddy, ⇧ alone or ⌘ alone does not.
- [ ] Record fn → "fn" and the note about emoji and dictation; tapping fn opens Buddy (after setting "Press 🌐 key to" to "Do Nothing" if macOS opens emoji instead).
- [ ] Record Caps Lock → "⇪ Caps Lock" and its note; each press opens or closes Buddy once, and capitals toggle as the note says.
- [ ] While recording, press ⌘ and B together → saved as "⌘ B", not as a ⌘ tap.
- [ ] Buddy has Accessibility but is not in System Settings → Privacy & Security → Input Monitoring: the single key still works (macOS lets an app with Accessibility listen to the keys).
- [ ] With Buddy's Accessibility off, click the Shortcut box: the line under it says "Buddy needs Accessibility to hear a key tapped on its own. Allow it in Permissions.", and ⇧ ⌘ B can still be recorded.
- [ ] Turn Buddy's Accessibility off in System Settings: the note turns red ("Buddy needs Accessibility to hear this key. Allow it in Permissions."); turn it on again: within 10 seconds the key works, without restarting Buddy.
- [ ] Quit the helper (`pkill buddy-helper`): within a few seconds the key works again.
- [ ] Turn Buddy off (General): tapping the key does nothing; on again: it works.
- [ ] Reset to ⌥ Space: ⌥ Space works again and tapping the key does nothing.
