# Manual checklist: iPhone

What only a real iPhone can check. Buddy on iPhone is a web app at https://buddywrites.vercel.app/app, deployed with
the server (`npm run deploy:server`). Use an iPhone on iOS 16.4 or later, Safari, and the same Google account as on
the Mac. The Claude mode and notification items need Buddy open on the Mac with Settings → Claude Code → "Show my
sessions on my other devices" on.

## Once, before the first try (the owner)

These are set up once; the app's code cannot do them. Buddy iPhone is the Firebase web app "Buddy iPhone" (appId
`1:128703624181:web:93b7f60d93003e655766bc`) of project `buddy-7f8c2`; its sign-in domain is `buddywrites.vercel.app`.

1. **Google sign-in comes back to Buddy's domain.** Google Cloud console (https://console.cloud.google.com), project
   `buddy-7f8c2` → APIs & Services → Credentials → under "OAuth 2.0 Client IDs", open **"Web client (auto created by
   Google Service)"**:
   - **Authorized redirect URIs** → **Add URI** → `https://buddywrites.vercel.app/__/auth/handler`.
   - **Authorized JavaScript origins** → **Add URI** → `https://buddywrites.vercel.app`.
   - Save. (Leave what is there already, such as `https://buddy-7f8c2.firebaseapp.com/__/auth/handler`.) It can take
     a few minutes to work.
2. **Firebase allows Buddy's domain.** Firebase console (https://console.firebase.google.com) → project `buddy-7f8c2`
   → Authentication → Settings → Authorized domains: `buddywrites.vercel.app` must be in the list. If it is not:
   **Add domain** → `buddywrites.vercel.app` → Add.
3. **Google sign-in is on.** Same console → Authentication → Sign-in method → Google must be Enabled (it already is
   for the Mac and Android apps).
4. **Notification keys on the server.** In `web/` (after `npm ci` there): `npx web-push generate-vapid-keys`. It prints
   a Public Key and a Private Key. Then, from the repository root (run `vercel link --cwd web` first if `web/.vercel`
   is not there, and pick the project behind buddywrites.vercel.app):

       vercel env add VAPID_PUBLIC_KEY production --cwd web     # paste the Public Key
       vercel env add VAPID_PRIVATE_KEY production --cwd web    # paste the Private Key (mark it Sensitive if asked)
       vercel env add VAPID_SUBJECT production --cwd web        # mailto:akshatg9636@gmail.com

   Then `npm run deploy:server`: a change to the environment takes effect with the next deploy. Keep the keys: new
   keys mean every phone has to switch notifications off and on again. Push only works in the Home Screen app on iOS
   16.4 or later, and the server only accepts phone endpoints on `*.push.apple.com`, `fcm.googleapis.com`,
   `*.push.services.mozilla.com` and `*.notify.windows.com`.
5. If sign-in still fails after 1 to 3: the site sends the header `Referrer-Policy: no-referrer` on every page
   (`web/vercel.json`), so Google sees no referrer. Google Cloud console → APIs & Services → Credentials → API keys →
   the key in `web/public/app/config.js` (`apiKey`). If its "Application restrictions" is set to "Websites", add
   `https://buddywrites.vercel.app/*` (and `https://buddy-7f8c2.firebaseapp.com/*`); if that still fails, set it to
   "None" (the key is public by design; "API restrictions" still limit what it can do). Only if it is still
   refused, change the header for `/app` and `/__/` in `web/vercel.json` to `strict-origin-when-cross-origin`, and
   deploy.

## Add to Home Screen
- [ ] Open https://buddywrites.vercel.app on the iPhone: the hero button says "Open Buddy for iPhone", and the iPhone
      tile under "Get Buddy" has the Add to Home Screen step.
- [ ] Tap it: Safari opens /app with the head and "Sign in with Google".
- [ ] Share → Add to Home Screen → Add: Buddy's icon is on the Home Screen, named Buddy.
- [ ] Open Buddy from the icon: full screen, no Safari bars; the notch and the home bar do not cover anything.

