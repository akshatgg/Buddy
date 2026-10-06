'use strict';

// The app's entry point (package.json "main"). It is kept apart from main.js
// so the end-to-end test can require main.js and call start() itself with
// fakes. A "was I required or run?" check in main.js is not reliable: under
// `electron .` Electron imports the app as an ES module, and in a packaged
// app it loads it with module.parent set.
const { app } = require('electron');
const { start } = require('./main');

start().catch((err) => {
  console.error('[buddy] failed to start', err);
  app.exit(1);
});
