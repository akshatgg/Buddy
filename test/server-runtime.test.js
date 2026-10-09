'use strict';

// Vercel's Node runs the server's functions without require(esm), so everything the server requires must load as
// CommonJS. firebase-admin 14 brings in jose 6, which is ESM only: on Vercel every route then failed to start with
// ERR_REQUIRE_ESM, while this Mac's Node loaded it happily. This keeps that from coming back with an upgrade.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const WEB = path.join(__dirname, '..', 'web');
const installed = fs.existsSync(path.join(WEB, 'node_modules', 'firebase-admin'));

test("the server's libraries load without require(esm), as on Vercel",
  { skip: !installed && "web/node_modules is not installed (run npm ci in web/)" }, () => {
    const code = "require('firebase-admin/app'); require('firebase-admin/auth'); require('firebase-admin/firestore'); require('web-push'); require('./lib/deps');";
    const r = spawnSync(process.execPath, ['--no-experimental-require-module', '-e', code], { cwd: WEB, encoding: 'utf8' });
    assert.strictEqual(r.status, 0, r.stderr);
  });
