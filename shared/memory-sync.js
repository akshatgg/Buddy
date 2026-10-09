'use strict';

/**
 * What Buddy knows about the person, kept with their account, so that every device they sign in to with the same
 * Google account knows the same facts. Each device keeps its own copy (the Mac's and Windows' settings file, the
 * phones' storage) and a list of what changed on it that the server has not taken yet, its "outbox". Syncing sends
 * the outbox, the server applies it to the account's facts, and the device keeps what the server answers, with
 * anything it changed meanwhile applied again on top.
 *
 * A change ("op") is one of:
 *
 *   { op: 'add', id, text, at }   a fact learnt or typed in; `id` is made on the device, so that it can be forgotten
 *                                 before the server has it
 *   { op: 'forget', id }          one fact forgotten
 *   { op: 'clear' }               "Forget everything"
 *
 * On the server, the account's record is memory/{uid} = { facts: [{ id, text, at }] oldest first, gone: [id] }. `gone`
 * holds the ids forgotten lately, so that a device that comes back later with the same fact in its outbox does not add
 * it again. The server keeps to the same rules as each device (memory-rules.js): a secret is never kept, a fact known
 * already is not kept twice, and over MAX_FACTS the oldest goes.
 *
 * The first time a device syncs with an account, it sends all its facts as adds, so that what it knew before is kept
 * as well. These are plain functions over the record, as in web/lib/remote.js.
 */

const { BuddyError } = require('./errors');
const { cleanFact, MAX_FACTS } = require('./memory-rules');

const MAX_OPS = 100; // the most one sync sends; a device keeps no more than this in its outbox
const MAX_GONE = 300;
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const NOT_OPS = "Buddy couldn't save what it knows about you. Try again.";

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';

/** The facts in a record, oldest first; anything broken is left out. */
function factsOf(doc) {
  return (Array.isArray(doc?.facts) ? doc.facts : [])
    .filter((f) => isObject(f) && typeof f.id === 'string' && ID.test(f.id) && typeof f.text === 'string' && f.text)
    .map((f) => ({ id: f.id, text: f.text, at: Number.isFinite(f.at) ? f.at : 0 }));
}

const goneOf = (doc) => (Array.isArray(doc?.gone) ? doc.gone.filter((id) => typeof id === 'string' && ID.test(id)) : []);

/** One change as sent, checked: the op, or null for one that is not right. */
function readOp(value) {
  if (!isObject(value)) return null;
  if (value.op === 'clear') return { op: 'clear' };
  if (typeof value.id !== 'string' || !ID.test(value.id)) return null;
  if (value.op === 'forget') return { op: 'forget', id: value.id };
  if (value.op === 'add' && typeof value.text === 'string') {
    return { op: 'add', id: value.id, text: value.text, at: Number.isFinite(value.at) ? value.at : 0 };
  }
  return null;
}

/** The changes a device sent: refused when they are not a list of at most MAX_OPS; a single broken one is skipped. */
function checkOps(value) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_OPS) throw new BuddyError('bad_request', NOT_OPS);
  return value.map(readOp).filter(Boolean);
}

/**
 * The record with `ops` applied, in order: { next, result: { facts } }. `next` is undefined when nothing changed (the
 * record is not written). A device applies its own outbox on top of the server's facts with this too.
 */
function applyOps(doc, ops) {
  let facts = factsOf(doc);
  let gone = goneOf(doc);
  let changed = false;
  for (const op of ops) {
    if (op.op === 'add') {
      const text = cleanFact(op.text);
      if (!text || gone.includes(op.id)) continue;
      if (facts.some((f) => f.id === op.id || f.text.toLowerCase() === text.toLowerCase())) continue;
      facts = [...facts, { id: op.id, text, at: op.at }].slice(-MAX_FACTS);
      changed = true;
    } else if (op.op === 'forget') {
      if (!gone.includes(op.id)) gone = [...gone, op.id].slice(-MAX_GONE);
      facts = facts.filter((f) => f.id !== op.id);
      changed = true;
    } else if (op.op === 'clear' && facts.length) {
      gone = [...gone, ...facts.map((f) => f.id)].slice(-MAX_GONE);
      facts = [];
      changed = true;
    }
  }
  return { next: changed ? { facts, gone } : undefined, result: { facts } };
}

/**
 * A device's outbox with one more change. "Forget everything" makes what came before it moot; past MAX_OPS, the
 * oldest goes.
 */
function addToOutbox(outbox, op) {
  const kept = Array.isArray(outbox) ? outbox.map(readOp).filter(Boolean) : [];
  return (op.op === 'clear' ? [op] : [...kept, op]).slice(-MAX_OPS);
}

/**
 * What a device sends when it syncs, for the account `uid`: { ops, sent }. `linked` is the account its facts already
 * belong to (null: none yet), `facts` its facts and `outbox` its changes. `sent` is how many of the outbox's changes
 * the answer covers: the device takes those out of its outbox once the server has answered.
 *
 *   - the same account: the outbox
 *   - no account yet: all its facts, as adds, so that they join the account's
 *   - another account (someone else signed in): nothing; the device takes that account's facts in place of its own
 */
function opsToSend({ uid, linked, facts, outbox }) {
  const kept = Array.isArray(outbox) ? outbox.map(readOp).filter(Boolean) : [];
  if (linked === uid) return { ops: kept.slice(0, MAX_OPS), sent: Math.min(kept.length, MAX_OPS) };
  if (linked) return { ops: [], sent: kept.length };
  const adds = (facts || []).map((f) => ({ op: 'add', id: f.id, text: f.text, at: f.at })).map(readOp).filter(Boolean);
  return { ops: adds.slice(-MAX_OPS), sent: kept.length };
}

/** What a device keeps after the server answered `facts`: those, with the changes it made meanwhile (`rest`) on top. */
const afterSync = (facts, rest) => applyOps({ facts }, (rest || []).map(readOp).filter(Boolean)).result.facts;

module.exports = { MAX_OPS, MAX_GONE, checkOps, applyOps, addToOutbox, opsToSend, afterSync, factsOf };
