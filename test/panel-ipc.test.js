'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { registerPanelIpc, createMicrophone } = require('../src/main/ipc/panel');

const PANEL_PAGE = { name: 'the panel page' };
const SOMEONE_ELSE = { sender: { name: 'someone else' } };

/**
 * registerPanelIpc with fakes: `actions` is whatever the test wants the panel's calls to do, and `mic` what the
 * microphone answers once asked. `calls` has the panel hiding, Settings and the system's settings opening, and what
 * the buddy is told about listening (ui.listening, ui.voiceLevel), in order.
 */
function setup(actions = {}, { platform = 'darwin', mic = 'granted', openFails = null, askFails = null } = {}) {
  const handlers = {};
  const listeners = {};
  const calls = [];
  registerPanelIpc({
    ipcMain: {
      handle: (channel, fn) => { handlers[channel] = fn; },
      on: (channel, fn) => { listeners[channel] = fn; },
    },
    panel: {
      window: () => ({ webContents: PANEL_PAGE }),
      hide: () => calls.push('hide'),
      resizeStart: (p) => calls.push(['resizeStart', p]),
      resizeMove: (p) => calls.push(['resizeMove', p]),
      resizeEnd: () => calls.push('resizeEnd'),
      toggleSize: () => calls.push('toggleSize'),
      whileHeld: async (ask) => { calls.push('hold'); try { return await ask(); } finally { calls.push('let go'); } },
    },
    actions,
    openSettings: (section) => calls.push(['openSettings', section]),
    microphone: {
      async ask() {
        calls.push('askMicrophone');
        return mic;
      },
    },
    ui: {
      listening: (on) => calls.push(['listening', on]),
      voiceLevel: (level) => calls.push(['voiceLevel', level]),
    },
    async askAccessibility() {
      calls.push('askAccessibility');
      if (askFails) throw askFails;
    },
    claudeMode: {
      sessions: async () => { calls.push('claudeSessions'); return { sessions: [] }; },
      open: async (id) => { calls.push(['claudeOpen', id]); return { session: { id } }; },
      talk: async (id, text) => { calls.push(['claudeTalk', id, text]); return { typed: true }; },
      close: () => calls.push('claudeClose'),
    },
    shell: {
      async openExternal(url) {
        calls.push(['openExternal', url]);
        if (openFails) throw openFails;
      },
    },
    platform,
  });
  return { handlers, listeners, calls, fromPanel: { sender: PANEL_PAGE } };
}

test('the panel asks through eight channels and tells main nine things; the old ones are gone', () => {
  const s = setup();
  assert.deepStrictEqual(Object.keys(s.handlers).sort(), [
    'panel:act', 'panel:claude-open', 'panel:claude-sessions', 'panel:claude-talk', 'panel:drop-selection', 'panel:mic-access', 'panel:send', 'panel:transcribe',
  ]);
  assert.deepStrictEqual(Object.keys(s.listeners).sort(), [
    'panel:claude-close', 'panel:close', 'panel:listening', 'panel:open-settings', 'panel:resize-end', 'panel:resize-move', 'panel:resize-start',
    'panel:size-toggle', 'panel:voice-level',
  ]);
});

test('Claude mode: the sessions, one opened, words for its terminal (only text), and closing it, from the panel only', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.handlers['panel:claude-sessions'](s.fromPanel), { ok: true, sessions: [] });
  assert.deepStrictEqual(await s.handlers['panel:claude-open'](s.fromPanel, 'a'), { ok: true, session: { id: 'a' } });
  assert.deepStrictEqual(await s.handlers['panel:claude-talk'](s.fromPanel, 'a', 'run it'), { ok: true, typed: true });
  await s.handlers['panel:claude-talk'](s.fromPanel, 'a', { not: 'text' });
  assert.strictEqual((await s.handlers['panel:claude-sessions'](SOMEONE_ELSE)).ok, false, 'only the panel page');
  s.listeners['panel:claude-close'](SOMEONE_ELSE);
  s.listeners['panel:claude-close'](s.fromPanel);
  assert.deepStrictEqual(s.calls, ['claudeSessions', ['claudeOpen', 'a'], ['claudeTalk', 'a', 'run it'], ['claudeTalk', 'a', ''], 'claudeClose']);
});

test('a message goes to actions.send, and the answer is { ok: true } once it is in: the state events show the rest', async () => {
  const sent = [];
  const s = setup({ send: async (message) => { sent.push(message); return {}; } });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'mail to my boss'), { ok: true });
  // Anything but text is an empty message.
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, { text: 'x' }), { ok: true });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel), { ok: true });
  assert.deepStrictEqual(sent, ['mail to my boss', '', '']);
});

