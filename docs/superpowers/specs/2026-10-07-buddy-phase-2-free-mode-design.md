# Buddy Phase 2 — Free mode, Google sign-in, admin (Mac) — Design

Date: 2026-10-07
Status: agreed in chat, piece by piece
Builds on: `2026-10-06-buddy-v1-mac-design.md`. This document replaces its §5 "Routing" and
§6 (server, data, admin dashboard) where the two differ. Everything else there still holds.

## 1. Goal

The owner (admin) can make Buddy free for everyone by putting their own AI key on a server, and
control it from inside the app:

- **Free mode ON** — users use the admin's key. The API key and model fields disappear from the app.
- **Free mode OFF** — the key and model fields come back; users must add their own key.
- **Unlimited** or **Daily limit** (N requests per user per day, reset at midnight India time).
- With a daily limit, **"Also let users add their own key"**: users spend their free requests first,
  then Buddy carries on with their own key.
- A users list with **Block / Unblock**.

Every user signs in with Google (Firebase Authentication) before they can use Buddy, whatever the route.

The settings live on the server, so a change made from any app (Mac now; Windows, Android, iOS
later) applies to every user on every app.

Admin: **akshatg9636@gmail.com** (checked on the server, with `email_verified`).

### Out of scope

Token and cost tracking (the admin checks cost on the AI company's site), a web dashboard, usage
history, per-user custom limits, Windows/Android/iOS apps, payments.

## 2. What the user sees

### Welcome (first launch)

1. **Sign in with Google** — new first step. The browser opens Google's sign-in page; the window
   waits and turns green when it is done. *Next* stays disabled until the user is signed in.
2. Pick a buddy and name it (as now).
3. Accessibility, then Screen Recording (as now).
4. **Connect an AI** — shown only when the user may need a key (free mode OFF, or daily limit with
   own keys allowed). Skipped when free mode covers them.

### What the AI section shows (Settings, Welcome)

| Server says | AI section |
|---|---|
| Free OFF | The provider / key / model form (as in Phase 1) |
| Free ON, unlimited | "Free AI is on. No key needed." — no form |
| Free ON, daily, own keys not allowed | "You get N free requests a day. Used today: X." — no form |
| Free ON, daily, own keys allowed | The same line, then "Add your own key to keep going after your free requests run out." and the form |
| Not known yet (never reached the server) | The form, as in Phase 1 |

A key saved earlier is kept while the form is hidden and used again when the form comes back.

### Settings: new Account card (first card)

Signed in: name, email, **Sign out**. Signed out: **Sign in with Google**.

### Panel errors

| Situation | Message | Button |
|---|---|---|
| Not signed in | "Sign in to use Buddy." | Open Settings |
| Daily limit used, own keys not allowed | "You've used today's N free requests. They come back at midnight." | — |
| Daily limit used, own keys allowed, no own key saved | "You've used today's N free requests. Add your own key in Settings to keep going, or wait until midnight." | Open Settings |
| Blocked, own key not usable | "Your free access is paused." | — |
| Free OFF and no own key | "Add your API key in Settings first." (as now) | Open Settings |
| Server unreachable | "Couldn't reach Buddy's server. Check your internet." (sleepy mood, as for any network error) | — |
| Server's AI failed | "Buddy couldn't answer. Try again." (the request is given back) | — |
| Free model can't read screenshots | "The free AI can't read screenshots right now." | — |

### Menu bar

When the signed-in user is the admin, the menu gets **Admin…** (above Settings…). Nobody else
ever sees it. The server decides who is admin; the app only uses that to show the item.

### Admin window

A window like Settings, ~560×720.

**Free AI card**
- Free mode: ON / OFF
- Unlimited / Daily limit [N] (1–10 000)
- With Daily limit: ☐ Also let users add their own key
- Provider: only providers whose key is set on the server
- Model: the live list for the admin key (fallback list until it loads)
- **Save** → "Saved ✓ — applies to every Buddy app". A field that is not valid is refused with a plain message.
- If no provider key is set on the server: "No AI key is set on the server yet." and free mode cannot be turned on.

**Users card**
- "N users". Table: name, email, used today, last active, **Block / Unblock**. Sorted by used today,
  then last active. **Refresh** button. Up to 1 000 most recently active users.

## 3. Data (Cloud Firestore)

Only the server reads and writes Firestore (Admin SDK). The rules deny every client read and write.

```
config/free            one document: the admin's switches
  enabled         bool      free mode ON/OFF
  limitMode       string    "unlimited" | "daily"
  dailyRequests   number    1..10000
  allowOwnKey     bool      with "daily": users may add their own key too
  provider        string    "anthropic" | "openai" | "gemini" | "groq"
  model           string

users/{uid}            one document per user
  email, name     string    from the verified Google token
  joined          timestamp first sign-in
  lastActive      timestamp last request
  blocked         bool      admin may change
  usedDay         string    "YYYY-MM-DD", Asia/Kolkata
  usedCount       number    requests made on usedDay
```

When `config/free` does not exist yet: `enabled false, limitMode "daily", dailyRequests 30,
allowOwnKey false`, provider = the first with a key on the server, model = its first fallback model.

Never stored anywhere: the AI keys (admin's: Vercel environment only; users': their Mac, encrypted),
what users write, screenshots, answers.

## 4. Server (Vercel, `web/`)

Node serverless functions, CommonJS, `firebase-admin`. The Vercel project's root directory is `web/`;
the functions use `../shared` (prompts, provider adapters, errors) — how it reaches the deployment is
settled and verified in the plan.

### Environment

`FIREBASE_SERVICE_ACCOUNT` (JSON), `ADMIN_EMAIL`, and any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`,
`GEMINI_API_KEY`, `GROQ_API_KEY`.

### Endpoints

Every call sends `Authorization: Bearer <Firebase ID token>`. Errors are
`{ error: { code, message } }`; `message` is plain words for the user.

| Endpoint | Who | Does |
|---|---|---|
| `GET /api/config` | signed in | Creates `users/{uid}` on first call (updates email/name if changed; no other write). Returns `{ freeOn, limitMode, limit, usedToday, allowOwnKey, blocked, isAdmin }`. `freeOn` is `enabled` and a key exists for the chosen provider. |
| `POST /api/ask` | signed in | Body `{ action, instruction?, tone?, text?, image? }` (limits as in Phase 1). Steps below. Returns `{ text, model, check? }`. |
| `GET /api/admin/settings` | admin | `{ config, providers: [{ id, label, hasKey, fallbackModels }] }` |
| `PUT /api/admin/settings` | admin | Body: any of the config fields; validated; saved; returns the same as GET. |
| `GET /api/admin/models?provider=` | admin | `{ models }` — the live list with the admin key. |
| `GET /api/admin/users` | admin | `{ users: [{ uid, email, name, joined, lastActive, blocked, usedToday }] }` |
| `POST /api/admin/users` | admin | Body `{ uid, blocked }` → `{ user }` |

`POST /api/ask`:
1. Verify the ID token (`email_verified`) → 401 `unauthenticated`.
2. Validate the body with the shared prompt builder → 400 `bad_request`.
3. Read `config/free`. Free off (or no key for its provider) → 403 `free_off`.
4. Transaction on `users/{uid}`: missing → created; `blocked` → 403 `blocked`; a new day resets
   `usedCount`; with `daily` and `usedCount ≥ dailyRequests` → 429 `free_limit` (message names the
   limit); otherwise `usedCount += 1`, `lastActive = now`. Counted before the AI call, so parallel
   requests cannot slip past the limit. Unlimited mode counts too (for the users list).
5. Build the prompt (shared module) and call the configured provider and model with the admin key.
   A screenshot with a model that cannot read images → 400 `free_no_vision`.
6. Provider fails → give the request back (`usedCount -= 1` if still the same day) → 502 `upstream`
   "Buddy couldn't answer. Try again."
7. Return the answer. Nothing the user sent is logged or stored.

Admin endpoints: the token's email must equal `ADMIN_EMAIL` and be verified → else 403 `not_admin`.

Handlers are written against small injected parts (token verifier, database, providers, clock) and
tested with fakes; the Firestore part is tested against the local Firestore emulator.

## 5. The app

### Sign-in (Google OAuth for desktop apps)

Authorization code + PKCE with a loopback redirect: Buddy listens once on `127.0.0.1:<random port>`,
opens Google's sign-in page in the default browser, receives the code (5-minute limit), exchanges
it at Google's token endpoint for a Google ID token, and signs in to Firebase with it
(`accounts:signInWithIdp`). The browser tab then says "You're signed in to Buddy. You can close this tab."

The Firebase refresh token is stored encrypted with `safeStorage` (`account.json`), with the user's
uid, email and name. ID tokens live in memory and are refreshed through `securetoken.googleapis.com`
a few minutes before they expire. A refresh that is refused (token revoked) signs the user out.

Sign out forgets the account file and the cached server settings.

`cloud.json` (not in git; `cloud.example.json` is) holds the server URL, the Firebase web API key and
the Google desktop OAuth client id and secret (Google treats a desktop client's secret as not
confidential). The build includes it. Without it, sign-in says "This copy of Buddy isn't set up for
sign-in."

### Routing

The app keeps the last answer of `GET /api/config` (saved, so it survives a restart without internet)
and refreshes it: at launch, at sign-in, when Settings opens, after the admin saves, before a request
when the last answer is older than 60 s, and right after a `free_off`, `free_limit` or `blocked` error.

```
not signed in                                   → "Sign in to use Buddy."
freeOn and not blocked                          → free (server)
    server says free_limit:
        allowOwnKey and own key saved           → own key (same request, once)
        allowOwnKey, no own key                 → "...Add your own key in Settings..."
        otherwise                               → "...They come back at midnight."
    server says free_off                        → refresh, route again (once)
freeOn and blocked: allowOwnKey and own key     → own key; else "Your free access is paused."
free off: own key saved                         → own key (as in Phase 1)
free off: no own key                            → "Add your API key in Settings first."
server never reached                            → own key if saved, else "Couldn't reach Buddy's server."
```

The own-key route is exactly Phase 1's (prompts built in the app, provider called directly).

### New and changed parts

| Part | What |
|---|---|
| `cloud.json` / `src/main/cloud-config.js` | read the four values |
| `src/main/google-signin.js` | PKCE + loopback + token exchange + Firebase sign-in |
| `src/main/account.js` | stored refresh token, `idToken()`, sign in / out, user |
| `src/main/cloud.js` | server client: `config()`, `ask()`, admin calls; server errors → `BuddyError` |
| `src/main/ai.js` | routing above |
| `src/main/ipc/settings.js` | account + free state in the snapshot; sign in / out; refresh |
| `src/main/ipc/admin.js`, `src/preload/admin.js`, `src/renderer/admin/` | the admin window |
| `src/main/tray.js` | "Admin…" for the admin |
| Welcome, Settings, panel pages | as in §2 |
| `test/e2e` | fakes for the account and the server; checks for sign-in gating, AI card states, admin menu |

## 6. Errors (new codes)

`signed_out`, `free_limit`, `need_key` (limit used, own keys allowed, none saved), `blocked`,
`free_off`, `free_no_vision`, `upstream`, `unauthenticated`, `not_admin`, `not_set_up`, `network` (server
unreachable). The panel's "Open Settings" button shows for `signed_out`, `need_key`, `free_off` and
`not_set_up` as well as the Phase 1 codes.

## 7. Testing

- Server handlers: every error code; count → call → refund order; new-day reset; daily vs unlimited;
  blocked; admin-only routes; config validation; defaults when `config/free` is missing.
- Firestore adapter: against the emulator (transaction count, refund, user creation, listing).
- App: PKCE and loopback (real local HTTP server, fake browser opener, fake fetch), account storage
  and refresh, server client error mapping and 401 retry, every routing row above.
- e2e: Welcome cannot finish signed out; AI card states; admin menu item only for the admin; admin
  window refuses non-admin calls.
- Manual: real Google sign-in, free ON/OFF switching seen in the app, daily limit reached, Block,
  own-key fallback, sign out.

## 8. Setup

Done from this Mac's CLIs with the owner's approval: Firebase project, Firestore database
(`asia-south1`), rules, Vercel project and environment, deploy.

Only the owner can do (web consoles): turn on Google sign-in in Firebase Authentication; create the
Google OAuth client of type **Desktop app** in the same Google Cloud project; paste the admin AI key
into Vercel (`vercel env add`).
