'use strict';
/* global mountAiForm, renderBuddyGrid */

const $ = (id) => document.getElementById(id);
const STEPS = ['pick', 'accessibility', 'screen', 'ai'];
let step = 0;
let snap = null;
let chosen = null;

async function checkPermissions() {
  const r = await window.buddy.permissions();
  const show = (id, granted) => {
    $(id).textContent = granted ? 'Allowed ✓' : 'Not allowed yet';
    $(id).className = granted ? 'good' : 'muted';
  };
  show('acc-status', Boolean(r.ok && r.accessibility));
  show('scr-status', Boolean(r.ok && r.screenRecording));
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

async function allow(which) {
  await window.buddy.requestPermission(which);
  await window.buddy.openPermissionSettings(which);
}

function pick(character) {
  const box = $('name');
  const previous = snap.characters.find((c) => c.id === chosen);
  // Follow the buddy's own name until the user types one of their own.
  if (!box.value.trim() || box.value === previous?.defaultName) box.value = character.defaultName;
  chosen = character.id;
}

$('acc-open').addEventListener('click', () => allow('accessibility'));
$('scr-open').addEventListener('click', () => allow('screenRecording'));
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
  await window.buddy.finishOnboarding({ buddyId: chosen, buddyName: $('name').value });
});

(async () => {
  snap = await window.buddy.get();
  chosen = snap.settings.buddyId;
  renderBuddyGrid($('buddies'), snap.characters, chosen, pick);
  $('name').value = snap.characters.find((c) => c.id === chosen)?.defaultName || '';
  await mountAiForm($('ai'));
  go(0);
})();
