# Manual checklist — Windows

What only a person can check on Windows. Run it on a Windows 10 or 11 PC, first with
`npm start`, then with the installed Buddy (`npm run dist:win`, then run
`release\Buddy Setup <version>.exe`). Use a real API key. The Mac's list is
`docs/manual-checklist.md`.

## Start
- [ ] `npm install`, `npm test` and `npm run test:e2e` pass.
- [ ] `npm start` builds `bin\buddy-helper.exe` and opens the Welcome window: pick a buddy → Next → Connect an AI (no permission steps) → Start my buddy.
- [ ] The buddy floats at the bottom right, above the taskbar. No black console window opened. Buddy is not in the taskbar and not in Alt+Tab.
- [ ] The buddy's icon is in the corner of the taskbar (maybe under the ^ arrow); a left click and a right click both open its menu.
- [ ] Settings has no Permissions card, says "comes back every time your PC starts", and has no menu bar.

## Paste-back
- [ ] Notepad: select `i am go to market yesterday`, click the buddy → Fix tab shows it → Fix → Replace replaces it.
- [ ] Notepad, empty line: Ctrl+Shift+Space → Write → `boss ko mail likho kal chutti chahiye` → Write → Insert puts the email at the cursor.
- [ ] Gmail in Chrome, nothing selected: Ctrl+Shift+Space → Fix → Use the whole box → Fix → Replace replaces the whole body.
- [ ] Gmail in Edge: the same.
- [ ] Gmail: Fix → Use the whole box, close the panel and type a letter → the draft is not replaced, and the caret is at its end.
- [ ] WhatsApp: select a Hinglish message, Ctrl+Shift+Space → Fix → Replace gives an English message in the box (not sent).
- [ ] Word: Write → Insert works.
- [ ] Chrome, text selected: press Ctrl+Shift+Space and keep the keys down for a moment → the panel opens on Fix with the text, and Chrome's inspector (Ctrl+Shift+C) did not open.
- [ ] The panel's header names the app (· Google Chrome, · WhatsApp, · Notepad).
- [ ] After each paste, the clipboard still holds what it held before. With clipboard history on (Win+V), Buddy's answer is not in it.
- [ ] Copy a picture (Paint, or a browser), open the panel with nothing selected and close it, then paste in Paint → the picture is still on the clipboard.
- [ ] Esc, or ✕, closes the panel and you can type in your app again without clicking it.
- [ ] In the panel's text boxes Ctrl+C, Ctrl+V, Ctrl+Z and Ctrl+A work; Ctrl+Enter presses Write / Fix / Check.

## Check screen
- [ ] Gmail compose in Chrome with mistakes → Check screen → the thumbnail shows only the Chrome window (not the panel, no black edges) → Check gives "Has problems", a list and a corrected version.
- [ ] With display scaling at 150 % (Settings → System → Display), the thumbnail is sharp and whole.
- [ ] With a model that cannot see images (Groq `llama-3.3-70b-versatile`): Check → "This model can't read screenshots. Pick another in Settings."

## Safety and errors
- [ ] Cursor in a password field in Chrome, in Edge, and in a classic Windows box (for example the password field of a Wi-Fi network) → open the panel → "I don't read password fields." and nothing is read.
- [ ] With the cursor still in that password field, Write something in the panel → Insert copies the answer ("Copied — press Ctrl+V") and types nothing into the field.
- [ ] Windows Terminal running something that lasts (`ping -t localhost`): open the panel → it opens on Write and the ping keeps running. Insert → "Copied — press Ctrl+V", and nothing is typed into the terminal.
- [ ] Notepad run as administrator: Insert → "Copied — press Ctrl+V".
- [ ] Wi-Fi off → Write → "Couldn't reach …"; the buddy looks sleepy, then wakes up after a few seconds.
- [ ] A wrong key in Settings → "Your … key was rejected. Check it in Settings.", with an "Open Settings" button that opens Settings.

## Always on (the installed Buddy)
- [ ] The installer: More info → Run anyway; it installs without asking for an administrator and opens Buddy.
- [ ] Buddy on → restart the PC → the buddy is back, waving. Task Manager → Startup apps lists Buddy.
- [ ] Turn off buddy → restart → no buddy, and Buddy is not in Startup apps.
- [ ] Turn off buddy → Ctrl+Shift+Space does nothing; turn it on → it works again.
- [ ] Opening Buddy again from the Start menu while it runs opens its Settings (no second buddy).
- [ ] Menu → Quit Buddy quits it, buddy-helper.exe included (Task Manager → Details).

## Look and feel
- [ ] Floats and blinks; the head follows the pointer; dragging snaps to the side; clicks beside the character reach the app underneath.
- [ ] Two screens with different scaling: drag the buddy to the other screen; it snaps to the side there and stays sharp.
- [ ] Over a full-screen browser window (F11) the buddy still shows.
- [ ] Light and dark mode (Settings → Personalisation → Colours) both look right (panel, Settings, Welcome, bubble), and the tray icon shows on a dark and on a light taskbar.
- [ ] Buddy's processes stay at a few % CPU while idle (Task Manager).
