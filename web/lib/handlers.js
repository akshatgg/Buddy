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
 *   fetchImpl                optional, for the providers and for Groq's Whisper (web/lib/transcribe.js)
 *   push                     { publicKey, send(subscription, payload) } for Web Push with the server's VAPID keys, or
 *                            null when they are not set (web/lib/deps.js); send rejects with the push service's
 *                            `statusCode` when it turns a notification down
 * }
 */

const { BuddyError } = require('../shared/errors');
const { buildPrompt, parseCheck, parseChat, MAX_TOKENS } = require('../shared/prompts');
const { PROVIDERS, PROVIDER_IDS } = require('../shared/providers');
const { dayKey } = require('./day');
const { withDefaults, isFreeOn, applyPatch } = require('./free-config');
const { transcribeWithGroq, readRecording } = require('./transcribe');
const remote = require('./remote');
const pushRules = require('./push');
const memorySync = require('../shared/memory-sync');

// The app gives up on an answer after 60 seconds; the server gives up on the AI before that, so the person hears
// "Buddy couldn't answer" and the request is given back.
const ASK_TIMEOUT_MS = 50_000;
const MODELS_TIMEOUT_MS = 15_000;
const NOTIFY_MS = 4_000; // the most a computer's report waits for its notifications (notifyInTime)
// At most this many requests a day are given back to a person (an AI that failed, or a chat's first step). Each one
// was still an AI call on the admin's key, so give-backs cannot be used to ask for free without end.
const GIVE_BACKS_PER_DAY = 10;
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
  voice_busy: 429, // Groq's limit for the server's key
  upstream: 502,
  mac_offline: 409, // Claude mode on the phone: the person's computer is not sharing its sessions
  server: 503, // the server could not check a sign-in (any other failure of its own is a 500, with the same code)
  voice_off: 503, // no Groq key on the server
  push_off: 503, // no VAPID keys on the server: notifications are not set up
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
    voiceOn: hasKey('groq'), // voice needs only the server's Groq key, whatever free mode is set to
    clawdLook: cfg.clawdLook, // where Clawd walks with the buddy while Claude Code works (the admin's choice)
    ...(deps.push ? { pushKey: deps.push.publicKey } : {}), // notifications on the phone (POST /api/push)
  });
}

/**
 * Give a counted request back, unless GIVE_BACKS_PER_DAY were given back today already. Past that, or when giving it
 * back fails too (only the kind of failure is logged), the request stays counted.
 */
