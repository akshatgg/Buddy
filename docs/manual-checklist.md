# Manual checklist — Phase 1

Run this before calling Phase 1 done, and again after any change to
`src/native/`, `src/main/actions.js` or the panel. Run it with the installed
Buddy.app (`npm run dist:mac`, then "Install on your Mac" in the README), and use
a real API key. Accessibility and Screen Recording go to Buddy, not to your
terminal.

## Paste-back
- [ ] TextEdit: select `i am go to market yesterday`, click the buddy → Fix tab shows it → Fix → Replace replaces it.
- [ ] TextEdit, empty line: ⌥Space → Write → `boss ko mail likho kal chutti chahiye` → Write → Insert puts the email at the cursor.
- [ ] Gmail in Chrome, nothing selected: ⌥Space → Fix → Use the whole box → Fix → Replace replaces the whole body.
- [ ] Gmail in Safari: same as above.
- [ ] WhatsApp Desktop: select a Hinglish message, ⌥Space → Fix → Replace gives an English message in the box (not sent).
- [ ] ⌥Space with a selection in WhatsApp and in Chrome → Fix shows the selection.
- [ ] Notes and Mail: Write → Insert works.
- [ ] After each paste, the clipboard still holds what it held before.

## Check screen
- [ ] Gmail compose with mistakes → Check screen → the thumbnail shows the Chrome window → Check shows "Has problems", a list and a corrected version → Copy works.
- [ ] With a model that cannot see images (Groq `llama-3.3-70b-versatile`): Check → "This model can't read screenshots. Pick another in Settings."

## Safety and errors
- [ ] Cursor in a password field in Safari, in Chrome and in one native app (Notes → Lock Note asks for a password),
  open the panel → "I don't read password fields." and nothing is read.
- [ ] Accessibility switched off for Buddy, then Insert → "Copied — press ⌘V" and the text is on the clipboard.
- [ ] Wi-Fi off → Write → "Couldn't reach …"; the buddy looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."

## Always on
These apply to the installed Buddy.app: a development run never adds a login item.
- [ ] Buddy on → restart the Mac → the buddy is back, waving.
- [ ] Buddy off (menu bar → Turn off buddy) → restart → no buddy, and no Buddy login item.
- [ ] Turn off buddy → ⌥Space does nothing; turn it on → ⌥Space works again.
- [ ] ⌘Q while the panel is open does nothing; menu bar → Quit quits Buddy.
- [ ] After a rebuild and reinstall, Accessibility may need to be switched off and on again for Buddy; then Fix works.

## Look and feel
- [ ] Floats and blinks; the head follows the pointer; dragging snaps to the side; clicks beside the character reach the app underneath.
- [ ] Visible over a full-screen app and on every desktop (Space).
- [ ] Buddy's processes stay at a few % CPU while idle (Activity Monitor).
- [ ] Light and dark mode both look right (panel, Settings, Welcome, bubble).
