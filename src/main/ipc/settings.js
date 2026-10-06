'use strict';

/** IPC for the Settings and Welcome windows. */

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
// An API key is printable ASCII with no spaces. Smart quotes, a zero-width space or a second
// line that came along with the paste make the request fail on this Mac, and that failure
// looks just like having no internet.
const KEY_SHAPE = /^[\x21-\x7e]+$/;

/** True when `name` is one of the object's own names. "constructor" and "__proto__" are not. */
const isOwnName = (object, name) => typeof name === 'string' && Object.hasOwn(object, name);

/** True for { ... } as a page sends it: not null, an array, a string or a number. */
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** The model to use after a key is saved: keep the user's pick if the key can use it. */
function chooseModel(available, fallbackModels, current) {
  if (current && available.includes(current)) return current;
  return available.includes(fallbackModels[0]) ? fallbackModels[0] : available[0];
}

/** The { providerId: model name } a page asks to save, copied, if it is well formed. */
function checkModels(models) {
  const wellFormed = isPlainObject(models) && Object.entries(models).every(
    ([id, model]) => PROVIDER_IDS.includes(id) && typeof model === 'string' && model.trim() !== '',
  );
  if (!wellFormed) throw new BuddyError('bad_request', 'Those model choices are not valid.');
  return { ...models };
}

/** The permission a page named, if it is one of ours. */
function checkPermission(which) {
  if (!isOwnName(PERMISSION_PANES, which)) throw new BuddyError('bad_request', 'Unknown permission.');
  return which;
}

function registerSettingsIpc({
  ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, onFinishOnboarding, shell,
}) {
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents));
  // Electron is loaded only when a page asks to open something, so these handlers can be
  // tested in plain Node by passing a `shell` of their own.
  const openExternal = (url) => (shell || require('electron').shell).openExternal(url);

  /**
   * Take `accelerator` as the shortcut; false when it cannot be used. While Buddy is on it is
   * compared with the shortcut that is registered now, not the saved one, so saving again retries
   * one that failed at launch. While Buddy is off its shortcut is let go: the new one is only
   * checked (registered, then let go at once), so the user still hears when it is taken. It is
   * registered for real when Buddy is turned on.
   */
  function useShortcut(accelerator) {
    if (power.isOn()) return accelerator === shortcut.current() || shortcut.register(accelerator);
    if (!shortcut.register(accelerator)) return false;
    shortcut.unregister();
    return true;
  }

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
    if (!isPlainObject(patch)) throw new BuddyError('bad_request', 'Those settings are not valid.');
    const changes = {};
    for (const key of SETTABLE) if (Object.hasOwn(patch, key)) changes[key] = patch[key];
    if (Object.hasOwn(changes, 'size') && !isOwnName(SIZES, changes.size)) throw new BuddyError('bad_request', 'Unknown size.');
    if (Object.hasOwn(changes, 'buddyId') && !characters.list.some((c) => c.id === changes.buddyId)) {
      throw new BuddyError('bad_request', 'Unknown buddy.');
    }
    if (Object.hasOwn(changes, 'provider')) getProvider(changes.provider);
    if (Object.hasOwn(changes, 'models')) changes.models = checkModels(changes.models);
    if (Object.hasOwn(changes, 'buddyName')) {
      const name = String(changes.buddyName || '').trim().slice(0, NAME_MAX);
      changes.buddyName = name || characters.get(changes.buddyId ?? store.get('buddyId')).defaultName;
    }
    // Last, so that a refused patch changes nothing: registering a shortcut is the one step
    // that throwing afterwards would not undo.
    if (Object.hasOwn(changes, 'shortcut')) {
      changes.shortcut = String(changes.shortcut).trim();
      if (!useShortcut(changes.shortcut)) {
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
    const apiKey = typeof key === 'string' ? key.trim() : '';
    if (!apiKey) throw new BuddyError('bad_request', 'Paste your key first.');
    if (!KEY_SHAPE.test(apiKey)) {
      throw new BuddyError('bad_key', "That doesn't look like an API key. Copy only the key and paste it again.");
    }
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
    // verified: the provider answered, so the key is known to work (false: saved but not checked).
    return { ...snapshot(), models, verified: live !== null };
  });

  handle('settings:clear-key', (providerId) => {
    getProvider(providerId);
    secrets.clear(providerId);
    return snapshot();
  });

  handle('settings:models', async (providerId) => {
    getProvider(providerId);
    return { models: await ai.listModels(providerId) };
  });

  handle('settings:buddy-on', (on) => {
    power.setOn(Boolean(on));
    return snapshot();
  });

  handle('permissions:get', () => helper.call('permissions'));

  handle('permissions:request', (which) =>
    helper.call(checkPermission(which) === 'screenRecording' ? 'requestScreenRecording' : 'requestAccessibility'));

  handle('permissions:open', async (which) => {
    await openExternal(PERMISSION_PANES[checkPermission(which)]);
  });

  handle('settings:open-url', async (url) => {
    // Only the providers' own "get a key" pages may be opened from here.
    if (!PROVIDER_IDS.some((id) => PROVIDERS[id].keyUrl === url)) throw new BuddyError('not_allowed', 'Not allowed.');
    await openExternal(url);
  });

  handle('onboarding:finish', (choice = {}) => {
    if (!isPlainObject(choice)) throw new BuddyError('bad_request', 'Those choices are not valid.');
    const buddyId = characters.list.some((c) => c.id === choice.buddyId) ? choice.buddyId : characters.list[0].id;
    const buddyName = String(choice.buddyName || '').trim().slice(0, NAME_MAX) || characters.get(buddyId).defaultName;
    store.set({ buddyId, buddyName, onboarded: true });
    onFinishOnboarding();
  });
}

module.exports = { registerSettingsIpc, chooseModel };
