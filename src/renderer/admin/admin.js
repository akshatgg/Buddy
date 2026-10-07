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

/**
 * The switches as the form has them. The daily box and "own key" are only read for a daily limit (they are hidden for
 * Unlimited), so what is left in them then cannot stop Unlimited from saving.
 */
function readForm() {
  const limitMode = document.querySelector('input[name="limitMode"]:checked')?.value || 'daily';
  const form = { enabled: $('enabled').checked, limitMode, provider: $('provider').value, model: $('model').value };
  if (limitMode === 'daily') {
    form.dailyRequests = Number($('daily').value);
    form.allowOwnKey = $('own').checked;
  }
  return form;
}

function lastActiveText(iso) {
  return iso ? new Date(iso).toLocaleString() : 'never';
}

/** One row of the users table, with the button that blocks or unblocks that person. */
function userRow(user) {
  const button = el('button', {
    type: 'button', className: 'btn small', textContent: user.blocked ? 'Unblock' : 'Block',
  });
  const row = el('tr', { className: user.blocked ? 'blocked' : '' }, [
    el('td', { textContent: user.name || '—' }),
    el('td', { textContent: user.email }),
    el('td', { className: 'num', textContent: String(user.usedToday) }),
    el('td', { textContent: lastActiveText(user.lastActive) }),
    el('td', {}, [button]),
  ]);
  button.addEventListener('click', () => setBlocked(user, row, button));
  return row;
}

const usersText = (count) => (count === 1 ? '1 user' : `${count} users`);

function renderUsers(users) {
  showStatus('users-status', usersText(users.length));
  $('users').replaceChildren(...users.map(userRow));
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

async function setBlocked(user, row, button) {
  button.disabled = true;
  const r = await window.buddy.block(user.uid, !user.blocked);
  if (!r.ok) {
    button.disabled = false;
    showStatus('users-status', r.error.message, 'error');
    return;
  }
  // The row shows what the server answered. The whole list is not loaded again for it, as each load reads every user
  // from the database: only Refresh and opening the window do. A refusal shown before no longer holds.
  row.replaceWith(userRow(r.user));
  showStatus('users-status', usersText($('users').children.length));
}

for (const radio of document.querySelectorAll('input[name="limitMode"]')) radio.addEventListener('change', syncForm);
$('provider').addEventListener('change', () => {
  const p = view.providers.find((x) => x.id === $('provider').value);
  loadModels(p.id, p.fallbackModels[0]);
});
$('models-refresh').addEventListener('click', () => loadModels($('provider').value, $('model').value));
// What the status says ("Saved ✓", or why a save was refused) is about the form as it was: it goes as soon as a
// field changes.
$('free-card').addEventListener('input', () => showStatus('save-status', ''));
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
  showStatus('save-status', 'Saved ✓ Every Buddy app uses it the next time it is opened.', 'good');
});
$('users-refresh').addEventListener('click', loadUsers);

(async () => {
  const r = await window.buddy.settings();
  if (!r.ok) {
    $('load-error').textContent = r.error.message;
    $('load-error').hidden = false;
    return; // both cards stay hidden: nothing in them can work without the settings
  }
  view = r;
  render();
  $('free-card').hidden = false;
  $('users-card').hidden = false;
  await loadUsers();
})();
