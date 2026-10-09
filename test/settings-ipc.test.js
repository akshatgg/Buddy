'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { EventEmitter } = require('node:events');
const { BuddyError } = require('../shared/errors');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const { DEFAULTS } = require('../src/main/store');
const { createMemory } = require('../src/main/memory');
const { createKeyWatch } = require('../src/main/key-watch');
const { createShortcut } = require('../src/main/shortcut');
const { tapKeys } = require('../src/renderer/common/shortcut-keys');
const { chooseModel, registerSettingsIpc } = require('../src/main/ipc/settings');
const { createFind, MODELS: CLAUDE_MODELS, MODEL_LABELS, GET_URL } = require('../src/main/claude/find');

const { line: claudeLine } = createFind({ env: {}, existsSync: () => false });

test('keeps the model the user picked when the key can use it', () => {
  assert.strictEqual(chooseModel(['a', 'b'], ['b'], 'a'), 'a');
});

test('otherwise uses the provider default when the key has it', () => {
  assert.strictEqual(chooseModel(['a', 'b'], ['b'], 'gone'), 'b');
});

test('otherwise the first model the key can use', () => {
  assert.strictEqual(chooseModel(['a', 'c'], ['b'], null), 'a');
});

// ---- the handlers, with fakes for everything that touches the system ----

const CHARACTERS = [
  { id: 'boy-1', defaultName: 'Aarav' },
  { id: 'girl-1', defaultName: 'Anaya' },
];
const CLAUDE = PROVIDERS.anthropic;
const GEMINI = PROVIDERS.gemini;
// Made-up keys with the starts the real ones have (shared/providers keyPrefixes).
const GEMINI_KEY = 'AIzaSy-not-a-real-gemini-key';
const GEMINI_MODELS = ['gemini-pro-latest', 'gemini-flash-latest', 'gemini-2.5-flash'];
const SETTINGS_PAGE = 'ours';
const WELCOME_PAGE = 'welcome';
const ADMIN_PAGE = 'admin';
const STRAY_KEY = "That doesn't look like an API key. Copy only the key and paste it again.";
const FAILED = { ok: false, error: { code: 'failed', message: 'Something went wrong. Try again.' } };
const refused = (code, message) => ({ ok: false, error: { code, message } });
const tick = () => new Promise((resolve) => setImmediate(resolve));

// What Claude Code's finder says (claude/find.js status()): signed in, installed but signed out, not installed.
const CLAUDE_IN = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max', version: '2.1.289', path: '/opt/homebrew/bin/claude', configDirectory: '/Users/a/.claude' };
const CLAUDE_OUT = { ...CLAUDE_IN, loggedIn: false, email: null, plan: null };
const CLAUDE_NONE = { installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null };

/**
 * registerSettingsIpc with fakes. `registered` is the shortcut that is
 * registered right now (null: none, as when it failed at launch, or while Buddy is
 * off); `taken` are shortcuts another app owns; `buddyOn` is whether Buddy is on.
 * `realShortcut` replaces the fake shortcut and `realKeyWatch` the fake key watch. Provider calls are faked per test
 * with t.mock.method(PROVIDERS.anthropic, 'listModels', ...). `signedIn` is whether someone is signed in; `free` is
 * the server's free-mode settings as the app last got them; `signInFails` and `cloudFails` make signing in or
 * fetching those settings fail; `cloudSignsOut` makes that fetch sign the person out first, as the real one does
 * when the server turns their sign-in down twice. `mic` is how the microphone stands, and `micAnswer` how it stands
 * once macOS has asked the person. `claude` is what Claude Code's finder says; `claudeCalls` gets the options of each
 * find.status() call.
 */
function setup({
  stored = {}, registered = 'Alt+Space', taken = [], keychain = true, buddyOn = false, realShortcut, realKeyWatch,
  signedIn = true, free = null, signInFails = null, cloudFails = null, cloudSignsOut = false, platform,
  mic = 'not-determined', micAnswer = 'granted',
  // Where Buddy lives (home.js): `hasNotch` is whether a notch screen is on; `withHome` false leaves home out, as an
  // older main.js would.
  withHome = true, hasNotch = false, claude = CLAUDE_OUT,
} = {}) {
  const data = { ...structuredClone(DEFAULTS), ...stored };
  const store = {
    get: (key) => data[key],
    all: () => structuredClone(data),
    set(patch) {
      Object.assign(data, patch);
      return structuredClone(data);
    },
  };
  const keys = {};
  const secrets = {
    has: (id) => Object.hasOwn(keys, id),
    set(id, key) {
      if (!keychain) throw new BuddyError('no_keychain', 'Your Mac keychain is not available, so the key cannot be saved safely.');
      keys[id] = key;
    },
    clear(id) {
      delete keys[id];
    },
  };
  const calls = [];
  const claudeCalls = []; // the options of each find.status() call
  const opened = [];
  let current = registered;
  let on = buddyOn;
  const handlers = {};
  let signed = signedIn;
  const account = {
    isSignedIn: () => signed,
    user: () => (signed ? { uid: 'u1', email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' } : null),
    async signIn() {
      calls.push(['signIn']);
      if (signInFails) throw signInFails;
      signed = true;
      return { uid: 'u1', email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' };
    },
    signOut() {
      calls.push(['signOut']);
      signed = false;
    },
  };
  const cloud = {
    last: () => free,
    async settings(options) {
      calls.push(['cloudSettings', options]);
      if (cloudSignsOut) account.signOut();
      if (cloudFails) throw cloudFails;
      return free;
    },
  };
  // Stands in for key-watch.js: `log` is 'start' and 'stop', in order; `recorder` is where taps go while recording.
  const keyWatch = {
    log: [],
    recorder: null,
    startRecording(onTap) {
      this.recorder = onTap;
      this.log.push('start');
    },
    stopRecording() {
      this.recorder = null;
      this.log.push('stop');
    },
  };
  const sent = []; // [kind, channel, ...args] for each thing sent to a window's page
  // The real memory (memory.js) on the fake store, with ids f1, f2, … and a clock that moves one second per fact.
  let ids = 0;
  let clock = 1_000_000;
  const memory = createMemory({ store, newId: () => `f${++ids}`, now: () => (clock += 1000) });
  const ipc = registerSettingsIpc({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = fn; } },
    windows: {
      // 'ours' is the Settings window's page, 'welcome' the Welcome window's and 'admin' the Admin window's.
      // owns(page, kind) asks about one kind; with no kind, about any of them.
      owns: (webContents, kind) => (kind === undefined
        ? [SETTINGS_PAGE, WELCOME_PAGE, ADMIN_PAGE].includes(webContents)
        : webContents === { settings: SETTINGS_PAGE, onboarding: WELCOME_PAGE, admin: ADMIN_PAGE }[kind]),
      send: (kind, channel, ...args) => sent.push([kind, channel, ...args]),
    },
    store,
    secrets,
    ai: { listModels: async (id, options) => { calls.push(['listModels', id, options]); return [`${id}-live`]; } },
    characters: { list: CHARACTERS, get: (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0] },
    helper: {
      call: async (cmd) => {
        calls.push(['helper', cmd]);
        return { accessibility: true, screenRecording: false };
      },
    },
    buddy: { resize: () => calls.push(['resize']), reloadModel: () => calls.push(['reloadModel']) },
    power: { isOn: () => on, setOn: (value) => { on = value; calls.push(['setOn', value]); } },
    shortcut: realShortcut || {
      current: () => current,
      register(accelerator) {
        calls.push(['register', accelerator]);
        if (taken.includes(accelerator)) return false;
        current = accelerator;
        return true;
      },
      unregister() {
        calls.push(['unregister']);
        current = null;
      },
    },
    keyWatch: realKeyWatch || keyWatch,
    // The microphone as macOS sees it (ipc/panel.js createMicrophone): asking it changes nothing once it has asked.
    microphone: {
      status: () => mic,
      async ask() {
        calls.push(['askMicrophone']);
        if (mic === 'not-determined') mic = micAnswer;
        return mic;
      },
    },
    shell: { openExternal: async (url) => { opened.push(url); } },
    onFinishOnboarding: () => calls.push(['finished']),
    account,
    cloud,
    memory,
    find: { status: async (options = {}) => { claudeCalls.push(options); return claude; }, line: claudeLine },
    canSignIn: true,
    version: '0.1.0',
    platform,
    home: withHome ? { hasNotch: () => hasNotch, refresh: async () => calls.push(['homeRefresh']) } : undefined,
  });
  const call = (channel, ...args) => handlers[channel]({ sender: SETTINGS_PAGE }, ...args);
  const callFromWelcome = (channel, ...args) => handlers[channel]({ sender: WELCOME_PAGE }, ...args);
  return { call, callFromWelcome, handlers, store, keys, calls, claudeCalls, opened, ipc, shortcutNow: () => current, keyWatch, sent, memory };
}

test('settings:get answers the settings without positions or lastDisplayId, the buddies and the providers', async () => {
  const s = setup({ stored: { positions: { 1: { x: 1, y: 2 } }, lastDisplayId: 7, size: 'large' } });
  s.keys.openai = 'k';
  const r = await s.call('settings:get');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.settings.size, 'large');
  assert.ok(!('positions' in r.settings) && !('lastDisplayId' in r.settings));
  assert.deepStrictEqual(s.store.get('positions'), { 1: { x: 1, y: 2 } }, 'the store itself is untouched');
  assert.strictEqual(r.buddyOn, false);
  assert.deepStrictEqual(r.characters, CHARACTERS);
  assert.deepStrictEqual(r.providers.map((p) => [p.id, p.hasKey]), [
    ['anthropic', false], ['openai', true], ['gemini', false], ['groq', false], ['claude-code', false],
  ]);
  for (const p of r.providers.slice(0, 4)) assert.deepStrictEqual(Object.keys(p).sort(), ['fallbackModels', 'hasKey', 'id', 'keyUrl', 'label', 'needsKey']);
  assert.ok(r.providers.slice(0, 4).every((p) => p.needsKey === true));
});

