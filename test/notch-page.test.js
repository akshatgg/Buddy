'use strict';

const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const PAGE = fs.readFileSync(path.join(__dirname, '..', 'src', 'renderer', 'notch', 'index.html'), 'utf8');

test('the notch page allows its import map by hash, and nothing else inline', () => {
  const map = PAGE.match(/<script type="importmap">([\s\S]*?)<\/script>/)[1];
  const hash = crypto.createHash('sha256').update(map).digest('base64');
  const csp = PAGE.match(/http-equiv="Content-Security-Policy" content="([^"]+)"/)[1];
  assert.ok(csp.includes(`'sha256-${hash}'`), 'the import map changed: put its new hash in the policy');
  assert.ok(!csp.includes('unsafe-inline'));
  assert.deepStrictEqual(JSON.parse(map).imports, {
    three: '../../../node_modules/three/build/three.module.js',
    'three/addons/': '../../../node_modules/three/examples/jsm/',
  });
});

test('the notch page has the face, the eyes, the status icon with Clawd, and the "z" letters', () => {
  for (const id of ['face', 'eye-left', 'eye-right', 'icon', 'say', 'zz']) assert.ok(PAGE.includes(`id="${id}"`), id);
  assert.match(PAGE, /<svg class="clawd"/);
  assert.match(PAGE, /<script type="module" src="face.js"><\/script>/);
});
