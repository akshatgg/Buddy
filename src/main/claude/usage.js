'use strict';

/**
 * Claude mode's status line and workers, from the same transcript lines live.js reads: the tokens of the whole session
 * (what went in, with the cache, and what came out), the model answering now, and the sub-agents ("workers") Claude
 * starts with its Agent tool, each with its task, how it stands, when it started and ended, and its tokens.
 *
 * Claude Code writes a line for each block of a reply, each with the whole reply's usage, one after the other: a reply
 * is counted once, by its id. A worker starts with an Agent (older: Task) tool_use. It ends with its tool_result, or,
 * when it runs in the background (the result then says async_launched), with a <task-notification> later. While it
 * runs, its tokens and what it is doing come from its own file (live.js reads it and calls workerTokens, workerActivity
 * and ownEnd).
 *
 * The end of a worker comes in several carriers (a user message, a queue-operation "enqueue" line, an attachment of a
 * queued command), all with a <task-notification>. It is matched by the Agent tool_use id, or by the <task-id>, which is
 * the worker's agent id (said by the launch result, or by the worker's own meta file). A SendMessage that resumes a
 * worker sets it running again.
 */

const WORKERS_KEPT = 20; // the newest ended workers kept for a session
const RUNNING_KEPT = 100; // and the newest running ones: the older ones are taken as stopped (a real end still replaces that)
const TASK_CHARS = 120;
const TYPE_CHARS = 40;
const ACTIVITY_CHARS = 80;
const MESSAGES_KEPT = 200; // SendMessage tool_use ids remembered, to read their results
const NOTED_KEPT = 500; // notifications applied, remembered so that a replay after a resume ends nothing
const AGENT_ID = /^[\w-]{1,100}$/;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const ENDS = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' }; // a notification's <status>

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const timeOf = (stamp) => {
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
};
const cutTo = (text, max) => (text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text);
const tagIn = (text, tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1]?.trim() ?? null;

/** A reply's tokens: in (input, cache written and cache read) and out. */
function tokensOf(usage) {
  const u = isObject(usage) ? usage : {};
  return { in: count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens), out: count(u.output_tokens) };
}

/** A session's tally, before any line. */
function newTally() {
  // byAgent: a worker's agent id → its tool_use id. context: the newest reply's in (all of it). messages, noted: see above.
  return { model: null, input: 0, output: 0, context: 0, last: null, workers: new Map(), byAgent: new Map(), messages: new Set(), noted: new Set() };
}

/** The words of a message: its text, or its text blocks joined. */
function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter((b) => b?.type === 'text' && typeof b.text === 'string').map((b) => b.text).join('\n');
}

/** A worker ends: how, when, and its tokens when the end says them. */
function finish(worker, status, at, tokens) {
  worker.status = status;
  delete worker.expired;
  worker.endedAt = at;
  if (tokens > 0) worker.tokens = tokens;
}

/** The worker a tool_use id or an agent id names, if any. */
function workerFor(t, toolUseId, agentId) {
  const known = t.workers.get(toolUseId) ?? t.workers.get(t.byAgent.get(agentId));
  if (known || typeof agentId !== 'string') return known;
  return [...t.workers.values()].find((w) => w.agentId === agentId); // an id that came from the worker's meta file
}

/** The worker's agent id (and type) once known. */
function noteAgent(t, toolUseId, agentId, type) {
  const worker = t.workers.get(toolUseId);
  if (!worker || typeof agentId !== 'string' || !AGENT_ID.test(agentId)) return false;
  worker.agentId = agentId;
  t.byAgent.set(agentId, toolUseId);
  if (typeof type === 'string' && type.trim() && type.length < TYPE_CHARS) worker.type = type.trim();
  return true;
}

/**
 * Only the newest WORKERS_KEPT ended workers and the newest RUNNING_KEPT running ones are kept. The older running ones
 * are taken as stopped, as a guess (a real end still replaces it).
 */
function trim(t, at) {
  const all = [...t.workers.values()];
  const live = all.filter((w) => w.status === 'running');
  for (const w of live.slice(0, Math.max(0, live.length - RUNNING_KEPT))) finishGuess(w, at);
  // Real ends go first: a worker only guessed stopped can still get its real end.
  const ended = all.filter((w) => w.status !== 'running');
  const order = [...ended.filter((w) => !w.expired), ...ended.filter((w) => w.expired)];
  for (const w of order.slice(0, Math.max(0, ended.length - WORKERS_KEPT))) {
    t.workers.delete(w.id);
    if (w.agentId && t.byAgent.get(w.agentId) === w.id) t.byAgent.delete(w.agentId);
  }
}

