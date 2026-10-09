'use strict';

const { guarded } = require('./result');
const { BuddyError } = require('../../../shared/errors');
const { GET_URL } = require('../claude/find');

/**
 * Settings → Claude Code: the calls behind the section. The three Claude Code pieces add their own channels here.
 *
 *   claude:status { force } -> { status, line }: whether Claude Code is installed and signed in (src/main/claude/find.js),
 *                              and the line Settings shows for it; force asks Claude Code again instead of the cached answer
 *   claude:get              -> opens the Get Claude Code page in the browser
 *   claude:projects         -> { projects }: the folders Claude Code may work in (src/main/claude/projects.js), each with `found`
 *   claude:add-project      -> { projects, added }: the system's folder picker, then the folder added (added: null when cancelled)
 *   claude:remove-project   -> { projects }: the folder taken out
 *   claude:watch { on? }    -> { on, line }: "Show me what Claude Code is doing" (src/main/claude/watch.js); with `on`
 *                              true or false it turns the watch on or off, with none it answers how it stands
 *   claude:share { on? }    -> { on, canTurnOn, line }: "Show my sessions on my other devices" (src/main/claude/share.js), the
 *                              same way
 *
 * Calls answer { ok, ... } like every Settings call (ipc/result.js), and only `allowed` senders may make them.
 */
function registerClaudeIpc({ ipcMain, allowed, find, openExternal, projects, dialog, watch, share }) {
  const handle = guarded(ipcMain, allowed);

  handle('claude:get', async () => {
    await openExternal(GET_URL);
    return {};
  });

  handle('claude:status', async ({ force = false } = {}) => {
    const status = await find.status({ force: force === true });
    return { status, line: find.line(status) };
  });

  // Settings → Claude Code → My projects: the folders Buddy may run Claude Code in.
  handle('claude:projects', () => ({ projects: projects.list() }));

  handle('claude:add-project', async () => {
    const { canceled, filePaths } = await dialog.showOpenDialog({ title: 'Add a project folder', properties: ['openDirectory'] });
    const added = canceled || !filePaths?.length ? null : projects.add(filePaths[0]);
    return { projects: projects.list(), added };
  });

  handle('claude:remove-project', (folder) => {
    if (typeof folder === 'string') projects.remove(folder);
    return { projects: projects.list() };
  });

  handle('claude:watch', async (on) => {
    if (on === undefined) return watch.status();
    if (typeof on !== 'boolean') throw new BuddyError('bad_request', 'Watching Claude Code must be on or off.');
    return watch.setOn(on);
  });

  handle('claude:share', async (on) => {
    if (on === undefined) return share.status();
    if (typeof on !== 'boolean') throw new BuddyError('bad_request', 'Showing your sessions on your other devices must be on or off.');
    if (on && !share.status().canTurnOn) throw new BuddyError('signed_out', share.status().line);
    return share.setOn(on);
  });

  return {};
}

module.exports = { registerClaudeIpc };
