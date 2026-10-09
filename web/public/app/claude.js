// The Claude tab: Claude Code on the person's computers, as on the Android phone. The sessions they share, by
// computer; one picked shows live, with a box that types into its terminal, and ⤢ shows it full screen. What happens
// is claude-core.js's (it looks every 2 s, only while the tab is open and the app is in view); this file draws it.

import { createClaude, readLook, byDevice, STATUS, OFFLINE, NONE, NO_TALK } from './claude-core.js';
import { TIMEOUTS } from './api.js';
import { $, make, button, grow } from './dom.js';

const PLACEHOLDERS = { listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };

/**
 * api is api.js's; onMic() when 🎤 is tapped; onFull(on) when full screen goes on or off. Answers { show, hidden, away,
 * leave, setVoice, voiceState, addWords, showError }.
 */
export function startClaudeView({ api, onMic, onFull }) {
  const remote = (body) => api.post('/api/remote/phone', body, { timeoutMs: TIMEOUTS.remote });
  const core = createClaude({
    look: async (session) => readLook(await api.get(`/api/remote/phone${session ? `?session=${encodeURIComponent(session)}` : ''}`, { timeoutMs: TIMEOUTS.remote })),
    send: (session, text) => remote({ action: 'send', session, text }),
    stop: () => remote({ action: 'stop' }),
    onChange: () => draw(),
  });
  const input = $('claude-input');
  const list = $('claude-items');
  let full = false;
  let shownId = null; // the session drawn last, and its newest item: the list scrolls down for new items only
  let newest = 0;
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
        pick.append(make('span', 'name', session.name), make('span', `status-chip ${session.status}`, STATUS[session.status] || session.status));
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

  function drawSession(s) {
    const { session } = s;
    $('claude-name').textContent = session.device ? `${session.name} · on ${session.device}` : session.name;
    $('claude-status').className = `status-chip ${session.status}`;
    $('claude-status').textContent = STATUS[session.status] || session.status;
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    const items = s.items || [];
    const rows = items.map((item) => {
      const li = make('li', `cl-${item.kind}${item.error ? ' error' : ''}`);
      li.append(make('p', '', item.text));
      return li;
    });
    if (s.items === null) rows.push(make('li', 'cl-note', `Waiting for ${session.device || 'your computer'}…`));
    if (!session.canTalk) rows.push(make('li', 'cl-note', NO_TALK));
    list.replaceChildren(...rows);
    const last = items.length ? items[items.length - 1].id : 0;
    if (shownId !== session.id || (atBottom && last !== newest)) list.scrollTop = list.scrollHeight;
    shownId = session.id;
    newest = last;
    setLine('claude-problem', s.problem);
    setLine('claude-error', s.boxError || voiceError);
    if (voice === 'idle') input.placeholder = `Message Claude in ${session.name}…`;
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
      if (full) setFull(false);
      drawList(s);
    }
    updateSend();
  }

  async function sendTyped() {
    const text = input.value;
    if (!text.trim() || !core.state.session || core.state.sending) return; // the words stay in the box
    voiceError = null;
    setLine('claude-error', '');
    input.value = '';
    grow(input);
    updateSend();
    const r = await core.send(text);
    if (!r.ok && r.error && !input.value) {
      input.value = text; // not sent: the words come back
      grow(input);
    }
    updateSend();
  }

  $('claude-form').addEventListener('submit', (e) => {
    e.preventDefault();
    sendTyped();
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendTyped();
    }
  });
  input.addEventListener('input', () => {
    grow(input);
    updateSend();
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
    hidden: () => core.hidden(),
    /** Another tab: the looks stop, and full screen ends. */
    away() {
      core.hidden();
      if (full) setFull(false);
    },
    /** Signed out: Claude mode ends. */
    leave() {
      if (full) setFull(false);
      core.leave();
    },
    setVoice(on) {
      $('claude-mic').hidden = !on;
    },
    voiceState(state) {
      voice = state;
      $('claude-mic').setAttribute('aria-pressed', String(state === 'listening'));
      $('claude-mic').disabled = state === 'writing';
      input.placeholder = PLACEHOLDERS[state] || (core.state.session ? `Message Claude in ${core.state.session.name}…` : '');
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
