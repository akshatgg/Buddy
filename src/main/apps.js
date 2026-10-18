'use strict';

/**
 * The apps on this Mac, for "open Safari": the .app folders in the Mac's app folders (Finder's CoreServices among
 * them) and one folder down (Utilities, an app maker's folder, Chrome's web apps), plus the apps Spotlight knows,
 * by name without ".app". Opening one is the system's
 * (shell.openPath), as a double-click in the Finder would.
 */

const fs = require('node:fs');
const path = require('node:path');
const { pickChat } = require('../../shared/message-pick');
const { appLine } = require('../../shared/pick-lines');
const { aliasFor } = require('../../shared/app-aliases');

const SPOTLIGHT_MS = 10 * 60_000;
const CORE_SERVICES = '/System/Library/CoreServices';
// The only user-facing apps in CoreServices; the rest are the system's own agents.
const CORE_APPS = new Set(['Finder.app', 'Screen Sharing.app', 'Archive Utility.app']);
// Where Spotlight finds apps that are not apps to open: inside other apps, packages, caches, backups, the bin.
const NOT_APPS = ['.app/', '/node_modules/', '/Library/Application Support/', '/Library/Caches/', '/.Trash/'];

/** Where the Mac keeps apps: for everyone, the system's own, the person's, and the system's core apps (Finder). */
function appDirs(home) {
  return ['/Applications', '/System/Applications', path.join(home, 'Applications'), '/System/Library/CoreServices'];
}

/** One app for what was asked: its alias, else the name picker (shared with WhatsApp's), else the line to say. */
function findApp(list, asked) {
  const names = list.map((a) => a.name);
  const alias = aliasFor(asked);
  const pick = alias && names.includes(alias) ? { kind: 'one', name: alias } : pickChat(asked, names);
  if (pick.kind !== 'one') return { kind: pick.kind, line: appLine(asked, pick, 'Mac') };
  return { kind: 'one', app: list.find((a) => a.name === pick.name) };
}

/** Every app Spotlight knows (other disks, odd folders), asked in the background and kept for 10 minutes. */
function createSpotlight({ execFile, now = Date.now, exists = fs.existsSync }) {
  const real = (p) => p.endsWith('.app') && !path.basename(p).startsWith('Buddy') && !NOT_APPS.some((x) => p.includes(x))
    && exists(path.join(p, 'Contents', 'Info.plist'));
  let paths = [];
  let at = -Infinity;
  let asking = false;
  return () => {
    const known = paths; // what was known before this call asks again
    if (!asking && now() - at >= SPOTLIGHT_MS) {
      asking = true;
      at = now();
      execFile('mdfind', ["kMDItemContentType == 'com.apple.application-bundle'"], { timeout: 10_000, maxBuffer: 4 * 1024 * 1024 }, (err, out) => {
        asking = false;
        if (!err) paths = String(out).split('\n').map((p) => p.trim()).filter(real);
      });
    }
    return known;
  };
}

/**
 * Buddy's own bundle's folder name ("Buddy.app"): the outermost .app its program runs in (app.getPath('exe')), wherever
 * that is (the Mac may run it from a copy elsewhere). null when it runs from none (Windows).
 */
function ownBundle(exe) {
  return String(exe || '').split('/').find((part) => part.endsWith('.app')) || null;
}

/** `own`: Buddy's own bundle's folder name (ownBundle), never one of the apps; null for none. */
function createApps({ dirs, openPath, own = null, readdir = (dir) => fs.readdirSync(dir, { withFileTypes: true }), spotlight = null }) {
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
      if (dir === CORE_SERVICES && !CORE_APPS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.name.endsWith('.app')) found.push({ name: entry.name.slice(0, -'.app'.length), path: full });
      else if (depth === 0 && entry.isDirectory()) found.push(...inside(full, 1));
    }
    return found;
  }
  function list() {
    const seen = new Set();
    const all = [];
    const fromSpotlight = (spotlight ? spotlight() : [])
      .filter((p) => path.basename(p) !== own)
      .map((p) => ({ name: path.basename(p, '.app'), path: p }));
    for (const app of [...dirs.flatMap((dir) => inside(dir, 0)), ...fromSpotlight]) {
      if (seen.has(app.path)) continue;
      seen.add(app.path);
      all.push(app);
    }
    return all;
  }
  return {
    list,
    find: (asked) => findApp(list(), asked),
    /** '' when it opened, else the system's reason. */
    open: (appPath) => openPath(appPath),
  };
}

module.exports = { createApps, appDirs, ownBundle, findApp, createSpotlight };
