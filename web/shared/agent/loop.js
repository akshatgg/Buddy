'use strict';

/**
 * One agent job (spec §4.3): look, think, check the risk, act, and again, until the AI says done or stuck, or a limit,
 * a stop or an error ends it. Platform-free: the brain, the hands and the questions come from outside, so the Mac,
 * Windows and the tests use the same loop (Android ports it).
 */

const { parseStep, describe } = require('./actions');
const { riskOf, isPasswordApp } = require('./safety');

const LOOP_LINES = {
  stopped: 'Stopped.',
  locked: 'The screen locked, so I stopped.',
  tookOver: 'You took over. Say "go on" when you want me to continue, or press Stop.',
  sameThing: 'I keep trying the same thing.',
  failing: 'Three steps in a row did not work.',
  badReplies: "My AI's answers didn't make sense.",
  passwordApp: "I don't touch password apps.",
};
const KEEP_LOG = 12;
const MAX_FAILS = 3;
const MAX_REPEATS = 3;
const MAX_BAD = 2;
const MAX_ASKS = 2;

const goOnHeard = (text) => /\b(go on|continue|carry on|done|ho gaya|okay|ok|chalo|aage)\b/i.test(String(text || ''));
const cut = (text, max) => String(text).slice(0, max);
const sig = (o) => [o.app?.id, o.window?.title, ...(o.elements || []).map((e) => `${e.role}|${e.name}|${e.value ?? ''}|${e.state ?? ''}`)].join('\n');

