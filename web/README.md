# Buddy's server

Vercel functions that give Buddy its free mode: the admin's switches and the users live in Cloud Firestore
(project `buddy-7f8c2`), and free answers use the server's own AI key. Design:
`docs/superpowers/specs/2026-10-07-buddy-phase-2-free-mode-design.md`.

The Android app (`android/`) uses this same server, the same way as the Mac: the same routes and the same sign-in.

`public/` is the download website (https://buddywrites.vercel.app); it is deployed with the functions. `public/app/`
is Buddy on iPhone, a web app at https://buddywrites.vercel.app/app that people add to their Home Screen (design:
`docs/superpowers/specs/2026-10-09-buddy-iphone-web-app-design.md`, checks: `docs/manual-checklist-iphone.md`). It uses
the same routes and the same sign-in as the Mac, with Firebase Auth's web SDK; `/__/auth/*` and `/__/firebase/*` are
passed on to Firebase (`vercel.json`) so that sign-in by redirect works in a Home Screen app. Its Settings has an AI
section, for the person's own AI key: kept on the phone only, it goes from the page straight to the AI provider, never
to this server. The admin also gets an Admin section there, which uses the `/api/admin/*` routes below as the Mac's
Admin window does (design: `docs/superpowers/specs/2026-10-09-iphone-own-key-and-admin-design.md`).

| Route | Who | What |
|---|---|---|
| `GET /api/config` | signed in | what free mode means for this person |
| `POST /api/ask` | signed in | one free answer |
| `POST /api/transcribe` | signed in | what was said in a recording (voice), with the server's Groq key |
| `POST /api/remote/mac` | signed in | a computer shares its Claude Code sessions; a session that finishes is told to the person's phones |
| `GET, POST /api/remote/phone` | signed in | a phone (or another computer) watches a session and sends it words |
| `POST /api/push` | signed in | notifications on the phone: keep or forget its Web Push subscription |
| `GET, PUT /api/admin/settings` | admin | the switches |
| `GET /api/admin/models?provider=` | admin | the models the server's key can use |
| `GET, POST /api/admin/users` | admin | the users list; block or unblock |

`web/shared/` is a copy of the app's `shared/` (prompts, providers, errors). Change `shared/`, then run
`npm run sync:web` at the repository root; `npm test` fails while the copy is stale.

`public/app/shared/`, `public/app/buddies/` and `public/app/vendor/` are copies too, for Buddy on iPhone: the parts of
`shared/`, `src/` and `assets/buddies/` it reuses, and three.js. Change those, then run `npm run sync:web-app`; `npm
test` fails while they are stale. `npm run serve:web` serves `public/` on http://localhost:8787 the way Vercel does, to
try the app in a browser (signed out: `/api` is not served there).

## Environment (Vercel → Settings → Environment Variables, Production)

- `FIREBASE_SERVICE_ACCOUNT` — the JSON key of the project's `firebase-adminsdk` service account
- `ADMIN_EMAIL` — `akshatg9636@gmail.com`
- any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` — the admin's AI keys
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` — Web Push for the phone's notifications: the keys from
  `npx web-push generate-vapid-keys` (in `web/`), and `mailto:akshatg9636@gmail.com`. Without all three, notifications
  are off (`/api/push` answers `push_off`).

## Tests

    npm test                  # the handlers with fakes (from the repository root)
    npm run test:firestore    # the Firestore adapter against the emulator (needs the Firebase CLI (firebase) and Java 21 or newer)

## Deploy

    npm run deploy:server     # from the repository root: sync web/shared and public/app, then vercel deploy --prod

The database rules (`web/firestore.rules`, deny everything to clients) are deployed with
`firebase deploy --only firestore:rules`.

## Operations

What the server's log lines mean (Vercel → the project → Logs). They carry status codes, error codes and kinds only:
never what people write, a token or a key.

- `[api] could not start: no_service_account` — `FIREBASE_SERVICE_ACCOUNT` is not set. Every route answers 500.
- `[api] could not start: bad_service_account` — it is set, but is not a service account key (often: pasted wrapped
  in quotes). Every route answers 500.
- `[auth] token not accepted: <code>` — a person's ID token was no good (`auth/id-token-expired`,
  `auth/argument-error`, …), answered 401: the app renews the token and tries once more, and signs the person out
  only if the server says so again. If every sign-in is turned down with `auth/argument-error`, check that the
  service account belongs to the app's Firebase project (`buddy-7f8c2`).
- `[auth] could not check a token: <code>` — the server could not check a token at all (Google's signing keys out of
  reach, say), answered 503: nobody is signed out for it. If it keeps coming, the server's setup needs a look.
- `[ask] <provider> failed: <code>` — the AI provider failed a free request (`rate_limited`, `no_credit`, `bad_key`,
  …). The person hears "Buddy couldn't answer", and the request is given back.
- `[ask] could not give the request back: <kind>` — and giving it back failed too, so it stays counted.
- `[models] <provider> failed: <code>` — the Admin window could not load that provider's model list with the server's
  key, and shows the usual models.
- `[api] failed: <kind>` — anything else that went wrong in a route (a Firestore error, say), answered 500.
- `[push] not sent: <status>` — a push service turned a notification down (other than 404 or 410, which forget that
  phone). The computer's report was answered as usual.
- `[push] could not notify: <kind>` — the notifications for a report could not be sent at all (a Firestore error,
  say). The computer's report was answered as usual.

Before and after going live:

- A change to the environment variables takes effect only with the next deploy: redeploy after changing one.
- Add `FIREBASE_SERVICE_ACCOUNT` as a Sensitive variable, and paste the key file's JSON exactly as it is, not quoted
  or escaped again.
- Vercel's Deployment Protection must be off for the production URL the app uses (`serverUrl` in `cloud.json`):
  with it on, every call gets Vercel's login page instead of an answer.
- Set a budget alert (or a spending limit) on the AI provider account whose key is on the server.
- Start free mode with a daily limit rather than Unlimited: nothing limits requests per minute, so Unlimited is
  held back only by blocking people.
