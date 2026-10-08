'use strict';
/* global mountAiForm, renderBuddyGrid, ShortcutKeys, updateView */

const $ = (id) => document.getElementById(id);
const SECTIONS = ['buddy', 'shortcut', 'ai', 'memory', 'permissions', 'general'];
// Windows asks for no permissions, and writes its shortcuts with Ctrl, Alt and Shift (shortcut-keys.js).
const onWindows = () => snap?.platform === 'win32';
const shortcutKeys = () => ShortcutKeys.forPlatform(snap?.platform);
// Under the Shortcut box while the shortcut is a key tapped on its own: how to press it, and what macOS also does with
// Caps Lock and fn. Without Accessibility Buddy cannot hear the key at all, and the first line says so instead.
const TAP_NOTE = 'Tap it on its own to open your buddy: press and let go, with no other key.';
const TAP_KEY_NOTES = {
  CapsLock: 'Caps Lock also turns capitals on and off when you tap it.',
  Fn: 'If fn also opens emoji or dictation, set “Press 🌐 key to” to “Do Nothing” in System Settings → Keyboard.',
};
const CANNOT_HEAR = 'Buddy needs Accessibility to hear this key. Allow it in Permissions.';
// While the box waits for keys and Buddy has no Accessibility: a key tapped on its own would never come, and the box
// would just go on waiting. Keys pressed together are heard by the page, and can still be recorded.
const CANNOT_HEAR_TAPS = 'Buddy needs Accessibility to hear a key tapped on its own. Allow it in Permissions.';
let snap = null;
let gridBuilt = false;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one
let recording = false; // the Shortcut box is waiting for keys
let blurEnd = null; // the timer that ends a recording BLUR_GRACE_MS after the window loses the focus
let loadFailed = false; // the settings could not be loaded: the page only says why
let updates = null; // Update now's state (src/main/updates.js), as the main process last sent it
let memory = { facts: [], learning: true }; // Settings → Memory: what Buddy knows (src/main/memory.js), as last sent
let addingFact = false; // a fact typed into Memory is on its way: Return pressed again does not send it twice
// How the microphone stood when the Permissions page last asked: macOS asks about it only once ('not-determined' until
// then); after that, Allow opens System Settings.
let microphone = null;
const FADE_AFTER_MS = 3000; // how long a success ("Saved ✓") is shown before it fades
// A recording does not end the moment the window loses the focus, but this long after: with "Press 🌐 key to: Show Emoji
// & Symbols", tapping fn opens the emoji picker, which takes the focus before the tap has reached the page.
const BLUR_GRACE_MS = 1000;
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
  const section = SECTIONS.includes(name) && !(name === 'permissions' && onWindows()) ? name : 'buddy';
  if (recording && section !== 'shortcut') stopRecording();
  if (section !== 'memory') closeForgetAll(); // "Forget all N things?" is not left waiting in a section out of sight
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
    const shown = navItems.filter((i) => !i.hidden); // Permissions is not there on Windows
    const next = shown[(shown.indexOf(item) + (e.key === 'ArrowDown' ? 1 : shown.length - 1)) % shown.length];
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
  showCaps(shortcutKeys().symbols(accelerator));
}

/** While recording: the modifiers held so far, as caps, or the prompt while none is. */
function showHeld(held) {
  if (held.length) showCaps(held, { waiting: true });
  else $('shortcut-keys').textContent = 'Press your shortcut…';
}

