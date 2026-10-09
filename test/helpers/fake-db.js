'use strict';

/**
 * An in-memory stand-in for web/lib/firestore-db.js: the same methods, the same answers. The real one is tested
 * against the Firestore emulator (test/firestore/firestore-db.test.js) with the same expectations.
 * `state.calls` records which methods were called, in order.
 */
function fakeDb({ config = null, users = {}, remotes = {}, pushes = {}, memories = {} } = {}) {
  const state = {
    config: structuredClone(config), users: structuredClone(users), remotes: structuredClone(remotes), pushes: structuredClone(pushes), memories: structuredClone(memories), calls: [],
  };
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
    async refundRequest({ uid, day, limit }) {
      state.calls.push('refundRequest');
      const user = state.users[uid];
      if (!user || user.usedDay !== day || !(user.usedCount > 0)) return { ok: false, reason: 'not_counted' };
      const given = user.refundDay === day && Number.isInteger(user.refundCount) ? user.refundCount : 0;
      if (given >= limit) return { ok: false, reason: 'limit', refundCount: given };
      Object.assign(user, { usedCount: user.usedCount - 1, refundDay: day, refundCount: given + 1 });
      return { ok: true, refundCount: given + 1 };
    },
    async listUsers({ limit }) {
      state.calls.push('listUsers');
      const time = (u) => (u.lastActive ? u.lastActive.getTime() : -1);
      return Object.keys(state.users).map(copy).sort((a, b) => time(b) - time(a)).slice(0, limit);
    },
    async updateRemote(uid, change) {
      state.calls.push('updateRemote');
      const { next, result } = change(Object.hasOwn(state.remotes, uid) ? structuredClone(state.remotes[uid]) : null);
      if (next === null) delete state.remotes[uid];
      else if (next !== undefined) state.remotes[uid] = structuredClone(next);
      return structuredClone(result);
    },
    async getPush(uid) {
      state.calls.push('getPush');
      return Object.hasOwn(state.pushes, uid) ? structuredClone(state.pushes[uid]) : null;
    },
    async updatePush(uid, change) {
      state.calls.push('updatePush');
      const { next, result } = change(Object.hasOwn(state.pushes, uid) ? structuredClone(state.pushes[uid]) : null);
      if (next === null) delete state.pushes[uid];
      else if (next !== undefined) state.pushes[uid] = structuredClone(next);
      return structuredClone(result);
    },
    async updateMemory(uid, change) {
      state.calls.push('updateMemory');
      const { next, result } = change(Object.hasOwn(state.memories, uid) ? structuredClone(state.memories[uid]) : null);
      if (next === null) delete state.memories[uid];
      else if (next !== undefined) state.memories[uid] = structuredClone(next);
      return structuredClone(result);
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
