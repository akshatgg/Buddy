'use strict';

const { WAKE_FLOOR, REQUEST, WAKE_LINES, VOICE_LINES, wakePhrase, wakePhrases, wakeNameHeard } = require('../../shared/voice-words');

/**
 * "Hey <name>" on the Mac: the ear window listens for the phrase all the time, on the device (nothing leaves the Mac before
 * it). This decides when it may listen (shouldListen), tells the ear page the phrases ("Hey Buddy", "Buddy", and the name's two when the model can hear it), and sends what is said after a wake
 * the same way the panel's 🎤 does: written down, then a spoken chat in the panel (actions.voice). Any card that comes of it
 * is still asked aloud and needs its yes. It pauses while the Mac is locked or asleep, while the panel records, and while a
 * spoken turn runs; it resumes after.
 */

const TEST_MS = 10000; // "Test it" listens this long
const NO_INTERNET = ['network', 'timeout'];
const MIC_LINE = 'Allow the microphone in Settings.';
const BUSY_LINE = "I'm still on the last one. Ask me again in a moment.";
// vosk-browser 0.0.8 has no call to ask whether the model knows a word, so a name the model does not know is only caught by the
// static list (model.missing). Such a name is not a reason to stop: "Hey Buddy" still wakes it. Under the switch, Settings says what to do when Test it does not hear the person.
const SPELLING_HINT = WAKE_LINES.spellingHint;

/** The name as shown and said: the same (at most) three words that are listened for. */
function shownName(name) {
  const full = String(name ?? '').trim();
  const phrase = wakePhrase(full);
  if (!phrase) return full;
  const words = phrase.split(' ').slice(1);
  const tokens = full.split(/\s+/);
  if (tokens.length <= 3 && tokens.every((w) => /^\p{L}+$/u.test(w))) return full;
  return words.map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
}

/** Whether the ear may listen now. Every rule must hold. */
function shouldListen({ wakeOn, buddyOn, signedIn, voiceOn, mic, modelReady, locked, asleep, panelListening, turn }) {
  return Boolean(wakeOn && buddyOn && signedIn && voiceOn && mic === 'granted' && modelReady
    && !locked && !asleep && !panelListening && !turn);
}

