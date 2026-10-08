'use strict';

const { ASLEEP_MS } = require('../../../src/main/sleep');
const { installBuddyClock, moveBuddyClock } = require('../buddy-clock');

// The buddy's sleep as main runs it (src/main/sleep.js, src/main/feelings.js): left alone it gets drowsy, then falls
// asleep, and the pointer coming onto it wakes it; while the panel is open nothing counts down, and the buddy does not
// fidget either. The countdown is sped up for this check (ctx.sleepClock, test/e2e/smoke.js): a minute takes 1 s.
// Pointer events go to the page itself, as in 14-buddy-click.js: the real pointer does not move.
module.exports = async function sleepCheck(ctx, { assert, delay, waitFor }) {
  const SPEED = 60;
  const ASLEEP_SOON = ASLEEP_MS / SPEED; // how long it takes, at that speed, to fall asleep
  const win = ctx.buddy.window();
  const page = win.webContents;
  const js = (code) => page.executeJavaScript(code);
  await waitFor(() => js('window.__buddyReady === true').catch(() => false), 'the buddy page');
  const moodIs = (name) => async () => (await js('window.__buddyMood')) === name;
  await waitFor(moodIs('idle'), 'the buddy to be idle');

  // Every mood the page starts from here on, in order (it says each one in window.__buddyMood); and the page's clock,
  // moved on when a fidget should be due at once (buddy-clock.js).
  await js(`(() => {
    let current = window.__buddyMood;
    window.__buddyMoods = [];
    Object.defineProperty(window, '__buddyMood', {
      configurable: true,
      enumerable: true,
      get: () => current,
      set: (name) => {
        current = name;
        window.__buddyMoods.push(name);
      },
    });
    return true;
  })()`);
  await installBuddyClock(page);
  const count = async () => (await js('window.__buddyMoods')).length;
  const since = async (from) => (await js('window.__buddyMoods')).slice(from);
  // The middle of the buddy's own box: the bottom of the window, below the room for its symbols.
  const box = ctx.buddy.bounds();
  const { x: left, y: top } = win.getBounds();
  const middle = { x: Math.round(box.x - left + box.width / 2), y: Math.round(box.y - top + box.height / 2) };
  /** The pointer onto the buddy (the page finds it there and tells main), or off it, to the window's empty corner. */
  async function pointer(on) {
    page.sendInputEvent({ type: 'mouseMove', ...(on ? middle : { x: 1, y: 1 }) });
    const cursor = on ? 'grab' : 'default';
    await waitFor(async () => (await js("document.getElementById('c').style.cursor")) === cursor,
      on ? 'the pointer on the buddy' : 'the pointer to leave the buddy');
  }

  try {
    // 1. Left alone, it gets drowsy and then falls asleep. The pointer coming onto it and leaving is a use, which starts
    // the countdown again, at the new speed.
    ctx.sleepClock.speed = SPEED;
    await pointer(true);
    await pointer(false);
    const from = await count();
    await waitFor(moodIs('asleep'), 'the buddy to get drowsy and fall asleep', 3 * ASLEEP_SOON);
    assert.deepStrictEqual(await since(from), ['drowsy', 'asleep']);

    // 2. The pointer on the sleeping buddy wakes it: it stretches, then it is idle.
    await pointer(true);
    await waitFor(moodIs('idle'), 'the buddy to wake up', 4000);
    assert.deepStrictEqual(await since(from), ['drowsy', 'asleep', 'wake', 'idle'], 'wake, then idle');

    // 3. The panel open (as the shortcut opens it): nothing counts down, and the page knows it is open, so no fidget
    // starts even when one is due.
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    await waitFor(() => ctx.panel.isVisible(), 'the panel to open');
    await pointer(false);
    const opened = await count();
    await delay(200); // the page has heard that the panel is open by now
    await moveBuddyClock(page, 30000);
    await delay(ASLEEP_SOON + 500);
    assert.deepStrictEqual(await since(opened), [], 'no drowsiness, no sleep and no fidget while the panel is open');

    // 4. Closed, the countdown starts again from then.
    await ctx.actions.dismiss();
    await waitFor(moodIs('drowsy'), 'the buddy to get drowsy once the panel is closed', 3 * ASLEEP_SOON);

    // 5. Buddy working on a message is a use too, as every mood the app sends is: it wakes the drowsy buddy first, so
    // that what shows is the work. (actions.send is what the panel's ↩ calls; with no key, the answer is an error.)
    const sent = await count();
    await ctx.actions.send('say hi');
    await waitFor(async () => (await since(sent)).length >= 2, 'the buddy to wake and think');
    assert.deepStrictEqual((await since(sent)).slice(0, 2), ['wake', 'thinking']);
    await ctx.actions.dismiss(); // the checks that follow start on a new chat

    // A use at the real speed, for the checks that follow: it wakes the buddy, and the next countdown takes minutes.
    ctx.sleepClock.speed = 1;
    await pointer(true);
    await pointer(false);
    await waitFor(moodIs('idle'), 'the buddy to be awake again', 4000);
    await js(`(() => {
      const name = window.__buddyMood;
      Object.defineProperty(window, '__buddyMood', { value: name, writable: true, enumerable: true, configurable: true });
      delete window.__buddyMoods;
      return true;
    })()`);
  } finally {
    ctx.sleepClock.speed = 1;
    if (ctx.panel.isVisible()) await ctx.actions.dismiss();
  }
};
