'use strict';

const { riskOf } = require('../../shared/agent/safety');

/**
 * A tiny pretend Mac for agent tests: screens by name, each with its elements; acts move between screens by a table.
 * `brain(replies)` answers each step with the next reply (an object is sent as JSON, a string as it is, an Error is
 * thrown, a function gets the step's input).
 */

const el = (id, role, name, extra = {}) => ({ id, role, name, depth: 0, ...extra });

function fakeHands({ screens, start, moves = {}, exists = [], fail = [] }) {
  let at = start;
  const acts = [];
  const actOptions = []; // what each act was given besides the action ({ signal, approved, risky })
  const looks = [];
  return {
    acts,
    actOptions,
    looks,
    at: () => at,
    async observe({ screenshot = false } = {}) {
      looks.push(screenshot);
      const s = screens[at];
      return {
        app: s.app || { name: 'Finder', id: 'com.apple.finder' },
        window: { title: s.title || at },
        focused: s.focused || null,
        secureFocused: s.secureFocused === true,
        elements: s.elements,
        treeQuality: s.elements.filter((e) => e.name).length >= 5 ? 'good' : s.elements.length ? 'poor' : 'none',
        dialog: s.dialog || '',
        ...(screenshot ? { screen: { image: 'IMG', width: 100, height: 50 } } : {}),
      };
    },
    async canonical(action) { return action; },
    async riskContext(action, observation, { risky = false } = {}) {
      const e = action.id ? (observation.elements || []).find((x) => x.id === action.id) : null;
      const overwrites = action.type === 'files' && ['copy', 'move', 'rename', 'write'].includes(action.op)
        && await this.exists(action.op === 'write' ? action.path : action.to || '', action.op === 'rename' ? { from: action.path } : {});
      return {
        app: observation.app, title: observation.window?.title || '', target: e ? { role: e.role, name: e.name || '' } : null,
        dialog: observation.dialog || '', secure: observation.secureFocused === true, risky: risky === true, exists: overwrites === true,
      };
    },
    async act(action, observation, options = {}) {
      // Same contract as the real hands: it works out its own risk and wants the exact question approved.
      const r = riskOf(action, await this.riskContext(action, observation, options));
      if (r.risk === 'never') return { ok: false, code: 'refused', note: `I won't do that: ${r.reason}.` };
      if (r.risk === 'ask' && options.approved !== r.question) return { ok: false, code: 'needs_approval', note: 'I need a yes first.', question: r.question };
      actOptions.push(options);
      acts.push(action);
      const key = `${at}:${action.type}:${action.id || action.name || action.combo || ''}`;
      if (fail.includes(key)) return { ok: false, note: 'it did not work' };
      if (moves[key]) at = moves[key];
      return { ok: true, ...(action.type === 'run' ? { output: 'file1\nfile2' } : {}) };
    },
    async exists(path) { return exists.includes(path); },
  };
}

function brain(replies) {
  const inputs = [];
  return {
    inputs,
    async step(input, { signal } = {}) {
      inputs.push(input);
      if (signal?.aborted) throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      const next = replies.length ? replies.shift() : { say: '', action: { type: 'stuck', reason: 'No more replies.' } };
      if (next instanceof Error) throw next;
      const value = typeof next === 'function' ? await next(input, signal) : next;
      return typeof value === 'string' ? value : JSON.stringify(value);
    },
  };
}

function gate({ answers = [], userAnswers = [], handovers = [] } = {}) {
  const asked = [];
  const handoverOptions = []; // what each handover was given besides its text ({ signal, tookOver })
  return {
    asked,
    handoverOptions,
    async ask(question) { asked.push(['ask', question]); return answers.length ? answers.shift() : 'no'; },
    async askUser(question) { asked.push(['askUser', question]); return userAnswers.length ? userAnswers.shift() : null; },
    async handover(text, options = {}) {
      asked.push(['handover', text]);
      handoverOptions.push(options);
      return handovers.length ? handovers.shift() : false;
    },
  };
}

const step = (say, action, extra = {}) => ({ say, thought: '', action, ...extra });

module.exports = { el, fakeHands, brain, gate, step };