function createWake({
  store, ear, model, lock, microphone, power, account, cloud, powerMonitor, actions, talkBack, testMs = TEST_MS, busy = () => false, onChange = null,
  myVoice = null, // "Only my voice" (my-voice.js): when on, a wake counts only when its phrase clip is the owner's
}) {
  let panel = false; // the panel's 🎤 records
  let turns = 0; // spoken turns running (a say, hear or listen of Buddy's own)
  let asleep = false;
  let locked = false;
  let sent = null; // what the ear page was last told: null (not listening) or the phrases it listens for, joined
  let testing = null; // { count, finish } while "Test it" runs
  let clipping = null; // { phrase, onClip } while "Only my voice" setup collects takes of the phrase (clips())
  let modelFailed = false;
  let percent = 0; // the model download, while it runs
  const listeners = onChange ? [onChange] : [];
  const changed = () => { for (const fn of listeners) fn(stateOf()); }; // Settings follows the download and the switch live

  const name = () => String(store.get('buddyName') ?? '').trim();
  const phrases = () => wakePhrases(name(), [...model.missing()]);
  const nameHeard = () => wakeNameHeard(name(), [...model.missing()]); // "Hey <name>" wakes it too, not only "Hey Buddy"
  // A name the model can't hear (not Buddy itself): only a hint, "Hey Buddy" still works.
  const nameHint = () => name() !== '' && wakePhrase(name()) !== 'hey buddy' && !nameHeard();
  const signedIn = () => account.isSignedIn();
  const voiceOn = () => signedIn() && cloud.last()?.voiceOn === true && cloud.last()?.blocked !== true;

  const inputs = () => ({
    wakeOn: store.get('wakeOn') === true,
    buddyOn: power.isOn(),
    signedIn: signedIn(),
    voiceOn: voiceOn(),
    mic: microphone.status(),
    modelReady: model.ready(),
    locked,
    asleep,
    panelListening: panel,
    turn: turns > 0,
  });

  /** Why it is not listening (a line for Settings), or null when the person did not ask for it. */
  function reason(i) {
    if (!i.wakeOn) return null;
    if (!i.signedIn) return WAKE_LINES.signIn;
    if (i.mic !== 'granted') return MIC_LINE;
    if (!i.modelReady) return modelFailed ? WAKE_LINES.earsFailed : WAKE_LINES.gettingEars;
    return null;
  }

  function getModel() {
    if (model.ready() || !model.ensure) return;
    modelFailed = false;
    percent = 0;
    Promise.resolve(model.ensure({
      onProgress: (p) => { if (p !== percent) { percent = p; changed(); } },
    })).then(() => { modelFailed = false; apply(); changed(); }, (err) => {
      // Like Android: the switch goes off, the line says the ears failed, and turning it on again tries again.
      modelFailed = true;
      console.warn('[buddy] voice model:', err?.code || err?.message);
      store.set({ wakeOn: false });
      apply();
      changed();
    });
  }

  /** Brings the ear page in line with the rules: it listens for the phrase, or it does not. */
  function apply() {
    const i = inputs();
    const want = shouldListen(i) ? (clipping ? [clipping.phrase] : phrases()) : null;
    // The window stays through every pause, sleep too: waking from sleep must not send the 37 MB model to a new page.
    ear.keep(Boolean(want || (i.wakeOn && i.signedIn && i.mic === 'granted' && i.modelReady)));
    const key = want ? want.join('|') : null;
    if (key === sent) return;
    sent = key;
    if (want && myVoice?.on()) myVoice.warm?.(); // the first check should not wait for the engine to load
    ear.wake(want ? { phrases: want, floor: WAKE_FLOOR, request: REQUEST, testOnly: testing !== null || clipping !== null } : null);
    if (!want && !i.wakeOn && !turns) ear.close?.();
  }

  function refresh() {
    locked = Boolean(lock?.locked());
    const i = inputs();
    if (i.wakeOn && i.signedIn && i.mic === 'granted' && !i.modelReady) getModel();
    apply();
  }

  powerMonitor.on('lock-screen', () => { locked = true; apply(); });
  powerMonitor.on('unlock-screen', () => { locked = false; apply(); });
  powerMonitor.on('suspend', () => { asleep = true; apply(); });
  powerMonitor.on('resume', () => { asleep = false; apply(); });

  async function onRequest(msg) {
    if (clipping || testing) return; // a test, or setting up Only my voice, never acts on what follows
    if (store.get('wakeOn') !== true) return;
    // Only my voice: anyone else gets silence -- not transcribed, not sent anywhere, not even the busy line.
    if (myVoice?.on() && !(await myVoice.allows(msg?.phrase))) return;
    // A spoken turn or the chat is busy: nothing is sent to be written down, and the person is told, not ignored.
    if (turns > 0 || busy()) {
      await talkBack?.say(BUSY_LINE).catch?.(() => {});
      return;
    }
    try {
      const audio = msg && msg.audio;
      const words = audio ? String((await actions.transcribe(audio, 'audio/wav')).text ?? '').trim() : '';
      if (!words) return; // nothing made out: stay quiet, the person just says "Hey <name>" again
      const r = await actions.voice(words);
      if (r && r.busy) await talkBack?.say(BUSY_LINE); // the chat got busy while the words were written down
    } catch (err) {
      console.warn('[buddy] wake:', err?.code || err?.message);
      if (NO_INTERNET.includes(err?.code)) await talkBack?.say(VOICE_LINES.noInternet).catch(() => {});
    }
  }

  ear.on('woke', async (msg) => {
    if (clipping) {
      clipping.onClip(msg?.phrase ?? null); // setup takes the phrase's own audio, one take per wake
      return;
    }
    const t = testing;
    if (!t) return;
    if (myVoice?.on() && !(await myVoice.allows(msg?.phrase))) {
      if (testing === t) t.onNotYou?.(); // not after Test it has finished
      return;
    }
    if (testing !== t) return; // the test ended while the voice was checked
    t.count += 1;
    t.onHeard?.(t.count);
  });
  ear.on('request', onRequest);
  // The ear's page crashed or was closed under the loop: ask for it again a little later (not at once: a page that will not load would loop).
  ear.on('gone', () => {
    sent = null;
    setTimeout(apply, 5000);
  });

  return {
    refresh,
    /** Whether "Hey <name>" wakes it besides "Hey Buddy" (for the copy in Settings). */
    nameHeard: (n) => wakeNameHeard(n ?? name(), [...model.missing()]),
    panelListening(on) {
      panel = Boolean(on);
      apply();
    },
    /** A spoken turn (Buddy's say, hear or listen) begins or ends: the loop waits for it. */
    turn(on) {
      turns = Math.max(0, turns + (on ? 1 : -1));
      apply();
    },
    /**
     * While "Only my voice" is set up: the ear listens for `phrase` alone, in test mode, and `onClip(base64 PCM16 | null)`
     * gets the phrase's own audio at each wake. It never takes a request. Answers stop(). The loop must be able to listen.
     */
    clips(phrase, onClip) {
      const mine = { phrase, onClip };
      clipping = mine;
      sent = null;
      apply();
      return () => {
        if (clipping !== mine) return;
        clipping = null;
        sent = null;
        apply();
      };
    },
    /**
     * Listens for the phrases for 10 s and answers how many times it was heard; `onHeard(n)` hears each one as it comes.
     * With "Only my voice" on, a wake counts only when it is the owner's; `onNotYou()` hears each one that was not.
     */
    test(onHeard, onNotYou) {
      if (clipping || !shouldListen(inputs()) || testing) return Promise.resolve(0);
      return new Promise((resolve) => {
        testing = { count: 0, onHeard, onNotYou };
        sent = null;
        apply();
        setTimeout(() => {
          const count = testing.count;
          testing = null;
          sent = null;
          apply();
          resolve(count);
        }, testMs);
      });
    },
    /** Settings hears each change of the state (the download's progress, its end or failure, the switch turned off). */
    onChange(fn) {
      listeners.push(fn);
    },
    state: stateOf,
  };

  function stateOf() {
    const i = inputs();
    if (!i.wakeOn) return { on: false, line: modelFailed && !model.ready() ? WAKE_LINES.earsFailed : null };
    const why = reason(i);
    if (!why) {
      const line = WAKE_LINES.listening(shownName(name()), nameHeard());
      return nameHint() ? { on: true, line, hint: WAKE_LINES.cantListen(shownName(name())) } : { on: true, line };
    }
    return !i.modelReady && !modelFailed ? { on: false, line: why, percent } : { on: false, line: why };
  }
}

module.exports = { createWake, shouldListen, shownName, SPELLING_HINT };