/** A worker that will not end by itself, as far as can be told: stopped, with `expired` saying it is only a guess. */
function finishGuess(worker, at) {
  finish(worker, 'stopped', at, 0);
  worker.expired = true;
}

/** A worker is running again (a SendMessage resumed it). */
function resume(worker, at) {
  worker.status = 'running';
  delete worker.expired;
  worker.endedAt = null;
  worker.startedAt = at; // the CLI times a resumed run on its own
  worker.activity = null;
}

/** The <task-notification>s in `text`: each ends its worker. Answers whether any did. */
function notesIn(t, text, at) {
  if (typeof text !== 'string' || !text.includes('<task-notification>')) return false;
  let changed = false;
  // One message can carry several notifications (workers that ended together): each is read.
  for (const [block] of text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
    const toolUseId = tagIn(block, 'tool-use-id');
    const taskId = tagIn(block, 'task-id');
    const worker = workerFor(t, toolUseId, taskId);
    const status = ENDS[tagIn(block, 'status')];
    if (!worker || !status || !(worker.status === 'running' || worker.expired)) continue; // a real end beats an expired guess
    const key = `${toolUseId}|${taskId}|${status}`;
    if (t.noted.has(key)) continue; // a copy of one already applied, seen again after a resume
    t.noted.add(key);
    if (t.noted.size > NOTED_KEPT) t.noted.delete(t.noted.values().next().value);
    finish(worker, status, at, count(Number(tagIn(block, 'subagent_tokens') ?? tagIn(block, 'total_tokens'))));
    changed = true;
  }
  return changed;
}

/** Add one transcript line to the tally. Answers whether anything shown changed. */
function tally(t, entry) {
  if (!isObject(entry) || entry.isSidechain === true) return false;
  const message = isObject(entry.message) ? entry.message : {};
  const at = timeOf(entry.timestamp);
  let changed = false;
  if (entry.type === 'assistant') {
    if (typeof message.model === 'string' && message.model.startsWith('claude-') && message.model !== t.model) {
      t.model = message.model;
      changed = true;
    }
    if (isObject(message.usage)) {
      const now = tokensOf(message.usage);
      // A line with no id cannot be matched to the reply before it: it counts on its own.
      const before = typeof message.id === 'string' && t.last && t.last.id === message.id ? t.last : { in: 0, out: 0 };
      if (now.in !== before.in || now.out !== before.out) changed = true;
      t.input += now.in - before.in;
      t.output += now.out - before.out;
      t.context = now.in; // what the newest reply held in its context: the CLI shows this, not the sum
      t.last = { id: message.id, ...now };
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_use' || typeof block.id !== 'string') continue;
      if (block.name === 'SendMessage') {
        t.messages.add(block.id); // its result may resume a worker
        if (t.messages.size > MESSAGES_KEPT) t.messages.delete(t.messages.values().next().value);
        continue;
      }
      if (!AGENT_TOOLS.has(block.name) || t.workers.has(block.id)) continue;
      const input = isObject(block.input) ? block.input : {};
      const words = (value) => (typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '');
      const type = words(input.subagent_type);
      const kind = type && type.length < TYPE_CHARS ? type : 'general-purpose';
      const task = words(input.description) || kind;
      t.workers.set(block.id, {
        id: block.id, type: kind, task: cutTo(task, TASK_CHARS), agentId: null, activity: null, status: 'running', startedAt: at, endedAt: null, tokens: 0,
      });
      changed = true;
    }
  } else if (entry.type === 'user') {
    const r = isObject(entry.toolUseResult) ? entry.toolUseResult : {};
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_result') continue;
      if (t.messages.has(block.tool_use_id)) {
        // A SendMessage that resumed a worker ("Resuming agent …"): it runs again. One that only queued its words, or could not resume, changes nothing.
        const worker = typeof r.resumedAgentId === 'string' && r.success !== false ? workerFor(t, null, r.resumedAgentId) : null;
        if (worker && worker.status !== 'running') {
          resume(worker, at);
          changed = true;
        }
        continue;
      }
      const worker = t.workers.get(block.tool_use_id);
      if (!worker) continue;
      noteAgent(t, worker.id, r.agentId);
      if (!(worker.status === 'running' || worker.expired)) continue; // a real end beats an expired guess
      if (r.status === 'async_launched') continue; // started in the background: its end comes as a notification
      const stopped = block.is_error === true && /interrupted/i.test(textOf(block.content)); // Esc: "[Request interrupted by user]"
      finish(worker, block.is_error === true ? (stopped ? 'stopped' : 'failed') : 'done', at, count(r.totalTokens));
      changed = true;
    }
    if (notesIn(t, textOf(message.content), at)) changed = true;
  } else if (entry.type === 'attachment') {
    // A notification sent into a turn under way: no user message is ever written for it.
    const a = isObject(entry.attachment) ? entry.attachment : {};
    if (a.type === 'queued_command' && notesIn(t, a.prompt, at)) changed = true;
  } else if (entry.type === 'queue-operation') {
    // The earliest moment the end is known; the later copies find the worker ended already.
    if (entry.operation === 'enqueue' && notesIn(t, entry.content, at)) changed = true;
  }
  trim(t, at);
  return changed;
}