test('a button goes to actions.act with its item, and ✕ on the selection to actions.dropSelection', async () => {
  const done = [];
  const s = setup({
    act: async (id, button) => { done.push(['act', id, button]); return {}; },
    dropSelection: () => { done.push(['dropSelection']); return {}; },
  });
  assert.deepStrictEqual(await s.handlers['panel:act'](s.fromPanel, 3, 'insert'), { ok: true });
  assert.deepStrictEqual(await s.handlers['panel:drop-selection'](s.fromPanel), { ok: true });
  assert.deepStrictEqual(done, [['act', 3, 'insert'], ['dropSelection']]);
});

test('a refusal reaches the panel with its code and its message, and nothing else', async () => {
  const s = setup({
    send: async () => { throw Object.assign(new BuddyError('bad_request', 'Wait for my answer first.'), { detail: 'inner', cause: new Error('x') }); },
    act: async () => { throw new BuddyError('bad_request', "That isn't there any more."); },
  });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'again'), {
    ok: false,
    error: { code: 'bad_request', message: 'Wait for my answer first.' },
  });
  assert.deepStrictEqual(await s.handlers['panel:act'](s.fromPanel, 9, 'copy'), {
    ok: false,
    error: { code: 'bad_request', message: "That isn't there any more." },
  });
});

test('an error that is not a BuddyError reaches the panel as a generic one: no internal text', async (t) => {
  t.mock.method(console, 'error', () => {});
  const s = setup({ send: async () => { throw new Error('ENOENT: no such file or directory, open /Users/someone/keys.json'); } });
  assert.deepStrictEqual(await s.handlers['panel:send'](s.fromPanel, 'mail'), {
    ok: false,
    error: { code: 'failed', message: 'Something went wrong. Try again.' },
  });
});

test('only the panel page may ask', async () => {
  let ran = false;
  const nope = async () => { ran = true; return {}; };
  const s = setup({ send: nope, act: nope, dropSelection: nope, transcribe: nope });
  for (const [channel, args] of [
    ['panel:send', ['mail']], ['panel:act', [1, 'copy']], ['panel:drop-selection', []], ['panel:mic-access', []],
    ['panel:transcribe', ['QUJD', 'audio/webm']],
  ]) {
    assert.deepStrictEqual(await s.handlers[channel](SOMEONE_ELSE, ...args), {
      ok: false,
      error: { code: 'not_allowed', message: 'Not allowed.' },
    }, channel);
  }
  assert.strictEqual(ran, false);
  assert.deepStrictEqual(s.calls, [], 'and macOS was not asked about the microphone');
});

test('the gear shares one way to Settings with Open Settings: the panel steps aside, then Settings opens', () => {
  const s = setup();
  s.listeners['panel:open-settings'](s.fromPanel);
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]]);
  s.listeners['panel:open-settings'](SOMEONE_ELSE);
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', undefined]], 'and only for the panel page');
});

test('Open Settings goes to the AI section for a key, model or free-mode problem, to Permissions for a permission, and to the start otherwise', () => {
  for (const [code, section] of [
    ['no_key', 'ai'], ['bad_key', 'ai'], ['no_credit', 'ai'], ['bad_model', 'ai'], ['no_vision', 'ai'], ['need_key', 'ai'],
    ['free_off', 'ai'], ['no_screen_recording', 'permissions'], // Accessibility opens macOS's own page (below)
    ['signed_out', undefined], ['not_set_up', undefined], [undefined, undefined], ['constructor', undefined], [7, undefined],
  ]) {
    const s = setup();
    s.listeners['panel:open-settings'](s.fromPanel, code);
    assert.deepStrictEqual(s.calls, ['hide', ['openSettings', section]], String(code));
  }
});

test('Esc and the close button close the panel through actions.dismiss, which ends the chat and on Windows hands the keyboard back', () => {
  const dismissed = [];
  const s = setup({ dismiss: async () => dismissed.push('dismiss') });
  s.listeners['panel:close'](s.fromPanel);
  s.listeners['panel:close'](SOMEONE_ELSE);
  assert.deepStrictEqual(dismissed, ['dismiss'], 'only for the panel page');
  assert.deepStrictEqual(s.calls, [], 'and not by hiding the window behind its back');
});

// ---- voice ----

test('the page asks for the microphone before it records, and hears how it stands', async () => {
  for (const mic of ['granted', 'denied', 'restricted', 'unknown']) {
    const s = setup({}, { mic });
    assert.deepStrictEqual(await s.handlers['panel:mic-access'](s.fromPanel), { ok: true, mic }, mic);
    assert.deepStrictEqual(s.calls, ['hold', 'askMicrophone', 'let go'], 'the panel stays open while macOS asks');
  }
});

