'use strict';

// The buddy page's clock, for the checks that need something due later to be due now (a fidget comes 15 to 25 s after
// the last one): the page times everything by performance.now(), which this moves on. It only ever moves forward, so
// what the page has timed so far stays in order. It is here, not in checks/, because the e2e test runs every file there.

/** Give the buddy page (its webContents) a clock that can be moved on. Once per page: a second call keeps the first. */
function installBuddyClock(page) {
  return page.executeJavaScript(`(() => {
    if (!window.__moveClock) {
      const real = performance.now.bind(performance);
      let ahead = 0;
      performance.now = () => real() + ahead;
      window.__moveClock = (ms) => { ahead += ms; return true; };
    }
    return true;
  })()`);
}

/** Move the buddy page's clock on by `ms` milliseconds (installBuddyClock first). */
function moveBuddyClock(page, ms) {
  return page.executeJavaScript(`window.__moveClock(${Number(ms)})`);
}

module.exports = { installBuddyClock, moveBuddyClock };