async function giveBack(uid, day, deps) {
  try {
    await deps.db.refundRequest({ uid, day, limit: GIVE_BACKS_PER_DAY });
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
  // answers out of it. A first step is text only (buildPrompt refuses a box or a screenshot on it), and at most
  // GIVE_BACKS_PER_DAY are given back.
  if (chat && body.step !== 2 && (chat.kind === 'box' || chat.kind === 'screen')) {
    await giveBack(who.uid, day, deps);
    chat = { kind: chat.kind, say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false };
    text = JSON.stringify(chat);
  }
  return answer({
    text,
    model: out.model,
    ...(body.action === 'check' ? { check: parseCheck(text) } : {}),
    ...(chat ? { chat } : {}),
  });
}

/**
 * POST /api/transcribe { audio, mime }: what was said in a recording, written down by Whisper on Groq with the
 * server's Groq key. For anyone signed in and not blocked; it is not counted as a free request. Neither the recording
 * nor the words are kept or logged; a failure is logged by its kind only.
 */
async function transcribe(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const { audio, mime } = readRecording(isPlainObject(req.body) ? req.body : {}); // refused before anything is read
  if (!hasKeyIn(deps)('groq')) throw new BuddyError('voice_off', "Voice isn't set up yet.");
  const user = await deps.db.ensureUser({ uid: who.uid, email: who.email, name: who.name || '', now: deps.now() });
  if (user.blocked === true) throw new BuddyError('blocked', 'Your free access is paused.');
  let text;
  try {
    text = await transcribeWithGroq({ apiKey: deps.adminKeys.groq, audio, mime, fetchImpl: deps.fetchImpl });
  } catch (err) {
    console.warn(`[transcribe] groq failed: ${kindOf(err)}`);
    if (err?.code === 'rate_limited') {
      throw new BuddyError('voice_busy', 'Voice is busy right now. Type, or try again in a minute.');
    }
    throw new BuddyError('upstream', "I couldn't write down what you said. Try again.");
  }
  return answer({ text });
}

/**
 * Tell the person's phones that these sessions stopped working (remote.justFinished): one notification per session on
 * each phone that switched them on. A subscription the push service says is gone (404, 410) is forgotten. Nothing
 * here can fail the computer's report: a failure is logged by its kind, or the push service's status, only.
 */
async function notify(uid, finished, deps) {
  try {
    const subs = pushRules.subsOf(await deps.db.getPush(uid));
    const gone = new Set();
    await Promise.all(finished.flatMap((session) => subs.map(async (sub) => {
      try {
        await deps.push.send({ endpoint: sub.endpoint, keys: sub.keys }, JSON.stringify(pushRules.message(session)));
      } catch (err) {
        if (err?.statusCode === 404 || err?.statusCode === 410) gone.add(sub.endpoint);
        else console.warn(`[push] not sent: ${err?.statusCode || kindOf(err)}`);
      }
    })));
    if (gone.size) await deps.db.updatePush(uid, (doc) => pushRules.removeEndpoints(doc, [...gone]));
  } catch (err) {
    console.error(`[push] could not notify: ${kindOf(err)}`);
  }
}

/**
 * notify, but never for longer than NOTIFY_MS (deps.notifyMs in the tests): the computer's report waits for it, and
 * must not wait on a push service or Firestore that is slow. What is still going on then is left to finish, or not.
 */
async function notifyInTime(uid, finished, deps) {
  let timer;
  const late = new Promise((resolve) => {
    timer = setTimeout(() => resolve(true), deps.notifyMs ?? NOTIFY_MS);
  });
  const tooLong = await Promise.race([notify(uid, finished, deps).then(() => false), late]);
  clearTimeout(timer);
  if (tooLong) console.warn('[push] took too long');
}

/**
 * POST /api/remote/mac { device, sessions, feed?, done?, off? }: one of the person's computers shares its Claude Code
 * sessions (Claude mode from anywhere, web/lib/remote.js). Answers { watch, inbox }: its session being watched, and the
 * words sent to its sessions. A session that stopped working (done, or waiting for the person) is told to their phones
 * (notify). Nothing in it is logged.
 */
async function remoteMac(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  const now = deps.now().getTime();
  let finished = [];
  const result = await deps.db.updateRemote(who.uid, (doc) => {
    const out = remote.macReport(doc, body, now); // checks the report first
    finished = remote.justFinished(doc, body, now); // the transaction may run this again: the last run counts
    return out;
  });
  if (finished.length && deps.push) await notifyInTime(who.uid, finished, deps);
  return answer(result);
}

/**
 * The watcher's side of Claude mode (the phone, or another computer). GET /api/remote/phone?session=<id>&exclude=<its
 * own device id>: { online, sessions, feed } (looking at a session keeps it watched). POST { action: 'send', session, text }: the words wait for the computer, which types them
 * into that session's terminal. POST { action: 'stop' }: the phone stops watching, and the session's items go.
 */
async function remotePhone(req, deps) {
  allowMethods(req, 'GET', 'POST');
  const who = await signedIn(req, deps);
  const now = deps.now().getTime();
  if (req.method === 'GET') {
    const sessionId = remote.checkSessionId(req.query?.session);
    const exclude = remote.checkDeviceId(req.query?.exclude); // a computer watching: its own sessions are not listed
    return answer(await deps.db.updateRemote(who.uid, (doc) => remote.phoneLook(doc, sessionId, now, exclude)));
  }
  const body = isPlainObject(req.body) ? req.body : {};
  if (body.action === 'stop') return answer(await deps.db.updateRemote(who.uid, (doc) => remote.phoneStop(doc)));
  if (body.action !== 'send') throw new BuddyError('bad_request', 'Not a Claude mode request.');
  const sessionId = remote.checkSessionId(body.session, { required: true });
  const text = remote.checkText(body.text);
  const id = deps.newId ? deps.newId() : require('node:crypto').randomUUID();
  return answer(await deps.db.updateRemote(who.uid, (doc) => remote.phoneSend(doc, { sessionId, text, id }, now)));
}

/**
 * POST /api/push: notifications on the person's phone. { action: 'on', subscription } keeps the browser's subscription
 * (PushSubscription.toJSON()); { action: 'off', endpoint } forgets it. Answers { on }.
 */
async function pushRoute(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const body = isPlainObject(req.body) ? req.body : {};
  if (body.action === 'on') {
    if (!deps.push) throw new BuddyError('push_off', "Notifications aren't set up yet.");
    const sub = pushRules.checkSubscription(body.subscription);
    const now = deps.now().getTime();
    return answer(await deps.db.updatePush(who.uid, (doc) => pushRules.addSub(doc, sub, now)));
  }
  if (body.action === 'off') {
    if (typeof body.endpoint !== 'string' || !body.endpoint || body.endpoint.length > pushRules.ENDPOINT_MAX) {
      throw new BuddyError('bad_request', 'Not a notifications request.');
    }
    return answer(await deps.db.updatePush(who.uid, (doc) => pushRules.removeEndpoints(doc, [body.endpoint])));
  }
  throw new BuddyError('bad_request', 'Not a notifications request.');
}

/**
 * POST /api/memory { ops }: what Buddy knows about the person, the same on all their devices (shared/memory-sync.js).
 * The device's changes are applied to the account's facts, and the answer is { facts }, oldest first. No ops: just
 * the facts. For anyone signed in, blocked or not: these are their own facts, and not an AI request.
 */
async function memoryRoute(req, deps) {
  allowMethods(req, 'POST');
  const who = await signedIn(req, deps);
  const ops = memorySync.checkOps(isPlainObject(req.body) ? req.body.ops : undefined);
  return answer(await deps.db.updateMemory(who.uid, (doc) => memorySync.applyOps(doc, ops)));
}

function settingsView(cfg, hasKey) {
  return {
    config: cfg,
    providers: PROVIDER_IDS.map((id) => ({
      id, label: PROVIDERS[id].label, hasKey: hasKey(id), fallbackModels: PROVIDERS[id].fallbackModels,
    })),
    voiceOn: hasKey('groq'), // not a switch: the server's Groq key turns voice on
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

module.exports = { config, ask, transcribe, remoteMac, remotePhone, pushRoute, memoryRoute, adminSettings, adminModels, adminUsers, handle, kindOf, STATUS, ASK_TIMEOUT_MS };