test("a recording goes to actions.transcribe, and the words come back as { ok: true, text }", async () => {
  const given = [];
  const s = setup({ transcribe: async (audio, mime) => { given.push([audio, mime]); return { text: 'kal chutti chahiye' }; } });
  assert.deepStrictEqual(await s.handlers['panel:transcribe'](s.fromPanel, 'QUJD', 'audio/webm;codecs=opus'), { ok: true, text: 'kal chutti chahiye' });
  assert.deepStrictEqual(given, [['QUJD', 'audio/webm;codecs=opus']]);
});

test("a recording that cannot be written down reaches the page with the code and words of why", async () => {
  for (const err of [
    new BuddyError('signed_out', 'Sign in to use Buddy.'),
    new BuddyError('voice_off', "Voice isn't set up yet."),
    new BuddyError('voice_busy', 'Voice is busy right now. Type, or try again in a minute.'),
  ]) {
    const s = setup({ transcribe: async () => { throw err; } });
    assert.deepStrictEqual(await s.handlers['panel:transcribe'](s.fromPanel, 'QUJD', 'audio/webm'), {
      ok: false, error: { code: err.code, message: err.message },
    }, err.code);
  }
});

test('while the page listens the buddy is told so, as true or false', () => {
  const s = setup();
  for (const on of [true, false, 1, 0, 'yes', undefined, null]) s.listeners['panel:listening'](s.fromPanel, on);
  assert.deepStrictEqual(s.calls, [
    ['listening', true], ['listening', false], ['listening', true], ['listening', false], ['listening', true],
    ['listening', false], ['listening', false],
  ]);
});

test('how loud the person speaks reaches the buddy from 0 to 1; anything that is not a number is let go', () => {
  const s = setup();
  for (const level of [0.5, 0, 1, 1.7, -0.2, Infinity, NaN, '0.5', null, undefined, {}, [0.3]]) {
    s.listeners['panel:voice-level'](s.fromPanel, level);
  }
  assert.deepStrictEqual(s.calls, [['voiceLevel', 0.5], ['voiceLevel', 0], ['voiceLevel', 1], ['voiceLevel', 1], ['voiceLevel', 0], ['voiceLevel', 1]]);
});

test('only the panel page tells the buddy about listening', () => {
  const s = setup();
  s.listeners['panel:listening'](SOMEONE_ELSE, true);
  s.listeners['panel:voice-level'](SOMEONE_ELSE, 0.5);
  assert.deepStrictEqual(s.calls, []);
});

test('Open Settings for the microphone: Settings → Permissions on the Mac', () => {
  const s = setup({}, { platform: 'darwin' });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_microphone');
  assert.deepStrictEqual(s.calls, ['hide', ['openSettings', 'permissions']]);
});

test("Open Settings for the microphone: Windows' own Settings, where its microphone switch is, and not Buddy's", async () => {
  const s = setup({}, { platform: 'win32' });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_microphone');
  assert.deepStrictEqual(s.calls, ['hide', ['openExternal', 'ms-settings:privacy-microphone']]);
  // Every other code goes to Buddy's Settings, as on the Mac.
  s.listeners['panel:open-settings'](s.fromPanel, 'no_key');
  assert.deepStrictEqual(s.calls.slice(2), ['hide', ['openSettings', 'ai']]);
});

test("Windows' Settings that cannot be opened is logged, and nothing is thrown", async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const s = setup({}, { platform: 'win32', openFails: new Error('no handler for ms-settings') });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_microphone');
  await new Promise((resolve) => setImmediate(resolve));
  assert.strictEqual(logged.mock.callCount(), 1);
});

const MAC_ACCESSIBILITY = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const settle = () => new Promise((resolve) => setImmediate(resolve));

test("Allow for Accessibility: macOS is asked, then its Accessibility page opens, and not Buddy's Settings", async () => {
  const s = setup({}, { platform: 'darwin' });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_accessibility');
  await settle();
  assert.deepStrictEqual(s.calls, ['hide', 'askAccessibility', ['openExternal', MAC_ACCESSIBILITY]]);
});

test('Allow for Accessibility opens the page even when asking macOS failed', async (t) => {
  t.mock.method(console, 'warn', () => {});
  const s = setup({}, { platform: 'darwin', askFails: new BuddyError('helper_gone', 'gone') });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_accessibility');
  await settle();
  assert.deepStrictEqual(s.calls, ['hide', 'askAccessibility', ['openExternal', MAC_ACCESSIBILITY]]);
});

