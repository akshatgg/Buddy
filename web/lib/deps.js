'use strict';

/**
 * The handlers' real dependencies: Firebase (ID token checks and Firestore) through firebase-admin, the AI
 * providers, and the server's own keys. All from the Vercel environment:
 *
 *   FIREBASE_SERVICE_ACCOUNT    the service account's JSON key
 *   ADMIN_EMAIL                 who may use /api/admin/*
 *   ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, GROQ_API_KEY   any of them
 *
 * Made once per warm instance. firebase-admin is loaded only here, so the tests never need it.
 */

const { createFirestoreDb } = require('./firestore-db');

const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' };

/** The server's AI keys: { providerId: key } for each one that is set. */
function adminKeysFrom(env) {
  const keys = {};
  for (const [id, name] of Object.entries(KEY_ENV)) {
    const key = typeof env[name] === 'string' ? env[name].trim() : '';
    if (key) keys[id] = key;
  }
  return keys;
}

let deps = null;

function realDeps(env = process.env) {
  if (deps) return deps;
  if (!env.FIREBASE_SERVICE_ACCOUNT) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ credential: cert(JSON.parse(env.FIREBASE_SERVICE_ACCOUNT)) });
  const auth = getAuth(app);
  deps = {
    async verifyToken(idToken) {
      const t = await auth.verifyIdToken(idToken);
      return { uid: t.uid, email: t.email || '', emailVerified: t.email_verified === true, name: t.name || '' };
    },
    db: createFirestoreDb(getFirestore(app)),
    providers: require('../shared/providers'),
    adminKeys: adminKeysFrom(env),
    adminEmail: env.ADMIN_EMAIL || '',
    now: () => new Date(),
  };
  return deps;
}

module.exports = { realDeps, adminKeysFrom };
