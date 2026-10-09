// Made by tools/sync-web-app.js from shared/errors.js. Do not edit: run `npm run sync:web-app`.
const module = { exports: {} };
const require = (name) => ({  })[name];
(function () {
'use strict';

/**
 * The one error type Buddy throws on purpose. `code` is what callers branch
 * on; `message` is written for the person using Buddy, in plain words, and is
 * shown to them as it is.
 */
class BuddyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BuddyError';
    this.code = code;
  }
}

module.exports = { BuddyError };
})();
export const { BuddyError } = module.exports;