test('System Settings that cannot be opened is logged, and nothing is thrown', async (t) => {
  const logged = t.mock.method(console, 'error', () => {});
  const s = setup({}, { platform: 'darwin', openFails: new Error('no handler') });
  s.listeners['panel:open-settings'](s.fromPanel, 'no_accessibility');
  await settle();
  assert.strictEqual(logged.mock.callCount(), 1);
});

// ---- the microphone as the system sees it ----

/** Electron's systemPreferences, as far as the microphone goes: `status` is what macOS says, `answer` what it says once asked. */
function preferences(status, answer = status) {
  const log = [];
  return {
    log,
    getMediaAccessStatus(type) {
      log.push(['status', type]);
      return status;
    },
    async askForMediaAccess(type) {
      log.push(['ask', type]);
      status = answer;
      return answer === 'granted';
    },
  };
}

test('on the Mac the microphone stands as macOS says', () => {
  for (const status of ['granted', 'denied', 'not-determined', 'restricted']) {
    const system = preferences(status);
    assert.strictEqual(createMicrophone({ systemPreferences: system, platform: 'darwin' }).status(), status);
    assert.deepStrictEqual(system.log, [['status', 'microphone']]);
  }
});

test('on the Mac, macOS asks the person once: before that, asking shows its question, and the answer is how it stands then', async () => {
  for (const answer of ['granted', 'denied']) {
    const system = preferences('not-determined', answer);
    assert.strictEqual(await createMicrophone({ systemPreferences: system, platform: 'darwin' }).ask(), answer);
    assert.deepStrictEqual(system.log, [['status', 'microphone'], ['ask', 'microphone'], ['status', 'microphone']]);
  }
});

test('on the Mac, once macOS has asked, it is not asked again: the switch is in System Settings', async () => {
  for (const status of ['granted', 'denied', 'restricted']) {
    const system = preferences(status, 'granted');
    assert.strictEqual(await createMicrophone({ systemPreferences: system, platform: 'darwin' }).ask(), status);
    assert.ok(!system.log.some((e) => e[0] === 'ask'), status);
  }
});

test("on Windows the microphone stands as Windows' privacy switch says, and nothing is asked: Windows does not ask per app", async () => {
  for (const [status, mic] of [
    ['granted', 'granted'], ['denied', 'denied'], ['restricted', 'restricted'],
    // Windows that cannot say how it stands: the page tries, and recording shows it.
    ['not-determined', 'unknown'], ['unknown', 'unknown'], ['sure', 'unknown'], [undefined, 'unknown'],
  ]) {
    const system = preferences(status, 'granted');
    const microphone = createMicrophone({ systemPreferences: system, platform: 'win32' });
    assert.strictEqual(microphone.status(), mic, String(status));
    assert.strictEqual(await microphone.ask(), mic, String(status));
    assert.deepStrictEqual(system.log, [['status', 'microphone'], ['status', 'microphone']], 'Windows is never asked');
  }
});

test('a Windows that fails to say how the microphone stands: unknown', () => {
  const system = { getMediaAccessStatus() { throw new Error('not on this Windows'); } };
  assert.strictEqual(createMicrophone({ systemPreferences: system, platform: 'win32' }).status(), 'unknown');
});

test('elsewhere the microphone is unknown, and nothing is asked', async () => {
  const system = preferences('granted');
  const microphone = createMicrophone({ systemPreferences: system, platform: 'linux' });
  assert.strictEqual(microphone.status(), 'unknown');
  assert.strictEqual(await microphone.ask(), 'unknown');
  assert.deepStrictEqual(system.log, []);
});

test("the grip's drag and the ⤢ reach the panel window, from the panel page only, with real points only", () => {
  const s = setup();
  s.listeners['panel:resize-start'](s.fromPanel, { x: 10, y: 20 });
  s.listeners['panel:resize-move'](s.fromPanel, { x: 30.5, y: 25 });
  s.listeners['panel:resize-move'](s.fromPanel, { x: NaN, y: 1 });
  s.listeners['panel:resize-move'](s.fromPanel, 'x');
  s.listeners['panel:resize-end'](s.fromPanel);
  s.listeners['panel:size-toggle'](s.fromPanel);
  for (const channel of ['panel:resize-start', 'panel:resize-move', 'panel:resize-end', 'panel:size-toggle']) s.listeners[channel](SOMEONE_ELSE, { x: 1, y: 1 });
  assert.deepStrictEqual(s.calls, [['resizeStart', { x: 10, y: 20 }], ['resizeMove', { x: 30.5, y: 25 }], 'resizeEnd', 'toggleSize']);
});
