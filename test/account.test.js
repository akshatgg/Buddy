'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { BuddyError } = require('../shared/errors');
const { createAccount, RENEW_EARLY_MS } = require('../src/main/account');

const CONFIG = { serverUrl: 'https://s.example', firebaseApiKey: 'k', googleClientId: 'c', googleClientSecret: 's' };
const HOUR = 3600;
const SIGNED_IN = { idToken: 'id-1', refreshToken: 'refresh-1', expiresIn: HOUR, uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' };

/** safeStorage as Electron's, with "enc:" in place of real encryption. */
function fakeSafeStorage({ available = true } = {}) {
  return {
    isEncryptionAvailable: () => available,
    encryptString: (text) => Buffer.from(`enc:${text}`),
    decryptString(buffer) {
      const text = buffer.toString();
      if (!text.startsWith('enc:')) throw new Error('Error while decrypting the ciphertext provided to safeStorage.decryptString.');
      return text.slice(4);
    },
  };
}

/**
 * createAccount on `file` (a new temp folder's account.json when none is given), with a clock the test moves
 * (clock.t, in ms) and fakes for Google: `signInWith(options)` and `refreshWith(options, n)` decide the answers.
 */
function setup(t, { file, config = CONFIG, safeStorage = fakeSafeStorage(), signInWith, refreshWith } = {}) {
  let accountFile = file;
  if (!accountFile) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'buddy-account-'));
    t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
    accountFile = path.join(dir, 'account.json');
  }
  const clock = { t: 1_000_000 };
  const signIns = [];
  const refreshes = [];
  let changes = 0;
  const account = createAccount({
    file: accountFile,
    safeStorage,
    config,
    openBrowser: async () => {},
    now: () => clock.t,
    async signInWithGoogle(options) {
      signIns.push(options);
      return signInWith ? signInWith(options) : SIGNED_IN;
    },
    async refreshIdToken(options) {
      refreshes.push(options);
      return refreshWith
        ? refreshWith(options, refreshes.length)
        : { idToken: `id-r${refreshes.length}`, refreshToken: options.refreshToken, expiresIn: HOUR };
    },
  });
  account.onChange(() => { changes += 1; });
  return { account, file: accountFile, clock, signIns, refreshes, changes: () => changes };
}

test('signed out at first: no user, and no token for the server', async (t) => {
  const s = setup(t);
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(s.account.user(), null);
  await assert.rejects(s.account.idToken(), { code: 'signed_out', message: 'Sign in to use Buddy.' });
});