/** The note under the Shortcut box: shown only for a key tapped on its own, in red when Buddy cannot hear it. */
async function renderShortcutNote() {
  const permissions = ShortcutKeys.isTap(snap.settings.shortcut) ? await window.buddy.permissions() : null;
  const keys = ShortcutKeys.tapKeys(snap.settings.shortcut); // after the wait: the shortcut may have changed meanwhile
  const deaf = Boolean(keys && permissions?.ok && !permissions.accessibility);
  // No words while it is hidden: hidden or not, it is part of what describes the Shortcut box (aria-describedby).
  const lines = keys ? [deaf ? CANNOT_HEAR : TAP_NOTE, ...keys.map((k) => TAP_KEY_NOTES[k]).filter(Boolean)] : [];
  const text = lines.join(' ');
  const note = $('shortcut-note');
  note.hidden = !keys;
  // This runs on every focus and every save, and a screen reader reads the note out whenever it is written: so the
  // words and the red are written only when they change.
  if (note.textContent !== text) note.textContent = text;
  if (note.classList.contains('error') !== deaf) note.classList.toggle('error', deaf);
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
  // Where Buddy lives is a choice only on a Mac with a notch screen on now.
  $('home-row').hidden = !snap.hasNotch;
  for (const radio of $('home').querySelectorAll('input')) radio.checked = radio.value === snap.settings.home;
  if (!recording) showKeys(snap.settings.shortcut);
  $('power').checked = snap.buddyOn;
  $('power-status').textContent = snap.buddyOn
    ? `Your buddy is on, and comes back every time your ${onWindows() ? 'PC' : 'Mac'} starts.`
    : 'Your buddy is off.';
  $('version').textContent = snap.version ? `Buddy ${snap.version}` : '';
  $('update-auto').checked = snap.settings.checkForUpdates !== false;
  $('listen-on-open').checked = snap.settings.listenOnOpen !== false;
  const { symbols, defaultShortcut, canTap } = shortcutKeys();
  $('shortcut-reset').textContent = `Reset to ${symbols(defaultShortcut).join(' ')}`;
  // Only the Mac hears a key tapped on its own.
  $('shortcut-hint').textContent = canTap
    ? 'Click the box, then press the keys you want, or tap one key like ⌘ or fn on its own. Esc cancels.'
    : 'Click the box, then press the keys you want. Esc cancels.';
  // Windows asks for no permissions: its sidebar has no Permissions, and a window opened on that section shows Buddy.
  document.querySelector('.nav-item[data-section="permissions"]').hidden = onWindows();
  if (onWindows() && !$('section-permissions').hidden) showSection('buddy');
  renderShortcutNote();
}

/** Save a change and say next to its field how it went. Then show what is saved, so a refused change puts the field back. */
async function save(patch, statusId) {
  const r = await window.buddy.set(patch);
  showStatus(statusId, r.ok ? 'Saved ✓' : r.error.message, r.ok ? 'good' : 'error');
  if (r.ok) snap = r;
  render();
}

