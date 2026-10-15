'use strict';

/**
 * What Buddy says when "Prince" or "YouTube" is not one person or one app: the phone's contacts (a phone call) and the
 * apps on the phone or the Mac (opening one). The pick itself is hey-buddy's pickChat (shared/message-pick.js). The
 * Android app has a port of this (message/PickLines.kt), checked against the cases below (tools/sync-android-shared.js
 * writes them out).
 */

const { pickLine } = require('./message-pick');

/** The line for a pick among the phone's contacts, or null when it is one person. */
function contactLine(asked, pick) {
  if (pick.kind === 'none') return `I couldn't find ${asked} in your contacts.`;
  return pickLine(asked, pick);
}

/** The line for a pick among the apps on this `where` ('phone' or 'Mac'), or null when it is one app. */
function appLine(asked, pick, where) {
  if (pick.kind === 'one') return null;
  if (pick.kind === 'none') return `I couldn't find ${asked} on this ${where}.`;
  if (pick.kind === 'many') return `I found lots of apps called ${asked}. Tell me the full name.`;
  const names = pick.names.length === 2
    ? pick.names.join(' or ')
    : `${pick.names.slice(0, -1).join(', ')} or ${pick.names.at(-1)}`;
  return `Which one: ${names}?`;
}

// The cases the Kotlin port must answer the same way.
const LINE_CASES = [
  ['Prince', ['Prince Sharma'], 'phone'],
  ['Prince', ['Prince Sharma', 'Prince Kumar'], 'phone'],
  ['Zoya', ['Prince Sharma'], 'phone'],
  ['YouTube', ['YouTube', 'YouTube Music'], 'phone'],
  ['you', ['YouTube', 'YouTube Music'], 'phone'],
  ['you', ['YouTube', 'YouTube Music', 'YouTube Kids'], 'Mac'],
  ['YouTube', ['Safari'], 'Mac'],
  ['a', ['A b', 'A c', 'A d', 'A e', 'A f'], 'Mac'],
];

module.exports = { contactLine, appLine, LINE_CASES };
