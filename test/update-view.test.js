'use strict';

const test = require('node:test');
const assert = require('node:assert');
const updateView = require('../src/renderer/common/update-view.js');

const latest = { version: '1.3.0', url: 'https://github.com/akshatgg/Buddy/releases/tag/v1.3.0' };
const base = { kind: 'installer', currentVersion: '1.2.0', latest: null, progress: null, pending: false, error: null };

test('before the first check, and while checking, there is no update row', () => {
  assert.deepStrictEqual(updateView({ ...base, status: 'idle' }), { line: '', lineKind: 'muted', row: null, checking: false });
  assert.deepStrictEqual(updateView({ ...base, status: 'checking' }), { line: 'Checking for updates…', lineKind: 'muted', row: null, checking: true });
});

test('up to date says so', () => {
  const v = updateView({ ...base, status: 'current', latest: { ...latest, version: '1.2.0' } });
  assert.strictEqual(v.line, 'You have the newest version.');
  assert.strictEqual(v.lineKind, 'good');
  assert.strictEqual(v.row, null);
});

test('a newer version downloading, then ready, offers Update now', () => {
  const downloading = updateView({ ...base, status: 'downloading', latest, progress: 0.4 });
  assert.deepStrictEqual(downloading.row, {
    title: 'Buddy 1.3.0 is available', detail: 'Downloading… 40%', button: 'Update now', disabled: false,
  });
  const ready = updateView({ ...base, status: 'ready', latest });
  assert.deepStrictEqual(ready.row, {
    title: 'Buddy 1.3.0 is available', detail: 'Ready. Update now installs it and opens Buddy again.', button: 'Update now', disabled: false,
  });
});

test('after Update now, while it still downloads, the button shows the progress and waits', () => {
  const v = updateView({ ...base, status: 'downloading', latest, progress: 0.75, pending: true });
  assert.strictEqual(v.row.button, 'Updating… 75%');
  assert.strictEqual(v.row.disabled, true);
});

test('where Buddy cannot update itself, the row offers the download', () => {
  const v = updateView({ ...base, kind: 'download', status: 'available', latest });
  assert.deepStrictEqual(v.row, {
    title: 'Buddy 1.3.0 is available', detail: 'Download it and replace the Buddy in your Applications folder.', button: 'Download', disabled: false,
  });
});

test('an error is said in its own words, and a newer version found before it is still offered', () => {
  const plain = updateView({ ...base, status: 'error', error: 'Could not reach GitHub. Check your internet connection and try again.' });
  assert.strictEqual(plain.line, 'Could not reach GitHub. Check your internet connection and try again.');
  assert.strictEqual(plain.lineKind, 'error');
  assert.strictEqual(plain.row, null);
  const failedDownload = updateView({ ...base, status: 'error', latest, error: 'The download stopped' });
  assert.strictEqual(failedDownload.row.button, 'Update now');
  assert.strictEqual(failedDownload.row.detail, 'The download stopped. Update now tries again.');
  const withStop = updateView({ ...base, status: 'error', latest, error: 'GitHub took too long to answer.' });
  assert.strictEqual(withStop.row.detail, 'GitHub took too long to answer. Update now tries again.');
});

test('a missing state shows nothing', () => {
  assert.deepStrictEqual(updateView(null), { line: '', lineKind: 'muted', row: null, checking: false });
});
