#!/bin/sh
# The Firestore emulator's tests (test/firestore/). firebase-tools needs Java 21 or newer; macOS may have an older
# Java first on the PATH, so Homebrew's openjdk@21 goes first when it is installed.
set -e
if prefix=$(brew --prefix openjdk@21 2>/dev/null) && [ -x "$prefix/bin/java" ]; then
  PATH="$prefix/bin:$PATH"
  export PATH
fi
exec firebase emulators:exec --only firestore --project demo-buddy "node --test 'test/firestore/*.test.js'"
