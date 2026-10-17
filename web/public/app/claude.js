// The Claude tab: Claude Code on the person's computers. The sessions they share, by computer; one picked shows live
// and is drawn as the Mac panel's Claude mode draws it (terminal rows, markdown, folded tools, workers, status line),
// through shared/claude-cli.js, with a box that types into its terminal and slash commands. ⤢ shows it full screen.
// What happens is claude-core.js's (it looks every 2 s, only while the tab is open and the app is in view); this file
// draws it.

import ClaudeCli from './shared/claude-cli.js';
import { createClaude, readLook, byDevice, screen, STATUS, OFFLINE, NONE, NO_TALK } from './claude-core.js';
import { TIMEOUTS } from './api.js';
import { $, make, button, grow } from './dom.js';

const { inline, blocks, tableLines, suggestions, EFFORTS, EFFORT_LABELS } = ClaudeCli;
const PLACEHOLDERS = { listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };
const TICK_MS = 1000; // a worker runs: its time moves

/**
 * api is api.js's; onMic() when 🎤 is tapped; onFull(on) when full screen goes on or off. Answers { show, hidden, away,
 * leave, setVoice, voiceState, addWords, showError }.
 */
export function startClaudeView({ api, onMic, onFull }) {
  const remote = (body) => api.post('/api/remote/phone', body, { timeoutMs: TIMEOUTS.remote });
  const core = createClaude({
    look: async (session) => readLook(await api.get(`/api/remote/phone${session ? `?session=${encodeURIComponent(session)}` : ''}`, { timeoutMs: TIMEOUTS.remote })),
    send: (session, text) => remote({ action: 'send', session, text }),
    interrupt: (session) => remote({ action: 'interrupt', session }),
    stop: () => remote({ action: 'stop' }),
    onChange: () => draw(),
  });
  const input = $('claude-input');
  const list = $('claude-items');
  let full = false;
  let shownId = null; // the session drawn last, and its newest item: the list scrolls down for new items only
  let newest = 0;
  let notesShown = 0; // the command answers drawn last: a new one scrolls down
  const unfolded = new Set(); // the folded rows opened, as `${type}:${id}`
  let tick = null;
  let voice = 'idle';
  let voiceError = null; // a voice error stays until the next mic tap or send; the 2 s redraws would wipe it otherwise

  function setLine(id, message) {
    $(id).textContent = message || '';
    $(id).hidden = !message;
  }

  function setFull(on) {
    full = on;
    $('claude-full').textContent = on ? '⤡' : '⤢';
    $('claude-full').setAttribute('aria-label', on ? 'Leave full screen' : 'Full screen');
    onFull(on);
  }

  function drawList(s) {
    $('claude-groups').replaceChildren(...byDevice(s.sessions).map(({ device, sessions }) => {
      const group = make('section', 'group');
      const rows = make('ul', 'sessions');
      rows.append(...sessions.map((session) => {
        const li = make('li');
        const pick = button('', '', () => core.open(session.id));
        // The title Claude Code gave it ("Fix the login bug"), with the short name under it; else just the name.
        const name = make('span', 'name', session.title || session.name);
        if (session.title) name.append(make('span', 'under', session.name));
        pick.append(name, make('span', `status-chip ${session.status}`, STATUS[session.status] || session.status));
        li.append(pick);
        return li;
      }));
      group.append(make('h3', '', device || 'Your computer'), rows);
      return group;
    }));
    let note = s.listError;
    if (!note && s.looking) note = 'Looking…';
    else if (!note && s.online === false) note = OFFLINE;
    else if (!note && s.online && !s.sessions.length) note = NONE;
    setLine('claude-note', note);
  }

  /** A line's words with Claude's **bold** and `code` (ClaudeCli.inline), into `p`. */
  function spans(p, line) {
    for (const part of inline(line)) {
      p.append(part.bold ? make('strong', '', part.s) : part.code ? make('code', '', part.s) : document.createTextNode(part.s));
    }
    return p;
  }

  /** How many characters of the session's font fit across where a reply's words go (for a table's width). */
  function columns() {
    const probe = make('span', 'cl-probe', '0000000000');
    list.append(probe);
    const char = probe.getBoundingClientRect().width / 10 || 8;
    probe.remove();
    const room = list.clientWidth - 32 - char * 2 - 8; // the list's 16px gutters, and the ● column beside a reply
    return Math.max(20, Math.floor(room / char));
  }

  /** Claude's markdown as the terminal shows it (ClaudeCli.blocks): lines, headings, lists, code, box-drawn tables. */
  function words(text, className = '') {
    const body = make('div', `cl-text ${className}`.trim());
    for (const block of blocks(text)) {
      if (block.type === 'heading') body.append(make('p', 'cl-heading', block.text));
      else if (block.type === 'bullet') {
        const p = make('p', 'cl-bullet');
        p.style.paddingLeft = `${block.depth * 2}ch`;
        p.append(make('span', 'cl-marker', `${block.marker} `));
        body.append(spans(p, block.text));
      } else if (block.type === 'code') body.append(make('pre', 'cl-code', block.lines.join('\n')));
      else if (block.type === 'table') body.append(make('pre', 'cl-table', tableLines(block.header, block.rows, columns()).join('\n')));
      else if (block.type === 'blank') body.append(make('p', 'blank'));
      else body.append(spans(make('p'), block.text));
    }
    return body;
  }

  /** A row that unfolds when tapped (folded tools, thinking, many workers): its head, and what shows when open. */
  function foldable(li, key, head, body) {
    const open = unfolded.has(key);
    const b = button('cl-fold', '', () => {
      if (unfolded.has(key)) unfolded.delete(key);
      else unfolded.add(key);
      draw();
    });
    b.setAttribute('aria-expanded', String(open));
    b.append(...head);
    li.append(b);
    if (open) li.append(body());
  }

  /** A tool as the terminal shows it: ● Update(src/main.js), and under it ⎿ what it gave back. */
  function tool(row) {
    const li = make('li', `cl-tool${row.error ? ' error' : ''}`);
    const head = make('p', 'cl-call');
    head.append(make('span', 'cl-dot', '●'), make('strong', '', row.name));
    if (row.arg) head.append(document.createTextNode(`(${row.arg})`));
    li.append(head);
    for (const result of row.results) {
      const out = make('div', `cl-out${result.error ? ' error' : ''}`);
      out.append(make('span', 'cl-elbow', '⎿'), words(result.text));
      li.append(out);
    }
    return li;
  }

  /** One row of the session (ClaudeCli.rows says which). */
  function row(r) {
    if (r.type === 'you' || r.type === 'claude') {
      const li = make('li', `cl-${r.type}`);
      li.append(make('span', r.type === 'you' ? 'cl-prompt' : 'cl-dot', r.type === 'you' ? '❯' : '●'), words(r.text));
      return li;
    }
    if (r.type === 'thinking') {
      const li = make('li', 'cl-thinking');
      foldable(li, `thinking:${r.id}`, [make('span', 'cl-mark', '∴'), make('em', '', 'Thinking…')], () => words(r.text, 'cl-thought'));
      return li;
    }
    if (r.type === 'tool') return tool(r);
    if (r.type === 'summary') {
      const li = make('li', `cl-summary${r.error ? ' error' : ''}`);
      foldable(li, `summary:${r.id}`, [document.createTextNode(r.text)], () => {
        const inner = make('ol', 'cl-inner');
        inner.append(...r.tools.map(tool));
        return inner;
      });
      return li;
    }
    const li = make('li', `cl-event${r.error ? ' error' : ''}`);
    li.append(make('span', 'cl-elbow', '⎿'), make('p', '', r.text));
    return li;
  }

  /** The workers (ClaudeCli.workerList): a line each, or one line that unfolds when there are many. */
  function workerRows(view) {
    const line = (w) => {
      const li = make('li', `cl-worker ${w.status}`);
      li.append(make('span', 'cl-dot', w.status === 'running' ? '◌' : w.status === 'done' ? '●' : '✗'), make('p', '', w.text));
      return li;
    };
    if (!view.compact) return view.lines.map(line);
    const li = make('li', 'cl-workers');
    foldable(li, 'workers:0', [make('span', 'cl-mark', '⏺'), document.createTextNode(view.summary)], () => {
      const inner = make('ol', 'cl-inner');
      inner.append(...view.lines.map(line));
      return inner;
    });
    return [li];
  }

  /** An answer to a slash command, with a ⎿ as the terminal draws it. */
  function noteRow(n) {
    const li = make('li', 'cl-event');
    const said = make('div', 'cl-said');
    said.append(make('p', '', n.text));
    li.append(make('span', 'cl-elbow', '⎿'), said);
    return li;
  }

  /** The /model picker, as Claude Code draws it: the models (✔ on the current one), then the effort levels; Apply sends. */
  function pickerRow(p) {
    const li = make('li', 'cl-picker');
    li.append(make('p', 'cl-picker-title', 'Select model'));
    const models = make('ul', 'cl-models');
    p.rows.forEach((row, i) => {
      const b = button(`cl-model${i === p.index ? ' on' : ''}`, '', () => core.pickerPick({ model: row.alias }));
      b.append(
        make('span', 'cl-cursor', i === p.index ? '❯' : ''),
        make('span', 'cl-label', `${i + 1}. ${row.label}`),
        make('span', 'cl-tick', row.alias === p.current ? '✔' : ''),
        make('span', 'cl-desc', row.name ? `${row.name} · ${row.hint}` : row.hint),
      );
      const item = make('li');
      item.append(b);
      models.append(item);
    });
    li.append(models);
    const levels = make('div', `cl-efforts${p.focus === 'effort' ? ' on' : ''}`);
    levels.append(make('span', 'cl-effort-title', 'Effort'));
    for (const level of EFFORTS) levels.append(button(`cl-effort${level === p.effort ? ' on' : ''}`, EFFORT_LABELS[level], () => core.pickerPick({ effort: level })));
    li.append(levels);
    const foot = make('div', 'cl-picker-foot');
    foot.append(button('cl-pick', 'Cancel', () => core.pickerClose()), button('cl-pick apply', 'Apply', () => core.pickerApply().then((r) => !r.ok && r.error && setLine('claude-error', r.error))));
    li.append(foot);
    return li;
  }

  /** While a worker runs, the session is drawn again every second (only while it is shown). */
  function keepTicking(on) {
    if (on && !tick) tick = setInterval(draw, TICK_MS);
    else if (!on && tick) {
      clearInterval(tick);
      tick = null;
    }
  }

  /** While the box holds "/" and part of a name: the commands it could be, above the box. A tap fills one in. */
  function showSuggest() {
    const found = core.state.session ? suggestions(input.value) : [];
    $('claude-suggest').replaceChildren(...found.map((c) => {
      const b = button('cl-suggestion', '', () => {
        input.value = `/${c.name}`;
        grow(input);
        showSuggest();
        updateSend();
        input.focus();
      });
      b.addEventListener('pointerdown', (e) => e.preventDefault()); // the box keeps the focus, and the keyboard stays up
      b.append(make('strong', '', `/${c.name}`), document.createTextNode(`  ${c.hint}`));
      const li = make('li');
      li.append(b);
      return li;
    }));
    $('claude-suggest').hidden = found.length === 0;
  }

  function drawSession(s) {
    const { session } = s;
    const named = session.title || session.name;
    $('claude-name').textContent = session.device ? `${named} · on ${session.device}` : named;
    $('claude-name').title = session.title ? `${session.title} (${session.name})` : session.name;
    $('claude-status').className = `status-chip ${session.status}`;
    $('claude-status').textContent = STATUS[session.status] || session.status;
    const opened = shownId !== session.id;
    if (opened) {
      voiceError = null; // another session: the old voice error and the open folds do not follow
      unfolded.clear();
      if (!full) setFull(true); // a session gets the whole phone; ⤡ brings the head back
    }
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const view = screen(s, Date.now());
    const rows = view.rows.map(row);
    rows.push(...workerRows(view.workers));
    if (view.working) {
      const li = make('li', 'cl-working');
      li.append(make('span', 'cl-spin'), make('span', '', view.working));
      rows.push(li);
    }
    if (view.waiting) rows.push(make('li', 'cl-waiting', '⏵ Claude is waiting for you in the terminal'));
    if (s.items === null) rows.push(make('li', 'cl-note', `Waiting for ${session.device || 'your computer'}…`));
    if (!session.canTalk) rows.push(make('li', 'cl-note', NO_TALK));
    rows.push(...s.notes.map(noteRow));
    if (s.picker) rows.push(pickerRow(s.picker));
    list.replaceChildren(...rows);
    const items = s.items || [];
    const last = items.length ? items[items.length - 1].id : 0;
    if (opened || s.notes.length > notesShown || (atBottom && last !== newest)) list.scrollTop = list.scrollHeight;
    shownId = session.id;
    newest = last;
    notesShown = s.notes.length;
    setLine('claude-line', view.line);
    setLine('claude-problem', s.problem);
    setLine('claude-error', s.boxError || voiceError);
    if (voice === 'idle') input.placeholder = 'Message Claude…  (/ for commands)';
    keepTicking(view.ticking);
  }

  function updateSend() {
    const s = core.state;
    $('claude-send').disabled = !(s.session && !s.sending && input.value.trim());
  }

  function draw() {
    const s = core.state;
    $('claude-pick').hidden = Boolean(s.session);
    $('claude-session').hidden = !s.session;
    if (s.session) {
      drawSession(s);
    } else {
      shownId = null;
      keepTicking(false);
      if (full) setFull(false);
      drawList(s);
    }
    updateSend();
    showSuggest();
  }

  async function sendTyped() {
    const text = input.value;
    if (!text.trim() || !core.state.session || core.state.sending) return; // the words stay in the box
    voiceError = null;
    setLine('claude-error', '');
    input.value = '';
    grow(input);
    updateSend();
    showSuggest();
    const r = await core.send(text);
    if (!r.ok && r.error && !input.value) {
      input.value = text; // not sent: the words come back
      grow(input);
    }
    updateSend();
    showSuggest();
  }

  $('claude-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendTyped();
  });
  input.addEventListener('keydown', (e) => {
    // A keyboard (iPad, a desktop browser) drives the picker while the box is empty, as the Mac panel's: ↑↓ model, ←→ effort, Esc closes.
    const move = !input.value && core.state.picker && { ArrowUp: () => core.pickerMove(-1), ArrowDown: () => core.pickerMove(1), ArrowLeft: () => core.pickerEffort(-1), ArrowRight: () => core.pickerEffort(1), Escape: () => core.pickerClose() }[e.key];
    if (move) {
      e.preventDefault();
      move();
      return;
    }
    if (e.key === 'Enter' && !input.value && core.state.picker && !e.isComposing) {
      e.preventDefault();
      core.pickerApply();
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendTyped();
    }
  });
  input.addEventListener('input', () => {
    grow(input);
    updateSend();
    showSuggest();
  });
  $('claude-full').addEventListener('click', () => setFull(!full));
  $('claude-back').addEventListener('click', () => core.list());
  $('claude-again').addEventListener('click', () => core.list());
  $('claude-mic').addEventListener('click', () => {
    voiceError = null;
    setLine('claude-error', '');
    onMic();
  });

  return {
    /** The tab opened (with `openId`, a notification's session): in Claude mode, or in view again. */
    show(openId = null) {
      if (openId || !core.state.on) core.enter(openId);
      else core.shown();
    },
    /** The app went out of view: the looks stop. */
    hidden() {
      keepTicking(false);
      core.hidden();
    },
    /** Another tab: the looks stop, and full screen ends. */
    away() {
      keepTicking(false);
      core.hidden();
      if (full) setFull(false);
    },
    /** Signed out: Claude mode ends. */
    leave() {
      keepTicking(false);
      if (full) setFull(false);
      voiceError = null;
      core.leave();
    },
    setVoice(on) {
      $('claude-mic').hidden = !on;
    },
    voiceState(state) {
      voice = state;
      $('claude-mic').setAttribute('aria-pressed', String(state === 'listening'));
      $('claude-mic').disabled = state === 'writing';
      input.placeholder = PLACEHOLDERS[state] || (core.state.session ? `Message Claude in ${core.state.session.title || core.state.session.name}…` : '');
    },
    addWords(text) {
      const typed = input.value.trimEnd();
      input.value = typed ? `${typed} ${text}` : text;
      grow(input);
      updateSend();
    },
    showError(message) {
      voiceError = message || null;
      setLine('claude-error', message);
    },
  };
}
