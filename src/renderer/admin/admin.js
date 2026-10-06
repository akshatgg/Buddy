'use strict';

const $ = (id) => document.getElementById(id);
let view = null; // { config, providers }, as the server last answered

function showStatus(id, text, kind = 'muted') {
  $(id).textContent = text;
  $(id).className = kind;
}

function el(tag, props = {}, children = []) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

/** The daily box and "own key" belong to a daily limit only. */
function syncForm() {
  const daily = document.querySelector('input[name="limitMode"]:checked')?.value === 'daily';
  $('daily-row').hidden = !daily;
  $('own-row').hidden = !daily;
}

/** `models` in the model list, with `chosen` selected (and kept in the list even when the server no longer lists it). */
function fillModels(models, chosen) {
  const list = models.includes(chosen) ? models : [chosen, ...models];
  $('model').replaceChildren(...list.map((m) => el('option', { value: m, textContent: m, selected: m === chosen })));
}

async function loadModels(provider, chosen) {
  const known = view.providers.find((p) => p.id === provider);
  fillModels(known ? known.fallbackModels : [], chosen);
  showStatus('models-note', 'Loading the models…');
  const r = await window.buddy.models(provider);
  if ($('provider').value !== provider) return; // the admin picked another provider meanwhile
  if (!r.ok) {
    showStatus('models-note', r.error.message, 'error');
    return;
  }
  fillModels(r.models, $('model').value || chosen);
  if (r.warning) showStatus('models-note', r.warning, 'error');
  else showStatus('models-note', r.live ? '' : 'The usual models for this provider.');
}

function render() {
  const { config, providers } = view;
  const withKey = providers.filter((p) => p.hasKey);
  $('no-keys').hidden = withKey.length > 0;
  $('enabled').checked = config.enabled;
  $('enabled').disabled = withKey.length === 0 && !config.enabled;
  for (const radio of document.querySelectorAll('input[name="limitMode"]')) radio.checked = radio.value === config.limitMode;
  $('daily').value = String(config.dailyRequests);
  $('own').checked = config.allowOwnKey;
  // Only providers with a key on the server can be picked, plus the saved one, so that the list shows what is saved.
  const choices = providers.filter((p) => p.hasKey || p.id === config.provider);
  $('provider').replaceChildren(...choices.map((p) => el('option', {
    value: p.id,
    textContent: p.hasKey ? p.label : `${p.label} (no key on the server)`,
    selected: p.id === config.provider,
  })));
  syncForm();
  loadModels(config.provider, config.model);
}

function readForm() {
  return {
    enabled: $('enabled').checked,
    limitMode: document.querySelector('input[name="limitMode"]:checked')?.value || 'daily',
    dailyRequests: Number($('daily').value),
    allowOwnKey: $('own').checked,
    provider: $('provider').value,
    model: $('model').value,
  };
}

function lastActiveText(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

function renderUsers(users) {
  showStatus('users-status', users.length === 1 ? '1 user' : `${users.length} users`);
  $('users').replaceChildren(...users.map((user) => {
    const button = el('button', { type: 'button', textContent: user.blocked ? 'Unblock' : 'Block' });
    button.addEventListener('click', () => setBlocked(user, button));
    return el('tr', { className: user.blocked ? 'blocked' : '' }, [
      el('td', { textContent: user.name || '—' }),
      el('td', { textContent: user.email }),
      el('td', { className: 'num', textContent: String(user.usedToday) }),
      el('td', { textContent: lastActiveText(user.lastActive) }),
      el('td', {}, [button]),
    ]);
  }));
}

async function loadUsers() {
  showStatus('users-status', 'Loading…');
  const r = await window.buddy.users();
  if (!r.ok) {
    showStatus('users-status', r.error.message, 'error');
    return;
  }
  renderUsers(r.users);
}

async function setBlocked(user, button) {
  button.disabled = true;
  const r = await window.buddy.block(user.uid, !user.blocked);
  if (!r.ok) {
    button.disabled = false;
    showStatus('users-status', r.error.message, 'error');
    return;
  }
  await loadUsers();
}

for (const radio of document.querySelectorAll('input[name="limitMode"]')) radio.addEventListener('change', syncForm);
$('provider').addEventListener('change', () => {
  const p = view.providers.find((x) => x.id === $('provider').value);
  loadModels(p.id, p.fallbackModels[0]);
});
$('models-refresh').addEventListener('click', () => loadModels($('provider').value, $('model').value));
$('save').addEventListener('click', async () => {
  $('save').disabled = true;
  showStatus('save-status', 'Saving…');
  const r = await window.buddy.save(readForm());
  $('save').disabled = false;
  if (!r.ok) {
    showStatus('save-status', r.error.message, 'error');
    return;
  }
  view = r;
  render();
  showStatus('save-status', 'Saved ✓ Every Buddy app uses it from now on.', 'good');
});
$('users-refresh').addEventListener('click', loadUsers);

(async () => {
  const r = await window.buddy.settings();
  if (!r.ok) {
    $('load-error').textContent = r.error.message;
    $('load-error').hidden = false;
    $('free-card').hidden = true;
    $('users-card').hidden = true;
    return;
  }
  view = r;
  render();
  await loadUsers();
})();