test('a page that is not the Settings or Welcome window gets nothing and changes nothing', async () => {
  const s = setup();
  for (const channel of Object.keys(s.handlers)) {
    const r = await s.handlers[channel]({ sender: 'someone else' }, { size: 'large' });
    assert.deepStrictEqual(r, refused('not_allowed', 'Not allowed.'), channel);
  }
  assert.deepStrictEqual(s.calls, []);
  assert.deepStrictEqual(s.opened, []);
  assert.strictEqual(s.store.get('size'), 'medium');
});

// ---- API keys ----

test('save-key: a key with stray characters is refused before the provider is asked', async (t) => {
  const listModels = t.mock.method(CLAUDE, 'listModels', async () => ['claude-x']);
  const s = setup();
  const strays = [
    '“sk-ant-abc”', // smart quotes
    'sk-ant-abc​', // a zero-width space on the end
    '​sk-ant-abc',
    'sk-ant-abc…',
    'sk-ant-abc\nsk-ant-def', // two lines pasted together
    'sk-ant abc',
    'sk-ant-é',
    'sk-\tant-abc',
  ];
  for (const key of strays) {
    assert.deepStrictEqual(await s.call('settings:save-key', 'anthropic', key), refused('bad_key', STRAY_KEY), JSON.stringify(key));
  }
  assert.strictEqual(listModels.mock.callCount(), 0);
  assert.deepStrictEqual(s.keys, {});
  assert.deepStrictEqual(s.store.get('models'), {});
});

test('save-key: nothing, blanks and things that are not text ask for a key', async (t) => {
  const listModels = t.mock.method(CLAUDE, 'listModels', async () => []);
  const s = setup();
  for (const key of ['', '   \n', null, undefined, 42, {}, ['sk-ant-abc']]) {
    const r = await s.call('settings:save-key', 'anthropic', key);
    assert.deepStrictEqual(r, refused('bad_request', 'Paste your key first.'), JSON.stringify(key));
  }
  assert.strictEqual(listModels.mock.callCount(), 0);
  assert.deepStrictEqual(s.keys, {});
});

test('save-key: a key the provider rejects is refused and not kept', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => {
    throw new BuddyError('bad_key', 'Your Claude (Anthropic) key was rejected. Check it in Settings.');
  });
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-wrong');
  assert.deepStrictEqual(r, refused('bad_key', 'Your Claude (Anthropic) key was rejected. Check it in Settings.'));
  assert.deepStrictEqual(s.keys, {});
  assert.deepStrictEqual(s.store.get('models'), {});
});

test('save-key: with no internet the key is kept, and the answer says it was not checked', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => {
    throw new BuddyError('network', "Couldn't reach Claude (Anthropic). Check your internet.");
  });
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', '  sk-ant-abc \n');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, false);
  assert.strictEqual(s.keys.anthropic, 'sk-ant-abc', 'saved without the spaces around it');
  assert.deepStrictEqual(r.models, CLAUDE.fallbackModels);
  assert.strictEqual(r.settings.models.anthropic, CLAUDE.fallbackModels[0]);
  assert.strictEqual(r.providers.find((p) => p.id === 'anthropic').hasKey, true);
});

test('save-key: a key the provider accepts is kept, verified, with a model the key can use', async (t) => {
  const timeout = t.mock.method(AbortSignal, 'timeout', () => 'the 60 s signal');
  const listModels = t.mock.method(CLAUDE, 'listModels', async () => ['claude-sonnet-5-5', 'claude-opus-5-5']);
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-abc');
  assert.deepStrictEqual(listModels.mock.calls[0].arguments, [{ apiKey: 'sk-ant-abc', signal: 'the 60 s signal' }]);
  assert.deepStrictEqual(timeout.mock.calls.map((c) => c.arguments), [[60_000]], 'the check is given 60 seconds');
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(s.keys.anthropic, 'sk-ant-abc');
  assert.deepStrictEqual(r.models, ['claude-sonnet-5-5', 'claude-opus-5-5']);
  // The provider's own default is not on this key's list, so the first model the key can use is chosen.
  assert.strictEqual(r.settings.models.anthropic, 'claude-sonnet-5-5');
  assert.strictEqual(s.store.get('models').anthropic, 'claude-sonnet-5-5');
});

test('save-key: a working key keeps the model the user already picked, and other providers are left alone', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => ['claude-sonnet-5-5', 'claude-opus-5-5']);
  const s = setup({ stored: { models: { anthropic: 'claude-opus-5-5', openai: 'gpt-4.1' } } });
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-abc');
  assert.deepStrictEqual(r.settings.models, { anthropic: 'claude-opus-5-5', openai: 'gpt-4.1' });
});

test('save-key: a working key that lists no models is verified and uses the fallback list', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => []);
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-abc');
  assert.strictEqual(r.verified, true);
  assert.deepStrictEqual(r.models, CLAUDE.fallbackModels);
});

test('save-key: a check that takes too long is refused in plain words, and the key is not kept', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => {
    throw new BuddyError('timeout', 'Claude took too long to answer. Try again.');
  });
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-abc');
  assert.deepStrictEqual(r, refused('timeout', 'Claude took too long to answer. Try again.'));
  assert.deepStrictEqual(s.keys, {}, 'it was not "no internet", so it is not saved as unchecked');
  assert.deepStrictEqual(s.store.get('models'), {});
});

test('save-key: an unexpected failure is not mistaken for being offline', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  t.mock.method(CLAUDE, 'listModels', async () => {
    throw new TypeError('x is not a function');
  });
  const s = setup();
  assert.deepStrictEqual(await s.call('settings:save-key', 'anthropic', 'sk-ant-abc'), FAILED);
  assert.strictEqual(logged.mock.callCount(), 1);
  assert.deepStrictEqual(s.keys, {});
});

test('save-key: without a keychain the key is not saved and no model is chosen', async (t) => {
  t.mock.method(CLAUDE, 'listModels', async () => ['claude-sonnet-5-5']);
  const s = setup({ keychain: false });
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-abc');
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'no_keychain');
  assert.deepStrictEqual(s.store.get('models'), {});
});

// A key says by how it starts which AI it is for. When that is not the AI that was asked for, Buddy uses
// the AI the key belongs to: it checks the key there, keeps it there, and switches to it.

/**
 * Every provider's check of a key, faked with t.mock.method(PROVIDERS.<id>, 'listModels', ...) so that a test that
 * asks the wrong AI fails on its assertions instead of calling a real one. `fakes` replaces some of the answers.
 */
function fakeKeyChecks(t, fakes = {}) {
  return Object.fromEntries(PROVIDER_IDS.map((id) => [
    id,
    t.mock.method(PROVIDERS[id], 'listModels', fakes[id] || (async () => PROVIDERS[id].fallbackModels)),
  ]));
}

/** The ids of the providers whose check was called. */
const asked = (checks) => PROVIDER_IDS.filter((id) => checks[id].mock.callCount() > 0);

test('save-key: a key that belongs to another AI is checked with that AI, kept under it, and switches to it', async (t) => {
  t.mock.method(AbortSignal, 'timeout', () => 'the 60 s signal');
  const checks = fakeKeyChecks(t, { gemini: async () => GEMINI_MODELS });
  const s = setup({ stored: { models: { anthropic: 'claude-opus-5-5' } } });
  const r = await s.call('settings:save-key', 'anthropic', `  ${GEMINI_KEY} \n`);
  assert.deepStrictEqual(asked(checks), ['gemini'], "only Gemini is asked: it is not Claude's key");
  assert.deepStrictEqual(checks.gemini.mock.calls.map((c) => c.arguments), [[{ apiKey: GEMINI_KEY, signal: 'the 60 s signal' }]]);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, true);
  assert.strictEqual(r.switchedFrom, 'anthropic');
  assert.deepStrictEqual(s.keys, { gemini: GEMINI_KEY }, 'kept under Gemini, trimmed, and not under Claude');
  assert.strictEqual(r.settings.provider, 'gemini');
  assert.strictEqual(s.store.get('provider'), 'gemini');
  assert.deepStrictEqual(r.models, GEMINI_MODELS);
  assert.strictEqual(r.settings.models.gemini, 'gemini-flash-latest', "Gemini's own default, since the key can use it");
  assert.strictEqual(r.settings.models.anthropic, 'claude-opus-5-5', 'the model picked for Claude is left alone');
  assert.deepStrictEqual(r.providers.map((p) => [p.id, p.hasKey]), [
    ['anthropic', false], ['openai', false], ['gemini', true], ['groq', false], ['claude-code', false],
  ]);
});

