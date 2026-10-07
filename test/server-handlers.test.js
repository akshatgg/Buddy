'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { BuddyError } = require('../shared/errors');
const { PROVIDERS } = require('../shared/providers');
const { config, ask, adminSettings, adminModels, adminUsers, handle } = require('../web/lib/handlers');
const { fakeDb } = require('./helpers/fake-db');

const NOW = new Date('2026-10-07T06:30:00Z'); // noon in India on 2026-10-07
const TODAY = '2026-10-07';
const ADMIN = 'akshatg9636@gmail.com';
const RAHUL = { email: 'rahul@gmail.com', name: 'Rahul' };

/** Free mode on with a daily limit of `n`, on Claude, with any other choices in `extra`. */
const freeDaily = (n, extra = {}) => ({
  enabled: true, limitMode: 'daily', dailyRequests: n, allowOwnKey: false, provider: 'anthropic', model: 'claude-x', ...extra,
});
const userDoc = (extra = {}) => ({ ...RAHUL, joined: NOW, lastActive: null, blocked: false, usedDay: '', usedCount: 0, ...extra });
const refusal = (status, code, message) => ({ status, body: { error: { code, message } } });

const TOKENS = {
  user: { uid: 'u1', ...RAHUL, emailVerified: true },
  admin: { uid: 'a1', email: ADMIN, name: 'Akshat', emailVerified: true },
  unverified: { uid: 'u2', email: 'x@gmail.com', name: 'X', emailVerified: false },
  // The admin's address in capitals, and the admin's address on a token whose email is not verified.
  adminShouting: { uid: 'a2', email: ADMIN.toUpperCase(), name: 'Akshat', emailVerified: true },
  adminUnverified: { uid: 'a3', email: ADMIN, name: 'Akshat', emailVerified: false },
};

/** Every route and method that is for the admin only. */
const ADMIN_ROUTES = [[adminSettings, 'GET'], [adminSettings, 'PUT'], [adminModels, 'GET'], [adminUsers, 'GET'], [adminUsers, 'POST']];

/** What firebase-admin throws for a token that is not good: an error with an `auth/…` code, and a message. */
const tokenError = (code) => Object.assign(new Error(`Decoding Firebase ID token failed: ${code}`), { code });

/**
 * The handlers with fakes: an in-memory database, one fake provider whatever the id, the server's keys in `keys`,
 * `adminEmail` as the server's ADMIN_EMAIL, and ID tokens by name: 'user', 'admin', 'unverified', and two more for the
 * admin gate ('adminShouting', 'adminUnverified'). Any other token is forged, and refused the way firebase-admin
 * refuses one (auth/argument-error). With `verifyFails`, checking any token throws that instead. The AI answers `reply`,
 * or what `reply(opts)` gives when it is a function.
 * `run(handler, method, { token, body, query })`.
 */
function setup({
  stored = null, users = {}, keys = { anthropic: 'admin-key' }, vision = true, reply = 'An answer', fail = null,
  live = ['m-1', 'm-2'], listFails = false, adminEmail = ADMIN, verifyFails = null,
} = {}) {
  const db = fakeDb({ config: stored, users });
  const completes = [];
  const lists = [];
  const provider = {
    isVisionModel: () => vision,
    async complete(opts) {
      completes.push(opts);
      if (fail) throw fail;
      const text = typeof reply === 'function' ? reply(opts) : reply;
      return { text, model: opts.model, usage: { inputTokens: 1, outputTokens: 2 } };
    },
    async listModels(opts) {
      lists.push(opts);
      if (listFails) throw new BuddyError('bad_key', 'Your Claude key was rejected. Check it in Settings.');
      return live;
    },
  };
  const deps = {
    async verifyToken(token) {
      if (verifyFails) throw verifyFails;
      if (!Object.hasOwn(TOKENS, token)) throw tokenError('auth/argument-error');
      return TOKENS[token];
    },
    db,
    providers: { getProvider: () => provider },
    adminKeys: keys,
    adminEmail,
    now: () => NOW,
  };
  const run = (handler, method, { token = 'user', body, query } = {}) => handle(handler, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
    body,
    query,
  }, deps);
  return { db, completes, lists, run };
}

