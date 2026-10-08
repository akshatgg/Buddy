'use strict';

/**
 * The folders Buddy may run Claude Code in: Settings → Claude Code → My projects. Kept in the settings file as
 * [{ path, name }], at most 20, each once; `lastProject` remembers the chat's last pick. Nothing else on the disk is a
 * project: the chat only ever starts a job in one of these, and only while the folder is there.
 */

const fs = require('node:fs');
const path = require('node:path');
const { BuddyError } = require('../../../shared/errors');

const MAX_PROJECTS = 20;

function createProjects({ store, existsSync = fs.existsSync, resolve = path.resolve }) {
  /** The saved list, with anything that is not { path: string } left out. */
  const saved = () => (Array.isArray(store.get('projects')) ? store.get('projects') : [])
    .filter((p) => p && typeof p.path === 'string' && p.path)
    .map((p) => ({ path: p.path, name: typeof p.name === 'string' && p.name ? p.name : path.basename(p.path) }));

  const withFound = (p) => ({ ...p, found: existsSync(p.path) });

  function list() {
    return saved().map(withFound);
  }

  function found() {
    return list().filter((p) => p.found);
  }

  function add(folder) {
    const given = typeof folder === 'string' ? folder.trim() : '';
    if (!given) throw new BuddyError('bad_request', 'Pick a folder first.');
    const full = resolve(given);
    const projects = saved();
    const there = projects.find((p) => p.path === full);
    if (there) return { ...there };
    if (projects.length >= MAX_PROJECTS) {
      throw new BuddyError('bad_request', `You can have ${MAX_PROJECTS} projects at most. Remove one first.`);
    }
    const project = { path: full, name: path.basename(full) || full };
    store.set({ projects: [...projects, project] });
    return { ...project };
  }

  function remove(folder) {
    const projects = saved();
    const left = projects.filter((p) => p.path !== folder);
    if (left.length === projects.length) return false;
    const patch = { projects: left };
    if (store.get('lastProject') === folder) patch.lastProject = null;
    store.set(patch);
    return true;
  }

  function lastProject() {
    const last = store.get('lastProject');
    const project = typeof last === 'string' ? saved().find((p) => p.path === last) : null;
    if (!project) return null;
    const checked = withFound(project);
    return checked.found ? checked : null;
  }

  return {
    list,
    found,
    names: () => found().map((p) => p.name),
    add,
    remove,
    lastProject,
    setLastProject: (folder) => store.set({ lastProject: typeof folder === 'string' ? folder : null }),
  };
}

module.exports = { createProjects, MAX_PROJECTS };
