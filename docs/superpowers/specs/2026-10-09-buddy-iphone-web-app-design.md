# Buddy on iPhone: the web app

Date: 2026-10-09. Asked by the owner: "build it the best way, so I can use every feature on iPhone", for free (no
Apple Developer account).

## What it is

A web app at `https://buddywrites.vercel.app/app`. The owner opens it in Safari and taps Share → Add to Home Screen.
It then opens full screen from its own icon, like an app. It is part of the website (`web/public/app/`), deployed with
the server, so it updates by itself: the next time it is opened after a deploy, the new version loads.

Nothing is installed from a file and no Apple account is needed.

## What it does

| Part | On iPhone |
|---|---|
| Sign in | Google, the same account as the Mac and Android, so free mode, limits and Claude mode are the same |
| Head | The real 3D head (`assets/buddies/*.glb`, the person's chosen buddy) with three.js, like the Mac |
| Feelings | Pet (stroke the head), dizzy (shake the phone), sleep, wake, bored, celebrate, listening, sad |
| Chat | The desktop chat panel's chat: the same `chat` prompt through `POST /api/ask` |
| Into other apps | Not possible on iPhone. Each answer with text gets **Copy** and **Share** (the iOS share sheet) |
| Memory | On the phone only (localStorage), with `shared/memory-rules.js`; Settings lists facts and can delete them |
| Voice | 🎤 records (MediaRecorder, `audio/mp4` in Safari), `POST /api/transcribe` writes it down |
| Claude mode | `GET/POST /api/remote/phone`, like Android: pick a session on a computer, watch it live, type into it |
| Notifications | Web Push: "Claude Code finished" / "Claude Code needs you" even when Buddy is closed |

Not possible on iPhone and not built: the notch eyes, a head that floats over other apps, @buddy where you type,
screenshots of other apps, putting text into other apps.

## Pieces

All new browser code is plain ES modules, no framework and no bundler, the same as the website and the desktop
renderer.

```
web/public/app/
  index.html          the one page: head on top, chat under it, tabs Chat | Claude | Settings
  manifest.webmanifest  name Buddy, display standalone, start_url and scope /app (not /app/: cleanUrls redirects it), icons
  sw.js               service worker: shell cache (network first, so updates show), push → notification
  app.js              starts everything, switches tabs
  auth.js             Google sign-in → Firebase ID token, refreshed before it expires
  api.js              fetch to /api/* with the token; turns server errors into the shared error texts
  head.js             three.js head: loads the .glb, moods, touch pet, shake (DeviceMotion)
  chat.js             the chat list, send, Copy / Share, step 2 is never needed (no box, no screenshot)
  memory.js           facts in localStorage, cleaned with memory-rules
  voice.js            record, stop, transcribe, put the words in the input
  claude.js           Claude mode: sessions list, live feed, send words, full screen view
  push.js             ask permission, subscribe, send the subscription to the server, switch off
  settings.js         buddy choice, memory list, notifications switch, sign out
  vendor/             copied by tools/sync-web-app.js: three.js + GLTFLoader + RoomEnvironment
  shared/             copied by tools/sync-web-app.js: prompts' chat parts, memory-rules, errors, head modules
```

`tools/sync-web-app.js` (run by `npm run sync:web-app`, and by `deploy:server`) copies what the app reuses from the
desktop: `blend.js`, `moods.js`, `gestures.js`, `symbols.js`/`.css` from `src/renderer/buddy/`, the head `.glb` files
and `buddies.json` and preview images, `src/main/sleep.js` and `src/main/feelings.js`, the panel's `voice-timing.js`, `shared/memory-rules.js` and `shared/errors.js`, and three.js from `node_modules`. A test fails when
the copy is stale, like `sync:web`. Modules copied but written for Electron (anything that calls `window.buddy`) are
not copied; the app gets its own thin versions.

### Sign-in

Firebase Auth's web SDK (from the gstatic CDN, pinned version) with `signInWithRedirect` and Google. Redirect sign-in
inside a home-screen app on iOS only works when the auth domain is the app's own domain, so:

- `authDomain` is `buddywrites.vercel.app`.
- `web/vercel.json` rewrites `/__/auth/:path*` to `https://buddy-7f8c2.firebaseapp.com/__/auth/:path*`.
- The owner adds `https://buddywrites.vercel.app/__/auth/handler` to the redirect URIs of the Firebase web OAuth
  client (Google Cloud console, Credentials), once. The spec's checklist gives the exact clicks.
- `buddywrites.vercel.app` is in Firebase Auth's authorized domains.

A new Firebase web app "Buddy iPhone" is registered in project `buddy-7f8c2`; its config (public by design) is in
`web/public/app/config.js`. The token goes to the server as `Authorization: Bearer`, the same as the Mac.

### Head and feelings

`head.js` draws the buddy's `Head` node only (like Android), filling the top part of the screen, with the same blend of
poses as the Mac (`blend.js`, `moods.js`). Touch: stroking the head is "pet" (`gestures.js`' pet detector fed with
touch points). Shake: `DeviceMotionEvent`; iOS asks permission, so the first tap on the head asks for it once. Sleep
after the same idle time as the Mac, wake on touch, listening while recording, happy on a good answer, celebrate when an answer is copied or shared, sad on an
error. The page pauses drawing when hidden (`visibilitychange`) to save battery.

### Chat

Same request as the desktop panel's first step (`action: 'chat'`, step 1, the conversation and the facts, exactly as `src/renderer/panel` builds it). The phone never
sends a box or a screenshot, so a `box` or `screen` answer is shown as "I can't see other apps on iPhone. Paste the text
here." Answers' `remember` items go to memory. `doIt` / `send` are ignored; text answers show Copy and Share
(`navigator.share`). Free-mode errors (limit, blocked) show the server's words; `free_off` shows the phone's own line, since the
server's says to add your own key. No own-key mode on the phone.

### Claude mode

The Android flow on the web: poll `GET /api/remote/phone?session=` every 2 s while the Claude tab is open and the app
is visible, stop otherwise and `POST {action:'stop'}` on leaving. Sessions list grouped by computer (only computers seen in the last 45 s are listed, so offline ones simply don't
show). 🎤 also works in the Claude box, like Android. The feed uses the same item kinds as the desktop panel's Claude view; a full screen button (PR #28's phone full
screen). Send box: `POST {action:'send', session, text}`.

