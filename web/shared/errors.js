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
