'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { createProjects } = require('../src/main/claude/projects');

const APP = path.resolve('/Users/me/code/my-app');
const SITE = path.resolve('/Users/me/code/site');

function setup({ projects = [], lastProject = null, missing = [] } = {}) {
  const data = { projects, lastProject };
  const store = { get: (key) => data[key], set(patch) { Object.assign(data, patch); return { ...data }; } };
  const p = createProjects({ store, existsSync: (folder) => !missing.includes(folder) });
  return { p, data };
}

test('a folder is added once, by its resolved path, named after its last part, and saved', () => {
  const { p, data } = setup();
  assert.deepStrictEqual(p.add('/Users/me/code/my-app/'), { path: APP, name: 'my-app' });
  assert.deepStrictEqual(p.add('/Users/me/code/../code/my-app'), { path: APP, name: 'my-app' });
  assert.deepStrictEqual(data.projects, [{ path: APP, name: 'my-app' }]);
  assert.deepStrictEqual(p.list(), [{ path: APP, name: 'my-app', found: true }]);
});

test('nothing, blanks and things that are not text ask for a folder', () => {
  const { p } = setup();
  for (const bad of [undefined, null, '', '   ', 42]) {
    assert.throws(() => p.add(bad), { code: 'bad_request', message: 'Pick a folder first.' }, String(bad));
  }
});

test('at most 20 folders; the 21st is refused in plain words', () => {
  const { p } = setup({ projects: Array.from({ length: 20 }, (_, i) => ({ path: `/p/${i}`, name: String(i) })) });
  assert.throws(() => p.add('/p/twenty'), { code: 'bad_request', message: 'You can have 20 projects at most. Remove one first.' });
  assert.deepStrictEqual(p.add('/p/3'), { path: path.resolve('/p/3'), name: '3' }, 'one already there is not a 21st');
});

test('a folder that is gone shows as not found, and is not one the chat may use', () => {
  const { p } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }], missing: [SITE] });
  assert.deepStrictEqual(p.list(), [{ path: APP, name: 'my-app', found: true }, { path: SITE, name: 'site', found: false }]);
  assert.deepStrictEqual(p.found(), [{ path: APP, name: 'my-app', found: true }]);
  assert.deepStrictEqual(p.names(), ['my-app']);
});

test('remove takes a folder out and forgets it as the last pick', () => {
  const { p, data } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }], lastProject: APP });
  assert.strictEqual(p.remove(APP), true);
  assert.deepStrictEqual(data.projects, [{ path: SITE, name: 'site' }]);
  assert.strictEqual(data.lastProject, null);
  assert.strictEqual(p.remove(APP), false);
  assert.strictEqual(p.remove(SITE), true);
  assert.deepStrictEqual(p.list(), []);
});

test('the last pick is remembered, and given back only while it is listed and found', () => {
  const { p, data } = setup({ projects: [{ path: APP, name: 'my-app' }, { path: SITE, name: 'site' }] });
  assert.strictEqual(p.lastProject(), null);
  p.setLastProject(SITE);
  assert.strictEqual(data.lastProject, SITE);
  assert.deepStrictEqual(p.lastProject(), { path: SITE, name: 'site', found: true });
  p.setLastProject('/not/listed');
  assert.strictEqual(p.lastProject(), null);
  const gone = setup({ projects: [{ path: SITE, name: 'site' }], lastProject: SITE, missing: [SITE] });
  assert.strictEqual(gone.p.lastProject(), null);
});

test('a damaged list in the settings file is read as empty', () => {
  const { p } = setup({ projects: 'nope' });
  assert.deepStrictEqual(p.list(), []);
  const odd = setup({ projects: [{ path: 42 }, null, { path: APP, name: 'my-app' }] });
  assert.deepStrictEqual(odd.p.list(), [{ path: APP, name: 'my-app', found: true }]);
});
