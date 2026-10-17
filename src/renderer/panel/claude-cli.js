'use strict';
/* global module */
/* exported ClaudeCli */

/**
 * Claude mode drawn as the Claude Code terminal draws a session (src/renderer/panel/panel.js draws what this says). The
 * session's items come from src/main/claude/live.js as { id, kind: 'you' | 'claude' | 'tool' | 'result' | 'event',
 * text, error }; a tool's text is live.js's toolLine ("$ npm test", "Edit src/main.js", "Grep TODO", …). This turns
 * them into the terminal's rows:
 *   { type: 'you', id, text }                       ❯ what the person typed, on a grey bar
 *   { type: 'claude', id, text }                    ● Claude's reply (its **bold** and `code` by inline())
 *   { type: 'thinking', id, text }                  ∴ Thinking: Claude's thinking, folded until clicked
 *   { type: 'tool', id, name, arg, results, error }  ● Update(src/main.js) and its results under ⎿
 *   { type: 'summary', id, text, tools, error }     Ran 3 shell commands, read 2 files: the quiet tools, folded
 *   { type: 'event', id, text }                     ⎿ Interrupted
 * It also words Claude mode's status line, its workers and its slash commands.
 * The panel loads this as a script; the unit tests require it. So it must stay free of the DOM.
 */
