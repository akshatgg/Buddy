'use strict';

const js = require('@eslint/js');
const globals = require('globals');

const rules = {
  'no-unused-vars': 'error',
  'no-undef': 'error',
  'prefer-const': 'error',
  eqeqeq: 'error',
};

module.exports = [
  { ignores: ['node_modules/', 'bin/', 'dist/', 'release/', 'assets/', 'art/', 'test/e2e/out/', '.*/**', 'web/node_modules/', 'web/.vercel/', 'android/**',
    'web/public/app/shared/', 'web/public/app/vendor/'] }, // Buddy on iPhone's copies, made by tools/sync-web-app.js
  js.configs.recommended,
  {
    // Main process, preloads, shared code, tools and tests: CommonJS on Node.
    files: ['**/*.js'],
    ignores: ['src/renderer/**', 'web/public/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'commonjs', globals: { ...globals.node } },
    rules,
  },
  {
    // Bubble, panel, settings and welcome pages: plain browser scripts.
    files: ['src/renderer/**/*.js'],
    ignores: ['src/renderer/buddy/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser } },
    rules,
  },
  {
    // The buddy page and its animation maths are ES modules; the .mjs tests import them.
    files: ['src/renderer/buddy/**/*.js', 'test/**/*.mjs'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser, ...globals.node } },
    rules,
  },
  {
    // The website's one script: a plain browser script that also hands its helpers to the tests.
    files: ['web/public/**/*.js'],
    ignores: ['web/public/app/**'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.browser, module: 'writable' } },
    rules,
  },
  {
    // Buddy on iPhone: a web app of ES modules in the browser.
    files: ['web/public/app/**/*.js'],
    ignores: ['web/public/app/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'module', globals: { ...globals.browser } },
    rules,
  },
  {
    // Its service worker: a plain script.
    files: ['web/public/app/sw.js'],
    languageOptions: { ecmaVersion: 2024, sourceType: 'script', globals: { ...globals.serviceworker } },
    rules,
  },
];
