'use strict';

const words = document.getElementById('text');

// A speech bubble (a hands-free answer) wraps, and its words take the pointer and a click, which opens the chat.
window.buddy.onText((text, speech) => {
  words.textContent = text;
  document.body.classList.toggle('speech', speech);
});
words.addEventListener('mouseenter', () => window.buddy.hover(true));
words.addEventListener('mouseleave', () => window.buddy.hover(false));
words.addEventListener('click', () => window.buddy.click());
