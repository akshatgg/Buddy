// Buddy on iPhone: notifications, the phone's side (web/public/app/push.js).

import test from 'node:test';
import assert from 'node:assert';
import { createPush, pushSupport, keyBytes, NOT_INSTALLED, NOT_SET_UP, DENIED, FAILED } from '../web/public/app/push.js';
import { ApiError } from '../web/public/app/api.js';

const KEY = 'BOrM2YbXqOM7l2B3eHnO1Xe0p7sYk9yYAH6yI1wqKp2c5c7mQb7Hk9pRZJ2l0u1c1oG3vYq9WmGxQpPj8nRrS0E';
const SUB = { endpoint: 'https://web.push.apple.com/QGuQyavXutnMH', keys: { p256dh: 'BPkey', auth: 'authkey' } };

/** A phone with a service worker and Notification, which answers `answer` when asked; `failPost` makes the server fail. */
function setup({ key = KEY, answer = 'granted', failPost = null, subscribed = false } = {}) {
  const seen = { posts: [], subscribes: [], unsubscribes: 0, asked: 0 };
  let current = subscribed ? fakeSub() : null;
  function fakeSub() {
    return {
      endpoint: SUB.endpoint,
      toJSON: () => SUB,
      unsubscribe: async () => {
        seen.unsubscribes += 1;
        current = null;
        return true;
      },
    };
  }
  let permission = subscribed ? 'granted' : 'default';
  const push = createPush({
    api: {
      post: async (path, body, options) => {
        seen.posts.push({ path, body, options });
        if (failPost) throw failPost;
        return { on: body.action === 'on' };
      },
    },
    pushKey: () => key,
    ready: async () => ({
      pushManager: {
        getSubscription: async () => current,
        subscribe: async (options) => {
          seen.subscribes.push(options);
          current = fakeSub();
          return current;
        },
      },
    }),
    permission: () => permission,
    requestPermission: async () => {
      seen.asked += 1;
      permission = answer;
      return answer;
    },
  });
  return { push, seen };
}

test('switching on asks, subscribes with the server key, and gives the subscription to the server', async () => {
  const { push, seen } = setup();
  assert.strictEqual(await push.isOn(), false);
  assert.deepStrictEqual(await push.on(), { ok: true });
  assert.strictEqual(seen.asked, 1);
  assert.strictEqual(seen.subscribes.length, 1);
  assert.strictEqual(seen.subscribes[0].userVisibleOnly, true);
  assert.deepStrictEqual(seen.subscribes[0].applicationServerKey, keyBytes(KEY));
  assert.deepStrictEqual(seen.posts, [{ path: '/api/push', body: { action: 'on', subscription: SUB }, options: { timeoutMs: 10_000 } }]);
  assert.strictEqual(await push.isOn(), true);
});

test('not allowed, or no key on the server: nothing is subscribed', async () => {
  const no = setup({ answer: 'denied' });
  assert.deepStrictEqual(await no.push.on(), { ok: false, error: DENIED });
  assert.strictEqual(no.seen.subscribes.length, 0);
  const off = setup({ key: null });
  assert.deepStrictEqual(await off.push.on(), { ok: false, error: NOT_SET_UP });
  assert.strictEqual(off.seen.asked, 0, 'not even asked');
});

test('the server failing undoes the subscription, and says why', async () => {
  const { push, seen } = setup({ failPost: new ApiError('network', 'No internet.') });
  assert.deepStrictEqual(await push.on(), { ok: false, error: 'No internet.' });
  assert.strictEqual(seen.unsubscribes, 1);
  assert.strictEqual(await push.isOn(), false);
});

test('switching off tells the server first, then unsubscribes; an old subscription is replaced when switching on', async () => {
  const { push, seen } = setup({ subscribed: true });
  assert.deepStrictEqual(await push.off(), { ok: true });
  assert.deepStrictEqual(seen.posts[0].body, { action: 'off', endpoint: SUB.endpoint });
  assert.strictEqual(seen.unsubscribes, 1);
  assert.deepStrictEqual(await push.off(), { ok: true }, 'already off');
  assert.strictEqual(seen.posts.length, 1);

  const again = setup({ subscribed: true });
  await again.push.on();
  assert.strictEqual(again.seen.unsubscribes, 1, 'the old one went first');
  assert.strictEqual(again.seen.subscribes.length, 1);
});

test('only the Home Screen app on an iPhone gets notifications', () => {
  const all = { hasServiceWorker: true, hasPushManager: true, hasNotification: true };
  assert.strictEqual(pushSupport({ ...all, standalone: true, apple: true }), 'ok');
  assert.strictEqual(pushSupport({ standalone: false, apple: true, hasServiceWorker: true }), 'not-installed');
  assert.strictEqual(pushSupport({ standalone: true, apple: true, hasServiceWorker: true }), 'not-supported', 'iOS before 16.4');
  assert.strictEqual(pushSupport({ standalone: false, apple: false }), 'not-supported');
  assert.ok(NOT_INSTALLED.includes('Add to Home Screen'));
  assert.ok(FAILED);
});

test('the key is read from base64url', () => {
  assert.deepStrictEqual([...keyBytes('AQID_-8')], [1, 2, 3, 255, 239]);
  assert.strictEqual(keyBytes(KEY).length, 65);
});

test('forget unsubscribes on the phone only (signing out, when the server may be out of reach)', async () => {
  const { push, seen } = setup({ subscribed: true });
  await push.forget();
  assert.strictEqual(seen.unsubscribes, 1);
  assert.strictEqual(seen.posts.length, 0, 'the server is not asked');
  assert.strictEqual(await push.isOn(), false);
  await push.forget(); // nothing to forget: fine
  assert.strictEqual(seen.unsubscribes, 1);
});

test('a service worker that never gets ready: switching on fails, isOn is false, forget gives up; nothing hangs', async () => {
  const push = createPush({
    api: { post: async () => assert.fail('nothing is sent') },
    pushKey: () => KEY,
    ready: () => new Promise(() => {}), // never
    permission: () => 'granted',
    requestPermission: async () => 'granted',
    readyMs: 20,
  });
  assert.deepStrictEqual(await push.on(), { ok: false, error: FAILED });
  assert.strictEqual(await push.isOn(), false);
  await push.forget();
  const broken = createPush({
    api: {},
    pushKey: () => KEY,
    ready: async () => ({ pushManager: { getSubscription: async () => { throw new Error('no'); } } }),
    permission: () => 'granted',
  });
  await broken.forget();
  assert.strictEqual(await broken.isOn(), false);
});
