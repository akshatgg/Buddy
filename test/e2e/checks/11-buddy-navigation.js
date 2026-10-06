'use strict';

// The page tries to navigate away and the window refuses (will-navigate is prevented). Electron then fires
// did-start-loading and did-stop-loading but never did-finish-load, so the window must not count the page as
// "not loaded" from the first of those, or every message after it would be dropped.
module.exports = async function navigationCheck(ctx, { assert, delay, waitFor }) {
  const wc = ctx.buddy.window().webContents;
  const ready = () => wc.executeJavaScript('window.__buddyReady === true').catch(() => false);
  await waitFor(ready, 'the buddy page');
  await wc.executeJavaScript('window.__moods = []; window.buddy.onMood((name) => window.__moods.push(name)); true');

  wc.executeJavaScript("location.href = 'file:///buddy-e2e-nowhere.html'").catch(() => {});
  await delay(300);
  assert.ok(await ready(), 'the buddy page is still there');

  ctx.buddy.mood('happy');
  await waitFor(() => wc.executeJavaScript("window.__moods.includes('happy')"), 'a mood to reach the page after the refused navigation');
};
