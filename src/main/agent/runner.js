'use strict';

/**
 * One computer-agent job at a time on the Mac (spec §3, §7.3, §10): checks the switch, the permissions, the first-job
 * question and the AI's rank, then runs the shared loop (shared/agent/loop.js) with the Mac's hands, showing each step
 * in the speech bubble with a Stop button. A risky step is asked in the bubble (Yes / No), out loud too in a spoken job,
 * and a yes or no typed in the chat answers it as well (reply); only a yes acts. The AI's own question for the person
 * (ask_user) waits for their typed or spoken answer. Stop comes from the bubble, Esc (the helper's watchStop), "Hey
 * Buddy" (wake.js) or the tray; the screen locking stops the job at once (lock.onLocked). Nothing a job sees is logged.
 */

const crypto = require('node:crypto');
const { BuddyError } = require('../../../shared/errors');
const { createAgentJob, goOnHeard, LOOP_LINES } = require('../../../shared/agent/loop');
const { formatScreen } = require('../../../shared/agent/prompt');
const { limitsFor, warningFor } = require('../../../shared/agent/limits');
const { MAC_ABILITIES } = require('../../../shared/agent/actions');
const { heardAnswer } = require('../../../shared/voice-words');

// How long Buddy waits for the person (spec §3, §7.3): a yes or no, an answer to the AI's question, a part they do
// themselves, and "go on" after they took over by themselves.
const RUNNER_WAITS = { ask: 60_000, askUser: 120_000, handover: 120_000, tookOver: 30_000 };
const YES_VERB = 'do'; // talk-back.js hear() and voice-words.js heardAnswer(): "do it", "kar do", "haan" are a yes
const LISTEN_AGAIN_MS = 1000; // a listen that heard nothing (or failed): a short rest before the next, never a tight loop
const RUNNER_LINES = {
  off: 'Using your Mac is off. Turn it on in Settings → Permissions.',
  consent: 'I will click and type in your apps for you. I always ask before deleting, paying, sending or changing settings. Okay?',
  declined: "Okay, I won't.",
  freeWeak: "The free AI can't use your computer. Add your own key in Settings.",
  busy: "I'm busy with a job. Say stop first.",
  noAccess: 'Buddy needs Accessibility to use your Mac. Open Settings to allow it.',
  typeAnswer: 'Click here to type your answer.',
  tapYes: 'Tap Yes to confirm.',
  noRoute: {
    signed_out: 'Sign in to Buddy first, then I can use your Mac.',
    blocked: 'Your free access is paused, so I cannot do jobs now.',
    network: "Couldn't reach Buddy's server. Check your internet.",
    no_key: 'Add your own API key in Settings first.',
  },
  noRouteElse: 'I have no AI to use right now. Check Settings.',
};
const rest = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

