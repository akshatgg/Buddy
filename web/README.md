# Buddy's server

Vercel functions that give Buddy its free mode: the admin's switches and the users live in Cloud Firestore
(project `buddy-7f8c2`), and free answers use the server's own AI key. Design:
`docs/superpowers/specs/2026-10-07-buddy-phase-2-free-mode-design.md`.

The Android app (`android/`) uses this same server, the same way as the Mac: the same routes and the same sign-in.

`public/` is the download website (https://buddywrites.vercel.app); it is deployed with the functions.

| Route | Who | What |
|---|---|---|
| `GET /api/config` | signed in | what free mode means for this person |
| `POST /api/ask` | signed in | one free answer |
| `GET, PUT /api/admin/settings` | admin | the switches |
| `GET /api/admin/models?provider=` | admin | the models the server's key can use |
| `GET, POST /api/admin/users` | admin | the users list; block or unblock |

`web/shared/` is a copy of the app's `shared/` (prompts, providers, errors). Change `shared/`, then run
`npm run sync:web` at the repository root; `npm test` fails while the copy is stale.

## Environment (Vercel → Settings → Environment Variables, Production)

- `FIREBASE_SERVICE_ACCOUNT` — the JSON key of the project's `firebase-adminsdk` service account
- `ADMIN_EMAIL` — `akshatg9636@gmail.com`
- any of `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, `GROQ_API_KEY` — the admin's AI keys

## Tests

    npm test                  # the handlers with fakes (from the repository root)
    npm run test:firestore    # the Firestore adapter against the emulator (needs the Firebase CLI (firebase) and Java 21 or newer)

## Deploy

    npm run deploy:server     # from the repository root: sync web/shared, then vercel deploy --prod

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

Before and after going live:

- A change to the environment variables takes effect only with the next deploy: redeploy after changing one.
- Add `FIREBASE_SERVICE_ACCOUNT` as a Sensitive variable, and paste the key file's JSON exactly as it is, not quoted
  or escaped again.
- Vercel's Deployment Protection must be off for the production URL the app uses (`serverUrl` in `cloud.json`):
  with it on, every call gets Vercel's login page instead of an answer.
- Set a budget alert (or a spending limit) on the AI provider account whose key is on the server.
- Start free mode with a daily limit rather than Unlimited: nothing limits requests per minute, so Unlimited is
  held back only by blocking people.
