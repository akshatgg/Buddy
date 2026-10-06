'use strict';

const test = require('node:test');
const assert = require('node:assert');
const { buildAppMenuTemplate, installAppMenu } = require('../src/main/app-menu');

/** Every item of the template, submenus included. */
function allItems(template) {
  return template.flatMap((item) => [item, ...(item.submenu ? allItems(item.submenu) : [])]);
}

const EDIT_ROLES = ['undo', 'redo', 'cut', 'copy', 'paste', 'selectAll'];

test('the Edit roles are in the menu, so cut, copy, paste, select all and undo work in the text boxes', () => {
  const template = buildAppMenuTemplate({ closeWindow() {} });
  const edit = template.find((menu) => menu.label === 'Edit');
  assert.ok(edit, 'there is an Edit menu');
  const roles = edit.submenu.filter((item) => item.role).map((item) => item.role);
  for (const role of EDIT_ROLES) assert.ok(roles.includes(role), role);
});

test('nothing in the menu quits Buddy: no Cmd+Q in any spelling, and no quit role', () => {
  const items = allItems(buildAppMenuTemplate({ closeWindow() {} }));
  assert.ok(items.length > EDIT_ROLES.length, 'the menu has items to check');
  for (const item of items) {
    assert.notStrictEqual(item.role, 'quit', 'no quit role, which brings Cmd+Q with it');
    assert.doesNotMatch(String(item.accelerator ?? ''), /(^|\+)q$/i, `${item.label ?? item.role} has no Q accelerator`);
  }
});

test('Cmd+W closes the focused window: the menu hands it to closeWindow', () => {
  const closed = [];
  const template = buildAppMenuTemplate({ closeWindow: (win) => closed.push(win) });
  const close = allItems(template).find((item) => /^(Command|CommandOrControl|CmdOrCtrl|Cmd)\+W$/i.test(item.accelerator ?? ''));
  assert.ok(close, 'an item with Cmd+W');
  const win = { name: 'the focused window' };
  close.click({}, win);
  assert.deepStrictEqual(closed, [win]);
});

test('the menu has only these keys: Edit, and Cmd+W', () => {
  const items = allItems(buildAppMenuTemplate({ closeWindow() {} }));
  const withKeys = items.filter((item) => item.accelerator || item.role).map((item) => item.role || item.accelerator);
  assert.deepStrictEqual(withKeys.sort(), [...EDIT_ROLES, 'CommandOrControl+W'].sort());
});

/** Just enough of electron's Menu and of Settings and Welcome windows. */
function setup() {
  const installed = [];
  const Menu = {
    buildFromTemplate: (template) => ({ template }),
    setApplicationMenu: (menu) => installed.push(menu),
  };
  const settingsPage = { name: 'the Settings page' };
  const alive = { webContents: settingsPage, isDestroyed: () => false, closed: 0, close() { this.closed += 1; } };
  const windows = { owns: (webContents) => webContents === settingsPage };
  installAppMenu({ windows, Menu });
  const template = installed[0].template;
  const close = allItems(template).find((item) => item.accelerator === 'CommandOrControl+W');
  return { installed, close, alive, windows };
}

test('installAppMenu sets the menu as the application menu, once', () => {
  const { installed } = setup();
  assert.strictEqual(installed.length, 1);
});

test('Cmd+W closes a Settings or Welcome window', () => {
  const { close, alive } = setup();
  close.click({}, alive);
  assert.strictEqual(alive.closed, 1);
});

test('Cmd+W does nothing in any other window (the panel, the bubble, the buddy), nor with no window at all', () => {
  const { close } = setup();
  const other = { webContents: { name: 'the panel page' }, isDestroyed: () => false, closed: 0, close() { this.closed += 1; } };
  close.click({}, other);
  assert.strictEqual(other.closed, 0);
  assert.doesNotThrow(() => close.click({}, undefined));
  assert.doesNotThrow(() => close.click({}, null));
});

test('Cmd+W does nothing in a window that is already gone', () => {
  const { close, alive } = setup();
  alive.isDestroyed = () => true;
  assert.doesNotThrow(() => close.click({}, alive));
  assert.strictEqual(alive.closed, 0);
});
