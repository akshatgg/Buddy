'use strict';

/** IPC for the Settings and Welcome windows. */

const { BuddyError } = require('../../../shared/errors');
const { PROVIDERS, PROVIDER_IDS, getProvider, providerForKey } = require('../../../shared/providers');
const { AI_TIMEOUT_MS } = require('../ai');
const { SIZES } = require('../geometry');
const { guarded } = require('./result');
const { aiSection } = require('../free-state');
const { isTap, tapKeys } = require('../../renderer/common/shortcut-keys');

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
  ipcMain, windows, store, secrets, ai, characters, helper, buddy, power, shortcut, keyWatch, onFinishOnboarding, shell,
  account, cloud, canSignIn, version,
}) {
  // The Settings and Welcome windows only: the Admin window has calls of its own (ipc/admin.js).
  const handle = guarded(ipcMain, (webContents) => windows.owns(webContents, 'settings') || windows.owns(webContents, 'onboarding'));
  // Finishing the Welcome is for the Welcome window only: the Settings window has no business doing it.
  const handleWelcome = guarded(ipcMain, (webContents) => windows.owns(webContents, 'onboarding'));
  // Letting go of the shortcut and taking it back is for the Settings window only: main.js gives the shortcut back
  // when a Settings window closes, and for no other window, so a pause from another one would never be undone.
  const handleSettings = guarded(ipcMain, (webContents) => windows.owns(webContents, 'settings'));
  // Electron is loaded only when a page asks to open something, so these handlers can be
  // tested in plain Node by passing a `shell` of their own.
  const openExternal = (url) => (shell || require('electron').shell).openExternal(url);

  /**
   * Take `accelerator` as the shortcut; false when it cannot be used. While Buddy is on it is
   * compared with the shortcut that is registered now, not the saved one, so saving again retries
   * one that failed at launch. While Buddy is off its shortcut is let go: the new one is only
   * checked (registered, then let go at once), so the user still hears when it is taken. It is
   * registered for real when Buddy is turned on. A key tapped on its own ("Tap:RightOption") is never another app's, so
   * then it is only checked for being well formed: registering it would switch the helper on and off for nothing.
   */
  function useShortcut(accelerator) {
    if (power.isOn()) return accelerator === shortcut.current() || shortcut.register(accelerator);
    if (isTap(accelerator)) return tapKeys(accelerator) !== null;
    if (!shortcut.register(accelerator)) return false;
    shortcut.unregister();
    return true;
  }

  function snapshot() {
    const settings = store.all();
    delete settings.positions;
    delete settings.lastDisplayId;
    delete settings.cloud; // the server's free-mode settings: the page gets what they mean, in `ai`
    const user = account.user();
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
      account: user ? { signedIn: true, email: user.email, name: user.name, photo: user.photo || '' } : { signedIn: false },
      canSignIn,
      version,
      ai: aiSection(user ? cloud.last() : null), // free-mode settings apply only to someone signed in
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
    getProvider(providerId); // an unknown name is refused before anything else is looked at
    const apiKey = typeof key === 'string' ? key.trim() : '';
    if (!apiKey) throw new BuddyError('bad_request', 'Paste your key first.');
    if (!KEY_SHAPE.test(apiKey)) {
      throw new BuddyError('bad_key', "That doesn't look like an API key. Copy only the key and paste it again.");
    }
    // A key says by how it starts which AI it is for. If that is not the AI that was asked for, the key is
    // that AI's: it is checked there, kept there, and Buddy switches to it. A key that starts like none of
    // them is checked with the AI that was asked for.
    const ownerId = providerForKey(apiKey) ?? providerId;
    const switched = ownerId !== providerId;
    const provider = getProvider(ownerId);
    let live = null;
    try {
      live = await provider.listModels({ apiKey, signal: AbortSignal.timeout(AI_TIMEOUT_MS) });
    } catch (err) {
      // A wrong key is refused; being offline is not the key's fault.
      if (err.code !== 'network') throw err;
    }
    // From here the key is kept: before this, a refused key or a check that ran out of time has changed
    // nothing, and the chosen AI is still the one it was. The key is saved first, so that a Mac with no
    // keychain does not end up switched to an AI it has no key for.
    secrets.set(ownerId, apiKey);
    const models = live && live.length ? live : provider.fallbackModels;
    const model = chooseModel(models, provider.fallbackModels, store.get('models')[ownerId]);
    const changes = { models: { ...store.get('models'), [ownerId]: model } };
    if (switched) changes.provider = ownerId;
    store.set(changes);
    // verified: the provider answered, so the key is known to work (false: saved but not checked).
    const answer = { ...snapshot(), models, verified: live !== null };
    if (switched) answer.switchedFrom = providerId;
    return answer;
  });

  handle('settings:clear-key', (providerId) => {
    getProvider(providerId);
    secrets.clear(providerId);
    return snapshot();
  });

  handle('settings:models', async (providerId) => {
    getProvider(providerId);
    return { models: await ai.listModels(providerId, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }) };
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

  /**
   * Fetch this person's free-mode settings again. A failure is logged (by kind) and handed back, not thrown: the page
   * shows the last known settings, and only a caller that must know why it failed looks at what comes back.
   */
  async function refreshFree() {
    try {
      await cloud.settings({ force: true });
      return null;
    } catch (err) {
      console.warn('[buddy] could not fetch the free settings:', err.code || err.name);
      return err;
    }
  }

  handle('account:sign-in', async () => {
    await account.signIn();
    const failure = await refreshFree();
    // The server can turn a new sign-in down: cloud.js then signs the person out, and the fetch fails. That is not a
    // sign-in that worked, so it is not answered as one.
    if (!account.isSignedIn()) {
      throw new BuddyError('signed_out', failure instanceof BuddyError ? failure.message : "Sign-in didn't finish. Try again.");
    }
    return snapshot();
  });

  handle('account:sign-out', () => {
    account.signOut();
    return snapshot();
  });

  handle('settings:refresh', async () => {
    if (account.isSignedIn()) await refreshFree();
    return snapshot();
  });

  handleWelcome('onboarding:finish', (choice = {}) => {
    if (!isPlainObject(choice)) throw new BuddyError('bad_request', 'Those choices are not valid.');
    if (!account.isSignedIn()) throw new BuddyError('signed_out', 'Sign in with Google first.');
    const buddyId = characters.list.some((c) => c.id === choice.buddyId) ? choice.buddyId : characters.list[0].id;
    const buddyName = String(choice.buddyName || '').trim().slice(0, NAME_MAX) || characters.get(buddyId).defaultName;
    store.set({ buddyId, buddyName, onboarded: true });
    onFinishOnboarding();
  });

  /**
   * Recording is over: taps open the panel again, and the saved shortcut is registered again while Buddy is on (after
   * a recording, or when Settings closes). If another app took it while it was let go, that is logged (as main.js does
   * when Buddy starts) and nothing else happens.
   */
  function resumeShortcut() {
    const saved = store.get('shortcut');
    if (power.isOn() && shortcut.current() !== saved && !shortcut.register(saved)) {
      console.warn('[buddy] could not take the shortcut back');
    }
    // The recording ends only now that the saved shortcut is back, so that again there is no gap in hearing a key
    // tapped on its own (see shortcut:pause).
    keyWatch.stopRecording();
  }

  // While the Settings page records a new shortcut, Buddy lets go of its own, so that pressing the current one is
  // heard by the page instead of opening the panel. A key tapped on its own is heard by the Mac helper instead (the
  // page does not see fn or Caps Lock), and each tap is sent to the page.
  handleSettings('shortcut:pause', () => {
    // The recording starts first, then the shortcut goes, so that there is no gap in hearing a key tapped on its own:
    // with nothing to listen for in between, the helper would be switched off and on again. Taps go to the recording,
    // so none opens the panel meanwhile.
    keyWatch.startRecording((value) => windows.send('settings', 'shortcut:tap', value));
    shortcut.unregister();
    return {};
  });

  handleSettings('shortcut:resume', () => {
    resumeShortcut();
    return {};
  });

  return { resumeShortcut };
}

module.exports = { registerSettingsIpc, chooseModel };
