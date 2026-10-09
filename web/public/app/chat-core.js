// The chat on the phone, without the page: what goes to Buddy's server for each message, and what its answer adds to
// the chat. The request is the Mac panel's first step (src/main/actions.js): the message, the chat so far, what Buddy
// knows about the person and their first name, with step 1. The phone has no other app to read or type into, so it
// never sends a text box or a screenshot: an answer that asks for one says so, and an answer with text gets Copy and
// Share instead of Insert. chat.js draws the chat.
//
// An item: { id, type: 'you' | 'buddy' | 'event' | 'error', say, text, notes, buttons }, and `fact` on a fact that was
// remembered (Undo forgets it), `you` on an error (the message that Try again sends again).

import { LIMITS, CHAT_LIMITS } from './shared/prompts.js';

export const EMPTY = 'Tell me what to do first.';
export const TOO_LONG = `That message is too long (over ${LIMITS.instruction} characters). Try a shorter one.`;
export const CANT_SEE = "I can't see other apps on iPhone. Paste the text here.";
export const CANT_SEND = "I can't send it from your iPhone. Copy it, then send it there.";
export const NO_ANSWER = "I couldn't answer that. Try again.";
export const FREE_OFF = 'Free AI is off right now. Try again later.';
export const FAILED = 'Something went wrong. Try again.';
export const FORGOT = 'Okay, I forgot that.';

// The buttons of an answer with text. chat.js leaves Share out where the browser has no share sheet.
const TEXT_BUTTONS = ['copy', 'share'];
// Errors that asking again cannot fix: the message itself, or the sign-in (the app shows sign-in for that).
const NO_RETRY = ['bad_request', 'unauthenticated'];

/** The chat so far for the AI: the messages before `you`, the buddy's as its line and its text together (the Mac's). */
export function historyBefore(items, you) {
  const at = items.indexOf(you);
  return (at === -1 ? items : items.slice(0, at))
    .filter((item) => item.type === 'you' || item.type === 'buddy')
    .map((item) => ({ from: item.type, text: item.type === 'you' ? item.text : [item.say, item.text].filter(Boolean).join('\n\n') }))
    .filter((message) => message.text)
    .slice(-CHAT_LIMITS.history);
}

/** The body of POST /api/ask for the message `you`: the chat's first step, text only. */
export function chatRequest({ items, you, facts, userName }) {
  const body = { action: 'chat', message: you.text, history: historyBefore(items, you), facts, step: 1 };
  const name = String(userName || '').trim();
  if (name) body.userName = name;
  return body;
}

/** What an answer (shared/prompts.js parseChat's shape) shows in the chat. */
export function answerItem(reply) {
  const item = (say, text = '', notes = []) => ({ type: 'buddy', say, text, notes, buttons: text ? TEXT_BUTTONS : [] });
  if (reply.kind === 'box' || reply.kind === 'screen') return item(CANT_SEE);
  if (reply.kind === 'send') return item(CANT_SEND);
  if (!reply.say && !reply.text && !reply.notes.length) return item(NO_ANSWER);
  return item(reply.say, reply.text, reply.notes);
}

/** A send can go: no answer is on its way, and the box has words in it. */
export function canSend({ busy, text }) {
  return !busy && String(text ?? '').trim() !== '';
}

/** The words for a failed answer: the server's (free mode's limits, a block), or plain ones. */
export function failureText(err) {
  if (err?.code === 'free_off') return FREE_OFF; // the server's words send the person to an own key, which the phone has not
  return typeof err?.code === 'string' && typeof err.message === 'string' && err.message ? err.message : FAILED;
}

/**
 * One chat. ask(body) is POST /api/ask; memory is memory.js; userName() the person's first name; onMood(name) tells
 * the buddy (thinking, happy, sad, idle); onChange() after every change. `state` is { items, busy }.
 */
export function createChat({ ask, memory, userName = () => '', onMood = () => {}, onChange = () => {} }) {
  const state = { items: [], busy: false };
  let nextId = 1;
  let chatId = 0; // one more for each new chat: an answer for an earlier one is dropped

  function add(item) {
    const full = { id: nextId, say: '', text: '', notes: [], buttons: [], ...item };
    nextId += 1;
    state.items.push(full);
    return full;
  }

  /** Ask about `you`, and show what comes back. */
  async function answer(you) {
    const mine = chatId;
    state.busy = true;
    onMood('thinking');
    onChange();
    try {
      const out = await ask(chatRequest({ items: state.items, you, facts: memory.facts(), userName: userName() }));
      if (mine !== chatId) return;
      const reply = out?.chat || { kind: 'write', say: '', text: String(out?.text || ''), notes: [], remember: [] };
      for (const fact of reply.remember || []) {
        const saved = memory.add(fact);
        if (saved) add({ type: 'event', text: `📝 Remembered: ${saved.text}`, buttons: ['undo'], fact: saved.id });
      }
      const item = add(answerItem(reply));
      onMood(item.say === CANT_SEE || item.say === CANT_SEND ? 'idle' : 'happy');
    } catch (err) {
      if (mine !== chatId) return;
      onMood('sad');
      add({ type: 'error', text: failureText(err), buttons: NO_RETRY.includes(err?.code) ? [] : ['retry'], you: you.id });
    } finally {
      if (mine === chatId) {
        state.busy = false;
        onChange();
      }
    }
  }

  return {
    state,

    /** The person's message. Answers { ok: true } once it is answered, or { ok: false, error } when it was not sent. */
    async send(message) {
      if (state.busy) return { ok: false, error: '' };
      const text = String(message ?? '').trim();
      if (!text) return { ok: false, error: EMPTY };
      if (text.length > LIMITS.instruction) return { ok: false, error: TOO_LONG };
      await answer(add({ type: 'you', text }));
      return { ok: true };
    },

    /** "Try again" on an error: the error goes, and its message is asked about again. */
    async retry(id) {
      const error = state.items.find((item) => item.id === id && item.type === 'error');
      const you = error && state.items.find((item) => item.id === error.you);
      if (!you || state.busy) return;
      state.items.splice(state.items.indexOf(error), 1);
      await answer(you);
    },

    /** "Undo" on a fact Buddy remembered: forgotten again. */
    forget(id) {
      const item = state.items.find((i) => i.id === id && i.fact);
      if (!item) return;
      memory.remove(item.fact);
      Object.assign(item, { text: FORGOT, buttons: [], fact: undefined });
      onChange();
    },

    /** A new, empty chat (signing out). An answer still on its way is dropped. */
    clear() {
      chatId += 1;
      state.items = [];
      state.busy = false;
      onChange();
    },
  };
}
