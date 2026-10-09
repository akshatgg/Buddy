// The Settings tab: which buddy, what Buddy remembers about the person (memory.js) and whether it learns from chats,
// notifications for Claude Code (push.js), and the account. Each part draws itself again when it changes; draw() draws it all when the tab opens.

import { $, make, button } from './dom.js';
import { NOT_INSTALLED, NOT_SUPPORTED } from './push.js';

const NOT_KEPT = "I didn't keep that. It may be known already, too long, or something secret like a password.";

/**
 * store is store.js's; memory is memory.js's; buddies() the list in buddies.json; onBuddy(id) when another buddy is
 * picked; account() the person signed in; onSignOut() for Sign out; push is push.js's, and support() says whether this
 * browser can have notifications (push.js supportHere). Answers { draw }.
 */
export function startSettings({ store, memory, buddies, onBuddy, account, onSignOut, push, support }) {
  function drawBuddies() {
    const all = buddies();
    const picked = all.find((b) => b.id === store.read('buddy', null)) || all[0];
    $('buddy-choice').replaceChildren(...all.map((b) => {
      const choice = button('', '', () => {
        onBuddy(b.id);
        drawBuddies();
      });
      choice.setAttribute('aria-pressed', String(b === picked));
      const img = make('img');
      img.src = `/app/buddies/${b.preview}`;
      img.alt = '';
      img.width = 88;
      img.height = 88;
      choice.append(img, make('span', '', b.defaultName));
      return choice;
    }));
  }

  function drawMemory() {
    const facts = memory.list();
    $('learn').checked = memory.learning();
    $('facts').replaceChildren(...facts.map((fact) => {
      const li = make('li');
      const forget = button('chip', 'Forget', () => {
        memory.remove(fact.id);
        drawMemory();
      });
      forget.setAttribute('aria-label', `Forget: ${fact.text}`);
      li.append(make('span', '', fact.text), forget);
      return li;
    }));
    $('facts-empty').hidden = facts.length > 0;
    $('forget-all').hidden = facts.length === 0;
  }

  function showFactError(message) {
    $('fact-error').textContent = message;
    $('fact-error').hidden = !message;
  }

  function showPushNote(message) {
    $('push-note').textContent = message;
    $('push-note').hidden = !message;
  }

  async function drawPush() {
    const toggle = $('push-switch');
    const can = support();
    toggle.disabled = can !== 'ok';
    if (can !== 'ok') {
      toggle.checked = false;
      showPushNote(can === 'not-installed' ? NOT_INSTALLED : NOT_SUPPORTED);
      return;
    }
    showPushNote('');
    toggle.checked = await push.isOn().catch(() => false);
  }

  $('push-switch').addEventListener('change', async (e) => {
    const toggle = e.target;
    toggle.disabled = true;
    const r = toggle.checked ? await push.on() : await push.off();
    toggle.disabled = false;
    if (!r.ok) toggle.checked = !toggle.checked;
    showPushNote(r.ok ? '' : r.error);
  });
  $('learn').addEventListener('change', (e) => memory.setLearning(e.target.checked));
  $('fact-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('fact-input').value;
    if (!text.trim()) return;
    if (memory.add(text, { source: 'settings' })) {
      $('fact-input').value = '';
      showFactError('');
      drawMemory();
    } else {
      showFactError(NOT_KEPT);
    }
  });
  $('forget-all').addEventListener('click', () => {
    if (!window.confirm('Forget everything Buddy knows about you?')) return;
    memory.clear();
    drawMemory();
  });
  $('signout').addEventListener('click', () => onSignOut());

  return {
    draw() {
      drawBuddies();
      drawMemory();
      drawPush();
      showFactError('');
      const who = account();
      $('account-email').textContent = who ? `Signed in as ${who.email}` : '';
    },
  };
}
