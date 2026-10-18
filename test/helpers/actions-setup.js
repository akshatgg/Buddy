'use strict';

// The fakes of test/actions.test.js, shared with test/voice-safety.test.js.
const { BuddyError } = require('../../shared/errors');
const { createActions } = require('../../src/main/actions');
const { findApp } = require('../../src/main/apps');

const APP = { pid: 7, bundleId: 'com.google.Chrome', name: 'Google Chrome' };
const MAIL = { pid: 8, bundleId: 'com.apple.mail', name: 'Mail' };

/** What the AI's `chat` request gives back, read from its JSON (parseChat): this shape, with these fields set. */
const reply = (fields = {}) => ({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], ...fields });

/**
 * createActions with fakes. `answers` are what the AI gives back, one per request, in order: a reply, an error it
 * fails with, or a function of the input. `facts` are what the memory already holds, and `refuse` what it will not
 * save. `sendKey` is what the send-key table says for the app (null: it does not know the app). `voice` is the voice
 * source (main.js's), `signedIn` whether someone is signed in, and `heard` what Buddy's server writes down from a
 * recording: the words, or an error it fails with.
 */
// Buddy's voice, as actions.js uses it: what it says, and the answers it hears, in order.
function fakeTalkBack(log, { answers = [], requests = [], stubborn = false } = {}) {
  let waiting = null;
  const fake = {
    async say(text) { log.push(['say', text]); },
    async hear(verb) {
      log.push(['hear', verb]);
      if (answers[0] === 'wait') { answers.shift(); return new Promise((resolve) => { waiting = resolve; }); }
      return answers.length ? answers.shift() : 'no';
    },
    async listen() { log.push(['listen']); return requests.length ? requests.shift() : null; },
    stop() { log.push(['stop']); if (waiting && !stubborn) waiting('no'); }, // stubborn: a hear that ignores stop(), answering later
    answerLate(a) { if (waiting) waiting(a); },
  };
  return fake;
}
const settle = async () => { for (let i = 0; i < 20; i += 1) await new Promise((r) => setImmediate(r)); };

