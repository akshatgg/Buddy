'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Buddy watches Claude Code (src/main/claude/watch.js): with the switch on, Claude Code's hooks POST each event to a
// port on this computer, and the buddy reacts. The switch is turned on through the Settings page's own call (not a
// click: on a computer without Claude Code the switch is dimmed), the port and the token are read from the settings,
// a session's events are sent as the hooks would send them, and the moods the buddy page got and the bubble's words
// are read back. The hooks go into the test's own settings.json (smoke.js's claudeSettingsFile), never the real one.
module.exports = async function claudeWatchCheck(ctx, { assert, delay, waitFor }) {
  const hooksFile = path.join(app.getPath('userData'), 'claude-home', 'settings.json');
  const EVENTS = ['Notification', 'PermissionRequest', 'PostToolUse', 'PreToolUse', 'SessionEnd', 'Stop', 'StopFailure', 'UserPromptSubmit'];
  const win = ctx.windows.open('settings', { section: 'claude' });
  const page = (script) => win.webContents.executeJavaScript(script);
  await waitFor(() => page("document.getElementById('claude-watch-line').textContent !== ''").catch(() => false), 'the Claude Code section to load');
  assert.strictEqual(await page("document.getElementById('claude-watch-switch').checked"), false, 'the switch starts off');
  assert.strictEqual(ctx.store.get('watchClaudeCode'), false);

  const on = await page('window.buddy.setClaudeWatch(true)');
  assert.strictEqual(on.ok, true, `the switch turns on: ${JSON.stringify(on)}`);
  assert.strictEqual(on.on, true);
  assert.match(on.line, /^Watching\. Hooks are in .*settings\.json\.$/);
  const asked = await page('window.buddy.claudeWatch()');
  assert.deepStrictEqual(asked, { ok: true, on: true, line: on.line }, 'the page can read the switch back');
  const port = ctx.store.get('claudeHookPort');
  const token = ctx.store.get('claudeHookToken');
  assert.ok(Number.isInteger(port) && port >= 49152 && port <= 65535, `a port was picked: ${port}`);
  assert.match(token, /^[0-9a-f]{32}$/, 'a token was made');
  const written = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
  assert.deepStrictEqual(Object.keys(written.hooks).sort(), EVENTS, 'one entry on each event');
  assert.ok(written.hooks.Stop[0].hooks[0].command.includes(`http://127.0.0.1:${port}/claude-code/${token}`), 'the hook posts to the port with the token');
  assert.strictEqual(written.hooks.Stop[0].hooks[0].timeout, 3);
  assert.strictEqual(fs.existsSync(`${hooksFile}.before-buddy`), false, 'no backup of a file that was not there');

  const buddyPage = ctx.buddy.window().webContents;
  await buddyPage.executeJavaScript('window.__moods = []; window.buddy.onMood((name) => window.__moods.push(name)); true');
  const moods = () => buddyPage.executeJavaScript('window.__moods');
  const bubbleSays = (text) => waitFor(async () => {
    const bubble = ctx.bubble.window();
    return Boolean(bubble?.isVisible()) && (await bubble.webContents.executeJavaScript("document.getElementById('text').textContent")) === text;
  }, `the bubble to say "${text}"`);
  const post = async (event, extra = {}, tokenUsed = token) => {
    const res = await fetch(`http://127.0.0.1:${port}/claude-code/${tokenUsed}`, {
      method: 'POST',
      body: JSON.stringify({ hook_event_name: event, session_id: 'e2e-session', cwd: '/Users/someone/code/my-app', ...extra }),
    });
    return res.status;
  };

  assert.strictEqual(await post('UserPromptSubmit', {}, 'wrong-token'), 404, 'a wrong token is not heard');
  assert.strictEqual(await post('UserPromptSubmit'), 204);
  await waitFor(async () => (await moods()).includes('thinking'), 'the buddy to think');
  assert.strictEqual(await post('PreToolUse', { tool_name: 'Read' }), 204);
  await delay(200);
  assert.deepStrictEqual(await moods(), ['thinking'], 'thinking is sent once, not on every tool');
  assert.strictEqual(await post('PermissionRequest', { tool_name: 'Bash' }), 204);
  await waitFor(async () => (await moods()).includes('wave'), 'the buddy to wave');
  await bubbleSays('Claude Code needs you in my-app');
  assert.strictEqual(await post('PreToolUse', { tool_name: 'Bash' }), 204);
  await waitFor(async () => (await moods()).filter((m) => m === 'thinking').length === 2, 'the buddy to think again once the permission is given');
  assert.strictEqual(await post('Stop'), 204);
  await waitFor(async () => (await moods()).includes('celebrate'), 'the buddy to celebrate');
  await bubbleSays('Claude Code is done in my-app');

  const off = await page('window.buddy.setClaudeWatch(false)');
  assert.strictEqual(off.ok, true, 'the switch turns off');
  assert.strictEqual(off.on, false);
  assert.strictEqual(ctx.store.get('watchClaudeCode'), false);
  assert.ok(!fs.readFileSync(hooksFile, 'utf8').includes('/claude-code/'), 'the hooks are gone from the file');
  await assert.rejects(fetch(`http://127.0.0.1:${port}/claude-code/${token}`, { method: 'POST', body: '{}' }), 'the port is closed');
  ctx.windows.close('settings');
  await waitFor(() => win.isDestroyed(), 'the Settings window to close');
};
