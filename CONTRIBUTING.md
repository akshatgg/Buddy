# Contributing to Buddy

Thanks for wanting to help. Buddy is MIT-licensed and open to changes of any
size — bug fixes, platform coverage, docs, or a feature you wish existed.

## Before you start

- **Bugs and small fixes** — open a PR directly.
- **New features or big refactors** — open an issue first so we agree on the
  approach before you spend time on it. Buddy runs in four places that share one
  set of rules, and a change in the wrong layer costs more than it looks.
- **Security issues** — please don't open a public issue. Email
  [akshatg9636@gmail.com](mailto:akshatg9636@gmail.com).

## The shape of the codebase

One set of behaviour, four front ends:

| Where | What |
|---|---|
| `src/main/` | Electron main process — windows, menus, AI calls, cloud, agent |
| `src/renderer/` | The desktop UI: `buddy`, `bubble`, `ear`, `admin`, `common` |
| `src/native/` | Swift helper (`bin/buddy-helper`) and the Windows helper |
| `shared/` | **The source of truth** for logic every platform shares |
| `web/` | Server (Vercel functions + Firestore) *and* the download site |
| `web/public/app/` | The iPhone app — a web app, not native |
| `android/` | The Kotlin app |

`shared/` is the important one. `web/shared/` and the Android copy are
**generated** — never edit them by hand:

```sh
npm run sync:web      # shared/ -> web/shared
npm run sync:android  # shared/ -> android/
```

`test/` checks that the copies have not drifted, so CI will catch a hand edit,
but it is quicker to just run the sync script.

## Getting set up

```sh
git clone https://github.com/akshatgg/Buddy.git
cd Buddy
npm install
npm run build:native   # compiles the native helper -> bin/
npm start              # builds the helper again, then opens the app
```

A build needs `cloud.json` at the repository root to find and sign in to the
server. It is **not in git**: copy `cloud.example.json` and fill it in. A build
without a valid one fails on purpose (`build/afterPack.js`).

The server and site are a second project in `web/` with its own `package.json`:

```sh
cd web && npm install
npm run test:firestore   # needs the Firebase CLI and Java 21+ (emulator)
npm run deploy:server    # from the root: sync, then deploy
```

Android needs Android Studio's JDK and the Android SDK:

```sh
npm run sync:android
npm run android:test
npm run android:build
```

## Tests

```sh
npm test           # eslint + node:test
npm run test:e2e   # opens the real app with fakes, runs test/e2e/checks
npm run android:test
```

`npm run test:e2e` briefly opens Buddy's windows on screen. Both it and `npm
test` run on macOS and Windows.

Some things only a person can check. If you touched them, work through the
matching list in `docs/` — `manual-checklist.md` (Mac),
`manual-checklist-windows.md`, `manual-checklist-android.md`,
`manual-checklist-iphone.md` — and say in the PR what you did.

## Style

- Match the surrounding code — naming, structure, and comment density. Comments
  here explain *why*.
- No new dependencies unless there's a real reason. This ships as a desktop app,
  an APK, and a static site; every dependency is a supply-chain and size cost in
  four places.
- No GPL/AGPL dependencies — they can't be shipped under MIT.
- The `.glb` characters keep their node contract (`Root`, `Head`, `ArmL`,
  `ArmR`, mesh `Face` with morph targets `blink`, `smile`, `mouthO`, `eyeLUp`,
  `eyeRUp`); `test/characters.test.js` enforces it.
- Keep `master` shippable.

## Keys and private data

- `cloud.json` and `android/cloud.properties` stay out of git. So does the voice
  model in `release/voice-model/`.
- A user's own AI key stays on their device. Never send one to the server, log
  it, or put one in a test, a fixture, or a screenshot.
- The server's AI key lives in Vercel. Never inline it.
- `web/firestore.rules` is the only thing protecting user data — treat a change
  there as a security change and explain it in the PR.

## Commits and PRs

- [Conventional Commits](https://www.conventionalcommits.org/):
  `fix:`, `feat:`, `chore:`, `docs:`, `refactor:`, `test:`.
- One logical change per PR. Unrelated cleanup goes in its own PR.
- Fill in the PR template — especially **how you tested it**, and which
  platforms you touched.
- Reference the issue with `Closes #123` when applicable.

## License

By contributing you agree your contribution is licensed under the
[MIT License](LICENSE) and that you have the right to submit it.