function setup({
  lastApp = APP,
  replies = {},
  answers = [],
  ask,
  clipboard: givenClipboard,
  windows = false,
  name = 'Akshat',
  facts = [],
  refuse = [],
  sendKey = { key: 'return', modifiers: ['cmd'] },
  voice,
  signedIn = true,
  heard = 'kal chutti chahiye',
  projects = [],
  lastProject = null,
  claude = { installed: true, loggedIn: true },
  startFails = null,
  apps: givenApps = [{ name: 'Safari', path: '/Applications/Safari.app' }],
  openFails = '',
  talk = null,
  lock = { locked: () => false, unlocked: async () => true },
  agent = null,
  agentOn,
  eyes = null,
} = {}) {
  const log = [];
  const helper = {
    lastApp,
    async call(cmd, args) {
      log.push(['helper', cmd, args]);
      const answer = replies[cmd];
      if (answer instanceof Error) throw answer;
      return typeof answer === 'function' ? answer(args) : answer || {};
    },
  };
  let time = 1_000_000;
  let visible = false;
  let justClosed = false;
  let hiddenAt = 0;
  const ui = {
    async showPanel(state) {
      visible = true;
      log.push(['showPanel', state]);
    },
    panelState: (state) => log.push(['state', state]),
    hidePanel() {
      if (visible) hiddenAt = time;
      visible = false;
      log.push(['hidePanel']);
    },
    isPanelVisible: () => visible,
    panelJustClosed: () => justClosed,
    panelHiddenAt: () => hiddenAt,
    panelWindowHandle: () => 4242,
    bubble: (text) => log.push(['bubble', text]),
    speech: (text) => log.push(['speech', text]),
    speechDone: () => log.push(['speechDone']),
    mood: (mood) => log.push(['mood', mood]),
    openSettings: (section) => log.push(['openSettings', section]),
    openFolder: (p) => log.push(['openFolder', p]),
  };
  const clipboard = givenClipboard || {
    text: null,
    writeText(text) {
      this.text = text;
    },
  };
  // The memory (memory.js): add() answers the saved fact, or null for one it refuses or already knows.
  let nextFact = 1;
  const memory = {
    saved: facts.map((text) => ({ id: `fact-${nextFact++}`, text })),
    facts() {
      return this.saved.map((f) => f.text);
    },
    add(text) {
      log.push(['remember', text]);
      if (refuse.includes(text) || this.facts().includes(text)) return null;
      const fact = { id: `fact-${nextFact++}`, text };
      this.saved.push(fact);
      return { ...fact };
    },
    remove(id) {
      log.push(['forget', id]);
      const before = this.saved.length;
      this.saved = this.saved.filter((f) => f.id !== id);
      return this.saved.length < before;
    },
  };
  const queue = [...answers];
  const ai = {
    ask: ask || (async (action, given) => {
      log.push(['ask', action, given]);
      const next = queue.length ? queue.shift() : reply({ text: 'An answer.' });
      if (next instanceof Error) throw next;
      const chat = typeof next === 'function' ? next(given) : next;
      return { text: JSON.stringify(chat), model: 'test-model', chat };
    }),
  };
  // Buddy's server, for what was said in a recording (cloud.transcribe), and this person's settings fetched again.
  const cloud = {
    async transcribe(recording, options) {
      log.push(['transcribe', recording, options]);
      if (heard instanceof Error) throw heard;
      return heard;
    },
    async settings(options) {
      log.push(['settings', options]);
      return {};
    },
  };
  // Claude Code jobs (src/main/claude/job.js): `projects` are the folders found, `claude` how Claude Code stands, and
  // each job started is kept in `started` with its onEvent, so that a test can play what the job reports.
  let last = lastProject;
  const started = [];
  const jobs = {
    projects: () => projects,
    lastProject: () => projects.find((p) => p.path === last) || null,
    setLastProject(p) {
      last = p;
      log.push(['lastProject', p]);
    },
    status: async () => claude,
    start(options) {
      log.push(['startJob', { project: options.project, task: options.task, person: options.person, model: options.model }]);
      if (startFails) throw startFails;
      const handle = {
        stops: 0,
        answers: [],
        stop() { this.stops += 1; },
        answer(id, allow) { this.answers.push([id, allow]); return true; },
      };
      started.push({ ...options, handle });
      return handle;
    },
  };
  const voice_ = talk === null ? null : fakeTalkBack(log, talk || {});
  const actions = createActions({
    helper,
    clipboard,
    ui,
    store: { get: (key) => ({ buddyName: 'Aarav', ...(agentOn === undefined ? {} : { agentOn }) })[key] },
    ai,
    cloud,
    signedIn: () => signedIn,
    ...(voice ? { voice } : {}),
    jobs,
    talkBack: voice_,
    agent,
    eyes,
    lock,
    apps: windows ? null : { list: () => givenApps, find: (asked) => findApp(givenApps, asked), open: async (p) => { log.push(['openApp', p]); return openFails; } },
    memory,
    sendKeyFor: (app, platform) => {
      log.push(['sendKeyFor', app, platform]);
      return sendKey;
    },
    undoKey: (platform) => ({ key: 'z', modifiers: [platform === 'darwin' ? 'cmd' : 'ctrl'] }),
    userName: () => name,
    now: () => time,
    helperMovesFocus: windows,
    newline: windows ? '\r\n' : '\n',
    system: windows ? 'win32' : 'darwin',
  });
  return {
    actions,
    ai,
    helper,
    log,
    cloud,
    clipboard,
    memory,
    started,
    setJustClosed: (v) => { justClosed = v; },
    wait: (ms) => { time += ms; },
    /** The panel hides the way a click somewhere else hides it: by itself, not through actions. */
    blur: () => ui.hidePanel(),
    talkBack: voice_,
  };
}

/** The agent runner (src/main/agent/runner.js) as actions.js uses it: each start answers the next result. */
function fakeAgent(log, results = []) {
  let busy = false;
  return {
    running: () => busy,
    async start(job) {
      log.push(['agentStart', job]);
      busy = true;
      try {
        const next = results.length ? results.shift() : { end: 'done', line: 'Done.', steps: [] };
        if (next instanceof Error) throw next;
        return next;
      } finally { busy = false; }
    },
    reply: (text) => { log.push(['agentReply', text]); return false; },
    reassert: () => log.push(['reassert']),
    stop: (reason) => log.push(['agentStop', reason]),
  };
}

const failure = (code, message = code) => new BuddyError(code, message);
const entries = (log, kind) => log.filter((e) => e[0] === kind);
const chatOf = (s) => s.actions.state().chat;
const lastItem = (s) => chatOf(s).at(-1);

module.exports = { fakeAgent, APP, MAIL, reply, fakeTalkBack, settle, setup, failure, entries, chatOf, lastItem };
