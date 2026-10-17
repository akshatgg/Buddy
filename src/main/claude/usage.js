'use strict';

/**
 * Claude mode's status line and workers, from the same transcript lines live.js reads: the tokens of the whole session
 * (what went in, with the cache, and what came out), the model answering now, and the sub-agents ("workers") Claude
 * starts with its Agent tool, each with its task, how it stands, when it started and ended, and its tokens.
 *
 * Claude Code writes a line for each block of a reply, each with the whole reply's usage, one after the other: a reply
 * is counted once, by its id. A worker starts with an Agent (older: Task) tool_use. It ends with its tool_result, or,
 * when it runs in the background (the result then says async_launched), with a <task-notification> later. While it
 * runs, its tokens come from its own file (live.js reads it and calls workerTokens).
 */

const WORKERS_KEPT = 20; // the newest workers kept for a session
const TASK_CHARS = 120;
const AGENT_TOOLS = new Set(['Agent', 'Task']);
const ENDS = { completed: 'done', failed: 'failed', killed: 'stopped', stopped: 'stopped' }; // a notification's <status>

const isObject = (value) => Object.prototype.toString.call(value) === '[object Object]';
const count = (value) => (Number.isFinite(value) && value > 0 ? value : 0);
const timeOf = (stamp) => {
  const ms = Date.parse(stamp);
  return Number.isFinite(ms) ? ms : null;
};
const tagIn = (text, tag) => new RegExp(`<${tag}>([^<]*)</${tag}>`).exec(text)?.[1]?.trim() ?? null;

/** A reply's tokens: in (input, cache written and cache read) and out. */
function tokensOf(usage) {
  const u = isObject(usage) ? usage : {};
  return { in: count(u.input_tokens) + count(u.cache_creation_input_tokens) + count(u.cache_read_input_tokens), out: count(u.output_tokens) };
}

/** A session's tally, before any line. */
function newTally() {
  return { model: null, input: 0, output: 0, last: null, workers: new Map() };
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

/** Only the newest WORKERS_KEPT, the oldest that ended going first. */
function trim(t) {
  for (const [id, w] of t.workers) {
    if (t.workers.size <= WORKERS_KEPT) return;
    if (w.status !== 'running') t.workers.delete(id);
  }
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
      t.last = { id: message.id, ...now };
    }
    for (const block of Array.isArray(message.content) ? message.content : []) {
      if (block?.type !== 'tool_use' || !AGENT_TOOLS.has(block.name) || typeof block.id !== 'string' || t.workers.has(block.id)) continue;
      const input = isObject(block.input) ? block.input : {};
      const task = [input.description, input.subagent_type].find((s) => typeof s === 'string' && s.trim());
      const words = task ? task.replace(/\s+/g, ' ').trim() : 'A worker';
      t.workers.set(block.id, {
        id: block.id, task: words.length > TASK_CHARS ? `${words.slice(0, TASK_CHARS - 1)}…` : words, status: 'running', startedAt: at, endedAt: null, tokens: 0,
      });
      changed = true;
    }
  } else if (entry.type === 'user') {
    for (const block of Array.isArray(message.content) ? message.content : []) {
      const worker = block?.type === 'tool_result' ? t.workers.get(block.tool_use_id) : null;
      if (!worker || !(worker.status === 'running' || worker.expired)) continue; // a real end beats an expired guess
      const r = isObject(entry.toolUseResult) ? entry.toolUseResult : {};
      if (r.status === 'async_launched') continue; // started in the background: its end comes as a notification
      const stopped = block.is_error === true && /interrupted/i.test(textOf(block.content)); // Esc: "[Request interrupted by user]"
      finish(worker, block.is_error === true ? (stopped ? 'stopped' : 'failed') : 'done', at, count(r.totalTokens));
      changed = true;
    }
    const text = textOf(message.content);
    // One message can carry several notifications (workers that ended together): each is read.
    for (const [block] of text.matchAll(/<task-notification>[\s\S]*?<\/task-notification>/g)) {
      const worker = t.workers.get(tagIn(block, 'tool-use-id'));
      const status = ENDS[tagIn(block, 'status')];
      if (worker && (worker.status === 'running' || worker.expired) && status) {
        finish(worker, status, at, count(Number(tagIn(block, 'subagent_tokens') ?? tagIn(block, 'total_tokens'))));
        changed = true;
      }
    }
  }
  trim(t);
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

/** Workers that will not end by themselves (quiet too long, or their session ended) show as stopped. Answers whether any did. */
function expire(t, ids, at) {
  let changed = false;
  for (const id of ids) {
    const worker = t.workers.get(id);
    if (!worker || worker.status !== 'running') continue;
    finish(worker, 'stopped', at, 0);
    worker.expired = true; // only a guess: a real end (a result or notification) still replaces it
    changed = true;
  }
  return changed;
}

/** The tool_use ids of the workers still running. */
const running = (t) => [...t.workers.values()].filter((w) => w.status === 'running').map((w) => w.id);

/** What the panel shows: the status line's numbers and the workers, oldest first. */
function viewOf(t) {
  return { stats: { model: t.model, input: t.input, output: t.output }, workers: [...t.workers.values()].map((w) => ({ ...w })) };
}

module.exports = { WORKERS_KEPT, tokensOf, newTally, tally, workerTokens, running, expire, viewOf };
