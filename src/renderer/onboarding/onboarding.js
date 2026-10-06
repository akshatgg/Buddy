'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
const ALL_STEPS = ['signin', 'pick', 'accessibility', 'screen', 'ai'];
let steps = ALL_STEPS; // without 'ai' when free mode covers this person (snap.ai.showForm is false)
let step = 0;
let snap = null;
let chosen = null;

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

async function checkPermissions() {
  const r = await window.buddy.permissions();
  if (!r.ok) {
    showStatus('acc-status', r.error.message, 'error');
    showStatus('scr-status', r.error.message, 'error');
    return;
  }
  const show = (id, granted) => showStatus(id, granted ? 'Allowed ✓' : 'Not allowed yet', granted ? 'good' : 'muted');
  show('acc-status', Boolean(r.accessibility));
  show('scr-status', Boolean(r.screenRecording));
}

/** The steps for this person: Connect an AI only when they may need a key of their own. */
function setSteps() {
  steps = ALL_STEPS.filter((name) => name !== 'ai' || snap.ai.showForm);
  step = Math.min(step, steps.length - 1);
}

function go(n) {
  step = n;
  for (const name of ALL_STEPS) $(`step-${name}`).hidden = name !== steps[n];
  $('back').hidden = n === 0;
  $('next').textContent = n === steps.length - 1 ? 'Start my buddy' : 'Next';
  // Nobody goes past the first step without signing in.
  $('next').disabled = steps[n] === 'signin' && !snap?.account.signedIn;
  if (steps[n] === 'accessibility' || steps[n] === 'screen') checkPermissions();
}

function renderSignIn() {
  const { account, canSignIn } = snap;
  $('sign-in').hidden = account.signedIn;
  $('sign-in').disabled = !canSignIn;
  if (account.signedIn) showStatus('signin-status', `Signed in as ${account.email} ✓`, 'good');
  else if (!canSignIn) showStatus('signin-status', "This copy of Buddy isn't set up for sign-in.", 'error');
}

function renderAiNote() {
  $('ai-note').textContent = snap.ai.note;
  $('ai-note').hidden = !snap.ai.note;
}

async function allow(which, statusId) {
  const asked = await window.buddy.requestPermission(which);
  const opened = await window.buddy.openPermissionSettings(which);
  const failed = [asked, opened].find((r) => !r.ok);
  if (failed) showStatus(statusId, failed.error.message, 'error');
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
  const r = await window.buddy.signIn();
  if (!r.ok) {
    // Cancelled means the button was pressed again: the newer sign-in speaks for itself.
    if (r.error.code !== 'sign_in_cancelled') showStatus('signin-status', r.error.message, 'error');
    return;
  }
  snap = r;
  setSteps();
  renderSignIn();
  renderAiNote();
  go(step);
});
$('acc-open').addEventListener('click', () => allow('accessibility', 'acc-status'));
$('scr-open').addEventListener('click', () => allow('screenRecording', 'scr-status'));
$('acc-check').addEventListener('click', checkPermissions);
$('scr-check').addEventListener('click', checkPermissions);
window.addEventListener('focus', () => {
  if (steps[step] === 'accessibility' || steps[step] === 'screen') checkPermissions();
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
  setSteps();
  renderSignIn();
  renderAiNote();
  go(step);
  chosen = snap.settings.buddyId;
  renderBuddyGrid($('buddies'), snap.characters, chosen, pick);
  $('name').value = snap.characters.find((c) => c.id === chosen)?.defaultName || '';
  await mountAiForm($('ai'));
})();
