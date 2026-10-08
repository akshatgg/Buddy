'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { createAi, MAX_TOKENS, AI_TIMEOUT_MS } = require('../src/main/ai');
const { BuddyError } = require('../shared/errors');

const FREE_OFF = { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false };
const FREE_ON = { ...FREE_OFF, freeOn: true };

/**
 * createAi with fakes. `calls` records the own-key provider's calls, `cloudCalls` the server's. `free` is what the
 * server's settings say (null: never reached); `fresh` what they say when fetched again with force, or `freshFails`
 * the error that fetch fails with; `freeAsk` decides the server's answer. With `signOutDuring`, the person signs out
 * while the settings are being fetched ('fetch': the one a request starts with; 'refetch': the forced one after the
 * server refused to answer for free), and that fetch still comes back with what `free` (or `fresh`, or `freshFails`) says.
 */
function setup({
  key = 'k-1', model, vision = true, answer = 'Fixed text', live = ['m-live'], signedIn = true, free = FREE_OFF, fresh, freshFails,
  freeAsk, signOutDuring = null,
  // The Claude Code route: `picked` 'claude-code' picks it, `claude` is what find.status() says (null: no finder at
  // all, as before this route), `claudeAnswer` what the run answers (or the error it fails with), `alias` the saved model.
  picked = 'openai', claude = null, claudeAnswer = 'Claude answer', alias,
} = {}) {
  const calls = [];
  const cloudCalls = [];
  const runs = [];
  const statusCalls = [];
  const provider = {
    fallbackModels: ['m-default', 'm-other'],
    isVisionModel: () => vision,
    async complete(opts) {
      calls.push(opts);
      return { text: answer, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels(opts) {
      calls.push({ listModels: opts });
      return live;
    },
  };
  const cloud = {
    async settings(options = {}) {
      cloudCalls.push(['settings', options]);
      if (signOutDuring === (options.force ? 'refetch' : 'fetch')) signedIn = false;
      if (options.force && freshFails) throw freshFails;
      return options.force && fresh !== undefined ? fresh : free;
    },
    async ask(action, input, options) {
      cloudCalls.push(['cloudAsk', action, input, options]);
      return freeAsk ? freeAsk() : { text: 'Free answer', model: 'free-model' };
    },
  };
  const models = {};
  if (model) models.openai = model;
  if (alias !== undefined) models['claude-code'] = alias;
  const settings = { provider: picked, models };
  const find = claude && { status: async (options = {}) => { statusCalls.push(options); return claude; } };
  const run = {
    async runPrompt(opts) {
      runs.push(opts);
      if (claudeAnswer instanceof Error) throw claudeAnswer;
      return { text: claudeAnswer, model: opts.model, usage: { inputTokens: 500, outputTokens: 20 } };
    },
  };
  const ai = createAi({
    store: { get: (k) => settings[k] },
    secrets: { get: (p) => (p === 'openai' ? key : null), has: (p) => p === 'openai' && key !== null },
    providers: { getProvider: () => provider },
    account: { isSignedIn: () => signedIn },
    cloud,
    find,
    run,
  });
  return { ai, calls, cloudCalls, runs, statusCalls };
}

test('ask calls the chosen provider with the key, the saved model and the prompt', async () => {
  const { ai, calls } = setup({ model: 'gpt-4.1' });
  const out = await ai.ask('fix', { text: 'me go home' });
  assert.strictEqual(out.text, 'Fixed text');
  assert.strictEqual(calls[0].apiKey, 'k-1');
  assert.strictEqual(calls[0].model, 'gpt-4.1');
  assert.strictEqual(calls[0].user, 'me go home');
  assert.strictEqual(calls[0].maxTokens, MAX_TOKENS);
  assert.strictEqual(MAX_TOKENS, 1024);
});

test('without a saved model, the first fallback model is used', async () => {
  const { ai, calls } = setup();
  await ai.ask('write', { instruction: 'leave mail' });
  assert.strictEqual(calls[0].model, 'm-default');
});

test('no key: asks the user to add one', async () => {
  const { ai } = setup({ key: null });
  await assert.rejects(ai.ask('fix', { text: 'x' }), { code: 'no_key', message: 'Add your API key in Settings first.' });
});

test('a screenshot on a model that cannot see is refused before calling', async () => {
  const { ai, calls } = setup({ vision: false });
  await assert.rejects(ai.ask('check', { image: 'IMG' }), { code: 'no_vision' });
  assert.strictEqual(calls.length, 0);
});

test('check answers are parsed', async () => {
  const { ai } = setup({ answer: '{"verdict":"good","problems":[],"corrected":null}' });
  const out = await ai.ask('check', { image: 'IMG' });
  assert.deepStrictEqual(out.check, { verdict: 'good', problems: [], corrected: null });
});

test('chat: the own key answers with the chat prompt, and the answer comes back read', async () => {
  const answer = JSON.stringify({ kind: 'fix', say: 'Ho gaya!', text: 'I am going home.', notes: ['"go" → "going"'], doIt: true, send: false, remember: [], again: false });
  const { ai, calls } = setup({ answer });
  const out = await ai.ask('chat', { message: 'fix this', selection: 'me go home', appName: 'Notes', step: 1 });
  assert.deepStrictEqual([out.text, out.model], [answer, 'm-default']);
  assert.deepStrictEqual(out.chat, { kind: 'fix', say: 'Ho gaya!', text: 'I am going home.', notes: ['"go" → "going"'], doIt: true, send: false, remember: [], again: false });
  assert.match(calls[0].system, /"kind"/);
  assert.match(calls[0].user, /Selected text:\n"""\nme go home\n"""/);
  assert.match(calls[0].user, /The app they are in: Notes/);
  assert.strictEqual(calls[0].image, null);
});

test('chat: an answer that is not JSON is read as a written answer', async () => {
  const { ai } = setup({ answer: 'Dear Sir, I need leave tomorrow.' });
  const out = await ai.ask('chat', { message: 'leave mail' });
  assert.deepStrictEqual(out.chat, {
    kind: 'write', say: '', text: 'Dear Sir, I need leave tomorrow.', notes: [], doIt: false, send: false, remember: [], again: false,
  });
});

test('chat: a screenshot goes to the provider, and is refused before calling on a model that cannot see', async () => {
  const seeing = setup({ answer: '{"kind":"answer","say":"It means soon."}' });
  const out = await seeing.ai.ask('chat', { message: 'what does this mean?', image: 'IMG', step: 2 });
  assert.strictEqual(seeing.calls[0].image, 'IMG');
  assert.deepStrictEqual([out.chat.kind, out.chat.text], ['answer', 'It means soon.']);
  const blind = setup({ vision: false });
  await assert.rejects(blind.ai.ask('chat', { message: 'what does this mean?', image: 'IMG', step: 2 }), { code: 'no_vision' });
  assert.strictEqual(blind.calls.length, 0);
});

test('only a chat gets a chat reading, and only a Check a check', async () => {
  const { ai } = setup();
  for (const [action, input] of [['write', { instruction: 'leave mail' }], ['fix', { text: 'me go' }]]) {
    const out = await ai.ask(action, input);
    assert.ok(!('chat' in out) && !('check' in out), action);
  }
  assert.ok(!('check' in await ai.ask('chat', { message: 'hi' })));
});

test('bad input is refused before calling', async () => {
  const { ai, calls } = setup();
  await assert.rejects(ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  assert.strictEqual(calls.length, 0);
});

test('listModels: the live list with a key, the fallback list without', async () => {
  assert.deepStrictEqual(await setup().ai.listModels('openai'), ['m-live']);
  assert.deepStrictEqual(await setup({ key: null }).ai.listModels('openai'), ['m-default', 'm-other']);
  assert.deepStrictEqual(await setup({ live: [] }).ai.listModels('openai'), ['m-default', 'm-other']);
});

test('requests to the AI get 60 seconds', () => {
  assert.strictEqual(AI_TIMEOUT_MS, 60_000);
});

test('ask passes the signal it is given on to the provider', async () => {
  const { ai, calls } = setup();
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  await ai.ask('fix', { text: 'me go home' }, { signal });
  assert.strictEqual(calls[0].signal, signal);
});

test('listModels passes the signal it is given on to the provider', async () => {
  const { ai, calls } = setup();
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  await ai.listModels('openai', { signal });
  assert.strictEqual(calls[0].listModels.signal, signal);
  assert.strictEqual(calls[0].listModels.apiKey, 'k-1');
});

// ---- which route (Phase 2) ----

test('signed out: nothing is asked of anyone', async () => {
  const { ai, calls, cloudCalls } = setup({ signedIn: false });
  await assert.rejects(ai.ask('fix', { text: 'x' }), { code: 'signed_out', message: 'Sign in to use Buddy.' });
  assert.deepStrictEqual([calls, cloudCalls], [[], []]);
});

test('signed out while the settings are being fetched: that is the answer, not "the server was never reached"', async () => {
  // Signing out forgets the settings, so the fetch that was under way comes back with none (cloud.forget() in cloud.js).
  for (const [what, free] of [['none', null], ['some', FREE_ON]]) {
    for (const key of ['k-1', null]) {
      const s = setup({ free, key, signOutDuring: 'fetch' });
      await assert.rejects(s.ai.ask('fix', { text: 'x' }), { code: 'signed_out', message: 'Sign in to use Buddy.' },
        `settings: ${what}, own key: ${key}`);
      assert.deepStrictEqual(s.calls, [], 'the own key is not used');
      assert.deepStrictEqual(s.cloudCalls, [['settings', {}]], 'the server is not asked for an answer');
    }
  }
});

test("free mode on: Buddy's server answers, with the deadline it is given", async () => {
  const { ai, calls, cloudCalls } = setup({ free: FREE_ON });
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  assert.deepStrictEqual(await ai.ask('fix', { text: 'me go' }, { signal }), { text: 'Free answer', model: 'free-model' });
  assert.deepStrictEqual(cloudCalls.at(-1), ['cloudAsk', 'fix', { text: 'me go' }, { signal }]);
  assert.strictEqual(calls.length, 0, 'the own key is not used');
});

test('free mode on: input that is not valid is refused here, before the server is asked', async () => {
  const { ai, cloudCalls } = setup({ free: FREE_ON });
  await assert.rejects(ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  await assert.rejects(ai.ask('chat', { message: '  ' }), { code: 'bad_request', message: 'Tell me what to do first.' });
  assert.ok(!cloudCalls.some(([name]) => name === 'cloudAsk'));
});

test("free mode on: a chat goes to Buddy's server with all it carries, and its answer comes back as the server route gives it", async () => {
  const chat = { kind: 'write', say: 'Ye lo!', text: 'Dear Sir,', notes: [], doIt: true, send: false, remember: [] };
  const { ai, calls, cloudCalls } = setup({ free: FREE_ON, freeAsk: () => ({ text: JSON.stringify(chat), model: 'free-model', chat }) });
  const input = { message: 'boss ko mail', history: [{ from: 'you', text: 'hi' }], facts: ['Your boss is Mr. Sharma.'], userName: 'Rahul', step: 1 };
  assert.deepStrictEqual(await ai.ask('chat', input), { text: JSON.stringify(chat), model: 'free-model', chat });
  assert.deepStrictEqual(cloudCalls.at(-1), ['cloudAsk', 'chat', input, {}]);
  assert.strictEqual(calls.length, 0, 'the own key is not used');
});

test('the server never reached: the own key when there is one, else no internet', async () => {
  assert.strictEqual((await setup({ free: null }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: null, key: null }).ai.ask('fix', { text: 'x' }),
    { code: 'network', message: "Couldn't reach Buddy's server. Check your internet." });
});

test('blocked: the own key where the admin allows it, else paused', async () => {
  assert.strictEqual((await setup({ free: { ...FREE_ON, blocked: true, allowOwnKey: true } }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: { ...FREE_ON, blocked: true } }).ai.ask('fix', { text: 'x' }),
    { code: 'blocked', message: 'Your free access is paused.' });
  await assert.rejects(setup({ free: { ...FREE_ON, blocked: true, allowOwnKey: true }, key: null }).ai.ask('fix', { text: 'x' }), { code: 'blocked' });
});

const LIMIT = new BuddyError('free_limit', "You've used today's 30 free requests. They come back at midnight.");

test("today's free requests used up: the own key where allowed, after fetching the settings again", async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  assert.strictEqual((await s.ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  assert.ok(s.cloudCalls.some(([name, options]) => name === 'settings' && options.force === true));
});

test("today's free requests used up, own keys allowed but none saved: say where to add one", async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, key: null, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), {
    code: 'need_key',
    message: "You've used today's 30 free requests. Add your own key in Settings to keep going, or wait until midnight.",
  });
});

test("today's free requests used up, own keys not allowed: the server's words, and a saved key stays unused", async () => {
  const s = setup({ free: FREE_ON, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), LIMIT);
  assert.strictEqual(s.calls.length, 0);
});

test("today's free requests already used up by the kept settings, own keys allowed and one saved: straight to the own key", async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true, usedToday: 30 } });
  assert.strictEqual((await s.ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  assert.deepStrictEqual(s.cloudCalls, [['settings', {}]], 'the server is not asked for an answer, nor for the settings again');
});

