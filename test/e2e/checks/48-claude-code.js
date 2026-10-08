'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Claude Code as the brain, with a fake `claude` on PATH in place of the real one. The fake answers `auth status` and
// `--version` as Claude Code does, and `-p` with one JSON object, after writing down what it was asked (the arguments,
// the text on stdin, the mark, the folder it ran in, and the system prompt file's text and mode). BUDDY_E2E_CLAUDE=out makes it "not signed in". The command is
// a shell script that runs this Electron as Node, so nothing has to be installed; Windows has no sh, and a .cmd is not
// started the same way, so this check is for the Mac (the owner tests Windows by hand, spec §6).
const FAKE = `'use strict';
const fs = require('node:fs');
const args = process.argv.slice(2);
const out = process.env.BUDDY_E2E_CLAUDE === 'out';
if (args[0] === '--version') {
  process.stdout.write('2.1.289 (Claude Code)\\n');
  process.exit(0);
}
if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify(out
    ? { loggedIn: false }
    : { loggedIn: true, authMethod: 'claude.ai', email: 'e2e@example.com', subscriptionType: 'max', configDirectory: '/tmp/e2e-claude' }) + '\\n');
  process.exit(out ? 1 : 0);
}
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => { input += chunk; });
process.stdin.on('end', () => {
  const systemFile = args[args.indexOf('--system-prompt-file') + 1];
  fs.writeFileSync(process.env.BUDDY_E2E_CLAUDE_LOG, JSON.stringify({
    args, input, mark: process.env.BUDDY_CLAUDE_CODE, cwd: process.cwd(),
    system: fs.readFileSync(systemFile, 'utf8'), systemMode: fs.statSync(systemFile).mode & 0o777,
  }));
  if (out) {
    process.stdout.write(JSON.stringify({ type: 'result', subtype: 'error', is_error: true, result: 'Not logged in · Please run /login' }) + '\\n');
    process.exit(1);
  }
  const chat = { kind: 'write', say: 'Ye lo!', text: 'Dear Sir, I need leave tomorrow.', notes: [], doIt: false, send: false, remember: [], again: false };
  process.stdout.write(JSON.stringify({
    type: 'result', subtype: 'success', is_error: false, result: JSON.stringify(chat), session_id: 'e2e', stop_reason: 'end_turn',
    usage: { input_tokens: 500, output_tokens: 40 },
  }) + '\\n');
});
`;

