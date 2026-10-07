# Manual checklist — Windows

What only a person can check on Windows. Run it on a Windows 10 or 11 PC, first with
`npm start`, then with the installed Buddy (`npm run dist:win`, then run
`release\Buddy Setup <version>.exe`). Use a real API key. A valid `cloud.json` must be at the
repository root before either (copy it from the Mac). The Mac's list is `docs/manual-checklist.md`.

## Start
- [ ] `npm install`, then `npm run build:native` and `node tools/helper-smoke.js`: ping, frontmost and permissions answer, and clicking between apps names each one.
- [ ] `npm test` and `npm run test:e2e` pass, and the e2e ends by itself.
- [ ] `npm start` builds `bin\buddy-helper.exe` and opens the Welcome window: Sign in with Google → pick a buddy → Next → Connect an AI, unless free mode covers you (no permission steps) → Start my buddy.
- [ ] The buddy floats at the bottom right, above the taskbar. No black console window opened. Buddy is not in the taskbar and not in Alt+Tab.
- [ ] The buddy's icon is in the corner of the taskbar (maybe under the ^ arrow); a left click and a right click both open its menu.
- [ ] Settings has no Permissions in its sidebar, General says "comes back every time your PC starts", and there is no menu bar.

## Sign-in, free mode and Settings
- [ ] Sign in with Google opens your default browser (Chrome or Edge); after you pick the account the browser says you can go back, and Buddy shows your name, email and photo. Windows Firewall did not ask anything.
- [ ] Settings → Sign out, then Sign in again: it works, and quitting and starting Buddy keeps you signed in.
- [ ] As the admin (akshatg9636@gmail.com): the tray menu has Admin…; it opens the Admin window, switches free mode and lists the users. Esc or the ✕ closes it.
- [ ] Free mode on: the AI section says no key is needed, and Write works without a key of your own.
- [ ] Settings → Shortcut: click the box and press Ctrl+Shift+B → it shows Ctrl Shift B and works from any app. Ctrl+C says it is used by every app; Win+B and Ctrl+Alt+B are refused, saying why; Reset to Ctrl Shift Space puts the default back.
- [ ] Settings → General shows the version; the sidebar's sections move with ↑ and ↓ and skip Permissions.

## Paste-back
- [ ] Notepad: select `i am go to market yesterday`, click the buddy → Fix tab shows it → Fix → Replace replaces it.
- [ ] Notepad, empty line: Ctrl+Shift+Space → Write → `boss ko mail likho kal chutti chahiye` → Write → Insert puts the email at the cursor.
- [ ] Gmail in Chrome, nothing selected: Ctrl+Shift+Space → Fix → Use the whole box → Fix → Replace replaces the whole body.
- [ ] Gmail in Edge: the same.
- [ ] Gmail: Fix → Use the whole box, close the panel and type a letter → the draft is not replaced, and the caret is at its end.
- [ ] WhatsApp: select a Hinglish message, Ctrl+Shift+Space → Fix → Replace gives an English message in the box (not sent).
- [ ] Word: Write → Insert works.
- [ ] Chrome, text selected: press Ctrl+Shift+Space and keep the keys down for a moment → the panel opens on Fix with the text once you let go, and Chrome's inspector (Ctrl+Shift+C) did not open.
- [ ] The same, keeping the keys down for 5 seconds → no spaces typed over your text; the panel says it couldn't read the selection.
- [ ] Open the panel 20 times in a row (the shortcut, then a click on the buddy) and type at once each time: the text always lands in the panel, never in your app.
- [ ] The panel's header names the app (· Google Chrome, · WhatsApp, · Notepad).
- [ ] After each paste, the clipboard still holds what it held before. With clipboard history on (Win+V), neither Buddy's answer nor a second copy of your old clipboard is in it.
- [ ] Copy a picture (Paint, or a browser), open the panel with nothing selected and close it, then paste in Paint → the picture is still on the clipboard.
- [ ] Copy a picture, then select text in Notepad and open the panel (it reads the text), close it, and paste in Paint → the picture is back on the clipboard.
- [ ] Copy cells in Excel (or a paragraph in Word), use Buddy in another app (Write → Insert), then paste back into Excel (or Word) → what you copied comes back with its formatting.
- [ ] A multi-line answer pasted into Notepad keeps its lines.
- [ ] Esc, ✕, the shortcut again, or a click on the buddy closes the panel, and you can type in your app again without clicking it.
- [ ] In the panel's text boxes Ctrl+C, Ctrl+V, Ctrl+Z and Ctrl+A work; Ctrl+Enter presses Write / Fix / Check.

## Check screen
- [ ] Gmail compose in Chrome with mistakes → Check screen → the thumbnail shows only the Chrome window (not the panel, no black edges) → Check gives "Has problems", a list and a corrected version.
- [ ] With display scaling at 150 % (Settings → System → Display), the thumbnail is sharp and whole.
- [ ] An old app that Windows stretches at 150 % (for example one that looks slightly blurry): the thumbnail shows the whole window, with no black part.
- [ ] With a model that cannot see images (Groq `llama-3.3-70b-versatile`): Check → "This model can't read screenshots. Pick another in Settings."

## Safety and errors
- [ ] Cursor in a password field in Chrome, in Edge, and in a classic Windows app (for example 7-Zip: Add to archive → Enter password) → open the panel → "I don't read password fields." and nothing is read.
- [ ] If KeePass (or another password manager) is installed: select an entry in its list, open the panel → nothing is read ("I don't read passwords."), and the clipboard holds what it held before.
- [ ] With the cursor still in that password field, Write something in the panel → Insert copies the answer ("Copied — press Ctrl+V") and types nothing into the field.
- [ ] Windows Terminal running something that lasts (`ping -t localhost`): open the panel → it opens on Write and the ping keeps running. Insert → "Copied — press Ctrl+V", and nothing is typed into the terminal.
- [ ] The same in VS Code's terminal (`npm start` of Buddy itself is a good one): the program keeps running.
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