test('…but the server is asked first with free requests left, no daily limit, own keys not allowed, or none saved', async () => {
  const usedUp = { ...FREE_ON, allowOwnKey: true, usedToday: 30 };
  for (const [what, options] of [
    ['free requests left', { free: { ...usedUp, usedToday: 29 } }],
    ['unlimited', { free: { ...usedUp, limitMode: 'unlimited', limit: null } }],
    ['no limit known', { free: { ...usedUp, limit: null } }],
    ['own keys not allowed', { free: { ...usedUp, allowOwnKey: false } }],
    ['no own key saved', { free: usedUp, key: null }],
  ]) {
    const s = setup(options);
    assert.strictEqual((await s.ai.ask('fix', { text: 'x' })).text, 'Free answer', what);
    assert.strictEqual(s.calls.length, 0, `${what}: the own key is not used`);
  }
});

test('signed out while the settings are fetched again after a refusal: that is the answer, and the own key is not used', async () => {
  const signedOut = new BuddyError('signed_out', 'Sign in to use Buddy.');
  for (const err of [LIMIT, new BuddyError('blocked', 'Your free access is paused.'), new BuddyError('free_off', 'Free AI is off.')]) {
    const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, freshFails: signedOut, freeAsk: () => { throw err; } });
    await assert.rejects(s.ai.ask('fix', { text: 'x' }), signedOut, err.code);
    assert.strictEqual(s.calls.length, 0, `${err.code}: the own key is not used`);
  }
});

