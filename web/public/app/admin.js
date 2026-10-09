// Settings → Admin, for the admin only (GET /api/config's isAdmin; the server refuses everyone else anyway): what the
// Mac's Admin window does, in the same words. Free AI's switches, where Clawd walks, and the users with Block. The form
// logic is admin-core.js's; this file draws it and talks to the server with api.js.

import {
  NO_KEYS, LOADING_MODELS, SAVING, SAVED, CLAWD_SAVED,
  dailyShown, voiceLine, formView, modelOptions, modelsNote, readForm, lastActiveText, usersText,
} from './admin-core.js';
import { $, make, button } from './dom.js';

const radios = (name) => [...document.querySelectorAll(`input[name="${name}"]`)];
const checkedValue = (name) => radios(name).find((r) => r.checked)?.value;

/**
 * api is api.js's; isAdmin() whether GET /api/config said so; onSaved() after the switches were saved (the app fetches
 * its config again, so the admin's own phone follows them at once). Answers { draw, update }.
 */
export function startAdmin({ api, isAdmin, onSaved = () => {} }) {
  let view = null; // { config, providers, voiceOn }, as the server last answered
  let loading = null; // load() under way

  function showStatus(id, text, kind = 'muted') {
    $(id).textContent = text;
    $(id).className = kind;
    $(id).hidden = !text;
  }

  function fillSelect(id, options) {
    $(id).replaceChildren(...options.map((o) => {
      const option = make('option', '', o.label);
      option.value = o.value;
      option.selected = o.selected;
      return option;
    }));
  }

  function syncForm() {
    const daily = dailyShown(checkedValue('admin-limit'));
    $('admin-daily-row').hidden = !daily;
    $('admin-own-row').hidden = !daily;
  }

  async function loadModels(provider, chosen) {
    const known = view.providers.find((p) => p.id === provider);
    fillSelect('admin-model', modelOptions(known ? known.fallbackModels : [], chosen));
    showStatus('admin-models-note', LOADING_MODELS);
    showStatus('admin-models-warning', '', 'error');
    let r;
    try {
      r = await api.get(`/api/admin/models?provider=${encodeURIComponent(provider)}`);
    } catch (err) {
      if ($('admin-provider').value !== provider) return;
      showStatus('admin-models-note', '');
      showStatus('admin-models-warning', err.message, 'error');
      return;
    }
    if ($('admin-provider').value !== provider) return; // another provider was picked meanwhile
    fillSelect('admin-model', modelOptions(r.models, $('admin-model').value || chosen));
    showStatus('admin-models-note', modelsNote(r));
    showStatus('admin-models-warning', r.warning || '', 'error'); // the server's words: the usual models are shown
  }

  function render() {
    const { config } = view;
    const form = formView(view);
    showStatus('admin-no-keys', form.noKeys ? NO_KEYS : '', 'error');
    const voice = voiceLine(view.voiceOn);
    showStatus('admin-voice', voice.text, voice.kind);
    $('admin-enabled').checked = config.enabled;
    $('admin-enabled').disabled = form.enabledLocked;
    for (const r of radios('admin-limit')) r.checked = r.value === config.limitMode;
    $('admin-daily').value = String(config.dailyRequests);
    $('admin-own').checked = config.allowOwnKey;
    for (const r of radios('admin-clawd')) r.checked = r.value === config.clawdLook;
    fillSelect('admin-provider', form.providers);
    syncForm();
    loadModels(config.provider, config.model);
  }

  function userRow(user) {
    const li = make('li', user.blocked ? 'blocked' : '');
    const who = make('div', 'who');
    who.append(make('span', 'name', user.name || '—'), make('span', 'under', user.email),
      make('span', 'under', `Today: ${user.usedToday} · Last active: ${lastActiveText(user.lastActive)}`));
    const block = button('chip', user.blocked ? 'Unblock' : 'Block', () => setBlocked(user, li, block));
    li.append(who, block);
    return li;
  }

  function renderUsers(users) {
    showStatus('admin-users-status', usersText(users.length));
    $('admin-users').replaceChildren(...users.map(userRow));
    $('admin-users-empty').hidden = users.length > 0;
  }

  async function loadUsers() {
    showStatus('admin-users-status', 'Loading…');
    try {
      renderUsers((await api.get('/api/admin/users')).users);
    } catch (err) {
      showStatus('admin-users-status', err.message, 'error');
    }
  }

  async function setBlocked(user, li, block) {
    block.disabled = true;
    let r;
    try {
      r = await api.post('/api/admin/users', { uid: user.uid, blocked: !user.blocked });
    } catch (err) {
      block.disabled = false;
      showStatus('admin-users-status', err.message, 'error');
      return;
    }
    // The row shows what the server answered; the whole list is loaded again only by Refresh and opening Settings.
    li.replaceWith(userRow(r.user));
    showStatus('admin-users-status', usersText($('admin-users').children.length));
  }

  /** The server's settings and users, from the start (once at a time). Nothing shows until the settings came. */
  function load() {
    loading ??= (async () => {
      $('admin-body').hidden = true;
      showStatus('admin-load-error', '', 'error');
      try {
        view = await api.get('/api/admin/settings');
      } catch (err) {
        view = null;
        showStatus('admin-load-error', err.message, 'error');
        return;
      }
      render();
      showStatus('admin-save-status', '');
      showStatus('admin-clawd-status', '');
      $('admin-body').hidden = false;
      await loadUsers();
    })().finally(() => {
      loading = null;
    });
    return loading;
  }

  /** Shows or hides the section; answers whether it shows. */
  function toggle() {
    const allowed = isAdmin();
    $('admin-part').hidden = !allowed;
    if (!allowed) view = null;
    return allowed;
  }

  for (const r of radios('admin-limit')) r.addEventListener('change', syncForm);
  $('admin-provider').addEventListener('change', () => {
    const p = view.providers.find((x) => x.id === $('admin-provider').value);
    loadModels(p.id, p.fallbackModels[0]);
  });
  $('admin-models-refresh').addEventListener('click', () => loadModels($('admin-provider').value, $('admin-model').value));
  // "Saved ✓", or why a save was refused, is about the form as it was: it goes as soon as a field changes.
  $('admin-free').addEventListener('input', () => showStatus('admin-save-status', ''));
  $('admin-save').addEventListener('click', async () => {
    $('admin-save').disabled = true;
    showStatus('admin-save-status', SAVING);
    const patch = readForm({
      enabled: $('admin-enabled').checked,
      limitMode: checkedValue('admin-limit'),
      daily: $('admin-daily').value,
      own: $('admin-own').checked,
      provider: $('admin-provider').value,
      model: $('admin-model').value,
    });
    try {
      view = await api.put('/api/admin/settings', patch);
    } catch (err) {
      showStatus('admin-save-status', err.message, 'error');
      return;
    } finally {
      $('admin-save').disabled = false;
    }
    render();
    showStatus('admin-save-status', SAVED, 'good');
    onSaved();
  });
  // Where Clawd walks: saved at once, on its own (the Free AI form keeps whatever is being changed there).
  for (const r of radios('admin-clawd')) {
    r.addEventListener('change', async () => {
      showStatus('admin-clawd-status', SAVING);
      let saved;
      try {
        saved = await api.put('/api/admin/settings', { clawdLook: r.value });
      } catch (err) {
        showStatus('admin-clawd-status', err.message, 'error');
        for (const other of radios('admin-clawd')) other.checked = other.value === view.config.clawdLook;
        return;
      }
      view = { ...view, config: { ...view.config, clawdLook: saved.config.clawdLook } };
      showStatus('admin-clawd-status', CLAWD_SAVED, 'good');
      onSaved();
    });
  }
  $('admin-users-refresh').addEventListener('click', loadUsers);

  return {
    /** The Settings tab opened: for the admin, the section with the server's settings and users, loaded again. */
    draw() {
      if (toggle()) load();
    },

    /** The config changed: the section shows or hides, and is loaded the first time it shows. */
    update() {
      if (toggle() && !view) load();
    },
  };
}
