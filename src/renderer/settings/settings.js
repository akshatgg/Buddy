'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
let snap = null;
let gridBuilt = false;

// Windows asks for no permissions, and its shortcuts are written with Ctrl.
const onWindows = () => snap?.platform === 'win32';
const WINDOWS_SHORTCUT_HINT = 'Press it in any app to open your buddy. For example: Ctrl+Shift+Space or Ctrl+Alt+B';

function showStatus(id, text, kind) {
  $(id).textContent = text;
  $(id).className = kind;
}

/** Shown in place of the page when its settings cannot be loaded. */
function showLoadError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('main').replaceChildren(p);
}

function render() {
  if (gridBuilt) {
    // Only move the check: rebuilding the radio buttons would drop the keyboard focus that is on one of them.
    for (const radio of $('buddies').querySelectorAll('input')) radio.checked = radio.value === snap.settings.buddyId;
  } else {
    renderBuddyGrid($('buddies'), snap.characters, snap.settings.buddyId, (c) => save({ buddyId: c.id }, 'buddy-status'));
    gridBuilt = true;
  }
  $('name').value = snap.settings.buddyName;
  $('size').value = snap.settings.size;
  $('shortcut').value = snap.settings.shortcut;
  if (onWindows()) $('shortcut-hint').textContent = WINDOWS_SHORTCUT_HINT;
  $('permissions-card').hidden = onWindows();
  $('power').textContent = snap.buddyOn ? 'Turn off buddy' : 'Turn on buddy';
  showStatus(
    'power-status',
    snap.buddyOn ? `Your buddy is on, and comes back every time your ${onWindows() ? 'PC' : 'Mac'} starts.` : 'Your buddy is off.',
    'muted',
  );
}

/** Save a change and say next to its field how it went. Then show what is saved, so a refused change puts the field back. */
async function save(patch, statusId) {
  const r = await window.buddy.set(patch);
  showStatus(statusId, r.ok ? 'Saved ✓' : r.error.message, r.ok ? 'good' : 'error');
  if (r.ok) snap = r;
  render();
}

async function renderPermissions() {
  if (onWindows()) return;
  const r = await window.buddy.permissions();
  for (const which of ['accessibility', 'screenRecording']) {
    const granted = Boolean(r.ok && r[which]);
    $(`perm-${which}`).textContent = granted ? 'Allowed ✓' : 'Not allowed';
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

$('name').addEventListener('change', () => save({ buddyName: $('name').value }, 'name-status'));
$('size').addEventListener('change', () => save({ size: $('size').value }, 'size-status'));
$('shortcut-save').addEventListener('click', () => save({ shortcut: $('shortcut').value.trim() }, 'shortcut-status'));
$('power').addEventListener('click', async () => {
  const r = await window.buddy.setBuddyOn(!snap.buddyOn);
  if (r.ok) {
    snap = r;
    render();
  } else {
    showStatus('power-status', r.error.message, 'error');
  }
});
for (const which of ['accessibility', 'screenRecording']) {
  $(`perm-${which}-btn`).addEventListener('click', async () => {
    const asked = await window.buddy.requestPermission(which);
    const opened = await window.buddy.openPermissionSettings(which);
    const failed = [asked, opened].find((r) => !r.ok);
    showStatus('perm-status', failed ? failed.error.message : '', failed ? 'error' : 'muted');
  });
}
// Coming back from System Settings: show what changed.
window.addEventListener('focus', renderPermissions);

(async () => {
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
})();
