'use strict';

/**
 * Where Buddy lives: in the notch (notch-window.js) or floating (buddy-window.js). main.js uses this in the floating
 * buddy's place: it is the floating buddy with show, hide, isVisible, mood and pause going to the one in use, what
 * Buddy says going beside the notch or into the bubble, and refresh() choosing between the two. Everything else the
 * floating buddy does (its bounds, its drag, its model, and whatever is added to it later) goes to it as it is.
 */

const { chooseHome, findDisplay } = require('./notch-geometry');

/** The same notch, or none both times. */
const sameNotch = (a, b) => (!a && !b) || (Boolean(a && b) && a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height);

function createHome({ floating, notch, bubble, store, helper, screen, platform = process.platform }) {
  let where = 'floating';
  let current = null; // the notch in use, { notch, display }, while where is 'notch'
  let found = []; // the notch screens on now, [{ notch, display }], from the last refresh

  const inUse = () => (where === 'notch' ? notch : floating);

  function show() {
    if (where === 'notch') notch.show(current.notch, current.display);
    else floating.show();
  }

  /** The screens with a notch that Electron has too, from the helper; none when it cannot say, and none off the Mac. */
  async function askNotches() {
    if (platform !== 'darwin') return []; // only a Mac has one: no helper call on Windows
    try {
      const answer = await helper.call('notch');
      const displays = screen.getAllDisplays();
      return (Array.isArray(answer?.notches) ? answer.notches : [])
        .map((entry) => ({ notch: entry.notch, display: findDisplay(entry, displays) }))
        .filter((n) => n.display && n.notch);
    } catch (err) {
      console.warn('[buddy] could not ask about the notch:', err.code || err.name);
      return [];
    }
  }

  return {
    ...floating,
    show,
    hide: () => inUse().hide(),
    /** Whether Buddy is wanted on screen, as the one in use reports it. */
    isVisible: () => inUse().isVisible(),
    mood: (name) => inUse().mood(name),
    pause: (value) => inUse().pause(value),
    say(text) {
      if (where === 'notch') notch.say(text);
      else bubble.say(text, floating.bounds(), floating.display().workArea);
    },
    /**
     * Where the panel goes (panel-window.js show): under the notch, or beside the floating buddy. The work area is
     * asked for now, not kept from the last refresh: the Dock or the menu bar may have changed since.
     */
    panelAt() {
      if (where === 'notch') return { kind: 'below', notch: current.notch, area: screen.getDisplayMatching(current.notch).workArea };
      return { kind: 'beside', buddy: floating.bounds(), area: floating.display().workArea };
    },
    where: () => where,
    /** A notch screen is on now (from the last refresh), whichever home the person chose. */
    hasNotch: () => found.length > 0,
    notchWindow: () => notch,
    /**
     * Ask the helper where the notch is and choose again (the setting, the Mac, a notch screen on now). When the
     * choice changed, or the notch moved, Buddy moves: the one no longer in use is hidden, and the other is shown if
     * Buddy was on screen. Called at start, when a screen is added or removed, and when the setting changes.
     */
    async refresh() {
      found = await askNotches();
      const choice = chooseHome({ platform, home: store.get('home'), notches: found });
      const next = choice === 'notch' ? found[0] : null;
      if (choice === where && sameNotch(current?.notch, next?.notch)) return;
      const shown = inUse().isVisible();
      if (shown) inUse().hide();
      where = choice;
      current = next;
      if (shown) show();
    },
  };
}

module.exports = { createHome };
