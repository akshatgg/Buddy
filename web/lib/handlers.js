'use strict';

/**
 * Buddy's server, as plain functions. Each takes a request { method, headers, body, query } and its dependencies,
 * and answers { status, body }. The Vercel functions in web/api/ are thin wrappers around these (web/lib/vercel.js),
 * so everything here is tested with fakes (test/server-handlers.test.js).
 *
 * deps = {
 *   verifyToken(idToken) -> { uid, email, emailVerified, name }   throws when the token is not valid, or cannot be
 *                            checked; firebase-admin's `auth/…` code tells which (TOKEN_PROBLEMS)
 *   db                       web/lib/firestore-db.js, or a fake with the same methods
 *   providers                shared/providers: getProvider(id) -> { complete, listModels, isVisionModel }
 *   adminKeys                { providerId: key } -- the server's own AI keys
 *   adminEmail               who may use /api/admin/*
 *   now() -> Date
 *   fetchImpl                optional, for the providers
 * }
 */

const { BuddyError } = require('../shared/errors');
const { buildPrompt, parseCheck, parseChat, MAX_TOKENS } = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const { dayKey } = require('./day');
const { withDefaults, isFreeOn, applyPatch } = require('./free-config');

// The app gives up on an answer after 60 seconds; the server gives up on the AI before that, so the person hears
// "Buddy couldn't answer" and the request is given back.
const ASK_TIMEOUT_MS = 50_000;
const MODELS_TIMEOUT_MS = 15_000;
const USERS_LIMIT = 1000;
const UID_MAX = 128;

const STATUS = {
  bad_request: 400,
  free_no_vision: 400,
  unauthenticated: 401,
  blocked: 403,
  free_off: 403,
  not_admin: 403,
  not_found: 404,
  method_not_allowed: 405,
  free_limit: 429,
  upstream: 502,
  server: 503, // the server could not check a sign-in (any other failure of its own is a 500, with the same code)
};

// What firebase-admin says about a token that is no good: expired, garbled or forged, revoked, or of someone who was
// disabled or deleted. Only these mean that the person has to sign in again.
const TOKEN_PROBLEMS = [
  'auth/id-token-expired', 'auth/argument-error', 'auth/invalid-id-token', 'auth/id-token-revoked', 'auth/user-disabled',
  'auth/user-not-found',
];

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const answer = (body) => ({ status: 200, body });
const hasKeyIn = (deps) => (id) => typeof deps.adminKeys?.[id] === 'string' && deps.adminKeys[id] !== '';
/**
 * What kind of failure `err` is: its code, else its name. Only this is ever logged, never its message, because a
 * message can quote what the person sent (or, for a server that cannot start, the service account key).
 * web/lib/vercel.js logs its startup failures the same way.
 */
const kindOf = (err) => err?.code || err?.name || 'error';

function allowMethods(req, ...methods) {
  if (!methods.includes(req.method)) throw new BuddyError('method_not_allowed', 'Not allowed.');
}

/** The signed-in person the request's ID token belongs to. */
async function signedIn(req, deps) {
  const match = /^Bearer (\S+)$/.exec(req.headers?.authorization || '');
  if (!match) throw new BuddyError('unauthenticated', 'Sign in to use Buddy.');
  let who;
  try {
    who = await deps.verifyToken(match[1]);
  } catch (err) {
    // Only the kind is logged, never the token or the message.
    const kind = kindOf(err);
    if (TOKEN_PROBLEMS.includes(kind)) {
      console.warn(`[auth] token not accepted: ${kind}`);
      throw new BuddyError('unauthenticated', "Buddy couldn't check your sign-in. Sign in again.");
    }
    // Anything else is the server failing to check a token (Google's signing keys out of reach, firebase-admin itself
    // failing): the person's sign-in may well be fine, so this is not a 401, which would sign them out of the app.
    console.error(`[auth] could not check a token: ${kind}`);
    throw new BuddyError('server', "Buddy's server had a problem. Try again.");
  }
  if (!who?.uid || !who.email || who.emailVerified !== true) {
    throw new BuddyError('unauthenticated', 'Sign in with a Google account whose email is verified.');
  }
  return who;
}