// ---- signing in ----

test('every route wants a valid ID token for a verified email', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const s = setup();
  const routes = [config, ask, adminSettings, adminModels, adminUsers];
  for (const handler of routes) {
    const method = handler === ask ? 'POST' : 'GET';
    assert.deepStrictEqual(await s.run(handler, method, { token: null }), refusal(401, 'unauthenticated', 'Sign in to use Buddy.'));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'forged' }),
      refusal(401, 'unauthenticated', "Buddy couldn't check your sign-in. Sign in again."));
    assert.deepStrictEqual(await s.run(handler, method, { token: 'unverified' }),
      refusal(401, 'unauthenticated', 'Sign in with a Google account whose email is verified.'));
  }
  assert.deepStrictEqual(s.db.state.calls, [], 'nothing was read or written');
  // A token that is turned away leaves a trace, by its kind only, never the token or the message.
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), routes.map(() => '[auth] token not accepted: auth/argument-error'));
});

test('every kind of token that is not good means signing in again', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const kinds = ['auth/id-token-expired', 'auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-revoked',
    'auth/user-disabled', 'auth/user-not-found'];
  for (const kind of kinds) {
    const s = setup({ verifyFails: tokenError(kind) });
    assert.deepStrictEqual(await s.run(config, 'GET'), refusal(401, 'unauthenticated', "Buddy couldn't check your sign-in. Sign in again."), kind);
    assert.deepStrictEqual(s.db.state.calls, [], `${kind}: nothing was read or written`);
  }
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), kinds.map((kind) => `[auth] token not accepted: ${kind}`));
});

test("a token the server cannot check is the server's problem: 503, nobody is told to sign in again, and only the kind is logged", async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  // Google's signing keys out of reach, and a failure with no code at all. Their messages can carry the token.
  const failures = [
    Object.assign(new Error('Error fetching public keys for Google certs: eyJhbGciOiJSUzI1NiJ9.secret-token'), { code: 'auth/internal-error' }),
    new TypeError('Cannot read properties of undefined (eyJhbGciOiJSUzI1NiJ9.secret-token)'),
  ];
  for (const failure of failures) {
    const s = setup({ verifyFails: failure });
    for (const [handler, method] of [[config, 'GET'], [ask, 'POST'], ...ADMIN_ROUTES]) {
      assert.deepStrictEqual(await s.run(handler, method, { body: { action: 'fix', text: 'x' } }),
        refusal(503, 'server', "Buddy's server had a problem. Try again."), `${failure.name} ${method} ${handler.name}`);
    }
    assert.deepStrictEqual(s.db.state.calls, [], 'nothing was read or written');
  }
  const logged = error.mock.calls.map((c) => c.arguments.join(' '));
  assert.deepStrictEqual([...new Set(logged)], ['[auth] could not check a token: auth/internal-error', '[auth] could not check a token: TypeError']);
  assert.strictEqual(logged.length, 2 * (2 + ADMIN_ROUTES.length), 'one line for each request');
  assert.strictEqual(warn.mock.callCount(), 0, 'not logged as a token that was turned away');
  assert.doesNotMatch(logged.join('\n'), /secret-token/, 'the token is never logged');
});

test('a method a route does not take is refused', async () => {
  const s = setup();
  for (const [handler, method] of [[config, 'POST'], [ask, 'GET'], [adminSettings, 'DELETE'], [adminModels, 'POST'], [adminUsers, 'PUT']]) {
    assert.deepStrictEqual(await s.run(handler, method), refusal(405, 'method_not_allowed', 'Not allowed.'));
  }
});

test('the admin routes are for the admin only', async () => {
  const s = setup();
  for (const [handler, method] of ADMIN_ROUTES) {
    assert.deepStrictEqual(await s.run(handler, method, { body: { enabled: true } }), refusal(403, 'not_admin', 'Only the admin can do this.'));
  }
  assert.deepStrictEqual(s.db.state.calls, []);
});

