'use strict';

/**
 * Claude mode on the phone, the computer's side. With Settings → Claude Code → "Show my sessions on my other devices" on and
 * the person signed in, Buddy tells its server which Claude Code sessions run here (live.js), every few seconds. When
 * their phone (signed in with the same Google account) watches one, the server says so, and Buddy then reports every
 * second or so with that session's newest items whenever they changed. Words sent from the phone come back the same
 * way, and Buddy types them into the session's terminal (terminal.js), as Claude mode in the panel does.
 *
 * The server keeps only what the phone watches, and only while it watches (web/lib/remote.js); turning the switch off
 * deletes what it kept.
 */

const crypto = require('node:crypto');
const os = require('node:os');
const { BuddyError } = require('../../../shared/errors');

const IDLE_MS = 8000; // nobody watches: the sessions are reported this often, so the phone's list stays fresh
const WATCHED_MS = 1500; // the phone watches: its session's new items go this often
const FAILED_MS = 15_000; // the server could not be reached: the next try waits this long
const ITEMS_SENT = 200;
const ON_LINE = "Your phone and your other computers (signed in with the same Google account) can watch a session here and send it messages. While one watches, that session goes through Buddy's server.";
const OFF_LINE = 'Watch your Claude Code sessions here from your phone or another computer, and send them messages.';
const SIGN_IN = 'Sign in to Buddy to use this.';

const defaultLater = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  timer.unref?.();
  return timer;
};

/**
 * This computer, as the person's other devices see it: an id made once and kept in the settings, and its name ("Akshat's
 * MacBook Air", from macOS; the host name elsewhere). `run` is execFileSync, passed in by the unit tests.
 */
function thisDevice({ store, platform = process.platform, run = require('node:child_process').execFileSync, hostname = os.hostname }) {
  let id = store.get('deviceId');
  if (typeof id !== 'string' || !/^[\w-]{8,64}$/.test(id)) {
    id = crypto.randomUUID();
    store.set({ deviceId: id });
  }
  let name = '';
  if (platform === 'darwin') {
    try {
      name = String(run('/usr/sbin/scutil', ['--get', 'ComputerName'], { timeout: 2000 })).trim();
    } catch {
      // the host name below
    }
  }
  if (!name) name = hostname().replace(/\.local$/, '');
  return { id, name: name.slice(0, 60) || 'Computer' };
}

/**
 * `cloud` is cloud.js's (remoteMac), `live` live.js's, `terminal` terminal.js's, `device` thisDevice()'s; `signedIn()`
 * says whether someone is signed in, `active()` whether Buddy is on. The timers are passed in by the unit tests.
 */
function createShare({
  store, cloud, live, terminal, device, signedIn, active = () => true, later = defaultLater, cancel = clearTimeout,
}) {
  let timer = null;
  let running = false;
  let watch = null; // the session the phone watches, as the server last said
  let sentKey = null; // what was last sent of it: no need to send the same again
  const done = []; // ids of words from the phone that were typed (or could not be), to tell the server
  const handled = new Set(); // and all of them this run, so that words are never typed twice
  let turn = 0; // one more with each start or stop: a report from before is dropped

  const on = () => store.get('shareClaudeToPhone') === true;
  const wanted = () => on() && signedIn() && active();

  /** What the server needs to know about the watched session, when it changed since it was last sent. */
  function feedOf(id) {
    const view = live.view(id);
    if (!view) return null;
    // Claude's thinking is for the panel here only: the phone draws a kind it does not know as a plain line.
    const items = view.items.filter((item) => item.kind !== 'thinking').slice(-ITEMS_SENT);
    const key = `${id}:${view.status}:${view.canTalk}:${items.length}:${items.length ? items[items.length - 1].id : 0}`;
    if (key === sentKey) return null;
    sentKey = key;
    return { id: view.id, name: view.name, title: view.title ?? null, status: view.status, canTalk: view.canTalk, items };
  }

  /** Type each new word from the phone into its session's terminal; one that cannot be typed is let go, with a note. */
  async function typeAll(inbox) {
    for (const m of inbox) {
      if (handled.has(m.id)) continue;
      handled.add(m.id);
      done.push(m.id);
      const target = live.target(m.sessionId);
      try {
        await terminal.type({ tty: target?.tty ?? null, text: m.text });
      } catch (err) {
        console.warn('[buddy] could not type what the phone sent:', err.code || err.name);
      }
    }
  }

  async function report() {
    const mine = turn;
    await live.discover();
    const body = { device, sessions: live.list() };
    if (watch) {
      await live.refresh(watch);
      const feed = feedOf(watch);
      if (feed) body.feed = feed;
    }
    if (done.length) body.done = [...done];
    let r;
    try {
      r = await cloud.remoteMac(body);
    } catch (err) {
      if (body.feed) sentKey = null; // it did not get there: send it again next time
      throw err;
    }
    if (mine !== turn) return false;
    done.splice(0, body.done?.length ?? 0);
    const next = typeof r?.watch === 'string' ? r.watch : null;
    const newWatch = next !== watch && next !== null;
    if (next !== watch) {
      watch = next;
      sentKey = null; // a new watch (or the same one again): its items go in full
    }
    if (Array.isArray(r?.inbox)) await typeAll(r.inbox.filter((m) => m && typeof m.id === 'string' && typeof m.text === 'string'));
    return newWatch;
  }

  function schedule(ms) {
    timer = later(tick, ms);
  }

  async function tick() {
    timer = null;
    if (!running) return;
    if (!wanted()) {
      stop();
      return;
    }
    const mine = turn;
    let wait;
    try {
      // The phone has just begun to watch: its session's items go at once, so that it is not kept waiting.
      wait = (await report()) ? 0 : watch ? WATCHED_MS : IDLE_MS;
    } catch (err) {
      if (!(err instanceof BuddyError)) console.warn('[buddy] could not share the Claude Code sessions:', err.message);
      wait = FAILED_MS;
    }
    if (running && mine === turn) schedule(wait);
  }

  /** Start sharing, when it is wanted: the first report goes at once. */
  function start() {
    if (running || !wanted()) return;
    running = true;
    turn += 1;
    watch = null;
    sentKey = null;
    schedule(0);
  }

  function stop() {
    if (!running) return;
    running = false;
    turn += 1;
    cancel(timer);
    timer = null;
    watch = null;
  }

  /** The switch. Off: sharing stops, and the server forgets what it kept for this person. */
  async function setOn(value) {
    store.set({ shareClaudeToPhone: value });
    if (value) {
      start();
    } else {
      stop();
      if (signedIn()) await cloud.remoteMac({ device, off: true }).catch((err) => console.warn('[buddy] could not stop sharing:', err.code || err.message));
    }
    return status();
  }

  function status() {
    if (!signedIn()) return { on: on(), canTurnOn: false, line: SIGN_IN };
    return { on: on(), canTurnOn: true, line: on() ? ON_LINE : OFF_LINE };
  }

  return { start, stop, setOn, status, isRunning: () => running };
}

module.exports = { IDLE_MS, WATCHED_MS, FAILED_MS, ON_LINE, OFF_LINE, SIGN_IN, thisDevice, createShare };
