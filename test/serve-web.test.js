'use strict';

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const { fileFor, headersFor } = require('../tools/serve-web');

const PUBLIC = path.join(__dirname, '..', 'web', 'public');

test('the local server finds files as Vercel does: /app is the app, /privacy is privacy.html', () => {
  assert.strictEqual(fileFor('/app'), path.join(PUBLIC, 'app', 'index.html'));
  assert.strictEqual(fileFor('/app/app.js?v=1'), path.join(PUBLIC, 'app', 'app.js'));
  assert.strictEqual(fileFor('/privacy'), path.join(PUBLIC, 'privacy.html'));
  assert.strictEqual(fileFor('/'), path.join(PUBLIC, 'index.html'));
  assert.strictEqual(fileFor('/nope'), null);
  assert.strictEqual(fileFor('/../package.json'), null, 'nothing outside web/public');
  assert.strictEqual(fileFor('/%E0%A4%A'), null, 'a path that is not text');
});

test('the local server sends the types and the service worker header that web/vercel.json sends', () => {
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'sw.js'))['service-worker-allowed'], '/app');
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'app.js'))['content-type'], 'text/javascript; charset=utf-8');
  assert.strictEqual(headersFor(path.join(PUBLIC, 'app', 'manifest.webmanifest'))['content-type'], 'application/manifest+json');
  assert.ok(!('service-worker-allowed' in headersFor(path.join(PUBLIC, 'app', 'app.js'))));
});