test('the admin is known by email in any letter case, and only for an email that is verified', async () => {
  // Capitals on the token, lower case in ADMIN_EMAIL.
  const s = setup();
  assert.strictEqual((await s.run(config, 'GET', { token: 'adminShouting' })).body.isAdmin, true);
  assert.strictEqual((await s.run(adminSettings, 'GET', { token: 'adminShouting' })).status, 200);

  // Spaces and capitals in ADMIN_EMAIL, the way it may have been typed into the server's settings.
  const typed = setup({ adminEmail: `  ${ADMIN.toUpperCase()}  ` });
  assert.strictEqual((await typed.run(config, 'GET', { token: 'admin' })).body.isAdmin, true);
  assert.strictEqual((await typed.run(adminUsers, 'GET', { token: 'admin' })).status, 200);

  // The admin's address on a token whose email is not verified is nobody: not even signed in.
  const unverified = setup();
  for (const [handler, method] of [[config, 'GET'], ...ADMIN_ROUTES]) {
    assert.deepStrictEqual(await unverified.run(handler, method, { token: 'adminUnverified' }),
      refusal(401, 'unauthenticated', 'Sign in with a Google account whose email is verified.'), `${method} ${handler.name}`);
  }
  assert.deepStrictEqual(unverified.db.state.calls, [], 'nothing was read or written');
});

test('with no ADMIN_EMAIL, however it is empty, nobody is the admin', async () => {
  for (const adminEmail of ['', '   ', null]) {
    const s = setup({ adminEmail });
    const how = JSON.stringify(adminEmail);
    assert.strictEqual((await s.run(config, 'GET', { token: 'admin' })).body.isAdmin, false, how);
    for (const [handler, method] of ADMIN_ROUTES) {
      assert.deepStrictEqual(await s.run(handler, method, { token: 'admin' }), refusal(403, 'not_admin', 'Only the admin can do this.'),
        `${how} ${method} ${handler.name}`);
    }
  }
});

// ---- GET /api/config ----

test('config: the first call adds the user, and with nothing saved free mode is off', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(config, 'GET'), {
    status: 200,
    body: { freeOn: false, limitMode: 'daily', limit: 30, usedToday: 0, allowOwnKey: false, blocked: false, isAdmin: false, voiceOn: false },
  });
  assert.deepStrictEqual(s.db.state.users.u1, userDoc());
});

test("config: free mode on, today's count, and own keys allowed", async () => {
  const s = setup({ stored: freeDaily(5, { allowOwnKey: true }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 3, lastActive: NOW }) } });
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 5, usedToday: 3, allowOwnKey: true, blocked: false, isAdmin: false, voiceOn: false,
  });
});

test("config: yesterday's count is not today's; unlimited has no limit and no own keys", async () => {
  const s = setup({
    stored: freeDaily(5, { limitMode: 'unlimited', allowOwnKey: true }),
    users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 9 }) },
  });
  const { body } = await s.run(config, 'GET');
  assert.deepStrictEqual([body.limitMode, body.limit, body.usedToday, body.allowOwnKey], ['unlimited', null, 0, false]);
});

test('config: switched on with no server key for its provider counts as off', async () => {
  const s = setup({ stored: freeDaily(5), keys: { openai: 'k' } });
  assert.strictEqual((await s.run(config, 'GET')).body.freeOn, false);
});

test('config: says who is blocked and who is the admin', async () => {
  const s = setup({ users: { u1: userDoc({ blocked: true }) } });
  assert.strictEqual((await s.run(config, 'GET')).body.blocked, true);
  assert.strictEqual((await s.run(config, 'GET', { token: 'admin' })).body.isAdmin, true);
});

test('config: voice is on when the server has a Groq key, with free mode on or off', async () => {
  assert.strictEqual((await setup({ keys: { anthropic: 'k', groq: 'g' } }).run(config, 'GET')).body.voiceOn, true);
  assert.strictEqual((await setup({ stored: freeDaily(5), keys: { groq: 'g' } }).run(config, 'GET')).body.voiceOn, true);
  assert.strictEqual((await setup({ stored: freeDaily(5), keys: { anthropic: 'k' } }).run(config, 'GET')).body.voiceOn, false);
  assert.strictEqual((await setup({ keys: { groq: '' } }).run(config, 'GET')).body.voiceOn, false);
});

// ---- POST /api/ask ----