test('save-key: a key for another AI that the AI refuses, or cannot check in time, changes nothing', async (t) => {
  const checks = fakeKeyChecks(t);
  for (const [code, message] of [
    ['bad_key', 'Your Google Gemini key was rejected. Check it in Settings.'],
    ['timeout', 'Gemini took too long to answer. Try again.'],
  ]) {
    checks.gemini.mock.mockImplementation(async () => {
      throw new BuddyError(code, message);
    });
    const s = setup({ stored: { models: { anthropic: 'claude-opus-5-5' } } });
    const before = s.store.all();
    assert.deepStrictEqual(await s.call('settings:save-key', 'anthropic', GEMINI_KEY), refused(code, message), code);
    assert.deepStrictEqual(s.keys, {}, `${code}: no key is kept, for Gemini or for Claude`);
    assert.deepStrictEqual(s.store.all(), before, `${code}: the AI is still Claude, and no model was chosen`);
  }
  assert.deepStrictEqual(asked(checks), ['gemini'], 'and Claude was never asked');
});

test('save-key: a key for another AI, with no internet, is kept under that AI unchecked, and switches to it', async (t) => {
  const checks = fakeKeyChecks(t, {
    gemini: async () => {
      throw new BuddyError('network', "Couldn't reach Google Gemini. Check your internet.");
    },
  });
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', GEMINI_KEY);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.verified, false);
  assert.strictEqual(r.switchedFrom, 'anthropic');
  assert.deepStrictEqual(s.keys, { gemini: GEMINI_KEY });
  assert.strictEqual(r.settings.provider, 'gemini');
  assert.strictEqual(s.store.get('provider'), 'gemini');
  assert.deepStrictEqual(r.models, GEMINI.fallbackModels);
  assert.strictEqual(r.settings.models.gemini, GEMINI.fallbackModels[0]);
  assert.deepStrictEqual(asked(checks), ['gemini']);
});

test('save-key: a key of another AI that cannot be kept (no keychain) does not switch the AI either', async (t) => {
  fakeKeyChecks(t, { gemini: async () => GEMINI_MODELS });
  const s = setup({ keychain: false });
  const before = s.store.all();
  const r = await s.call('settings:save-key', 'anthropic', GEMINI_KEY);
  assert.strictEqual(r.ok, false);
  assert.strictEqual(r.error.code, 'no_keychain');
  assert.deepStrictEqual(s.keys, {});
  assert.deepStrictEqual(s.store.all(), before);
});

test('save-key: a key that belongs to the AI that was asked for does not switch, and the answer has no switchedFrom', async (t) => {
  const checks = fakeKeyChecks(t);
  const s = setup();
  const r = await s.call('settings:save-key', 'anthropic', 'sk-ant-api03-abc');
  assert.strictEqual(r.ok, true);
  assert.ok(!('switchedFrom' in r), 'left out, not even undefined');
  assert.strictEqual(r.settings.provider, 'anthropic');
  assert.deepStrictEqual(s.keys, { anthropic: 'sk-ant-api03-abc' });
  assert.deepStrictEqual(asked(checks), ['anthropic']);
});

test('save-key: a key that starts like none of them is checked with the AI that was asked for, and does not switch', async (t) => {
  const checks = fakeKeyChecks(t);
  const s = setup({ stored: { provider: 'groq' } });
  const r = await s.call('settings:save-key', 'groq', 'not-a-known-start-123');
  assert.strictEqual(r.ok, true);
  assert.ok(!('switchedFrom' in r));
  assert.strictEqual(r.settings.provider, 'groq');
  assert.deepStrictEqual(s.keys, { groq: 'not-a-known-start-123' });
  assert.deepStrictEqual(asked(checks), ['groq']);
});

test('save-key: each AI recognises its own keys, whichever AI was asked for', async (t) => {
  const checks = fakeKeyChecks(t);
  const keys = { anthropic: 'sk-ant-api03-abc', openai: 'sk-proj-abc', gemini: GEMINI_KEY, groq: 'gsk_abc' };
  for (const [owner, key] of Object.entries(keys)) {
    for (const chosen of PROVIDER_IDS) {
      for (const check of Object.values(checks)) check.mock.resetCalls();
      const s = setup({ stored: { provider: chosen } }); // the AI that is chosen on screen is the one that is asked for
      const r = await s.call('settings:save-key', chosen, key);
      const when = `${key} with ${chosen} chosen`;
      assert.strictEqual(r.ok, true, when);
      assert.strictEqual(r.settings.provider, owner, when);
      assert.deepStrictEqual(s.keys, { [owner]: key }, when);
      assert.strictEqual(r.switchedFrom, owner === chosen ? undefined : chosen, when);
      assert.deepStrictEqual(asked(checks), [owner], `${when}: only its own AI is asked`);
    }
  }
});

test('save-key: the check for stray characters still comes first, for a key of another AI too', async (t) => {
  const checks = fakeKeyChecks(t);
  const s = setup();
  for (const key of ['“AIzaSy-abc”', 'AIzaSy-abc…', 'AIzaSy-abc\nAIzaSy-def', 'AIzaSy abc']) {
    assert.deepStrictEqual(await s.call('settings:save-key', 'anthropic', key), refused('bad_key', STRAY_KEY), JSON.stringify(key));
  }
  assert.deepStrictEqual(asked(checks), []);
  assert.deepStrictEqual(s.keys, {});
  assert.strictEqual(s.store.get('provider'), 'anthropic');
});

test('keys and models: only real provider names are accepted', async () => {
  const s = setup();
  for (const id of ['constructor', '__proto__', 'toString', 'nope', undefined, null, ['anthropic']]) {
    for (const [channel, args] of [
      ['settings:save-key', [id, 'sk-ant-abc']],
      ['settings:clear-key', [id]],
      ['settings:models', [id]],
    ]) {
      const r = await s.call(channel, ...args);
      assert.strictEqual(r.ok, false, `${channel} ${JSON.stringify(id)}`);
      assert.strictEqual(r.error.code, 'bad_request', `${channel} ${JSON.stringify(id)}`);
    }
  }
  assert.deepStrictEqual(s.keys, {});
});

test('clear-key forgets the key; models answers the list for a provider', async (t) => {
  t.mock.method(AbortSignal, 'timeout', () => 'the 60 s signal');
  const s = setup();
  s.keys.openai = 'k';
  const cleared = await s.call('settings:clear-key', 'openai');
  assert.strictEqual(cleared.providers.find((p) => p.id === 'openai').hasKey, false);
  assert.deepStrictEqual(await s.call('settings:models', 'openai'), { ok: true, models: ['openai-live'] });
  assert.deepStrictEqual(s.calls, [['listModels', 'openai', { signal: 'the 60 s signal' }]], 'the list is given 60 seconds too');
});

// ---- opening pages ----

test('open-url opens the providers key pages and nothing else', async () => {
  const s = setup();
  const keyUrls = PROVIDER_IDS.map((id) => PROVIDERS[id].keyUrl);
  for (const url of keyUrls) assert.deepStrictEqual(await s.call('settings:open-url', url), { ok: true });
  assert.deepStrictEqual(s.opened, keyUrls);
  const others = [
    'https://evil.example/',
    'file:///etc/passwd',
    'x-apple.systempreferences:com.apple.preference.security',
    `${keyUrls[0]}#frag`,
    `${keyUrls[0]} `,
    '',
    null,
    undefined,
    [keyUrls[0]],
    { toString: () => keyUrls[0] },
  ];
  for (const url of others) {
    assert.deepStrictEqual(await s.call('settings:open-url', url), refused('not_allowed', 'Not allowed.'), JSON.stringify(url));
  }
  assert.deepStrictEqual(s.opened, keyUrls, 'nothing else was opened');
});

test('permissions: the two real names ask the helper and open their System Settings page', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('permissions:get'), { ok: true, accessibility: true, screenRecording: false, microphone: 'not-determined' });
  await s.call('permissions:request', 'accessibility');
  await s.call('permissions:request', 'screenRecording');
  assert.deepStrictEqual(s.calls, [['helper', 'permissions'], ['helper', 'requestAccessibility'], ['helper', 'requestScreenRecording']]);
  await s.call('permissions:open', 'accessibility');
  await s.call('permissions:open', 'screenRecording');
  assert.deepStrictEqual(s.opened, [
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  ]);
});

test('permissions: any other name is refused by request and by open, and reaches neither the helper nor System Settings', async () => {
  const s = setup();
  for (const which of ['constructor', '__proto__', 'toString', 'banana', '', undefined, null, ['accessibility']]) {
    for (const channel of ['permissions:request', 'permissions:open']) {
      const r = await s.call(channel, which);
      assert.deepStrictEqual(r, refused('bad_request', 'Unknown permission.'), `${channel} ${JSON.stringify(which)}`);
    }
  }
  assert.deepStrictEqual(s.calls, []);
  assert.deepStrictEqual(s.opened, []);
});

