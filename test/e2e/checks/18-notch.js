'use strict';

const { screen } = require('electron');
const { notchWindowBounds, panelUnderNotch } = require('../../../src/main/notch-geometry');

// On a Mac with a notch Buddy lives in it (spec: Buddy in the notch). The fake helper is told the main screen has a
// notch; home.refresh() chooses again, as main does at start and when a screen comes or goes; from then on everything
// goes to the notch window and its page: the mood, what Buddy says, and a click on the black shape (the page's
// window.notch.click()), which opens the panel under the notch. The Settings choice ("Where Buddy lives") puts the
// floating buddy back and, chosen again, Buddy back in the notch. The helper, the store and the choice are put back
// after, for the checks that follow: they expect the floating buddy.
module.exports = async function notchCheck(ctx, { assert, waitFor }) {
  const display = screen.getPrimaryDisplay();
  const cx = Math.round(display.bounds.x + display.bounds.width / 2);
  const notch = { x: cx - 90, y: display.bounds.y, width: 180, height: 32 };
  const homeBefore = ctx.store.get('home');
  const rect = ({ x, y, width, height }) => ({ x, y, width, height });
  const floating = () => ctx.home.window(); // the floating buddy's window: home forwards it
  const notchWindow = () => ctx.home.notchWindow().window();
  const page = (script) => notchWindow().webContents.executeJavaScript(script);
  /** A panel that has just closed stays closed for a moment, so that the click that blurred it does not reopen it. */
  const settled = () => waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');

  try {
    ctx.helper.replies.notch = { notches: [{ screen: display.bounds, notch }] };
    ctx.store.set({ home: 'notch' });
    await ctx.home.refresh();
    ctx.home.show();
    assert.deepStrictEqual([ctx.home.where(), ctx.home.hasNotch(), ctx.home.isVisible()], ['notch', true, true]);
    await waitFor(() => notchWindow()?.isVisible(), 'the notch window to show');
    const win = notchWindow();
    assert.deepStrictEqual(rect(win.getBounds()), notchWindowBounds(notch), 'the notch window is around the notch');
    assert.ok(!floating()?.isVisible(), 'the floating buddy is not shown');
    await waitFor(() => page('window.__notchReady === true').catch(() => false), 'the notch page');

    // The mood and what Buddy says reach the page: no bubble window.
    ctx.home.mood('happy');
    await waitFor(() => page("document.body.dataset.mood === 'happy'"), 'the mood in the notch');
    ctx.home.say("Done! It's in Gmail ✅");
    await waitFor(async () => {
      const say = await page("(() => { const s = document.getElementById('say'); return { text: s.textContent, hidden: s.hidden }; })()");
      return say.text === "Done! It's in Gmail ✅" && !say.hidden;
    }, 'the words beside the notch');
    assert.ok(!ctx.bubble.window()?.isVisible(), 'the notch says it, not the bubble');

    // A click on the shape opens the panel under the notch, as a click on the floating buddy opens it beside it.
    assert.strictEqual(ctx.panel.isVisible(), false, 'the panel starts closed');
    await settled();
    await page('window.notch.click()');
    await waitFor(() => ctx.panel.isVisible(), 'the panel to open after a click on the notch');
    assert.deepStrictEqual(rect(ctx.panel.window().getBounds()), panelUnderNotch(notch, display.workArea), 'the panel sits under the notch');
    ctx.panel.hide();
    await settled();

    // Settings → Floating: the floating buddy comes back and the notch window goes; In the notch: the other way.
    ctx.store.set({ home: 'floating' });
    await ctx.home.refresh();
    assert.strictEqual(ctx.home.where(), 'floating');
    await waitFor(() => floating()?.isVisible(), 'the floating buddy to show');
    assert.strictEqual(win.isVisible(), false, 'the notch window is hidden');
    ctx.store.set({ home: 'notch' });
    await ctx.home.refresh();
    assert.strictEqual(ctx.home.where(), 'notch');
    await waitFor(() => notchWindow()?.isVisible(), 'the notch window to show again');
    assert.strictEqual(floating().isVisible(), false, 'the floating buddy is hidden again');
  } finally {
    delete ctx.helper.replies.notch;
    ctx.store.set({ home: homeBefore });
    await ctx.home.refresh(); // no notch any more: the floating buddy, for the checks that follow
    await waitFor(() => floating()?.isVisible(), 'the floating buddy to be back');
  }
};
