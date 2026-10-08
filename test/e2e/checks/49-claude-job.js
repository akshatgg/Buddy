'use strict';

const { app } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ASKS_PERMISSION } = require('../../../src/main/claude/job');

// A Claude Code job from the chat, with a fake `claude` on PATH in place of the real one: it answers `auth status` and
// `--version` as Claude Code does, and `-p` with the stream of a job (a tool use, a permission question when the job
// asks, a result). BUDDY_E2E_JOB=hang makes it wait forever (for Stop). The command is a shell script that runs this
// Electron as Node, so nothing has to be installed. Nothing is written in the project folder but what the check puts
// there. The chat's AI answer is the check's own (ctx.ai.ask), as 40-panel.js does.
const FAKE = `'use strict';
const readline = require('node:readline');
const args = process.argv.slice(2);
if (args[0] === '--version') { process.stdout.write('2.1.289 (Claude Code)\\n'); process.exit(0); }
if (args[0] === 'auth') {
  process.stdout.write(JSON.stringify({ loggedIn: true, authMethod: 'claude.ai', email: 'e2e@example.com', subscriptionType: 'max', configDirectory: '/tmp/e2e-claude' }) + '\\n');
  process.exit(0);
}
const say = (o) => process.stdout.write(JSON.stringify(o) + '\\n');
const lines = readline.createInterface({ input: process.stdin });
lines.once('line', (first) => {
  const task = JSON.parse(first).message.content;
  say({ type: 'system', subtype: 'init', session_id: 'e2e', cwd: process.cwd(), model: args[args.indexOf('--model') + 1] });
  say({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'app.js' } }] } });
  if (process.env.BUDDY_E2E_JOB === 'hang') return; // Stop ends it
  const finish = () => {
    say({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 't2', name: 'Bash', input: { command: 'npm test' } }] } });
    say({ type: 'result', subtype: 'success', is_error: false, result: 'I fixed app.js for: ' + task + ' The tests pass.', session_id: 'e2e' });
    process.exit(0);
  };
  if (!args.includes('host')) return finish();
  say({ type: 'control_request', request_id: 'q1', request: { subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm test' } } });
  lines.once('line', (answer) => {
    const r = JSON.parse(answer);
    const allowed = (r.response?.response?.behavior || r.response?.behavior) === 'allow';
    if (allowed) finish();
    else { say({ type: 'result', subtype: 'success', is_error: false, result: 'I could not run the tests.', session_id: 'e2e' }); process.exit(0); }
  });
});
`;

