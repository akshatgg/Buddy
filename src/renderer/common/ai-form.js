'use strict';
/* exported mountAiForm */

/**
 * The AI form (provider, API key, model), used by Settings and the Welcome
 * window. The key box never shows a saved key; it only takes a new one.
 */
async function mountAiForm(root) {
  const el = (tag, props = {}, children = []) => {
    const node = Object.assign(document.createElement(tag), props);
    node.append(...children);
    return node;
  };

  const provider = el('select', { id: 'ai-provider' });
  const key = el('input', { id: 'ai-key', type: 'password', placeholder: 'Paste your API key', autocomplete: 'off' });
  const saveKey = el('button', { type: 'button', textContent: 'Save key' });
  const getKey = el('a', { href: '#', textContent: 'Get a key' });
  const status = el('span', { className: 'muted' });
  const model = el('select', { id: 'ai-model' });
  const refresh = el('button', { type: 'button', textContent: 'Refresh' });

  root.replaceChildren(
    el('label', { htmlFor: 'ai-provider', textContent: 'Provider' }),
    provider,
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
    if (r.ok) {
      fillModels(r.models);
      showKeyStatus(); // a refresh that works clears the error an earlier one left
    } else {
      setStatus(r.error.message, 'error');
    }
  }

  function render() {
    const p = current();
    provider.replaceChildren(...snap.providers.map((x) => el('option', {
      value: x.id, textContent: x.label, selected: x.id === p.id,
    })));
    key.value = '';
    showKeyStatus();
  }

  provider.addEventListener('change', async () => {
    const r = await window.buddy.set({ provider: provider.value });
    if (!r.ok) {
      render(); // back to the provider that is saved
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    await loadModels();
  });

  saveKey.addEventListener('click', async () => {
    setStatus('Checking your key…');
    const r = await window.buddy.saveKey(provider.value, key.value);
    if (!r.ok) {
      setStatus(r.error.message, 'error');
      return;
    }
    snap = r;
    render();
    if (!r.verified) setStatus("Key saved — I couldn't check it (no internet)");
    fillModels(r.models);
  });

  model.addEventListener('change', async () => {
    const r = await window.buddy.set({ models: { ...snap.settings.models, [provider.value]: model.value } });
    if (r.ok) {
      snap = r;
      showKeyStatus();
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
