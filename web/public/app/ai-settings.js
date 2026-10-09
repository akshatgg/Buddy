// Settings → AI: the line about free mode (the Mac's words, shared/free-state.js), and, when the person may use one,
// their own AI key: which AI, the key (kept on this phone only, never shown again once saved) and the model. What is
// kept, and the calls to the AI, are own-ai.js's; this file draws them.

import { aiSection } from './shared/free-state.js';
import { PROVIDERS, PROVIDER_IDS } from './shared/providers/index.js';
import { $, make } from './dom.js';

export const NO_KEY_YET = 'No key yet.';
const FAILED = 'Something went wrong. Try again.';

/** The line beside the key: saved (with its last 4 characters) or not, and the AI it was switched to, if it was. */
export function keyLine(end, switchedTo = '') {
  const switched = switchedTo ? `That key is for ${switchedTo}, so I switched to ${switchedTo}. ` : '';
  return end ? `${switched}Key saved ✓ (ends in ${end})` : NO_KEY_YET;
}

/** The model list: `models`, with `chosen` in it even when the list does not have it (the one in use is always shown). */
export function modelList(models, chosen) {
  return models.includes(chosen) ? models : [chosen, ...models];
}

/** own is own-ai.js's; config() GET /api/config's answer (null when there is none yet). Answers { draw }. */
export function startAiSettings({ own, config }) {
  let drawnFor = null; // provider + saved key's end the form was last drawn for (null: not drawn)
  let asked = 0; // one more for each list of models asked for: only the newest is shown

  function showError(message) {
    $('ai-error').textContent = message;
    $('ai-error').hidden = !message;
  }

  function showKey(switchedTo = '') {
    const end = own.keyEnd();
    $('ai-key-status').textContent = keyLine(end, switchedTo);
    $('ai-key-status').className = end ? 'grow good' : 'grow muted';
    $('ai-remove').hidden = !end;
  }

  function fillModels(models) {
    const chosen = own.model();
    $('ai-model').replaceChildren(...modelList(models, chosen).map((name) => {
      const option = make('option', '', name);
      option.value = name;
      option.selected = name === chosen;
      return option;
    }));
  }

  /** The usual models at once; with a key, the live list when it comes. */
  async function loadModels() {
    const id = own.provider();
    const mine = (asked += 1);
    fillModels(PROVIDERS[id].fallbackModels);
    if (!own.hasKey()) return;
    try {
      const models = await own.listModels(id);
      if (mine === asked) fillModels(models);
    } catch (err) {
      if (mine === asked) showError(err?.message || FAILED);
    }
  }

  const formState = () => `${own.provider()}:${own.keyEnd() || ''}`;

  /** The form for the AI picked: its key line, its Get a key link, its models. */
  function drawForm(switchedTo = '') {
    drawnFor = formState();
    const { label, keyUrl } = PROVIDERS[own.provider()];
    $('ai-provider').value = own.provider();
    $('ai-get-key').href = keyUrl;
    $('ai-key').placeholder = `Paste your ${label} key`;
    showKey(switchedTo);
    loadModels();
  }

  $('ai-provider').replaceChildren(...PROVIDER_IDS.map((id) => {
    const option = make('option', '', PROVIDERS[id].label);
    option.value = id;
    return option;
  }));
  $('ai-provider').addEventListener('change', (e) => {
    own.pick(e.target.value);
    showError('');
    drawForm(); // a key typed but not saved stays in the box
  });
  $('ai-key-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const was = own.provider();
    let saved;
    try {
      saved = own.saveKey(was, $('ai-key').value);
    } catch (err) {
      showError(err.message);
      return;
    }
    $('ai-key').value = '';
    showError('');
    drawForm(saved === was ? '' : PROVIDERS[saved].label);
  });
  $('ai-remove').addEventListener('click', () => {
    own.removeKey();
    showError('');
    drawForm();
  });
  $('ai-model').addEventListener('change', (e) => own.setModel(own.provider(), e.target.value));

  return {
    /**
     * Draws the section again: when the Settings tab opens, and (`fromConfig`) when the config comes. Then a shown error
     * stays, and the models are not asked for again unless the AI or the saved key changed.
     */
    draw({ fromConfig = false } = {}) {
      const { note, showForm } = aiSection(config());
      $('ai-note').textContent = note;
      $('ai-note').hidden = !note;
      $('ai-form').hidden = !showForm;
      if (!showForm) {
        drawnFor = null;
        return; // a saved key stays saved
      }
      if (fromConfig && drawnFor === formState()) return; // nothing changed: keep what is shown, error too
      if (!fromConfig) showError('');
      drawForm();
    },
  };
}