### Notifications

Web Push works on iOS 16.4+ only for a home-screen web app and only after the person allows it from a tap.

- Server: new route `POST /api/push` `{ action: 'on', subscription }` / `{ action: 'off', endpoint }` saves or removes
  the browser's push subscription in its own `push/{uid}` doc (at most 5, newest kept; not in `remote/{uid}`, which
  `macReport` rebuilds and deletes when the last computer stops sharing). New error code `push_off` is added to
  `shared/errors.js` and `SERVER_CODES` in `src/main/cloud.js`. `web-push` package, keys in
  `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (+ `VAPID_SUBJECT` mailto) env vars. `GET /api/config` adds `pushKey`
  (the public key) when set.
- Trigger: in `remoteMac`, after the update, a session whose status changed from `working` to `done` or `waiting`
  sends one push: title the session's name (or folder), body "Claude Code finished" / "Claude Code needs you". Not
  sent for the session the phone is watching right now with the app open. A send that answers 404/410 removes that
  subscription. Push failures never fail the Mac's report.
- The Mac must have "Show my sessions on my other devices" on (it already reports statuses for Claude mode).
- The service worker shows the notification; tapping it opens `/app#claude/<session>`.

## Errors

Every network call has a timeout and shows a short line in the chat or the Claude view ("No internet.", the server's
error text, "Sign in again." on 401, then sign-in). Mic denied: "Allow the microphone in Settings → Safari." Push not
available (not added to home screen, or iOS older than 16.4): the switch explains "Add Buddy to your Home Screen first."

## Testing

- `node --test`: the sync check; the server's push route and the push trigger with fakes (like the other handler
  tests); the app's pure modules (memory, chat request building, Claude polling state, the 401 retry with a fresh token;
the Firebase SDK renews tokens itself) with
  `node --test` in `test/web-app-*.test.mjs`.
- Browser (signed out only: localhost can't sign in; chat, Claude, voice and push are checked on the iPhone): run the site locally (`vercel dev` or a static server with the API pointed at production) and check the app
  in Chrome's iPhone size with Chrome DevTools: head draws, chat round trip, Claude list, no console errors.
- The owner checks on the real iPhone with `docs/manual-checklist-iphone.md`: add to home screen, sign in, chat, voice,
  pet, shake, Claude mode, a notification while closed, and an update after a deploy.

## Release

Branch `iphone` (worktree `~/projects/buddy-iphone`), one PR. After merge: VAPID env vars in Vercel, then
`npm run deploy:server`. The website gets an "iPhone" link to `/app` with the Add to Home Screen steps.
