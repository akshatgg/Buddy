'use strict';

// The app's entry point (package.json "main"). It is kept apart from main.js
// so the end-to-end test can require main.js and call start() itself with
// fakes. A "was I required or run?" check in main.js is not reliable: under
// `electron .` Electron imports the app as an ES module, and in a packaged
// app it loads it with module.parent set.
const fs = require('node:fs');
const path = require('node:path');
const { app } = require('electron');
const { start } = require('./main');

// For trying a build safely: with BUDDY_USER_DATA set, Buddy keeps its settings in that folder
// instead of the real one, and its login item stays off (it never adds or removes one).
const options = {};
if (process.env.BUDDY_USER_DATA) {
  // app.setPath refuses a relative path ("Path must be absolute"), and its documentation asks for a folder that exists.
  const dir = path.resolve(process.env.BUDDY_USER_DATA);
  fs.mkdirSync(dir, { recursive: true });
  app.setPath('userData', dir);
  options.loginItems = { get: () => false, set: () => {} };
}

start(options).catch((err) => {
  console.error('[buddy] failed to start', err);
  app.exit(1);
});
