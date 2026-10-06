'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
let snap = null;
let gridBuilt = false;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one

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

/** Who is signed in, and the button that changes it. */
function renderAccount() {
  const { account, canSignIn } = snap;
  let line = 'Sign in with Google to use your buddy.';
  if (account.signedIn) line = account.name ? `Signed in as ${account.name} (${account.email})` : `Signed in as ${account.email}`;
  else if (!canSignIn) line = "This copy of Buddy isn't set up for sign-in.";
  $('account-line').textContent = line;
  $('sign-in').hidden = account.signedIn || !canSignIn;
  $('sign-out').hidden = !account.signedIn;
}

/** What free mode means for this person, and whether they need the key form. */
function renderAi() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
  $('ai').hidden = !snap.ai.showForm;
}

/** Show `snap`. With `fields: false` the text boxes are left alone: a refresh must not throw away what is being typed. */
function render({ fields = true } = {}) {
  renderAccount();
  renderAi();
  if (gridBuilt) {
    // Only move the check: rebuilding the radio buttons would drop the keyboard focus that is on one of them.
    for (const radio of $('buddies').querySelectorAll('input')) radio.checked = radio.value === snap.settings.buddyId;
  } else {
    renderBuddyGrid($('buddies'), snap.characters, snap.settings.buddyId, (c) => save({ buddyId: c.id }, 'buddy-status'));
    gridBuilt = true;
  }
  if (fields) {
    $('name').value = snap.settings.buddyName;
    $('size').value = snap.settings.size;
    $('shortcut').value = snap.settings.shortcut;
  }
  $('power').textContent = snap.buddyOn ? 'Turn off buddy' : 'Turn on buddy';
  showStatus(
    'power-status',
    snap.buddyOn ? 'Your buddy is on, and comes back every time your Mac starts.' : 'Your buddy is off.',
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
  const r = await window.buddy.permissions();
  for (const which of ['accessibility', 'screenRecording']) {
    const granted = Boolean(r.ok && r[which]);
    $(`perm-${which}`).textContent = granted ? 'Allowed ✓' : 'Not allowed';
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

$('sign-in').addEventListener('click', async () => {
  showStatus('account-status', 'Finish signing in in your browser…', 'muted');
  signingIn += 1;
  let r;
  try {
    r = await window.buddy.signIn();
  } finally {
    signingIn -= 1;
  }
  if (r.ok) {
    snap = r;
    render();
    showStatus('account-status', 'Signed in ✓', 'good');
  } else if (r.error.code !== 'sign_in_cancelled') {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    showStatus('account-status', r.error.message, 'error');
  }
});
$('sign-out').addEventListener('click', async () => {
  const r = await window.buddy.signOut();
  if (!r.ok) {
    showStatus('account-status', r.error.message, 'error');
    return;
  }
  snap = r;
  render();
  showStatus('account-status', 'Signed out.', 'muted');
});
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
// Coming back to this window: System Settings may have changed the permissions, and the account may have changed
// behind this page's back (a sign-in that expired, or one that another window ended). Show what changed. What is being
// typed stays, and a sign-in that waits for the browser answers by itself.
window.addEventListener('focus', async () => {
  renderPermissions();
  if (signingIn || !snap?.ok) return;
  const fresh = await window.buddy.get();
  if (signingIn || !fresh.ok) return;
  const changed = fresh.account.signedIn !== snap.account.signedIn;
  snap = fresh;
  render({ fields: false });
  if (changed) showStatus('account-status', '', 'muted'); // what it said ("Signed in ✓", an error) no longer holds
});

(async () => {
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
  // The admin may have changed free mode since the app last asked.
  const fresh = await window.buddy.refresh();
  if (fresh.ok) {
    snap = fresh;
    render();
  }
})();
