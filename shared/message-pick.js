'use strict';

/**
 * Who "Priya" is, among the names Buddy found (the phone's WhatsApp contacts, or WhatsApp's search on the Mac): one
 * person, a few to choose from, nobody, or too many. Every word they said must start a word of the name, ignoring
 * case, accents, extra spaces and the invisible left-to-right mark WhatsApp puts before names. A name that is exactly
 * what they said wins over the others. The Android app has a port of this (message/Pick.kt), checked against the cases
 * below (tools/sync-android-shared.js writes them out).
 */

const MAX_CHOICES = 4;

/** Lower case, no accents, no marks, single spaces. */
function plain(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ‎‏‪-‮]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Whether two names are the same name. */
function sameName(a, b) {
  return plain(a) !== '' && plain(a) === plain(b);
}

function pickChat(asked, names) {
  const words = plain(asked).split(' ').filter(Boolean);
  if (!words.length) return { kind: 'none' };
  const seen = new Set();
  const found = [];
  for (const name of names) {
    const key = plain(name);
    if (seen.has(key)) continue;
    const parts = key.split(' ');
    if (words.every((w) => parts.some((p) => p.startsWith(w)))) {
      seen.add(key);
      found.push(name);
    }
  }
  const exact = found.filter((name) => sameName(name, asked));
  if (exact.length === 1) return { kind: 'one', name: exact[0] };
  if (found.length === 1) return { kind: 'one', name: found[0] };
  if (found.length === 0) return { kind: 'none' };
  if (found.length > MAX_CHOICES) return { kind: 'many' };
  return { kind: 'choose', names: found };
}

/** What Buddy says for a pick, or null when there is one person. */
function pickLine(asked, pick) {
  if (pick.kind === 'one') return null;
  if (pick.kind === 'none') return `I couldn't find ${asked} on WhatsApp.`;
  if (pick.kind === 'many') return `I found lots of people called ${asked}. Tell me the full name.`;
  const names = pick.names.length === 2
    ? pick.names.join(' or ')
    : `${pick.names.slice(0, -1).join(', ')} or ${pick.names.at(-1)}`;
  return `Which ${asked}: ${names}? Tell me the full name.`;
}

// The cases the Kotlin port must answer the same way.
const PICK_CASES = [
  ['Priya', ['Rahul Verma', 'Priya Sharma', 'Coorg trip']],
  ['  priyá  ', ['‎Priya Sharma']],
  ['Priya Sharma', ['Priya Sharma', 'Priya Sharma Office']],
  ['mummy', ['Mummy Office', 'Mummy']],
  ['Priya', ['Priya Sharma', 'Priya Verma']],
  ['Priya', ['Priya Sharma', 'Priya Verma', 'Priya K']],
  ['Priya Ver', ['Priya Sharma', 'Priya Verma']],
  ['riya', ['Priya Sharma']],
  ['Priya', ['Priya Sharma', 'Priya Sharma']],
  ['Zoya', ['Priya Sharma']],
  ['a', ['A b', 'A c', 'A d', 'A e', 'A f']],
  ['', ['Priya']],
];

module.exports = { pickChat, pickLine, sameName, PICK_CASES };
