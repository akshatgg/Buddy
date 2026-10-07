package com.akshatgg.buddy.core

/**
 * The one error type Buddy throws on purpose, as on the Mac (shared/errors.js). `code` is what callers branch on;
 * `message` is written for the person using Buddy, in plain words, and is shown to them as it is.
 */
class BuddyError(val code: String, message: String) : Exception(message)
