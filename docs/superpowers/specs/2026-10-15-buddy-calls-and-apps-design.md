# Calls, WhatsApp calls, opening apps, and "who's calling?"

Date: 2026-10-15. Asked by the owner after the WhatsApp message work: "if I say open the phone app and call Prince … it will
do it", "add this functionality", plus "if somebody calls me, … can you tell me the name of that person who is calling me
right now? Or whatever call is missed right now". Approved: "yes". The question before a call is to be spoken, with a spoken
yes; that comes with the voice part (PR 2 of `2026-10-15-hey-buddy-message-design.md`), which covers messages and calls
alike. Until then the question is a card with buttons, like the message card.

Builds on branch `hey-buddy` (the `message` kind, `shared/message-pick.js` and its Kotlin port, `message/WhatsApp.kt`,
`WhatsAppScreen`, `Messenger`, the Mac helper's WhatsApp code). Branch `calls-apps`.

## What the person can ask (chat panel, typed or 🎤)

| Ask | Android | Mac | Windows / iPhone |
|---|---|---|---|
| "Call Prince" | card **Call Prince Sharma?** [Call] [Not now] → phone call | "I can only make phone calls from your phone." | same line as Mac |
| "WhatsApp call Prince" / "video call Prince on WhatsApp" | card **WhatsApp call Prince Sharma?** (or **WhatsApp video call …?**) [Call] [Not now] → WhatsApp call | same card → WhatsApp for Mac call | "I can make WhatsApp calls from the Mac and Android apps for now." |
| "Open YouTube" | opens it at once; **✅ Opened YouTube** | opens it at once | Windows: "I can open apps on the Mac and Android for now."; iPhone: same |
| "Who is calling me?" | "**Prince Sharma is calling.**" / "**+91 98123 45678 is calling.**" / "**Nobody is calling right now.**" | "I can only see calls on your phone." | same line as Mac |
| "Any missed calls?" / "who called me?" | "**2 missed calls today: Prince Sharma at 3:10 pm, Mom at 5:40 pm.**" / "**No missed calls today.**" | "I can only see calls on your phone." | same line as Mac |

| "Who messaged me?" / "What are my notifications?" | "**Prince on WhatsApp: "Where are you?" Mom on WhatsApp: "Call me."**" (last 5, newest first) / "**No new notifications.**" | "I can only read notifications on your phone." | same line as Mac |
| "What's the Instagram notification about?" | that app's latest notification(s), read out the same way | same line as Mac | same line as Mac |

- Buddy never calls without the Call press (later: the spoken yes). Opening an app needs no question.
- Buddy only tells about calls when asked; it never announces them by itself.
- Only normal phone calls are seen (not WhatsApp calls).

## The brain (`shared/prompts.js`)

New kinds, each gated like `message` by a request flag the app sends (`canCall`, `canOpen`, `canSeeCalls`), so older
apps and other platforms never get them:

- `call`: `{kind:'call', to, how}` with `how` one of `phone`, `whatsapp`, `whatsapp_video`. `to` as said.
- `open`: `{kind:'open', app}`: the app's name as said ("YouTube").
- `calls`: `{kind:'calls', what}` with `what` one of `now` (who is calling) or `missed`.
- Never on the second step (after Buddy read the box or the screen), as for `message`.
- Missing `to`/`app` → an `answer` asking for it ("Who should I call?", "Which app should I open?").
- The same request flag line pattern as `canMessage` ("Buddy can … from here."), one line per flag.
- Android reads the same rules through `shared.json`; Kotlin parse port and generated cases as for `message`.

## Android

- **Phone call:** contacts lookup through `ContactsContract.CommonDataKinds.Phone` (all contacts with a number, not only
  WhatsApp ones), the same `pickChat` rule, the same "more than one contact called X" line for different numbers. On Call:
  `Intent.ACTION_CALL` with `tel:<number>` (permission `CALL_PHONE`, asked the first time, like Contacts). No `CALL_PHONE` →
  "I need permission to make calls. You can allow it in Settings." (code `no_calls`, Open Settings → app details).
  Card after: `📞 Calling Prince Sharma`.
- **WhatsApp call:** find the person as for a message (`WhatsApp.people()`), open the chat with the send link with no text,
  wait until `WhatsAppScreen.chat()` shows that person's chat (same name check as messages), then press the chat's voice or
  video call button (view ids found on the device; fallback by content description "Voice call" / "Video call").
  WhatsApp asks its own "Call?" confirmation on some versions: Buddy presses that too only if it names the same person.
  Unsure → "I'm not sure the call started. Check WhatsApp." No second call offered.
- **Open app:** the launcher apps (`queryIntentActivities` MAIN/LAUNCHER) by label, matched with `pickChat`; one → start
  it; several → "Which one: A or B?"; none → "I couldn't find YouTube on this phone."
- **Who is calling:** `TelephonyManager.getCallState()` (permission `READ_PHONE_STATE`) for ringing, and the ringing number
  through a `PhoneStateListener`/`TelephonyCallback` kept while Buddy's bubble service runs (needs `READ_CALL_LOG` on
  Android 9+ to get the number). The number → contact name through `PhoneLookup`. Not ringing → "Nobody is calling right now."