test('permissions: the microphone is asked of macOS itself, and its System Settings page is Privacy_Microphone', async () => {
  const s = setup({ mic: 'not-determined', micAnswer: 'granted' });
  assert.deepStrictEqual(await s.call('permissions:request', 'microphone'), { ok: true, microphone: 'granted' });
  assert.deepStrictEqual(await s.call('permissions:get'), { ok: true, accessibility: true, screenRecording: false, microphone: 'granted' });
  await s.call('permissions:open', 'microphone');
  assert.deepStrictEqual(s.opened, ['x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone']);
  assert.deepStrictEqual(s.calls, [['askMicrophone'], ['helper', 'permissions']], 'the helper is not asked about the microphone');
});

test('permissions: a microphone refused stays refused when asked again: macOS asks only once', async () => {
  const s = setup({ mic: 'denied' });
  assert.deepStrictEqual(await s.call('permissions:request', 'microphone'), { ok: true, microphone: 'denied' });
});

test('buddy-on turns the buddy on or off and answers how it now stands', async () => {
  const s = setup();
  assert.strictEqual((await s.call('settings:buddy-on', true)).buddyOn, true);
  assert.strictEqual((await s.call('settings:buddy-on', 0)).buddyOn, false);
  assert.deepStrictEqual(s.calls, [['setOn', true], ['setOn', false]]);
});

// ---- settings:set ----

test('set: a size must be one of the three, not a name every object has', async () => {
  const s = setup();
  const before = s.store.all();
  for (const size of ['huge', 'constructor', '__proto__', 'toString', 'hasOwnProperty', '', ['small'], null, undefined, 48, {}]) {
    assert.deepStrictEqual(await s.call('settings:set', { size }), refused('bad_request', 'Unknown size.'), JSON.stringify(size));
  }
  assert.deepStrictEqual(s.store.all(), before);
  assert.deepStrictEqual(s.calls, []);
});

