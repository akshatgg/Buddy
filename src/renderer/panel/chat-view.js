'use strict';
/* global module */
/* exported ChatView */

/**
 * What the panel draws for the chat state the main process sends (src/main/actions.js): the label of each button,
 * the selection card's first words, the "… is thinking" line, whether a message can be sent now, what to draw for
 * each item in the chat, and what a screen reader says about it. The panel page loads this as a script; the unit tests
 * require it. So it must stay free of the DOM.
 *
 * An item's parts: { id, kind: 'you' | 'buddy' | 'event' | 'error' | 'question', say, text, notes,
 * buttons: [{ button, label, primary }] }. `say` and `notes` are only ever filled in for the buddy's answers.
 * A Claude Code job (kind 'job') has `project`, `lines` (what it is doing, newest last) and `done` as well.
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
    stop: 'Stop',
    'open-folder': 'Open folder',
    allow: 'Allow',
    deny: 'No',
  };
  // The button that does what the answer is for: put the text in the app, or send it.
  const PRIMARY = ['insert', 'replace', 'send', 'allow', 'open-folder'];
  const KINDS = ['you', 'buddy', 'event', 'error', 'question', 'job'];
  const PROJECT_BUTTON = 'project:'; // "Which project?": one button per folder, `project:<path>`
  const PREVIEW_CHARS = 40;

  const text = (value) => (typeof value === 'string' ? value : '');

  function buttonLabel(button) {
    // The pick on "Which project?" is named after its folder: the last part of the path, Mac or Windows.
    if (typeof button === 'string' && button.startsWith(PROJECT_BUTTON)) {
      return button.slice(PROJECT_BUTTON.length).split(/[\\/]/).filter(Boolean).pop() || '';
    }
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
    if (item.type === 'job') {
      // A Claude Code job: where it works, what it is doing now (the newest lines), and once done, what it did.
      Object.assign(parts, {
        project: text(item.project),
        lines: Array.isArray(item.lines) ? item.lines.filter((line) => text(line) !== '') : [],
        done: item.done === true,
      });
      return parts;
    }
    if (!parts.say && !parts.text && !parts.notes.length && !parts.buttons.length) return null;
    return parts;
  }

  /**
   * Who an item is from, for a screen reader, which cannot see which side of the chat it is on: "You:", the buddy's
   * name ("Aarav:") for its answers, errors and questions, and '' for a small line about what happened.
   */
  function speaker(kind, buddyName) {
    if (kind === 'you') return 'You:';
    if (kind === 'buddy' || kind === 'error' || kind === 'question' || kind === 'job') return `${text(buddyName) || 'Buddy'}:`;
    return '';
  }

  /** What a screen reader reads out for an item that is new in the chat: who it is from, then all its words. */
  function spokenLine(parts, buddyName) {
    const words = parts.kind === 'job' ? jobWords(parts) : [parts.say, parts.text, ...parts.notes].filter(Boolean).join(' ');
    const who = speaker(parts.kind, buddyName);
    return who ? `${who} ${words}` : words;
  }

  /** A job for a screen reader: where it works and its newest line, or that it is done (or stopped) and its summary. */
  function jobWords(parts) {
    if (!parts.done) return [`Working in ${parts.project}.`, parts.lines.at(-1)].filter(Boolean).join(' ');
    if (!parts.text) return `Was working in ${parts.project}.`; // it did not finish: the red line after it says why
    return parts.text === 'Stopped.' ? 'Stopped.' : [`Done in ${parts.project}.`, parts.text].filter(Boolean).join(' ');
  }

  /** A job's heading: where it works and whether it is done, stopped, or ended without finishing. */
  function jobHeading(parts) {
    if (!parts.done) return `🔧 Working in ${parts.project}`;
    if (!parts.text) return `🔧 Was working in ${parts.project}`;
    return parts.text === 'Stopped.' ? `⏹ Stopped in ${parts.project}` : `✅ Done in ${parts.project}`;
  }

  /** The empty chat's example for a job, when the person has a project; '' when they have none. */
  function exampleLine(project) {
    return text(project) ? `“fix the login bug in ${project}”` : '';
  }

  return { buttonLabel, selectionPreview, thinkingLine, canSend, itemParts, speaker, spokenLine, exampleLine, jobHeading };
})();

if (typeof module !== 'undefined') module.exports = ChatView;
