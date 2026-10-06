'use strict';

/**
 * An in-memory stand-in for web/lib/firestore-db.js: the same methods, the same answers. The real one is tested
 * against the Firestore emulator (test/firestore/firestore-db.test.js) with the same expectations.
 * `state.calls` records which methods were called, in order.
 */
function fakeDb({ config = null, users = {} } = {}) {
  const state = { config: structuredClone(config), users: structuredClone(users), calls: [] };
  const copy = (uid) => ({ uid, ...structuredClone(state.users[uid]) });
  const fresh = ({ email, name, now }) => ({ email, name, joined: now, lastActive: null, blocked: false, usedDay: '', usedCount: 0 });

  return {
    state,
    async getConfig() {
      state.calls.push('getConfig');
      return structuredClone(state.config);
    },
    async setConfig(config) {
      state.calls.push('setConfig');
      state.config = structuredClone(config);
    },
    async ensureUser({ uid, email, name, now }) {
      state.calls.push('ensureUser');
      if (!state.users[uid]) state.users[uid] = fresh({ email, name, now });
      else Object.assign(state.users[uid], { email, name });
      return copy(uid);
    },
    async countRequest({ uid, email, name, day, now, limit }) {
      state.calls.push('countRequest');
      const user = state.users[uid] || fresh({ email, name, now });
      if (user.blocked) return { ok: false, reason: 'blocked' };
      const used = user.usedDay === day ? user.usedCount : 0;
      if (limit !== null && used >= limit) return { ok: false, reason: 'limit', usedCount: used };
      state.users[uid] = { ...user, email, name, usedDay: day, usedCount: used + 1, lastActive: now };
      return { ok: true, usedCount: used + 1 };
    },
    async refundRequest({ uid, day }) {
      state.calls.push('refundRequest');
      const user = state.users[uid];
      if (user && user.usedDay === day && user.usedCount > 0) user.usedCount -= 1;
    },
    async listUsers({ limit }) {
      state.calls.push('listUsers');
      const time = (u) => (u.lastActive ? u.lastActive.getTime() : -1);
      return Object.keys(state.users).map(copy).sort((a, b) => time(b) - time(a)).slice(0, limit);
    },
    async setBlocked(uid, blocked) {
      state.calls.push('setBlocked');
      if (!state.users[uid]) return null;
      state.users[uid].blocked = blocked;
      return copy(uid);
    },
  };
}

module.exports = { fakeDb };