/** A running worker's tokens from its newest reply (in + out). Answers whether they changed. */
function workerTokens(t, id, usage) {
  const worker = t.workers.get(id);
  if (!worker || worker.status !== 'running') return false;
  const { in: input, out } = tokensOf(usage);
  if (input + out === worker.tokens) return false;
  worker.tokens = input + out;
  return true;
}

/** A running worker's newest step, one line (a tool's line, else its words). Answers whether it changed. */
function workerActivity(t, id, text) {
  const worker = t.workers.get(id);
  const line = typeof text === 'string' ? cutTo(text.replace(/\s+/g, ' ').trim(), ACTIVITY_CHARS) : '';
  if (!worker || worker.status !== 'running' || !line || line === worker.activity) return false;
  worker.activity = line;
  return true;
}

/**
 * One line of a worker's own file: the worker ends ('done') when it answers for good (a reply that ends its turn with
 * no tool to run) or when its SubagentHandback is answered. `handbacks` is the caller's Set of the tool_use ids of
 * handbacks seen in that file. A line from before a resume says nothing. Answers 'done' or null.
 */
function ownEnd(t, id, entry, handbacks) {
  const worker = t.workers.get(id);
  if (!worker || !isObject(entry) || !(worker.status === 'running' || worker.expired)) return null;
  const at = timeOf(entry.timestamp);
  if (at !== null && worker.startedAt !== null && at < worker.startedAt) return null;
  const content = Array.isArray(entry.message?.content) ? entry.message.content : [];
  let over = false;
  if (entry.type === 'assistant') {
    for (const b of content) if (b?.type === 'tool_use' && b.name === 'SubagentHandback' && typeof b.id === 'string') handbacks.add(b.id);
    over = entry.message?.stop_reason === 'end_turn' && !content.some((b) => b?.type === 'tool_use');
  } else if (entry.type === 'user') {
    over = content.some((b) => b?.type === 'tool_result' && b.is_error !== true && handbacks.has(b.tool_use_id));
  }
  if (!over) return null;
  finish(worker, 'done', at ?? worker.endedAt, 0);
  return 'done';
}

/** Workers that will not end by itself (quiet too long, or their session ended) show as stopped. Answers whether any did. */
function expire(t, ids, at) {
  let changed = false;
  for (const id of ids) {
    const worker = t.workers.get(id);
    if (!worker || worker.status !== 'running') continue;
    finishGuess(worker, at); // only a guess: a real end (a result or notification) still replaces it
    changed = true;
  }
  return changed;
}

/** The tool_use ids of the workers still running. */
const running = (t) => [...t.workers.values()].filter((w) => w.status === 'running').map((w) => w.id);

/** What the panel shows: the status line's numbers and the workers, oldest first. */
function viewOf(t) {
  return {
    stats: { model: t.model, input: t.input, output: t.output, context: t.context },
    workers: [...t.workers.values()].map((w) => {
      const shown = { ...w };
      delete shown.agentId; // for matching only
      delete shown.expired;
      return shown;
    }),
  };
}

module.exports = {
  WORKERS_KEPT, RUNNING_KEPT, ACTIVITY_CHARS, tokensOf, newTally, tally, noteAgent, workerTokens, workerActivity, ownEnd, running, expire, viewOf,
};
