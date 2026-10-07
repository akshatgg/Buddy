'use strict';
/* global module */
/* exported ChatView */

/**
 * What the panel draws for the chat state the main process sends (src/main/actions.js): the label of each button,
 * the selection card's first words, the "… is thinking" line, whether a message can be sent now, and what to draw
 * for each item in the chat. The panel page loads this as a script; the unit tests require it. So it must stay free
 * of the DOM.
 *
 * An item's parts: { id, kind: 'you' | 'buddy' | 'event' | 'error' | 'question', say, text, notes,
 * buttons: [{ button, label, primary }] }. `say` and `notes` are only ever filled in for the buddy's answers.
 */
const ChatView = (() => {
  const LABELS = {
    insert: 'Insert',
    replace: 'Replace',
    copy: 'Copy',
    undo: 'Undo',
    retry: 'Try again',
    settings: 'Open Settings',
    send: 'Send',
    'not-now': 'Not now',
  };
  // The button that does what the answer is for: put the text in the app, or send it.
  const PRIMARY = ['insert', 'replace', 'send'];
  const KINDS = ['you', 'buddy', 'event', 'error', 'question'];
  const PREVIEW_CHARS = 40;

  const text = (value) => (typeof value === 'string' ? value : '');

  function buttonLabel(button) {
    return Object.hasOwn(LABELS, button) ? LABELS[button] : '';
  }

  /** The first words of the selection, on one line: about 40 characters, cut where a word ends, then "…". */
  function selectionPreview(selection) {
    const flat = text(selection).replace(/\s+/g, ' ').trim();
    const chars = Array.from(flat); // characters, so that an emoji is never cut in half
    if (chars.length <= PREVIEW_CHARS) return flat;
    let cut = chars.slice(0, PREVIEW_CHARS);
    if (chars[PREVIEW_CHARS] !== ' ') {
      const space = cut.lastIndexOf(' ');
      if (space > PREVIEW_CHARS / 2) cut = cut.slice(0, space); // a short first word and a very long one: cut it anyway
    }
    return `${cut.join('').trimEnd()}…`;
  }

  function thinkingLine(buddyName) {
    return `${text(buddyName) || 'Buddy'} is thinking…`;
  }

  /** One message at a time; and an empty box only goes when there is a selection, which it then fixes. */
  function canSend({ busy, text: typed, selection } = {}) {
    if (busy) return false;
    return text(typed).trim() !== '' || text(selection) !== '';
  }

  /** What to draw for one item of the chat, or null for one that has nothing to show (or a kind this page doesn't know). */
  function itemParts(item) {
    if (!item || typeof item !== 'object' || !KINDS.includes(item.type)) return null;
    const answer = item.type === 'buddy';
    const buttons = item.type === 'you' || !Array.isArray(item.buttons) ? [] : item.buttons
      .filter((b, i, all) => buttonLabel(b) && all.indexOf(b) === i)
      .map((button) => ({ button, label: buttonLabel(button), primary: PRIMARY.includes(button) }));
    const parts = {
      id: item.id,
      kind: item.type,
      say: answer ? text(item.say) : '',
      text: text(item.text),
      notes: answer && Array.isArray(item.notes) ? item.notes.filter((n) => text(n) !== '') : [],
      buttons,
    };
    if (!parts.say && !parts.text && !parts.notes.length && !parts.buttons.length) return null;
    return parts;
  }

  return { buttonLabel, selectionPreview, thinkingLine, canSend, itemParts };
})();

if (typeof module !== 'undefined') module.exports = ChatView;
