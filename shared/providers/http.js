'use strict';

/**
 * The HTTP plumbing every provider shares: one request, JSON in and out, and
 * provider failures turned into BuddyErrors whose messages can be shown to the
 * user as they are.
 */

const { BuddyError } = require('../errors');

async function detailOf(res) {
  try {
    const body = await res.text();
    try {
      const j = JSON.parse(body);
      return String(j?.error?.message || j?.error?.status || j?.message || body).slice(0, 300);
    } catch {
      return body.slice(0, 300);
    }
  } catch {
    return '';
  }
}

async function errorFromResponse(res, label) {
  const detail = await detailOf(res);
  const { status } = res;
  if (status === 401 || status === 403) {
    return new BuddyError('bad_key', `Your ${label} key was rejected. Check it in Settings.`);
  }
  // Checked before 429: OpenAI reports an empty wallet as a 429 too.
  if (status === 402 || /credit balance|insufficient_quota|exceeded your current quota|billing/i.test(detail)) {
    return new BuddyError('no_credit', `Your ${label} account is out of credit.`);
  }
  if (status === 429) {
    return new BuddyError('rate_limited', `${label} is busy right now. Try again in a minute.`);
  }
  if (status === 404 || /model.*(not found|does not exist|not supported)/i.test(detail)) {
    return new BuddyError('bad_model', "This model isn't available for your key. Pick another in Settings.");
  }
  return new BuddyError('upstream', `${label} had a problem (${status}). ${detail}`.trim());
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
