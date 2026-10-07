'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
const ALL_STEPS = ['signin', 'pick', 'accessibility', 'screen', 'ai'];
let steps = ALL_STEPS; // without 'ai' when free mode covers this person (snap.ai.showForm is false)
let step = 0;
let snap = null;
let chosen = null;
let signingIn = 0; // sign-ins that wait for the browser: pressing the button again starts a newer one

function showStatus(id, text, kind) {
  $(id).textContent = text;
  $(id).className = kind;
}

/** Shown in place of the page when its settings cannot be loaded: why, on a card in the middle of the window. */
function showLoadError(message) {
  document.querySelector('main').replaceChildren(Object.assign(document.createElement('p'), {
    className: 'note error load-error', textContent: message,
  }));
}

async function checkPermissions() {
  const r = await window.buddy.permissions();
  if (!r.ok) {
    showStatus('acc-status', r.error.message, 'note error');
    showStatus('scr-status', r.error.message, 'note error');
    return;
  }
  // A badge, as in Settings: its dot says it, so "Allowed" needs no ✓.
  const show = (id, granted) => showStatus(id, granted ? 'Allowed' : 'Not allowed yet', granted ? 'badge good' : 'badge off');
  show('acc-status', Boolean(r.accessibility));
  show('scr-status', Boolean(r.screenRecording));
}

/** The steps for this person: Connect an AI only when they may need a key of their own. */
function setSteps() {
  steps = ALL_STEPS.filter((name) => name !== 'ai' || snap.ai.showForm);
  step = Math.min(step, steps.length - 1);
}

/** The steps as dots above the card: the ones done, the one shown (longer, in the accent) and the ones to come. */
function renderSteps(n) {
  $('steps').replaceChildren(...steps.map((name, i) => {
    const li = document.createElement('li');
    li.className = i < n ? 'done' : (i === n ? 'current' : '');
    li.setAttribute('aria-label', `Step ${i + 1} of ${steps.length}`);
    if (i === n) li.setAttribute('aria-current', 'step');
    return li;
  }));
}

function go(n) {
  step = n;
  for (const name of ALL_STEPS) $(`step-${name}`).hidden = name !== steps[n];
  $('back').hidden = n === 0;
  $('next').textContent = n === steps.length - 1 ? 'Start my buddy' : 'Next';
  // Next is off on the first step until the person is signed in. Someone signed out later, behind the page's back, is
  // brought back to it when the window gets the focus again, and finishing is refused to anyone signed out.
  $('next').disabled = steps[n] === 'signin' && !snap?.account.signedIn;
  if (steps[n] === 'accessibility' || steps[n] === 'screen') checkPermissions();
  renderSteps(n);
}

function renderSignIn() {
  const { account, canSignIn } = snap;
  $('sign-in').hidden = account.signedIn;
  $('sign-in').disabled = !canSignIn;
  if (account.signedIn) showStatus('signin-status', `Signed in as ${account.email} ✓`, 'good');
  else if (!canSignIn) showStatus('signin-status', "This copy of Buddy isn't set up for sign-in.", 'note error');
}

function renderAiNote() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
}

/** Show `snap`: who is signed in, and what free mode means for them, decide the steps and whether Next is on. */
function renderSnapshot() {
  setSteps();
  renderSignIn();
  renderAiNote();
  go(step);
}

async function allow(which, statusId) {
  const asked = await window.buddy.requestPermission(which);
  const opened = await window.buddy.openPermissionSettings(which);
  const failed = [asked, opened].find((r) => !r.ok);
  if (failed) showStatus(statusId, failed.error.message, 'note error');
}

function pick(character) {
  const box = $('name');
  const previous = snap.characters.find((c) => c.id === chosen);
  // Follow the buddy's own name until the user types one of their own.
  if (!box.value.trim() || box.value === previous?.defaultName) box.value = character.defaultName;
  chosen = character.id;
}

$('sign-in').addEventListener('click', async () => {
  showStatus('signin-status', 'Finish signing in in your browser…', 'muted');
  signingIn += 1;
  let r;
  try {
    r = await window.buddy.signIn();
  } finally {
    signingIn -= 1;
  }
  if (!r.ok) {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    if (r.error.code !== 'sign_in_cancelled') showStatus('signin-status', r.error.message, 'note error');
    return;
  }
  snap = r;
  renderSnapshot();
});
$('acc-open').addEventListener('click', () => allow('accessibility', 'acc-status'));
$('scr-open').addEventListener('click', () => allow('screenRecording', 'scr-status'));
$('acc-check').addEventListener('click', checkPermissions);
$('scr-check').addEventListener('click', checkPermissions);
// Coming back to this window: the permissions may have changed in System Settings, and the account may have changed
// behind this page's back (a sign-in that expired, or one that another window ended). Show what changed, and someone
// who is signed out now goes back to the first step, where the Sign in button is. A sign-in that waits for the browser
// answers by itself.
window.addEventListener('focus', async () => {
  if (steps[step] === 'accessibility' || steps[step] === 'screen') checkPermissions();
  if (signingIn || !snap?.ok) return;
  const fresh = await window.buddy.get();
  if (signingIn || !fresh.ok) return;
  if (JSON.stringify([fresh.account, fresh.ai]) === JSON.stringify([snap.account, snap.ai])) return; // nothing new
  if (fresh.account.signedIn !== snap.account.signedIn) showStatus('signin-status', '', 'muted'); // what it said no longer holds
  snap = fresh;
  if (!snap.account.signedIn) step = 0;
  renderSnapshot();
});
$('back').addEventListener('click', () => go(step - 1));
$('next').addEventListener('click', async () => {
  if (step < steps.length - 1) {
    go(step + 1);
    return;
  }
  $('next').disabled = true;
  $('finish-status').hidden = true;
  const r = await window.buddy.finishOnboarding({ buddyId: chosen, buddyName: $('name').value });
  if (r.ok) return; // the window closes now, so the button stays off
  $('finish-status').textContent = r.error.message;
  $('finish-status').hidden = false;
  $('next').disabled = false;
});

(async () => {
  go(0); // first, so Back is hidden and Next is off on the first step from the start
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  renderSnapshot();
  chosen = snap.settings.buddyId;
  renderBuddyGrid($('buddies'), snap.characters, chosen, pick);
  $('name').value = snap.characters.find((c) => c.id === chosen)?.defaultName || '';
  await mountAiForm($('ai'));
})();
