'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
const STEPS = ['pick', 'accessibility', 'screen', 'ai'];
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

function go(n) {
  step = n;
  STEPS.forEach((name, i) => {
    $(`step-${name}`).hidden = i !== n;
  });
  $('back').hidden = n === 0;
  $('next').textContent = n === STEPS.length - 1 ? 'Start my buddy' : 'Next';
  if (STEPS[n] === 'accessibility' || STEPS[n] === 'screen') checkPermissions();
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

$('acc-open').addEventListener('click', () => allow('accessibility', 'acc-status'));
$('scr-open').addEventListener('click', () => allow('screenRecording', 'scr-status'));
$('acc-check').addEventListener('click', checkPermissions);
$('scr-check').addEventListener('click', checkPermissions);
window.addEventListener('focus', () => {
  if (STEPS[step] === 'accessibility' || STEPS[step] === 'screen') checkPermissions();
});
$('back').addEventListener('click', () => go(step - 1));
$('next').addEventListener('click', async () => {
  if (step < STEPS.length - 1) {
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
  go(0); // first, so Back is hidden on the first step from the start
  snap = await window.buddy.get();
  if (!snap.ok) {
    showLoadError(snap.error.message);
    return;
  }
  chosen = snap.settings.buddyId;
  renderBuddyGrid($('buddies'), snap.characters, chosen, pick);
  $('name').value = snap.characters.find((c) => c.id === chosen)?.defaultName || '';
  await mountAiForm($('ai'));
})();
