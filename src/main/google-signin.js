'use strict';

/**
 * Sign in with Google the way Google asks desktop apps to (OAuth 2.0 for installed apps): Buddy listens once on
 * 127.0.0.1, opens Google's sign-in page in the person's browser, and gets the answer back on that port
 * (authorization code + PKCE). The Google ID token then signs in to Firebase Authentication, which gives Buddy the
 * ID token its server checks, and a refresh token to renew it with.
 */

const crypto = require('node:crypto');
const http = require('node:http');
const { BuddyError } = require('../../shared/errors');

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const IDP_URL = 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp';
const REFRESH_URL = 'https://securetoken.googleapis.com/v1/token';
const WAIT_MS = 5 * 60_000; // how long Buddy waits for the person to finish on Google's page
const CALL_TIMEOUT_MS = 30_000;

// Answers of the refresh endpoint that mean the sign-in is over: the person has to sign in again.
const SIGNED_OUT_REASONS = /TOKEN_EXPIRED|INVALID_REFRESH_TOKEN|USER_DISABLED|USER_NOT_FOUND|INVALID_GRANT_TYPE|MISSING_REFRESH_TOKEN|PROJECT_NUMBER_MISMATCH/;
// The reason a refusal gives is logged only when it is one short word ("invalid_grant", "TOKEN_EXPIRED"), as
// shared/providers/http.js does: anything longer could carry a token.
const REASON_SHAPE = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

const failed = () => new BuddyError('sign_in_failed', "Google didn't sign you in. Try again.");
// Cancelled: Buddy let go of the wait itself (a newer sign-in, a sign-out), and the pages say nothing. Denied: Google
// sent the person back without signing them in (Cancel on its page), which the pages show.
const cancelled = () => new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.');
const denied = () => new BuddyError('sign_in_denied', "You didn't finish signing in with Google. Try again.");
const signedOut = () => new BuddyError('signed_out', 'Sign in to use Buddy.');
const authFailed = () => new BuddyError('auth_failed', "Couldn't check your sign-in. Try again.");

const page = (title, text) => '<!doctype html><meta charset="utf-8">'
  + `<title>${title}</title><body style="font:16px -apple-system,BlinkMacSystemFont,sans-serif;text-align:center;padding:72px 24px">`
  + `<h1 style="font-size:24px">${title}</h1><p>${text}</p></body>`;
// The tab is answered as soon as Google's code arrives, before Buddy has signed in with it, so it promises nothing that
// can still fail: Buddy itself then says "Signed in ✓", or why not.
const DONE_PAGE = page('Almost done', 'You can close this tab. Buddy is finishing signing you in.');
const FAILED_PAGE = page('Sign-in did not finish', 'Go back to Buddy and try again.');

/** A PKCE pair: the verifier Buddy keeps, and the challenge that goes to Google. */
function makePkce() {
  const verifier = crypto.randomBytes(32).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

function authUrl({ clientId, redirectUri, challenge, state }) {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    state,
    prompt: 'select_account',
  });
  return `${AUTH_URL}?${params}`;
}

/**
 * Listen once on 127.0.0.1, on a port the system picks, for Google's answer to the sign-in with this `state`.
 * Resolves { redirectUri, code, stop } as soon as it listens: `code` is a promise of the authorization code, which
 * rejects when Google sends the person back without one (sign_in_denied: Cancel on its page), after `waitMs`
 * (sign_in_timeout), and when `signal` aborts (at once, if it already has) or on stop() (sign_in_cancelled). Anything
 * else that reaches the port gets a 404, and the wait goes on.
 */
function listenForCode({ state, waitMs = WAIT_MS, signal }) {
  return new Promise((resolve, reject) => {
    let done = false;
    let settle = () => {};
    const code = new Promise((ok, fail) => {
      settle = (err, value) => (err ? fail(err) : ok(value));
    });
    code.catch(() => {}); // the caller awaits it later; an early failure is not "unhandled" meanwhile

    const server = http.createServer((req, res) => {
      let url = null;
      try {
        url = new URL(req.url, 'http://127.0.0.1');
      } catch {
        // A target that is no path at all (`//`, `///`): whoever sent it, it is not Google's answer.
      }
      // Only a request for this host, for `/`, with this sign-in's state is Google's answer. (Against a base URL, a target
      // like `//other.example/` would be read as the `/` of another host.)
      if (done || !url || url.hostname !== '127.0.0.1' || url.pathname !== '/' || url.searchParams.get('state') !== state) {
        res.writeHead(404, { 'content-type': 'text/plain', connection: 'close' }).end('Not found');
        return; // a favicon request or a stray visitor: keep waiting for Google
      }
      const got = url.searchParams.get('code');
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' }).end(got ? DONE_PAGE : FAILED_PAGE);
      finish(got ? null : denied(), got);
    });
    const timer = setTimeout(() => finish(new BuddyError('sign_in_timeout', 'Sign-in took too long. Try again.')), waitMs);
    const onAbort = () => finish(cancelled());

    function finish(err, value) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      server.close();
      settle(err, value);
    }

    server.once('error', () => {
      finish(failed());
      reject(new BuddyError('sign_in_failed', "Couldn't start signing in. Try again."));
    });
    server.listen(0, '127.0.0.1', () => {
      const redirectUri = `http://127.0.0.1:${server.address().port}`; // before onAbort() closes the server, which has no address then
      if (signal?.aborted) onAbort();
      else signal?.addEventListener('abort', onAbort, { once: true });
      resolve({ redirectUri, code, stop: () => finish(cancelled()) });
    });
  });
}