const isAdmin = (who, deps) => Boolean(deps.adminEmail) && who.email.toLowerCase() === deps.adminEmail.trim().toLowerCase();

async function signedInAdmin(req, deps) {
  const who = await signedIn(req, deps);
  if (!isAdmin(who, deps)) throw new BuddyError('not_admin', 'Only the admin can do this.');
  return who;
}

/** GET /api/config: what free mode means for this person. Adds them on their first call. */
async function config(req, deps) {
  allowMethods(req, 'GET');
  const who = await signedIn(req, deps);
  const hasKey = hasKeyIn(deps);
  const now = deps.now();
  const [stored, user] = await Promise.all([
    deps.db.getConfig(),
    deps.db.ensureUser({ uid: who.uid, email: who.email, name: who.name || '', now }),
  ]);
  const cfg = withDefaults(stored, hasKey);
  const daily = cfg.limitMode === 'daily';
  return answer({
    freeOn: isFreeOn(cfg, hasKey),
    limitMode: cfg.limitMode,
    limit: daily ? cfg.dailyRequests : null,
    usedToday: user.usedDay === dayKey(now) ? user.usedCount : 0,
    allowOwnKey: daily && cfg.allowOwnKey,
    blocked: user.blocked === true,
    isAdmin: isAdmin(who, deps),
  });
}

/** Give a counted request back. When that fails too, only its kind is logged, and the request stays counted. */
async function giveBack(uid, day, deps) {
  try {
    await deps.db.refundRequest({ uid, day });
  } catch (err) {
    console.error(`[ask] could not give the request back: ${kindOf(err)}`);
  }
}

/** POST /api/ask: one answer with the admin's key, counted against the person's day before the AI is asked. */
async function ask(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  const prompt = buildPrompt(body.action, body); // input that is not valid is refused before anything is read
  const hasKey = hasKeyIn(deps);
  const cfg = withDefaults(await deps.db.getConfig(), hasKey);
  if (!isFreeOn(cfg, hasKey)) throw new BuddyError('free_off', 'Free AI is off. Add your own key in Settings.');
  const provider = deps.providers.getProvider(cfg.provider);
  if (prompt.image && !provider.isVisionModel(cfg.model)) {
    throw new BuddyError('free_no_vision', "The free AI can't read screenshots right now.");
  }

  const now = deps.now();
  const day = dayKey(now);
  const counted = await deps.db.countRequest({
    uid: who.uid,
    email: who.email,
    name: who.name || '',
    day,
    now,
    limit: cfg.limitMode === 'daily' ? cfg.dailyRequests : null,
  });
  if (!counted.ok && counted.reason === 'blocked') throw new BuddyError('blocked', 'Your free access is paused.');
  if (!counted.ok) {
    throw new BuddyError('free_limit', `You've used today's ${cfg.dailyRequests} free requests. They come back at midnight.`);
  }

  let out;
  try {
    out = await provider.complete({
      apiKey: deps.adminKeys[cfg.provider],
      model: cfg.model,
      ...prompt,
      maxTokens: MAX_TOKENS,
      fetchImpl: deps.fetchImpl,
      signal: AbortSignal.timeout(ASK_TIMEOUT_MS),
    });
  } catch (err) {
    // Only the kind of failure is logged, never what the person sent.
    console.warn(`[ask] ${cfg.provider} failed: ${kindOf(err)}`);
    await giveBack(who.uid, day, deps);
    throw new BuddyError('upstream', "Buddy couldn't answer. Try again.");
  }
  let chat = body.action === 'chat' ? parseChat(out.text) : null;
  let { text } = out;
  // A chat whose first answer only asks for the person's text box or a screenshot is given back: the app asks again at
  // once with it, and one question costs one free request (the chat panel design, §3). Such an answer carries nothing
  // else: whatever text the AI put in it is dropped, so that a copy of the app that always says "step 1" gets no free
  // answers out of it.
  if (chat && body.step !== 2 && (chat.kind === 'box' || chat.kind === 'screen')) {
    await giveBack(who.uid, day, deps);
    chat = { kind: chat.kind, say: '', text: '', notes: [], doIt: false, send: false, remember: [] };
    text = JSON.stringify(chat);
  }
  return answer({
    text,
    model: out.model,
    ...(body.action === 'check' ? { check: parseCheck(text) } : {}),
    ...(chat ? { chat } : {}),
  });
}

