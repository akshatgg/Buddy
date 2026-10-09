// Notifications on the phone: "Claude Code finished" and "Claude Code needs you", even while Buddy is closed. iOS
// (16.4 and later) gives Web Push only to a web app opened from the Home Screen, and only once the person allows it
// from a tap. The browser makes a subscription (an address at Apple's push service) with the server's public key
// (pushKey, from GET /api/config); Buddy's server keeps it (POST /api/push) and posts there when a session on the
// person's computer stops working (web/lib/handlers.js). sw.js shows the notification.

import { TIMEOUTS } from './api.js';

export const NOT_INSTALLED = 'Add Buddy to your Home Screen first: tap Share, then Add to Home Screen, and open Buddy from there.';
export const NOT_SUPPORTED = 'Notifications need iOS 16.4 or later.';
export const DENIED = 'Notifications are off for Buddy. Turn them on in the Settings app → Notifications → Buddy.';
export const NOT_SET_UP = "Notifications aren't set up yet.";
export const FAILED = "Notifications couldn't be switched on. Try again.";

/**
 * Whether this browser can have notifications: 'ok'; 'not-installed' (an iPhone's Safari, not the Home Screen app,
 * which is the only one iOS gives them to); or 'not-supported'.
 */
export function pushSupport({ standalone, apple, hasServiceWorker, hasPushManager, hasNotification }) {
  if (hasServiceWorker && hasPushManager && hasNotification) return 'ok';
  return apple && !standalone ? 'not-installed' : 'not-supported';
}

/** pushSupport's facts about this page's browser. */
export function supportHere(win = globalThis) {
  return pushSupport({
    standalone: win.navigator?.standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true,
    apple: /iPhone|iPad|iPod/.test(win.navigator?.userAgent || ''),
    hasServiceWorker: Boolean(win.navigator?.serviceWorker),
    hasPushManager: 'PushManager' in win,
    hasNotification: 'Notification' in win,
  });
}

/** The server's public key (base64url, as web-push makes it) as the bytes the browser wants. */
export function keyBytes(key) {
  const base64 = `${key}${'='.repeat((4 - (key.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/');
  return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
}

/**
 * api is api.js's; pushKey() the server's public key (null when notifications are not set up on the server); ready()
 * answers the service worker's registration; permission() and requestPermission() are the Notification API's.
 */
export function createPush({
  api,
  pushKey,
  ready = () => navigator.serviceWorker.ready,
  permission = () => Notification.permission,
  requestPermission = () => Notification.requestPermission(),
}) {
  const subscription = async () => (await ready()).pushManager.getSubscription();

  return {
    /** Whether this phone gets notifications now. */
    async isOn() {
      return permission() === 'granted' && Boolean(await subscription());
    },

    /** Switch on, from a tap. Answers { ok: true }, or { ok: false, error }. */
    async on() {
      const key = pushKey();
      if (!key) return { ok: false, error: NOT_SET_UP };
      if ((await requestPermission()) !== 'granted') return { ok: false, error: DENIED };
      const registration = await ready();
      let sub;
      try {
        // A subscription made with another key (the server's keys were changed) cannot be used: a new one is made.
        const old = await registration.pushManager.getSubscription();
        if (old) await old.unsubscribe();
        sub = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(key) });
      } catch {
        return { ok: false, error: FAILED };
      }
      try {
        await api.post('/api/push', { action: 'on', subscription: sub.toJSON() }, { timeoutMs: TIMEOUTS.push });
      } catch (err) {
        await sub.unsubscribe().catch(() => {});
        return { ok: false, error: err?.message || FAILED };
      }
      return { ok: true };
    },

    /** Switch off: the server forgets this phone, then the browser does. */
    async off() {
      const sub = await subscription().catch(() => null);
      if (!sub) return { ok: true };
      try {
        await api.post('/api/push', { action: 'off', endpoint: sub.endpoint }, { timeoutMs: TIMEOUTS.push });
      } catch (err) {
        return { ok: false, error: err?.message || FAILED };
      }
      await sub.unsubscribe().catch(() => {});
      return { ok: true };
    },
  };
}