/**
 * The reason Google (`error`) or Firebase (`error.message`, often followed by words of its own) gives for a refusal,
 * cut at the first space or colon; null unless what is left is one word that is safe to log.
 */
function loggableReason(body) {
  const said = typeof body?.error?.message === 'string' ? body.error.message : body?.error;
  if (typeof said !== 'string') return null;
  const word = said.split(/[\s:]/)[0];
  return REASON_SHAPE.test(word) ? word : null;
}

/** POST to Google or Firebase; answers the JSON. No connection is `network`; any other failure is `onFail(reason)`. */
async function post({ fetchImpl, url, form, json, onFail }) {
  let res;
  try {
    res = await fetchImpl(url, {
      method: 'POST',
      headers: { 'content-type': form ? 'application/x-www-form-urlencoded' : 'application/json' },
      body: form ? new URLSearchParams(form).toString() : JSON.stringify(json),
      signal: AbortSignal.timeout(CALL_TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError') throw new BuddyError('timeout', 'Google took too long to answer. Try again.');
    throw new BuddyError('network', "Couldn't reach Google. Check your internet.");
  }
  let body = null;
  try {
    body = await res.json();
  } catch {
    // not JSON: judged by the status below
  }
  if (!res.ok) {
    // The log gets where, the status and the reason as one word, never a token.
    const reason = loggableReason(body);
    console.warn(`[buddy] sign-in: ${new URL(url).hostname} answered ${res.status}${reason ? ` (${reason})` : ''}`);
    throw onFail(String(body?.error?.message || body?.error || ''));
  }
  return body && typeof body === 'object' ? body : {};
}

async function exchangeCode({ code, verifier, redirectUri, config, fetchImpl }) {
  const body = await post({
    fetchImpl,
    url: TOKEN_URL,
    onFail: failed,
    form: {
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
      code_verifier: verifier,
    },
  });
  if (typeof body.id_token !== 'string' || !body.id_token) throw failed();
  return body.id_token;
}

async function firebaseSignIn({ googleIdToken, config, fetchImpl }) {
  const body = await post({
    fetchImpl,
    url: `${IDP_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`,
    onFail: failed,
    json: {
      postBody: `id_token=${encodeURIComponent(googleIdToken)}&providerId=google.com`,
      requestUri: 'http://localhost',
      returnSecureToken: true,
      returnIdpCredential: true,
    },
  });
  if (!body.idToken || !body.refreshToken || !body.localId) throw failed();
  return {
    idToken: body.idToken,
    refreshToken: body.refreshToken,
    expiresIn: Number(body.expiresIn) || 3600,
    uid: body.localId,
    email: body.email || '',
    name: body.displayName || body.fullName || '',
  };
}

/**
 * The whole sign-in. `openBrowser(url)` opens Google's page (shell.openExternal in the app); `signal` cancels it.
 * Resolves { idToken, refreshToken, expiresIn, uid, email, name }.
 */
async function signInWithGoogle({ config, openBrowser, fetchImpl = fetch, waitMs, signal }) {
  const { verifier, challenge } = makePkce();
  const state = crypto.randomBytes(16).toString('base64url');
  const listening = await listenForCode({ state, waitMs, signal });
  // Cancelled before the port was even listening: the listener has let go of it already (an aborted signal closes it),
  // and nobody waits for an answer, so no page is opened.
  if (signal?.aborted) throw cancelled();
  try {
    await openBrowser(authUrl({ clientId: config.googleClientId, redirectUri: listening.redirectUri, challenge, state }));
  } catch {
    listening.stop();
    throw new BuddyError('sign_in_failed', "Couldn't open your browser to sign in.");
  }
  const code = await listening.code;
  const googleIdToken = await exchangeCode({ code, verifier, redirectUri: listening.redirectUri, config, fetchImpl });
  return firebaseSignIn({ googleIdToken, config, fetchImpl });
}

/** A new ID token for a refresh token. One Firebase no longer takes means the person is signed out. */
async function refreshIdToken({ refreshToken, config, fetchImpl = fetch }) {
  const body = await post({
    fetchImpl,
    url: `${REFRESH_URL}?key=${encodeURIComponent(config.firebaseApiKey)}`,
    form: { grant_type: 'refresh_token', refresh_token: refreshToken },
    onFail: (reason) => (SIGNED_OUT_REASONS.test(reason) ? signedOut() : authFailed()),
  });
  if (!body.id_token || !body.refresh_token) throw authFailed();
  return { idToken: body.id_token, refreshToken: body.refresh_token, expiresIn: Number(body.expires_in) || 3600 };
}

// `cancelled` and `signedOut` are exported for account.js, so that a sign-in and a session end in the same words.
module.exports = { signInWithGoogle, refreshIdToken, listenForCode, makePkce, authUrl, cancelled, signedOut };
