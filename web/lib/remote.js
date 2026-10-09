'use strict';

/**
 * Claude mode from anywhere: each of the person's computers shares the Claude Code sessions running on it, and any
 * other Buddy of theirs (their phone, another computer, signed in with the same Google account) watches one and sends
 * it words. They never meet: all talk to this server, which keeps one small record per person in Firestore
 * (remote/{uid}):
 *
 *   devices    { [deviceId]: { name, seenAt, sessions: [{ id, name, status, canTalk }] } }: each sharing computer, when
 *              it last reported (ms; online for ONLINE_MS after) and the sessions running on it
 *   watch      { sessionId, at } | null: the session being watched; it lapses WATCH_MS after the watcher's last look
 *   feed       { sessionId, device, name, status, canTalk, items, at } | null: its newest items, from its computer
 *   inbox      [{ id, sessionId, text, at }]: words for a session that its computer has not typed yet
 *
 * Only what is watched is kept, and only while it is watched: the feed goes when the watch lapses or the watcher
 * stops, a computer's entry goes when it turns sharing off (the whole record with the last one). The rules are plain
 * functions over the record (macReport, phoneLook, phoneSend, phoneStop): each answers { next, result }, where `next`
 * is the record to keep (null: delete it, undefined: leave it as it is) and `result` what the caller is told.
 */

const { BuddyError } = require('../shared/errors');

const ONLINE_MS = 45_000; // a computer reports every few seconds; this long without a report, it is offline
const FORGET_DEVICE_MS = 24 * 60 * 60_000; // a computer not seen for a day leaves the record
const WATCH_MS = 30_000; // the phone looks every second or two while it watches
// A notification leaves out only a session looked at just now. A look rewrites watch.at once it is WATCH_MS / 3 (10 s)
// old and the phone looks every 2 s, so a phone still looking keeps it under about 12 s; 15 s leaves room for a slow
// look. Shorter than WATCH_MS: a look still on its way when the phone locked can set the watch again after its stop.
const NOTIFY_WATCH_MS = 15_000;
const SEEN_EVERY_MS = 20_000; // a report that changes nothing is written this often, so the phone knows the Mac is on
const INBOX_MAX = 20;
const INBOX_KEEP_MS = 10 * 60_000; // words the Mac never picked up are dropped after this
const SESSIONS_MAX = 20;
const ITEMS_MAX = 200;
const ITEM_CHARS = 4000;
const FEED_CHARS = 400_000; // all the items' text together: well under Firestore's 1 MiB for a document
const TEXT_MAX = 4000;
const STATUSES = ['working', 'waiting', 'done', 'failed', 'idle'];
const KINDS = ['you', 'claude', 'tool', 'result', 'event'];
const SESSION_ID = /^[\w-]{1,100}$/;
const DEVICE_ID = /^[\w-]{8,64}$/;

const OFFLINE = "None of your computers is sharing right now. Keep Buddy open on one, with Settings → Claude Code → Show my sessions on my other devices on.";
const NO_SESSION = 'That session is not running any more. Pick another one.';

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const cut = (text, max) => (text.length > max ? `${text.slice(0, max)}…` : text);

/** The sessions as the Mac sent them, cleaned: at most SESSIONS_MAX, each with known fields only. */
function cleanSessions(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((s) => isObject(s) && typeof s.id === 'string' && SESSION_ID.test(s.id)).slice(0, SESSIONS_MAX).map((s) => ({
    id: s.id,
    name: typeof s.name === 'string' && s.name.trim() ? cut(s.name.trim(), 100) : 'Claude Code',
    status: STATUSES.includes(s.status) ? s.status : 'idle',
    canTalk: s.canTalk === true,
  }));
}

/** The watched session's items as the Mac sent them, cleaned and cut: the newest ITEMS_MAX, within FEED_CHARS. */
function cleanItems(value) {
  if (!Array.isArray(value)) return [];
  const items = value.filter((i) => isObject(i) && Number.isInteger(i.id) && KINDS.includes(i.kind) && typeof i.text === 'string')
    .slice(-ITEMS_MAX)
    .map((i) => ({ id: i.id, kind: i.kind, text: cut(i.text, ITEM_CHARS), ...(i.error === true ? { error: true } : {}) }));
  let total = 0;
  let from = items.length;
  while (from > 0 && total + items[from - 1].text.length <= FEED_CHARS) {
    from -= 1;
    total += items[from].text.length;
  }
  return items.slice(from);
}

