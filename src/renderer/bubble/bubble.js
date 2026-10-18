'use strict';

const box = document.getElementById('box');
const words = document.getElementById('text');
const row = document.getElementById('buttons');
const LABELS = { stop: 'Stop', yes: 'Yes', no: 'No', 'go-on': 'Go on' };

// A speech bubble (a hands-free answer) wraps, and its words take the pointer and a click, which opens the chat. During
// a job it has buttons: Stop, or Yes / No for a question, or Go on after the person did a part themselves.
window.buddy.onText((text, speech, buttons, token) => {
  words.textContent = text;
  document.body.classList.toggle('speech', speech);
  row.replaceChildren(...buttons.filter((b) => LABELS[b]).map((name) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = LABELS[name];
    b.className = name === 'stop' || name === 'no' ? 'quiet' : '';
    b.addEventListener('click', (event) => {
      event.stopPropagation();
      if (row.dataset.used === token) return; // one press for each question; the row is off after it
      row.dataset.used = token;
      row.querySelectorAll('button').forEach((x) => { x.disabled = true; });
      window.buddy.button(name, token);
    });
    return b;
  }));
  delete row.dataset.used;
  row.hidden = buttons.length === 0;
  document.body.classList.toggle('buttons', buttons.length > 0); // 3 lines of words, so that the row always fits
});
box.addEventListener('mouseenter', () => window.buddy.hover(true));
box.addEventListener('mouseleave', () => window.buddy.hover(false));
words.addEventListener('click', () => window.buddy.click());
