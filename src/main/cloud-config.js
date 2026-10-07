'use strict';

/**
 * Where Buddy's server is, and what Google sign-in needs: cloud.json at the app's root. It is not in git
 * (cloud.example.json shows its shape); the build packs it into the app and fails unless it is valid. Without a
 * valid one Buddy cannot sign in.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../shared/errors');

const FILE = path.join(__dirname, '..', '..', 'cloud.json');
const FIELDS = ['serverUrl', 'firebaseApiKey', 'googleClientId', 'googleClientSecret'];
const LOCAL_HOSTS = ['localhost', '127.0.0.1'];

// A real value is one word: an address, an API key, a client id and a secret have no whitespace inside them (around
// them is trimmed). The placeholders in cloud.example.json do, each carries a note in parentheses, so a copy that was
// not filled in is refused, and so is a real value with its note left after it.
const isOneWord = (value) => typeof value === 'string' && /^\S+$/.test(value.trim());

/**
 * The four values in cloud.json's text, or null when it is damaged or incomplete, a value is not one word (a
 * placeholder from cloud.example.json left in), or the server is not https. The build runs this on the cloud.json it
 * finds in the packed app (build/afterPack.js), so it fails there rather than shipping a Buddy that cannot sign in.
 */
function parseCloudConfig(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!data || typeof data !== 'object') return null;
  if (!FIELDS.every((name) => isOneWord(data[name]))) return null;
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

/** The four values, or null when the file is missing or unreadable, or what it holds is not valid (parseCloudConfig). */
function loadCloudConfig(file = FILE) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch {
    return null;
  }
  return parseCloudConfig(text);
}

const notSetUp = () => new BuddyError('not_set_up', "This copy of Buddy isn't set up for sign-in.");

module.exports = { loadCloudConfig, parseCloudConfig, notSetUp, FIELDS, FILE };
