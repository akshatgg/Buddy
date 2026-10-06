'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { commandFor } = require('../tools/build-native');

test('on the Mac: swiftc builds bin/buddy-helper for Apple silicon and macOS 14', () => {
  assert.deepStrictEqual(commandFor('darwin', { root: '/r' }), {
    file: 'swiftc',
    args: ['-O', '-target', 'arm64-apple-macos14.0', '/r/src/native/BuddyHelper.swift', '-o', '/r/bin/buddy-helper'],
  });
});

const ROOT = 'D:\\buddy';
const FRAMEWORK = 'C:\\Windows\\Microsoft.NET\\Framework64\\v4.0.30319';
const WPF = `${FRAMEWORK}\\WPF`;
const GAC = 'C:\\Windows\\Microsoft.NET\\assembly\\GAC_MSIL';
const SOURCES = ['Program.cs', 'Native.cs', 'Keys.cs'].map((name) => `${ROOT}\\src\\native\\windows\\${name}`);
const UIA = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'];

/** A Windows PC that holds `files` (full paths), as commandFor('win32') sees it. */
function pc(files) {
  return {
    root: ROOT,
    env: { WINDIR: 'C:\\Windows' },
    exists: (file) => files.includes(file),
    list: (dir) => [...new Set(files.filter((f) => f.startsWith(`${dir}\\`)).map((f) => f.slice(dir.length + 1).split('\\')[0]))],
  };
}

const COMMON_ARGS = [
  '/nologo',
  '/noconfig',
  '/target:winexe',
  '/platform:anycpu',
  '/optimize+',
  `/out:${ROOT}\\bin\\buddy-helper.exe`,
  '/reference:System.dll',
  '/reference:System.Core.dll',
  '/reference:System.Drawing.dll',
  '/reference:System.Windows.Forms.dll',
  '/reference:System.Web.Extensions.dll',
];

test('on Windows: the C# compiler that comes with Windows builds bin/buddy-helper.exe from every helper source', () => {
  const wpf = UIA.map((name) => `${WPF}\\${name}.dll`);
  const { file, args } = commandFor('win32', pc([`${FRAMEWORK}\\csc.exe`, ...wpf, ...SOURCES]));
  assert.strictEqual(file, `${FRAMEWORK}\\csc.exe`);
  assert.deepStrictEqual(args, [
    ...COMMON_ARGS,
    ...wpf.map((dll) => `/reference:${dll}`),
    // In name order, so that two builds of the same sources are the same.
    ...[...SOURCES].sort(),
  ]);
});

test('on Windows: UI Automation is found in the global assembly cache when the WPF folder lacks it', () => {
  const gac = UIA.map((name) => `${GAC}\\${name}\\v4.0_4.0.0.0__31bf3856ad364e35\\${name}.dll`);
  const { args } = commandFor('win32', pc([`${FRAMEWORK}\\csc.exe`, ...gac, ...SOURCES]));
  assert.deepStrictEqual(args.filter((a) => /UIAutomation|WindowsBase/.test(a)), gac.map((dll) => `/reference:${dll}`));
});

test('on Windows without .NET Framework 4.8 it says what is missing', () => {
  assert.throws(() => commandFor('win32', pc(SOURCES)), /C# compiler.*\.NET Framework 4\.8/s);
  const csc = `${FRAMEWORK}\\csc.exe`;
  assert.throws(() => commandFor('win32', pc([csc, ...SOURCES])), /UIAutomationClient\.dll/);
});

test('on any other system there is no helper to build', () => {
  assert.throws(() => commandFor('linux', { root: path.sep }), /macOS or Windows/);
});
