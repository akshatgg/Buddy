'use strict';

const { Menu } = require('electron');

/** Every item of a menu, submenus included. */
function allItems(menu) {
  return menu.items.flatMap((item) => [item, ...(item.submenu ? allItems(item.submenu) : [])]);
}

// Electron's default menu quits Buddy on Cmd+Q and closes (destroys) any focused window on Cmd+W, the panel included.
// Buddy has its own: the Edit roles, so copy and paste work in its text boxes; Cmd+W for Settings and Welcome only;
// and no Cmd+Q, so that Buddy is quit only from the menu bar's "Quit". On Windows it has none at all.
module.exports = async function appMenuCheck(ctx, { assert, delay, waitFor }) {
  if (process.platform === 'win32') {
    assert.strictEqual(Menu.getApplicationMenu(), null, 'Windows gets no application menu');
    return;
  }
  const menu = Menu.getApplicationMenu();
  assert.ok(menu, 'Buddy sets its own application menu');
  const items = allItems(menu);

  const withQ = items.filter((item) => item.role === 'quit' || /(^|\+)q$/i.test(item.accelerator ?? ''));
  assert.deepStrictEqual(withQ.map((item) => item.label), [], 'no item has Cmd+Q');
  // Electron may hand a role back in lower case ("selectall"), so the names are compared without regard to case.
  const roles = items.map((item) => String(item.role ?? '').toLowerCase());
  for (const role of ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll']) {
    assert.ok(roles.includes(role.toLowerCase()), `the ${role} role is in the menu`);
  }

  // Cmd+W: Settings closes, and nothing else does. Menu items are clicked here the way the menu clicks them,
  // with the window that has the focus.
  const close = items.find((item) => /^(Command|CommandOrControl|CmdOrCtrl|Cmd)\+W$/i.test(item.accelerator ?? ''));
  assert.ok(close, 'an item has Cmd+W');

  const settings = ctx.windows.open('settings');
  await waitFor(() => settings.webContents.executeJavaScript("document.getElementById('size') !== null"), 'the Settings window to load');
  close.click({}, settings, settings.webContents);
  await waitFor(() => settings.isDestroyed(), 'Cmd+W to close the Settings window');

  const alive = { panel: ctx.panel.window(), bubble: ctx.bubble.window(), buddy: ctx.buddy.window() };
  for (const [name, win] of Object.entries(alive)) {
    assert.ok(win && !win.isDestroyed(), `the ${name} window exists`);
    close.click({}, win, win.webContents);
  }
  close.click({}, undefined, undefined); // no window has the focus
  await delay(200);
  for (const [name, win] of Object.entries(alive)) assert.ok(!win.isDestroyed(), `Cmd+W leaves the ${name} window alone`);
  assert.strictEqual(ctx.panel.window(), alive.panel, 'and it is the same panel window');
};
