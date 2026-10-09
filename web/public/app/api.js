// Buddy's server, from the phone: each call carries the person's ID token, has a deadline, and turns what went wrong
// into words for the person. The server's own refusals ({ error: { code, message } }) keep its words. A 401 means the
// token was turned down: the call is made once more with a new token, and only when that is turned down too is the
// person signed out (as the Mac and Android do).

export const TIMEOUTS = { config: 8_000, ask: 60_000, transcribe: 45_000, remote: 10_000, push: 10_000 };
export const NO_INTERNET = 'No internet.';
export const TOO_SLOW = "Buddy's server took too long to answer. Try again.";
export const SERVER_PROBLEM = "Buddy's server had a problem. Try again.";
export const SIGN_IN_AGAIN = 'Sign in again.';

/** What went wrong with a call: `code` to branch on, `message` for the person. */
export class ApiError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
  }
}

/**
 * getToken(force) answers the person's ID token (a new one when `force`), or null when nobody is signed in;
 * onSignedOut() is called when the server turned the person's sign-in down twice. Answers { get, post }: each answers
 * the server's JSON, or throws an ApiError.
 */
export function createApi({ getToken, onSignedOut = () => {}, fetchImpl = (...args) => fetch(...args), base = '' }) {
  function signedOut() {
    onSignedOut();
    return new ApiError('unauthenticated', SIGN_IN_AGAIN);
  }

  async function call(path, { method, body, timeoutMs = 30_000 }, retried = false) {
    let token;
    try {
      token = await getToken(retried);
    } catch {
      throw new ApiError('network', NO_INTERNET); // a new token comes from Google: offline, that fails
    }
    if (!token) throw signedOut();
    const headers = { authorization: `Bearer ${token}` };
    if (body !== undefined) headers['content-type'] = 'application/json';
    let res;
    let json;
    try {
      res = await fetchImpl(`${base}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      json = await res.json().catch((err) => {
        if (err?.name === 'TimeoutError') throw err;
        return null; // not JSON: said below
      });
    } catch (err) {
      throw err?.name === 'TimeoutError' ? new ApiError('timeout', TOO_SLOW) : new ApiError('network', NO_INTERNET);
    }
    if (res.status === 401) {
      if (!retried) return call(path, { method, body, timeoutMs }, true);
      throw signedOut();
    }
    if (res.ok && json && typeof json === 'object') return json;
    const error = json?.error;
    if (error && typeof error.code === 'string' && typeof error.message === 'string') throw new ApiError(error.code, error.message);
    throw new ApiError('server', SERVER_PROBLEM);
  }

  return {
    get: (path, options = {}) => call(path, { ...options, method: 'GET' }),
    post: (path, body, options = {}) => call(path, { ...options, method: 'POST', body }),
  };
}