test('set: a new size is saved and resizes the buddy once; the same size does nothing more', async () => {
  const s = setup();
  const r = await s.call('settings:set', { size: 'large' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.settings.size, 'large');
  await s.call('settings:set', { size: 'large' });
  assert.deepStrictEqual(s.calls, [['resize']]);
});

test('set: a buddy must be one of the characters, and a new one reloads the model', async () => {
  const s = setup();
  const before = s.store.all();
  for (const buddyId of ['nope', 'constructor', '__proto__', '', ['girl-1'], null, undefined]) {
    assert.deepStrictEqual(await s.call('settings:set', { buddyId }), refused('bad_request', 'Unknown buddy.'), JSON.stringify(buddyId));
  }
  assert.deepStrictEqual(s.store.all(), before);
  assert.strictEqual((await s.call('settings:set', { buddyId: 'girl-1' })).settings.buddyId, 'girl-1');
  await s.call('settings:set', { buddyId: 'girl-1' });
  assert.deepStrictEqual(s.calls, [['reloadModel']]);
});

test('set: a provider must be a real one', async () => {
  const s = setup();
  const before = s.store.all();
  for (const provider of ['nope', 'constructor', '__proto__', 'toString', '', undefined, null, ['groq'], 1]) {
    const r = await s.call('settings:set', { provider });
    assert.strictEqual(r.ok, false, JSON.stringify(provider));
    assert.strictEqual(r.error.code, 'bad_request', JSON.stringify(provider));
  }
  assert.deepStrictEqual(s.store.all(), before);
  assert.strictEqual((await s.call('settings:set', { provider: 'groq' })).settings.provider, 'groq');
  assert.strictEqual((await s.call('settings:set', { provider: 'claude-code' })).settings.provider, 'claude-code');
});

test('set: models must be { providerId: model name } for real providers', async () => {
  const s = setup();
  const before = s.store.all();
  const bad = [
    null, [], 'anthropic', 5, { nope: 'm' }, { constructor: 'm' }, { anthropic: '' }, { anthropic: '   ' },
    { anthropic: 5 }, { anthropic: null }, { anthropic: ['m'] }, { anthropic: 'm', nope: 'x' },
    JSON.parse('{"__proto__":"m"}'), JSON.parse('{"anthropic":"m","__proto__":{"x":1}}'),
    { 'claude-code': 'gpt-4.1' }, { 'claude-code': 'Sonnet' },
  ];
  for (const models of bad) {
    const r = await s.call('settings:set', { models });
    assert.deepStrictEqual(r, refused('bad_request', 'Those model choices are not valid.'), JSON.stringify(models));
  }
  assert.deepStrictEqual(s.store.all(), before);
  const good = { anthropic: 'claude-sonnet-5-5', groq: 'llama-3.3-70b-versatile', 'claude-code': 'opus' };
  const r = await s.call('settings:set', { models: good });
  assert.deepStrictEqual(r.settings.models, good);
  assert.notStrictEqual(s.store.get('models'), good, 'what is stored is a copy');
  assert.deepStrictEqual((await s.call('settings:set', { models: {} })).settings.models, {});
});

test('set: the patch must be an object; with no patch at all nothing changes', async () => {
  const s = setup();
  const before = s.store.all();
  for (const patch of [null, 'size', 5, true, [], [{ size: 'large' }]]) {
    assert.deepStrictEqual(await s.call('settings:set', patch), refused('bad_request', 'Those settings are not valid.'), JSON.stringify(patch));
  }
  assert.deepStrictEqual(s.store.all(), before);
  assert.strictEqual((await s.call('settings:set')).ok, true);
  assert.deepStrictEqual(s.store.all(), before);
});

test('set: only the settings a page may change are taken from a patch, and __proto__ is not one of them', async () => {
  const s = setup();
  const patch = JSON.parse(
    '{"__proto__":{"size":"small"},"onboarded":true,"positions":{"1":{"x":1,"y":1}},"buddyOn":true,"lastDisplayId":3,"buddyName":"Zed"}',
  );
  assert.strictEqual((await s.call('settings:set', patch)).ok, true);
  assert.strictEqual(s.store.get('buddyName'), 'Zed');
  assert.strictEqual(s.store.get('onboarded'), false);
  assert.deepStrictEqual(s.store.get('positions'), {});
  assert.strictEqual(s.store.get('buddyOn'), false);
  assert.strictEqual(s.store.get('lastDisplayId'), null);
  assert.strictEqual(s.store.get('size'), 'medium');
  assert.strictEqual(({}).size, undefined, 'Object.prototype was not touched');
});

test('set: "Listen when the panel opens" is off unless turned on, and takes nothing but true or false', async () => {
  const s = setup();
  assert.strictEqual((await s.call('settings:get')).settings.listenOnOpen, false);
  assert.strictEqual((await s.call('settings:set', { listenOnOpen: true })).settings.listenOnOpen, true);
  assert.strictEqual((await s.call('settings:set', { listenOnOpen: false })).settings.listenOnOpen, false);
  assert.strictEqual(s.store.get('listenOnOpen'), false);
  for (const listenOnOpen of ['true', 1, 0, null, undefined, {}, ['on']]) {
    assert.deepStrictEqual(await s.call('settings:set', { listenOnOpen, size: 'large' }),
      refused('bad_request', 'Listen when the panel opens must be on or off.'), JSON.stringify(listenOnOpen));
  }
  assert.strictEqual(s.store.get('listenOnOpen'), false, 'nothing changed');
  assert.strictEqual(s.store.get('size'), 'medium');
  assert.strictEqual((await s.call('settings:set', { listenOnOpen: true })).settings.listenOnOpen, true);
  assert.deepStrictEqual(s.calls, []);
});

// ---- where Buddy lives ----

test('the snapshot says where Buddy lives and whether a notch screen is on, so the page knows whether to offer the choice', async () => {
  const r = await setup({ hasNotch: true }).call('settings:get');
  assert.strictEqual(r.home, 'notch');
  assert.strictEqual(r.settings.home, 'notch');
  assert.strictEqual(r.hasNotch, true);
  assert.strictEqual((await setup({ hasNotch: false }).call('settings:get')).hasNotch, false);
  assert.strictEqual((await setup({ stored: { home: 'floating' } }).call('settings:get')).home, 'floating');
  const without = await setup({ withHome: false, hasNotch: true }).call('settings:get');
  assert.strictEqual(without.hasNotch, false, 'with no home given, there is no notch to speak of');
  assert.strictEqual(without.home, 'notch');
});

test('set: where Buddy lives is the notch or floating, and a change moves Buddy; the same again does nothing more', async () => {
  const s = setup({ hasNotch: true });
  const r = await s.call('settings:set', { home: 'floating' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.home, 'floating');
  assert.strictEqual(s.store.get('home'), 'floating');
  assert.deepStrictEqual(s.calls, [['homeRefresh']]);
  await s.call('settings:set', { home: 'floating' });
  assert.deepStrictEqual(s.calls, [['homeRefresh']], 'the same home again');
  await s.call('settings:set', { home: 'notch', size: 'large' });
  assert.deepStrictEqual(s.calls, [['homeRefresh'], ['resize'], ['homeRefresh']]);
  assert.strictEqual(s.store.get('home'), 'notch');
});

test('set: a home that is neither is refused, and nothing in the patch is saved', async () => {
  const s = setup({ hasNotch: true });
  const before = s.store.all();
  for (const home of ['dock', 'constructor', '__proto__', '', null, undefined, 1, ['notch'], { home: 'notch' }]) {
    assert.deepStrictEqual(await s.call('settings:set', { home, size: 'large' }), refused('bad_request', 'Unknown home.'), JSON.stringify(home));
  }
  assert.deepStrictEqual(s.store.all(), before);
  assert.deepStrictEqual(s.calls, []);
});

test('set: with no home given (an older main.js), the setting is still saved and nothing breaks', async () => {
  const s = setup({ withHome: false });
  assert.strictEqual((await s.call('settings:set', { home: 'floating' })).ok, true);
  assert.strictEqual(s.store.get('home'), 'floating');
  assert.deepStrictEqual(s.calls, []);
});

test('set: a shortcut that cannot be registered changes nothing at all', async () => {
  const s = setup({ taken: ['Command+Q'], buddyOn: true });
  const before = s.store.all();
  const r = await s.call('settings:set', { shortcut: 'Command+Q', size: 'large', buddyId: 'girl-1', buddyName: 'Zed' });
  assert.deepStrictEqual(r, refused('shortcut_taken', '"Command+Q" can\'t be used. Try another one.'));
  assert.deepStrictEqual(s.store.all(), before);
  assert.deepStrictEqual(s.calls, [['register', 'Command+Q']], 'no resize and no model reload');
  assert.strictEqual(s.shortcutNow(), 'Alt+Space');
});

test('set: the shortcut is saved trimmed, and the trimmed text is what gets registered', async () => {
  const s = setup({ buddyOn: true });
  const r = await s.call('settings:set', { shortcut: '  CommandOrControl+Shift+B \n' });
  assert.strictEqual(r.settings.shortcut, 'CommandOrControl+Shift+B');
  assert.strictEqual(s.store.get('shortcut'), 'CommandOrControl+Shift+B');
  assert.deepStrictEqual(s.calls, [['register', 'CommandOrControl+Shift+B']]);
});

test('set: a shortcut that is registered already is not registered again', async () => {
  const s = setup({ registered: 'Alt+Space', buddyOn: true });
  assert.strictEqual((await s.call('settings:set', { shortcut: ' Alt+Space ' })).ok, true);
  assert.deepStrictEqual(s.calls, []);
  assert.strictEqual(s.store.get('shortcut'), 'Alt+Space');
});

test('set: saving the stored shortcut again registers it if it failed to register at launch', async () => {
  const s = setup({ stored: { shortcut: 'Alt+Space' }, registered: null, buddyOn: true });
  assert.strictEqual((await s.call('settings:set', { shortcut: 'Alt+Space' })).ok, true);
  assert.deepStrictEqual(s.calls, [['register', 'Alt+Space']]);
  assert.strictEqual(s.shortcutNow(), 'Alt+Space');

  const stillTaken = setup({ stored: { shortcut: 'Alt+Space' }, registered: null, taken: ['Alt+Space'], buddyOn: true });
  const r = await stillTaken.call('settings:set', { shortcut: 'Alt+Space' });
  assert.deepStrictEqual(r, refused('shortcut_taken', '"Alt+Space" can\'t be used. Try another one.'));
});

// While Buddy is off its shortcut is let go. Changing it in Settings still tells the user when the new one is
// taken, but only checks it (registers it, then lets it go at once): it is taken for real when Buddy is turned on.

test('set: while Buddy is off a new shortcut is saved and checked, then left unregistered', async () => {
  const s = setup({ registered: null });
  const r = await s.call('settings:set', { shortcut: ' CommandOrControl+Shift+B ' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.settings.shortcut, 'CommandOrControl+Shift+B', 'the reply is the usual snapshot');
  assert.strictEqual(r.buddyOn, false);
  assert.strictEqual(s.store.get('shortcut'), 'CommandOrControl+Shift+B');
  assert.deepStrictEqual(s.calls, [['register', 'CommandOrControl+Shift+B'], ['unregister']], 'registered to see that it is free, then let go');
  assert.strictEqual(s.shortcutNow(), null);
});

test('set: while Buddy is off a shortcut that is taken is still refused, and nothing changes', async () => {
  const s = setup({ registered: null, taken: ['Command+Q'] });
  const before = s.store.all();
  const r = await s.call('settings:set', { shortcut: 'Command+Q', size: 'large' });
  assert.deepStrictEqual(r, refused('shortcut_taken', '"Command+Q" can\'t be used. Try another one.'));
  assert.deepStrictEqual(s.store.all(), before);
  assert.deepStrictEqual(s.calls, [['register', 'Command+Q']], 'no resize either');
  assert.strictEqual(s.shortcutNow(), null);
});

test('set: while Buddy is off, saving the shortcut that is already saved checks it again and lets it go', async () => {
  const s = setup({ stored: { shortcut: 'Alt+Space' }, registered: null });
  assert.strictEqual((await s.call('settings:set', { shortcut: 'Alt+Space' })).ok, true);
  assert.deepStrictEqual(s.calls, [['register', 'Alt+Space'], ['unregister']]);
  assert.strictEqual(s.shortcutNow(), null);

  const taken = setup({ stored: { shortcut: 'Alt+Space' }, registered: null, taken: ['Alt+Space'] });
  const r = await taken.call('settings:set', { shortcut: 'Alt+Space' });
  assert.deepStrictEqual(r, refused('shortcut_taken', '"Alt+Space" can\'t be used. Try another one.'));
});

test('set: other settings changed while Buddy is off do not touch the shortcut at all', async () => {
  const s = setup({ registered: null });
  assert.strictEqual((await s.call('settings:set', { size: 'large', buddyName: 'Zed' })).ok, true);
  assert.deepStrictEqual(s.calls, [['resize']]);
});

test('set: with the real shortcut object, one changed while Buddy is off is taken only when Buddy is turned on', async () => {
  const system = new Map(); // what the system has registered: accelerator -> handler
  const globalShortcut = {
    register(accelerator, fn) {
      if (accelerator === 'Command+Q') return false; // another app has it
      system.set(accelerator, fn);
      return true;
    },
    unregister: (accelerator) => system.delete(accelerator),
  };
  const shortcut = createShortcut({ globalShortcut, onPress: () => {} });
  shortcut.register('Alt+Space');
  shortcut.unregister(); // Buddy was turned off
  const s = setup({ realShortcut: shortcut });

  assert.strictEqual((await s.call('settings:set', { shortcut: 'CommandOrControl+Shift+B' })).ok, true);
  assert.deepStrictEqual([...system.keys()], [], 'nothing is registered while Buddy is off');
  const taken = await s.call('settings:set', { shortcut: 'Command+Q' });
  assert.strictEqual(taken.error.code, 'shortcut_taken');
  assert.deepStrictEqual([...system.keys()], [], 'and a refused one registers nothing either');
  assert.strictEqual(s.store.get('shortcut'), 'CommandOrControl+Shift+B');

  // Buddy is turned on: main.js registers what is saved.
  assert.strictEqual(shortcut.register(s.store.get('shortcut')), true);
  assert.deepStrictEqual([...system.keys()], ['CommandOrControl+Shift+B']);
});

test("set: a blank name falls back to the buddy's own name, as the Welcome window does", async () => {
  const s = setup({ stored: { buddyId: 'girl-1', buddyName: 'Pixie' } });
  assert.strictEqual((await s.call('settings:set', { buddyName: '   ' })).settings.buddyName, 'Anaya');
  assert.strictEqual((await s.call('settings:set', { buddyName: null })).settings.buddyName, 'Anaya');
  // The buddy picked in the same patch is the one whose name it falls back to.
  assert.strictEqual((await s.call('settings:set', { buddyId: 'boy-1', buddyName: '' })).settings.buddyName, 'Aarav');
});

test('set: a name is trimmed and cut to 24 characters', async () => {
  const s = setup();
  assert.strictEqual((await s.call('settings:set', { buddyName: '  Hello World  ' })).settings.buddyName, 'Hello World');
  assert.strictEqual((await s.call('settings:set', { buddyName: 'n'.repeat(40) })).settings.buddyName, 'n'.repeat(24));
});

// ---- the Welcome window ----

test('onboarding:finish keeps a real choice and otherwise falls back to the first buddy and its own name', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.callFromWelcome('onboarding:finish', { buddyId: 'girl-1', buddyName: '  Pixie  ' }), { ok: true });
  assert.deepStrictEqual([s.store.get('buddyId'), s.store.get('buddyName'), s.store.get('onboarded')], ['girl-1', 'Pixie', true]);
  assert.deepStrictEqual(s.calls, [['finished']]);

  const blank = setup();
  await blank.callFromWelcome('onboarding:finish', { buddyId: 'girl-1', buddyName: '   ' });
  assert.strictEqual(blank.store.get('buddyName'), 'Anaya');

  const unknown = setup();
  await unknown.callFromWelcome('onboarding:finish', { buddyId: 'nope', buddyName: '' });
  assert.deepStrictEqual([unknown.store.get('buddyId'), unknown.store.get('buddyName')], ['boy-1', 'Aarav']);

  const none = setup();
  assert.deepStrictEqual(await none.callFromWelcome('onboarding:finish'), { ok: true });
  assert.deepStrictEqual([none.store.get('buddyId'), none.store.get('buddyName'), none.store.get('onboarded')], ['boy-1', 'Aarav', true]);

  const long = setup();
  await long.callFromWelcome('onboarding:finish', { buddyName: ` ${'n'.repeat(40)} ` });
  assert.strictEqual(long.store.get('buddyName'), 'n'.repeat(24));
});

test('onboarding:finish refuses a choice that is not an object, and finishes nothing', async () => {
  const s = setup();
  for (const choice of [null, 'girl-1', 5, [], [{ buddyId: 'girl-1' }]]) {
    assert.deepStrictEqual(await s.callFromWelcome('onboarding:finish', choice), refused('bad_request', 'Those choices are not valid.'), JSON.stringify(choice));
  }
  assert.strictEqual(s.store.get('onboarded'), false);
  assert.deepStrictEqual(s.calls, []);
});

test('onboarding:finish is accepted from the Welcome window only: the Settings window cannot finish the Welcome', async () => {
  const s = setup();
  const refusedOutright = refused('not_allowed', 'Not allowed.');
  assert.deepStrictEqual(await s.call('onboarding:finish', { buddyId: 'girl-1', buddyName: 'Pixie' }), refusedOutright);
  assert.deepStrictEqual(await s.call('onboarding:finish'), refusedOutright);
  assert.strictEqual(s.store.get('onboarded'), false, 'nothing was saved');
  assert.strictEqual(s.store.get('buddyId'), 'boy-1');
  assert.deepStrictEqual(s.calls, [], 'and nothing was finished: the Welcome stays open, the buddy stays off');

  assert.deepStrictEqual(await s.callFromWelcome('onboarding:finish', { buddyId: 'girl-1', buddyName: 'Pixie' }), { ok: true });
  assert.deepStrictEqual(s.calls, [['finished']]);
});

test('the Welcome window can use the other channels, as the Settings window can', async () => {
  const s = setup();
  assert.strictEqual((await s.callFromWelcome('settings:get')).ok, true);
  assert.strictEqual((await s.callFromWelcome('settings:set', { size: 'large' })).ok, true);
  assert.deepStrictEqual(await s.callFromWelcome('permissions:get'), {
    ok: true, accessibility: true, screenRecording: false, microphone: 'not-determined',
  });
});

// ---- signing in and free mode (Phase 2) ----

const UNLIMITED = { freeOn: true, limitMode: 'unlimited', limit: null, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };

test('settings:get: who is signed in, whether this copy can sign in, and what the AI section shows', async () => {
  const s = setup({ free: UNLIMITED, stored: { cloud: UNLIMITED } });
  const r = await s.call('settings:get');
  assert.deepStrictEqual(r.account, { signedIn: true, email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' });
  assert.strictEqual(r.canSignIn, true);
  assert.deepStrictEqual(r.ai, { note: 'Free AI is on. No key needed.', showForm: false });
  assert.ok(!('cloud' in r.settings), 'the kept server settings are not page settings');

  const out = await setup({ signedIn: false, free: UNLIMITED }).call('settings:get');
  assert.deepStrictEqual(out.account, { signedIn: false });
  assert.deepStrictEqual(out.ai, { note: '', showForm: true }, 'signed out, no free settings apply');
});

test('account:sign-in signs in, fetches the free settings, and answers the new state', async () => {
  const s = setup({ signedIn: false });
  const r = await s.call('account:sign-in');
  assert.strictEqual(r.ok, true);
  assert.deepStrictEqual(r.account, { signedIn: true, email: 'rahul@gmail.com', name: 'Rahul', photo: 'https://lh3.googleusercontent.com/a/rahul' });
  assert.deepStrictEqual(s.calls.filter(([name]) => ['signIn', 'cloudSettings'].includes(name)), [['signIn'], ['cloudSettings', { force: true }]]);
});

test('account:sign-in that fails says why, and fetches nothing', async () => {
  const s = setup({ signedIn: false, signInFails: new BuddyError('sign_in_failed', "Google didn't sign you in. Try again.") });
  assert.deepStrictEqual(await s.call('account:sign-in'), refused('sign_in_failed', "Google didn't sign you in. Try again."));
  assert.ok(!s.calls.some(([name]) => name === 'cloudSettings'));
});

test('account:sign-in still answers when the free settings cannot be fetched', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({ signedIn: false, cloudFails: new BuddyError('server', "Buddy's server had a problem. Try again.") });
  const r = await s.call('account:sign-in');
  assert.deepStrictEqual([r.ok, r.account.signedIn], [true, true]);
});

// The server can turn a new sign-in down (a token it will not take, twice): cloud.js then signs the person out and
// the fetch of the free settings fails. That is not a sign-in that worked.
test('account:sign-in that the fetch of the free settings signed out again says why, and is not answered as signed in', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const expired = new BuddyError('signed_out', "Buddy couldn't check your sign-in. Sign in again.");
  const s = setup({ signedIn: false, cloudFails: expired, cloudSignsOut: true });
  assert.deepStrictEqual(await s.call('account:sign-in'), refused('signed_out', "Buddy couldn't check your sign-in. Sign in again."));
  assert.deepStrictEqual(
    s.calls.filter(([name]) => ['signIn', 'cloudSettings', 'signOut'].includes(name)),
    [['signIn'], ['cloudSettings', { force: true }], ['signOut']],
  );
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] could not fetch the free settings:', 'signed_out']], 'logged by kind only');
});

