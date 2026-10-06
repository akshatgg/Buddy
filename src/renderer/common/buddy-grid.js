'use strict';
/* exported renderBuddyGrid */

/** The grid of buddies to choose from, used by Settings and the Welcome window. */
function renderBuddyGrid(container, characters, selectedId, onPick) {
  container.replaceChildren(...characters.map((c) => {
    const input = Object.assign(document.createElement('input'), {
      type: 'radio', name: 'buddy', value: c.id, checked: c.id === selectedId,
    });
    input.addEventListener('change', () => onPick(c));
    const img = Object.assign(document.createElement('img'), { src: `../../../assets/buddies/${c.preview}`, alt: '' });
    const caption = Object.assign(document.createElement('span'), { textContent: c.defaultName });
    const label = document.createElement('label');
    label.className = 'buddy-card';
    label.append(input, img, caption);
    return label;
  }));
}
