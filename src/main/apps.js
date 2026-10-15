'use strict';

/**
 * The apps on this Mac, for "open Safari": the .app folders in the Mac's app folders and one folder down
 * (Utilities, an app maker's folder, Chrome's web apps), by name without ".app". Opening one is the system's
 * (shell.openPath), as a double-click in the Finder would.
 */

const fs = require('node:fs');
const path = require('node:path');

/** Where the Mac keeps apps: for everyone, the system's own, and the person's. */
function appDirs(home) {
  return ['/Applications', '/System/Applications', path.join(home, 'Applications')];
}

/**
 * Buddy's own bundle's folder name ("Buddy.app"): the outermost .app its program runs in (app.getPath('exe')), wherever
 * that is (the Mac may run it from a copy elsewhere). null when it runs from none (Windows).
 */
function ownBundle(exe) {
  return String(exe || '').split('/').find((part) => part.endsWith('.app')) || null;
}

/** `own`: Buddy's own bundle's folder name (ownBundle), never one of the apps; null for none. */
function createApps({ dirs, openPath, own = null, readdir = (dir) => fs.readdirSync(dir, { withFileTypes: true }) }) {
  function inside(dir, depth) {
    let entries;
    try {
      entries = readdir(dir);
    } catch {
      return []; // not there, or not readable: no apps from it
    }
    const found = [];
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === own) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith('.app')) found.push({ name: entry.name.slice(0, -'.app'.length), path: full });
      else if (depth === 0 && entry.isDirectory()) found.push(...inside(full, 1));
    }
    return found;
  }
  return {
    list: () => dirs.flatMap((dir) => inside(dir, 0)),
    /** '' when it opened, else the system's reason. */
    open: (appPath) => openPath(appPath),
  };
}

module.exports = { createApps, appDirs, ownBundle };