function settingsView(cfg, hasKey) {
  return {
    config: cfg,
    providers: PROVIDER_IDS.map((id) => ({
      id, label: PROVIDERS[id].label, hasKey: hasKey(id), fallbackModels: PROVIDERS[id].fallbackModels,
    })),
  };
}

/** GET and PUT /api/admin/settings: the admin's switches, and which providers have a key on the server. */
async function adminSettings(req, deps) {
  allowMethods(req, 'GET', 'PUT');
  await signedInAdmin(req, deps);
  const hasKey = hasKeyIn(deps);
  const current = withDefaults(await deps.db.getConfig(), hasKey);
  if (req.method === 'GET') return answer(settingsView(current, hasKey));
  const next = applyPatch(current, req.body, hasKey);
  await deps.db.setConfig(next);
  return answer(settingsView(next, hasKey));
}

/** GET /api/admin/models?provider=: the models the server's key for that provider can use. */
async function adminModels(req, deps) {
  allowMethods(req, 'GET');
  await signedInAdmin(req, deps);
  const id = req.query?.provider;
  if (!PROVIDER_IDS.includes(id)) throw new BuddyError('bad_request', 'Unknown AI provider.');
  const { fallbackModels, label } = PROVIDERS[id];
  if (!hasKeyIn(deps)(id)) return answer({ models: fallbackModels, live: false });
  let live;
  try {
    live = await deps.providers.getProvider(id).listModels({
      apiKey: deps.adminKeys[id], fetchImpl: deps.fetchImpl, signal: AbortSignal.timeout(MODELS_TIMEOUT_MS),
    });
  } catch (err) {
    console.warn(`[models] ${id} failed: ${kindOf(err)}`);
    return answer({
      models: fallbackModels,
      live: false,
      warning: `Couldn't load the model list for the server's ${label} key. Showing the usual models.`,
    });
  }
  return live.length ? answer({ models: live, live: true }) : answer({ models: fallbackModels, live: false });
}

const iso = (date) => (date instanceof Date ? date.toISOString() : null);

function userView(user, today) {
  return {
    uid: user.uid,
    email: user.email,
    name: user.name,
    joined: iso(user.joined),
    lastActive: iso(user.lastActive),
    blocked: user.blocked === true,
    usedToday: user.usedDay === today ? user.usedCount : 0,
  };
}

/** GET /api/admin/users: everyone, busiest today first. POST { uid, blocked }: block or unblock one person. */
async function adminUsers(req, deps) {
  allowMethods(req, 'GET', 'POST');
  await signedInAdmin(req, deps);
  const today = dayKey(deps.now());
  if (req.method === 'GET') {
    const users = (await deps.db.listUsers({ limit: USERS_LIMIT })).map((u) => userView(u, today));
    const time = (text) => (text ? Date.parse(text) : 0);
    users.sort((a, b) => b.usedToday - a.usedToday || time(b.lastActive) - time(a.lastActive));
    return answer({ users });
  }
  const body = isPlainObject(req.body) ? req.body : {};
  if (typeof body.uid !== 'string' || !body.uid || body.uid.length > UID_MAX || typeof body.blocked !== 'boolean') {
    throw new BuddyError('bad_request', 'Pick a user to block or unblock.');
  }
  const user = await deps.db.setBlocked(body.uid, body.blocked);
  if (!user) throw new BuddyError('not_found', 'That user was not found.');
  return answer({ user: userView(user, today) });
}

/** Run a handler: a BuddyError becomes its status and { error: { code, message } }; anything else is a 500. */
async function handle(handler, req, deps) {
  try {
    return await handler(req, deps);
  } catch (err) {
    if (err instanceof BuddyError && Object.hasOwn(STATUS, err.code)) {
      return { status: STATUS[err.code], body: { error: { code: err.code, message: err.message } } };
    }
    console.error(`[api] failed: ${kindOf(err)}`);
    return { status: 500, body: { error: { code: 'server', message: "Buddy's server had a problem. Try again." } } };
  }
}

module.exports = { config, ask, adminSettings, adminModels, adminUsers, handle, kindOf, STATUS, ASK_TIMEOUT_MS };