test('signing in keeps the account, with the refresh token encrypted, and says so', async (t) => {
  const s = setup(t);
  assert.deepStrictEqual(await s.account.signIn(), { uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' });
  assert.strictEqual(s.account.isSignedIn(), true);
  assert.strictEqual(s.changes(), 1);
  assert.deepStrictEqual(JSON.parse(fs.readFileSync(s.file, 'utf8')), {
    uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul', refreshToken: Buffer.from('enc:refresh-1').toString('base64'),
  });
  assert.strictEqual(fs.statSync(s.file).mode & 0o777, 0o600);
  assert.strictEqual(await s.account.idToken(), 'id-1', 'the fresh token, with no refresh');
  assert.strictEqual(s.refreshes.length, 0);
  assert.strictEqual(s.signIns[0].config, CONFIG);
  assert.ok(s.signIns[0].signal instanceof AbortSignal);
});

test('the token is renewed five minutes before it runs out, and not before', async (t) => {
  const s = setup(t);
  await s.account.signIn();
  s.clock.t += HOUR * 1000 - RENEW_EARLY_MS - 1;
  assert.strictEqual(await s.account.idToken(), 'id-1');
  s.clock.t += 2;
  assert.strictEqual(await s.account.idToken(), 'id-r1');
  assert.strictEqual(s.refreshes[0].refreshToken, 'refresh-1');
  assert.strictEqual(RENEW_EARLY_MS, 5 * 60_000);
});

test('after a restart the person is still signed in, and the first token is renewed from the kept one', async (t) => {
  const first = setup(t);
  await first.account.signIn();
  const again = setup(t, { file: first.file });
  assert.deepStrictEqual(again.account.user(), { uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' });
  assert.strictEqual(await again.account.idToken(), 'id-r1');
  assert.strictEqual(again.refreshes[0].refreshToken, 'refresh-1');
});

test('a rotated refresh token is kept; two calls at once share one renewal; force renews a fresh token', async (t) => {
  const s = setup(t, { refreshWith: (options, n) => ({ idToken: `id-r${n}`, refreshToken: `refresh-r${n}`, expiresIn: HOUR }) });
  await s.account.signIn();
  const both = await Promise.all([s.account.idToken({ force: true }), s.account.idToken({ force: true })]);
  assert.deepStrictEqual(both, ['id-r1', 'id-r1']);
  assert.strictEqual(s.refreshes.length, 1);
  assert.strictEqual(JSON.parse(fs.readFileSync(s.file, 'utf8')).refreshToken, Buffer.from('enc:refresh-r1').toString('base64'));
  assert.strictEqual(await s.account.idToken({ force: true }), 'id-r2');
  assert.strictEqual(s.refreshes[1].refreshToken, 'refresh-r1');
});

test('a refresh token Firebase no longer takes signs the person out', async (t) => {
  const s = setup(t, { refreshWith: () => { throw new BuddyError('signed_out', 'Sign in to use Buddy.'); } });
  await s.account.signIn();
  await assert.rejects(s.account.idToken({ force: true }), { code: 'signed_out' });
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
  assert.strictEqual(s.changes(), 2, 'signed in, then out');
});

test('no internet while renewing keeps the person signed in', async (t) => {
  const s = setup(t, { refreshWith: () => { throw new BuddyError('network', "Couldn't reach Google. Check your internet."); } });
  await s.account.signIn();
  await assert.rejects(s.account.idToken({ force: true }), { code: 'network' });
  assert.strictEqual(s.account.isSignedIn(), true);
  assert.ok(fs.existsSync(s.file));
});

test('a kept token the keychain can no longer read means signing in again', async (t) => {
  const first = setup(t);
  await first.account.signIn();
  const stored = JSON.parse(fs.readFileSync(first.file, 'utf8'));
  fs.writeFileSync(first.file, JSON.stringify({ ...stored, refreshToken: Buffer.from('garbage').toString('base64') }));
  const again = setup(t, { file: first.file });
  await assert.rejects(again.account.idToken(), { code: 'signed_out' });
  assert.strictEqual(again.account.isSignedIn(), false);
  assert.strictEqual(again.refreshes.length, 0);
});

test('a damaged or incomplete account file is no account', (t) => {
  const s = setup(t);
  for (const text of ['{ nope', '[]', JSON.stringify({ uid: 'u', email: 'e', name: 'n' }), JSON.stringify({ uid: '', email: 'e', name: 'n', refreshToken: 'r' })]) {
    fs.writeFileSync(s.file, text);
    assert.strictEqual(setup(t, { file: s.file }).account.isSignedIn(), false, text);
  }
});

test('signing out forgets the account and says so; signing out again changes nothing', async (t) => {
  const s = setup(t);
  await s.account.signIn();
  s.account.signOut();
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
  assert.strictEqual(s.changes(), 2);
  s.account.signOut();
  assert.strictEqual(s.changes(), 2);
});

test('signing out while a token is being renewed: the renewed token is thrown away', async (t) => {
  let release = null;
  const s = setup(t, {
    refreshWith: () => new Promise((resolve) => {
      release = () => resolve({ idToken: 'late', refreshToken: 'late-refresh', expiresIn: HOUR });
    }),
  });
  await s.account.signIn();
  const pending = s.account.idToken({ force: true });
  await new Promise((resolve) => setImmediate(resolve));
  s.account.signOut();
  release();
  await assert.rejects(pending, { code: 'signed_out' });
  assert.strictEqual(fs.existsSync(s.file), false, 'the late refresh token was not kept');
});

test('pressing Sign in again cancels the sign-in that is still waiting', async (t) => {
  const waiting = [];
  const s = setup(t, {
    signInWith: (options) => new Promise((resolve, reject) => {
      waiting.push(resolve);
      options.signal.addEventListener('abort', () => reject(new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.')));
    }),
  });
  const first = s.account.signIn();
  const second = s.account.signIn();
  await assert.rejects(first, { code: 'sign_in_cancelled' });
  assert.strictEqual(s.signIns[0].signal.aborted, true);
  waiting[1]({ idToken: 'id-2', refreshToken: 'refresh-2', expiresIn: HOUR, uid: 'uid-2', email: 'b@x.com', name: 'B' });
  assert.deepStrictEqual(await second, { uid: 'uid-2', email: 'b@x.com', name: 'B' });
});

test('signing out right after pressing Sign in ends that sign-in, and nothing is kept', async (t) => {
  const s = setup(t); // this Google ignores the signal and answers at once, so only the account itself can stop the sign-in
  const pending = s.account.signIn();
  s.account.signOut(); // in the same tick, before Google's answer is looked at
  await assert.rejects(pending, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
  assert.strictEqual(s.changes(), 0);
});

test('a sign-in that finishes after the person signed out is thrown away', async (t) => {
  let answer = null;
  const s = setup(t, { signInWith: () => new Promise((resolve) => { answer = () => resolve(SIGNED_IN); }) }); // ignores the signal
  const waiting = s.account.signIn();
  s.account.signOut();
  answer();
  await assert.rejects(waiting, { code: 'sign_in_cancelled', message: 'Sign-in was cancelled.' });
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false, 'the late account was not kept');
  assert.strictEqual(s.changes(), 0);
});

test('signing out cancels the sign-in that is still waiting for the browser', async (t) => {
  const s = setup(t, {
    signInWith: (options) => new Promise((resolve, reject) => {
      options.signal.addEventListener('abort', () => reject(new BuddyError('sign_in_cancelled', 'Sign-in was cancelled.')));
    }),
  });
  const waiting = s.account.signIn();
  assert.strictEqual(s.signIns[0].signal.aborted, false);
  s.account.signOut();
  assert.strictEqual(s.signIns[0].signal.aborted, true, 'the wait for the browser was told to stop');
  await assert.rejects(waiting, { code: 'sign_in_cancelled' });
  assert.strictEqual(s.changes(), 0);
});

test('a refusal that comes after the person signed out and in as someone else does not sign the new person out', async (t) => {
  const second = { idToken: 'id-2', refreshToken: 'refresh-2', expiresIn: HOUR, uid: 'uid-2', email: 'b@x.com', name: 'B' };
  let refuse = null;
  let signIns = 0;
  const s = setup(t, {
    signInWith: () => (++signIns === 1 ? SIGNED_IN : second),
    refreshWith: () => new Promise((resolve, reject) => {
      refuse = () => reject(new BuddyError('signed_out', 'Sign in to use Buddy.'));
    }),
  });
  await s.account.signIn();
  const renewing = s.account.idToken({ force: true });
  s.account.signOut();
  await s.account.signIn(); // as the second person
  refuse();
  await assert.rejects(renewing, { code: 'signed_out' });
  assert.deepStrictEqual(s.account.user(), { uid: 'uid-2', email: 'b@x.com', name: 'B' });
  assert.ok(fs.existsSync(s.file), 'the second account is still kept');
  assert.strictEqual(s.changes(), 3, 'in, out, in: the late refusal changed nothing');
  assert.strictEqual(await s.account.idToken(), 'id-2');
});

test('no keychain: signing in fails before any Google page opens, and nothing is kept', async (t) => {
  const s = setup(t, { safeStorage: fakeSafeStorage({ available: false }) });
  await assert.rejects(s.account.signIn(), { code: 'no_keychain', message: 'Your Mac keychain is not available, so Buddy cannot keep you signed in.' });
  assert.strictEqual(s.signIns.length, 0, 'the browser was not even asked to open');
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(fs.existsSync(s.file), false);
});

test('a copy of Buddy with no cloud.json cannot sign in', async (t) => {
  const s = setup(t, { config: null });
  await assert.rejects(s.account.signIn(), { code: 'not_set_up', message: "This copy of Buddy isn't set up for sign-in." });
  assert.strictEqual(s.signIns.length, 0);
});

test('a listener that throws does not undo a sign-in, hide why someone was signed out, or stop the others', async (t) => {
  const error = t.mock.method(console, 'error', () => {});
  const s = setup(t, { refreshWith: () => { throw new BuddyError('signed_out', 'Sign in to use Buddy.'); } });
  let heard = 0;
  s.account.onChange(() => { throw Object.assign(new Error('a detail that must stay out of the log'), { code: 'EBROKEN' }); });
  s.account.onChange(() => { throw new TypeError('another detail'); });
  s.account.onChange(() => { heard += 1; });

  assert.deepStrictEqual(await s.account.signIn(), { uid: 'uid-1', email: 'rahul@gmail.com', name: 'Rahul' });
  assert.ok(fs.existsSync(s.file), 'the account was kept');
  assert.strictEqual(heard, 1, 'the listener after the broken ones still heard');

  await assert.rejects(s.account.idToken({ force: true }), { code: 'signed_out' }, 'the reason is the refusal, not the listener');
  assert.strictEqual(s.account.isSignedIn(), false);
  assert.strictEqual(heard, 2);

  assert.deepStrictEqual(error.mock.calls.map((call) => call.arguments.join(' ')), [
    '[buddy] an account listener failed: EBROKEN',
    '[buddy] an account listener failed: TypeError',
    '[buddy] an account listener failed: EBROKEN',
    '[buddy] an account listener failed: TypeError',
  ]);
});
