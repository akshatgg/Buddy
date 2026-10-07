'use strict';
/* global mountAiForm, renderBuddyGrid, ShortcutKeys */

const $ = (id) => document.getElementById(id);
const SECTIONS = ['buddy', 'shortcut', 'ai', 'permissions', 'general'];
const DEFAULT_SHORTCUT = 'Alt+Space';
let snap = null;
let gridBuilt = false;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one
let recording = false; // the Shortcut box is waiting for keys

function showStatus(id, text, kind = 'muted') {
  $(id).textContent = text;
  $(id).className = `status small ${kind}`;
}

/** Shown in place of the page when its settings cannot be loaded. */
function showLoadError(message) {
  const p = document.createElement('p');
  p.className = 'error';
  p.textContent = message;
  document.querySelector('.content').replaceChildren(p);
}

// ---- sections ----

function showSection(name) {
  const section = SECTIONS.includes(name) ? name : 'buddy';
  if (recording && section !== 'shortcut') stopRecording();
  for (const s of SECTIONS) {
    $(`section-${s}`).hidden = s !== section;
    const item = document.querySelector(`.nav-item[data-section="${s}"]`);
    item.classList.toggle('active', s === section);
    if (s === section) item.setAttribute('aria-current', 'page');
    else item.removeAttribute('aria-current');
  }
}

const navItems = [...document.querySelectorAll('.nav-item')];
for (const item of navItems) {
  item.addEventListener('click', () => showSection(item.dataset.section));
  item.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const next = navItems[(navItems.indexOf(item) + (e.key === 'ArrowDown' ? 1 : navItems.length - 1)) % navItems.length];
    next.focus();
    showSection(next.dataset.section);
  });
}
window.buddy.onSection((name) => showSection(name));

// ---- the profile ----

function initials(name, email) {
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map((w) => w[0]) : [String(email || '').charAt(0)];
  return letters.join('').toUpperCase();
}

function showPhoto(url) {
  const img = $('avatar-img');
  if (!url) {
    img.hidden = true;
    img.removeAttribute('src');
    return;
  }
  if (img.getAttribute('src') !== url) {
    img.hidden = true; // shown once it has loaded; the initials stay underneath until then, and if it fails
    img.src = url;
  }
}
$('avatar-img').addEventListener('load', () => { $('avatar-img').hidden = false; });
$('avatar-img').addEventListener('error', () => { $('avatar-img').hidden = true; });

function renderAccount() {
  const { account, canSignIn } = snap;
  if (account.signedIn) {
    $('profile-name').textContent = account.name || account.email;
    $('profile-email').textContent = account.name ? account.email : '';
    $('avatar-initials').textContent = initials(account.name, account.email);
    showPhoto(account.photo);
  } else {
    $('profile-name').textContent = 'Not signed in';
    $('profile-email').textContent = canSignIn ? 'Sign in with Google to use your buddy.' : "This copy of Buddy isn't set up for sign-in.";
    $('avatar-initials').textContent = '';
    showPhoto('');
  }
  $('sign-in').hidden = account.signedIn || !canSignIn;
  $('sign-out').hidden = !account.signedIn;
}

// ---- the rest of the page ----

function renderAi() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
  $('ai').hidden = !snap.ai.showForm;
}