test('account:sign-in that ends signed out says what it can: the error\'s own words, else "Sign-in didn\'t finish"', async (t) => {
  t.mock.method(console, 'warn', () => {});
  for (const [cloudFails, message] of [
    [new BuddyError('network', "Couldn't reach Buddy's server. Check your internet."), "Couldn't reach Buddy's server. Check your internet."],
    [new TypeError('x is not a function'), "Sign-in didn't finish. Try again."], // not a message for a person
    [null, "Sign-in didn't finish. Try again."], // the fetch worked, and the person was signed out meanwhile
  ]) {
    const s = setup({ signedIn: false, cloudFails, cloudSignsOut: true });
    assert.deepStrictEqual(await s.call('account:sign-in'), refused('signed_out', message), String(cloudFails));
  }
});

test('account:sign-out signs out and answers the signed-out state', async () => {
  const s = setup();
  const r = await s.call('account:sign-out');
  assert.deepStrictEqual([r.ok, r.account], [true, { signedIn: false }]);
  assert.ok(s.calls.some(([name]) => name === 'signOut'));
});

test('settings:refresh fetches the free settings for someone signed in, and never fails the page', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup();
  assert.strictEqual((await s.call('settings:refresh')).ok, true);
  assert.deepStrictEqual(s.calls.filter(([name]) => name === 'cloudSettings'), [['cloudSettings', { force: true }]]);

  const out = setup({ signedIn: false });
  await out.call('settings:refresh');
  assert.ok(!out.calls.some(([name]) => name === 'cloudSettings'), 'nobody to fetch them for');

  const failing = setup({ cloudFails: new BuddyError('server', "Buddy's server had a problem. Try again.") });
  assert.strictEqual((await failing.call('settings:refresh')).ok, true);

  // A fetch that signed the person out is no failure of the page either: the answer says they are signed out.
  const expired = setup({ cloudFails: new BuddyError('signed_out', "Buddy couldn't check your sign-in. Sign in again."), cloudSignsOut: true });
  const r = await expired.call('settings:refresh');
  assert.deepStrictEqual([r.ok, r.account], [true, { signedIn: false }]);
});

test('onboarding:finish wants someone signed in, and finishes nothing otherwise', async () => {
  const s = setup({ signedIn: false });
  assert.deepStrictEqual(await s.callFromWelcome('onboarding:finish', { buddyId: 'girl-1', buddyName: 'Pixie' }),
    refused('signed_out', 'Sign in with Google first.'));
  assert.strictEqual(s.store.get('onboarded'), false);
  assert.ok(!s.calls.some(([name]) => name === 'finished'));
});

test('the Admin window cannot use the Settings channels', async () => {
  const s = setup();
  for (const channel of Object.keys(s.handlers)) {
    assert.deepStrictEqual(await s.handlers[channel]({ sender: ADMIN_PAGE }), refused('not_allowed', 'Not allowed.'), channel);
  }
  assert.deepStrictEqual(s.calls, []);
});

// ---- the shortcut recorder, the profile photo, the version ----

test('shortcut:pause lets go of the global shortcut, so the page hears the keys instead of the panel opening', async () => {
  const s = setup({ buddyOn: true });
  assert.deepStrictEqual(await s.call('shortcut:pause'), { ok: true });
  assert.deepStrictEqual(s.calls, [['unregister']]);
  assert.strictEqual(s.shortcutNow(), null);
});

