# Buddy's server

Vercel functions that give Buddy its free mode: the admin's switches and the users live in Cloud Firestore
(project `buddy-7f8c2`), and free answers use the server's own AI key. Design:
`docs/superpowers/specs/2026-10-07-buddy-phase-2-free-mode-design.md`.

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