test("ask: counts the request, then answers with the admin's key, the chosen model and the token cap", async () => {
  const s = setup({ stored: freeDaily(5) });
  const r = await s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.deepStrictEqual(r, { status: 200, body: { text: 'An answer', model: 'claude-x' } });
  const [call] = s.completes;
  assert.deepStrictEqual([call.apiKey, call.model, call.user, call.maxTokens], ['admin-key', 'claude-x', 'me go home', 1024]);
  assert.ok(call.signal instanceof AbortSignal, 'the AI gets a deadline');
  assert.deepStrictEqual(s.db.state.users.u1, userDoc({ usedDay: TODAY, usedCount: 1, lastActive: NOW }));
});

test('ask: the daily limit is kept, and nothing is asked of the AI past it', async () => {
  const s = setup({ stored: freeDaily(2) });
  const fix = () => s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home' } });
  assert.strictEqual((await fix()).status, 200);
  assert.strictEqual((await fix()).status, 200);
  assert.deepStrictEqual(await fix(), refusal(429, 'free_limit', "You've used today's 2 free requests. They come back at midnight."));
  assert.strictEqual(s.completes.length, 2);
  assert.strictEqual(s.db.state.users.u1.usedCount, 2);
});

test('ask: a new day starts again from zero', async () => {
  const s = setup({ stored: freeDaily(2), users: { u1: userDoc({ usedDay: '2026-10-06', usedCount: 2 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.deepStrictEqual([s.db.state.users.u1.usedDay, s.db.state.users.u1.usedCount], [TODAY, 1]);
});

test('ask: unlimited still counts, and never refuses', async () => {
  const s = setup({ stored: freeDaily(2, { limitMode: 'unlimited' }), users: { u1: userDoc({ usedDay: TODAY, usedCount: 500 }) } });
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } })).status, 200);
  assert.strictEqual(s.db.state.users.u1.usedCount, 501);
});

test('ask: a blocked user is refused, and nothing is counted or asked', async () => {
  const s = setup({ stored: freeDaily(5), users: { u1: userDoc({ blocked: true }) } });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), refusal(403, 'blocked', 'Your free access is paused.'));
  assert.strictEqual(s.completes.length, 0);
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
});

test('ask: free mode off, or no server key for its provider, is free_off', async () => {
  const off = refusal(403, 'free_off', 'Free AI is off. Add your own key in Settings.');
  const s1 = setup();
  assert.deepStrictEqual(await s1.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  const s2 = setup({ stored: freeDaily(5), keys: { groq: 'k' } });
  assert.deepStrictEqual(await s2.run(ask, 'POST', { body: { action: 'fix', text: 'x' } }), off);
  assert.deepStrictEqual([s1.db.state.users, s2.db.state.users], [{}, {}], 'nobody was counted');
});

test('ask: input that is not valid is refused with the same words as in the app, before anything is read', async () => {
  const s = setup({ stored: freeDaily(5) });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'write', instruction: '  ' } }),
    refusal(400, 'bad_request', 'Tell me what to write first.'));
  assert.strictEqual((await s.run(ask, 'POST', { body: 'not an object' })).status, 400);
  assert.strictEqual((await s.run(ask, 'POST', { body: { action: 'fix', text: 'x'.repeat(8001) } })).status, 400);
  assert.deepStrictEqual(s.db.state.calls, [], 'not even the settings were read');
});

test('ask: a screenshot for a model that cannot see is refused, and not counted', async () => {
  const s = setup({ stored: freeDaily(5), vision: false });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG' } }),
    refusal(400, 'free_no_vision', "The free AI can't read screenshots right now."));
  assert.deepStrictEqual(s.db.state.users, {});
});

test('ask: when the AI fails the request is given back, and the user hears it in plain words', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  // A provider's message can echo what the person sent, so the fake's does.
  const s = setup({ stored: freeDaily(5), fail: new BuddyError('rate_limited', 'Claude is busy: my secret text') });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'my secret text' } }),
    refusal(502, 'upstream', "Buddy couldn't answer. Try again."));
  assert.strictEqual(s.db.state.users.u1.usedCount, 0);
  assert.deepStrictEqual(s.db.state.calls.filter((c) => c !== 'getConfig'), ['countRequest', 'refundRequest']);
  const logged = warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n');
  assert.match(logged, /\[ask\] anthropic failed: rate_limited/);
  assert.doesNotMatch(logged, /secret/, 'what the user sent is never logged');
});