test('shortcut:resume takes the saved shortcut back while Buddy is on, and only when it is not the one registered', async () => {
  const s = setup({ buddyOn: true, registered: null, stored: { shortcut: 'Shift+Command+B' } });
  assert.deepStrictEqual(await s.call('shortcut:resume'), { ok: true });
  assert.deepStrictEqual(s.calls, [['register', 'Shift+Command+B']]);
  assert.strictEqual(s.shortcutNow(), 'Shift+Command+B');
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, [['register', 'Shift+Command+B']], 'already registered: nothing more');
});

test('shortcut:resume does nothing while Buddy is off; resumeShortcut is also there for the main process', async () => {
  const s = setup({ buddyOn: false, registered: null });
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, []);
  assert.strictEqual(typeof s.ipc.resumeShortcut, 'function');
});

// Only a closing Settings window gives the shortcut back (main.js), so a pause from any other window would never be undone.
test('shortcut:pause and shortcut:resume are for the Settings window only: the Welcome window is refused, and the shortcut is left as it is', async () => {
  const refusedOutright = refused('not_allowed', 'Not allowed.');

  const pausing = setup({ buddyOn: true });
  assert.deepStrictEqual(await pausing.callFromWelcome('shortcut:pause'), refusedOutright);
  assert.deepStrictEqual(pausing.calls, [], 'nothing was let go');
  assert.strictEqual(pausing.shortcutNow(), 'Alt+Space', 'the shortcut is still registered');

  const resuming = setup({ buddyOn: true, registered: null, stored: { shortcut: 'Shift+Command+B' } });
  assert.deepStrictEqual(await resuming.callFromWelcome('shortcut:resume'), refusedOutright);
  assert.deepStrictEqual(resuming.calls, [], 'nothing was registered');
  assert.strictEqual(resuming.shortcutNow(), null);

  // The same set-ups, asked by the Settings window, are answered: it is the page, not the state, that was refused.
  assert.deepStrictEqual(await pausing.call('shortcut:pause'), { ok: true });
  assert.deepStrictEqual(pausing.calls, [['unregister']]);
  assert.deepStrictEqual(await resuming.call('shortcut:resume'), { ok: true });
  assert.deepStrictEqual(resuming.calls, [['register', 'Shift+Command+B']]);
});

test('saving a new shortcut while paused registers it, and resume then leaves it alone', async () => {
  const s = setup({ buddyOn: true });
  await s.call('shortcut:pause');
  const r = await s.call('settings:set', { shortcut: 'Shift+Command+B' });
  assert.strictEqual(r.ok, true);
  await s.call('shortcut:resume');
  assert.deepStrictEqual(s.calls, [['unregister'], ['register', 'Shift+Command+B']]);
  assert.strictEqual(s.shortcutNow(), 'Shift+Command+B');
});

test('a shortcut that is taken while paused is refused, and resume puts the old one back', async () => {
  const s = setup({ buddyOn: true, taken: ['Command+Space'] });
  await s.call('shortcut:pause');
  const r = await s.call('settings:set', { shortcut: 'Command+Space' });
  assert.strictEqual(r.error.code, 'shortcut_taken');
  await s.call('shortcut:resume');
  assert.strictEqual(s.shortcutNow(), 'Alt+Space');
  assert.strictEqual(s.store.get('shortcut'), 'Alt+Space');
});

test('shortcut:resume logs it when another app took the saved shortcut during the pause, and still answers ok', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup({ buddyOn: true, registered: null, taken: ['Alt+Space'] });
  assert.deepStrictEqual(await s.call('shortcut:resume'), { ok: true });
  assert.deepStrictEqual(s.calls, [['register', 'Alt+Space']]);
  assert.strictEqual(s.shortcutNow(), null, 'it could not be taken back');
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments), [['[buddy] could not take the shortcut back']]);
  s.ipc.resumeShortcut(); // the main process asks the same way, when Settings closes
  assert.strictEqual(warn.mock.callCount(), 2);
});

test('shortcut:resume says nothing when the shortcut is back, was never let go, or Buddy is off', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  await setup({ buddyOn: true, registered: null }).call('shortcut:resume');
  await setup({ buddyOn: true }).call('shortcut:resume');
  const off = setup({ buddyOn: false, registered: null, taken: ['Alt+Space'] });
  await off.call('shortcut:resume');
  assert.deepStrictEqual(off.calls, [], 'Buddy is off: no attempt, so nothing failed');
  assert.strictEqual(warn.mock.callCount(), 0);
});

test('shortcut:pause also has a key tapped on its own heard, and sends each tap to the Settings page', async () => {
  const s = setup({ buddyOn: true });
  await s.call('shortcut:pause');
  assert.deepStrictEqual(s.keyWatch.log, ['start']);
  s.keyWatch.recorder('Tap:RightOption');
  assert.deepStrictEqual(s.sent, [['settings', 'shortcut:tap', 'Tap:RightOption']]);
});

test('shortcut:resume, and resumeShortcut when Settings closes, stop the recording, whether Buddy is on or off', async () => {
  const on = setup({ buddyOn: true });
  await on.call('shortcut:pause');
  await on.call('shortcut:resume');
  assert.deepStrictEqual(on.keyWatch.log, ['start', 'stop']);
  const off = setup({ buddyOn: false });
  off.ipc.resumeShortcut();
  assert.deepStrictEqual(off.keyWatch.log, ['stop']);
});

// The real key watch and shortcut, with a helper that records what it is told. A single key that is saved is heard by
// the helper; recording must not switch the helper off and on again (a key tapped in that gap would be missed).
test('recording with a single key saved leaves the helper listening: it is told once, and nothing after', async () => {
  const told = [];
  const helper = Object.assign(new EventEmitter(), {
    async call(cmd, args) {
      told.push([cmd, args]);
      return { watching: args.on };
    },
  });
  const keyWatch = createKeyWatch({ helper, onPress() {}, platform: 'darwin' });
  const globalShortcut = { register: () => true, unregister() {} };
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress() {} });
  const s = setup({ buddyOn: true, stored: { shortcut: 'Tap:RightOption' }, realShortcut: shortcut, realKeyWatch: keyWatch });
  assert.strictEqual(shortcut.register('Tap:RightOption'), true); // as main.js does when Buddy starts
  await tick();
  const toldOnce = [['watchKeys', { on: true }]];
  assert.deepStrictEqual(told, toldOnce);

  await s.call('shortcut:pause');
  await tick();
  assert.strictEqual(shortcut.current(), null, 'its own shortcut is let go');
  assert.deepStrictEqual(told, toldOnce, 'pausing tells the helper nothing');
  await s.call('shortcut:resume');
  await tick();
  assert.strictEqual(shortcut.current(), 'Tap:RightOption', 'and taken back');
  assert.deepStrictEqual(told, toldOnce, 'neither does resuming');
});

test('set: a single-key shortcut is saved like any other, and one that is not well formed is refused', async () => {
  const keyWatch = {
    shortcut: null,
    setShortcut(value) {
      if (value !== null && !tapKeys(value)) return false;
      this.shortcut = value;
      return true;
    },
  };
  const globalShortcut = { register: () => true, unregister() {} };
  const s = setup({ buddyOn: true, realShortcut: createShortcut({ globalShortcut, keyWatch, onPress() {} }) });
  const r = await s.call('settings:set', { shortcut: 'Tap:RightOption' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption');
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
  assert.deepStrictEqual(
    await s.call('settings:set', { shortcut: 'Tap:Bogus' }),
    refused('shortcut_taken', '"Tap:Bogus" can\'t be used. Try another one.'),
  );
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption', 'nothing changed');
  assert.strictEqual(keyWatch.shortcut, 'Tap:RightOption');
});

// A key tapped on its own can never be another app's, so with Buddy off it is only looked at, not registered and let go:
// that would switch the helper on and off for nothing.
test('set: while Buddy is off a single-key shortcut is saved and the helper is told nothing; one that is not well formed is refused', async () => {
  const told = [];
  const helper = Object.assign(new EventEmitter(), {
    async call(cmd, args) {
      told.push([cmd, args]);
      return { watching: args.on };
    },
  });
  const keyWatch = createKeyWatch({ helper, onPress() {}, platform: 'darwin' });
  const globalShortcut = { register: () => true, unregister() {} };
  const shortcut = createShortcut({ globalShortcut, keyWatch, onPress() {} });
  const s = setup({ buddyOn: false, realShortcut: shortcut, realKeyWatch: keyWatch });
  const r = await s.call('settings:set', { shortcut: 'Tap:RightOption' });
  assert.strictEqual(r.ok, true);
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption');
  assert.strictEqual(shortcut.current(), null, 'it is not taken until Buddy is turned on');
  assert.deepStrictEqual(
    await s.call('settings:set', { shortcut: 'Tap:Bogus' }),
    refused('shortcut_taken', '"Tap:Bogus" can\'t be used. Try another one.'),
  );
  assert.strictEqual(s.store.get('shortcut'), 'Tap:RightOption', 'nothing changed');
  await tick();
  assert.deepStrictEqual(told, [], 'the helper is told nothing');
});

test("the snapshot carries the person's photo and the app's version", async () => {
  const r = await setup().call('settings:get');
  assert.strictEqual(r.account.photo, 'https://lh3.googleusercontent.com/a/rahul');
  assert.strictEqual(r.version, '0.1.0');
  assert.deepStrictEqual((await setup({ signedIn: false }).call('settings:get')).account, { signedIn: false });
});

test('settings:get says which system Buddy runs on, so the pages leave out what it does not have', async () => {
  assert.strictEqual((await setup({ platform: 'win32' }).call('settings:get')).platform, 'win32');
  assert.strictEqual((await setup({ platform: 'darwin' }).call('settings:get')).platform, 'darwin');
  assert.strictEqual((await setup().call('settings:get')).platform, process.platform);
});

// ---- Settings → Memory ----

const CANT_SAVE = "I can't save that. Passwords, PINs, OTPs and long numbers are never saved.";

test('settings:memory answers what Buddy knows, oldest first, and whether it learns from chats', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('settings:memory'), { ok: true, facts: [], learning: true });
  s.memory.add('Your boss is Mr. Sharma.');
  s.memory.add('Your city is Pune.');
  s.memory.setLearning(false);
  assert.deepStrictEqual(await s.call('settings:memory'), {
    ok: true,
    facts: [
      { id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1_001_000 },
      { id: 'f2', text: 'Your city is Pune.', at: 1_002_000 },
    ],
    learning: false,
  });
});

