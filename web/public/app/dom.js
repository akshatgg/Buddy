// Two small helpers for the parts of the app that draw (chat.js, claude.js, settings.js).

/** The element with this id. */
export const $ = (id) => document.getElementById(id);

/** A new element, with a class and text if given. */
export function make(tag, className = '', text = '') {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text) el.textContent = text;
  return el;
}

/** A button that does `onClick`. */
export function button(className, text, onClick) {
  const b = make('button', className, text);
  b.type = 'button';
  b.addEventListener('click', onClick);
  return b;
}

/** A box that grows with its text, up to its CSS max-height. */
export function grow(textarea) {
  textarea.style.height = 'auto';
  textarea.style.height = `${textarea.scrollHeight}px`;
}