test('ask: when the request cannot be given back either, the person hears the same, and only the kind is logged', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const error = t.mock.method(console, 'error', () => {});
  const s = setup({ stored: freeDaily(5), fail: new BuddyError('rate_limited', 'Claude is busy: my secret text') });
  s.db.refundRequest = async () => { throw Object.assign(new Error('The database said: my secret text'), { code: 'unavailable' }); };
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'fix', text: 'my secret text' } }),
    refusal(502, 'upstream', "Buddy couldn't answer. Try again."));
  assert.strictEqual(s.db.state.users.u1.usedCount, 1, 'it stays counted when it cannot be given back');
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments.join(' ')), ['[ask] could not give the request back: unavailable']);
  assert.doesNotMatch(warn.mock.calls.map((c) => c.arguments.join(' ')).join('\n'), /secret/);
});

test('ask: a Check answer comes back read as well', async () => {
  const s = setup({ stored: freeDaily(5), reply: '{"verdict":"good","problems":[],"corrected":null}' });
  const r = await s.run(ask, 'POST', { body: { action: 'check', image: 'IMG', instruction: 'ok?' } });
  assert.deepStrictEqual(r.body.check, { verdict: 'good', problems: [], corrected: null });
});

// ---- POST /api/ask: chat ----

/** A chat answer of `kind` as parseChat reads it, and as the model writes it. */
const chatOf = (kind, extra = {}) => ({
  kind, say: 'Okay!', text: kind === 'write' ? 'Dear Sir,' : '', notes: [], doIt: false, send: false, remember: [], ...extra,
});
const chatReply = (kind, extra) => JSON.stringify(chatOf(kind, extra));

test('ask: a chat is counted, answered with the chat prompt, and comes back read as well', async () => {
  const reply = chatReply('write', { doIt: true });
  const s = setup({ stored: freeDaily(5), reply });
  const body = {
    action: 'chat', message: 'boss ko mail, kal chutti chahiye', history: [{ from: 'you', text: 'hi' }],
    facts: ['Your boss is Mr. Sharma.'], appName: 'Gmail', userName: 'Rahul', step: 1,
  };
  assert.deepStrictEqual(await s.run(ask, 'POST', { body }),
    { status: 200, body: { text: reply, model: 'claude-x', chat: chatOf('write', { doIt: true }) } });
  const [call] = s.completes;
  assert.match(call.system, /"kind"/);
  assert.match(call.user, /Their message:\n"""\nboss ko mail, kal chutti chahiye\n"""/);
  assert.match(call.user, /- Your boss is Mr\. Sharma\./);
  assert.match(call.user, /The app they are in: Gmail\nTheir first name: Rahul/);
  assert.strictEqual(call.image, null);
  assert.strictEqual(s.db.state.users.u1.usedCount, 1);
  assert.ok(!s.db.state.calls.includes('refundRequest'));
});

test('ask: a chat whose first answer wants the text box or the screen is given back: one question costs one request', async () => {
  for (const kind of ['box', 'screen']) {
    for (const step of [undefined, 1]) {
      const s = setup({ stored: freeDaily(5), reply: chatReply(kind) });
      const r = await s.run(ask, 'POST', { body: { action: 'chat', message: 'fix my English', step } });
      const empty = { kind, say: '', text: '', notes: [], doIt: false, send: false, remember: [] };
      assert.deepStrictEqual(r, { status: 200, body: { text: JSON.stringify(empty), model: 'claude-x', chat: empty } });
      assert.strictEqual(s.db.state.users.u1.usedCount, 0, `${kind}, step ${step}: given back`);
      assert.deepStrictEqual(s.db.state.calls.filter((c) => c !== 'getConfig'), ['countRequest', 'refundRequest']);
    }
  }
});

