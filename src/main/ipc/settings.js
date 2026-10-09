'use strict';

/** IPC for the Settings and Welcome windows. */

const { BuddyError } = require('../../../shared/errors');
const { PROVIDERS, PROVIDER_IDS, getProvider, providerForKey } = require('../../../shared/providers');
const { AI_TIMEOUT_MS } = require('../ai');
const { SIZES } = require('../geometry');
const { guarded } = require('./result');
const { aiSection } = require('../free-state');
const { isTap, tapKeys } = require('../../renderer/common/shortcut-keys');
const { cleanFact } = require('../../../shared/memory-rules');
const { PROVIDER_ID: CLAUDE_ID, MODELS: CLAUDE_MODELS, MODEL_LABELS, GET_URL } = require('../claude/find');

const SETTABLE = ['buddyId', 'buddyName', 'size', 'shortcut', 'provider', 'models', 'listenOnOpen', 'tagOn', 'home'];
const HOMES = ['notch', 'floating']; // where Buddy lives (src/main/home.js)
const NAME_MAX = 24;
const PERMISSION_PANES = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
};
// An API key is printable ASCII with no spaces. Smart quotes, a zero-width space or a second
// line that came along with the paste make the request fail, and that failure looks just
// like having no internet.
const KEY_SHAPE = /^[\x21-\x7e]+$/;
// Settings → Memory refuses a fact in the same words, whether it is empty, too long or a secret (memory-rules.js).
const CANT_SAVE = "I can't save that. Passwords, PINs, OTPs and long numbers are never saved.";
// Claude Code on this computer is the fifth AI choice (the brain spec §3): it has no key, so a key is never saved or
// cleared for it, and its models are its own four names.
const NO_KEY_NEEDED = "Claude Code doesn't use a key.";

/** True when `name` is one of the object's own names. "constructor" and "__proto__" are not. */
const isOwnName = (object, name) => typeof name === 'string' && Object.hasOwn(object, name);

/** True for { ... } as a page sends it: not null, an array, a string or a number. */
const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** The model to use after a key is saved: keep the user's pick if the key can use it. */
function chooseModel(available, fallbackModels, current) {
  if (current && available.includes(current)) return current;
  return available.includes(fallbackModels[0]) ? fallbackModels[0] : available[0];
}

