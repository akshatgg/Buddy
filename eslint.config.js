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
  { ignores: ['node_modules/', 'bin/', 'dist/', 'release/', 'assets/', 'art/', 'test/e2e/out/', '.*/**', 'web/node_modules/', 'web/.vercel/'] },
  js.configs.recommended,
  {
    // Main process, preloads, shared code, tools and tests: CommonJS on Node.
    files: ['**/*.js'],
    ignores: ['src/renderer/**'],
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
];
