'use strict';

/**
 * What Buddy may remember about a person: short facts such as "Your boss is Mr. Sharma.", which the AI picks up from
 * a chat or the person types into Settings → Memory. They live in shared/ so that the app, the server and the phone
 * apps keep to the same rules.
 *
 * A secret is never kept, whatever else the fact says: one that names a password, passcode, PIN, OTP or CVV, or that
 * holds a long number (a card, a bank account, an Aadhaar or other ID number). A "PIN code" is kept only when it is
 * plainly the postal code in India.
 */

const MAX_FACTS = 50;
const MAX_FACT_CHARS = 200;

// Whole words in any case, and their plurals: "PIN" and "PINs", but not "spinach" or "Pinterest". A "PIN code" is not
// one of them: it may be the postal code (see isPostalCode).
const SECRET_WORDS = /\b(?:password|passcode|otp|cvv)s?\b|\bpins?\b(?!\s*-?\s*codes?\b)/i;
// "PIN code", "pin-code" or "pincode", in any case.
const PIN_CODE = /\bpins?\s*-?\s*codes?\b/i;
// Whole words that make a PIN code a card's or an account's, whatever the number: "ATM PIN code", "UPI pin code".
const MONEY_WORDS = /\b(?:cards?|atms?|debit|credit|bank(?:s|ing)?|net-?banking|upi)\b/i;
// A number, with single spaces, dots or dashes between its digits ("110 001"); and the postal code in India, six digits
// that do not start with 0.
const NUMBER = /\d(?:[\s.\-‐‑‒–—]?\d)*/g;
const POSTAL_CODE = /^[1-9]\d{5}$/;
// How far before the words "PIN code" a number still goes with them ("411001 is your PIN code").
const NEAR_CHARS = 30;
// 12 or more digits in a row once spaces, dots and dashes are taken out: "4111 1111 1111 1111" or "1234-5678-9012".
// A 10-digit phone number is kept, and so is one written with its country code ("+91 98765 43210"): a phone number
// has at most 15 digits, and a card or ID number never starts with "+".
const LONG_NUMBER = /\d{12,}/;
const NUMBER_GAPS = /[\s.\-‐‑‒–—]/g;
const PHONE = /\+\d[\d\s.\-‐‑‒–—()]*\d/g;
const MAX_PHONE_DIGITS = 15;

/** The fact without its phone numbers, which may be long but are no secret. */
const withoutPhones = (fact) => fact.replace(PHONE, (phone) => (phone.replace(/\D/g, '').length <= MAX_PHONE_DIGITS ? ' ' : phone));

/**
 * Whether the PIN code a fact names is the postal code: the fact says nothing of a card, an ATM, a bank or UPI, and
 * every number after the words is six digits, as a postal code is ("PIN code 411001", "PIN code is 411 001"); with none
 * after them, the one just before them is ("411001 is your PIN code"). A number earlier in the fact, such as the house
 * number of an address ("12 MG Road, Pune, PIN code 411001"), does not matter.
 */
function isPostalCode(fact) {
  if (MONEY_WORDS.test(fact)) return false;
  const words = PIN_CODE.exec(fact);
  const numbers = [...fact.matchAll(NUMBER)];
  const isPostal = (number) => POSTAL_CODE.test(number[0].replace(NUMBER_GAPS, ''));
  const after = numbers.filter((number) => number.index >= words.index + words[0].length);
  if (after.length) return after.every(isPostal);
  const before = numbers.filter((number) => number.index + number[0].length <= words.index
    && words.index - (number.index + number[0].length) <= NEAR_CHARS).pop();
  return !before || isPostal(before);
}

/** The fact trimmed and on one line, or null when it is empty, too long, or a secret. */
function cleanFact(text) {
  if (typeof text !== 'string') return null;
  const fact = text.replace(/\s+/g, ' ').trim();
  if (!fact || fact.length > MAX_FACT_CHARS) return null;
  if (SECRET_WORDS.test(fact) || (PIN_CODE.test(fact) && !isPostalCode(fact))) return null;
  if (LONG_NUMBER.test(withoutPhones(fact).replace(NUMBER_GAPS, ''))) return null;
  return fact;
}

/**
 * The patterns cleanFact uses, by name, for the phone app, which cannot run this file: tools/sync-android-shared.js
 * copies them into its shared.json (as memoryRules), and its MemoryRules.kt follows cleanFact with them.
 */
const PATTERNS = {
  secretWords: SECRET_WORDS,
  pinCode: PIN_CODE,
  moneyWords: MONEY_WORDS,
  number: NUMBER,
  postalCode: POSTAL_CODE,
  longNumber: LONG_NUMBER,
  numberGaps: NUMBER_GAPS,
  phone: PHONE,
};

module.exports = { cleanFact, MAX_FACTS, MAX_FACT_CHARS, NEAR_CHARS, MAX_PHONE_DIGITS, PATTERNS };
