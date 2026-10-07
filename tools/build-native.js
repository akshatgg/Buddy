'use strict';

/**
 * Builds Buddy's native helper for the system this runs on, into bin/:
 *
 *   macOS     bin/buddy-helper      from src/native/BuddyHelper.swift, with swiftc (the Xcode command line tools)
 *   Windows   bin/buddy-helper.exe  from src/native/windows/*.cs, with the C# compiler that comes with Windows
 *                                   (.NET Framework 4.8), so nothing has to be installed for it
 *
 *   npm run build:native
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// What the Windows helper uses besides mscorlib. These sit next to the compiler.
const FRAMEWORK_REFERENCES = [
  'System.dll',
  'System.Core.dll',
  'System.Drawing.dll',
  'System.Windows.Forms.dll',
  'System.Web.Extensions.dll',
];
// UI Automation, which tells a password field, belongs to WPF: it is in the compiler's WPF folder, or else in the
// global assembly cache.
const WPF_REFERENCES = ['UIAutomationClient', 'UIAutomationTypes', 'WindowsBase'];

function macCommand(root) {
  const at = (file) => path.posix.join(root, file);
  return {
    file: 'swiftc',
    args: ['-O', '-target', 'arm64-apple-macos14.0', at('src/native/BuddyHelper.swift'), '-o', at('bin/buddy-helper')],
  };
}

function windowsCommand({ root, env, exists, list }) {
  const p = path.win32;
  const windir = env.WINDIR || env.SystemRoot || 'C:\\Windows';
  const framework = p.join(windir, 'Microsoft.NET', 'Framework64', 'v4.0.30319');
  const csc = p.join(framework, 'csc.exe');
  if (!exists(csc)) {
    throw new Error(
      `Could not find the C# compiler that comes with Windows (${csc}). Buddy's helper needs .NET Framework 4.8, ` +
      'which Windows 10 (version 1903 or later) and Windows 11 include.',
    );
  }
  const gac = p.join(windir, 'Microsoft.NET', 'assembly', 'GAC_MSIL');
  const wpf = WPF_REFERENCES.map((name) => {
    const cached = list(p.join(gac, name)).filter((version) => version.startsWith('v4.0_')).sort();
    const candidates = [p.join(framework, 'WPF', `${name}.dll`), ...cached.map((v) => p.join(gac, name, v, `${name}.dll`))];
    const found = candidates.find((file) => exists(file));
    if (!found) {
      throw new Error(`Could not find ${name}.dll (UI Automation, part of .NET Framework 4.8) in ${candidates.join(' or ')}.`);
    }
    return found;
  });
  const dir = p.join(root, 'src', 'native', 'windows');
  const sources = list(dir).filter((name) => name.endsWith('.cs')).sort().map((name) => p.join(dir, name));
  return {
    file: csc,
    args: [
      '/nologo',
      '/noconfig', // only the references below, not the long default list
      '/target:winexe', // no console window of its own
      '/platform:anycpu',
      '/optimize+',
      `/out:${p.join(root, 'bin', 'buddy-helper.exe')}`,
      ...FRAMEWORK_REFERENCES.map((dll) => `/reference:${dll}`),
      ...wpf.map((dll) => `/reference:${dll}`),
      ...sources,
    ],
  };
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** The compiler and its arguments for `platform`. The rest can be passed in, so that tests can stand in for a PC. */
function commandFor(platform, { root = ROOT, env = process.env, exists = fs.existsSync, list = listDir } = {}) {
  if (platform === 'darwin') return macCommand(root);
  if (platform === 'win32') return windowsCommand({ root, env, exists, list });
  throw new Error(`Buddy's helper is built on macOS or Windows, not on ${platform}.`);
}

if (require.main === module) {
  const { file, args } = commandFor(process.platform);
  fs.mkdirSync(path.join(ROOT, 'bin'), { recursive: true });
  try {
    execFileSync(file, args, { stdio: 'inherit' });
  } catch {
    // The compiler has said what went wrong. On Windows the usual cause is a Buddy that is still running: Windows
    // does not let a running program's file be replaced (error CS0016).
    if (process.platform === 'win32') console.error('[build:native] If a file is "in use", quit Buddy first (menu: Quit Buddy).');
    process.exit(1);
  }
}

module.exports = { commandFor };
