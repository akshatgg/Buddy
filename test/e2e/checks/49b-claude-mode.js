'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../../shared/errors');
const { projectFolder } = require('../../../src/main/claude/live');

// Claude mode (src/main/claude/mode.js): the panel's Claude button lists the Claude Code sessions running now, the
// person picks one, and the session shows as it is and as it goes on; the box then types into its terminal. The
// session here is a pretend one in the test's own Claude Code folder (smoke.js claudeDirs), run by this very process,
// and the terminal is smoke.js's pretend one, which keeps what it was asked to type.
module.exports = async function claudeModeCheck(ctx, { assert, waitFor }) {
  const home = path.join(app.getPath('userData'), 'claude-home');
  const id = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
  const cwd = '/Users/someone/projects/shop';
  fs.mkdirSync(path.join(home, 'sessions'), { recursive: true });
  fs.writeFileSync(path.join(home, 'sessions', `${process.pid}.json`), JSON.stringify({
    pid: process.pid, sessionId: id, cwd, name: 'shop-e2e', status: 'busy', kind: 'interactive', updatedAt: Date.now(),
  }));
  const transcript = path.join(home, 'projects', projectFolder(cwd), `${id}.jsonl`);
  fs.mkdirSync(path.dirname(transcript), { recursive: true });
  const line = (entry) => `${JSON.stringify(entry)}\n`;
  fs.writeFileSync(transcript, line({ type: 'user', message: { role: 'user', content: 'fix the cart total' } })
    + line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Found it: the tax was added twice.' }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })
    + line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: '42 passing' }] } }));

  await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
  await ctx.actions.toggle();
  const panel = ctx.panel.window();
  await waitFor(() => panel.isVisible(), 'the panel to open');
  const page = (script) => panel.webContents.executeJavaScript(script);
  const shows = (text, what) => waitFor(async () => (await page("document.getElementById('claude-view').innerText")).includes(text), what);

  // The Claude button: the sessions running now, to pick from.
  await page("document.getElementById('claude-mode').click()");
  assert.strictEqual(await page("document.getElementById('claude-mode').getAttribute('aria-pressed')"), 'true');
  await shows('Which Claude Code session?', 'the question');
  await shows('shop-e2e', 'the session in the list');
  assert.strictEqual(await page("document.getElementById('chat').hidden"), true, 'the chat steps aside');

  // Picked: the whole session as the terminal shows it.
  await page("document.querySelector('#claude-sessions button').click()");
  await shows('Found it: the tax was added twice.', "Claude's reply");
  const text = await page("document.getElementById('claude-items').innerText");
  for (const expected of ['fix the cart total', 'npm test', '42 passing']) assert.ok(text.includes(expected), `the session shows "${expected}"`);
  assert.strictEqual(await page("document.getElementById('claude-name').textContent"), 'shop-e2e');

  // Many long lines, as a real session has: each keeps its whole height, and none is drawn over the one before.
  const long = Array.from({ length: 12 }, (_, i) => `Step ${i + 1}: ${'a long reply that wraps over several lines in the narrow panel '.repeat(3)}`);
  fs.appendFileSync(transcript, long.map((text) => line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }, { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } }] } })).join(''));
  await shows('Step 12:', 'the long lines');
  const layout = await page(`[...document.querySelectorAll('#claude-items > li')].map((li) => {
    const r = li.getBoundingClientRect();
    return [li.className, r.top, r.bottom, li.offsetHeight, li.scrollHeight];
  })`);
  for (const [i, [cls, top, , height, content]] of layout.entries()) {
    assert.ok(height >= content, `line ${i} (${cls}) is as tall as its words: ${height} < ${content}`);
    if (i > 0) assert.ok(top >= layout[i - 1][2] - 0.5, `line ${i} (${cls}) starts below line ${i - 1}: ${top} < ${layout[i - 1][2]}`);
  }
  assert.ok(layout.some(([cls]) => cls === 'cl-claude') && layout.some(([cls]) => cls === 'cl-tool'), 'replies and tools are there');
  assert.strictEqual(await page("document.getElementById('box').placeholder"), 'Message Claude in shop-e2e…');

  // It goes on: a new reply in the file shows by itself.
  fs.appendFileSync(transcript, line({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'All fixed.' }] } }));
  await shows('All fixed.', 'the new reply, read as it came');

  // The box types into the session's terminal (the tty comes from a hook, as Claude Code's would send it).
  ctx.live.hear({ name: 'Stop', sessionId: id, folder: 'shop', cwd, transcript, tty: 'ttys009' });
  const send = async (words) => {
    await page(`(() => { const box = document.getElementById('box'); box.value = ${JSON.stringify(words)}; box.dispatchEvent(new Event('input')); })()`);
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page("document.getElementById('send').click()");
  };
  await send('now add a test for it');
  await waitFor(() => ctx.claudeTerminal.typed.length === 1, 'the words to reach the terminal');
  assert.deepStrictEqual(ctx.claudeTerminal.typed[0], { tty: 'ttys009', text: 'now add a test for it' });
  await waitFor(async () => (await page("document.getElementById('box').value")) === '', 'the box to empty');

  // A terminal Buddy cannot type into: the words are copied, and the line under the box says so.
  ctx.claudeTerminal.fail = new BuddyError('no_terminal', "I can't type into that terminal. I copied it: paste it there.");
  await send('and commit');
  await waitFor(async () => (await page("document.getElementById('send-error-text').textContent")).includes('I copied it'), 'the line under the box');
  assert.strictEqual(await ctx.clipboard.readText(), 'and commit');
  ctx.claudeTerminal.fail = null;

  // Back to the list, and the Claude button again: the chat.
  await page("document.getElementById('claude-back').click()");
  await shows('Which Claude Code session?', 'the list again');
  await page("document.getElementById('claude-mode').click()");
  assert.strictEqual(await page("document.getElementById('chat').hidden"), false, 'the chat is back');
  assert.strictEqual(await page("document.getElementById('claude-view').hidden"), true);
  assert.strictEqual(await page("document.getElementById('box').placeholder"), 'Tell me what to do…');

  await ctx.actions.dismiss();
  fs.rmSync(path.join(home, 'sessions'), { recursive: true, force: true });
};
