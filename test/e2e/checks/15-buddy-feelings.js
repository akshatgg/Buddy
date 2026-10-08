'use strict';

const { screen } = require('electron');

// The buddy's feelings in the real page (docs/superpowers/specs/2026-10-08-buddy-feelings-design.md): asleep, petting,
// shaking and listening, and their symbols. The page says what it is doing in window.__buddyMood (the mood),
// window.__buddyPose (the pose it drew last) and window.__buddyFrames (how many frames it has drawn). Pointer events go
// to the page itself, as in 14-buddy-click.js: the real pointer does not move.
module.exports = async function feelingsCheck(ctx, { assert, delay, waitFor }) {
  const win = ctx.buddy.window();
  const page = win.webContents;
  const js = (code) => page.executeJavaScript(code);
  await waitFor(() => js('window.__buddyReady === true').catch(() => false), 'the buddy page');
  const moodIs = (name) => async () => (await js('window.__buddyMood')) === name;
  const symbols = (kind) => js(`document.querySelectorAll('#symbols .buddy-symbol${kind ? `--${kind}` : ''}').length`);

  // The "z" letters come back every 12 s on a timer of their own (Z_CYCLE in symbols.js), which symbols.js looks up on
  // the page's window each time: watch which of those timers are pending.
  await js(`(() => {
    const { setTimeout: set, clearTimeout: clear } = window;
    const cycles = new Set();
    window.__zCycles = cycles;
    window.setTimeout = (fn, ms, ...rest) => {
      const id = set.call(window, (...args) => {
        cycles.delete(id);
        fn(...args);
      }, ms, ...rest);
      if (ms === 12000) cycles.add(id);
      return id;
    };
    window.clearTimeout = (id) => {
      cycles.delete(id);
      clear.call(window, id);
    };
    window.__unwatchTimers = () => Object.assign(window, { setTimeout: set, clearTimeout: clear });
    return true;
  })()`);
  const cycles = () => js('window.__zCycles.size');

  // 1. Asleep: the sleeping eyes, the glow going down and "z" letters; 4 frames a second, which the pointer moving does
  // not change (a sleeping head does not follow it); no symbols while paused; and a later mood replaces it.
  ctx.buddy.mood('asleep');
  await waitFor(moodIs('asleep'), 'the buddy to fall asleep');
  // The letters come in bursts, 4.9 s of every 12, starting with the mood: so look now.
  assert.strictEqual(await symbols('z'), 3, 'three "z" letters rise as it falls asleep');
  assert.strictEqual(await cycles(), 1, 'and the next burst is due in 12 s');
  await waitFor(() => js('window.__buddyPose?.sleep > 0.9 && window.__buddyPose.glow < 1'), 'the sleeping eyes, and the glow going down');
  const before = await js('window.__buddyFrames');
  for (let i = 0; i < 20; i += 1) {
    page.send('buddy:cursor', { dx: i % 2 ? 400 : -400, dy: i % 3 ? 120 : -120 }); // as main sends a pointer that moves
    await delay(100);
  }
  const frames = (await js('window.__buddyFrames')) - before;
  assert.ok(frames >= 4 && frames <= 12, `asleep it draws about 8 frames in 2 s, the pointer moving or not (${frames})`);
  // Paused (hidden, or the screen locked): no letters, and none to come, even when the sleep countdown sends its moods
  // meanwhile; when it shows again, the letters are back.
  ctx.buddy.pause(true);
  // At once: the burst's last letter would end by itself only about 2 s later.
  await waitFor(async () => (await symbols()) === 0, 'the symbols to go while the buddy is paused', 1000);
  assert.strictEqual(await cycles(), 0, 'no burst of "z" letters is due while it is paused');
  ctx.buddy.mood('drowsy');
  await waitFor(moodIs('drowsy'), 'drowsy, while paused');
  ctx.buddy.mood('asleep');
  await waitFor(moodIs('asleep'), 'asleep, while paused');
  assert.strictEqual(await symbols(), 0, 'falling asleep while paused shows no letters');
  assert.strictEqual(await cycles(), 0, 'nor sets a burst for later');
  ctx.buddy.pause(false);
  await waitFor(async () => (await symbols('z')) === 3, 'the "z" letters to come back when the buddy shows again');
  assert.strictEqual(await cycles(), 1, 'with the next burst due');
  await js('window.__unwatchTimers(); true');
  // Main sends the pointer only when it moves: tell the page where it really is again.
  const pointer = screen.getCursorScreenPoint();
  const box = ctx.buddy.bounds();
  page.send('buddy:cursor', { dx: pointer.x - (box.x + box.width / 2), dy: pointer.y - (box.y + box.height / 2) });
  ctx.buddy.mood('wake');
  await waitFor(moodIs('wake'), 'the buddy to wake');
  assert.strictEqual(await symbols('z'), 0, 'the "z" letters go when it wakes');
  await waitFor(moodIs('idle'), 'the buddy to be awake and idle', 4000);

  // 2. Petting: the pointer rubbed left and right over the head makes it love it, with hearts that are gone after.
  // Where the page put the symbols: the head's top centre and its width, in pixels (symbols.css has % defaults).
  const mark = await js(`(() => {
    const style = getComputedStyle(document.getElementById('symbols'));
    return ['--head-x', '--head-y', '--head-w'].map((name) => style.getPropertyValue(name).trim());
  })()`);
  assert.ok(mark.every((value) => value.endsWith('px')), `the page placed the symbols over the head (${mark})`);
  const [headX, headY, headWidth] = mark.map(parseFloat);
  const { x: left, y: top, width, height } = win.getBounds();
  assert.ok(Math.abs(headX - width / 2) < 2 && headY > 0 && headY < height / 2 && headWidth > width / 2,
    `the head is in the middle, its top in the upper half of the window (${mark})`);
  const at = (x, y) => ({ x: Math.round(x), y: Math.round(y), globalX: left + Math.round(x), globalY: top + Math.round(y) });
  const middle = headY + 0.55 * headWidth; // the middle of the head, below the sprout or the bow
  page.sendInputEvent({ type: 'mouseMove', ...at(headX, middle) });
  await waitFor(() => js("document.getElementById('c').style.cursor === 'grab'"), 'the pointer on the buddy');
  for (let stroke = 0; stroke < 6 && !(await moodIs('love')()); stroke += 1) {
    for (let i = 1; i <= 5; i += 1) {
      const x = headX + (stroke % 2 ? 10 - 4 * i : -10 + 4 * i); // 20 points each way, 16 ms a move
      page.sendInputEvent({ type: 'mouseMove', ...at(x, middle) });
      await delay(16);
    }
  }
  await waitFor(moodIs('love'), 'petting to make the buddy love it', 2000);
  assert.ok((await symbols('heart')) > 0, 'hearts rise');
  await waitFor(async () => !(await moodIs('love')()), 'love to end', 4000);
  assert.strictEqual(await symbols(), 0, 'and the hearts are gone with it');

  // 3. Shaking: dragged back and forth fast, it wobbles while held and is dizzy when let go, with stars.
  page.sendInputEvent({ type: 'mouseDown', ...at(headX, middle), button: 'left', clickCount: 1 });
  await delay(50);
  let x = headX;
  for (let stroke = 0; stroke < 6; stroke += 1) {
    for (let i = 0; i < 4; i += 1) {
      x += stroke % 2 ? -15 : 15; // 60 points each way, 16 ms a move
      page.sendInputEvent({ type: 'mouseMove', ...at(x, middle), button: 'left', modifiers: ['leftbuttondown'] });
      await delay(16);
    }
  }
  assert.strictEqual(await js('window.__buddyMood'), 'wobble', 'held, it wobbles');
  page.sendInputEvent({ type: 'mouseUp', ...at(x, middle), button: 'left', clickCount: 1 });
  await waitFor(moodIs('dizzy'), 'the shaken buddy to be dizzy when let go', 2000);
  assert.ok((await symbols('star')) > 0, 'stars circle');
  assert.strictEqual(ctx.panel.isVisible(), false, 'a drag is not a click: the panel stays closed');
  await waitFor(moodIs('idle'), 'dizzy to end', 4000);
  assert.strictEqual(await symbols(), 0, 'and the stars are gone with it');
  page.sendInputEvent({ type: 'mouseMove', x: 1, y: 1 }); // the pointer leaves the buddy

  // 4. Listening: the voice level reaches the page, and the ear rims glow with it: well below their resting glow (1)
  // while it is quiet, far above it with a loud voice, and down again when the voice stops (moods.js: 0.3 to 4.3).
  ctx.buddy.mood('listening');
  await waitFor(moodIs('listening'), 'the buddy to listen');
  await waitFor(() => js('window.__buddyPose?.ears < 0.4'), 'the ear rims to dim while it is quiet');
  for (let i = 0; i < 5; i += 1) {
    ctx.buddy.voiceLevel(0.9); // about 10 times a second, as while the person talks
    await delay(100);
  }
  await waitFor(() => js('window.__buddyPose?.ears > 3'), 'a loud voice to light the ear rims');
  ctx.buddy.voiceLevel(0);
  await waitFor(() => js('window.__buddyPose?.ears < 0.4'), 'the ear rims to dim again when the voice stops');
  ctx.buddy.mood('idle');
  await waitFor(moodIs('idle'), 'the buddy to stop listening');
};
