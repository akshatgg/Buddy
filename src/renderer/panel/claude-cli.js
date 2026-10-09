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

  return { toolCall, summaryText, rows, inline, workingVerb, VERBS };
})();

if (typeof module !== 'undefined') module.exports = ClaudeCli;