test('signed out while the settings are fetched again after a refusal, whatever that fetch comes back with: that is the answer', async () => {
  // Signing out forgets the settings, so the fetch that was under way comes back with none (cloud.forget() in cloud.js);
  // the settings from before the request must not decide then, and the own key is not used.
  const noInternet = new BuddyError('network', "Couldn't reach Buddy's server.");
  for (const err of [LIMIT, new BuddyError('blocked', 'Your free access is paused.'), new BuddyError('free_off', 'Free AI is off.')]) {
    for (const [what, fetched] of [['none', { fresh: null }], ['a failure', { freshFails: noInternet }]]) {
      const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, ...fetched, signOutDuring: 'refetch', freeAsk: () => { throw err; } });
      await assert.rejects(s.ai.ask('fix', { text: 'x' }), { code: 'signed_out', message: 'Sign in to use Buddy.' }, `${err.code}, ${what}`);
      assert.deepStrictEqual(s.calls, [], `${err.code}, ${what}: the own key is not used`);
    }
  }
});

test('any other failure to fetch the settings again after a refusal: the settings from before the request decide', async () => {
  const s = setup({ free: { ...FREE_ON, allowOwnKey: true }, freshFails: new BuddyError('network', "Couldn't reach Buddy's server."),
    freeAsk: () => { throw LIMIT; } });
  assert.strictEqual((await s.ai.ask('fix', { text: 'x' })).text, 'Fixed text', 'own keys allowed, one saved');
});

