'use strict';

/**
 * Notifications on the person's phones (Web Push): the browsers' subscriptions, kept in Firestore as push/{uid} =
 * { subs: [{ endpoint, keys: { p256dh, auth }, at }] }, at most MAX_SUBS of them (the newest kept), and what a
 * notification says. Plain functions over the record, as in remote.js: a change answers { next, result }, where `next`
 * is the record to keep (null: delete it, undefined: leave it as it is) and `result` what the caller is told.
 *
 * A subscription's endpoint is the push service's address that the server posts each notification to. Only the push
 * services of Apple, Google, Mozilla and Microsoft are taken, so the server never posts to an address someone made up.
 */

const { BuddyError } = require('../shared/errors');

const MAX_SUBS = 5;
const ENDPOINT_MAX = 1000;
const KEY = /^[\w-]{8,200}={0,2}$/; // the browser's keys for the subscription, in base64url
const PUSH_HOSTS = [/(^|\.)push\.apple\.com$/, /^fcm\.googleapis\.com$/, /(^|\.)push\.services\.mozilla\.com$/, /(^|\.)notify\.windows\.com$/];
const NOT_A_SUBSCRIPTION = "Notifications couldn't be switched on. Try again.";
const SAYS = { done: 'Claude Code finished', waiting: 'Claude Code needs you' };

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** A push service's address, or null for anything else. */
function checkEndpoint(value) {
  if (typeof value !== 'string' || value.length > ENDPOINT_MAX) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  return url.protocol === 'https:' && PUSH_HOSTS.some((host) => host.test(url.hostname)) ? value : null;
}

const checkKeys = (keys) => isObject(keys) && KEY.test(keys.p256dh ?? '') && KEY.test(keys.auth ?? '');

/** A browser's subscription (PushSubscription.toJSON()), checked: { endpoint, keys: { p256dh, auth } }. */
function checkSubscription(value) {
  const endpoint = checkEndpoint(value?.endpoint);
  if (!isObject(value) || !endpoint || !checkKeys(value.keys)) throw new BuddyError('bad_request', NOT_A_SUBSCRIPTION);
  return { endpoint, keys: { p256dh: value.keys.p256dh, auth: value.keys.auth } };
}

/** The subscriptions in a record, as web-push sends to them; anything broken is left out. */
function subsOf(doc) {
  return (Array.isArray(doc?.subs) ? doc.subs : [])
    .filter((s) => isObject(s) && checkEndpoint(s.endpoint) && checkKeys(s.keys))
    .map((s) => ({ endpoint: s.endpoint, keys: { p256dh: s.keys.p256dh, auth: s.keys.auth }, at: Number.isFinite(s.at) ? s.at : 0 }));
}

/** A phone switched notifications on: its subscription is kept (in place of the same one), the newest MAX_SUBS. */
function addSub(doc, sub, now) {
  const others = subsOf(doc).filter((s) => s.endpoint !== sub.endpoint);
  return { next: { subs: [...others, { ...sub, at: now }].slice(-MAX_SUBS) }, result: { on: true } };
}

/** Subscriptions forgotten: switched off on the phone, or gone from the push service (404, 410). */
function removeEndpoints(doc, endpoints) {
  const subs = subsOf(doc);
  const left = subs.filter((s) => !endpoints.includes(s.endpoint));
  if (left.length === subs.length) return { next: undefined, result: { on: false } };
  return { next: left.length ? { subs: left } : null, result: { on: false } };
}

/** The notification for a session that stopped working (remote.justFinished): its name, and what happened. */
function message(session) {
  return { title: session.name, body: SAYS[session.status] || SAYS.done, session: session.id, tag: `claude-${session.id}` };
}

module.exports = { MAX_SUBS, ENDPOINT_MAX, checkSubscription, subsOf, addSub, removeEndpoints, message };
