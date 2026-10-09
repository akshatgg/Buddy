# Buddy on iPhone: your own AI key, and the admin dashboard

Date: 2026-10-09. Asked by the owner: "in iPhone there is no option to put our API key when free mode is off", "and
the admin dashboard is also not available". Approved: "so do it".

The iPhone app (`web/public/app/`, spec `2026-10-09-buddy-iphone-web-app-design.md`) gets two new parts of its Settings
tab. Both also work in any browser at `/app` (a laptop too), since the app is a web page. No server change.

## 1. Your own AI key

### What the person sees

Settings gets an **AI** section, between Buddy and Memory:

- A line about free mode: the Mac's words, from `src/main/free-state.js` `aiSection(free)` (copied into the app by
  `tools/sync-web-app.js`, as `shared/free-state.js`). `free` is `GET /api/config`'s answer.
- When `aiSection(free).showForm` is true, the form:
  - **Provider**: Claude (Anthropic), OpenAI, Google Gemini, Groq (`shared/providers/index.js` `PROVIDERS`, their
    `label`s, in that order). No "Claude Code" (only on a computer).
  - **API key**: a password field, with a "Get a key" link to the provider's `keyUrl`. **Save** keeps it; when the key
    looks like another provider's (`providerForKey`), that provider is picked, as on the Mac. **Remove** forgets it.
    A saved key is never shown again, only "Key saved" and its last 4 characters.
  - **Model**: a list. With a saved key, the provider's live list (`provider.listModels`), else its `fallbackModels`.
    The first model is used until one is picked.
- When `showForm` is false the form is hidden; a saved key stays saved.

### Where the key lives and goes

- On the phone only: `localStorage` through `store.js`, key `ai`:
  `{ provider, keys: { [providerId]: key }, models: { [providerId]: model } }`. It is never sent to Buddy's server.
  It is kept on sign out (like the Mac, where the key belongs to the computer, not the account). Remove clears it.
- The phone asks the provider straight from the page, with the shared provider modules (`shared/providers/*.js`,
  copied by the sync tool as ES modules; the sync's CommonJS conversion learns `require('../errors')`). The prompt is
  built and the answer parsed with the already-copied `shared/prompts.js` (`buildPrompt('chat', …)`, `parseChat`),
  exactly like the Mac's `askOwn`. `maxTokens` is the server's and the Mac's `MAX_TOKENS` value.
- Anthropic refuses calls from a web page unless the request carries `anthropic-dangerous-direct-browser-access: true`.
  The app gives the providers a `fetchImpl` that adds this header to requests for `https://api.anthropic.com/` only.
  OpenAI, Gemini and Groq allow calls from a web page as they are.
- Each own-key call has a deadline (`AbortSignal.timeout`, the same 60 s as `/api/ask` on the phone).

### Which route answers a message

A new pure module `route.js` ports the Mac's choice (`src/main/ai.js` `ask` and `afterRefusal`), for the chat only:

| Free mode (`/api/config`) | Own key saved | Answer from |
|---|---|---|
| config never fetched (offline at start) | yes | own key |
| config never fetched | no | error "No internet." |
| `freeOn` false | yes | own key |
| `freeOn` false | no | error "Free AI is off. Add your own key in Settings." |
| blocked, `allowOwnKey` | yes | own key |
| blocked | otherwise | error "Your free access is paused." |
| daily limit used up, `allowOwnKey` | yes | own key |
| anything else | – | server (`POST /api/ask`) |

When the server refuses: the config is fetched again (fresh). `free_off` and now `freeOn` false → own key (or the
"add your own key" error without one). `free_limit` or `blocked` and `allowOwnKey` with a key → own key. `free_limit`,
`allowOwnKey`, no key → "You've used today's N free requests. Add your own key in Settings to keep going, or wait
until midnight." Anything else: the server's error, as now.

`chat-core.js`' `FREE_OFF` line ("Free AI is off right now. Try again later.") is used only when the person can't add
a key (never: with free mode off, the AI section always shows the form); `free_off`'s message becomes the one above.

### Errors

The providers' own `BuddyError` messages are shown as they are ("Your Claude key was rejected. Check it in Settings.",
"…out of credit.", "…busy right now…", "This model isn't available for your key…", "Couldn't reach Claude. Check your
internet."). A provider that refuses a call from the page (CORS) shows up as the network error.

## 2. The admin dashboard

Settings gets an **Admin** section, after Notifications, only when `/api/config` says `isAdmin: true`. The server
already refuses everyone else (`not_admin`), so hiding it is only tidiness.

It does what the Mac's Admin window does (`src/renderer/admin/admin.js` + `index.html`), with the same words, through
the same routes, with the phone's `api.js` (token, timeouts, errors):

- **Free AI**: free mode switch, Unlimited / Daily limit, requests per user per day (1–10000), "Also let users add
  their own key" (daily only), AI provider (only those with a key on the server; "No AI key is set on the server yet…"
  when none), model with Refresh, voice status line, **Save**. `GET` / `PUT /api/admin/settings`,
  `GET /api/admin/models?provider=`.
- **Claude Code**: where Clawd walks (on Buddy's head / under Buddy's eyes), saved as soon as it is picked
  (`PUT /api/admin/settings { clawdLook }`).
- **Users**: everyone, busiest today first, with today's count and last active, and Block / Unblock
  (`GET` / `POST /api/admin/users`).

After a save the app fetches `/api/config` again, so the admin's own phone follows the new switches at once.

The form logic that does not touch the page (reading the form into a patch, showing/hiding the daily rows, the
"last active" text) lives in a pure `admin-core.js` with tests; `admin.js` draws it.

## Pieces

```
web/public/app/
  route.js        which route answers (the table above); pure
  own-ai.js       the own-key store (store.js 'ai'), the Anthropic header fetch, ask the provider, list models
  ai-settings.js  the AI section of Settings
  admin-core.js   pure admin form logic
  admin.js        the Admin section of Settings
  index.html, app.css, app.js, settings.js, chat-core.js   wired in
  shared/free-state.js, shared/providers/*.js            copied by tools/sync-web-app.js
```

## Testing

- `node --test` `test/web-app-*.test.mjs`: route (every row of the table and the refusal cases), own-ai (store, the
  header only for api.anthropic.com, the prompt sent and the answer parsed, with a fake fetch), admin-core, the sync
  check (new copied files are up to date).
- Browser, signed out only (localhost can't sign in): Settings draws, no console errors.
- The owner checks on the iPhone: free mode off → add a key → chat answers; the Admin section shows for them and a
  switch saves.

## Release

Branch `iphone-key-admin` (worktree `~/projects/buddy-iphone-2`), one PR. It goes live with `npm run deploy:server`
after merge, only when the owner says so.