test('free mode turned off meanwhile: the own key, once the settings say so', async () => {
  const off = new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.');
  assert.strictEqual((await setup({ free: FREE_ON, fresh: FREE_OFF, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' })).text, 'Fixed text');
  await assert.rejects(setup({ free: FREE_ON, fresh: FREE_OFF, key: null, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' }), { code: 'no_key' });
  await assert.rejects(setup({ free: FREE_ON, fresh: FREE_ON, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' }), off);
});

test('other failures of the free route are passed on as they are, with no second fetch', async () => {
  const down = new BuddyError('upstream', "Buddy couldn't answer. Try again.");
  const s = setup({ free: FREE_ON, freeAsk: () => { throw down; } });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), down);
  assert.ok(!s.cloudCalls.some(([name, options]) => name === 'settings' && options.force));
});

// ---- Claude Code on this computer (the brain spec §4) ----

const CLAUDE_IN = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max', version: '2.1.289', path: '/opt/homebrew/bin/claude', configDirectory: '/Users/a/.claude' };
const CLAUDE_OUT = { ...CLAUDE_IN, loggedIn: false, email: null, plan: null };
const CLAUDE_NONE = { installed: false, loggedIn: false, email: null, plan: null, version: null, path: null, configDirectory: null };
const claudeChat = JSON.stringify({ kind: 'write', say: 'Ye lo!', text: 'Dear Sir,', notes: [], doIt: false, send: false, remember: [], again: false });

test('claude code picked and signed in, free mode off: one run with the prompt, the saved alias and the signal, read like a provider answer', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: claudeChat, alias: 'opus' });
  const signal = AbortSignal.timeout(AI_TIMEOUT_MS);
  const out = await s.ai.ask('chat', { message: 'boss ko mail', appName: 'Mail', step: 1 }, { signal });
  assert.deepStrictEqual([out.text, out.model, out.usage], [claudeChat, 'opus', { inputTokens: 500, outputTokens: 20 }]);
  assert.strictEqual(out.chat.kind, 'write');
  assert.strictEqual(s.runs.length, 1);
  assert.strictEqual(s.runs[0].model, 'opus');
  assert.strictEqual(s.runs[0].signal, signal);
  assert.match(s.runs[0].system, /"kind"/);
  assert.match(s.runs[0].user, /The app they are in: Mail/);
  assert.strictEqual(s.runs[0].image, null);
  assert.strictEqual(s.calls.length, 0, 'no provider, no key');
  assert.ok(s.statusCalls.length >= 1 && s.statusCalls.every((o) => !o.force), 'the cached status, never forced');
});

test('claude code: sonnet without a saved alias, and in place of an alias that is not one of its own', async () => {
  for (const [alias, expected] of [[undefined, 'sonnet'], ['haiku', 'haiku'], ['gpt-4.1', 'sonnet'], ['', 'sonnet']]) {
    const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, alias });
    assert.strictEqual(s.ai.modelFor('claude-code'), expected, String(alias));
    await s.ai.ask('write', { instruction: 'leave mail' });
    assert.strictEqual(s.runs[0].model, expected, String(alias));
  }
});

test('claude code: not installed, or not signed in, says so before anything runs', async () => {
  const none = setup({ picked: 'claude-code', claude: CLAUDE_NONE });
  await assert.rejects(none.ai.ask('write', { instruction: 'x' }),
    { code: 'no_claude', message: "Claude Code isn't installed on this computer. Install it, or pick another AI in Settings." });
  const out = setup({ picked: 'claude-code', claude: CLAUDE_OUT });
  await assert.rejects(out.ai.ask('write', { instruction: 'x' }),
    { code: 'claude_signed_out', message: "Claude Code isn't signed in. Open a terminal, run claude, and sign in." });
  assert.deepStrictEqual([none.runs, out.runs], [[], []]);
});

test('claude code: a screenshot goes to the run as it is: every alias reads images', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: '{"kind":"answer","say":"It means soon."}' });
  const out = await s.ai.ask('chat', { message: 'what does this mean?', image: 'IMG', step: 2 });
  assert.strictEqual(s.runs[0].image, 'IMG');
  assert.deepStrictEqual([out.chat.kind, out.chat.text], ['answer', 'It means soon.']);
  const check = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: '{"verdict":"good","problems":[],"corrected":null}' });
  assert.deepStrictEqual((await check.ai.ask('check', { image: 'IMG' })).check, { verdict: 'good', problems: [], corrected: null });
});

