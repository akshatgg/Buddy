'use strict';

/**
 * What Buddy may remember about a person: short facts such as "Your boss is Mr. Sharma.", which the AI picks up from
 * a chat or the person types into Settings → Memory. They live in shared/ so that the app, the server and the phone
 * apps keep to the same rules.
 *
 * A secret is never kept, whatever else the fact says: one that names a password, passcode, PIN, OTP or CVV, or that
 * holds a long number (a card, a bank account, an Aadhaar or other ID number).
 */

const MAX_FACTS = 50;
const MAX_FACT_CHARS = 200;

// Whole words in any case, and their plurals: "PIN" and "PINs", but not "spinach" or "Pinterest".
const SECRET_WORDS = /\b(?:password|passcode|pin|otp|cvv)s?\b/i;
// 12 or more digits in a row once spaces, dots and dashes are taken out: "4111 1111 1111 1111" or "1234-5678-9012".
// A 10-digit phone number is kept.
const LONG_NUMBER = /\d{12,}/;
const NUMBER_GAPS = /[\s.\-‐‑‒–—]/g;

/** The fact trimmed and on one line, or null when it is empty, too long, or a secret. */
function cleanFact(text) {
  if (typeof text !== 'string') return null;
  const fact = text.replace(/\s+/g, ' ').trim();
  if (!fact || fact.length > MAX_FACT_CHARS) return null;
  if (SECRET_WORDS.test(fact) || LONG_NUMBER.test(fact.replace(NUMBER_GAPS, ''))) return null;
  return fact;
}

module.exports = { cleanFact, MAX_FACTS, MAX_FACT_CHARS };
