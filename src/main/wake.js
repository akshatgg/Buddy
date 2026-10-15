'use strict';

const { WAKE_FLOOR, REQUEST, WAKE_LINES, VOICE_LINES, wakePhrase, wakeMissing } = require('../../shared/voice-words');

/**
 * "Hey <name>" on the Mac: the ear window listens for the phrase all the time, on the device (nothing leaves the Mac before
 * it). This decides when it may listen (shouldListen), tells the ear page the phrase, and sends what is said after a wake
 * the same way the panel's 🎤 does: written down, then a spoken chat in the panel (actions.voice). Any card that comes of it
 * is still asked aloud and needs its yes. It pauses while the Mac is locked or asleep, while the panel records, and while a
 * spoken turn runs; it resumes after.
 */

const TEST_MS = 10000; // "Test it" listens this long
const NO_INTERNET = ['network', 'timeout'];
const MIC_LINE = 'Allow the microphone in Settings.';

/** Whether the ear may listen now. Every rule must hold. */
function shouldListen({ wakeOn, buddyOn, signedIn, voiceOn, mic, modelReady, nameOk, locked, asleep, panelListening, turn }) {
  return Boolean(wakeOn && buddyOn && signedIn && voiceOn && mic === 'granted' && modelReady && nameOk
    && !locked && !asleep && !panelListening && !turn);
}

function createWake({
  store, ear, model, lock, microphone, power, account, cloud, powerMonitor, actions, talkBack, testMs = TEST_MS,
}) {
  let panel = false; // the panel's 🎤 records
  let turns = 0; // spoken turns running (a say, hear or listen of Buddy's own)
  let asleep = false;
  let locked = false;
  let sent = null; // what the ear page was last told: null (not listening) or the phrase it listens for
  let testing = null; // { count, finish } while "Test it" runs
  let modelFailed = false;

  const name = () => String(store.get('buddyName') ?? '').trim();
  const phrase = () => wakePhrase(name());
  const nameOk = () => Boolean(phrase()) && wakeMissing(name(), [...model.missing()]).length === 0;
  const signedIn = () => account.isSignedIn();
  const voiceOn = () => signedIn() && cloud.last()?.voiceOn === true && cloud.last()?.blocked !== true;

  const inputs = () => ({
    wakeOn: store.get('wakeOn') === true,
    buddyOn: power.isOn(),
    signedIn: signedIn(),
    voiceOn: voiceOn(),
    mic: microphone.status(),
    modelReady: model.ready(),
    nameOk: nameOk(),
    locked,
    asleep,
    panelListening: panel,
    turn: turns > 0,
  });

  /** Why it is not listening (a line for Settings), or null when the person did not ask for it. */
  function reason(i) {
    if (!i.wakeOn) return null;
    if (!i.nameOk) return WAKE_LINES.cantListen(name());
    if (!i.signedIn) return WAKE_LINES.signIn;
    if (i.mic !== 'granted') return MIC_LINE;
    if (!i.modelReady) return modelFailed ? WAKE_LINES.earsFailed : WAKE_LINES.gettingEars;
    return null;
  }

  function getModel() {
    if (model.ready() || !model.ensure) return;
    modelFailed = false;
    Promise.resolve(model.ensure()).then(() => { modelFailed = false; apply(); }, (err) => {
      modelFailed = true;
      console.warn('[buddy] voice model:', err?.code || err?.message);
    });
  }

  /** Brings the ear page in line with the rules: it listens for the phrase, or it does not. */
  function apply() {
    const i = inputs();
    const want = shouldListen(i) ? phrase() : null;
    const resting = i.wakeOn && !i.asleep; // keeps the window through a pause: a pause is short
    ear.keep(Boolean(want || (resting && i.nameOk && i.signedIn && i.mic === 'granted' && i.modelReady)));
    if (want === sent) return;
    sent = want;
    ear.wake(want ? { phrase: want, floor: WAKE_FLOOR, request: REQUEST, testOnly: testing !== null } : null);
    if (!want && !i.wakeOn && !turns) ear.close?.();
  }

  function refresh() {
    locked = Boolean(lock?.locked());
    const i = inputs();
    if (i.wakeOn && i.nameOk && i.signedIn && i.mic === 'granted' && !i.modelReady) getModel();
    apply();
  }

  powerMonitor.on('lock-screen', () => { locked = true; apply(); });
  powerMonitor.on('unlock-screen', () => { locked = false; apply(); });
  powerMonitor.on('suspend', () => { asleep = true; apply(); });
  powerMonitor.on('resume', () => { asleep = false; apply(); });

  async function onRequest(msg) {
    if (testing) return; // a test never acts on what follows
    if (store.get('wakeOn') !== true) return;
    try {
      const audio = msg && msg.audio;
      const words = audio ? String((await actions.transcribe(audio, 'audio/wav')).text ?? '').trim() : '';
      if (!words) {
        await talkBack?.say(WAKE_LINES.notCaught(name()));
        return;
      }
      await actions.voice(words);
    } catch (err) {
      console.warn('[buddy] wake:', err?.code || err?.message);
      if (NO_INTERNET.includes(err?.code)) await talkBack?.say(VOICE_LINES.noInternet).catch(() => {});
    }
  }

  ear.on('woke', () => {
    if (testing) testing.count += 1;
  });
  ear.on('request', onRequest);
  // The ear's page crashed or was closed under the loop: ask for it again a little later (not at once: a page that will not load would loop).
  ear.on('gone', () => {
    sent = null;
    setTimeout(apply, 5000);
  });

  return {
    refresh,
    panelListening(on) {
      panel = Boolean(on);
      apply();
    },
    /** A spoken turn (Buddy's say, hear or listen) begins or ends: the loop waits for it. */
    turn(on) {
      turns = Math.max(0, turns + (on ? 1 : -1));
      apply();
    },
    /** Listens for the phrase for 10 s and answers how many times it was heard. */
    test() {
      if (!shouldListen(inputs()) || testing) return Promise.resolve(0);
      return new Promise((resolve) => {
        testing = { count: 0 };
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
    state() {
      const i = inputs();
      if (!i.wakeOn) return { on: false, line: null };
      const why = reason(i);
      return why ? { on: false, line: why } : { on: true, line: WAKE_LINES.listening(name()) };
    },
  };
}

module.exports = { createWake, shouldListen };
