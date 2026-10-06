'use strict';

/**
 * The HTTP plumbing every provider shares: one request, JSON in and out, and
 * provider failures turned into BuddyErrors whose messages can be shown to the
 * user as they are.
 */

const { BuddyError } = require('../errors');

// A kind of error is a short identifier ("overloaded_error", "INVALID_ARGUMENT"). Nothing else from an
// answer is ever logged: a provider can echo the person's own text back inside its message.
const TYPE_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** What an error answer says: `text` is only for telling the kinds of failure apart; `type` is safe to log. */
async function readBody(res) {
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      const type = [j?.error?.type, j?.error?.status].find((t) => typeof t === 'string' && TYPE_SHAPE.test(t)) ?? null;
      return { text: String(j?.error?.message || j?.error?.status || j?.message || body).slice(0, 300), type };
    } catch {
      return { text: body.slice(0, 300), type: null };
    }
  } catch {
    return { text: '', type: null };
  }
}

async function errorFromResponse(res, label) {
  const { text, type } = await readBody(res);
  const { status } = res;
  // The log gets the status and the kind of error, never the answer's own words.
  console.warn(`[buddy] ${label} answered ${status}${type ? ` (${type})` : ''}`);
  if (status === 401 || status === 403) {
    return new BuddyError('bad_key', `Your ${label} key was rejected. Check it in Settings.`);
  }
  // Checked before 429: OpenAI reports an empty wallet as a 429 too.
  if (status === 402 || /credit balance|insufficient_quota|exceeded your current quota|billing/i.test(text)) {
    return new BuddyError('no_credit', `Your ${label} account is out of credit.`);
  }
  if (status === 429) {
    return new BuddyError('rate_limited', `${label} is busy right now. Try again in a minute.`);
  }
  if (status === 404 || /model.*(not found|does not exist|not supported)/i.test(text)) {
    return new BuddyError('bad_model', "This model isn't available for your key. Pick another in Settings.");
  }
  return new BuddyError('upstream', `${label} had a problem (${status}). Try again in a moment.`);
}

/**
 * fetch + JSON. A network failure becomes BuddyError('network'); an abort is
 * passed through untouched so callers can tell "cancelled" from "failed".
 */
async function requestJson({ fetchImpl = fetch, url, method = 'GET', headers = {}, body, signal, label }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method,
      headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err?.name === 'AbortError') throw err;
    throw new BuddyError('network', `Couldn't reach ${label}. Check your internet.`);
  }
  if (!res.ok) throw await errorFromResponse(res, label);
  return res.json();
}

module.exports = { requestJson, errorFromResponse };
