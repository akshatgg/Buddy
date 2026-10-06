'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const platform = require('../src/main/platform');
const { onPlatform } = require('./helpers/platform');

const FILE = path.join(__dirname, '..', 'src', 'main', 'platform.js');

test('on the Mac: panels, ⌥Space, ⌘V and the Swift helper', () => {
  assert.deepStrictEqual(platform.forPlatform('darwin'), {
    windows: false,
    floatingType: 'panel',
    defaultShortcut: 'Alt+Space',
    pasteKeys: '⌘V',
    helperFile: 'buddy-helper',
  });
});

test('on Windows: tool windows, Ctrl+Shift+Space, Ctrl+V and the C# helper', () => {
  assert.deepStrictEqual(platform.forPlatform('win32'), {
    windows: true,
    floatingType: 'toolbar',
    defaultShortcut: 'Ctrl+Shift+Space',
    pasteKeys: 'Ctrl+V',
    helperFile: 'buddy-helper.exe',
  });
});

test('the module itself holds the values for the system it runs on', () => {
  for (const name of ['darwin', 'win32']) {
    assert.deepStrictEqual(
      onPlatform(name, FILE, (p) => ({ ...p, forPlatform: undefined })),
      JSON.parse(JSON.stringify(platform.forPlatform(name))),
      name,
    );
  }
});
