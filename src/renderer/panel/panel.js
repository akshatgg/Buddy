'use strict';

const $ = (id) => document.getElementById(id);
const TABS = ['write', 'fix', 'check'];
const FIRST_FIELD = { write: 'write-text', fix: 'fix-text', check: 'check-q' };
const INSERT_LABEL = { write: 'Insert', fix: 'Replace', check: 'Replace' };
const INSERT_MODE = { write: 'insert', fix: 'replace', check: 'replaceAll' };

let last = null; // { action, input } of the latest request, for Try again
let image = null; // the latest screenshot, base64 JPEG
let currentTab = 'write';

function show(el, visible) {
  el.hidden = !visible;
}

function showError(message) {
  $('error').textContent = message || '';
  show($('error'), Boolean(message));
}

function reset() {
  last = null;
  image = null;
  $('write-text').value = '';
  $('check-q').value = '';
  $('result-text').value = '';
  for (const id of ['result', 'shot', 'busy', 'notice']) show($(id), false);
  showError('');
}

async function takeScreenshot() {
  showError('');
  const r = await window.buddy.screenshot();
  if (!r.ok) {
    showError(r.error.message);
    return;
  }
  image = r.image;
  $('shot').src = `data:image/jpeg;base64,${image}`;
  show($('shot'), true);
}

function setTab(name) {
  currentTab = name;
  for (const t of TABS) {
    show($(`tab-${t}`), t === name);
    document.querySelector(`[data-tab="${t}"]`).classList.toggle('active', t === name);
  }
  show($('result'), false);
  showError('');
  $(FIRST_FIELD[name]).focus();
  if (name === 'check' && !image) takeScreenshot();
}

function busy(on) {
  show($('busy'), on);
  for (const b of document.querySelectorAll('button.primary, #again')) b.disabled = on;
}

function showResult(action, result) {
  const check = action === 'check' ? result.check : null;
  const structured = Boolean(check && !check.raw);
  $('problems').replaceChildren();
  if (structured) {
    $('verdict').textContent = check.verdict === 'good' ? 'Looks good ✓' : 'Has problems';
    $('verdict').className = `verdict ${check.verdict}`;
    for (const problem of check.problems) {
      const li = document.createElement('li');
      li.textContent = problem;
      $('problems').append(li);
    }
  }
  show($('verdict'), structured);
  show($('problems'), structured && check.problems.length > 0);

  let text = result.text;
  if (check) text = structured ? check.corrected || '' : check.raw;
  $('result-text').value = text;
  $('insert').textContent = INSERT_LABEL[action];
  for (const id of ['result-text', 'insert', 'copy']) show($(id), Boolean(text));
  show($('result'), true);
}

async function run(action, input) {
  last = { action, input };
  showError('');
  show($('result'), false);
  busy(true);
  const r = await window.buddy.run(action, input);
  busy(false);
  if (!r.ok) {
    showError(r.error.message);
    return;
  }
  showResult(action, r.result);
}

$('write-go').addEventListener('click', () => run('write', {
  instruction: $('write-text').value,
  tone: document.querySelector('input[name="tone"]:checked').value,
}));
$('fix-go').addEventListener('click', () => run('fix', { text: $('fix-text').value }));
$('check-go').addEventListener('click', () => {
  if (image) run('check', { image, instruction: $('check-q').value });
  else takeScreenshot();
});
$('check-shot').addEventListener('click', () => takeScreenshot());
$('fix-whole').addEventListener('click', async () => {
  showError('');
  const r = await window.buddy.wholeBox();
  if (!r.ok) {
    showError(r.error.message);
    return;
  }
  $('fix-text').value = r.text;
  if (!r.text) showError('That box looks empty.');
});
$('insert').addEventListener('click', () => window.buddy.insert($('result-text').value, INSERT_MODE[last.action]));
$('copy').addEventListener('click', () => window.buddy.copy($('result-text').value));
$('again').addEventListener('click', () => {
  if (last) run(last.action, last.input);
});
$('close').addEventListener('click', () => window.buddy.close());
$('settings').addEventListener('click', () => window.buddy.openSettings());
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') window.buddy.close();
  // ⌘↩ presses the current tab's main button.
  if (e.key === 'Enter' && e.metaKey) $(`${currentTab}-go`).click();
});

window.buddy.onOpen((state) => {
  reset();
  $('who').textContent = state.buddyName;
  $('where').textContent = state.appName ? `· ${state.appName}` : '';
  $('fix-text').value = state.selection;
  if (state.notice) {
    $('notice').textContent = state.notice;
    show($('notice'), true);
  }
  setTab(state.tab);
});
