'use strict';

/**
 * Claude mode's Talk: what the person types in the panel goes into the terminal tab where their Claude Code session
 * runs, and Enter is pressed there. The tab is found by its tty (each hook tells Buddy which one, live.js), in iTerm2 or
 * Terminal, through AppleScript: the tab need not be in front, and nothing else is typed into. The first time, macOS
 * asks the person whether Buddy may control that app.
 *
 * The text goes in first and Enter a moment after, so that Claude Code does not take a fast burst ending in Enter for
 * a paste (where Enter would be a new line, not "send"). Line breaks become spaces for the same reason.
 */

const { execFile } = require('node:child_process');
const { BuddyError } = require('../../../shared/errors');

const TEXT_MAX = 4000;
const RUN_TIMEOUT_MS = 15_000; // macOS's "may Buddy control iTerm2?" question waits for the person within this
const ENTER_AFTER_S = 0.3;
const NO_TERMINAL = "I can't type into that terminal. I copied it: paste it there.";
const NOT_ALLOWED = "macOS didn't let me type into your terminal. Allow Buddy in System Settings → Privacy & Security → Automation.";
const ONLY_MAC = "I can only type into a terminal on the Mac. I copied it: paste it there.";

// Run with the tty ("/dev/ttys003") and the text as its arguments: they are never part of the script itself.
const SCRIPT = `
on run argv
  set theTty to item 1 of argv
  set theText to item 2 of argv
  if application id "com.googlecode.iterm2" is running then
    tell application id "com.googlecode.iterm2"
      repeat with w in windows
        repeat with t in tabs of w
          repeat with s in sessions of t
            if tty of s is theTty then
              tell s to write text theText newline no
              delay ${ENTER_AFTER_S}
              tell s to write text ""
              return "iterm"
            end if
          end repeat
        end repeat
      end repeat
    end tell
  end if
  if application id "com.apple.Terminal" is running then
    tell application id "com.apple.Terminal"
      repeat with w in windows
        repeat with t in tabs of w
          if tty of t is theTty then
            do script theText in t
            return "terminal"
          end if
        end repeat
      end repeat
    end tell
  end if
  return "none"
end run
`;

/** The text as one line: line breaks and tabs become spaces (see the top), and it is trimmed. */
function oneLine(text) {
  return String(text).replace(/[\r\n\t]+/g, ' ').trim();
}

/**
 * Types `text` into the terminal on `tty` ("ttys003") and presses Enter. Answers { app: 'iterm' | 'terminal' }, or
 * throws a BuddyError whose words say what to do (the caller then copies the text). `run` is execFile, passed in by
 * the unit tests.
 */
function createTerminal({ platform = process.platform, run = execFile } = {}) {
  function osascript(args) {
    return new Promise((resolve, reject) => {
      run('/usr/bin/osascript', ['-e', SCRIPT, ...args], { timeout: RUN_TIMEOUT_MS }, (err, stdout, stderr) => {
        if (err) {
          err.stderr = String(stderr || '');
          reject(err);
        } else {
          resolve(String(stdout).trim());
        }
      });
    });
  }

  async function type({ tty, text }) {
    const line = oneLine(text);
    if (!line) throw new BuddyError('bad_request', 'Type something first.');
    if (line.length > TEXT_MAX) throw new BuddyError('bad_request', `That is too long (over ${TEXT_MAX} characters).`);
    if (platform !== 'darwin') throw new BuddyError('no_terminal', ONLY_MAC);
    if (typeof tty !== 'string' || !/^ttys?\d{1,4}$/.test(tty)) throw new BuddyError('no_terminal', NO_TERMINAL);
    let app;
    try {
      app = await osascript([`/dev/${tty}`, line]);
    } catch (err) {
      // -1743: the person (or macOS) did not allow Buddy to control the app.
      if (/-1743|not allowed/i.test(err.stderr)) throw new BuddyError('not_allowed', NOT_ALLOWED);
      console.warn('[buddy] could not type into the terminal:', err.code || err.name);
      throw new BuddyError('no_terminal', NO_TERMINAL);
    }
    if (app !== 'iterm' && app !== 'terminal') throw new BuddyError('no_terminal', NO_TERMINAL);
    return { app };
  }

  return { type };
}

module.exports = { SCRIPT, TEXT_MAX, NO_TERMINAL, NOT_ALLOWED, ONLY_MAC, oneLine, createTerminal };
