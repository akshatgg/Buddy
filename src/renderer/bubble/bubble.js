'use strict';

window.buddy.onText((text) => {
  document.getElementById('text').textContent = text;
});
