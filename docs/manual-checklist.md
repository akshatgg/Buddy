# Manual checklist — Phase 1

Run this before calling Phase 1 done, and again after any change to
`src/native/`, `src/main/actions.js` or the panel. Use a real API key. In
development, macOS gives Accessibility and Screen Recording to the app you start
Buddy from (your terminal), so allow that app.

## Paste-back
- [ ] TextEdit: select `i am go to market yesterday`, click the buddy → Fix tab shows it → Fix → Replace replaces it.
- [ ] TextEdit, empty line: ⌥Space → Write → `boss ko mail likho kal chutti chahiye` → Write → Insert puts the email at the cursor.
- [ ] Gmail in Chrome, nothing selected: ⌥Space → Fix → Use the whole box → Fix → Replace replaces the whole body.
- [ ] Gmail in Safari: same as above.
- [ ] WhatsApp Desktop: select a Hinglish message, ⌥Space → Fix → Replace gives an English message in the box (not sent).
- [ ] Notes and Mail: Write → Insert works.
- [ ] After each paste, the clipboard still holds what it held before.

## Check screen
- [ ] Gmail compose with mistakes → Check screen → the thumbnail shows the Chrome window → Check shows "Has problems", a list and a corrected version → Copy works.
- [ ] With a model that cannot see images (Groq `llama-3.3-70b-versatile`): Check → "This model can't read screenshots. Pick another in Settings."

## Safety and errors
- [ ] Cursor in a password field, open the panel → "I don't read password fields." and nothing is read.
- [ ] Accessibility switched off for Buddy, then Insert → "Copied — press ⌘V" and the text is on the clipboard.
- [ ] Wi-Fi off → Write → "Couldn't reach …"; the buddy looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings."

## Always on
- [ ] Buddy on → restart the Mac → the buddy is back, waving.
- [ ] Buddy off (menu bar → Turn off buddy) → restart → no buddy, and no Buddy login item.

## Look and feel
- [ ] Floats and blinks; the head follows the pointer; dragging snaps to the side; clicks beside the character reach the app underneath.
- [ ] Visible over a full-screen app and on every desktop (Space).
- [ ] Buddy's processes stay at a few % CPU while idle (Activity Monitor).
- [ ] Light and dark mode both look right (panel, Settings, Welcome, bubble).
