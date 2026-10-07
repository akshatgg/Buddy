'use strict';

const $ = (id) => document.getElementById(id);
const TABS = ['write', 'fix', 'check'];
const FIRST_FIELD = { write: 'write-text', fix: 'fix-text', check: 'check-q' };
const INSERT_LABEL = { write: 'Insert', fix: 'Replace', check: 'Replace' };
const INSERT_MODE = { write: 'insert', fix: 'replace', check: 'replaceAll' };

let last = null; // { action, input } of the latest request, for Try again
let image = null; // the latest screenshot, base64 JPEG
let currentTab = 'write';
let generation = 0; // counts how often the panel has been opened; an answer to a request from an earlier opening is stale
let errorCode = null; // the code of the error shown now, so that Open Settings can say which section it is about

// Errors whose fix is in Settings: no key yet, a key that was refused, an account out of credit, a model that cannot
// be used (not there for this key, or it cannot read screenshots: "Pick another in Settings"); and signed out,
// today's free requests used up with own keys allowed but none saved, free mode turned off, and a copy of Buddy that
// cannot sign in. They come with an "Open Settings" button. (The code is the one the main process sent along with the
// message.)
const SETTINGS_ERRORS = ['no_key', 'bad_key', 'no_credit', 'bad_model', 'no_vision', 'signed_out', 'need_key', 'free_off', 'not_set_up'];

function show(el, visible) {
  el.hidden = !visible;
}

function showError(message, code) {
  errorCode = message ? (code || null) : null;
  $('error').textContent = message || '';
  show($('error'), Boolean(message));
  show($('error-settings'), Boolean(message) && SETTINGS_ERRORS.includes(code));
}

function reset() {
  last = null;
  image = null;
  $('write-text').value = '';
  $('check-q').value = '';
  $('result-text').value = '';
  for (const id of ['result', 'shot', 'busy', 'notice']) show($(id), false);
  showError('');
  busy(false);
  // An answer from before this opening is ignored, so it will not turn these back on.
  $('fix-whole').disabled = false;
  $('check-shot').disabled = false;
}

/** Runs `call` with `button` disabled, so that a second click cannot start the same call again. */
async function whileDisabled(button, call) {
  const mine = generation;
  button.disabled = true;
  try {
    return await call();
  } finally {
    if (mine === generation) button.disabled = false; // after a new opening, reset() has done this already
  }
}

async function takeScreenshot() {
  if ($('check-shot').disabled) return; // one at a time: the button is off while a screenshot is being taken
  const mine = generation;
  showError('');
  const r = await whileDisabled($('check-shot'), () => window.buddy.screenshot());
  if (mine !== generation) return; // the panel was opened again meanwhile: this shot belongs to the earlier opening
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
  const mine = generation;
  last = { action, input };
  showError('');
  show($('result'), false);
  busy(true);
  const r = await window.buddy.run(action, input);
  if (mine !== generation) return; // the panel was opened again meanwhile: this answer belongs to the earlier opening
  busy(false);
  if (!r.ok) {
    showError(r.error.message, r.error.code);
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
  const mine = generation;
  showError('');
  const r = await whileDisabled($('fix-whole'), () => window.buddy.wholeBox());
  // Reading the box hides the panel and shows it again, which is a new opening that already holds the text,
  // or the reason it could not be read. An answer that arrives in the same opening (no app to read) is shown here.
  if (mine !== generation) return;
  if (!r.ok) {
    showError(r.error.message);
    return;
  }
  $('fix-text').value = r.text;
  if (!r.text) showError('That box looks empty.');
});
$('insert').addEventListener('click', () => {
  if (!last) return;
  window.buddy.insert($('result-text').value, INSERT_MODE[last.action]);
});
$('copy').addEventListener('click', () => window.buddy.copy($('result-text').value));
$('again').addEventListener('click', () => {
  if (last) run(last.action, last.input);
});
$('close').addEventListener('click', () => window.buddy.close());
$('settings').addEventListener('click', () => window.buddy.openSettings());
$('error-settings').addEventListener('click', () => window.buddy.openSettings(errorCode));
for (const b of document.querySelectorAll('[data-tab]')) b.addEventListener('click', () => setTab(b.dataset.tab));

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // Esc and Enter belong to the input method while it is composing (Hindi, Devanagari)
  if (e.key === 'Escape') window.buddy.close();
  // ⌘↩ presses the current tab's main button.
  if (e.key === 'Enter' && e.metaKey) $(`${currentTab}-go`).click();
});

window.buddy.onOpen((state) => {
  generation += 1;
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