test('ask: a given-back answer carries nothing the AI wrote into it, so asking "step 1" again and again gets no free text', async () => {
  const sneaky = JSON.stringify({ kind: 'screen', say: 'Here you go', text: 'A whole free essay', notes: ['n'], doIt: true, send: true, remember: ['x'] });
  const s = setup({ stored: freeDaily(5), reply: sneaky });
  const r = await s.run(ask, 'POST', { body: { action: 'chat', message: 'write an essay', step: 1 } });
  assert.ok(!JSON.stringify(r.body).includes('essay'), 'the text is dropped');
  assert.ok(!JSON.stringify(r.body).includes('Here you go'), 'and what it said');
  assert.strictEqual(r.body.chat.kind, 'screen');
});

test('ask: nothing is given back on the second step, for any other kind of chat answer, or for one that is not JSON', async () => {
  const cases = [
    [chatReply('box'), 2], [chatReply('screen'), 2],
    ...['write', 'fix', 'answer', 'send'].map((kind) => [chatReply(kind), 1]),
    ['Dear Sir, I need leave tomorrow.', 1],
  ];
  for (const [reply, step] of cases) {
    const s = setup({ stored: freeDaily(5), reply });
    const r = await s.run(ask, 'POST', { body: { action: 'chat', message: 'hi', step, ...(step === 2 ? { box: 'my text' } : {}) } });
    assert.strictEqual(r.status, 200, reply);
    assert.strictEqual(s.db.state.users.u1.usedCount, 1, `${reply}, step ${step}: counted`);
    assert.ok(!s.db.state.calls.includes('refundRequest'), reply);
  }
});

test('ask: the old requests are never given back, and get no chat reading', async () => {
  const s = setup({ stored: freeDaily(5), reply: chatReply('box') });
  const r = await s.run(ask, 'POST', { body: { action: 'fix', text: 'me go home', step: 1 } });
  assert.deepStrictEqual(r.body, { text: chatReply('box'), model: 'claude-x' });
  assert.strictEqual(s.db.state.users.u1.usedCount, 1);
});

test('ask: the free limits hold for chats as today', async () => {
  // A limit of 2: each question with a second step costs one request, so two of them fit, and the next one is refused
  // before the AI is asked.
  const replies = [chatReply('screen'), chatReply('answer', { say: '', text: 'It means "soon".' }), chatReply('box'), chatReply('fix')];
  const s = setup({ stored: freeDaily(2), reply: () => replies.shift() });
  for (const [i, step] of [1, 2, 1, 2].entries()) {
    const extra = step === 2 ? { image: 'IMG' } : {};
    const r = await s.run(ask, 'POST', { body: { action: 'chat', message: 'what does this mean?', step, ...extra } });
    assert.strictEqual(r.status, 200, `request ${i + 1}`);
  }
  assert.strictEqual(s.db.state.users.u1.usedCount, 2);
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'chat', message: 'and this?' } }),
    refusal(429, 'free_limit', "You've used today's 2 free requests. They come back at midnight."));
  assert.strictEqual(s.completes.length, 4);
});

test('ask: a chat that cannot be given back is still answered, and only the kind is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const s = setup({ stored: freeDaily(5), reply: chatReply('screen') });
  s.db.refundRequest = async () => { throw Object.assign(new Error('The database said: fix my English'), { code: 'unavailable' }); };
  const r = await s.run(ask, 'POST', { body: { action: 'chat', message: 'fix my English' } });
  const empty = { kind: 'screen', say: '', text: '', notes: [], doIt: false, send: false, remember: [] };
  assert.deepStrictEqual(r, { status: 200, body: { text: JSON.stringify(empty), model: 'claude-x', chat: empty } });
  assert.strictEqual(s.db.state.users.u1.usedCount, 1, 'it stays counted when it cannot be given back');
  assert.deepStrictEqual(error.mock.calls.map((c) => c.arguments.join(' ')), ['[ask] could not give the request back: unavailable']);
});

test('ask: a chat that is not valid is refused with the same words as in the app, before anything is read', async () => {
  const s = setup({ stored: freeDaily(5) });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'chat', message: '  ' } }),
    refusal(400, 'bad_request', 'Tell me what to do first.'));
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'chat', message: 'fix', selection: 'x'.repeat(8001) } }),
    refusal(400, 'bad_request', 'That is too long (over 8000 characters). Try a shorter one.'));
  assert.deepStrictEqual(s.db.state.calls, [], 'not even the settings were read');
});

