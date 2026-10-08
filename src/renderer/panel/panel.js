'use strict';
/* global ChatView */

/*
 * The panel is a chat. The main process keeps the chat and sends all of it after every change (src/main/actions.js);
 * this page only draws it, and sends what the person types and the buttons they click. What to draw for each item
 * comes from chat-view.js. Every word from the chat is put in as text, never as HTML.
 *
 * The list is drawn anew on every change, so it is not a live region (a screen reader would read the whole chat out
 * again each time): what is new in it is read out through #announce instead.
 */

const $ = (id) => document.getElementById(id);
const { canSend, itemParts, selectionPreview, speaker, spokenLine, thinkingLine } = ChatView;

let state = null; // the chat as the main process sent it last
let sending = false; // a message is on its way: the next one waits until its answer is in
let generation = 0; // counts how often the panel has been opened; an answer to a request from an earlier opening is stale
let newest = null; // the last item and whether the buddy was thinking, as last drawn: something new there scrolls to it
let heard = null; // what a screen reader was told of each item, by id; null until the chat is first drawn
const acting = new Set(); // the items whose button was clicked and is still being done, so that a second click waits

function show(el, visible) {
  el.hidden = !visible;
}

function make(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** A line under the box for a message or a click that did not go through. */
function showSendError(message) {
  $('send-error').textContent = message || '';
  show($('send-error'), Boolean(message));
}

function drawButtons(parts) {
  const row = make('div', 'actions');
  for (const { button, label, primary } of parts.buttons) {
    let look = primary ? 'btn small primary' : 'btn small';
    if (parts.kind === 'event') look = 'btn small quiet'; // a small line's Undo reads like a link
    const b = make('button', look, label);
    b.type = 'button';
    b.disabled = acting.has(parts.id);
    b.addEventListener('click', () => act(parts.id, button, row));
    row.append(b);
  }
  return row;
}

/**
 * One item of the chat: yours on the right, the buddy's on the left, what happened as a small line in the middle. A
 * message starts with who it is from ("You:", "Aarav:"), for screen readers only: the side it is on says it to the eye.
 */
function drawItem(parts, buddyName) {
  const li = make('li', `item ${parts.kind}`);
  if (parts.kind === 'event') {
    li.append(make('p', 'text', parts.text));
    if (parts.buttons.length) li.append(drawButtons(parts));
    return li;
  }
  const bubble = make('div', 'bubble');
  bubble.append(make('span', 'visually-hidden', `${speaker(parts.kind, buddyName)} `));
  if (parts.say) bubble.append(make('p', 'say', parts.say));
  if (parts.text) bubble.append(make('p', 'text', parts.text));
  if (parts.notes.length) {
    const notes = make('ul', 'notes');
    notes.append(...parts.notes.map((note) => make('li', '', note)));
    bubble.append(notes);
  }
  if (parts.buttons.length) bubble.append(drawButtons(parts));
  li.append(bubble);
  return li;
}

/**
 * Reads out to a screen reader the items that are new in the chat, or that changed (an Undo that was used), and not
 * the person's own messages: they wrote them. What was there when the chat was first drawn is not read out.
 */
function announce(parts, buddyName) {
  const now = new Map(parts.map((p) => [p.id, spokenLine(p, buddyName)]));
  const lines = heard ? parts.filter((p) => p.kind !== 'you' && heard.get(p.id) !== now.get(p.id)).map((p) => now.get(p.id)) : [];
  heard = now;
  // New lines each time, so that the same words twice (two answers alike) are read out twice too.
  if (lines.length) $('announce').replaceChildren(...lines.map((line) => make('p', '', line)));
}

/**
 * The list is drawn anew on every change, which takes the keyboard focus with it when it was on one of its buttons:
 * then it goes back to the box, so that the person can type on. Not when they put it somewhere else, or are selecting
 * words in the chat to copy them.
 */
function focusBoxIfLost() {
  const at = document.activeElement;
  if (at && at !== document.body && at.isConnected) return;
  const selection = document.getSelection();
  if (selection && !selection.isCollapsed) return;
  $('box').focus();
}

function updateSend() {
  const ready = Boolean(state) && canSend({ busy: state.busy || sending, text: $('box').value, selection: state.selection });
  $('send').disabled = !ready;
}

/** Shows the newest item: its end, or its start when it is taller than the list (a long mail is read from the top). */
function scrollToNewest() {
  const chat = $('chat');
  const last = $('items').lastElementChild;
  if (last && !state.busy && last.offsetHeight > chat.clientHeight) {
    chat.scrollTop = last.offsetTop - 8; // the list is the item's offset parent (panel.css)
  } else {
    chat.scrollTop = chat.scrollHeight;
  }
}

function render({ scroll = false } = {}) {
  const s = state;
  $('who').textContent = s.buddyName || 'Buddy';
  $('where').textContent = s.appName ? `· ${s.appName}` : '';
  $('greeting').textContent = s.greeting || 'Hi! What should we do?';

  const parts = (Array.isArray(s.chat) ? s.chat : []).map(itemParts).filter(Boolean);
  const focusInList = $('items').contains(document.activeElement);
  $('items').replaceChildren(...parts.map((p) => drawItem(p, s.buddyName)));
  if (focusInList) focusBoxIfLost();
  announce(parts, s.buddyName);
  show($('empty'), parts.length === 0);
  // Written only when it changes: the line is read out whenever its words are written.
  const thinking = thinkingLine(s.buddyName);
  if ($('thinking').textContent !== thinking) $('thinking').textContent = thinking;
  show($('thinking'), Boolean(s.busy));

  $('notice').textContent = s.notice || '';
  show($('notice'), Boolean(s.notice));
  $('selection-text').textContent = s.selection ? `“${selectionPreview(s.selection)}”` : '';
  show($('selection'), Boolean(s.selection));
  updateSend();

  // Scrolled when something new came in at the bottom, not when an older item changed (its Undo used, say), so
  // that the list stays where the person is reading.
  const now = { id: parts.length ? parts[parts.length - 1].id : null, busy: Boolean(s.busy) };
  if (scroll || !newest || now.id !== newest.id || (now.busy && !newest.busy)) scrollToNewest();
  newest = now;
}

async function send() {
  if (!state || !canSend({ busy: state.busy || sending, text: $('box').value, selection: state.selection })) return;
  const mine = generation;
  const message = $('box').value.trim();
  $('box').value = '';
  showSendError('');
  sending = true;
  updateSend();
  let r;
  try {
    r = await window.buddy.send(message); // an empty message with a selection fixes the selection
  } finally {
    if (mine === generation) {
      sending = false;
      updateSend();
    }
  }
  if (mine !== generation || r.ok) return; // the answer (or what went wrong) is in the chat by now
  if (!$('box').value) $('box').value = message; // it did not go: the words are given back, to send again
  showSendError(r.error.message);
  updateSend();
}

async function act(id, button, row) {
  if (acting.has(id)) return;
  const mine = generation;
  acting.add(id);
  for (const b of row.querySelectorAll('button')) b.disabled = true;
  showSendError('');
  let r;
  try {
    r = await window.buddy.act(id, button);
  } finally {
    if (mine === generation) {
      acting.delete(id);
      render();
      // Still this opening of the panel. Where it stayed open (Copy, Not now, Try again, Undo on "Remembered"), the
      // button that was clicked went with the list drawn again: the keyboard goes back to the box.
      focusBoxIfLost();
    }
  }
  if (mine === generation && !r.ok) showSendError(r.error.message);
}

const box = $('box');
box.addEventListener('input', updateSend);
box.addEventListener('keydown', (e) => {
  // ↩ sends and ⇧↩ starts a new line. While an input method is composing (Hindi, Devanagari), ↩ belongs to it.
  if (e.key !== 'Enter' || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  send();
});
$('send').addEventListener('click', () => {
  send();
  box.focus();
});
$('drop-selection').addEventListener('click', async () => {
  const r = await window.buddy.dropSelection();
  if (!r.ok) showSendError(r.error.message);
  box.focus();
});
$('close').addEventListener('click', () => window.buddy.close());
$('settings').addEventListener('click', () => window.buddy.openSettings());

document.addEventListener('keydown', (e) => {
  if (e.isComposing) return; // Esc belongs to the input method while it is composing
  if (e.key === 'Escape') window.buddy.close();
});

window.buddy.onOpen((s) => {
  generation += 1;
  sending = false;
  acting.clear();
  heard = null; // what is in the chat as it opens is not read out: only what comes after
  showSendError('');
  if (!s.resumed) box.value = ''; // a new chat starts with an empty box; a resumed one keeps what was typed
  state = s;
  render({ scroll: true });
  box.focus();
});

window.buddy.onState((s) => {
  state = s;
  render();
});