const ClaudeCli = (() => {
  // The tools the terminal folds into one grey line when they run in a row, and the words for each count.
  const QUIET = {
    bash: (n) => `ran ${n} shell command${n === 1 ? '' : 's'}`,
    read: (n) => `read ${n} file${n === 1 ? '' : 's'}`,
    search: (n) => `searched for ${n} pattern${n === 1 ? '' : 's'}`,
    web: (n) => `fetched ${n} page${n === 1 ? '' : 's'}`,
  };

  /**
   * A tool's line from live.js as the terminal shows it: its name, what it was given, and the quiet group it folds
   * into (null for a tool that shows on its own, as an edit does).
   */
  function toolCall(text) {
    const t = String(text ?? '');
    const after = (prefix) => t.slice(prefix.length).trim();
    if (t.startsWith('$ ')) return { name: 'Bash', arg: after('$ '), group: 'bash' };
    for (const [prefix, name, group] of [
      ['Read ', 'Read', 'read'],
      ['Write ', 'Write', null],
      ['Edit ', 'Update', null],
      ['MultiEdit ', 'Update', null],
      ['NotebookEdit ', 'Update', null],
      ['Fetch ', 'Fetch', 'web'],
      ['Search ', 'Web Search', 'web'],
      ['Agent: ', 'Agent', null],
    ]) {
      if (t.startsWith(prefix)) return { name, arg: after(prefix), group };
    }
    if (t.startsWith('Grep ') || t.startsWith('Glob ')) return { name: 'Search', arg: `pattern: "${t.slice(5).trim()}"`, group: 'search' };
    if (t === 'Updated the to-do list') return { name: 'Update Todos', arg: '', group: null };
    return { name: t || 'Tool', arg: '', group: null };
  }

  /** "Ran 3 shell commands, read 2 files": the counts of a folded run, first letter up. */
  function summaryText(counts) {
    const words = Object.keys(QUIET).filter((g) => counts[g] > 0).map((g) => QUIET[g](counts[g])).join(', ');
    return words ? words[0].toUpperCase() + words.slice(1) : '';
  }

  /** The session's items as the terminal's rows: results under their tool, quiet tools in a row folded into one. */
  function rows(items) {
    const out = [];
    let run = null; // the quiet tools folded so far: { row, counts }
    const endRun = () => {
      if (run) run.row.text = summaryText(run.counts);
      run = null;
    };
    for (const item of Array.isArray(items) ? items : []) {
      if (!item || typeof item !== 'object') continue;
      const text = String(item.text ?? '');
      if (item.kind === 'result') {
        const last = out[out.length - 1];
        const tool = last?.type === 'summary' ? last.tools[last.tools.length - 1] : last?.type === 'tool' ? last : null;
        if (tool) {
          tool.results.push({ text, error: Boolean(item.error) });
          if (item.error) {
            tool.error = true;
            if (last.type === 'summary') last.error = true;
          }
          continue;
        }
        endRun();
        out.push({ type: 'event', id: item.id, text, error: Boolean(item.error) });
        continue;
      }
      if (item.kind === 'tool') {
        const call = toolCall(text);
        const tool = { type: 'tool', id: item.id, name: call.name, arg: call.arg, results: [], error: false };
        if (call.group) {
          if (!run) {
            run = { row: { type: 'summary', id: item.id, text: '', tools: [], error: false }, counts: {} };
            out.push(run.row);
          }
          run.row.tools.push(tool);
          run.counts[call.group] = (run.counts[call.group] || 0) + 1;
          continue;
        }
        endRun();
        out.push(tool);
        continue;
      }
      endRun();
      if (item.kind === 'you' || item.kind === 'claude' || item.kind === 'thinking') out.push({ type: item.kind, id: item.id, text });
      else out.push({ type: 'event', id: item.id, text: text === 'Stopped' ? 'Interrupted by user' : text, error: Boolean(item.error) });
    }
    endRun();
    return out;
  }

  /**
   * One line of Claude's reply as the terminal shows its markdown: parts of { s, bold, code }. **bold** and `code`
   * are marked; a heading (# …) is bold without its #s. Anything else is the words as they are.
   */
  function inline(line) {
    const text = String(line ?? '');
    const heading = /^#{1,6}\s+(.*)$/.exec(text);
    if (heading) return [{ s: heading[1], bold: true, code: false }];
    const parts = [];
    const re = /\*\*([^*]+)\*\*|`([^`]+)`/g;
    let at = 0;
    for (let m = re.exec(text); m; m = re.exec(text)) {
      if (m.index > at) parts.push({ s: text.slice(at, m.index), bold: false, code: false });
      parts.push(m[1] !== undefined ? { s: m[1], bold: true, code: false } : { s: m[2], bold: false, code: true });
      at = m.index + m[0].length;
    }
    if (at < text.length || parts.length === 0) parts.push({ s: text.slice(at), bold: false, code: false });
    return parts;
  }

  // What the terminal says while Claude works, one per turn: "✻ Pondering…".
  const VERBS = ['Thinking', 'Pondering', 'Cogitating', 'Brewing', 'Noodling', 'Mulling', 'Working', 'Crafting'];

  /** The working line's verb for a turn, the same for as long as that turn lasts (`seed`: the person's last item). */
  function workingVerb(seed) {
    const n = Math.abs(Number(seed) || 0);
    return `${VERBS[n % VERBS.length]}…`;
  }

  const FENCE = /^\s*```/;
  const HEADING = /^#{1,6}\s+(.*)$/;
  const BULLET = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
  const TABLE_RULE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/;
  const MIN_COLUMN = 6;

  /** The words of a line without its **bold** and `code` marks. */
  const plain = (text) => inline(text).map((p) => p.s).join('');
  /** A table row's cells: between the pipes, trimmed, with their marks taken off. */
  const cells = (line) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => plain(c.trim()));

  /**
   * Claude's markdown, block by block, as the terminal shows it: { type: 'line' | 'heading' | 'bullet' | 'code' |
   * 'table' | 'blank', … }. The phone's ClaudeCli.kt reads it the same way.
   */
  function blocks(text) {
    const lines = String(text ?? '').replace(/\r\n/g, '\n').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i];
      if (FENCE.test(line)) {
        const code = [];
        for (i += 1; i < lines.length && !FENCE.test(lines[i]); i += 1) code.push(lines[i]);
        out.push({ type: 'code', lines: code });
      } else if (line.trimStart().startsWith('|') && i + 1 < lines.length && TABLE_RULE.test(lines[i + 1])) {
        const header = cells(line);
        const rows = [];
        for (i += 2; i < lines.length && lines[i].trimStart().startsWith('|'); i += 1) rows.push(cells(lines[i]));
        i -= 1;
        out.push({ type: 'table', header, rows });
      } else if (!line.trim()) {
        out.push({ type: 'blank' });
      } else if (HEADING.test(line)) {
        out.push({ type: 'heading', text: HEADING.exec(line)[1] });
      } else if (BULLET.test(line)) {
        const [, indent, marker, rest] = BULLET.exec(line);
        out.push({ type: 'bullet', depth: Math.floor(indent.length / 2), marker: /^\d/.test(marker) ? marker : '•', text: rest });
      } else {
        out.push({ type: 'line', text: line });
      }
    }
    return out;
  }

  /** `text` in lines of at most `width` characters, broken between words (inside a word only when it is longer). */
  function wrap(text, width) {
    if (text.length <= width) return [text];
    const out = [];
    let line = '';
    for (let word of text.split(' ').filter(Boolean)) {
      while (word.length > width) {
        if (line) { out.push(line); line = ''; }
        out.push(word.slice(0, width));
        word = word.slice(width);
      }
      if (!line) line = word;
      else if (line.length + 1 + word.length <= width) line = `${line} ${word}`;
      else { out.push(line); line = word; }
    }
    if (line) out.push(line);
    return out.length ? out : [''];
  }

  /**
   * A table drawn with box lines, as the terminal draws it, no wider than `maxWidth` characters: the widest columns give
   * way first (down to MIN_COLUMN), a cell's words wrap within its column, and a line goes between every row.
   */
  function tableLines(header, rows, maxWidth) {
    const all = [header, ...rows];
    const columns = Math.max(...all.map((r) => r.length), 0);
    if (!columns) return [];
    const widths = Array.from({ length: columns }, (_, c) => Math.max(1, ...all.map((r) => (r[c] ?? '').length)));
    const frame = 3 * columns + 1;
    while (widths.reduce((a, b) => a + b, 0) + frame > maxWidth) {
      const widest = widths.indexOf(Math.max(...widths));
      if (widths[widest] <= MIN_COLUMN) break;
      widths[widest] -= 1;
    }
    const rule = (left, mid, right) => left + widths.map((w) => '─'.repeat(w + 2)).join(mid) + right;
    const row = (cellsOf) => {
      const wrapped = widths.map((w, c) => wrap(cellsOf[c] ?? '', w));
      const height = Math.max(...wrapped.map((w) => w.length));
      return Array.from({ length: height }, (_, l) => `│${wrapped.map((w, c) => ` ${(w[l] ?? '').padEnd(widths[c])} │`).join('')}`);
    };
    const out = [rule('┌', '┬', '┐')];
    all.forEach((cellsOf, i) => {
      if (i > 0) out.push(rule('├', '┼', '┤'));
      out.push(...row(cellsOf));
    });
    out.push(rule('└', '┴', '┘'));
    return out;
  }

  // ---- The status line, the workers and the slash commands ----

  /** A token count as the terminal writes it: 980, 12.3k, 123k, 1.2M. */
  function tokenCount(n) {
    const v = Math.max(0, Math.round(Number(n) || 0));
    if (v < 1000) return String(v);
    if (v < 100_000) return `${(v / 1000).toFixed(1).replace(/\.0$/, '')}k`;
    if (v < 999_500) return `${Math.round(v / 1000)}k`;
    return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  }

  const MODEL_LABELS = { fable: 'Fable', opus: 'Opus', sonnet: 'Sonnet', haiku: 'Haiku' }; // find.js's, for the page
  const MODEL_PICKS = ['opus', 'sonnet', 'haiku']; // what /model offers
  const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']; // Claude Code's own effort levels, in its order
  const EFFORT_LABELS = { low: 'Low', medium: 'Medium', high: 'High', xhigh: 'XHigh', max: 'Max' };

  /** A model's id as people say it: claude-opus-5-5 is Opus 5.5. Anything else as it is. */
  function modelName(id) {
    const text = String(id ?? '');
    const m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?(?:\[[^\]]*\])?$/.exec(text);
    if (!m) return text;
    const name = MODEL_LABELS[m[1]] || m[1][0].toUpperCase() + m[1].slice(1);
    return `${name} ${m[2]}${m[3] ? `.${m[3]}` : ''}`;
  }

  /** How long something took: 12s, 1m 12s, 1h 5m. */
  function elapsed(ms) {
    const s = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
    return `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`;
  }

  /** The line under the session (live.js's stats): "Opus 5.5 · 1.2M in · 34k out"; '' before any reply. */
  function statusLine(stats) {
    if (!stats || (!stats.model && !stats.input && !stats.output)) return '';
    return [stats.model ? modelName(stats.model) : '', `${tokenCount(stats.input)} in`, `${tokenCount(stats.output)} out`].filter(Boolean).join(' · ');
  }

  const WORKER_STATUS = ['running', 'done', 'failed', 'stopped'];
  const RECENT_MS = 5 * 60_000; // a worker that ended shows this long after
  const MANY = 3; // more workers than this fold into one line

  /** One worker as a line: "Fix the login bug · running · 1m 12s · 12.3k tokens". */
  function workerLine(w, now) {
    const parts = [w.task, w.status];
    if (Number.isFinite(w.startedAt)) parts.push(elapsed((w.endedAt ?? now) - w.startedAt));
    if (w.tokens > 0) parts.push(`${tokenCount(w.tokens)} tokens`);
    return parts.join(' · ');
  }

  /**
   * The workers to show (live.js's workers): those running and those that ended in the last RECENT_MS, a line each;
   * `compact` when there are more than MANY, with `summary` for the one line ("4 workers · 2 running · 1 done").
   */
  function workerList(workers, now) {
    const shown = (Array.isArray(workers) ? workers : []).filter((w) => w && WORKER_STATUS.includes(w.status)
      && (w.status === 'running' || (Number.isFinite(w.endedAt) && now - w.endedAt < RECENT_MS)));
    const counts = WORKER_STATUS.map((s) => [s, shown.filter((w) => w.status === s).length]).filter(([, n]) => n > 0);
    return {
      lines: shown.map((w) => ({ id: w.id, status: w.status, text: workerLine(w, now) })),
      compact: shown.length > MANY,
      summary: [`${shown.length} worker${shown.length === 1 ? '' : 's'}`, ...counts.map(([s, n]) => `${n} ${s}`)].join(' · '),
    };
  }

  // The slash commands the Claude box knows, in the order /help and the suggestions list them.
  const COMMANDS = [
    { name: 'model', hint: 'pick the model: fable, opus, sonnet or haiku' },
    { name: 'effort', hint: 'how hard Claude thinks: low, medium, high, xhigh or max' },
    { name: 'clear', hint: 'start a new conversation' },
    { name: 'stop', hint: 'stop what Claude is doing' },
    { name: 'cost', hint: 'tokens so far' },
    { name: 'help', hint: 'these commands' },
  ];

  /** The box's words as a slash command: { name, arg, known }, or null ("/" alone and a path like /Users/… are none). */
  function command(text) {
    const m = /^\/([a-z][\w-]*)(?:\s+([\s\S]*))?$/i.exec(String(text ?? '').trim());
    if (!m) return null;
    const name = m[1].toLowerCase();
    return { name, arg: (m[2] || '').trim().toLowerCase(), known: COMMANDS.some((c) => c.name === name) };
  }

  /** While the box holds "/" and part of a name: the commands it could be. */
  function suggestions(text) {
    const m = /^\/([a-z]*)$/i.exec(String(text ?? '').trimStart());
    return m ? COMMANDS.filter((c) => c.name.startsWith(m[1].toLowerCase())) : [];
  }

  // The models /model lists, as Claude Code's picker words them. `default` is Claude Code's own choice.
  const MODEL_ROWS = [
    { alias: 'default', label: 'Default (recommended)', hint: 'Claude Code picks the model' },
    { alias: 'opus', label: 'Opus', hint: 'Most capable, for complex work' },
    { alias: 'sonnet', label: 'Sonnet', hint: 'Fast and smart, for everyday tasks' },
    { alias: 'fable', label: 'Fable', hint: 'Newest model' },
    { alias: 'haiku', label: 'Haiku', hint: 'Fastest, for quick answers' },
  ];

  /** The alias a model id belongs to: claude-opus-5-5 is "opus". null when it is none of the rows'. */
  function aliasOf(id) {
    const m = /^claude-([a-z]+)-\d/.exec(String(id ?? ''));
    return m && MODEL_ROWS.some((r) => r.alias === m[1]) ? m[1] : null;
  }

  /** The words for an effort level that is none of the five. */
  const noSuchEffort = (name) => `There is no effort level called ${name}. Try ${EFFORTS.slice(0, -1).join(', ')} or ${EFFORTS[EFFORTS.length - 1]}.`;

  /**
   * The /model picker: the models and the effort levels, one of each chosen. `stats` is the session's (live.js), whose
   * model says which row is the current one; else `savedModel`, else Default. `savedEffort` is the current effort, or
   * none (null) when Buddy has not set one. `focus` is the row the picker opens on: 'model' or 'effort'.
   */
  function pickerOpen({ stats, savedModel, savedEffort, focus = 'model' } = {}) {
    const rows = MODEL_ROWS.map((r) => ({ ...r }));
    const current = aliasOf(stats?.model) || (rows.some((r) => r.alias === savedModel) ? savedModel : 'default');
    const at = rows.find((r) => r.alias === current);
    if (stats?.model && aliasOf(stats.model) === current) at.name = modelName(stats.model); // "Opus 5.5", where known
    const effort = EFFORTS.includes(savedEffort) ? savedEffort : null;
    return { rows, current, effortNow: effort, index: rows.indexOf(at), effort, focus: focus === 'effort' ? 'effort' : 'model' };
  }

  /** ↑ (-1) and ↓ (1): the next model, round the list. */
  function pickerMove(p, dir) {
    const n = p.rows.length;
    return { ...p, focus: 'model', index: (p.index + (dir < 0 ? -1 : 1) + n) % n };
  }

  /** ← (-1) and → (1): the next effort level, stopping at the ends. With none chosen, the first press lands on Medium. */
  function pickerEffort(p, dir) {
    const at = p.effort === null ? EFFORTS.indexOf('medium') : Math.min(EFFORTS.length - 1, Math.max(0, EFFORTS.indexOf(p.effort) + (dir < 0 ? -1 : 1)));
    return { ...p, focus: 'effort', effort: EFFORTS[at] };
  }

  /** Take a model row (a click or a tap) or an effort level. */
  const pickerPick = (p, { model, effort }) => ({
    ...p,
    index: model !== undefined && p.rows.some((r) => r.alias === model) ? p.rows.findIndex((r) => r.alias === model) : p.index,
    effort: EFFORTS.includes(effort) ? effort : p.effort,
  });

  /**
   * Enter: what to type. { commands: [{ name, arg }], note }: /model when the model changed, /effort when the effort
   * did; none when nothing changed (the note then says so). The note reads "Model: Sonnet · Effort: High".
   */
  function pickerApply(p) {
    const row = p.rows[p.index];
    const commands = [];
    if (row.alias !== p.current) commands.push({ name: 'model', arg: row.alias });
    if (p.effort !== null && p.effort !== p.effortNow) commands.push({ name: 'effort', arg: p.effort });
    const parts = [`Model: ${row.alias === 'default' ? 'Default' : row.label}`];
    if (p.effort !== null) parts.push(`Effort: ${EFFORT_LABELS[p.effort]}`);
    return { commands, note: commands.length ? parts.join(' · ') : `No change. ${parts.join(' · ')}` };
  }

  const helpLines = () => [...COMMANDS.map((c) => `/${c.name} · ${c.hint}`), 'Other / commands go to Claude Code.'];

  /** /cost: the session's tokens, its model and its workers' tokens. Transcripts have no cost. */
  function costLines(session) {
    const stats = session?.stats || {};
    const workers = Array.isArray(session?.workers) ? session.workers : [];
    const out = [`Tokens so far: ${tokenCount(stats.input)} in · ${tokenCount(stats.output)} out`];
    if (stats.model) out.push(`Model: ${modelName(stats.model)}`);
    if (workers.length) out.push(`Workers: ${workers.length} · ${tokenCount(workers.reduce((sum, w) => sum + (w.tokens || 0), 0))} tokens`);
    out.push("Cost isn't in the session file. Type /cost in the terminal for it.");
    return out;
  }

  return {
    toolCall, summaryText, rows, inline, blocks, tableLines, wrap, workingVerb, VERBS,
    tokenCount, modelName, elapsed, statusLine, workerList, command, suggestions, helpLines, costLines, COMMANDS, MODEL_PICKS, MODEL_LABELS,
    EFFORTS, EFFORT_LABELS, MODEL_ROWS, aliasOf, noSuchEffort, pickerOpen, pickerMove, pickerEffort, pickerPick, pickerApply,
  };
})();

if (typeof module !== 'undefined') module.exports = ClaudeCli;