const watching = (doc, now, within = WATCH_MS) => (doc?.watch && now - doc.watch.at < within ? doc.watch.sessionId : null);
const devicesOf = (doc) => (isObject(doc?.devices) ? doc.devices : {});
/** The computers online now, as [id, entry], but `exclude` (the watcher's own computer: its sessions are its own). */
const onlineDevices = (doc, now, exclude = null) => Object.entries(devicesOf(doc)).filter(([id, d]) => id !== exclude && now - d.seenAt < ONLINE_MS);
/** The online computer a session runs on, as [id, entry], or undefined. */
const ownerOf = (doc, sessionId, now) => onlineDevices(doc, now).find(([, d]) => d.sessions.some((s) => s.id === sessionId));

/** The computer a report comes from: { id, name }, checked. */
function checkDevice(value) {
  if (!isObject(value) || typeof value.id !== 'string' || !DEVICE_ID.test(value.id)) throw new BuddyError('bad_request', 'Not a Claude mode report.');
  const name = typeof value.name === 'string' && value.name.trim() ? cut(value.name.trim(), 60) : 'Computer';
  return { id: value.id, name };
}

/**
 * A computer's report: { device: { id, name }, sessions, feed?, done?, off? }. `feed` is the watched session's view,
 * sent when it changed; `done` the ids of inbox words it has typed (or given up on). Answers the session of its own
 * that is watched, if any, and the words waiting for its sessions.
 */
function macReport(doc, body, now) {
  const device = checkDevice(body.device);
  const devices = Object.fromEntries(Object.entries(devicesOf(doc)).filter(([id, d]) => id !== device.id && now - d.seenAt < FORGET_DEVICE_MS));
  const before = doc ?? { devices: {}, watch: null, feed: null, inbox: [] };
  if (body.off === true) {
    if (!doc || !devicesOf(doc)[device.id]) return { next: undefined, result: { watch: null, inbox: [] } };
    if (!Object.keys(devices).length) return { next: null, result: { watch: null, inbox: [] } };
    const gone = (sessionId) => devicesOf(doc)[device.id].sessions.some((s) => s.id === sessionId);
    const watch = before.watch && !gone(before.watch.sessionId) ? before.watch : null;
    const inbox = (before.inbox || []).filter((m) => !gone(m.sessionId));
    return { next: { ...before, devices, watch, feed: watch ? before.feed : null, inbox }, result: { watch: null, inbox: [] } };
  }
  const mine = devicesOf(doc)[device.id];
  const sessions = cleanSessions(body.sessions);
  const owns = (sessionId) => sessions.some((s) => s.id === sessionId);
  const done = new Set(Array.isArray(body.done) ? body.done.filter((id) => typeof id === 'string') : []);
  const inbox = (before.inbox || []).filter((m) => !done.has(m.id) && now - m.at < INBOX_KEEP_MS);
  const watch = watching(before, now);
  const myWatch = watch && owns(watch) ? watch : null;
  let feed = watch && before.feed?.sessionId === watch ? before.feed : null;
  const sent = isObject(body.feed) ? body.feed : null;
  if (myWatch && sent && sent.id === myWatch) {
    const [view] = cleanSessions([sent]);
    feed = { sessionId: myWatch, device: device.name, name: view.name, status: view.status, canTalk: view.canTalk, items: cleanItems(sent.items), at: now };
  }
  const changed = !mine
    || mine.name !== device.name
    || JSON.stringify(sessions) !== JSON.stringify(mine.sessions)
    || now - mine.seenAt >= SEEN_EVERY_MS
    || Object.keys(devices).length !== Object.keys(devicesOf(doc)).length - 1
    || inbox.length !== (before.inbox || []).length
    || feed !== before.feed
    || (!watch && before.watch);
  const next = changed
    ? { devices: { ...devices, [device.id]: { name: device.name, seenAt: now, sessions } }, watch: watch ? before.watch : null, feed, inbox }
    : undefined;
  const words = inbox.filter((m) => owns(m.sessionId)).map(({ id, sessionId, text }) => ({ id, sessionId, text }));
  return { next, result: { watch: myWatch, inbox: words } };
}

