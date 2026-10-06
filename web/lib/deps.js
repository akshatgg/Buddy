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
 *
 * A service account key that is missing or broken stops the server with an error that has a `code`
 * (no_service_account, bad_service_account) and a fixed message, never the value: the messages of JSON.parse and of
 * firebase-admin can quote it, private key included. The log carries the code only (web/lib/vercel.js).
 */

const { createFirestoreDb } = require('./firestore-db');

const KEY_ENV = { anthropic: 'ANTHROPIC_API_KEY', openai: 'OPENAI_API_KEY', gemini: 'GEMINI_API_KEY', groq: 'GROQ_API_KEY' };

const isPlainObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const startupError = (code, message) => Object.assign(new Error(message), { code });
const notSet = () => startupError('no_service_account', 'FIREBASE_SERVICE_ACCOUNT is not set');
const notAKey = () => startupError('bad_service_account', 'FIREBASE_SERVICE_ACCOUNT is not a service account key');

/** The server's AI keys: { providerId: key } for each one that is set. */
function adminKeysFrom(env) {
  const keys = {};
  for (const [id, name] of Object.entries(KEY_ENV)) {
    const key = typeof env[name] === 'string' ? env[name].trim() : '';
    if (key) keys[id] = key;
  }
  return keys;
}

/**
 * The service account key from the environment: parsed, and checked for the two fields every key has. This happens
 * before firebase-admin is loaded, so a value that is not a key never reaches it (given a string, its cert() takes it
 * for a file name and quotes it in its error).
 */
function serviceAccountFrom(env) {
  const raw = env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw notSet();
  let key;
  try {
    key = JSON.parse(raw);
  } catch {
    throw notAKey();
  }
  if (!isPlainObject(key) || typeof key.client_email !== 'string' || typeof key.private_key !== 'string') throw notAKey();
  return key;
}

/** firebase-admin's credential for `key` (`cert` is its function). Whatever cert() throws becomes the same plain error. */
function credentialFrom(cert, key) {
  try {
    return cert(key);
  } catch {
    throw notAKey();
  }
}

let deps = null;

function realDeps(env = process.env) {
  if (deps) return deps;
  const key = serviceAccountFrom(env);
  const { initializeApp, cert, getApps } = require('firebase-admin/app');
  const { getAuth } = require('firebase-admin/auth');
  const { getFirestore } = require('firebase-admin/firestore');
  const app = getApps()[0] || initializeApp({ credential: credentialFrom(cert, key) });
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

module.exports = { realDeps, adminKeysFrom, credentialFrom };
