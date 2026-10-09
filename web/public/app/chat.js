// The Chat tab: the messages and Buddy's answers, the box with 🎤 and send, and each answer's Copy and Share (the phone
// cannot put text into other apps, so the person pastes it there themselves). What happens is chat-core.js's; this
// file draws it and passes on the taps.

import { canSend } from './chat-core.js';
import { $, make, button, grow } from './dom.js';

const LABELS = { copy: 'Copy', share: 'Share', undo: 'Undo', retry: 'Try again' };
const COPY_FAILED = "I couldn't copy it. Press and hold the text to copy it instead.";
const SHARE_FAILED = "I couldn't open Share. Use Copy instead.";
const PLACEHOLDERS = { idle: 'Ask Buddy…', listening: 'Listening… tap 🎤 when you are done', writing: 'Writing it down…' };

/**
 * chat is chat-core.js's. buddyName() for "… is thinking"; say(text) shows a short line under the head; onCelebrate()
 * when an answer was copied or shared (the phone's "put it in the app"); onMic() when 🎤 is tapped. Answers
 * { draw, showError, setVoice, voiceState, addWords }.
 */
export function startChatView({
  chat, buddyName, say, onCelebrate, onMic,
  share = navigator.share ? (data) => navigator.share(data) : null,
  copy = (text) => navigator.clipboard.writeText(text),
}) {
  const list = $('chat-items');
  const input = $('chat-input');
  const send = $('chat-send');
  const mic = $('chat-mic');
  const errorLine = $('chat-error');

  function showError(message) {
    errorLine.textContent = message;
    errorLine.hidden = !message;
  }

  function updateSend() {
    send.disabled = !canSend({ busy: chat.state.busy, text: input.value });
  }

  async function press(item, name) {
    showError('');
    if (name === 'copy') {
      try {
        await copy(item.text);
        say('Copied');
        onCelebrate();
      } catch {
        showError(COPY_FAILED);
      }
    } else if (name === 'share') {
      try {
        await share({ text: item.text });
        onCelebrate();
      } catch (err) {
        if (err?.name !== 'AbortError') showError(SHARE_FAILED); // AbortError: the person closed the share sheet
      }
    } else if (name === 'undo') {
      chat.forget(item.id);
    } else if (name === 'retry') {
      chat.retry(item.id);
    }
  }

  function drawItem(item) {
    const li = make('li', `item ${item.type}`);
    if (item.say) li.append(make('p', 'say', item.say));
    if (item.text) li.append(make('p', item.type === 'buddy' ? 'text' : '', item.text));
    if (item.notes.length) {
      const notes = make('ul', 'notes');
      notes.append(...item.notes.map((note) => make('li', '', note)));
      li.append(notes);
    }
    const names = item.buttons.filter((name) => name !== 'share' || share);
    if (names.length) {
      const row = make('div', 'buttons');
      row.append(...names.map((name) => button('chip', LABELS[name], () => press(item, name))));
      li.append(row);
    }
    return li;
  }

  function draw() {
    const { items, busy } = chat.state;
    const rows = items.map(drawItem);
    if (busy) rows.push(make('li', 'item thinking', `${buddyName()} is thinking…`));
    list.replaceChildren(...rows);
    $('chat-empty').hidden = items.length > 0;
    updateSend();
    list.scrollTop = list.scrollHeight;
  }

  async function sendTyped() {
    const text = input.value;
    if (!canSend({ busy: chat.state.busy, text })) return;
    showError('');
    input.value = '';
    grow(input);
    const r = await chat.send(text);
    if (!r.ok && r.error) {
      if (!input.value) input.value = text; // refused before it went: the words come back to make shorter
      grow(input);
      showError(r.error);
    }
    updateSend();
  }

  $('chat-form').addEventListener('submit', (e) => {
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
  mic.addEventListener('click', () => onMic());

  return {
    draw,
    showError,

    /** Voice is on for this person (the server has a Groq key): 🎤 shows. */
    setVoice(on) {
      mic.hidden = !on;
    },

    /** What the voice is doing: 'idle', 'listening' or 'writing'. */
    voiceState(state) {
      mic.setAttribute('aria-pressed', String(state === 'listening'));
      mic.disabled = state === 'writing';
      input.placeholder = PLACEHOLDERS[state] || PLACEHOLDERS.idle;
    },

    /** Words that were said: into the box after what is there, to send when the person wants. */
    addWords(text) {
      const typed = input.value.trimEnd();
      input.value = typed ? `${typed} ${text}` : text;
      grow(input);
      updateSend();
      input.focus();
    },
  };
}
