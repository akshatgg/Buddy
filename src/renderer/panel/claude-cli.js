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

  return { toolCall, summaryText, rows, inline, blocks, tableLines, wrap, workingVerb, VERBS };
})();

if (typeof module !== 'undefined') module.exports = ClaudeCli;