async function renderPermissions() {
  if (onWindows()) return; // nothing to ask for, and the section is not shown
  const r = await window.buddy.permissions();
  // Right after an update macOS has forgotten Buddy's permissions (an ad-hoc signed app is a new app to it): say why.
  $('perm-updated').hidden = !(snap?.justUpdated && r.ok && !r.accessibility);
  if (r.ok) microphone = r.microphone;
  for (const which of ['accessibility', 'screenRecording', 'microphone']) {
    // The microphone is described in words ('granted', 'denied', …), the other two as true or false.
    const granted = Boolean(r.ok && (which === 'microphone' ? r.microphone === 'granted' : r[which]));
    $(`perm-${which}`).textContent = granted ? 'Allowed' : 'Not allowed';
    $(`perm-${which}`).className = `badge ${granted ? 'good' : 'off'}`;
    $(`perm-${which}-btn`).hidden = granted;
  }
  showStatus('perm-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
}

// ---- updates ----

/** Show Update now's state: a line under the version, and the row with Update now while a newer Buddy is out. */
function renderUpdates(state) {
  if (state) updates = state;
  const v = updateView(updates);
  $('update-line').textContent = v.line;
  $('update-line').className = `small ${v.lineKind}`;
  $('update-check').disabled = v.checking;
  $('update-row').hidden = !v.row;
  if (!v.row) return;
  $('update-title').textContent = v.row.title;
  $('update-detail').textContent = v.row.detail;
  $('update-now').textContent = v.row.button;
  $('update-now').disabled = v.row.disabled;
}

/** Run an update call; a refused one says why on the section's line, and one that worked clears what it said. */
async function updateCall(call) {
  const r = await call();
  showStatus('update-status', r.ok ? '' : r.error.message, r.ok ? 'muted' : 'error');
  return r;
}

// ---- memory ----

/** Settings → Memory: the facts, each with ✕, or the line that says there are none yet, and the learning switch. */
function renderMemory({ facts = memory.facts, learning = memory.learning }) {
  memory = { facts, learning };
  // The list is made again on every change: the ✕ that had the keyboard focus gets it back, if its fact is still there.
  const focused = document.activeElement?.closest('#memory-list li')?.dataset.id;
  $('memory-list').replaceChildren(...facts.map(factRow));
  if (focused) [...$('memory-list').children].find((li) => li.dataset.id === focused)?.querySelector('button').focus();
  $('memory-list').hidden = !facts.length;
  $('memory-empty').hidden = facts.length > 0;
  $('memory-learning').checked = learning;
  $('memory-forget').disabled = !facts.length;
  if (!facts.length) closeForgetAll();
  else $('memory-confirm-text').textContent = forgetAllQuestion(facts.length);
}

function factRow(fact) {
  const text = Object.assign(document.createElement('p'), { className: 'fact', textContent: fact.text });
  const forget = Object.assign(document.createElement('button'), {
    type: 'button', className: 'btn quiet small forget', textContent: '✕', title: 'Forget this',
  });
  forget.setAttribute('aria-label', `Forget: ${fact.text}`);
  forget.addEventListener('click', () => forgetFact(fact.id));
  const row = Object.assign(document.createElement('li'), { className: 'group-row' });
  row.dataset.id = fact.id;
  row.append(text, forget);
  return row;
}

const forgetAllQuestion = (n) => (n === 1 ? 'Forget the 1 thing?' : `Forget all ${n} things?`);

async function forgetFact(id) {
  const rows = [...$('memory-list').children];
  const at = rows.findIndex((li) => li.dataset.id === id);
  const r = await window.buddy.removeMemory(id);
  if (!r.ok) {
    showStatus('memory-status', r.error.message, 'error');
    return;
  }
  showStatus('memory-status', '');
  renderMemory(r);
  // The ✕ that was clicked is gone: the keyboard focus moves to the ✕ now in its place, or to the add box.
  const left = $('memory-list').querySelectorAll('.forget');
  (left[Math.min(at, left.length - 1)] || $('memory-new')).focus();
}

async function addFact() {
  const text = $('memory-new').value.trim();
  if (!text || addingFact) return;
  addingFact = true;
  let r;
  try {
    r = await window.buddy.addMemory(text);
  } finally {
    addingFact = false;
  }
  if (!r.ok) {
    showStatus('memory-status', r.error.message, 'error');
    return;
  }
  $('memory-new').value = '';
  $('memory-add').disabled = true;
  renderMemory(r);
  showStatus('memory-status', 'Saved ✓', 'good');
}

/** Forget everything asks once more, in its own place: "Forget all N things?" with Cancel and Forget. */
function askForgetAll() {
  $('memory-confirm-text').textContent = forgetAllQuestion(memory.facts.length);
  $('memory-forget').hidden = true;
  $('memory-confirm').hidden = false;
  showStatus('memory-forget-status', '');
  $('memory-confirm-cancel').focus();
}

function closeForgetAll({ focus = false } = {}) {
  if ($('memory-confirm').hidden) return;
  $('memory-confirm').hidden = true;
  $('memory-forget').hidden = false;
  if (focus) $('memory-forget').focus();
}

$('memory-new').addEventListener('input', () => { $('memory-add').disabled = !$('memory-new').value.trim(); });
$('memory-new').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' || e.isComposing) return; // Return belongs to the input method while it is composing
  e.preventDefault();
  addFact();
});
$('memory-add').addEventListener('click', () => addFact());
$('memory-learning').addEventListener('change', async () => {
  const want = $('memory-learning').checked;
  const r = await window.buddy.setMemoryLearning(want);
  if (r.ok) {
    renderMemory(r);
    showStatus('memory-learning-status', 'Saved ✓', 'good');
  } else {
    $('memory-learning').checked = !want;
    showStatus('memory-learning-status', r.error.message, 'error');
  }
});
$('memory-forget').addEventListener('click', () => askForgetAll());
$('memory-confirm-cancel').addEventListener('click', () => closeForgetAll({ focus: true }));
$('memory-confirm').addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  e.preventDefault();
  closeForgetAll({ focus: true });
});
$('memory-confirm-forget').addEventListener('click', async () => {
  const r = await window.buddy.clearMemory();
  if (!r.ok) {
    showStatus('memory-forget-status', r.error.message, 'error');
    return;
  }
  renderMemory(r); // nothing left: the question closes
  showStatus('memory-forget-status', 'Buddy forgot everything.', 'good');
  $('memory-new').focus();
});
// A chat taught Buddy something, or Undo took it back: the list follows.
window.buddy.onMemory((facts) => renderMemory({ facts }));

// ---- the shortcut recorder ----

/** Do not end the recording for the focus the window lost: it has the focus back, or the recording is over anyway. */
function cancelBlurEnd() {
  clearTimeout(blurEnd);
  blurEnd = null;
}

async function startRecording() {
  if (recording) return;
  cancelBlurEnd();
  recording = true;
  $('shortcut').classList.remove('save-failed');
  $('shortcut').classList.add('recording');
  showHeld([]);
  showStatus('shortcut-status', '');
  await window.buddy.pauseShortcut();
  if (!shortcutKeys().canTap) return; // Windows: no key is tapped on its own, and nothing waits on a permission
  const permissions = await window.buddy.permissions();
  if (recording && permissions.ok && !permissions.accessibility) showStatus('shortcut-status', CANNOT_HEAR_TAPS);
}

