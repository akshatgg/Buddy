# Buddy website — Design

Date: 2026-10-07
Status: approved in chat (look A, "Warm & friendly", picked from three samples shown on laptop, tablet and phone)

## 1. Goal

A public website where people learn what Buddy does and download it. Mac is downloadable now; Windows,
iPhone and Android show "Coming soon". The look is Buddy's own: cream, Aarav's orange, Anaya's pink and
the visor's dark brown, with rounded shapes and the 3D buddies on the page.

### Out of scope

Voice input in the app (its own spec, next), an email waitlist, a Windows download, blog or docs pages,
analytics, a paid domain.

## 2. Where it lives

Static files in `web/public/`, served by the existing Vercel project `buddy-server` (root directory `web/`,
`outputDirectory: "public"`). The API routes under `/api/` do not change. Plain HTML, CSS and one small
script, no build step, no framework (the Loupe and Souffleur sites work the same way).

Address: a free `*.vercel.app` name added to the project (first choice `buddyapp.vercel.app`, else the closest
free one). The app's `serverUrl` (`cloud.json`) stays as it is.

```
web/public/
  index.html           the home page
  privacy.html         the privacy page (served as /privacy with cleanUrls)
  style.css            both pages
  site.js              enhancements only; both pages read and work without it
  img/aarav.webp       720 px, the boy buddy (from assets/buddies/previews)
  img/anaya.webp       720 px, the girl buddy
  img/icon.webp        256 px app icon for the header and footer
  favicon-32.png, apple-touch-icon.png (180), icon-192.png, icon-512.png
  og.png               1200x630 link preview
  site.webmanifest, robots.txt, sitemap.xml
```

`web/vercel.json` gains `cleanUrls`, long cache headers for images, and the manifest's content type.
Its existing headers (`nosniff`, `Referrer-Policy: no-referrer`) stay for every path.

## 3. The home page

Sections, top to bottom, with the words of sample A:

1. **Header** — icon + Buddy; Features, How it works, Buddies, FAQ; a Download button. The links hide on phones.
2. **Hero** — "Your English buddy, on every screen." The chip "Free for Mac · Windows soon", the lead
   (English, Hindi or Hinglish; writes, fixes, pastes back), **Download for Mac** and **See how it works**,
   and the line "For Macs with an Apple chip (M1 or newer) on macOS 14 or later." Beside it, a Gmail draft
   Buddy just filled ("Leave tomorrow", with `[Manager's name]`, `[date]`, `[Your name]` blanks), the
   "You typed: boss ko mail likho, kal chutti chahiye" bubble, and Aarav floating.
3. **Works wherever you type** — Gmail, WhatsApp, Outlook, Slack, LinkedIn, Teams, Notes, Word (text only,
   no logos).
4. **What Buddy does** — Write for me (tones Formal / Friendly / Short), Fix my English (before / after),
   Check screen ("Has problems" + points), **Speak to Buddy** with a "Coming soon" tag until voice ships.
5. **Three steps, any app** — Open Buddy (click it or ⌥ Space), Ask in your words, Press Insert.
6. **Meet Aarav and Anaya** — both buddies, the moods (Thinking, Happy, Sleepy when offline, Waves hello).
7. **What you write stays yours** — nothing kept on the server; one Google sign-in counts free answers;
   your own key (Claude, OpenAI, Gemini or Groq). Links to the privacy page.
8. **Get Buddy** — Mac tile with the download button, the file name, version and size; Windows ("For Windows
   PCs"), iPhone ("As a keyboard"), Android ("Floating buddy"), each "Coming soon". Below: the first-open
   note (System Settings → Privacy & Security → **Open Anyway**).
9. **Questions** — Is Buddy free? Which apps? Intel Mac? Do you save what I write?
10. **Footer** — icon, © 2026 Buddy, Download, FAQ, Privacy, GitHub.

Layout breakpoints as in the sample: one column under 980 px, phone tweaks under 640 px. Motion (the float,
the voice bars) stops under `prefers-reduced-motion`. Text is real HTML, so the page is readable and
searchable; the decorative demo is `aria-hidden`, and every image has an `alt` or is marked decorative.

## 4. Downloads

The Mac button links to

    https://github.com/akshatgg/Buddy/releases/latest/download/Buddy-arm64.dmg

so it always gives the newest release with no change to the site. For that the DMG gets a fixed name:
`electron-builder.config.js` sets `dmg.artifactName: 'Buddy-${arch}.${ext}'`, and the README follows.

`site.js` (all optional):

- Reads `https://api.github.com/repos/akshatgg/Buddy/releases/latest`. When the release has
  `Buddy-arm64.dmg`, it shows "Version 0.1.0 · 120 MB" under the button. When the release has no such file,
  the Mac buttons lead to the releases page instead. When the request fails, nothing changes.
- On Windows: a note under the hero buttons, "Buddy for Windows is coming soon. Right now it runs on Mac."
  On an iPhone, iPad or Android phone: "Buddy is for Mac right now. iPhone and Android are coming soon."

## 5. The privacy page

Plain words, from the Phase 2 data design:

- **What Buddy keeps** (Firestore, on Google Cloud): your Google name and email, when you joined and were
  last active, how many free answers you used today, and whether the admin blocked the account.
- **What Buddy never keeps:** what you write, your screenshots, the answers, your AI key (it stays on your
  Mac, encrypted).
- **Where your text goes:** to the AI that writes the answer (the one Buddy's free mode uses, or the one
  whose key you added), only to get that answer.
- **Your Mac:** Accessibility to copy and paste; Screen Recording only for Check screen.
- **Deleting your data:** email the admin address; the account record is removed.
- Contact: akshatg9636@gmail.com.

## 6. Link previews and icons

`og.png` is rendered once from an HTML card in the site's look (headless Chrome), checked into git.
Favicons and touch icons come from `build/icon.png` with `sips`. Open Graph and Twitter card tags on both
pages; `site.webmanifest` with the cream theme colour.

## 7. Testing

`test/site.test.js` (runs in `npm test`):

- every local `src`/`href` in both pages points to a file that exists in `web/public/`;
- the Mac download link's file name equals the name `electron-builder.config.js` produces for arm64;
- no `{{` placeholders are left, and every `<img>` has an `alt`.

ESLint covers `web/public/site.js` as a browser script. Before going live: the pages are checked at 1280,
820 and 390 px for sideways scrolling and looked at in a browser on localhost.

## 8. Going live (each step asks the owner first)

1. `npm run dist:mac` → `release/Buddy-arm64.dmg`.
2. `gh release create v0.1.0` with the DMG.
3. `npm run deploy:server` (deploys site and server together), then add the `*.vercel.app` name.
