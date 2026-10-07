'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { buildMenuTemplate, createTray, trayIcon } = require('../src/main/tray');

const ASSETS = path.join(__dirname, '..', 'assets');

function handlers() {
  const calls = [];
  return {
    calls,
    setVisible: (v) => calls.push(['setVisible', v]),
    openSettings: () => calls.push(['openSettings']),
    openAdmin: () => calls.push(['openAdmin']),
    setBuddyOn: (on) => calls.push(['setBuddyOn', on]),
    quit: () => calls.push(['quit']),
  };
}

const labels = (template) => template.filter((i) => i.label).map((i) => i.label);

test('menu when the buddy is on and showing', () => {
  const t = buildMenuTemplate({ buddyOn: true, visible: true }, handlers());
  assert.deepStrictEqual(labels(t), ['Hide buddy', 'Settings…', 'Turn off buddy', 'Quit Buddy']);
  assert.strictEqual(t[0].enabled, true);
});

test('menu when the buddy is off', () => {
  const t = buildMenuTemplate({ buddyOn: false, visible: false }, handlers());
  assert.deepStrictEqual(labels(t), ['Show buddy', 'Settings…', 'Turn on buddy', 'Quit Buddy']);
  assert.strictEqual(t[0].enabled, false);
});

test('menu items call their handlers', () => {
  const h = handlers();
  const t = buildMenuTemplate({ buddyOn: true, visible: true }, h);
  for (const item of t) if (item.click) item.click();
  assert.deepStrictEqual(h.calls, [['setVisible', false], ['openSettings'], ['setBuddyOn', false], ['quit']]);
});

test('the menu bar icon files exist and are PNGs', () => {
  for (const name of ['trayTemplate.png', 'trayTemplate@2x.png']) {
    const bytes = fs.readFileSync(path.join(__dirname, '..', 'assets', name));
    assert.strictEqual(bytes.subarray(1, 4).toString('ascii'), 'PNG');
  }
});

test('the admin gets an Admin… item, above Settings…', () => {
  const h = handlers();
  const t = buildMenuTemplate({ buddyOn: true, visible: true, isAdmin: true }, h);
  assert.deepStrictEqual(labels(t), ['Hide buddy', 'Admin…', 'Settings…', 'Turn off buddy', 'Quit Buddy']);
  t.find((item) => item.label === 'Admin…').click();
  assert.deepStrictEqual(h.calls, [['openAdmin']]);
});

test('the icon: a template image on the Mac, which follows light and dark menu bars; a coloured one on Windows', () => {
  assert.deepStrictEqual(trayIcon('darwin'), { file: path.join(ASSETS, 'trayTemplate.png'), template: true });
  assert.deepStrictEqual(trayIcon('win32'), { file: path.join(ASSETS, 'trayWindows.ico'), template: false });
});

/** Just enough of Electron's Tray, Menu and nativeImage to see what createTray does with them. */
function fakeElectron() {
  const made = {};
  class Tray {
    constructor(image) {
      Object.assign(this, { image, handlers: {}, popped: 0 });
      made.tray = this;
    }

    setToolTip(text) {
      this.tip = text;
    }

    setContextMenu(menu) {
      this.menu = menu;
    }

    on(event, fn) {
      this.handlers[event] = fn;
    }

    popUpContextMenu() {
      this.popped += 1;
    }
  }
  const Menu = { buildFromTemplate: (template) => ({ template }) };
  const nativeImage = {
    createFromPath: (file) => ({ file, template: false, setTemplateImage(on) { this.template = on; } }),
  };
  return { made, Tray, Menu, nativeImage };
}

function trayOn(platform) {
  const electron = fakeElectron();
  createTray({ getState: () => ({ buddyOn: true, visible: true }), handlers: handlers(), platform, ...electron });
  return electron.made.tray;
}

test('on Windows a left click opens the menu too: Windows itself opens it only on a right click', () => {
  const tray = trayOn('win32');
  assert.strictEqual(tray.image.file, trayIcon('win32').file);
  assert.strictEqual(tray.image.template, false);
  assert.strictEqual(tray.tip, 'Buddy');
  tray.handlers.click();
  assert.strictEqual(tray.popped, 1);
});

test('on the Mac the icon is a template image and a click needs no help to open the menu', () => {
  const tray = trayOn('darwin');
  assert.strictEqual(tray.image.file, trayIcon('darwin').file);
  assert.strictEqual(tray.image.template, true);
  assert.strictEqual(tray.handlers.click, undefined);
  assert.deepStrictEqual(labels(tray.menu.template), ['Hide buddy', 'Settings…', 'Turn off buddy', 'Quit Buddy']);
});

test('the Windows tray icon is an .ico with a PNG picture for each scale Windows draws it at', () => {
  const bytes = fs.readFileSync(path.join(ASSETS, 'trayWindows.ico'));
  assert.strictEqual(bytes.readUInt16LE(0), 0);
  assert.strictEqual(bytes.readUInt16LE(2), 1, 'the file says it is an icon');
  const sizes = [];
  for (let i = 0; i < bytes.readUInt16LE(4); i++) {
    const entry = 6 + i * 16;
    const size = bytes[entry] || 256;
    const length = bytes.readUInt32LE(entry + 8);
    const offset = bytes.readUInt32LE(entry + 12);
    assert.ok(offset + length <= bytes.length, `the ${size} px picture is inside the file`);
    assert.strictEqual(bytes.subarray(offset + 1, offset + 4).toString('ascii'), 'PNG', `the ${size} px picture is a PNG`);
    assert.strictEqual(bytes.readUInt32BE(offset + 16), size, 'and is as wide as its entry says');
    sizes.push(size);
  }
  assert.deepStrictEqual(sizes, [16, 20, 24, 32, 40, 48]);
});
