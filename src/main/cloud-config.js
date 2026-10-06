'use strict';

/**
 * Where Buddy's server is, and what Google sign-in needs: cloud.json at the app's root. It is not in git
 * (cloud.example.json shows its shape); the build packs it into the app. Without it Buddy cannot sign in.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../shared/errors');

const FILE = path.join(__dirname, '..', '..', 'cloud.json');
const FIELDS = ['serverUrl', 'firebaseApiKey', 'googleClientId', 'googleClientSecret'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

/** The four values, or null when the file is missing, damaged or incomplete, or the server is not https. */
function loadCloudConfig(file = FILE) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!FIELDS.every((name) => typeof data[name] === 'string' && data[name].trim())) return null;
  let url;
  try {
    url = new URL(data.serverUrl.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && LOCAL_HOSTS.includes(url.hostname))) return null;
  return {
    serverUrl: url.origin,
    firebaseApiKey: data.firebaseApiKey.trim(),
    googleClientId: data.googleClientId.trim(),
    googleClientSecret: data.googleClientSecret.trim(),
  };
}

const notSetUp = () => new BuddyError('not_set_up', "This copy of Buddy isn't set up for sign-in.");

module.exports = { loadCloudConfig, notSetUp, FIELDS, FILE };