function showKeys(accelerator) {
  $('shortcut-keys').replaceChildren(
    ...ShortcutKeys.symbols(accelerator).map((k) => Object.assign(document.createElement('kbd'), { textContent: k })),
  );
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
  if (fields) $('name').value = snap.settings.buddyName;
  for (const radio of $('size').querySelectorAll('input')) radio.checked = radio.value === snap.settings.size;
  if (!recording) showKeys(snap.settings.shortcut);
  $('power').checked = snap.buddyOn;
  $('power-status').textContent = snap.buddyOn
    ? 'Your buddy is on, and comes back every time your Mac starts.'
    : 'Your buddy is off.';
  $('version').textContent = snap.version ? `Buddy ${snap.version}` : '';
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
    $(`perm-${which}`).textContent = granted ? 'Allowed' : 'Not allowed';
    $(`perm-${which}`).className = `badge ${granted ? 'good' : 'off'}`;
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

// ---- the shortcut recorder ----

async function startRecording() {
  if (recording) return;
  recording = true;
  $('shortcut').classList.add('recording');
  $('shortcut-keys').textContent = 'Press your shortcut…';
  showStatus('shortcut-status', '');
  await window.buddy.pauseShortcut();
}

async function stopRecording() {
  if (!recording) return;
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(snap.settings.shortcut);
  await window.buddy.resumeShortcut();
}

async function saveShortcut(accelerator) {
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(accelerator);
  const r = await window.buddy.set({ shortcut: accelerator });
  if (r.ok) {
    snap = r;
    showStatus('shortcut-status', 'Saved ✓', 'good');
  } else {
    showKeys(snap.settings.shortcut);
    const keys = ShortcutKeys.symbols(accelerator).join(' ');
    showStatus('shortcut-status', r.error.code === 'shortcut_taken' ? `${keys} is taken. Try another one.` : r.error.message, 'error');
  }
  await window.buddy.resumeShortcut(); // the saved shortcut is registered again (the new one, or the old one if refused)
}

$('shortcut').addEventListener('click', (e) => {
  if (!recording) startRecording();
  else if (e.detail > 0) stopRecording(); // a mouse click ends it; Return or Space while recording is a key to record
});
document.addEventListener('keydown', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  if (e.key === 'Escape' && !e.metaKey && !e.altKey && !e.ctrlKey && !e.shiftKey) {
    stopRecording();
    return;
  }
  const r = ShortcutKeys.fromKeyEvent(e);
  if (r.accelerator) {
    saveShortcut(r.accelerator);
    return;
  }
  $('shortcut-keys').textContent = r.held.length ? `${r.held.join(' ')} …` : 'Press your shortcut…';
  if (r.refused) showStatus('shortcut-status', r.refused, 'error');
}, true);
$('shortcut-reset').addEventListener('click', () => saveShortcut(DEFAULT_SHORTCUT));
window.addEventListener('blur', () => { stopRecording(); });

// ---- account, buddy, power, permissions ----

$('sign-in').addEventListener('click', async () => {
  showStatus('account-status', 'Finish signing in in your browser…');
  signingIn += 1;
  let r;
  try {
    r = await window.buddy.signIn();
  } finally {
    signingIn -= 1;
  }
  if (r.ok) {
    snap = r;
    render({ fields: false });
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
  render({ fields: false });
  showStatus('account-status', 'Signed out.');
});
$('name').addEventListener('change', () => save({ buddyName: $('name').value }, 'name-status'));
for (const radio of $('size').querySelectorAll('input')) {
  radio.addEventListener('change', () => save({ size: radio.value }, 'size-status'));
}
$('power').addEventListener('change', async () => {
  const want = $('power').checked;
  const r = await window.buddy.setBuddyOn(want);
  if (r.ok) {
    snap = r;
    render({ fields: false });
  } else {
    $('power').checked = !want;
    $('power-status').textContent = r.error.message;
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
// behind this page's back. Show what changed; what is being typed stays, and a waiting sign-in answers by itself.
window.addEventListener('focus', async () => {
  renderPermissions();
  if (signingIn || !snap?.ok) return;
  const fresh = await window.buddy.get();
  if (signingIn || !fresh.ok) return;
  const changed = fresh.account.signedIn !== snap.account.signedIn;
  snap = fresh;
  render({ fields: false });
  if (changed) showStatus('account-status', '');
});

(async () => {
  showSection(location.hash.slice(1));
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  render();
  await renderPermissions();
  await mountAiForm($('ai'));
  // The admin may have changed free mode since the app last asked; what is typed meanwhile stays.
  const fresh = await window.buddy.refresh();
  if (fresh.ok) {
    snap = fresh;
    render({ fields: false });
  }
})();