/** Stop waiting for keys and keep the saved shortcut. A key refused while it waited no longer matters, so its line goes. */
async function stopRecording() {
  cancelBlurEnd();
  if (!recording) return;
  recording = false;
  $('shortcut').classList.remove('recording');
  showKeys(snap.settings.shortcut);
  showStatus('shortcut-status', '');
  await window.buddy.resumeShortcut();
}

async function saveShortcut(accelerator) {
  cancelBlurEnd();
  recording = false;
  $('shortcut').classList.remove('recording', 'save-failed');
  showKeys(accelerator);
  const r = await window.buddy.set({ shortcut: accelerator });
  if (r.ok) {
    snap = r;
    showStatus('shortcut-status', 'Saved ✓', 'good');
    renderShortcutNote();
  } else {
    showKeys(snap.settings.shortcut);
    $('shortcut').classList.add('save-failed'); // its edge says so too, until the box is clicked again
    const keys = shortcutKeys().symbols(accelerator).join(' ');
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
  const r = shortcutKeys().fromKeyEvent(e);
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
  showHeld(shortcutKeys().heldSymbols(e));
}, true);
// A key tapped on its own while the box waits: the Mac helper hears it (the page does not see fn or Caps Lock), and the
// main process sends it here.
window.buddy.onShortcutTap((value) => {
  if (recording) saveShortcut(value);
});
$('shortcut-reset').addEventListener('click', () => {
  // However it was spelled when it was saved, ⌥ Space is ⌥ Space (Ctrl Shift Space on Windows): there is nothing to save.
  const { symbols, defaultShortcut } = shortcutKeys();
  if (symbols(snap.settings.shortcut).join(' ') === symbols(defaultShortcut).join(' ')) {
    stopRecording();
    showStatus('shortcut-status', `Already ${symbols(defaultShortcut).join(' ')}.`);
    return;
  }
  saveShortcut(defaultShortcut);
});
// The window losing the focus ends a recording too, a moment later: a key tapped just then (fn, when macOS opens its emoji
// picker) is still saved. The window getting the focus back keeps the recording (the focus handler below).
window.addEventListener('blur', () => {
  if (!recording) return;
  cancelBlurEnd();
  blurEnd = setTimeout(stopRecording, BLUR_GRACE_MS);
});

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
for (const radio of $('home').querySelectorAll('input')) {
  radio.addEventListener('change', () => save({ home: radio.value }, 'home-status'));
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
// The microphone: macOS asks the person the first time; once they have answered, the switch is in System Settings.
$('perm-microphone-btn').addEventListener('click', async () => {
  const r = microphone === 'not-determined'
    ? await window.buddy.requestPermission('microphone')
    : await window.buddy.openPermissionSettings('microphone');
  await renderPermissions(); // how it stands now that macOS has asked (which empties the line under the rows)
  if (!r.ok) showStatus('perm-status', r.error.message, 'error');
});
$('listen-on-open').addEventListener('change', () => save({ listenOnOpen: $('listen-on-open').checked }, 'listen-status'));
$('update-check').addEventListener('click', () => updateCall(window.buddy.checkUpdates));
$('update-now').addEventListener('click', () => updateCall(window.buddy.installUpdate));
$('update-notes').addEventListener('click', () => updateCall(window.buddy.openReleaseNotes));
$('update-auto').addEventListener('change', async () => {
  const want = $('update-auto').checked;
  const r = await updateCall(() => window.buddy.setAutoUpdates(want));
  if (r.ok) {
    snap.settings.checkForUpdates = want; // so that the next render of `snap` does not flip the switch back
    showStatus('update-status', 'Saved ✓', 'good');
  } else {
    $('update-auto').checked = !want;
  }
});
window.buddy.onUpdates((state) => renderUpdates(state));
// Coming back to this window: System Settings may have changed the permissions, and the account may have changed
// behind this page's back. Show what changed; what is being typed stays, and a waiting sign-in answers by itself.
window.addEventListener('focus', async () => {
  cancelBlurEnd();
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
  const known = await window.buddy.memory();
  if (known.ok) renderMemory(known);
  else showStatus('memory-status', known.error.message, 'error');
  const update = await window.buddy.updates();
  if (update.ok) renderUpdates(update);
  await renderPermissions();
  await mountAiForm($('ai'));
  // The admin may have changed free mode since the app last asked; what is typed meanwhile stays.
  const fresh = await window.buddy.refresh();
  if (fresh.ok) {
    snap = fresh;
    render({ fields: false });
  }
})();
