'use strict';
/* global mountAiForm, renderBuddyGrid, ShortcutKeys */

const $ = (id) => document.getElementById(id);
const SECTIONS = ['buddy', 'shortcut', 'ai', 'permissions', 'general'];
const DEFAULT_SHORTCUT = 'Alt+Space';
let snap = null;
let gridBuilt = false;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one
let recording = false; // the Shortcut box is waiting for keys
let loadFailed = false; // the settings could not be loaded: the page only says why
const FADE_AFTER_MS = 3000; // how long a success ("Saved ✓") is shown before it fades
const fading = new Map(); // a status line's id -> the timer that fades its success

/**
 * Say on a status line how something went. A section has one line at a time: what its other lines said is about an
 * earlier change, so they are emptied. A success fades after a few seconds; anything else (an error, a wait) stays
 * until the line is used again.
 */
function showStatus(id, text, kind = 'muted') {
  for (const line of $(id).closest('.section')?.querySelectorAll('.status') ?? []) {
    if (line.id !== id) setLine(line.id, '');
  }
  setLine(id, text, kind);
}

function setLine(id, text, kind = 'muted') {
  clearTimeout(fading.get(id));
  fading.delete(id);
  $(id).textContent = text;
  $(id).className = `status small ${kind}`;
  if (kind !== 'good' || !text) return;
  fading.set(id, setTimeout(() => {
    $(id).classList.add('fading'); // settings.css fades it out, then it is emptied
    fading.set(id, setTimeout(() => setLine(id, ''), 300));
  }, FADE_AFTER_MS));
}

/**
 * Shown where the sections were when the settings cannot be loaded. The sections stay in the page, hidden: the
 * sidebar and the window getting the focus back still look them up, and none of them could work, so none is offered.
 */
function showLoadError(message) {
  loadFailed = true;
  for (const s of SECTIONS) $(`section-${s}`).hidden = true;
  for (const item of navItems) {
    item.classList.remove('active');
    item.removeAttribute('aria-current');
  }
  document.querySelector('.content').prepend(Object.assign(document.createElement('p'), {
    className: 'note error load-error', textContent: message,
  }));
}

// ---- sections ----

function showSection(name) {
  if (loadFailed) return; // there is no section to show
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
  // Whole characters, not halves of one: an emoji, or a letter from beyond the basic set, is two units of a string.
  const first = (text) => Array.from(text)[0] || '';
  const words = String(name || '').trim().split(/\s+/).filter(Boolean);
  const letters = words.length ? words.slice(0, 2).map(first) : [first(String(email || ''))];
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
  // A name or an email too long for the sidebar is cut short with "…": the whole of it shows on hover.
  for (const id of ['profile-name', 'profile-email']) $(id).title = $(id).textContent;
  $('sign-in').hidden = account.signedIn || !canSignIn;
  $('sign-out').hidden = !account.signedIn;
}

// ---- the rest of the page ----

function renderAi() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
  $('ai').hidden = !snap.ai.showForm;
}

/** Key caps in the Shortcut box; `waiting` adds a faint "…" cap, for the key still to come. */
function showCaps(caps, { waiting = false } = {}) {
  const cap = (text, className = '') => Object.assign(document.createElement('kbd'), { textContent: text, className });
  $('shortcut-keys').replaceChildren(...caps.map((k) => cap(k)), ...(waiting ? [cap('…', 'waiting')] : []));
}

function showKeys(accelerator) {
  showCaps(ShortcutKeys.symbols(accelerator));
}

/** While recording: the modifiers held so far, as caps, or the prompt while none is. */
function showHeld(held) {
  if (held.length) showCaps(held, { waiting: true });
  else $('shortcut-keys').textContent = 'Press your shortcut…';
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
  $('shortcut').classList.remove('save-failed');
  $('shortcut').classList.add('recording');
  showHeld([]);
  showStatus('shortcut-status', '');
  await window.buddy.pauseShortcut();
}

/** Stop waiting for keys and keep the saved shortcut. A key refused while it waited no longer matters, so its line goes. */
async function stopRecording() {
  if (!recording) return;
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(snap.settings.shortcut);
  showStatus('shortcut-status', '');
  await window.buddy.resumeShortcut();
}

async function saveShortcut(accelerator) {
  recording = false;
  $('shortcut').classList.remove('recording', 'save-failed');
  showKeys(accelerator);
  const r = await window.buddy.set({ shortcut: accelerator });
  if (r.ok) {
    snap = r;
    showStatus('shortcut-status', 'Saved ✓', 'good');
  } else {
    showKeys(snap.settings.shortcut);
    $('shortcut').classList.add('save-failed'); // its edge says so too, until the box is clicked again
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
  showHeld(r.held);
  if (r.refused) showStatus('shortcut-status', r.refused, 'error');
}, true);
// A modifier let go: the caps follow, back to the prompt once none is held.
document.addEventListener('keyup', (e) => {
  if (!recording) return;
  e.preventDefault();
  e.stopPropagation();
  showHeld(ShortcutKeys.heldSymbols(e));
}, true);
$('shortcut-reset').addEventListener('click', () => {
  // However it was spelled when it was saved, ⌥ Space is ⌥ Space: there is nothing to save.
  if (ShortcutKeys.symbols(snap.settings.shortcut).join(' ') === ShortcutKeys.symbols(DEFAULT_SHORTCUT).join(' ')) {
    stopRecording();
    showStatus('shortcut-status', 'Already ⌥ Space.');
    return;
  }
  saveShortcut(DEFAULT_SHORTCUT);
});
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
