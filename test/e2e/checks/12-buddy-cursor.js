'use strict';

const { screen } = require('electron');

// The pointer position is only sent when the pointer has moved. A page that has just loaded (at launch, or after
// a reload) has not been told it yet, and what was sent while it loaded was dropped, so it must be sent again
// even if the pointer is still: otherwise the head faces forward until the pointer next moves.
module.exports = async function cursorCheck(ctx, { assert, delay, waitFor }) {
  const wc = ctx.buddy.window().webContents;
  const sent = [];
  const send = wc.send;
  const getCursorScreenPoint = screen.getCursorScreenPoint;
  wc.send = function recordCursor(channel, ...args) {
    if (channel === 'buddy:cursor') sent.push(args[0]);
    return send.call(this, channel, ...args);
  };
  screen.getCursorScreenPoint = () => ({ x: 200, y: 200 }); // a pointer that stays where it is, whatever the person does
  try {
    await delay(300); // the window has now seen that position, and will not send it again by itself
    const reloaded = new Promise((resolve) => wc.once('did-finish-load', () => {
      sent.length = 0; // only what is sent from here on counts
      resolve();
    }));
    wc.reload();
    await reloaded;
    await waitFor(() => sent.length > 0, 'the pointer position to be sent again to the reloaded page', 3000);
    assert.ok(Number.isFinite(sent[0].dx) && Number.isFinite(sent[0].dy), 'as a point relative to the buddy');
  } finally {
    screen.getCursorScreenPoint = getCursorScreenPoint;
    wc.send = send;
  }
  await waitFor(() => wc.executeJavaScript('window.__buddyReady === true').catch(() => false), 'the buddy page after the reload');
};
