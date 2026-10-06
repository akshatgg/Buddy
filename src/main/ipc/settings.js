'use strict';

/** IPC for the Settings and Welcome windows. */

const { shell } = require('electron');
const { BuddyError } = require('../../../shared/errors');
const { PROVIDERS, PROVIDER_IDS, getProvider } = require('../../../shared/providers');
const { SIZES } = require('../geometry');
const { guarded } = require('./result');

const SETTABLE = ['buddyId', 'buddyName', 'size', 'shortcut', 'provider', 'models'];
const NAME_MAX = 24;
const PERMISSION_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};

/** The model to use after a key is saved: keep the user's pick if the key can use it. */
function chooseModel(available, fallbackModels, current) {
  if (current && available.includes(current)) return current;
  return available.includes(fallbackModels[0]) ? fallbackModels[0] : available[0];
}

function registerSettingsIpc({
  ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, onFinishOnboarding,
}) {
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents));

  function snapshot() {
    const settings = store.all();
    delete settings.positions;
    delete settings.lastDisplayId;
    return {
      settings,
      buddyOn: power.isOn(),
      characters: characters.list,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        keyUrl: PROVIDERS[id].keyUrl,
        fallbackModels: PROVIDERS[id].fallbackModels,
        hasKey: secrets.has(id),
      })),
    };
  }

  handle('settings:get', () => snapshot());

  handle('settings:set', (patch = {}) => {
    const changes = {};
    for (const key of SETTABLE) if (key in patch) changes[key] = patch[key];
    if ('size' in changes && !SIZES[changes.size]) throw new BuddyError('bad_request', 'Unknown size.');
    if ('buddyId' in changes && !characters.list.some((c) => c.id === changes.buddyId)) {
      throw new BuddyError('bad_request', 'Unknown buddy.');
    }
    if ('provider' in changes) getProvider(changes.provider);
    if ('buddyName' in changes) changes.buddyName = String(changes.buddyName).trim().slice(0, NAME_MAX);
    if ('shortcut' in changes && changes.shortcut !== store.get('shortcut')) {
      if (!shortcut.register(String(changes.shortcut))) {
        throw new BuddyError('shortcut_taken', `"${changes.shortcut}" can't be used. Try another one.`);
      }
    }
    const before = store.all();
    store.set(changes);
    if (changes.size && changes.size !== before.size) buddy.resize();
    if (changes.buddyId && changes.buddyId !== before.buddyId) buddy.reloadModel();
    return snapshot();
  });

  handle('settings:save-key', async (providerId, key) => {
    const provider = getProvider(providerId);
    const apiKey = String(key || '').trim();
    if (!apiKey) throw new BuddyError('bad_request', 'Paste your key first.');
    let live = null;
    try {
      live = await provider.listModels({ apiKey });
    } catch (err) {
      // A wrong key is refused; being offline is not the key's fault.
      if (err.code !== 'network') throw err;
    }
    secrets.set(providerId, apiKey);
    const models = live && live.length ? live : provider.fallbackModels;
    const model = chooseModel(models, provider.fallbackModels, store.get('models')[providerId]);
    store.set({ models: { ...store.get('models'), [providerId]: model } });
    return { ...snapshot(), models };
  });

  handle('settings:clear-key', (providerId) => {
    getProvider(providerId);
    secrets.clear(providerId);
    return snapshot();
  });

  handle('settings:models', async (providerId) => ({ models: await ai.listModels(providerId) }));

  handle('settings:buddy-on', (on) => {
    power.setOn(Boolean(on));
    return snapshot();
  });

  handle('permissions:get', () => helper.call('permissions'));

  handle('permissions:request', (which) =>
    helper.call(which === 'screenRecording' ? 'requestScreenRecording' : 'requestAccessibility'));

  handle('permissions:open', async (which) => {
    const url = PERMISSION_PANES[which];
    if (!url) throw new BuddyError('bad_request', 'Unknown permission.');
    await shell.openExternal(url);
  });

  handle('settings:open-url', async (url) => {
    // Only the providers' own "get a key" pages may be opened from here.
    if (!PROVIDER_IDS.some((id) => PROVIDERS[id].keyUrl === url)) throw new BuddyError('not_allowed', 'Not allowed.');
    await shell.openExternal(url);
  });

  handle('onboarding:finish', (choice = {}) => {
    const buddyId = characters.list.some((c) => c.id === choice.buddyId) ? choice.buddyId : characters.list[0].id;
    const buddyName = String(choice.buddyName || '').trim().slice(0, NAME_MAX) || characters.get(buddyId).defaultName;
    store.set({ buddyId, buddyName, onboarded: true });
    onFinishOnboarding();
  });
}

module.exports = { registerSettingsIpc, chooseModel };