module.exports = async function claudeCodeCheck(ctx, { assert, waitFor }) {
  if (process.platform === 'win32') return;
  const userData = app.getPath('userData');
  const binDir = path.join(userData, 'fake-bin');
  const log = path.join(userData, 'fake-claude.json');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-claude.js'), FAKE);
  fs.writeFileSync(
    path.join(binDir, 'claude'),
    `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "${path.join(binDir, 'fake-claude.js')}" "$@"\n`,
    { mode: 0o755 },
  );
  const env = { PATH: process.env.PATH, BUDDY_E2E_CLAUDE: process.env.BUDDY_E2E_CLAUDE, BUDDY_E2E_CLAUDE_LOG: process.env.BUDDY_E2E_CLAUDE_LOG };
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  process.env.BUDDY_E2E_CLAUDE_LOG = log;
  delete process.env.BUDDY_E2E_CLAUDE;
  const savedProvider = ctx.store.get('provider');

  let settingsWindow = null;
  const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
  async function openSettingsOnAi() {
    settingsWindow = ctx.windows.open('settings');
    await waitFor(() => settingsPage("document.querySelector('#ai input[type=radio]') !== null").catch(() => false), 'the Settings page to load');
    await settingsPage(`document.querySelector('.nav-item[data-section="ai"]').click()`);
    await waitFor(() => settingsPage("document.querySelectorAll('#ai input[type=radio]').length === 5"), 'the five AI choices');
  }
  async function closeSettings() {
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;
  }
  const claudeLine = () => settingsPage("document.getElementById('ai-claude-line').textContent");
  /** Check again in the form: it asks the fake command afresh, and the cached status the brain uses follows. */
  async function checkAgain(expectedLine) {
    await settingsPage("document.getElementById('ai-claude-check').click()");
    await waitFor(async () => (await claudeLine()) === expectedLine, `the line "${expectedLine}"`);
  }

  let panel = null;
  const page = (script) => panel.webContents.executeJavaScript(script);
  const chat = () => ctx.actions.state().chat;
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
  }
  async function type(message) {
    await page(`(() => {
      const box = document.getElementById('box');
      box.focus();
      box.value = ${JSON.stringify(message)};
      box.dispatchEvent(new Event('input'));
    })()`);
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  }
  const pageShows = (text, what) => waitFor(async () => (await page('document.body.innerText')).includes(text), what);

  try {
    // Pick Claude Code in Settings → AI: the key box goes, its line and Check again come, the models are its names.
    await openSettingsOnAi();
    await settingsPage(`[...document.querySelectorAll('#ai fieldset label')].find((l) => l.textContent.trim() === 'Claude Code on this computer').click()`);
    await waitFor(() => ctx.store.get('provider') === 'claude-code', 'Claude Code to be saved as the AI');
    await waitFor(() => settingsPage("document.getElementById('ai-key').parentElement.hidden"), 'the key box to go');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').parentElement.hidden"), false, "Claude Code's line is there");
    assert.deepStrictEqual(
      await settingsPage("[...document.getElementById('ai-model').options].map((o) => [o.value, o.textContent])"),
      [['fable', 'Fable'], ['opus', 'Opus'], ['sonnet', 'Sonnet'], ['haiku', 'Haiku']],
    );
    assert.strictEqual(await settingsPage("document.getElementById('ai-model').value"), 'sonnet', 'Sonnet, the one it answers with, is shown chosen');
    assert.strictEqual(await settingsPage("[...document.querySelectorAll('#ai button')].find((b) => b.textContent === 'Refresh').hidden"), true, 'no Refresh');
    // The status the app found before this check (no claude on PATH) is cached: Check again asks the fake.
    await checkAgain('Claude Code: signed in as e2e@example.com (Max)');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').className"), 'good');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-get').hidden"), true, 'no Get Claude Code link when it is there');
    await closeSettings();

    // A chat message: one run of the fake claude, in safe mode, marked, in Buddy's data folder, and its answer in the chat.
    await openPanel();
    await type('boss ko mail, kal chutti chahiye');
    await waitFor(() => chat().at(-1)?.type === 'buddy', 'the answer from Claude Code');
    assert.deepStrictEqual([chat().at(-1).say, chat().at(-1).text, chat().at(-1).buttons], ['Ye lo!', 'Dear Sir, I need leave tomorrow.', ['insert', 'copy']]);
    await pageShows('Dear Sir, I need leave tomorrow.', 'the answer');
    const run = JSON.parse(fs.readFileSync(log, 'utf8'));
    assert.deepStrictEqual(run.args.slice(0, 12), [
      '-p', '--output-format', 'json', '--safe-mode', '--tools', '', '--strict-mcp-config', '--no-session-persistence',
      '--permission-prompts', 'none', '--model', 'sonnet',
    ]);
    assert.strictEqual(run.args[12], '--system-prompt-file');
    assert.strictEqual(run.args.length, 14);
    assert.strictEqual(path.dirname(run.args[13]), path.join(userData, 'claude-tmp'), "the system prompt is a file in Buddy's data folder");
    assert.match(run.system, /"kind"/, 'the chat system prompt');
    assert.strictEqual(run.systemMode, 0o600, 'only this user can read it');
    assert.strictEqual(fs.existsSync(run.args[13]), false, 'and it is deleted when the run ends');
    assert.match(run.input, /boss ko mail, kal chutti chahiye/);
    assert.strictEqual(run.mark, '1', 'marked as one of Buddy\'s own runs');
    assert.strictEqual(fs.realpathSync(run.cwd), fs.realpathSync(userData), "run in Buddy's data folder");
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))");
    await waitFor(() => !panel.isVisible(), 'Esc to close the panel');

    // Signed out: the line says what to do, and a message says the same, in red, with Try again and Open Settings.
    process.env.BUDDY_E2E_CLAUDE = 'out';
    await openSettingsOnAi();
    await checkAgain('Claude Code is installed but not signed in. Open a terminal, run claude, and sign in.');
    assert.strictEqual(await settingsPage("document.getElementById('ai-claude-line').className"), 'muted');
    await closeSettings();
    await openPanel();
    await type('mail to my boss');
    await waitFor(() => chat().at(-1)?.code === 'claude_signed_out', 'the signed-out error');
    assert.deepStrictEqual([chat().at(-1).text, chat().at(-1).buttons],
      ["Claude Code isn't signed in. Open a terminal, run claude, and sign in.", ['retry', 'settings']]);
    await pageShows('Open Settings', 'the Open Settings button');
  } finally {
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    await ctx.actions.dismiss();
    ctx.store.set({ provider: savedProvider });
    for (const [name, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
};
