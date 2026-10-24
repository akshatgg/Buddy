## What

<!-- One or two sentences. What changes for someone using Buddy? -->

## Why

<!-- The problem this solves, or the issue it closes. -->

Closes #

## How

<!-- The approach, and anything a reviewer would trip over. -->

## Platforms

<!-- Tick what this touches. One behaviour across four front ends means a
change in the wrong layer shows up somewhere else later. -->

- [ ] Mac
- [ ] Windows
- [ ] Android
- [ ] iPhone web app (`web/public/app/`)
- [ ] Server (`web/`)
- [ ] `shared/` — the rules every platform uses

If `shared/` changed, did you regenerate the copies instead of editing them?

- [ ] Ran `npm run sync:web`
- [ ] Ran `npm run sync:android`

## Keys and private data

<!-- If this touches secrets, cloud config, or web/firestore.rules, confirm
nothing new is exposed: no key in the diff, no cloud.json, no key sent to the
server or logged. Delete this section if not applicable. -->

## Testing

<!-- Which suites ran, and which platforms did you try by hand? -->

- [ ] `npm test`
- [ ] `npm run test:e2e`
- [ ] `npm run android:test`
- [ ] `npm run test:firestore` (if `web/` changed)
- [ ] Worked through the matching `docs/manual-checklist*.md`

## Checklist

- [ ] Focused on one change; unrelated cleanup split out
- [ ] Tests added or updated for behaviour changes
- [ ] Comments explain *why*, matching the surrounding code
- [ ] No dependency added without a stated reason, and none copyleft
- [ ] README or `web/README.md` updated if setup or behaviour changed
