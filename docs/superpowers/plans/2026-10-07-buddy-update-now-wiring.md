# Update now wiring Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Connect the ported updater (`src/main/updates.js`) to Buddy: installer names, IPC, the Settings window, the menu bar menu, the launch dialog, and the permissions prompt after a Mac update.

**Architecture:** `src/main/ipc/updates.js` (from Loupe) owns Update now, the once-per-launch dialog, the hourly check and the install on quit. `main.js` creates the updater (only a packaged app checks by itself; a development run never installs), pushes every state change to the Settings window and the tray. The Settings page renders the state through a pure `update-view.js`, tested in Node.

**Tech Stack:** Electron 44, CommonJS, `node --test`, ESLint.

## Global Constraints

- Installer names: `Buddy-arm64.dmg`, `Buddy-Setup-x64.exe` (`updates.js` `MAC_DMGS`, `WINDOWS_INSTALLER`).
- Messages in plain words; the Settings IPC answers `{ ok, ... }` through `guarded` (`src/main/ipc/result.js`).
- Updates IPC is for the Settings window only.
- A development run (`!app.isPackaged`) never downloads or installs: its kind is `download`, and it makes no automatic check.
- No Co-Authored-By line and no mention of Claude as an author in commits or files.

### Task 1: Installer names
- [ ] Test (`test/release-names.test.js`): `electron-builder.config.js` `dmg.artifactName` with arch `arm64`/ext `dmg` equals `MAC_DMGS.arm64`; `nsis.artifactName` with `x64`/`exe` equals `WINDOWS_INSTALLER`. Fails.
- [ ] Add `artifactName: 'Buddy-${arch}.${ext}'` to `dmg`, `artifactName: 'Buddy-Setup-${arch}.${ext}'` to `nsis`. Passes. Commit.

### Task 2: Updates IPC
- [ ] Port `test/updates-ipc.test.js` from Loupe (Buddy names; `allowed`; set-auto; handlers called with a fake event). Fails.
- [ ] `src/main/ipc/updates.js`: `registerUpdatesIpc({ ipcMain, electron, getUpdater, allowed, store, isBusy })` → `{ launchCheck, stateChanged, updateNow }`; channels `updates:state|check|install|open-release-page|set-auto`; dialog once per launch (Mac: `app.focus({ steal: true })` first); install on `will-quit`. Passes. Commit.

### Task 3: Settings window and menu
- [ ] `settings-windows.js` gets `send(channel, payload)` (every open window) + test.
- [ ] `tray.js` `buildMenuTemplate` takes `update: { version, busy, progress } | null` → first item "Update now (Buddy X)" / "Updating… N%" (disabled), then a separator; test.
- [ ] `src/renderer/common/update-view.js`: `updateView(state)` → `{ line, lineKind, row: null | { title, detail, button, disabled, notes } }`; test.
- [ ] Settings page, General section: Version row with status line and **Check now**; the update row (**What's new**, **Update now**); "Check for updates automatically" switch. Permissions section: the "Buddy was updated" note when `snap.justUpdated` and Accessibility is off. Preload: `updates`, `checkUpdates`, `installUpdate`, `openReleaseNotes`, `setAutoUpdates`, `onUpdates`.
- [ ] Commit.

### Task 4: main.js
- [ ] Create the updater (`currentVersion` from package.json, `fetch`, temp download folder, `bundle` from `replaceableBundle` when packaged on the Mac, `platform: 'development'` when not packaged, `spawn`, `promisify(execFile)`), `onChange` → `ipc.stateChanged`, `windows.send('updates:changed')`, `tray.refresh()`.
- [ ] `justUpdated = firstLaunchOfNewVersion(store, version)` → `registerSettingsIpc({ justUpdated })`; on the Mac, onboarded, with Accessibility off → `openSettings('permissions')`.
- [ ] `launchCheck()` only when packaged. `npm test` passes. Commit.

### Task 5: Docs
- [ ] README "Releases" section; the manual checklists get Update now items. Commit.