/**
 * A watcher looks: whether any of the person's computers shares, the sessions running on them (each with its
 * computer's name, `device`), and with `sessionId` that session's items (once its computer has sent them: `feed` is
 * null until then). Looking at a session is what keeps it watched. `exclude` is the watcher's own computer, if it is
 * one: its own sessions are not listed.
 */
function phoneLook(doc, sessionId, now, exclude = null) {
  const devices = onlineDevices(doc, now, exclude);
  const sessions = devices.flatMap(([, d]) => d.sessions.map((s) => ({ ...s, device: d.name })));
  const result = { online: devices.length > 0, sessions, feed: null };
  if (!devices.length || sessionId === null) return { next: undefined, result };
  if (!sessions.some((s) => s.id === sessionId)) throw new BuddyError('not_found', NO_SESSION);
  if (doc.feed?.sessionId === sessionId) {
    const { sessionId: id, device, name, status, canTalk, items } = doc.feed;
    result.feed = { id, device, name, status, canTalk, items };
  }
  const fresh = doc.watch?.sessionId === sessionId && now - doc.watch.at < WATCH_MS / 3;
  const next = fresh ? undefined : { ...doc, watch: { sessionId, at: now }, feed: doc.feed?.sessionId === sessionId ? doc.feed : null };
  return { next, result };
}

/** A watcher sends words to a session: they wait in the inbox for its computer, which types them into its terminal. */
function phoneSend(doc, { sessionId, text, id }, now) {
  if (!onlineDevices(doc, now).length) throw new BuddyError('mac_offline', OFFLINE);
  if (!ownerOf(doc, sessionId, now)) throw new BuddyError('not_found', NO_SESSION);
  const inbox = [...(doc.inbox || []), { id, sessionId, text, at: now }].slice(-INBOX_MAX);
  return { next: { ...doc, inbox, watch: { sessionId, at: now } }, result: { sent: true } };
}

/** The watcher stops: the session's items are dropped from the record at once. */
function phoneStop(doc) {
  if (!doc || (!doc.watch && !doc.feed)) return { next: undefined, result: {} };
  return { next: { ...doc, watch: null, feed: null }, result: {} };
}

/**
 * The sessions of a computer's report that just stopped working: working in its last report, done or waiting in this
 * one. Each is { id, name, status }, for a notification on the person's phones (web/lib/push.js). The session a watcher
 * is looking at right now (within NOTIFY_WATCH_MS) is left out: the person sees it already. A computer's first report,
 * one turning sharing off, or one back after it was offline (its last report older than ONLINE_MS: that news is old)
 * has none.
 */
function justFinished(doc, body, now) {
  if (body.off === true) return [];
  const before = devicesOf(doc)[checkDevice(body.device).id];
  if (!before || !(now - before.seenAt < ONLINE_MS)) return [];
  const watched = watching(doc, now, NOTIFY_WATCH_MS);
  const wasWorking = (id) => before.sessions.some((s) => s.id === id && s.status === 'working');
  return cleanSessions(body.sessions)
    .filter((s) => (s.status === 'done' || s.status === 'waiting') && s.id !== watched && wasWorking(s.id))
    .map(({ id, name, status }) => ({ id, name, status }));
}

/** A device id from a request (the watcher's own computer, to leave out), or null for none. */
function checkDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID.test(value) ? value : null;
}

/** The words the phone sends, checked: one line of text, not empty, at most TEXT_MAX characters. */
function checkText(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new BuddyError('bad_request', 'Type something first.');
  if (text.length > TEXT_MAX) throw new BuddyError('bad_request', `That is too long (over ${TEXT_MAX} characters).`);
  return text;
}

/** A session id from a request, or null for none; anything that cannot be one is refused. */
function checkSessionId(value, { required = false } = {}) {
  if ((value === undefined || value === null || value === '') && !required) return null;
  if (typeof value !== 'string' || !SESSION_ID.test(value)) throw new BuddyError('bad_request', 'Pick a session.');
  return value;
}

module.exports = {
  ONLINE_MS, WATCH_MS, NOTIFY_WATCH_MS, SEEN_EVERY_MS, INBOX_MAX, INBOX_KEEP_MS, ITEMS_MAX, ITEM_CHARS, FEED_CHARS, TEXT_MAX, OFFLINE, NO_SESSION,
  cleanSessions, cleanItems, macReport, justFinished, phoneLook, phoneSend, phoneStop, checkText, checkSessionId, checkDeviceId,
};
