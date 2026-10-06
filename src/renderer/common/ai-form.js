'use strict';
/* exported mountAiForm */

/**
 * The AI form (which AI, API key, model), used by Settings and the Welcome
 * window. All four AIs are shown at once as choices, so nobody has to open a
 * list to find out which ones Buddy works with. The key box never shows a
 * saved key; it only takes a new one.
 */
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
  const model = el('select', { id: 'ai-model' });
  const refresh = el('button', { type: 'button', textContent: 'Refresh' });

  root.replaceChildren(
    el('fieldset', {}, [el('legend', { textContent: 'Which AI do you have a key for?' }), choices]),
    el('label', { htmlFor: 'ai-key', textContent: 'API key' }),
    el('div', { className: 'row' }, [key, saveKey]),
    el('p', { className: 'row' }, [status, el('span', { className: 'spacer' }), getKey]),
    el('label', { htmlFor: 'ai-model', textContent: 'Model' }),
    el('div', { className: 'row' }, [model, refresh]),
  );

  let snap = await window.buddy.get();
  if (!snap.ok) {
    root.replaceChildren(el('p', { className: 'error', textContent: snap.error.message }));
    return;
  }
  const current = () => snap.providers.find((p) => p.id === snap.settings.provider);

  // The choices are made once, and render() only moves the check: making them again would drop the keyboard
  // focus that is on one of them, and the arrow keys would stop after the first press.
  const radios = snap.providers.map((p) => {
    const radio = el('input', { type: 'radio', name: 'ai-provider', value: p.id });
    radio.addEventListener('change', () => pick(p.id));
    choices.append(el('label', { className: 'ai-choice' }, [radio, el('span', { textContent: p.label })]));
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

  function fillModels(models) {
    const chosen = snap.settings.models[snap.settings.provider];
    model.replaceChildren(...models.map((m) => el('option', { value: m, textContent: m, selected: m === chosen })));
  }

  async function loadModels() {
    const p = current();
    fillModels(p.fallbackModels);
    if (!p.hasKey) return;
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
    for (const radio of radios) radio.checked = radio.value === p.id;
    key.value = '';
    key.placeholder = `Paste your ${p.label} key`;
    showKeyStatus();
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

  render();
  await loadModels();
}
