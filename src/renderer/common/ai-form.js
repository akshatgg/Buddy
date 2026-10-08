'use strict';
/* global module */
/* exported mountAiForm */

/**
 * The AI form (which AI, API key, model), used by Settings and the Welcome window. All four AIs are shown at once as
 * choices, so nobody has to open a list to find out which ones Buddy works with; the fifth choice is Claude Code on
 * this computer, which has no key: its status line (installed and signed in, or what to do about it) stands where the
 * key box is, with Check again. The key box never shows a saved key; it only takes a new one.
 */

// The model Claude Code answers with when none of its own is saved (claude/find.js DEFAULT_MODEL, which ai.js uses).
const CLAUDE_DEFAULT_MODEL = 'sonnet';

/**
 * What the form shows for the chosen AI `p` (one of the settings snapshot's providers): whether the key box is there
 * (else Claude Code's line, with its link when Claude Code is missing), and the model choices with their names.
 * `models` is the list to show (the live one, or the built-in one), `chosen` the saved model. For Claude Code with
 * none of its models saved, Sonnet is shown chosen, as that is the one it answers with.
 */
function aiChoiceView(p, { models = p.fallbackModels, chosen } = {}) {
  const needsKey = p.needsKey !== false;
  const line = needsKey ? null : p.line;
  const selected = needsKey || models.includes(chosen) ? chosen : CLAUDE_DEFAULT_MODEL;
  return {
    needsKey,
    lineText: line ? line.text : '',
    lineKind: line && p.hasKey ? 'good' : 'muted',
    link: line ? line.link : null,
    options: models.map((m) => ({ value: m, label: p.modelLabels?.[m] ?? m, selected: m === selected })),
  };
}

