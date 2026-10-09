'use strict';

/**
 * Buddy's data in Cloud Firestore, behind the methods the handlers use (web/lib/handlers.js). `firestore` is a
 * Firestore instance from firebase-admin. Dates go in as JS Dates (Firestore keeps them as timestamps) and come
 * back out as JS Dates.
 *
 *   config/free     the admin's switches
 *   users/{uid}     email, name, joined, lastActive, blocked, usedDay, usedCount, and once a request was given back,
 *                   refundDay, refundCount
 *   remote/{uid}    Claude mode on the phone: the sessions the person's computer shares (web/lib/remote.js)
 *   push/{uid}      the person's phones that get notifications: their Web Push subscriptions (web/lib/push.js)
 *   memory/{uid}    what Buddy knows about the person, for all their devices (shared/memory-sync.js)
 */

/**
 * Whether Firestore can have a document with this id. A uid from Firebase Auth always can; one typed into a request
 * may not: it must not be empty or hold a "/" (a leading or trailing one would be read as the person without it), be
 * "." or "..", look like "__x__" (reserved), or be broken text such as a lone surrogate. The handler already keeps a
 * uid to 128 characters, far below Firestore's limit of 1500 bytes.
 */
const isUsableId = (uid) => typeof uid === 'string' && uid !== '' && !uid.includes('/') && uid !== '.' && uid !== '..' &&
  !/^__.*__$/.test(uid) && uid.isWellFormed();

function createFirestoreDb(firestore) {
  const configDoc = firestore.collection('config').doc('free');
  const users = firestore.collection('users');
  const remotes = firestore.collection('remote');
  const pushes = firestore.collection('push');
  const memories = firestore.collection('memory');

  const toDate = (value) => (value && typeof value.toDate === 'function' ? value.toDate() : null);
  const fresh = ({ email, name, now }) => ({ email, name, joined: now, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });

  /**
   * A record changed in a transaction: `change(doc)` is given the record (null when there is none) and answers
   * { next, result }; `next` is written (null deletes it, undefined leaves it). Answers `result`.
   */
  function update(ref, change) {
    return firestore.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const { next, result } = change(snap.exists ? snap.data() : null);
      if (next === null) tx.delete(ref);
      else if (next !== undefined) tx.set(ref, next);
      return result;
    });
  }

  function fromData(uid, d) {
    return {
      uid,
      email: typeof d.email === 'string' ? d.email : '',
      name: typeof d.name === 'string' ? d.name : '',
      joined: toDate(d.joined),
      lastActive: toDate(d.lastActive),
      blocked: d.blocked === true,
      usedDay: typeof d.usedDay === 'string' ? d.usedDay : '',
      usedCount: Number.isInteger(d.usedCount) ? d.usedCount : 0,
    };
  }

  return {
    async getConfig() {
      const snap = await configDoc.get();
      return snap.exists ? snap.data() : null;
    },

    async setConfig(config) {
      await configDoc.set(config);
    },

    /** The person, added on their first call; their email and name follow their Google account. */
    async ensureUser({ uid, email, name, now }) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) {
          const doc = fresh({ email, name, now });
          tx.set(ref, doc);
          return { uid, ...doc };
        }
        const d = snap.data();
        if (d.email !== email || d.name !== name) tx.update(ref, { email, name });
        return { ...fromData(uid, d), email, name };
      });
    },

    /**
     * Count one free request on `day`, in a transaction, so that requests made at the same moment cannot slip past
     * the limit. `limit` is null for unlimited.
     */
    async countRequest({ uid, email, name, day, now, limit }) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const d = snap.exists ? snap.data() : fresh({ email, name, now });
        if (d.blocked === true) return { ok: false, reason: 'blocked' };
        const used = d.usedDay === day && Number.isInteger(d.usedCount) ? d.usedCount : 0;
        if (limit !== null && used >= limit) return { ok: false, reason: 'limit', usedCount: used };
        const change = { email, name, usedDay: day, usedCount: used + 1, lastActive: now };
        if (snap.exists) tx.update(ref, change);
        else tx.set(ref, { ...d, ...change });
        return { ok: true, usedCount: used + 1 };
      });
    },

    /**
     * Give back a request, if it still counts towards `day`: at most `limit` a day, counted in the same transaction,
     * so that give-backs asked for at the same moment cannot slip past the limit either. Past it, the request stays
     * counted.
     */
    async refundRequest({ uid, day, limit }) {
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return { ok: false, reason: 'not_counted' };
        const d = snap.data();
        if (d.usedDay !== day || !Number.isInteger(d.usedCount) || d.usedCount < 1) return { ok: false, reason: 'not_counted' };
        const given = d.refundDay === day && Number.isInteger(d.refundCount) ? d.refundCount : 0;
        if (given >= limit) return { ok: false, reason: 'limit', refundCount: given };
        tx.update(ref, { usedCount: d.usedCount - 1, refundDay: day, refundCount: given + 1 });
        return { ok: true, refundCount: given + 1 };
      });
    },

    /** Up to `limit` people, the most recently active first (those who never asked anything last). */
    async listUsers({ limit }) {
      const snap = await users.orderBy('lastActive', 'desc').limit(limit).get();
      return snap.docs.map((doc) => fromData(doc.id, doc.data()));
    },

    /** Claude mode's record of a person (remote/{uid}), changed in a transaction (update). */
    async updateRemote(uid, change) {
      return update(remotes.doc(uid), change);
    },

    /** The person's notifications record (push/{uid}), or null. */
    async getPush(uid) {
      const snap = await pushes.doc(uid).get();
      return snap.exists ? snap.data() : null;
    },

    /** The person's notifications record, changed in a transaction (update). */
    async updatePush(uid, change) {
      return update(pushes.doc(uid), change);
    },

    /** What Buddy knows about the person (memory/{uid}), changed in a transaction (update). */
    async updateMemory(uid, change) {
      return update(memories.doc(uid), change);
    },

    /** Block or unblock a person; null when there is nobody with that uid, or no uid that Firestore could have. */
    async setBlocked(uid, blocked) {
      // Asked of a uid that cannot exist, users.doc() throws or Firestore refuses: a 500 for what is a "not found".
      if (!isUsableId(uid)) return null;
      const ref = users.doc(uid);
      return firestore.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        if (!snap.exists) return null;
        tx.update(ref, { blocked });
        return { ...fromData(uid, snap.data()), blocked };
      });
    },
  };
}

module.exports = { createFirestoreDb };
