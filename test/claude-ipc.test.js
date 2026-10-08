'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { registerClaudeIpc } = require('../src/main/ipc/claude');
const { BuddyError } = require('../shared/errors');

function harness({ allowed = () => true } = {}) {
  const handlers = {};
  const asked = [];
  const opened = [];
  const status = { installed: true, loggedIn: true, email: 'a@b.com', plan: 'max' };
  const find = {
    status: async (opts) => { asked.push(opts); return status; },
    line: (s) => ({ text: s.loggedIn ? 'signed in' : 'not', link: null }),
  };
  // Settings → Claude Code → My projects (src/main/claude/projects.js), and the system's folder picker: each pick in
  // `picks` is the folder chosen, and none left is a cancelled picker. Both pickers' options go in `opened`.
  const list = [{ path: '/Users/me/code/my-app', name: 'my-app', found: true }];
  const projects = {
    list: () => list,
    add(p) {
      if (p === '/full') throw new BuddyError('bad_request', 'You can have 20 projects at most. Remove one first.');
      const project = { path: p, name: p.split('/').pop() };
      list.push({ ...project, found: true });
      return project;
    },
    remove: (p) => { const at = list.findIndex((x) => x.path === p); if (at >= 0) list.splice(at, 1); return at >= 0; },
  };
  const dialog = { picks: ['/Users/me/code/site'], async showOpenDialog(options) { opened.push(options); const p = this.picks.shift(); return p ? { canceled: false, filePaths: [p] } : { canceled: true, filePaths: [] }; } };
  const watch = {
    calls: [],
    async setOn(on) { this.calls.push(on); return { on, line: on ? 'Watching.' : 'off words' }; },
    status: () => ({ on: false, line: 'off words' }),
  };
  registerClaudeIpc({
    ipcMain: { handle: (channel, fn) => { handlers[channel] = (...args) => fn({ sender: 'page' }, ...args); } },
    allowed,
    find,
    openExternal: async (url) => opened.push(url),
    projects,
    dialog,
    watch,
  });
  return { handlers, asked, status, opened, projects, dialog, list, watch };
}

test('claude:status answers the status and its line, cached unless forced', async () => {
  const { handlers, asked, status } = harness();
  const r = await handlers['claude:status']({});
  assert.deepEqual(r, { ok: true, status, line: { text: 'signed in', link: null } });
  await handlers['claude:status']({ force: true });
  await handlers['claude:status']();
  assert.deepEqual(asked, [{ force: false }, { force: true }, { force: false }]);
});

test('claude:status is only for allowed windows', async () => {
  const { handlers } = harness({ allowed: () => false });
  const r = await handlers['claude:status']({});
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'not_allowed');
});

test('claude:get opens the Get Claude Code page', async () => {
  const { handlers, opened } = harness();
  const r = await handlers['claude:get']();
  assert.deepEqual(r, { ok: true });
  assert.deepEqual(opened, ['https://claude.com/claude-code']);
});

test('claude:projects lists the folders with whether each is there', async () => {
  const { handlers, list } = harness();
  assert.deepEqual(await handlers['claude:projects'](), { ok: true, projects: list });
});

test('claude:add-project opens the folder picker and adds the pick; cancelled adds nothing', async () => {
  const { handlers, opened, list, dialog } = harness();
  const r = await handlers['claude:add-project']();
  assert.deepEqual(opened.at(-1), { title: 'Add a project folder', properties: ['openDirectory'] });
  assert.deepEqual(r, { ok: true, projects: list, added: { path: '/Users/me/code/site', name: 'site' } });
  assert.equal(list.length, 2);
  dialog.picks = [];
  assert.deepEqual(await handlers['claude:add-project'](), { ok: true, projects: list, added: null });
});

test('claude:add-project passes on a refusal (21 folders) in its words', async () => {
  const { handlers, dialog } = harness();
  dialog.picks = ['/full'];
  const r = await handlers['claude:add-project']();
  assert.deepEqual(r, { ok: false, error: { code: 'bad_request', message: 'You can have 20 projects at most. Remove one first.' } });
});

test('claude:remove-project takes a folder out and answers the list', async () => {
  const { handlers, list } = harness();
  assert.deepEqual(await handlers['claude:remove-project']('/Users/me/code/my-app'), { ok: true, projects: list });
  assert.equal(list.length, 0);
  assert.deepEqual(await handlers['claude:remove-project'](42), { ok: true, projects: list }, 'not a path: nothing happens');
});

test('the project calls are only for allowed windows', async () => {
  const { handlers } = harness({ allowed: () => false });
  for (const channel of ['claude:projects', 'claude:add-project', 'claude:remove-project']) {
    assert.equal((await handlers[channel]()).error.code, 'not_allowed', channel);
  }
});

test('claude:watch answers the switch, and turns it on and off through the watcher', async () => {
  const { handlers, watch } = harness();
  assert.deepEqual(await handlers['claude:watch'](), { ok: true, on: false, line: 'off words' });
  assert.deepEqual(await handlers['claude:watch'](true), { ok: true, on: true, line: 'Watching.' });
  assert.deepEqual(await handlers['claude:watch'](false), { ok: true, on: false, line: 'off words' });
  assert.deepEqual(watch.calls, [true, false]);
});

test('claude:watch wants on or off, and tells the page in plain words otherwise', async () => {
  const { handlers, watch } = harness();
  const r = await handlers['claude:watch']('yes');
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'bad_request');
  assert.equal(r.error.message, 'Watching Claude Code must be on or off.');
  assert.deepEqual(watch.calls, []);
});