function createAgentJob({
  goal, brain, hands, gate, show = () => {}, limits, vision = true, abilities, now = Date.now,
  sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); }),
}) {
  const controller = new AbortController();
  const { signal } = controller;
  const steps = [];
  let stopped = null;
  let pauseAsked = false;

  function stop(reason = 'person') {
    if (stopped) return;
    stopped = reason;
    controller.abort();
  }
  function pause() { pauseAsked = true; }

  function logLines() {
    const lines = steps.map((s, i) => `${i + 1}. ${s.line}`);
    if (lines.length <= KEEP_LOG) return lines;
    return [`(${lines.length - KEEP_LOG} earlier steps not shown)`, ...lines.slice(-KEEP_LOG)];
  }
  function sofar() {
    const done = steps.filter((s) => s.result === 'ok' && s.say).slice(-3).map((s) => s.say.replace(/(…|\.\.\.)$/, ''));
    return done.length ? ` I got as far as: ${done.join(', ')}.` : '';
  }
  function end(kind, text = '') {
    let line = text;
    if (kind === 'stuck') line = `I couldn't finish. ${text}${sofar()}`;
    if (kind === 'limit') line = `I couldn't finish in ${limits.maxSteps} steps.${sofar()}`;
    if (kind === 'stopped') line = stopped === 'locked' ? LOOP_LINES.locked : LOOP_LINES.stopped;
    return { end: kind, line, steps: steps.map(({ say, line: l, result }) => ({ say, line: l, result })) };
  }

  /**
   * One acting step: checked against the screen and its risk, asked about when it must be, then done with the job's
   * signal (a stop aborts it). Risk is decided here before every act, from the hands' canonical view of the action and
   * their risk context; the hands decide it again and want the exact question approved ("needs_approval" otherwise).
   * Approval is for this one step only. Answers { result: 'ok'|'failed'|'refused'|'declined'|'stopped', text, output? }.
   */
  async function tryAct(action, observation, risky) {
    const elements = observation.elements || [];
    if (action.id && !elements.some((e) => e.id === action.id)) {
      return { result: 'failed', text: `failed: ${action.id} is not on the screen now; look again` };
    }
    if ((action.type === 'click_at' || action.type === 'drag') && !observation.screen) {
      return { result: 'failed', text: 'failed: needs a screenshot first; use look' };
    }
    const risk = riskOf(await hands.canonical(action), await hands.riskContext(action, observation, { risky }));
    if (risk.risk === 'never') return { result: 'refused', text: `not allowed: ${risk.reason}` };
    let approved = null;
    let asks = 0;
    const askPerson = async (question) => {
      asks += 1;
      show({ kind: 'ask', text: question });
      const answer = await gate.ask(question, { signal });
      if (stopped) return 'stopped';
      return answer === 'yes' ? 'yes' : 'no';
    };
    if (risk.risk === 'ask') {
      const answer = await askPerson(risk.question);
      if (answer === 'stopped') return { result: 'stopped' };
      if (answer !== 'yes') return { result: 'declined', text: 'the person said no' };
      approved = risk.question;
    }
    for (;;) {
      if (stopped) return { result: 'stopped' };
      const options = { signal, risky };
      if (approved) options.approved = approved;
      const done = await hands.act(action, observation, options);
      if (stopped) return { result: 'stopped' };
      if (done.ok) return { result: 'ok', text: done.note ? `ok: ${cut(done.note, 200)}` : 'ok', output: done.output };
      if (done.code === 'needs_approval' && done.question && asks < MAX_ASKS) {
        const answer = await askPerson(done.question);
        if (answer === 'stopped') return { result: 'stopped' };
        if (answer !== 'yes') return { result: 'declined', text: 'the person said no' };
        approved = done.question;
        continue;
      }
      const note = cut(done.note || done.code || 'it did not work', 200);
      if (done.code === 'needs_approval') return { result: 'refused', text: `not allowed: ${note}` };
      if (done.code === 'refused') return { result: 'refused', text: `not allowed: ${note}` };
      if (done.code === 'stopped') return { result: 'stopped' };
      return { result: 'failed', text: `failed: ${note}` };
    }
  }

  async function run() {
    const started = now();
    let calls = 0;
    let shots = 0;
    let fails = 0;
    let bad = 0;
    let wantShot = false;
    let note = '';
    let lastOutput = '';
    const repeats = new Map();
    try {
      for (;;) {
        if (stopped) return end('stopped');
        if (pauseAsked) {
          pauseAsked = false;
          const go = await gate.handover(LOOP_LINES.tookOver, { signal, tookOver: true });
          if (stopped) return end('stopped');
          if (!go) { stop('person'); return end('stopped'); }
        }
        if (calls >= limits.maxSteps || now() - started > limits.maxMs) return end('limit');
        let observation = await hands.observe({ screenshot: vision && wantShot && shots < limits.maxShots });
        // A password app (spec §7.4): the job stops here, and the AI never sees what is in it.
        if (isPasswordApp(observation.app)) return { ...end('stuck'), line: LOOP_LINES.passwordApp };
        if (!observation.screen && vision && shots < limits.maxShots && observation.treeQuality !== 'good' && !observation.secureFocused) {
          observation = await hands.observe({ screenshot: true });
          if (isPasswordApp(observation.app)) return { ...end('stuck'), line: LOOP_LINES.passwordApp };
        }
        if (observation.screen) shots += 1;
        wantShot = false;
        if (stopped) return end('stopped');
        calls += 1;
        const raw = await brain.step({ goal, log: logLines(), lastOutput, note, observation, step: calls, maxSteps: limits.maxSteps }, { signal });
        if (stopped) return end('stopped');
        note = '';
        lastOutput = '';
        const step = parseStep(raw, abilities ? { abilities } : undefined);
        if (!step.ok) {
          bad += 1;
          if (bad >= MAX_BAD) return end('stuck', LOOP_LINES.badReplies);
          note = step.error;
          continue;
        }
        bad = 0;
        const { action } = step;
        const record = (result, text) => steps.push({ say: step.say, action, result, line: `${describe(action)} → ${text || result}` });
        if (step.say && action.type !== 'done' && action.type !== 'stuck') show({ kind: 'step', text: step.say });
        if (action.type === 'done') return end('done', action.summary);
        if (action.type === 'stuck') return end('stuck', action.reason);
        if (action.type === 'look') { wantShot = true; record('ok'); continue; }
        if (action.type === 'wait') { await sleep(action.ms); record('ok'); continue; }
        if (action.type === 'ask_user') {
          const answer = await gate.askUser(action.question, { signal });
          if (stopped) return end('stopped');
          record('ok', answer ? `they said: ${cut(answer, 200)}` : 'no answer');
          continue;
        }
        if (action.type === 'handover') {
          const go = await gate.handover(action.why, { signal });
          if (stopped) return end('stopped');
          if (!go) { stop('person'); return end('stopped'); }
          record('ok', 'the person did it');
          continue;
        }
        const tried = await tryAct(action, observation, step.risky);
        if (stopped || tried.result === 'stopped') return end('stopped');
        record(tried.result, tried.text);
        if (tried.result === 'ok') lastOutput = tried.output ? cut(tried.output, 2000) : '';
        if (action.type === 'click_at' || action.type === 'drag' || tried.result === 'failed') wantShot = true;
        // Three failures in a row (a refusal is one too), or the same step on the same screen three times (a "no" too).
        if (tried.result === 'ok') fails = 0;
        else if (tried.result !== 'declined') fails += 1;
        const key = `${sig(observation)}\n${JSON.stringify(action)}`;
        const seen = (repeats.get(key) || 0) + 1;
        repeats.set(key, seen);
        if (fails >= MAX_FAILS) return end('stuck', LOOP_LINES.failing);
        if (seen >= MAX_REPEATS) return end('stuck', LOOP_LINES.sameThing);
      }
    } catch (err) {
      if (stopped) return end('stopped');
      return { ...end('error', err?.message || 'Something went wrong.'), error: err };
    }
  }

  return { run, stop, pause, get steps() { return steps.slice(); } };
}

module.exports = { createAgentJob, goOnHeard, LOOP_LINES };