- **Missed calls:** `CallLog.Calls` (permission `READ_CALL_LOG`), type MISSED, since local midnight, newest first, at most 5
  named in the line ("… and 3 more."). Names from the log's cached name, else `PhoneLookup`, else the number.
- Permissions are each asked the first time their feature is used, with one line saying why; refusal gives a line with
  Open Settings. Nothing is read or kept beyond answering that one question; nothing leaves the phone except the line in
  the chat (which, like every chat line, goes to the AI as history — call names are kept out of the history sent to the AI:
  the reply line is shown but not added to `history`).

- **Notifications** (owner, 2026-10-15: "who's messaged me right now, what the notification is about"): a
  `NotificationListenerService` ("Buddy can read your notifications", turned on by the person in Android's Notification
  access settings, asked the first time with one line why; off → "Turn on Notification access for Buddy so I can read
  your notifications." with Open Settings). It keeps the last 50 notifications **in memory only** (never written to disk,
  never synced, never sent to the AI; gone on restart; each dropped after 24 h or when the app removes it): app label,
  title (usually who), text (one line, at most 200 characters), time. Skipped: Buddy's own, ongoing ones (music, calls,
  downloads, charging, USB), group summaries, and empty ones. Brain kind `notifs` `{kind:'notifs', app}` (`app` optional:
  "Instagram") gated by `canReadNotifs`. Buddy builds the line itself on the phone: up to 5, newest first,
  `<title> on <app>: "<text>"`, joined by spaces; `app` given → only that app's ("No new notifications from Instagram.").
  The line is shown but, like call info, **not** added to the chat history sent to the AI.

## Mac

- **WhatsApp call:** `waFind` as for messages; on Call, a new helper command `waCall {name, video}`: open the chat (same
  checks as `waSend`), then press the header's `NavigationBar_CallButton` (voice) or `NavigationBar_VideoCallButton` /
  `NavigationBar_VideoDropdownButton` (video; ids seen on WhatsApp 26.41 vary by chat type — confirmed on the device).
  Success → `📞 Calling Prince Sharma on WhatsApp`.
- **Open app:** apps in /Applications, /System/Applications, ~/Applications (names without ".app"), matched with `pickChat`;
  open with `shell.openPath` / NSWorkspace. Same lines as Android ("on this Mac").
- Phone calls and call info: the polite lines in the table.

## Tests

As for messages: JS unit tests (prompts, actions with the fake helper), Kotlin unit tests with fakes for contacts, call
log, telephony and the WhatsApp screen, generated JS↔Kotlin cases, the Mac e2e panel round. Real checks on the owner's
devices before the PR: call a test contact, WhatsApp-call a test contact, open three apps, ask "who is calling" while a
second phone rings, ask "missed calls" after missing one.

## Not in this

Hands-free voice (PR 2/3 of the message spec), WhatsApp incoming calls, answering or rejecting calls, SMS, Windows/iPhone.