module.exports = async function claudeJobCheck(ctx, { assert, waitFor }) {
  if (process.platform === 'win32') return;
  const userData = app.getPath('userData');
  const binDir = path.join(userData, 'fake-bin-job');
  fs.mkdirSync(binDir, { recursive: true });
  fs.writeFileSync(path.join(binDir, 'fake-claude-job.js'), FAKE);
  fs.writeFileSync(path.join(binDir, 'claude'), `#!/bin/sh\nexport ELECTRON_RUN_AS_NODE=1\nexec "${process.execPath}" "${path.join(binDir, 'fake-claude-job.js')}" "$@"\n`, { mode: 0o755 });
  const project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-app-')));
  const name = path.basename(project);
  fs.writeFileSync(path.join(project, 'app.js'), 'module.exports = 1;\n');
  const env = { PATH: process.env.PATH, BUDDY_E2E_JOB: process.env.BUDDY_E2E_JOB };
  process.env.PATH = `${binDir}${path.delimiter}${process.env.PATH}`;
  delete process.env.BUDDY_E2E_JOB;

  const reply = (fields) => ({ kind: 'write', say: '', text: '', notes: [], doIt: false, send: false, remember: [], again: false, ...fields });
  const answers = [];
  const asks = [];
  const { ask } = ctx.ai;
  ctx.ai.ask = async (action, input) => {
    asks.push({ action, input });
    const next = answers.shift();
    return { text: JSON.stringify(next), model: 'e2e-model', chat: next };
  };
  const chat = () => ctx.actions.state().chat;
  let panel = null;
  const page = (script) => panel.webContents.executeJavaScript(script);
  const pageShows = (text, what) => waitFor(async () => (await page('document.body.innerText')).includes(text), what);
  async function openPanel() {
    await waitFor(() => !ctx.panel.justClosed(), 'the panel to be ready to open again');
    await ctx.actions.toggle();
    panel = ctx.panel.window();
    await waitFor(() => panel.isVisible(), 'the panel to open');
  }
  async function type(message) {
    await page(`(() => { const box = document.getElementById('box'); box.focus(); box.value = ${JSON.stringify(message)}; box.dispatchEvent(new Event('input')); })()`);
    await waitFor(() => page("!document.getElementById('send').disabled"), 'the send button to come on');
    await page("document.getElementById('box').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }))");
  }
  const itemWith = (text) => `[...document.querySelectorAll('#items > li')].findLast((li) => li.innerText.includes(${JSON.stringify(text)}))`;
  async function click(text, label) {
    const clicked = await page(`(() => {
      const button = [...(${itemWith(text)})?.querySelectorAll('button') ?? []].find((b) => b.textContent === ${JSON.stringify(label)});
      if (!button) return false;
      button.click();
      return true;
    })()`);
    assert.ok(clicked, `the chat shows ${label} on "${text}"`);
  }
  let settingsWindow = null;
  const openedFolders = [];
  const { openPath } = require('electron').shell;
  require('electron').shell.openPath = async (folder) => { openedFolders.push(folder); return ''; };

  try {
    await ctx.find.status({ force: true }); // not the brain check's cached answer
    // Settings → Claude Code lists the folder (added through the store: the system's folder picker cannot be driven
    // here; claude:add-project is covered by test/claude-ipc.test.js and the manual checklist), and ✕ removes it.
    ctx.store.set({ projects: [{ path: project, name }] });
    settingsWindow = ctx.windows.open('settings', { section: 'claude' });
    const settingsPage = (script) => settingsWindow.webContents.executeJavaScript(script);
    await waitFor(() => settingsPage("document.getElementById('project-list') !== null").catch(() => false), 'the Settings page to load');
    await waitFor(async () => (await settingsPage("document.getElementById('project-list').innerText")).includes(name), 'the folder to be listed');
    assert.ok((await settingsPage("document.getElementById('project-list').innerText")).includes(project), 'with its path');
    await settingsPage("document.querySelector('#project-list .forget').click()");
    await waitFor(() => settingsPage("!document.getElementById('project-empty').hidden"), 'the list to be empty after ✕');
    assert.deepStrictEqual(ctx.store.get('projects'), []);
    ctx.store.set({ projects: [{ path: project, name }] });
    ctx.windows.close('settings');
    await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    settingsWindow = null;

    // The chat: the AI says "code", the request named the project, and the job runs with the fake claude.
    await openPanel();
    await pageShows(`“fix the login bug in ${name}”`, 'the example line with the project');
    answers.push(reply({ kind: 'code', say: 'On it!', text: 'Fix the bug in app.js.' }));
    await type(`fix the bug in ${name}`);
    assert.deepStrictEqual(asks.at(-1).input.projects, [name]);
    await pageShows(`🔧 Started in ${name}`, 'the job started');
    await pageShows('Reading app.js', 'the live line');
    if (ASKS_PERMISSION) {
      await pageShows('Run npm test?', 'the permission question');
      await click('Run npm test?', 'Allow');
      await pageShows('✅ Allowed: npm test', 'the answer');
    }
    await pageShows(`✅ Done in ${name}`, 'the job done');
    await pageShows('I fixed app.js for: Fix the bug in app.js. The tests pass.', 'the summary');
    const job = chat().find((item) => item.type === 'job');
    assert.deepStrictEqual([job.done, job.buttons, job.lines], [true, ['open-folder', 'copy'], ['Reading app.js', 'Running: npm test']]);
    await click('I fixed app.js', 'Open folder');
    await waitFor(() => openedFolders.length > 0, 'the folder to open');
    assert.deepStrictEqual(openedFolders, [project]);
    assert.strictEqual(ctx.store.get('lastProject'), project);

    // Stop: a job that never ends gets SIGTERM, and the chat says so. The panel is hidden meanwhile, so the bubble
    // speaks when the job ends.
    process.env.BUDDY_E2E_JOB = 'hang';
    answers.push(reply({ kind: 'code', say: 'Sure.', text: 'Add dark mode.' }));
    await type('add dark mode');
    await pageShows('🔧 Started in', 'the second job started');
    await pageShows('Reading app.js', 'its live line');
    delete process.env.BUDDY_E2E_JOB;
    await click(`Working in ${name}`, 'Stop');
    await pageShows('⏹ Stopped', 'the job stopped');
    assert.strictEqual(chat().findLast((item) => item.type === 'job').text, 'Stopped.');
  } finally {
    require('electron').shell.openPath = openPath;
    ctx.ai.ask = ask;
    ctx.windows.close('settings');
    if (settingsWindow) await waitFor(() => settingsWindow.isDestroyed(), 'the Settings window to close');
    await ctx.actions.dismiss();
    ctx.store.set({ projects: [], lastProject: null });
    process.env.PATH = env.PATH;
    if (env.BUDDY_E2E_JOB === undefined) delete process.env.BUDDY_E2E_JOB;
    else process.env.BUDDY_E2E_JOB = env.BUDDY_E2E_JOB;
    fs.rmSync(project, { recursive: true, force: true });
    fs.rmSync(binDir, { recursive: true, force: true });
  }
};
