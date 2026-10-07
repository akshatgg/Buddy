'use strict';
/* global module */
/* exported updateView */

/**
 * What Settings shows for Update now's state (src/main/updates.js createUpdater): a line under the version, and a row
 * with a button while a newer Buddy is out. The Settings page loads this as a script; the unit tests require it.
 *
 *   { line, lineKind: 'muted' | 'good' | 'error', checking, row: null | { title, detail, button, disabled } }
 */
function updateView(state) {
  const view = { line: '', lineKind: 'muted', row: null, checking: false };
  if (!state) return view;
  const { status, latest, kind, pending } = state;
  const pct = Math.round((state.progress ?? 0) * 100);
  const newer = latest && latest.version !== state.currentVersion ? latest.version : null;
  const title = newer ? `Buddy ${newer} is available` : '';

  if (status === 'checking') return { ...view, line: 'Checking for updates…', checking: true };
  if (status === 'current') return { ...view, line: 'You have the newest version.', lineKind: 'good' };
  if (status === 'error') {
    return newer
      ? { ...view, row: { title, detail: `${String(state.error || 'The update failed').replace(/\.$/, '')}. Update now tries again.`, button: 'Update now', disabled: false } }
      : { ...view, line: state.error || 'Could not check for updates.', lineKind: 'error' };
  }
  if (!newer) return view;
  if (status === 'available' && kind === 'download') {
    return { ...view, row: { title, detail: 'Download it and replace the Buddy in your Applications folder.', button: 'Download', disabled: false } };
  }
  if (status === 'downloading') {
    return pending
      ? { ...view, row: { title, detail: `Downloading… ${pct}%`, button: `Updating… ${pct}%`, disabled: true } }
      : { ...view, row: { title, detail: `Downloading… ${pct}%`, button: 'Update now', disabled: false } };
  }
  if (status === 'ready') {
    return { ...view, row: { title, detail: 'Ready. Update now installs it and opens Buddy again.', button: 'Update now', disabled: false } };
  }
  return { ...view, row: { title, detail: '', button: 'Update now', disabled: false } };
}

if (typeof module !== 'undefined') module.exports = updateView;