test('settings:get leaves the facts and the learning switch out: settings:memory has them', async () => {
  const s = setup();
  s.memory.add('Your boss is Mr. Sharma.');
  const r = await s.call('settings:get');
  assert.ok(!('memory' in r.settings) && !('learnFromChats' in r.settings));
  assert.deepStrictEqual(s.store.get('memory').map((f) => f.text), ['Your boss is Mr. Sharma.'], 'the store itself is untouched');
});

test('settings:memory-add saves a fact, trimmed, and answers what Buddy now knows', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.call('settings:memory-add', '  Your boss is Mr. Sharma.  '), {
    ok: true,
    facts: [{ id: 'f1', text: 'Your boss is Mr. Sharma.', at: 1_001_000 }],
    learning: true,
  });
  assert.deepStrictEqual(s.memory.facts(), ['Your boss is Mr. Sharma.']);
});

test('settings:memory-add works with learning off: the person typed it in themselves', async () => {
  const s = setup();
  await s.call('settings:memory-learning', false);
  const r = await s.call('settings:memory-add', 'Your city is Pune.');
  assert.deepStrictEqual([r.ok, r.facts.map((f) => f.text), r.learning], [true, ['Your city is Pune.'], false]);
});

test('settings:memory-add refuses secrets, long numbers, blanks, too long and not text, and saves nothing', async () => {
  const s = setup();
  for (const text of [
    'My password is tiger123',
    'My ATM PIN is 1234',
    'The OTP is 482913',
    'My card is 4111 1111 1111 1111',
    '',
    '   ',
    'a'.repeat(201),
    undefined,
    42,
    { text: 'Your city is Pune.' },
  ]) {
    assert.deepStrictEqual(await s.call('settings:memory-add', text), refused('bad_request', CANT_SAVE), JSON.stringify(text));
  }
  assert.deepStrictEqual(s.memory.list(), []);
});

test('settings:memory-add says so when Buddy knows it already, in any case', async () => {
  const s = setup();
  await s.call('settings:memory-add', 'Your boss is Mr. Sharma.');
  assert.deepStrictEqual(await s.call('settings:memory-add', 'your boss is MR. SHARMA.'), refused('bad_request', 'I already know that.'));
  assert.deepStrictEqual(s.memory.facts(), ['Your boss is Mr. Sharma.']);
});

test('settings:memory-remove forgets one fact; one that is gone already changes nothing', async () => {
  const s = setup();
  s.memory.add('Your boss is Mr. Sharma.');
  s.memory.add('Your city is Pune.');
  const r = await s.call('settings:memory-remove', 'f1');
  assert.deepStrictEqual(r, { ok: true, facts: [{ id: 'f2', text: 'Your city is Pune.', at: 1_002_000 }], learning: true });
  assert.deepStrictEqual(await s.call('settings:memory-remove', 'f1'), r, 'gone already: the same answer');
  assert.deepStrictEqual(await s.call('settings:memory-remove', { id: 'f2' }), r, 'not an id: nothing is forgotten');
  assert.deepStrictEqual(s.memory.facts(), ['Your city is Pune.']);
});

test('settings:memory-clear forgets everything and keeps the switch as it is', async () => {
  const s = setup();
  s.memory.add('Your boss is Mr. Sharma.');
  s.memory.add('Your city is Pune.');
  s.memory.setLearning(false);
  assert.deepStrictEqual(await s.call('settings:memory-clear'), { ok: true, facts: [], learning: false });
  assert.deepStrictEqual(s.memory.list(), []);
});

test('settings:memory-learning turns learning from chats off and on, and takes nothing but true or false', async () => {
  const s = setup();
  s.memory.add('Your boss is Mr. Sharma.');
  const off = await s.call('settings:memory-learning', false);
  assert.deepStrictEqual([off.ok, off.learning, off.facts.length], [true, false, 1]);
  assert.strictEqual(s.store.get('learnFromChats'), false);
  for (const value of ['false', 0, 1, null, undefined, {}]) {
    assert.deepStrictEqual(await s.call('settings:memory-learning', value),
      refused('bad_request', 'Learning from chats must be on or off.'), JSON.stringify(value));
  }
  assert.strictEqual(s.store.get('learnFromChats'), false, 'unchanged');
  assert.strictEqual((await s.call('settings:memory-learning', true)).learning, true);
});

test('the memory calls are for the Settings window only: the Welcome window is refused, and nothing changes', async () => {
  const s = setup();
  s.memory.add('Your boss is Mr. Sharma.');
  const refusedOutright = refused('not_allowed', 'Not allowed.');
  for (const [channel, ...args] of [
    ['settings:memory'],
    ['settings:memory-add', 'Your city is Pune.'],
    ['settings:memory-remove', 'f1'],
    ['settings:memory-clear'],
    ['settings:memory-learning', false],
  ]) {
    assert.deepStrictEqual(await s.callFromWelcome(channel, ...args), refusedOutright, channel);
  }
  assert.deepStrictEqual(s.memory.facts(), ['Your boss is Mr. Sharma.']);
  assert.strictEqual(s.memory.learning(), true);
});

// ---- Claude Code on this computer (the brain spec §3) ----

test('the snapshot lists Claude Code last, with no key to need: signed in counts as a key, and its status line comes along', async () => {
  const signedIn = await setup({ claude: CLAUDE_IN }).call('settings:get');
  const entry = signedIn.providers.at(-1);
  assert.deepStrictEqual(entry, {
    id: 'claude-code',
    label: 'Claude Code on this computer',
    keyUrl: GET_URL,
    fallbackModels: CLAUDE_MODELS,
    modelLabels: MODEL_LABELS,
    hasKey: true,
    needsKey: false,
    status: CLAUDE_IN,
    line: { text: 'Claude Code: signed in as a@b.com (Max)', link: null },
  });
  const out = (await setup({ claude: CLAUDE_OUT }).call('settings:get')).providers.at(-1);
  assert.deepStrictEqual([out.hasKey, out.line.text], [false, 'Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.']);
  const none = (await setup({ claude: CLAUDE_NONE }).call('settings:get')).providers.at(-1);
  assert.deepStrictEqual([none.hasKey, none.line], [false, { text: "Claude Code isn't installed on this computer.", link: { label: 'Get Claude Code', url: GET_URL } }]);
});

test('the snapshot asks for the cached status, never forced: opening Settings does not run claude twice', async () => {
  const s = setup({ claude: CLAUDE_IN });
  await s.call('settings:get');
  await s.call('settings:set', { size: 'large' });
  assert.deepStrictEqual(s.claudeCalls, [{}, {}]);
});

test('save-key and clear-key for Claude Code are refused: it has no key', async () => {
  const s = setup({ claude: CLAUDE_IN });
  for (const [channel, args] of [['settings:save-key', ['claude-code', 'sk-ant-abc']], ['settings:clear-key', ['claude-code']]]) {
    assert.deepStrictEqual(await s.call(channel, ...args), refused('bad_request', "Claude Code doesn't use a key."), channel);
  }
  assert.deepStrictEqual(s.keys, {});
});

test('settings:models for Claude Code answers its four names without asking the AI', async () => {
  const s = setup({ claude: CLAUDE_IN });
  assert.deepStrictEqual(await s.call('settings:models', 'claude-code'), { ok: true, models: ['fable', 'opus', 'sonnet', 'haiku'] });
  assert.deepStrictEqual(s.calls, []);
});

test("a key saved while Claude Code is picked switches to that key's AI, as it does for any other pick", async (t) => {
  const checks = fakeKeyChecks(t, { gemini: async () => GEMINI_MODELS });
  const s = setup({ claude: CLAUDE_IN, stored: { provider: 'claude-code' } });
  const r = await s.call('settings:save-key', 'anthropic', GEMINI_KEY);
  assert.deepStrictEqual(asked(checks), ['gemini']);
  assert.strictEqual(r.ok, true);
  assert.strictEqual(r.settings.provider, 'gemini');
  assert.strictEqual(r.providers.at(-1).id, 'claude-code', 'the answer is a whole snapshot');
});