test('ask: a chat with a screenshot, for a model that cannot see, is refused and not counted', async () => {
  const s = setup({ stored: freeDaily(5), vision: false });
  assert.deepStrictEqual(await s.run(ask, 'POST', { body: { action: 'chat', message: 'what is this?', image: 'IMG', step: 2 } }),
    refusal(400, 'free_no_vision', "The free AI can't read screenshots right now."));
  assert.deepStrictEqual(s.db.state.users, {});
});

// ---- the admin's switches ----

test('admin settings: with nothing saved, the defaults, and which providers have a key on the server', async () => {
  const s = setup({ keys: { anthropic: 'k', groq: 'g' } });
  const r = await s.run(adminSettings, 'GET', { token: 'admin' });
  assert.strictEqual(r.status, 200);
  assert.deepStrictEqual(r.body.config, {
    enabled: false, limitMode: 'daily', dailyRequests: 30, allowOwnKey: false, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  });
  assert.deepStrictEqual(r.body.providers.map((p) => [p.id, p.label, p.hasKey]), [
    ['anthropic', 'Claude (Anthropic)', true], ['openai', 'OpenAI', false], ['gemini', 'Google Gemini', false], ['groq', 'Groq', true],
  ]);
  assert.deepStrictEqual(r.body.providers[3].fallbackModels, PROVIDERS.groq.fallbackModels);
  assert.strictEqual(r.body.voiceOn, true, 'voice is on: there is a Groq key');
});

test('admin settings: say whether voice is on, after a save too', async () => {
  const s = setup();
  assert.strictEqual((await s.run(adminSettings, 'GET', { token: 'admin' })).body.voiceOn, false, 'no Groq key');
  assert.strictEqual((await s.run(adminSettings, 'PUT', { token: 'admin', body: { enabled: true } })).body.voiceOn, false);
  const withGroq = setup({ keys: { anthropic: 'k', groq: 'g' } });
  assert.strictEqual((await withGroq.run(adminSettings, 'PUT', { token: 'admin', body: { dailyRequests: 9 } })).body.voiceOn, true);
  assert.ok(!('voiceOn' in withGroq.db.state.config), 'it is not a switch that is saved');
});

test('admin settings: a change is saved and every user sees it; a refused one changes nothing', async () => {
  const s = setup();
  const saved = await s.run(adminSettings, 'PUT', { token: 'admin', body: { enabled: true, dailyRequests: 10, allowOwnKey: true } });
  assert.strictEqual(saved.status, 200);
  const expected = {
    enabled: true, limitMode: 'daily', dailyRequests: 10, allowOwnKey: true, provider: 'anthropic', model: 'claude-haiku-4-5-20251001',
  };
  assert.deepStrictEqual(saved.body.config, expected);
  assert.deepStrictEqual(s.db.state.config, expected);
  assert.deepStrictEqual((await s.run(config, 'GET')).body, {
    freeOn: true, limitMode: 'daily', limit: 10, usedToday: 0, allowOwnKey: true, blocked: false, isAdmin: false, voiceOn: false,
  });

  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { dailyRequests: 0 } }),
    refusal(400, 'bad_request', 'The daily limit must be a whole number from 1 to 10000.'));
  assert.deepStrictEqual(await s.run(adminSettings, 'PUT', { token: 'admin', body: { provider: 'openai' } }),
    refusal(400, 'bad_request', "There is no OpenAI key on the server, so free mode can't use it."));
  assert.deepStrictEqual(s.db.state.config, expected);
});

test("admin models: the live list for the server's key", async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query: { provider: 'anthropic' } }),
    { status: 200, body: { models: ['m-1', 'm-2'], live: true } });
  assert.strictEqual(s.lists[0].apiKey, 'admin-key');
});