function createAgentRunner({
  ai, hands, helper, talkBack = null, ui, lock, store, memory, myVoice = null, userName = () => '', randomId = () => crypto.randomUUID(), newToken = () => crypto.randomUUID(),
  onChange = () => {}, waits = RUNNER_WAITS,
}) {
  let job = null; // { loop, gateOpen, stopped }
  let waiting = null; // what the job waits on from the person: { kind: 'ask'|'askUser'|'handover', done(value) }

  const running = () => job !== null;
  /** A stop (or a locked screen) so far: checked after every await before anything more is asked or said. */
  const halted = () => {
    if (!job) return null;
    if (!job.stopped && lock.locked()) stop('locked'); // a real stop: the loop, a waiting question and the voice end too
    return job.stopped;
  };
  const cancelWait = () => waiting?.done(null);
  const stoppedEnd = () => ({ end: 'stopped', line: job?.stopped === 'locked' ? LOOP_LINES.locked : LOOP_LINES.stopped, steps: [] });

  function stop(reason = 'person') {
    if (!job) return;
    if (!job.stopped) job.stopped = reason;
    job.loop?.stop(reason);
    cancelWait(); // a question waiting is a no
    talkBack?.stop?.();
  }

  /**
   * A bubble button: Stop always; Yes / No for a risky step; Go on for a hand-over. A press must carry the token of the
   * question now waiting: a press of an older bubble (or with nothing waiting) is dropped.
   */
  function button(name, token) {
    if (name === 'stop') {
      stop('person');
      return;
    }
    if (!waiting || token !== waiting.token) return;
    if (waiting.kind === 'ask' && (name === 'yes' || name === 'no')) waiting.done(name);
    else if (waiting.kind === 'handover' && name === 'go-on') waiting.done('go-on');
  }

  /** Words typed in the chat during a job: the answer to what it waits on, if anything. True when they were taken. */
  function reply(text) {
    const words = String(text || '').trim();
    if (!waiting || !words) return false;
    if (waiting.kind === 'ask') waiting.done(heardAnswer(words, YES_VERB));
    else if (waiting.kind === 'askUser') waiting.done(words);
    else if (goOnHeard(words)) waiting.done('go-on');
    else return false;
    return true;
  }

  /** Another line (a quiet-chat speak) took the bubble while Buddy waits for the person: put the question back. */
  function reassert() {
    if (waiting) ui.speech(waiting.text, waiting.buttons, waiting.token);
  }

  /** The person typed or clicked themselves (the helper's took_over): the job pauses, unless Buddy is asking them. */
  function tookOver() {
    if (job && !job.gateOpen) job.loop?.pause();
  }

  /**
   * Shows `text` with `buttons` (under a new token) and waits for the person: a button with that token, a typed reply,
   * or nothing in `ms` (null). A stop answers null at once. The entry is `waiting` as soon as this returns.
   */
  function openWait(kind, ms, signal, text, buttons) {
    let entry = null;
    const promise = new Promise((resolve) => {
      let timer = null;
      const onAbort = () => entry.done(null);
      entry = {
        kind, text, buttons, token: newToken(),
        done(value) {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          if (waiting === entry) waiting = null;
          resolve(value);
        },
      };
      waiting = entry;
      timer = setTimeout(() => entry.done(null), ms);
      if (signal?.aborted) entry.done(null);
      else signal?.addEventListener('abort', onAbort, { once: true });
    });
    ui.speech(text, buttons, entry.token);
    return { entry, promise };
  }

  async function gated(work) {
    if (job) job.gateOpen = true;
    try {
      return await work();
    } finally {
      if (job) job.gateOpen = false;
    }
  }

  /**
   * A yes or no: the bubble's buttons or a typed answer, and in a spoken job the voice too. Only a heard "no" ends the
   * wait early; silence keeps waiting (until `waits.ask`, then no). `risky`: with "Only my voice" on, a spoken yes cannot
   * be checked as the owner's (the heard words come without the clip), so only a press or a typed yes counts.
   */
  function askYesNo(question, { spoken, signal, risky = false } = {}) {
    return gated(async () => {
      if (halted()) return 'no';
      const voiceOk = spoken && talkBack && !(risky && myVoice?.on?.());
      const line = spoken && talkBack && !voiceOk ? `${question} ${RUNNER_LINES.tapYes}` : question;
      const { entry, promise } = openWait('ask', waits.ask, signal, line, ['yes', 'no']);
      const answered = promise.then((a) => (a === 'yes' ? 'yes' : 'no'));
      if (!spoken || !talkBack) return answered;
      await talkBack.say(line);
      if (waiting !== entry || !voiceOk) return answered; // pressed, typed or stopped while it was said
      (async () => {
        while (waiting === entry && !signal?.aborted) {
          const heard = await talkBack.hear(YES_VERB, { silence: true });
          if (waiting !== entry) return;
          if (heard === 'yes' || heard === 'no') { entry.done(heard); return; }
          await rest(LISTEN_AGAIN_MS); // silence or a failure: not an answer, listen again
        }
      })();
      const result = await answered;
      talkBack.stop(); // whoever answered: stop listening
      return result;
    });
  }

  /** The person does a part themselves, then says or types "go on", or presses Go on. False: stop. */
  function handover(text, { spoken, signal, tookOver: byThemselves = false } = {}) {
    return gated(async () => {
      if (halted()) return false;
      const line = /go on/i.test(text) ? text : `${text} Then say "go on", or press Go on.`;
      const { entry, promise } = openWait('handover', byThemselves ? waits.tookOver : waits.handover, signal, line, ['go-on', 'stop']);
      const pressed = promise.then((v) => v === 'go-on');
      if (!spoken || !talkBack) return pressed;
      await talkBack.say(line);
      (async () => {
        while (waiting === entry && !signal?.aborted) {
          const words = await talkBack.listen();
          if (waiting !== entry) return;
          if (goOnHeard(words)) { entry.done('go-on'); return; }
          if (!words) await rest(LISTEN_AGAIN_MS);
        }
      })();
      const go = await pressed;
      talkBack.stop();
      return go;
    });
  }

  /** The AI's question for the person: typed in the chat, or said in a spoken job. Null: no answer in time. */
  function askUser(question, { spoken, signal } = {}) {
    return gated(async () => {
      if (halted()) return null;
      const { entry, promise } = openWait('askUser', waits.askUser, signal, `${question} ${RUNNER_LINES.typeAnswer}`, ['stop']);
      if (!spoken || !talkBack) return promise;
      await talkBack.say(question);
      if (waiting !== entry) return promise;
      (async () => {
        const words = await talkBack.listen();
        if (waiting === entry && words) entry.done(words);
      })();
      const answer = await promise;
      talkBack.stop();
      return answer;
    });
  }

  function agentInput(input, jobId) {
    const shot = input.observation.screen;
    return {
      goal: input.goal, log: input.log, lastOutput: input.lastOutput, note: input.note, step: input.step, maxSteps: input.maxSteps,
      jobId, platform: 'mac', screen: formatScreen(input.observation),
      ...(shot ? { image: shot.image, imageSize: { width: shot.width, height: shot.height } } : {}),
      userName: userName(), facts: memory.facts(),
    };
  }

  async function start({ goal, spoken = false }) {
    if (job) throw new BuddyError('bad_request', RUNNER_LINES.busy);
    job = { loop: null, gateOpen: false, stopped: null };
    onChange();
    const unlisten = lock.onLocked ? lock.onLocked(() => stop('locked')) : () => {};
    let watching = false;
    try {
      if (store.get('agentOn') === false) return { end: 'off', line: RUNNER_LINES.off, steps: [] };
      if (lock.locked()) {
        job.stopped = 'locked';
        return stoppedEnd();
      }
      const perms = await helper.call('permissions');
      if (halted()) return stoppedEnd();
      if (!perms.accessibility) throw new BuddyError('no_accessibility', RUNNER_LINES.noAccess);
      // The AI is chosen once, here, and its rank, limits and vision hold for the whole job.
      const info = await ai.brainInfo();
      if (halted()) return stoppedEnd();
      if (!info?.route) throw new BuddyError(info?.reason || 'no_route', RUNNER_LINES.noRoute[info?.reason] || RUNNER_LINES.noRouteElse);
      if (info.route === 'free' && info.rank === 'weak') throw new BuddyError('free_no_agent', RUNNER_LINES.freeWeak);
      if (store.get('agentAgreed') !== true) {
        const agreed = await askYesNo(RUNNER_LINES.consent, { spoken });
        if (halted()) return stoppedEnd();
        if (agreed !== 'yes') return { end: 'declined', line: RUNNER_LINES.declined, steps: [] };
        store.set({ agentAgreed: true });
      }
      const vision = info.vision && perms.screenRecording === true;
      const warning = warningFor({ label: info.label, rank: info.rank, vision });
      if (warning) {
        const go = await askYesNo(warning, { spoken });
        if (halted()) return stoppedEnd();
        if (go !== 'yes') return { end: 'declined', line: RUNNER_LINES.declined, steps: [] };
      }
      const jobId = randomId();
      if (halted()) return stoppedEnd();
      ui.mood('thinking');
      await helper.call('watchStop', { on: true }).then(() => { watching = true; }, () => {});
      if (halted()) return stoppedEnd();
      const brain = {
        step: async (input, { signal }) => {
          // ai.ask adds its own timeout to the job's signal
          return (await ai.ask('agent', agentInput(input, jobId), { signal })).text;
        },
      };
      const guarded = {
        observe: (o) => hands.observe(o),
        canonical: (a) => hands.canonical(a),
        riskContext: (a, o, opts) => hands.riskContext(a, o, opts),
        exists: (p, o) => hands.exists(p, o),
        elementAt: hands.elementAt ? (...a) => hands.elementAt(...a) : undefined,
        act: async (action, observation, options) => {
          if (lock.locked()) {
            stop('locked');
            return { ok: false, code: 'locked', note: 'The screen locked.' };
          }
          return hands.act(action, observation, options); // options.signal: a stop kills a running command
        },
      };
      const gate = {
        ask: (q, o) => askYesNo(q, { spoken, risky: true, ...o }),
        askUser: (q, o) => askUser(q, { spoken, ...o }),
        handover: (t, o) => handover(t, { spoken, ...o }),
      };
      const loop = createAgentJob({
        goal, brain, hands: guarded, gate, show: (e) => { if (e.kind === 'step') ui.speech(e.text, ['stop']); },
        limits: limitsFor(info.rank), vision, abilities: MAC_ABILITIES,
      });
      job.loop = loop;
      if (job.stopped) loop.stop(job.stopped);
      const result = await loop.run();
      if (result.end === 'error') throw result.error;
      return result;
    } finally {
      unlisten();
      if (watching) helper.call('watchStop', { on: false }).catch(() => {});
      job = null;
      waiting = null;
      onChange();
    }
  }

  return { start, stop, button, reply, tookOver, reassert, running };
}

module.exports = { createAgentRunner, RUNNER_WAITS, RUNNER_LINES };
