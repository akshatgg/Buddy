# Buddy — Settings polish: profile, sidebar, shortcut recorder, one look — Design

Date: 2026-10-07
Status: approved in chat ("do it")
Builds on: Phase 1 (`2026-10-06-buddy-v1-mac-design.md`) and Phase 2 (`2026-10-07-buddy-phase-2-free-mode-design.md`), both on master.

## 1. Goal

Make Buddy's windows look like a professional Mac app, give the signed-in person a profile with Sign out, and let
them set the shortcut by pressing it instead of typing its name.

## 2. Settings window: a sidebar

The window becomes ~760×560 with two parts.

**Sidebar (left, ~220 pt):**
- **Profile** at the top: the person's Google photo, round (their initials in a coloured circle when there is no
  photo or it fails to load), their name, and their email (shortened with "…" when long).
- **Sections:** Buddy · Shortcut · AI · Permissions · General, each with a small icon; the chosen one is highlighted.
  The arrow keys move between them.
- **Bottom:** **Sign out**. Signed out, it is **Sign in with Google** (and "This copy of Buddy isn't set up for
  sign-in." when cloud.json is missing). Status lines from signing in or out appear under the button.

**Content (right):** the chosen section, with its title.
- **Buddy:** the robots as cards, the name, and the size as a Small / Medium / Large segmented control.
- **Shortcut:** the recorder (§3).
- **AI:** the free-mode note and the key form, exactly as today (the four AI choices, key, model).
- **Permissions:** Accessibility and Screen Recording rows, each with a status badge — green "Allowed" or grey
  "Not allowed" — and an Allow button while not allowed.
- **General:** an on/off switch for "Always on" (with today's explanation), and the app's version.

Settings opens on Buddy. When the panel's "Open Settings" button answers a key or model problem (`no_key`,
`bad_key`, `no_credit`, `bad_model`, `no_vision`, `need_key`, `free_off`), Settings opens on **AI**. The last
chosen section is remembered while the window stays open.

## 3. Shortcut recorder

- The box shows the shortcut as key caps in the Mac's order and symbols: ⌃ ⌥ ⇧ ⌘, then the key (e.g. **⌥ Space**,
  **⇧ ⌘ B**, **⌃ ↑**).
- Click it (or focus it and press Return or Space): it says **"Press your shortcut…"** with an accent outline.
  While it waits, Buddy lets go of its global shortcut, so pressing the current one doesn't open the panel; it is
  taken back whenever the waiting ends (saved, cancelled, the window loses focus or closes).
- Pressing keys: held modifiers show live. A combination is complete when a non-modifier key is pressed with at
  least one of ⌘ ⌥ ⌃ (⇧ alone is not enough: it would take over typing capitals). F1–F24 may be used alone.
  Allowed keys: letters, digits, Space, F1–F24, arrows, Return, Tab, Delete/Backspace, and - = [ ] \ ; ' , . / `.
- Shortcuts that every app uses are refused, before any registration is tried, and the box goes on waiting: ⌘C (Copy),
  ⌘V (Paste), ⌘X (Cut), ⌘Z (Undo), ⇧⌘Z (Redo), ⌘A (Select All), ⌘Q (Quit), ⌘W (Close Window), ⌘S (Save), ⌘H (Hide),
  ⌘M (Minimise), ⌘Tab (switching apps) and ⌘Space (Spotlight); the last two are the Mac's own. The line under the box
  says what the shortcut does: "<keys> is used by every app (<what it does>). Pick another one.", for example "⌘C is
  used by every app (Copy). Pick another one." The same keys with other modifiers are ordinary shortcuts (⌥⌘C, ⌃C).
- A complete combination is **saved at once** (`settings:set { shortcut }`, the same rules as today). If the
  system or another app owns it, the box goes back to the old shortcut, which stays the saved one, and says, keys
  first, "<keys> is taken. Try another one.", for example "⌃ ⌘ K is taken. Try another one."
- **Esc** cancels and keeps the old one. A **"Reset to ⌥ Space"** link restores the default.
- Shortcuts are stored as Electron accelerators (`Command+Shift+B`, `Alt+Space`), so the saved settings stay
  compatible.

## 4. Profile data

Firebase's sign-in answer includes the Google photo (`photoUrl`). Buddy keeps it with the uid, email and name in
`account.json` (only an `https:` URL; anything else is dropped). People signed in before this change see their
initials until they next sign in. The Settings page may load images from `https://*.googleusercontent.com` (its
content-security policy allows that host for images only).

## 5. One look for every window

A shared style in `src/renderer/common/base.css`: macOS-like spacing (an 8 pt grid), the system font, the existing
teal accent, refined light and dark colours, and reusable pieces — buttons (normal, primary, quiet), a toggle
switch, a segmented control, status badges, grouped rows with separators, key caps, an avatar. Then:
- **Settings:** the sidebar layout above.
- **Welcome:** the same look; a step indicator (dots) above the steps; buttons and fields from the shared style.
- **Admin:** the same look; the Free AI switches as grouped rows; the users table styled to match.
- **Panel:** the shared colours and buttons; its tabs drawn as a segmented control. Its layout and size stay.
Every element id the pages and tests use stays, unless a test is updated with it.

## 6. Out of scope

A web dashboard, avatars uploaded by the user, editing the Google name, more sections, animations beyond simple
transitions, window resizing. (A small loading spinner, such as the panel's while it thinks, is allowed: it is the usual
sign that something is under way, and it stands still for someone who asks for less motion.)

## 7. Testing

- Unit: the key-to-shortcut mapping and the symbols (every allowed key, modifiers, refused combinations); the
  shortcut pause/resume IPC (only the Settings window; resume puts back the saved shortcut while Buddy is on, and
  nothing while it is off); the photo in the sign-in answer, in account.json and in the snapshot; the section hint
  from the panel's error codes.
- e2e: the sidebar shows the profile and moves between sections; Sign out and Sign in from the sidebar; the
  recorder records a synthetic ⌘⇧B and saves it, Esc cancels, the default is restored; the existing checks pass with
  their selectors updated where the pages changed.
- Screens: each window checked in light and dark mode (screenshots in the report).
- Manual: real key presses (including ⌘ Space being refused), the real Google photo.