test('admin models: the usual list when the server has no key, the key lists nothing, or the listing fails', async (t) => {
  const warn = t.mock.method(console, 'warn', () => {});
  const usual = PROVIDERS.openai.fallbackModels;
  const list = (options) => setup(options).run(adminModels, 'GET', { token: 'admin', query: { provider: 'openai' } });
  assert.deepStrictEqual((await list({})).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, live: [] })).body, { models: usual, live: false });
  assert.deepStrictEqual((await list({ keys: { openai: 'k' }, listFails: true })).body, {
    models: usual, live: false, warning: "Couldn't load the model list for the server's OpenAI key. Showing the usual models.",
  });
  assert.deepStrictEqual(warn.mock.calls.map((c) => c.arguments.join(' ')), ['[models] openai failed: bad_key'], 'only the kind is logged');
});

test('admin models: only real providers', async () => {
  const s = setup();
  for (const query of [{ provider: 'constructor' }, {}, undefined]) {
    assert.deepStrictEqual(await s.run(adminModels, 'GET', { token: 'admin', query }), refusal(400, 'bad_request', 'Unknown AI provider.'));
  }
});

// ---- the users list ----

test('admin users: busiest today first, then the most recently active, with dates as ISO text', async () => {
  const at = (iso) => new Date(iso);
  const s = setup({ users: {
    a: userDoc({ email: 'a@x.com', name: 'A', lastActive: at('2026-10-07T05:00:00Z'), usedDay: TODAY, usedCount: 2 }),
    b: userDoc({ email: 'b@x.com', name: 'B', lastActive: at('2026-10-07T01:00:00Z'), usedDay: TODAY, usedCount: 7 }),
    c: userDoc({ email: 'c@x.com', name: 'C', lastActive: at('2026-10-06T12:00:00Z'), usedDay: '2026-10-06', usedCount: 50 }),
    d: userDoc({ email: 'd@x.com', name: 'D' }),
  } });
  const r = await s.run(adminUsers, 'GET', { token: 'admin' });
  assert.deepStrictEqual(r.body.users.map((u) => [u.uid, u.usedToday]), [['b', 7], ['a', 2], ['c', 0], ['d', 0]]);
  assert.deepStrictEqual(r.body.users[0], {
    uid: 'b', email: 'b@x.com', name: 'B', joined: NOW.toISOString(), lastActive: '2026-10-07T01:00:00.000Z', blocked: false, usedToday: 7,
  });
  assert.strictEqual(r.body.users[3].lastActive, null);
});

test('admin users: block and unblock', async () => {
  const s = setup({ users: { u1: userDoc() } });
  const blocked = await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: true } });
  assert.deepStrictEqual([blocked.status, blocked.body.user.uid, blocked.body.user.blocked], [200, 'u1', true]);
  assert.strictEqual(s.db.state.users.u1.blocked, true);
  await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'u1', blocked: false } });
  assert.strictEqual(s.db.state.users.u1.blocked, false);
});

test('admin users: someone who is not there, or a request that is not valid', async () => {
  const s = setup();
  assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body: { uid: 'nobody', blocked: true } }),
    refusal(404, 'not_found', 'That user was not found.'));
  for (const body of [undefined, { uid: 'u1' }, { uid: '', blocked: true }, { uid: 7, blocked: true },
    { uid: 'x'.repeat(129), blocked: true }, { uid: 'u1', blocked: 'yes' }]) {
    assert.deepStrictEqual(await s.run(adminUsers, 'POST', { token: 'admin', body }),
      refusal(400, 'bad_request', 'Pick a user to block or unblock.'), JSON.stringify(body));
  }
});

// ---- anything else ----

test('a failure nobody planned for is a 500 in plain words, and only its kind is logged', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  // Its message quotes what the person sent, as a JSON.parse error does.
  const failure = async () => { throw new SyntaxError('Unexpected token in "my secret text"'); };
  const r = await handle(failure, { method: 'GET', headers: {} }, {});
  assert.deepStrictEqual(r, refusal(500, 'server', "Buddy's server had a problem. Try again."));
  assert.strictEqual(error.mock.callCount(), 1);
  const logged = error.mock.calls[0].arguments.join(' ');
  assert.match(logged, /\[api\] failed: SyntaxError/);
  assert.doesNotMatch(logged, /secret/, 'what the person sent is never logged');
});