test("claude code: the run's own failures are passed on as they are", async () => {
  const limit = new BuddyError('claude_limit', 'Your Claude Code usage limit is reached for now. Wait, or pick another AI in Settings.');
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN, claudeAnswer: limit });
  await assert.rejects(s.ai.ask('write', { instruction: 'x' }), limit);
});

test('claude code: bad input is refused before anything runs', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN });
  await assert.rejects(s.ai.ask('write', { instruction: '' }), { code: 'bad_request' });
  assert.strictEqual(s.runs.length, 0);
});

test('claude code signed in counts as an own key in every free-mode rule', async () => {
  const on = (free) => setup({ picked: 'claude-code', claude: CLAUDE_IN, free });
  // The server never reached: Claude Code answers.
  assert.strictEqual((await setup({ picked: 'claude-code', claude: CLAUDE_IN, free: null }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Free mode off: straight to Claude Code.
  assert.strictEqual((await on(FREE_OFF).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Blocked, own keys allowed.
  assert.strictEqual((await on({ ...FREE_ON, blocked: true, allowOwnKey: true }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // Today's requests already used up by the kept settings, own keys allowed: the server is not asked.
  const usedUp = on({ ...FREE_ON, allowOwnKey: true, usedToday: 30 });
  assert.strictEqual((await usedUp.ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  assert.deepStrictEqual(usedUp.cloudCalls, [['settings', {}]]);
  // The server refuses with the limit, own keys allowed: Claude Code takes over after the settings are fetched again.
  const refused = setup({ picked: 'claude-code', claude: CLAUDE_IN, free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  assert.strictEqual((await refused.ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  assert.ok(refused.cloudCalls.some(([name, options]) => name === 'settings' && options.force === true));
  // Free mode turned off meanwhile.
  const off = new BuddyError('free_off', 'Free AI is off.');
  assert.strictEqual((await setup({ picked: 'claude-code', claude: CLAUDE_IN, free: FREE_ON, fresh: FREE_OFF, freeAsk: () => { throw off; } }).ai.ask('fix', { text: 'x' })).text, 'Claude answer');
  // With free requests left, the server answers first and Claude Code is not run.
  const first = on({ ...FREE_ON, allowOwnKey: true });
  assert.strictEqual((await first.ai.ask('fix', { text: 'x' })).text, 'Free answer');
  assert.strictEqual(first.runs.length, 0);
});

test('claude code picked but not signed in is no own key: the free-mode rules say what they say for no key', async () => {
  const out = (free) => setup({ picked: 'claude-code', claude: CLAUDE_OUT, free });
  await assert.rejects(out(null).ai.ask('fix', { text: 'x' }), { code: 'network' });
  await assert.rejects(out({ ...FREE_ON, blocked: true, allowOwnKey: true }).ai.ask('fix', { text: 'x' }), { code: 'blocked' });
  const limited = setup({ picked: 'claude-code', claude: CLAUDE_OUT, free: { ...FREE_ON, allowOwnKey: true }, freeAsk: () => { throw LIMIT; } });
  await assert.rejects(limited.ai.ask('fix', { text: 'x' }), { code: 'need_key' });
  // Free mode off: the chat says what to do.
  await assert.rejects(out(FREE_OFF).ai.ask('fix', { text: 'x' }), { code: 'claude_signed_out' });
  // The same for not installed, where the words are "install it".
  await assert.rejects(setup({ picked: 'claude-code', claude: CLAUDE_NONE, free: FREE_OFF }).ai.ask('fix', { text: 'x' }), { code: 'no_claude' });
});

test('claude code: listModels gives its four names without a call, and other AIs are untouched', async () => {
  const s = setup({ picked: 'claude-code', claude: CLAUDE_IN });
  assert.deepStrictEqual(await s.ai.listModels('claude-code'), ['fable', 'opus', 'sonnet', 'haiku']);
  assert.deepStrictEqual(await s.ai.listModels('openai'), ['m-live']);
});

test('another AI picked: Claude Code is never asked about, and a run never happens', async () => {
  const s = setup({ picked: 'openai', claude: CLAUDE_IN });
  await s.ai.ask('fix', { text: 'x' });
  assert.deepStrictEqual([s.statusCalls, s.runs], [[], []]);
  assert.strictEqual(s.calls.length, 1);
});

test('without a finder (older callers), Claude Code picked is simply not installed', async () => {
  const s = setup({ picked: 'claude-code', claude: null });
  await assert.rejects(s.ai.ask('fix', { text: 'x' }), { code: 'no_claude' });
});