async function mountAiForm(root) {
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const choices = el('div', { className: 'ai-choices' });
  const key = el('input', { id: 'ai-key', type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' });
  const saveKey = el('button', { type: 'button', textContent: 'Save key' });
  const getKey = el('a', { href: '#', textContent: 'Get a key' });
  const status = el('span', { className: 'muted' });
  status.setAttribute('aria-live', 'polite'); // what a check of the key found is read out as it changes
  const model = el('select', { id: 'ai-model' });
  const refresh = el('button', { type: 'button', textContent: 'Refresh' });
  // Claude Code's line, link and Check again, shown in place of the key box when it is the chosen AI.
  const claudeLine = el('span', { id: 'ai-claude-line', className: 'muted' });
  claudeLine.setAttribute('aria-live', 'polite');
  const claudeGet = el('a', { id: 'ai-claude-get', href: '#', textContent: 'Get Claude Code', hidden: true });
  const claudeCheck = el('button', { id: 'ai-claude-check', type: 'button', textContent: 'Check again' });

  const keyLabel = el('label', { htmlFor: 'ai-key', textContent: 'API key' });
  const keyRow = el('div', { className: 'row' }, [key, saveKey]);
  const keyStatusRow = el('p', { className: 'row' }, [status, el('span', { className: 'spacer' }), getKey]);
  const claudeRow = el('p', { className: 'row', hidden: true }, [claudeLine, el('span', { className: 'spacer' }), claudeGet, claudeCheck]);

  root.classList.add('ai-form'); // base.css spaces the form by this class
  root.replaceChildren(
    el('fieldset', {}, [el('legend', { textContent: 'Which AI should Buddy use?' }), choices]),
    keyLabel,
    keyRow,
    keyStatusRow,
    claudeRow,
    el('label', { htmlFor: 'ai-model', textContent: 'Model' }),
    el('div', { className: 'row' }, [model, refresh]),
  );

  let snap = await window.buddy.get();
  if (!snap.ok) {
    root.replaceChildren(el('p', { className: 'error', textContent: snap.error.message }));
    return;
  }
  const current = () => snap.providers.find((p) => p.id === snap.settings.provider);
  const view = (options) => aiChoiceView(current(), { chosen: snap.settings.models[snap.settings.provider], ...options });

  // The choices are made once, and render() only moves the check: making them again would drop the keyboard
  // focus that is on one of them, and the arrow keys would stop after the first press. Claude Code's choice takes
  // a whole row of its own, under the four keys.
  const radios = snap.providers.map((p) => {
    const radio = el('input', { type: 'radio', name: 'ai-provider', value: p.id });
    radio.addEventListener('change', () => pick(p.id));
    const className = p.needsKey === false ? 'ai-choice wide' : 'ai-choice';
    choices.append(el('label', { className }, [radio, el('span', { textContent: p.label })]));
    return radio;
  });

  function setStatus(text, kind = 'muted') {
    status.textContent = text;
    status.className = kind;
  }

  /** What is known about the key: saved or not. */
  function showKeyStatus() {
    const p = current();
    setStatus(p.hasKey ? 'Key saved ✓' : 'No key yet.', p.hasKey ? 'good' : 'muted');
  }

  /** Claude Code's line: signed in (green), or what to do, with Get Claude Code when it is not installed. */
  function showClaudeLine({ lineText, lineKind, link }) {
    claudeLine.textContent = lineText;
    claudeLine.className = lineKind;
    claudeGet.hidden = !link;
    if (link) claudeGet.textContent = link.label;
  }

  function fillModels(models) {
    model.replaceChildren(...view({ models }).options.map((o) => el('option', { value: o.value, textContent: o.label, selected: o.selected })));
  }

  async function loadModels() {
    const p = current();
    fillModels(p.fallbackModels);
    if (!p.hasKey || p.needsKey === false) return; // Claude Code's names are its own: there is no list to fetch
    const r = await window.buddy.models(p.id);
    if (p.id !== snap.settings.provider) return; // another AI was chosen while this one was loading
    if (r.ok) {
      fillModels(r.models);
      showKeyStatus(); // a refresh that works clears the error an earlier one left
    } else {
      setStatus(r.error.message, 'error');
    }
  }

  function render() {
    const p = current();
    const v = view();
    for (const radio of radios) radio.checked = radio.value === p.id;
    key.value = '';
    key.placeholder = `Paste your ${p.label} key`;
    // The key box and its line, or Claude Code's line: one or the other. Refresh is for a key's live list only.
    keyLabel.hidden = keyRow.hidden = keyStatusRow.hidden = !v.needsKey;
    claudeRow.hidden = v.needsKey;
    refresh.hidden = !v.needsKey;
    if (v.needsKey) showKeyStatus();
    else showClaudeLine(v);
  }

  async function pick(id) {
    const r = await window.buddy.set({ provider: id });
    // render() empties the key box, but here the key stays: a person may paste it first and then click their AI.
    // It is read now, after the answer, so anything typed while the AI was being saved is kept too.
    const typed = key.value;
    if (!r.ok) {
      render(); // back to the AI that is saved
      key.value = typed;
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    key.value = typed;
    await loadModels();
  }

  saveKey.addEventListener('click', async () => {
    setStatus('Checking your key…');
    const r = await window.buddy.saveKey(current().id, key.value);
    if (!r.ok) {
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    fillModels(r.models);
    // The key was for another AI than the one that was chosen: it was kept there, and Buddy switched to it.
    const { label } = current();
    const switched = r.switchedFrom ? `That key is for ${label}, so I switched to ${label}. ` : '';
    if (!r.verified) setStatus(`${switched}Key saved — I couldn't check it (no internet)`);
    else if (switched) setStatus(`${switched}Key saved ✓`, 'good');
  });

  model.addEventListener('change', async () => {
    const r = await window.buddy.set({ models: { ...snap.settings.models, [current().id]: model.value } });
    if (r.ok) {
      snap = r;
      if (status.className === 'error') showKeyStatus(); // an earlier error no longer applies
      return;
    }
    fillModels([...model.options].map((o) => o.value)); // back to the model that is saved
    setStatus(r.error.message, 'error');
  });

  refresh.addEventListener('click', () => loadModels());
  getKey.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = await window.buddy.openUrl(current().keyUrl);
    if (!r.ok) setStatus(r.error.message, 'error');
  });

  // Check again asks Claude Code itself (not the cached answer), and the line follows; the snapshot's entry is
  // brought up to date too, so choosing another AI and coming back shows the same.
  claudeCheck.addEventListener('click', async () => {
    claudeLine.textContent = 'Checking…';
    claudeLine.className = 'muted';
    const r = await window.buddy.claudeStatus(true);
    const p = current();
    if (p.needsKey !== false) return; // another AI was chosen meanwhile
    if (!r.ok) {
      claudeLine.textContent = r.error.message;
      claudeLine.className = 'error';
      return;
    }
    Object.assign(p, { status: r.status, line: r.line, hasKey: r.status.loggedIn === true });
    showClaudeLine(view());
  });
  claudeGet.addEventListener('click', async (e) => {
    e.preventDefault();
    const r = await window.buddy.claudeGet();
    if (!r.ok) {
      claudeLine.textContent = r.error.message;
      claudeLine.className = 'error';
    }
  });

  render();
  await loadModels();
}

// For the tests: the page gets the functions as plain script globals (update-view.js does the same).
if (typeof module !== 'undefined') module.exports = { aiChoiceView, CLAUDE_DEFAULT_MODEL };