/** The { providerId: model name } a page asks to save, copied, if it is well formed. Claude Code's must be one of its aliases. */
function checkModels(models) {
  const wellFormed = isPlainObject(models) && Object.entries(models).every(([id, model]) => (
    id === CLAUDE_ID
      ? CLAUDE_MODELS.includes(model)
      : PROVIDER_IDS.includes(id) && typeof model === 'string' && model.trim() !== ''
  ));
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
  // What Buddy knows about the person (memory.js), for Settings → Memory.
  memory,
  // The microphone as macOS sees it (ipc/panel.js createMicrophone), for Settings → Permissions.
  microphone,
  // Claude Code on this computer (claude/find.js): its status is the fifth AI choice's "key".
  find,
  // True on the first launch after an update (updates.js firstLaunchOfNewVersion): the Permissions page says why macOS
  // asks again.
  justUpdated = false,
  platform = process.platform,
  // Where Buddy lives (home.js), for Settings → Buddy's "Where Buddy lives": without it, no notch is offered.
  home,
  // Buddy where you type (tag.js): told when its switch or the buddy's name changes.
  tagWatch = null,
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

  /** The fifth AI choice: Claude Code on this computer, which has no key; signed in counts as one. */
  function claudeChoice(status) {
    return {
      id: CLAUDE_ID,
      label: 'Claude Code on this computer',
      keyUrl: GET_URL,
      fallbackModels: CLAUDE_MODELS,
      modelLabels: MODEL_LABELS,
      hasKey: status.loggedIn === true,
      needsKey: false,
      status,
      line: find.line(status),
    };
  }

  async function snapshot() {
    const settings = store.all();
    delete settings.positions;
    delete settings.lastDisplayId;
    delete settings.cloud; // the server's free-mode settings: the page gets what they mean, in `ai`
    // What Buddy knows about the person, and its switch: the Memory section asks for them (settings:memory).
    delete settings.memory;
    delete settings.learnFromChats;
    const user = account.user();
    const claude = await find.status(); // kept for a minute (find.js): a page waits on claude once, not on every call
    return {
      settings,
      // 'darwin' or 'win32': the pages leave out what the system does not have (Windows asks for no permissions).
      platform,
      buddyOn: power.isOn(),
      characters: characters.list,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        keyUrl: PROVIDERS[id].keyUrl,
        fallbackModels: PROVIDERS[id].fallbackModels,
        hasKey: secrets.has(id),
        needsKey: true,
      })).concat(claudeChoice(claude)),
      account: user ? { signedIn: true, email: user.email, name: user.name, photo: user.photo || '' } : { signedIn: false },
      canSignIn,
      version,
      justUpdated,
      ai: aiSection(user ? cloud.last() : null), // free-mode settings apply only to someone signed in
      // Where Buddy lives, and whether a notch screen is on now: the choice is offered only then.
      home: settings.home,
      hasNotch: Boolean(home?.hasNotch()),
    };
  }

  handle('settings:get', () => snapshot());

  handle('settings:set', async (patch = {}) => {
    if (!isPlainObject(patch)) throw new BuddyError('bad_request', 'Those settings are not valid.');
    const changes = {};
    for (const key of SETTABLE) if (Object.hasOwn(patch, key)) changes[key] = patch[key];
    if (Object.hasOwn(changes, 'size') && !isOwnName(SIZES, changes.size)) throw new BuddyError('bad_request', 'Unknown size.');
    if (Object.hasOwn(changes, 'home') && !HOMES.includes(changes.home)) throw new BuddyError('bad_request', 'Unknown home.');
    if (Object.hasOwn(changes, 'buddyId') && !characters.list.some((c) => c.id === changes.buddyId)) {
      throw new BuddyError('bad_request', 'Unknown buddy.');
    }
    if (Object.hasOwn(changes, 'provider') && changes.provider !== CLAUDE_ID) getProvider(changes.provider);
    if (Object.hasOwn(changes, 'models')) changes.models = checkModels(changes.models);
    if (Object.hasOwn(changes, 'listenOnOpen') && typeof changes.listenOnOpen !== 'boolean') {
      throw new BuddyError('bad_request', 'Listen when the panel opens must be on or off.');
    }
    if (Object.hasOwn(changes, 'tagOn') && typeof changes.tagOn !== 'boolean') {
      throw new BuddyError('bad_request', 'Fix where I type must be on or off.');
    }
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
    tagWatch?.refresh(); // "Fix where I type" turned on or off, or the buddy renamed: the tag's names follow
    if (changes.size && changes.size !== before.size) buddy.resize();
    if (changes.buddyId && changes.buddyId !== before.buddyId) buddy.reloadModel();
    if (changes.home && changes.home !== before.home && home) await home.refresh(); // Buddy moves house
    return snapshot();
  });

  handle('settings:save-key', async (providerId, key) => {
    if (providerId === CLAUDE_ID) throw new BuddyError('bad_request', NO_KEY_NEEDED);
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
    const answer = { ...(await snapshot()), models, verified: live !== null };
    if (switched) answer.switchedFrom = providerId;
    return answer;
  });

  handle('settings:clear-key', (providerId) => {
    if (providerId === CLAUDE_ID) throw new BuddyError('bad_request', NO_KEY_NEEDED);
    getProvider(providerId);
    secrets.clear(providerId);
    return snapshot();
  });

  handle('settings:models', async (providerId) => {
    if (providerId === CLAUDE_ID) return { models: CLAUDE_MODELS };
    getProvider(providerId);
    return { models: await ai.listModels(providerId, { signal: AbortSignal.timeout(AI_TIMEOUT_MS) }) };
  });

  handle('settings:buddy-on', (on) => {
    power.setOn(Boolean(on));
    return snapshot();
  });

  // Accessibility and Screen Recording are the helper's to ask about; the microphone is Buddy's own (Electron asks
  // macOS). Windows does not ask per app, and has no Permissions section.
  handle('permissions:get', async () => ({ ...(await helper.call('permissions')), microphone: microphone.status() }));

  handle('permissions:request', async (which) => {
    const name = checkPermission(which);
    // macOS asks about the microphone only once: after that, the answer is how it stands, and the switch is in System
    // Settings (permissions:open).
    if (name === 'microphone') return { microphone: await microphone.ask() };
    return helper.call(name === 'screenRecording' ? 'requestScreenRecording' : 'requestAccessibility');
  });

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

  // Settings → Memory: the facts, oldest first, and "Learn about me from chats". Every call answers both, so the page
  // shows what is kept now. For the Settings window only: the Welcome has no Memory section.
  const memoryState = () => ({ facts: memory.list(), learning: memory.learning() });

  handleSettings('settings:memory', () => memoryState());

  handleSettings('settings:memory-add', (text) => {
    const fact = cleanFact(text);
    if (!fact) throw new BuddyError('bad_request', CANT_SAVE);
    // Typed in by the person, so it is kept with learning off too.
    if (!memory.add(fact, { source: 'settings' })) throw new BuddyError('bad_request', 'I already know that.');
    return memoryState();
  });

  handleSettings('settings:memory-remove', (id) => {
    memory.remove(id); // gone already (forgotten in another way meanwhile): the answer shows what is left
    return memoryState();
  });

  handleSettings('settings:memory-clear', () => {
    memory.clear();
    return memoryState();
  });

  handleSettings('settings:memory-learning', (on) => {
    if (typeof on !== 'boolean') throw new BuddyError('bad_request', 'Learning from chats must be on or off.');
    memory.setLearning(on);
    return memoryState();
  });

  return { resumeShortcut };
}

module.exports = { registerSettingsIpc, chooseModel };
