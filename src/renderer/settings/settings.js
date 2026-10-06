'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
let snap = null;

function render() {
  renderBuddyGrid($('buddies'), snap.characters, snap.settings.buddyId, (c) => save({ buddyId: c.id }));
  $('name').value = snap.settings.buddyName;
  $('size').value = snap.settings.size;
  $('shortcut').value = snap.settings.shortcut;
  $('power').textContent = snap.buddyOn ? 'Turn off buddy' : 'Turn on buddy';
  $('power-status').textContent = snap.buddyOn
    ? 'Your buddy is on, and comes back every time your Mac starts.'
    : 'Your buddy is off.';
}

async function save(patch, statusId) {
  const r = await window.buddy.set(patch);
  if (statusId) {
    $(statusId).textContent = r.ok ? 'Saved ✓' : r.error.message;
    $(statusId).className = r.ok ? 'good' : 'error';
  }
  if (r.ok) {
    snap = r;
    render();
  }
}

async function renderPermissions() {
  const r = await window.buddy.permissions();
  for (const which of ['accessibility', 'screenRecording']) {
    const granted = Boolean(r.ok && r[which]);
    $(`perm-${which}`).textContent = granted ? 'Allowed ✓' : 'Not allowed';
    $(`perm-${which}-btn`).hidden = granted;
  }
}

$('name').addEventListener('change', () => save({ buddyName: $('name').value }, 'name-status'));
$('size').addEventListener('change', () => save({ size: $('size').value }));
$('shortcut-save').addEventListener('click', () => save({ shortcut: $('shortcut').value.trim() }, 'shortcut-status'));
$('power').addEventListener('click', async () => {
  const r = await window.buddy.setBuddyOn(!snap.buddyOn);
  if (r.ok) {
    snap = r;
    render();
  }
});
for (const which of ['accessibility', 'screenRecording']) {
  $(`perm-${which}-btn`).addEventListener('click', async () => {
    await window.buddy.requestPermission(which);
    await window.buddy.openPermissionSettings(which);
  });
}
// Coming back from System Settings: show what changed.
window.addEventListener('focus', renderPermissions);

(async () => {
  snap = await window.buddy.get();
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
})();