## Sign in
- [ ] Tap "Sign in with Google": Google's page opens, pick the account, and Buddy comes back signed in on the Chat tab
      (not in Safari, not on a blank page).
- [ ] Close Buddy fully (swipe it away) and open it again: still signed in.
- [ ] Settings → Account shows "Signed in as <your email>". Sign out: back to "Sign in with Google".

## The head and its feelings
- [ ] The head is your buddy (Settings → Your buddy changes it to the other one at once, and it stays after a restart).
- [ ] It floats and blinks; left alone it fidgets now and then (looks around, hums, hops).
- [ ] The first tap on the head asks for "Motion & Orientation" access: Allow. Shake the phone: the buddy is dizzy.
- [ ] Stroke the head left and right with a finger: hearts, the buddy loves it.
- [ ] Leave it alone for 2 minutes: drowsy at one minute, asleep at two, with "z"s. Tap it: it wakes.

## Chat
- [ ] `boss ko mail likho kal chutti chahiye` → send: your message on the right, "Aarav is thinking…", the head thinks,
      then an email with Copy and Share; the head is happy.
- [ ] Copy: "Copied" under the head, the head celebrates, and the mail pastes in Mail or WhatsApp.
- [ ] Share: the iOS share sheet opens with the text; close it and nothing goes wrong.
- [ ] `make it shorter`: a shorter version of the same mail.
- [ ] `fix my English`: "I can't see other apps on iPhone. Paste the text here." (and today's free count does not go up).
- [ ] `I work at Infosys, remember that`: "📝 Remembered: …" with Undo; Settings → Memory lists it; Forget removes it.
- [ ] Settings → Memory: add "My password is 1234": not kept, with the reason.
- [ ] Airplane mode, send: a red line "No internet." with Try again, and the head is sad. Back online, Try again: the answer.
- [ ] With today's free requests used up (Admin window on the Mac: limit 1), a second message shows the server's words.

## Voice
- [ ] 🎤 shows in the box (the server has its Groq key). Tap it: the phone asks for the microphone once: Allow.
- [ ] Say `kal mujhe chutti chahiye`: the head listens, its ear rims glow with your voice; stop talking and the words
      appear in the box by themselves. Tap send.
- [ ] Tap 🎤 and say nothing: after about 8 s, "I didn't hear anything. Tap 🎤 and speak."
- [ ] Say no to the microphone (Settings → Safari → Microphone → Deny, or the prompt): "Allow the microphone in
      Settings → Safari."

## Claude mode
- [ ] Start a Claude Code session in a terminal on the Mac. Claude tab: the session is listed under the Mac's name,
      with its status.
- [ ] Tap it: its lines show and new ones come in within a few seconds. Type `run the tests` and send: it is typed into
      the terminal on the Mac.
- [ ] ⤢: full screen (no head, no tabs); ⤡ back. ‹ goes back to the list.
- [ ] Go to the Chat tab, or close Buddy: the Mac stops sending (its Claude view shows nobody watching within 30 s).
- [ ] Turn sharing off on the Mac: the Claude tab says none of your computers is sharing.

## Notifications
- [ ] Settings → Notifications: turn the switch on; iOS asks: Allow. The switch stays on.
- [ ] In Safari (not the Home Screen app), Settings says "Add Buddy to your Home Screen first…" and the switch is off.
- [ ] Close Buddy. Give Claude Code a job on the Mac and wait for it to finish: "Claude Code finished" arrives on the
      lock screen, titled with the session's name.
- [ ] A session that asks for permission: "Claude Code needs you".
- [ ] Tap a notification: Buddy opens on the Claude tab, on that session.
- [ ] While you watch a session in Buddy, its own finishing sends no notification.
- [ ] Turn the switch off: no more notifications.

## Updates
- [ ] Deploy a small change (`npm run deploy:server`). Close Buddy fully and open it again: the change is there.
- [ ] Airplane mode, open Buddy: it still opens (with the head), and says "No internet." when you send.
